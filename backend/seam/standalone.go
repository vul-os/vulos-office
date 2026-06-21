package seam

import (
	"context"
	"errors"

	"github.com/golang-jwt/jwt/v5"
)

// This file holds the STANDALONE DEFAULT implementations of the seam
// interfaces. They need NO cloud configuration and are the default wiring.

// ErrInvalidCredential is returned when a credential was presented but failed
// verification (bad signature, expired, wrong alg).
var ErrInvalidCredential = errors.New("invalid or expired session")

// ---- Identity (standalone) --------------------------------------------------

// SecretFunc returns the HS256 signing secret, or an error when no usable
// secret is configured (fail closed). It matches middleware.JWTSecret so the
// standalone identity validates exactly the tokens office's own login mints.
type SecretFunc func() ([]byte, error)

// AdminAudience is the JWT audience entry that conveys the admin scope. Mirrors
// middleware's "vulos:admin" contract.
const AdminAudience = "vulos:admin"

// LocalIdentity validates a locally-signed HS256 JWT against an office-managed
// signing secret. This is the standalone default: it requires no control plane.
//
//   - When enabled is false the service runs single-user; Authenticate always
//     returns a usable "self" identity (Authenticated=false) regardless of token.
//   - When enabled is true a presented token is verified (HMAC pinned to reject
//     alg-confusion); a missing token yields an unauthenticated "self" identity
//     so callers can decide whether to require auth, matching office's existing
//     middleware behaviour (which only rejects empty tokens at the route layer).
type LocalIdentity struct {
	secret  SecretFunc
	enabled bool
}

// NewLocalIdentity builds the standalone identity over a secret resolver.
func NewLocalIdentity(secret SecretFunc, enabled bool) *LocalIdentity {
	return &LocalIdentity{secret: secret, enabled: enabled}
}

// AuthEnabled reports whether authentication is enforced.
func (l *LocalIdentity) AuthEnabled() bool { return l.enabled }

// Authenticate verifies token and returns the caller identity.
func (l *LocalIdentity) Authenticate(_ context.Context, token string) (AccountIdentity, error) {
	if !l.enabled {
		// Single-user / local mode: no token needed, app stays usable.
		return AccountIdentity{AccountID: "self", Authenticated: false}, nil
	}
	if token == "" {
		// No credential presented. Not an error here — the route layer decides
		// whether anonymous access is allowed. Identity is the local "self".
		return AccountIdentity{AccountID: "self", Authenticated: false}, nil
	}

	secret, err := l.secret()
	if err != nil {
		return AccountIdentity{}, err
	}

	claims := &jwt.RegisteredClaims{}
	parsed, perr := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (interface{}, error) {
		// Pin to HMAC to reject alg-confusion attacks.
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, jwt.ErrTokenSignatureInvalid
		}
		return secret, nil
	})
	if perr != nil || !parsed.Valid {
		return AccountIdentity{}, ErrInvalidCredential
	}

	id := AccountIdentity{
		AccountID:     claims.Subject,
		Authenticated: true,
	}
	if id.AccountID == "" {
		// Verified session with no subject — shared local account.
		id.AccountID = "self"
	}
	for _, aud := range claims.Audience {
		if aud == AdminAudience {
			id.IsAdmin = true
			break
		}
	}
	return id, nil
}

// ---- Entitlements (standalone) ----------------------------------------------

// LocalEntitlements returns a permissive, unlimited entitlement for every
// account. This is the standalone default — self-hosters are not metered or
// tier-gated. Limits may optionally be tightened from local config, but default
// to unlimited.
type LocalEntitlements struct {
	// def is returned for every account. Zero/negative limits mean unlimited.
	def Entitlement
}

// NewLocalEntitlements builds permissive entitlements. Pass the zero Entitlement
// (or use DefaultEntitlement) for fully unlimited self-host behaviour.
func NewLocalEntitlements(def Entitlement) *LocalEntitlements {
	if def.Tier == "" {
		def.Tier = "self-hosted"
	}
	return &LocalEntitlements{def: def}
}

// DefaultEntitlement is the unlimited self-host entitlement.
func DefaultEntitlement() Entitlement {
	return Entitlement{Tier: "self-hosted"} // all numeric caps zero == unlimited
}

// For returns the configured default entitlement for any account.
func (e *LocalEntitlements) For(_ context.Context, _ string) (Entitlement, error) {
	return e.def, nil
}

// Allowed reports whether a feature is enabled. Standalone returns true for
// everything unless the operator explicitly disabled a feature in the default
// entitlement's Features map.
func (e *LocalEntitlements) Allowed(_ context.Context, _ string, feature string) bool {
	if e.def.Features == nil {
		return true
	}
	// If a Features map is provided, an explicit false disables the feature; an
	// absent key still defaults to allowed (additive, generous-by-default).
	if v, ok := e.def.Features[feature]; ok {
		return v
	}
	return true
}

// ---- Usage (standalone) -----------------------------------------------------

// NoopUsage discards all metering events. This is the standalone default — the
// office binary already exposes Prometheus metrics via /metrics, so per-account
// billing metering is not needed for self-host.
type NoopUsage struct{}

// NewNoopUsage builds a no-op usage reporter.
func NewNoopUsage() *NoopUsage { return &NoopUsage{} }

// Report discards the event.
func (NoopUsage) Report(context.Context, UsageEvent) {}

// ---- Provider (standalone) --------------------------------------------------

// NewStandaloneProvider wires the standalone defaults into a Provider. It needs
// only office's local JWT secret resolver and the auth-enabled flag — NO cloud
// configuration whatsoever.
func NewStandaloneProvider(secret SecretFunc, authEnabled bool) Provider {
	return Provider{
		Identity:     NewLocalIdentity(secret, authEnabled),
		Entitlements: NewLocalEntitlements(DefaultEntitlement()),
		Usage:        NewNoopUsage(),
	}
}
