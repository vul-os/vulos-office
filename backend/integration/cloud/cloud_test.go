package cloud

import (
	"context"
	"testing"

	"vulos-office/backend/seam"
)

// With no cloud env set, the adapter must report disabled so the caller stays
// fully standalone.
func TestEnabled_DefaultOff(t *testing.T) {
	t.Setenv(EnvCPBaseURL, "")
	if Enabled() {
		t.Fatal("cloud adapter must be disabled when VULOS_CP_BASE_URL is unset")
	}
}

func TestEnabled_OnWhenBaseURLSet(t *testing.T) {
	t.Setenv(EnvCPBaseURL, "https://cp.example.com")
	if !Enabled() {
		t.Fatal("cloud adapter must be enabled when VULOS_CP_BASE_URL is set")
	}
	cfg := FromEnv()
	if cfg.BaseURL != "https://cp.example.com" {
		t.Fatalf("unexpected base url %q", cfg.BaseURL)
	}
}

// The cloud provider delegates identity to the supplied standalone identity and
// stamps the configured OrgID onto the result.
func TestOrgStampedIdentity(t *testing.T) {
	inner := seam.NewLocalIdentity(func() ([]byte, error) { return []byte("s"), nil }, false)
	p := NewProvider(Config{OrgID: "org-123"}, inner)

	id, err := p.Identity.Authenticate(context.Background(), "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if id.OrgID != "org-123" {
		t.Fatalf("expected org stamped, got %+v", id)
	}
	if id.AccountID != "self" {
		t.Fatalf("expected delegated self identity, got %+v", id)
	}
}
