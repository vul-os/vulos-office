package models

import "time"

type FileType string

const (
	FileTypeDoc   FileType = "doc"
	FileTypeSheet FileType = "sheet"
	FileTypeSlide FileType = "slide"
)

type File struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Type      FileType        `json:"type"`
	Content   interface{}     `json:"content"`
	CreatedAt time.Time       `json:"created_at"`
	UpdatedAt time.Time       `json:"updated_at"`
}

type CreateFileRequest struct {
	Name    string      `json:"name" binding:"required"`
	Type    FileType    `json:"type" binding:"required"`
	Content interface{} `json:"content"`
}

type UpdateFileRequest struct {
	Name    string      `json:"name"`
	Content interface{} `json:"content"`
}

type LoginRequest struct {
	Password string `json:"password" binding:"required"`
}

type LoginResponse struct {
	Token   string `json:"token"`
	Message string `json:"message"`
}

type ErrorResponse struct {
	Error           string `json:"error"`
	RemainingAttempts int  `json:"remaining_attempts,omitempty"`
	LockedUntil     string `json:"locked_until,omitempty"`
}

type AuthStatusResponse struct {
	Enabled       bool `json:"enabled"`
	Authenticated bool `json:"authenticated"`
}
