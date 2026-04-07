package storage

import (
	"vulos-office/backend/config"
	"vulos-office/backend/models"
)

type Storage interface {
	ListFiles() ([]*models.File, error)
	GetFile(id string) (*models.File, error)
	CreateFile(file *models.File) error
	UpdateFile(file *models.File) error
	DeleteFile(id string) error
}

func New(cfg *config.Config) (Storage, error) {
	switch cfg.Storage.Type {
	case "postgres":
		return NewPostgresStorage(cfg)
	default:
		return NewLocalStorage(cfg)
	}
}
