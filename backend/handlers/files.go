package handlers

import (
	"net/http"

	"vulos-office/backend/models"
	"vulos-office/backend/storage"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type FileHandler struct {
	store storage.Storage
	authz *FileAuthz
}

func NewFileHandler(store storage.Storage) *FileHandler {
	return &FileHandler{store: store, authz: SharedFileAuthz()}
}

// NewFileHandlerWithAuthz builds a handler over a caller-supplied authorizer
// (tests use an in-memory NullStore so they never touch disk).
func NewFileHandlerWithAuthz(store storage.Storage, authz *FileAuthz) *FileHandler {
	return &FileHandler{store: store, authz: authz}
}

func (h *FileHandler) List(c *gin.Context) {
	files, err := h.store.ListFiles()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// Return only the files the caller may access (owned + shared). Unowned/
	// legacy files (no recorded owner) remain visible so local/OSS mode and
	// pre-ACL documents keep working; admins see everything.
	out := make([]*models.File, 0, len(files))
	for _, f := range files {
		if h.authz.canAccess(c, f.ID) {
			out = append(out, f)
		}
	}
	c.JSON(http.StatusOK, out)
}

func (h *FileHandler) Get(c *gin.Context) {
	id := c.Param("id")
	if !h.authz.require(c, id) {
		return
	}
	file, err := h.store.GetFile(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
		return
	}
	c.JSON(http.StatusOK, file)
}

func (h *FileHandler) Create(c *gin.Context) {
	var req models.CreateFileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	file := &models.File{
		ID:      uuid.New().String(),
		Name:    req.Name,
		Type:    req.Type,
		Content: req.Content,
	}

	if err := h.store.CreateFile(file); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// Record the creating identity as owner so the file is private by default.
	h.authz.recordOwner(c, file.ID)
	c.JSON(http.StatusCreated, file)
}

func (h *FileHandler) Update(c *gin.Context) {
	id := c.Param("id")
	if !h.authz.require(c, id) {
		return
	}
	var req models.UpdateFileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	file := &models.File{
		ID:      id,
		Name:    req.Name,
		Content: req.Content,
	}

	if err := h.store.UpdateFile(file); err != nil {
		if err.Error() == "file not found" {
			c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	updated, _ := h.store.GetFile(file.ID)
	c.JSON(http.StatusOK, updated)
}

func (h *FileHandler) Delete(c *gin.Context) {
	id := c.Param("id")
	if !h.authz.require(c, id) {
		return
	}
	if err := h.store.DeleteFile(id); err != nil {
		if err.Error() == "file not found" {
			c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// Drop ACL state for the deleted file.
	_ = h.authz.Store().Delete(id)
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

// Share grants another account access to a file the caller owns (or admin).
// POST /api/files/:id/share  { "account_id": "...", "revoke": false }
func (h *FileHandler) Share(c *gin.Context) {
	id := c.Param("id")
	if !h.authz.require(c, id) {
		return
	}
	// Verify the file actually exists before recording a share.
	if _, err := h.store.GetFile(id); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
		return
	}
	var req struct {
		AccountID string `json:"account_id" binding:"required"`
		Revoke    bool   `json:"revoke"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var err error
	if req.Revoke {
		err = h.authz.Store().Unshare(id, req.AccountID)
	} else {
		err = h.authz.Store().Share(id, req.AccountID)
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
