package handlers

// file_authz.go — per-file authorization shared by every file-scoped handler
// (files, versions, activity, comments, suggestions, exports). This closes the
// P0 hole where Get/Update/Delete ignored the authenticated identity and List
// returned all files globally.
//
// It mirrors the Spaces authz pattern (requireChannelAccess / requireMessageAuthor
// in spaces.go): the verified identity comes from requesterID(c) (JWT sub), and a
// denied request returns 404 — NOT 403 — so the response never leaks whether a
// file the caller cannot see actually exists.

import (
	"net/http"
	"os"
	"sync"

	"vulos-office/backend/fileacl"
	"vulos-office/backend/middleware"

	"github.com/gin-gonic/gin"
)

// FileAuthz wraps a fileacl.Store and provides gin-aware access enforcement.
type FileAuthz struct {
	acl fileacl.Store
}

// fileACLDBPath resolves the ACL SQLite DSN from env, defaulting to a durable
// file alongside the Spaces DB.
func fileACLDBPath() string {
	if v := os.Getenv("VULOS_FILEACL_DB"); v != "" {
		return v
	}
	return "./data/fileacl.db"
}

var (
	defaultFileAuthz *FileAuthz
	fileAuthzOnce    sync.Once
)

// SharedFileAuthz returns a process-wide FileAuthz backed by durable SQLite.
// If the DB cannot be opened it falls back to an in-memory NullStore so the app
// still boots (degraded: ACLs do not persist) rather than crashing — matching
// the Spaces handler's NullPersister fallback.
func SharedFileAuthz() *FileAuthz {
	fileAuthzOnce.Do(func() {
		if st, err := fileacl.NewSQLiteStore(fileACLDBPath()); err == nil {
			defaultFileAuthz = &FileAuthz{acl: st}
		} else {
			defaultFileAuthz = &FileAuthz{acl: fileacl.NewNullStore()}
		}
	})
	return defaultFileAuthz
}

// NewFileAuthz builds a FileAuthz over a caller-supplied store (tests).
func NewFileAuthz(acl fileacl.Store) *FileAuthz {
	return &FileAuthz{acl: acl}
}

// Store exposes the underlying ACL store for owner-recording on file create
// and share management.
func (a *FileAuthz) Store() fileacl.Store { return a.acl }

// canAccess reports whether the caller may touch fileID. Admins always pass.
func (a *FileAuthz) canAccess(c *gin.Context, fileID string) bool {
	if a == nil || a.acl == nil {
		return true // no authorizer wired (degraded) — fail-open to avoid lockout
	}
	if c.GetBool(middleware.CtxIsAdmin) {
		return true
	}
	allowed, _, err := a.acl.CanAccess(fileID, requesterID(c))
	if err != nil {
		// On a storage error, fail closed for safety.
		return false
	}
	return allowed
}

// require enforces access on a file op. On denial it writes a 404 (no existence
// leak) and returns false. Callers should `return` immediately when it is false.
func (a *FileAuthz) require(c *gin.Context, fileID string) bool {
	if a.canAccess(c, fileID) {
		return true
	}
	c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
	return false
}

// recordOwner stamps the creating identity as the owner of a new file. Called
// from FileHandler.Create. Errors are swallowed (logged-equivalent) so a
// transient ACL-store failure never blocks document creation, but the common
// path records ownership so the document is private by default.
func (a *FileAuthz) recordOwner(c *gin.Context, fileID string) {
	if a == nil || a.acl == nil {
		return
	}
	_ = a.acl.SetOwner(fileID, requesterID(c))
}
