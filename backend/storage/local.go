package storage

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"

	"vulos-office/backend/config"
	"vulos-office/backend/models"
)

type LocalStorage struct {
	dataDir string
}

func NewLocalStorage(cfg *config.Config) (*LocalStorage, error) {
	dir := cfg.Server.DataDir
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}
	return &LocalStorage{dataDir: dir}, nil
}

func (s *LocalStorage) filePath(id string) string {
	return filepath.Join(s.dataDir, id+".json")
}

func (s *LocalStorage) ListFiles() ([]*models.File, error) {
	entries, err := os.ReadDir(s.dataDir)
	if err != nil {
		return nil, err
	}

	var files []*models.File
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		id := entry.Name()[:len(entry.Name())-5]
		file, err := s.GetFile(id)
		if err != nil {
			continue
		}
		files = append(files, file)
	}

	sort.Slice(files, func(i, j int) bool {
		return files[i].UpdatedAt.After(files[j].UpdatedAt)
	})

	return files, nil
}

func (s *LocalStorage) GetFile(id string) (*models.File, error) {
	data, err := os.ReadFile(s.filePath(id))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("file not found")
		}
		return nil, err
	}

	var file models.File
	if err := json.Unmarshal(data, &file); err != nil {
		return nil, err
	}
	return &file, nil
}

func (s *LocalStorage) CreateFile(file *models.File) error {
	file.CreatedAt = time.Now()
	file.UpdatedAt = time.Now()

	data, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.filePath(file.ID), data, 0644)
}

func (s *LocalStorage) UpdateFile(file *models.File) error {
	existing, err := s.GetFile(file.ID)
	if err != nil {
		return err
	}
	file.CreatedAt = existing.CreatedAt
	file.UpdatedAt = time.Now()

	data, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.filePath(file.ID), data, 0644)
}

func (s *LocalStorage) DeleteFile(id string) error {
	if err := os.Remove(s.filePath(id)); err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("file not found")
		}
		return err
	}
	return nil
}
