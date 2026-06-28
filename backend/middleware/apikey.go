package middleware

import (
	"net/http"
	"strings"

	"vulos-office/backend/apikey"
	"vulos-office/backend/config"

	"github.com/gin-gonic/gin"
)

// Context keys set by V1Auth in addition to the shared identity keys (CtxUserID,
// CtxIsAdmin, CtxAuthenticated) so /v1 handlers can introspect HOW the caller
// authenticated and WHICH scopes an API key carries.
const (
	// CtxAuthMethod is "session" or "apikey".
	CtxAuthMethod = "authMethod"
	// CtxScopes holds the []string scopes a vk_ key carries (empty for sessions).
	CtxScopes = "scopes"
)

// V1Auth authenticates a request to the public /v1 API, accepting EITHER:
//
//   - a Vulos API key — `Authorization: Bearer vk_…` — validated via the cloud
//     introspection seam (apikey.Introspector). The key must be valid and carry
//     the "office" product scope, OR
//   - the existing Office session — `Authorization: Bearer <jwt>` or the HttpOnly
//     "session" cookie, HS256-verified exactly like middleware.Auth.
//
// A vk_ key is only attempted when an introspector is wired (intro != nil, i.e.
// VULOS_CP_BASE_URL is configured). When it is NOT configured the key path is
// disabled and only session auth applies — self-host is unchanged.
//
// Unlike the SPA root gate, /v1 NEVER redirects: every failure is a JSON error
// body with the appropriate status (401/403/503).
//
// On success it sets CtxAuthenticated + CtxUserID (and CtxIsAdmin for an admin
// session) so the existing requesterID()/FileAuthz path works unchanged.
func V1Auth(cfg *config.Config, intro apikey.Introspector) gin.HandlerFunc {
	return func(c *gin.Context) {
		raw := bearerRaw(c)

		// ── API-key path ──────────────────────────────────────────────────────
		// Only when an introspector is configured AND the credential looks like a
		// Vulos API key. A vk_ token is never tried as a session JWT (and vice
		// versa), so the two schemes can't be confused.
		if intro != nil && strings.HasPrefix(raw, apikey.KeyPrefix) {
			res, err := intro.Introspect(c.Request.Context(), raw)
			if err != nil {
				// CP unreachable: fail closed rather than guess.
				c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"error": "API key validation unavailable"})
				return
			}
			if !res.Valid {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid API key"})
				return
			}
			if !res.HasProduct(apikey.ProductOffice) {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "API key not authorized for the office product"})
				return
			}
			c.Set(CtxAuthenticated, true)
			c.Set(CtxUserID, res.Account)
			c.Set(CtxScopes, res.Scopes)
			c.Set(CtxAuthMethod, "apikey")
			// API keys never carry the admin scope: a key acts only as its own
			// account, never as a tenant-wide admin.
			c.Next()
			return
		}

		// ── Session path ──────────────────────────────────────────────────────
		// Self-host single-user (auth disabled): allow; requesterID() falls back
		// to the local "self" identity and the caller is NOT an admin (parity with
		// the existing /api protected group).
		if !cfg.Auth.Enabled {
			c.Set(CtxAuthMethod, "session")
			c.Next()
			return
		}

		// Multi-tenant: verify the session token (Authorization bearer or the
		// HttpOnly "session" cookie) using the SAME HS256 validation as Auth().
		subject, isAdmin, ok := SessionIdentity(cfg, c.Request)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
			return
		}
		c.Set(CtxAuthenticated, true)
		c.Set(CtxUserID, subject)
		if isAdmin {
			c.Set(CtxIsAdmin, true)
		}
		c.Set(CtxAuthMethod, "session")
		c.Next()
	}
}

// bearerRaw returns the raw token from an `Authorization: Bearer <token>` header
// (no scheme, trimmed), or "" when absent.
func bearerRaw(c *gin.Context) string {
	if auth := c.GetHeader("Authorization"); strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
	}
	return ""
}
