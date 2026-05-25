// Package userauth provides a real per-user credential store, replacing the
// single shared-password + self-asserted account-id login (the P1 hole where a
// client could claim any account id at login).
//
// Credentials are stored as bcrypt hashes in a pure-Go modernc SQLite database
// (no CGO). On a successful Verify the caller obtains the canonical account id
// from the store, so the JWT subject is bound to the *authenticated* user
// rather than to client-supplied input.
//
// Backwards compatibility: per-user auth is ADDITIVE. When no users are
// registered the app may keep using the legacy shared-password path (see
// handlers/auth.go); once a user registers, that account must authenticate with
// its own password.
package userauth

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	_ "modernc.org/sqlite"
)

// Errors returned by the store.
var (
	ErrUserExists      = errors.New("userauth: account already registered")
	ErrInvalidCredential = errors.New("userauth: invalid credentials")
	ErrEmptyInput      = errors.New("userauth: account id and password required")
)

// Store is the per-user credential interface.
type Store interface {
	// Register creates a new account with a bcrypt-hashed password.
	// Returns ErrUserExists if the account id is already taken.
	Register(accountID, password string) error
	// Verify checks the password for accountID. On success it returns the
	// canonical account id stored in the DB (the authenticated identity); on
	// failure it returns ErrInvalidCredential. It never reveals whether the
	// failure was an unknown account vs. a wrong password.
	Verify(accountID, password string) (canonicalID string, err error)
	// HasUsers reports whether any credentials are registered. Used to decide
	// whether to enforce per-user auth or fall back to the shared password.
	HasUsers() (bool, error)
	Close() error
}

// normalize lower-cases and trims the account id so logins are case-insensitive
// on the email/handle (matching how identity is treated elsewhere).
func normalize(accountID string) string {
	return strings.ToLower(strings.TrimSpace(accountID))
}

// ---------------------------------------------------------------------------
// SQLiteStore
// ---------------------------------------------------------------------------

type SQLiteStore struct {
	db *sql.DB
}

// NewSQLiteStore opens (or creates) the credential database at dsn.
func NewSQLiteStore(dsn string) (*SQLiteStore, error) {
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("userauth: open db: %w", err)
	}
	db.SetMaxOpenConns(1)
	s := &SQLiteStore{db: db}
	if err := s.init(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *SQLiteStore) init() error {
	_, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			account_id    TEXT PRIMARY KEY,
			password_hash TEXT NOT NULL,
			created_at    INTEGER NOT NULL DEFAULT 0
		);
	`)
	if err != nil {
		return fmt.Errorf("userauth: init schema: %w", err)
	}
	return nil
}

func (s *SQLiteStore) Close() error {
	if s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *SQLiteStore) Register(accountID, password string) error {
	id := normalize(accountID)
	if id == "" || password == "" {
		return ErrEmptyInput
	}
	var exists int
	if err := s.db.QueryRow(`SELECT 1 FROM users WHERE account_id = ?`, id).Scan(&exists); err == nil {
		return ErrUserExists
	} else if err != sql.ErrNoRows {
		return err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("userauth: hash: %w", err)
	}
	_, err = s.db.Exec(
		`INSERT INTO users (account_id, password_hash, created_at) VALUES (?, ?, ?)`,
		id, string(hash), time.Now().UnixNano())
	return err
}

func (s *SQLiteStore) Verify(accountID, password string) (string, error) {
	id := normalize(accountID)
	if id == "" || password == "" {
		return "", ErrInvalidCredential
	}
	var hash string
	switch err := s.db.QueryRow(`SELECT password_hash FROM users WHERE account_id = ?`, id).Scan(&hash); err {
	case nil:
		// continue
	case sql.ErrNoRows:
		// Run a dummy compare to keep timing roughly constant against an
		// unknown-account probe.
		_ = bcrypt.CompareHashAndPassword([]byte("$2a$10$0000000000000000000000000000000000000000000000000000"), []byte(password))
		return "", ErrInvalidCredential
	default:
		return "", err
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)); err != nil {
		return "", ErrInvalidCredential
	}
	return id, nil
}

func (s *SQLiteStore) HasUsers() (bool, error) {
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(1) FROM users`).Scan(&n); err != nil {
		return false, err
	}
	return n > 0, nil
}

// ---------------------------------------------------------------------------
// NullStore — in-memory backend for tests / degraded mode
// ---------------------------------------------------------------------------

type NullStore struct {
	users map[string]string // accountID → bcrypt hash
}

func NewNullStore() *NullStore {
	return &NullStore{users: make(map[string]string)}
}

func (n *NullStore) Register(accountID, password string) error {
	id := normalize(accountID)
	if id == "" || password == "" {
		return ErrEmptyInput
	}
	if _, ok := n.users[id]; ok {
		return ErrUserExists
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	n.users[id] = string(hash)
	return nil
}

func (n *NullStore) Verify(accountID, password string) (string, error) {
	id := normalize(accountID)
	hash, ok := n.users[id]
	if !ok {
		return "", ErrInvalidCredential
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)); err != nil {
		return "", ErrInvalidCredential
	}
	return id, nil
}

func (n *NullStore) HasUsers() (bool, error) { return len(n.users) > 0, nil }

func (n *NullStore) Close() error { return nil }
