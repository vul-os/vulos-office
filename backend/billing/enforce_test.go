package billing

import (
	"context"
	"sync"
	"testing"

	"vulos-office/backend/seam"
)

// stubEntitlements returns a fixed entitlement (and optional error) for every
// account, so tests can simulate each tier/cp posture.
type stubEntitlements struct {
	ent seam.Entitlement
	err error
}

func (s stubEntitlements) For(context.Context, string) (seam.Entitlement, error) {
	return s.ent, s.err
}
func (s stubEntitlements) Allowed(context.Context, string, string) bool { return true }

// recordingUsage captures reported events so tests can assert metering.
type recordingUsage struct {
	mu     sync.Mutex
	events []seam.UsageEvent
}

func (r *recordingUsage) Report(_ context.Context, ev seam.UsageEvent) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, ev)
}

func (r *recordingUsage) all() []seam.UsageEvent {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]seam.UsageEvent, len(r.events))
	copy(out, r.events)
	return out
}

// withProvider installs a provider for the duration of a test and resets the
// per-process storage counter so cases do not bleed into each other.
func withProvider(t *testing.T, ent seam.Entitlement, err error) *recordingUsage {
	t.Helper()
	usage := &recordingUsage{}
	Configure(seam.Provider{
		Entitlements: stubEntitlements{ent: ent, err: err},
		Usage:        usage,
	})
	storageMu.Lock()
	storageUsed = map[string]int64{}
	storageMu.Unlock()
	t.Cleanup(func() {
		Configure(seam.NewStandaloneProvider(func() ([]byte, error) { return nil, nil }, false))
		storageMu.Lock()
		storageUsed = map[string]int64{}
		storageMu.Unlock()
	})
	return usage
}

const acct = "alice@vulos.to"

// --- Standalone (unlimited): allow everything, meter only on real writes -----

func TestStandalone_AllowsEverything(t *testing.T) {
	usage := withProvider(t, seam.DefaultEntitlement(), nil)
	ctx := context.Background()

	if d := GateOffice(ctx, acct); !d.Allowed() {
		t.Fatalf("office should be enabled standalone, got %+v", d)
	}
	if d := GateStorage(ctx, acct, 5<<30); !d.Allowed() {
		t.Fatalf("storage should be unlimited standalone, got %+v", d)
	}
	if d := GateSeats(ctx, acct, 10_000); !d.Allowed() {
		t.Fatalf("seats should be unlimited standalone, got %+v", d)
	}

	// Metering is harmless: a no-op write (0 bytes) emits nothing; a real write
	// emits a single storage event but never blocks.
	MeterStorage(ctx, acct, 0)
	if got := len(usage.all()); got != 0 {
		t.Fatalf("0-byte write should meter nothing, got %d events", got)
	}
	MeterStorage(ctx, acct, 1024)
	if got := usage.all(); len(got) != 1 || got[0].Kind != seam.KindStorage || got[0].Value != 1024 {
		t.Fatalf("expected one storage event of 1024, got %+v", got)
	}
}

// --- Small cap: over-limit storage is rejected with 402 ----------------------

func TestStorageCap_RejectsOverLimit(t *testing.T) {
	withProvider(t, seam.Entitlement{MaxStorageBytes: 1000}, nil)
	ctx := context.Background()

	if d := GateStorage(ctx, acct, 600); !d.Allowed() {
		t.Fatalf("600 under 1000 cap should be allowed, got %+v", d)
	}
	MeterStorage(ctx, acct, 600) // now 600 used

	if d := GateStorage(ctx, acct, 600); d.Allowed() || d.Code != 402 {
		t.Fatalf("600+600 over 1000 cap should be 402, got %+v", d)
	}
	// A write that still fits is allowed.
	if d := GateStorage(ctx, acct, 400); !d.Allowed() {
		t.Fatalf("600+400 == cap should be allowed, got %+v", d)
	}
}

func TestSeatCap_RejectsWhenFull(t *testing.T) {
	withProvider(t, seam.Entitlement{MaxSeats: 3}, nil)
	ctx := context.Background()

	if d := GateSeats(ctx, acct, 2); !d.Allowed() {
		t.Fatalf("2 of 3 seats should allow one more, got %+v", d)
	}
	if d := GateSeats(ctx, acct, 3); d.Allowed() || d.Code != 402 {
		t.Fatalf("3 of 3 seats should be 402, got %+v", d)
	}
}

// --- Suspended blocks writes and invites with 402 ----------------------------

func TestSuspended_BlocksWritesAndSeats(t *testing.T) {
	withProvider(t, seam.Entitlement{Suspended: true}, nil)
	ctx := context.Background()

	if d := GateStorage(ctx, acct, 1); d.Code != 402 {
		t.Fatalf("suspended storage should be 402, got %+v", d)
	}
	if d := GateSeats(ctx, acct, 0); d.Code != 402 {
		t.Fatalf("suspended seats should be 402, got %+v", d)
	}
	if d := GateOffice(ctx, acct); d.Code != 403 {
		t.Fatalf("suspended office access should be 403, got %+v", d)
	}
}

// --- Office disabled → 403 ---------------------------------------------------

func TestOfficeDisabled_403(t *testing.T) {
	withProvider(t, seam.Entitlement{Features: map[string]bool{seam.FeatureOffice: false}}, nil)
	ctx := context.Background()

	if d := GateOffice(ctx, acct); d.Code != 403 {
		t.Fatalf("office-disabled should be 403, got %+v", d)
	}
	// Office enabled explicitly true is allowed.
	withProvider(t, seam.Entitlement{Features: map[string]bool{seam.FeatureOffice: true}}, nil)
	if d := GateOffice(ctx, acct); !d.Allowed() {
		t.Fatalf("office-enabled should allow, got %+v", d)
	}
}

// --- Fail-open: a cp error must never hard-down office ------------------------

func TestFailOpen_OnEntitlementError(t *testing.T) {
	withProvider(t, seam.Entitlement{Suspended: true, MaxStorageBytes: 1, MaxSeats: 1},
		context.DeadlineExceeded /* simulate cp unreachable */)
	ctx := context.Background()

	// Even though the (unused) stub entitlement is suspended/tiny, an error means
	// we fall back to the unlimited default and allow.
	if d := GateOffice(ctx, acct); !d.Allowed() {
		t.Fatalf("fail-open: office should allow on cp error, got %+v", d)
	}
	if d := GateStorage(ctx, acct, 1<<40); !d.Allowed() {
		t.Fatalf("fail-open: storage should allow on cp error, got %+v", d)
	}
	if d := GateSeats(ctx, acct, 1_000_000); !d.Allowed() {
		t.Fatalf("fail-open: seats should allow on cp error, got %+v", d)
	}
}
