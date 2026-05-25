package userauth_test

import (
	"path/filepath"
	"testing"

	"vulos-office/backend/userauth"
)

func runUserAuthContract(t *testing.T, s userauth.Store) {
	t.Helper()

	if has, _ := s.HasUsers(); has {
		t.Fatal("fresh store should have no users")
	}

	if err := s.Register("Alice@Vulos.org", "correct-horse"); err != nil {
		t.Fatalf("register: %v", err)
	}
	if has, _ := s.HasUsers(); !has {
		t.Fatal("store should report users after register")
	}

	// Duplicate (case-insensitive) is rejected.
	if err := s.Register("alice@vulos.org", "other"); err != userauth.ErrUserExists {
		t.Fatalf("duplicate register: expected ErrUserExists, got %v", err)
	}

	// Correct password verifies and normalizes the account id.
	id, err := s.Verify("alice@VULOS.org", "correct-horse")
	if err != nil {
		t.Fatalf("verify correct: %v", err)
	}
	if id != "alice@vulos.org" {
		t.Fatalf("canonical id should be normalized; got %q", id)
	}

	// Wrong password fails.
	if _, err := s.Verify("alice@vulos.org", "guess"); err != userauth.ErrInvalidCredential {
		t.Fatalf("verify wrong: expected ErrInvalidCredential, got %v", err)
	}

	// Unknown account fails (no existence distinction).
	if _, err := s.Verify("nobody@vulos.org", "whatever"); err != userauth.ErrInvalidCredential {
		t.Fatalf("verify unknown: expected ErrInvalidCredential, got %v", err)
	}

	// Empty input rejected on register.
	if err := s.Register("", "pw"); err != userauth.ErrEmptyInput {
		t.Fatalf("empty register: expected ErrEmptyInput, got %v", err)
	}
}

func TestSQLiteUserAuthContract(t *testing.T) {
	s, err := userauth.NewSQLiteStore(filepath.Join(t.TempDir(), "users.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer s.Close()
	runUserAuthContract(t, s)
}

func TestNullUserAuthContract(t *testing.T) {
	runUserAuthContract(t, userauth.NewNullStore())
}

// TestSQLiteUserAuthPersistsAcrossReopen proves credentials survive a restart.
func TestSQLiteUserAuthPersistsAcrossReopen(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "users.db")
	s1, err := userauth.NewSQLiteStore(dbPath)
	if err != nil {
		t.Fatalf("open1: %v", err)
	}
	if err := s1.Register("bob@vulos.org", "longpassword"); err != nil {
		t.Fatalf("register: %v", err)
	}
	_ = s1.Close()

	s2, err := userauth.NewSQLiteStore(dbPath)
	if err != nil {
		t.Fatalf("open2: %v", err)
	}
	defer s2.Close()
	if id, err := s2.Verify("bob@vulos.org", "longpassword"); err != nil || id != "bob@vulos.org" {
		t.Fatalf("credential did not survive restart: id=%q err=%v", id, err)
	}
}
