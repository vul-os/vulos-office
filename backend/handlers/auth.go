package handlers

import (
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"vulos-office/backend/config"
	"vulos-office/backend/middleware"
	"vulos-office/backend/models"
	"vulos-office/backend/userauth"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

type attemptRecord struct {
	count      int
	lockedUntil time.Time
}

type AuthHandler struct {
	cfg      *config.Config
	mu       sync.Mutex
	attempts map[string]*attemptRecord
	// creds is the per-user credential store. When it holds registered users,
	// login verifies against it and the JWT subject is bound to the
	// authenticated account (no longer self-asserted by the client).
	creds userauth.Store
}

// userAuthDBPath resolves the credential SQLite DSN from env.
func userAuthDBPath() string {
	if v := os.Getenv("VULOS_USERAUTH_DB"); v != "" {
		return v
	}
	return "./data/userauth.db"
}

func NewAuthHandler(cfg *config.Config) *AuthHandler {
	var creds userauth.Store
	if st, err := userauth.NewSQLiteStore(userAuthDBPath()); err == nil {
		creds = st
	} else {
		log.Printf("auth: per-user credential store unavailable (%v); falling back to in-memory store", err)
		creds = userauth.NewNullStore()
	}
	return &AuthHandler{
		cfg:      cfg,
		attempts: make(map[string]*attemptRecord),
		creds:    creds,
	}
}

// NewAuthHandlerWithCreds builds a handler over a caller-supplied credential
// store (tests use an in-memory NullStore).
func NewAuthHandlerWithCreds(cfg *config.Config, creds userauth.Store) *AuthHandler {
	return &AuthHandler{
		cfg:      cfg,
		attempts: make(map[string]*attemptRecord),
		creds:    creds,
	}
}

func (h *AuthHandler) Status(c *gin.Context) {
	authenticated := false
	if h.cfg.Auth.Enabled {
		token := c.GetHeader("Authorization")
		if len(token) > 7 {
			token = token[7:]
		}
		if token == "" {
			if cookie, err := c.Cookie("session"); err == nil {
				token = cookie
			}
		}
		if token != "" {
			if secret, serr := middleware.JWTSecret(); serr == nil {
				claims := &jwt.RegisteredClaims{}
				parsed, err := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (interface{}, error) {
					if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
						return nil, jwt.ErrTokenSignatureInvalid
					}
					return secret, nil
				})
				authenticated = err == nil && parsed.Valid
			}
		}
	} else {
		authenticated = true
	}

	c.JSON(http.StatusOK, models.AuthStatusResponse{
		Enabled:       h.cfg.Auth.Enabled,
		Authenticated: authenticated,
	})
}

func (h *AuthHandler) Login(c *gin.Context) {
	if !h.cfg.Auth.Enabled {
		c.JSON(http.StatusOK, models.LoginResponse{Message: "auth not required"})
		return
	}

	ip := c.ClientIP()

	h.mu.Lock()
	rec, ok := h.attempts[ip]
	if !ok {
		rec = &attemptRecord{}
		h.attempts[ip] = rec
	}

	// Check lockout
	if time.Now().Before(rec.lockedUntil) {
		h.mu.Unlock()
		c.JSON(http.StatusTooManyRequests, models.ErrorResponse{
			Error:       "account locked",
			LockedUntil: rec.lockedUntil.Format(time.RFC3339),
		})
		return
	}
	h.mu.Unlock()

	var req models.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "invalid request"})
		return
	}

	// Determine the verified subject for the JWT.
	//
	//   - If any per-user credentials are registered, login MUST authenticate
	//     against the credential store and the subject becomes the *canonical*
	//     account id returned by Verify — never the client-supplied AccountID.
	//   - Otherwise (no users registered) fall back to the legacy shared-password
	//     path for OSS single-user / local mode. In that mode the subject is the
	//     supplied AccountID (or "self"), which is acceptable because there is no
	//     multi-user store to protect.
	subject := req.AccountID
	authOK := false
	hasUsers := false
	if h.creds != nil {
		if hu, err := h.creds.HasUsers(); err == nil {
			hasUsers = hu
		}
	}
	if hasUsers {
		if canonical, err := h.creds.Verify(req.AccountID, req.Password); err == nil {
			subject = canonical
			authOK = true
		}
	} else {
		// Shared-password fallback (legacy single-user mode).
		authOK = req.Password == h.cfg.Auth.Password
		if subject == "" {
			subject = "self"
		}
	}

	if !authOK {
		h.mu.Lock()
		rec.count++
		remaining := h.cfg.Auth.MaxAttempts - rec.count
		if remaining <= 0 {
			rec.lockedUntil = time.Now().Add(time.Duration(h.cfg.Auth.LockoutMinutes) * time.Minute)
			rec.count = 0
			remaining = 0
		}
		h.mu.Unlock()

		status := http.StatusUnauthorized
		if remaining == 0 {
			status = http.StatusTooManyRequests
		}
		c.JSON(status, models.ErrorResponse{
			Error:             "incorrect password",
			RemainingAttempts: remaining,
		})
		return
	}

	// Success — reset attempts
	h.mu.Lock()
	rec.count = 0
	rec.lockedUntil = time.Time{}
	h.mu.Unlock()

	expiry := time.Duration(h.cfg.Auth.SessionHours) * time.Hour
	if expiry == 0 {
		expiry = 24 * time.Hour
	}

	secret, serr := middleware.JWTSecret()
	if serr != nil {
		c.JSON(http.StatusServiceUnavailable, models.ErrorResponse{Error: "server auth not configured"})
		return
	}

	claims := jwt.RegisteredClaims{
		// Subject carries the VERIFIED account id (from the credential store when
		// per-user auth is active, otherwise the shared-mode subject). Downstream
		// handlers read it from context instead of trusting any client header,
		// and it is no longer self-asserted when real credentials exist.
		Subject:   subject,
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(expiry)),
		IssuedAt:  jwt.NewNumericDate(time.Now()),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(secret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: "failed to create session"})
		return
	}

	http.SetCookie(c.Writer, &http.Cookie{
		Name:     "session",
		Value:    signed,
		MaxAge:   int(expiry.Seconds()),
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		// Secure should be true in production (HTTPS). Set via env/config if needed.
	})
	// Return only a success message — never expose the token in the response body
	// so JavaScript cannot read it.
	c.JSON(http.StatusOK, models.LoginResponse{Message: "logged in"})
}

// Register creates a per-user credential (account id + bcrypt password hash).
//
//	POST /api/auth/register  { "account_id": "alice@vulos.org", "password": "..." }
//
// After at least one user is registered, Login enforces per-user authentication
// and binds the JWT subject to the verified account (closing the self-asserted
// identity hole). Registration is unauthenticated so the first user can bootstrap;
// hardening (admin-gated registration / invite tokens) is FLAGGED as follow-up.
func (h *AuthHandler) Register(c *gin.Context) {
	if !h.cfg.Auth.Enabled {
		c.JSON(http.StatusOK, models.LoginResponse{Message: "auth not required"})
		return
	}
	if h.creds == nil {
		c.JSON(http.StatusServiceUnavailable, models.ErrorResponse{Error: "credential store unavailable"})
		return
	}
	var req models.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "invalid request"})
		return
	}
	if req.AccountID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "account_id required"})
		return
	}
	if len(req.Password) < 8 {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "password must be at least 8 characters"})
		return
	}
	switch err := h.creds.Register(req.AccountID, req.Password); err {
	case nil:
		c.JSON(http.StatusCreated, models.LoginResponse{Message: "registered"})
	case userauth.ErrUserExists:
		c.JSON(http.StatusConflict, models.ErrorResponse{Error: "account already registered"})
	default:
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: "failed to register"})
	}
}

func (h *AuthHandler) Logout(c *gin.Context) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     "session",
		Value:    "",
		MaxAge:   -1,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	c.JSON(http.StatusOK, gin.H{"message": "logged out"})
}
