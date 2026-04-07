package storage

import (
	"context"
	"encoding/json"
	"fmt"

	"vulos-office/backend/config"
	"vulos-office/backend/models"

	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgresStorage struct {
	pool *pgxpool.Pool
}

func NewPostgresStorage(cfg *config.Config) (*PostgresStorage, error) {
	pg := cfg.Storage.Postgres
	dsn := fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		pg.Host, pg.Port, pg.User, pg.Password, pg.Database, pg.SSLMode,
	)

	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		return nil, fmt.Errorf("connect to postgres: %w", err)
	}

	s := &PostgresStorage{pool: pool}
	if err := s.migrate(); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return s, nil
}

func (s *PostgresStorage) migrate() error {
	_, err := s.pool.Exec(context.Background(), `
		CREATE TABLE IF NOT EXISTS files (
			id          TEXT PRIMARY KEY,
			name        TEXT NOT NULL,
			type        TEXT NOT NULL,
			content     JSONB,
			created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`)
	return err
}

func (s *PostgresStorage) ListFiles() ([]*models.File, error) {
	rows, err := s.pool.Query(context.Background(),
		`SELECT id, name, type, content, created_at, updated_at FROM files ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var files []*models.File
	for rows.Next() {
		var f models.File
		var contentJSON []byte
		if err := rows.Scan(&f.ID, &f.Name, &f.Type, &contentJSON, &f.CreatedAt, &f.UpdatedAt); err != nil {
			return nil, err
		}
		if contentJSON != nil {
			if err := json.Unmarshal(contentJSON, &f.Content); err != nil {
				return nil, err
			}
		}
		files = append(files, &f)
	}
	return files, rows.Err()
}

func (s *PostgresStorage) GetFile(id string) (*models.File, error) {
	var f models.File
	var contentJSON []byte
	err := s.pool.QueryRow(context.Background(),
		`SELECT id, name, type, content, created_at, updated_at FROM files WHERE id=$1`, id,
	).Scan(&f.ID, &f.Name, &f.Type, &contentJSON, &f.CreatedAt, &f.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("file not found")
	}
	if contentJSON != nil {
		if err := json.Unmarshal(contentJSON, &f.Content); err != nil {
			return nil, err
		}
	}
	return &f, nil
}

func (s *PostgresStorage) CreateFile(f *models.File) error {
	contentJSON, err := json.Marshal(f.Content)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(context.Background(),
		`INSERT INTO files (id, name, type, content) VALUES ($1, $2, $3, $4)`,
		f.ID, f.Name, f.Type, contentJSON,
	)
	return err
}

func (s *PostgresStorage) UpdateFile(f *models.File) error {
	contentJSON, err := json.Marshal(f.Content)
	if err != nil {
		return err
	}
	cmd, err := s.pool.Exec(context.Background(),
		`UPDATE files SET name=$2, content=$3, updated_at=NOW() WHERE id=$1`,
		f.ID, f.Name, contentJSON,
	)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() == 0 {
		return fmt.Errorf("file not found")
	}
	return nil
}

func (s *PostgresStorage) DeleteFile(id string) error {
	cmd, err := s.pool.Exec(context.Background(), `DELETE FROM files WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() == 0 {
		return fmt.Errorf("file not found")
	}
	return nil
}
