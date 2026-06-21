// recordings.go — meeting recording upload + list + download + delete.
//
// Routes (registered in main.go):
//   POST   /api/meet/:roomId/recordings      — upload a webm recording blob (multipart)
//   GET    /api/meet/:roomId/recordings      — list recordings for this meeting room
//   GET    /api/meet/:roomId/recordings/:rid — download a recording
//   DELETE /api/meet/:roomId/recordings/:rid — delete (organizer/uploader only)

package handlers

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"

	"vulos-office/backend/billing"
	"vulos-office/backend/models"
	"vulos-office/backend/storage"

	"github.com/gin-gonic/gin"
)

const (
	maxRecordingBytes   = 500 << 20 // 500 MB
	localRecordingsDir  = "./data/recordings"
)

// RecordingHandler handles recording CRUD for meeting rooms.
type RecordingHandler struct {
	store storage.Storage
}

// NewRecordingHandler constructs a RecordingHandler backed by the given Storage.
func NewRecordingHandler(store storage.Storage) *RecordingHandler {
	return &RecordingHandler{store: store}
}

// newRecordingID generates a 22-char URL-safe base64 ID (16 random bytes).
func newRecordingID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// Upload handles POST /api/meet/:roomId/recordings
// Accepts multipart/form-data with a "recording" file field (webm).
//
// SECURITY: this is an authenticated, gated, metered storage write. It is
// mounted on the protected route group, derives the account from the VERIFIED
// identity (never c.ClientIP(), which is forgeable and attributed billing to a
// network address), gates on office access + storage quota, and meters the bytes
// written. Previously it was a public, ungated, unmetered 500 MB write hole.
func (h *RecordingHandler) Upload(c *gin.Context) {
	roomID := c.Param("roomId")

	// Verified identity — NOT c.ClientIP(). This is the bypass-proof account the
	// gate/meter run against.
	accountID := requesterID(c)

	// OFFICE ACCESS GATE: a suspended / office-disabled account may not upload.
	// Standalone → allow.
	if d := billing.GateOffice(c.Request.Context(), accountID); !d.Allowed() {
		c.JSON(d.Code, gin.H{"error": d.Reason})
		return
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxRecordingBytes)
	if err := c.Request.ParseMultipartForm(32 << 20); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "multipart parse failed: " + err.Error()})
		return
	}

	file, header, err := c.Request.FormFile("recording")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing 'recording' field: " + err.Error()})
		return
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "read upload: " + err.Error()})
		return
	}

	rid, err := newRecordingID()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "id generation failed"})
		return
	}

	fileName := header.Filename
	if fileName == "" {
		fileName = fmt.Sprintf("recording-%s.webm", rid)
	}

	// STORAGE GATE: atomically check AND reserve the quota for the recording
	// bytes BEFORE any write. Committed on success / released on any failure so
	// the quota is not consumed by a write that never lands. Standalone → no-op.
	d, res := billing.GateStorage(c.Request.Context(), accountID, int64(len(data)))
	if !d.Allowed() {
		c.JSON(d.Code, gin.H{"error": d.Reason})
		return
	}

	bucketKey := ""
	bs := SharedBucketStore()
	if storage.OrgBucketClient() != nil {
		if err := bs.PutObject(accountID, fileName, data, "video/webm"); err != nil {
			res.Release()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "bucket upload failed: " + err.Error()})
			return
		}
		bucketKey = storage.OrgScopedKey(accountID, fileName)
	} else {
		// OSS fallback — write blob to local filesystem.
		if err := os.MkdirAll(localRecordingsDir, 0755); err != nil {
			res.Release()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "local recordings dir: " + err.Error()})
			return
		}
		blobPath := filepath.Join(localRecordingsDir, rid+".webm")
		if err := os.WriteFile(blobPath, data, 0644); err != nil {
			res.Release()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "local write: " + err.Error()})
			return
		}
	}

	rec := &models.MeetingRecording{
		ID:        rid,
		MeetingID: roomID,
		RoomID:    roomID,
		AccountID: accountID,
		FileName:  fileName,
		SizeBytes: int64(len(data)),
		BucketKey: bucketKey,
	}

	if err := h.store.CreateRecording(rec); err != nil {
		res.Release()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "store recording: " + err.Error()})
		return
	}

	// METER: commit the reservation after a successful recording upload.
	res.Commit(c.Request.Context())

	c.JSON(http.StatusCreated, rec)
}

// List handles GET /api/meet/:roomId/recordings
func (h *RecordingHandler) List(c *gin.Context) {
	roomID := c.Param("roomId")
	recs, err := h.store.ListRecordings(roomID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if recs == nil {
		recs = []*models.MeetingRecording{}
	}
	c.JSON(http.StatusOK, recs)
}

// Download handles GET /api/meet/:roomId/recordings/:rid
func (h *RecordingHandler) Download(c *gin.Context) {
	roomID := c.Param("roomId")
	rid := c.Param("rid")

	rec, err := h.store.GetRecording(rid)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "recording not found"})
		return
	}
	if rec.RoomID != roomID {
		c.JSON(http.StatusNotFound, gin.H{"error": "recording not found"})
		return
	}

	c.Header("Content-Type", "video/webm")
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, rec.FileName))

	// Try bucket first.
	if storage.OrgBucketClient() != nil && rec.BucketKey != "" {
		bs := SharedBucketStore()
		data, err := bs.GetObject(rec.AccountID, rec.FileName)
		if err == nil && data != nil {
			c.Data(http.StatusOK, "video/webm", data)
			return
		}
	}

	// Fall back to local blob file.
	blobPath := filepath.Join(localRecordingsDir, rid+".webm")
	data, err := os.ReadFile(blobPath)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "recording blob not found"})
		return
	}
	c.Data(http.StatusOK, "video/webm", data)
}

// Delete handles DELETE /api/meet/:roomId/recordings/:rid (organizer or uploader only)
func (h *RecordingHandler) Delete(c *gin.Context) {
	roomID := c.Param("roomId")
	rid := c.Param("rid")
	callerID := c.GetString("userID")

	rec, err := h.store.GetRecording(rid)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "recording not found"})
		return
	}
	if rec.RoomID != roomID {
		c.JSON(http.StatusNotFound, gin.H{"error": "recording not found"})
		return
	}

	// Only the uploader or the meeting organizer may delete.
	if callerID != "" && rec.AccountID != callerID && rec.OrganizerID != callerID {
		c.JSON(http.StatusForbidden, gin.H{"error": "only the uploader or organizer may delete this recording"})
		return
	}

	// Remove from bucket if present.
	if storage.OrgBucketClient() != nil && rec.BucketKey != "" {
		_ = SharedBucketStore().DeleteObject(rec.AccountID, rec.FileName)
	}

	// Remove local fallback blob if present.
	blobPath := filepath.Join(localRecordingsDir, rid+".webm")
	_ = os.Remove(blobPath)

	if err := h.store.DeleteRecording(rid); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"ok": true})
}
