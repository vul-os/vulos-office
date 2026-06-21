// Package billing enforces entitlements and emits usage through the integration
// seam, applying the "no-holes" rule to office's billable actions:
//
//   - GATED:    every billable action is checked against a freshly-fetched
//     entitlement BEFORE the action (server-side, before resource issuance).
//   - METERED:  every successful billable action is reported via the Usage seam.
//   - BYPASS-PROOF: the gate runs on the server using the verified account id,
//     never a client-supplied value, and before any resource is issued.
//
// CRITICAL: enforcement must be a NO-OP in standalone mode. The standalone seam
// returns an unlimited, never-suspended entitlement, so:
//
//   - a 0/negative cap means "unlimited" → allow;
//   - Suspended is always false → never block;
//   - features["office"] is absent → office enabled.
//
// This package imports ONLY backend/seam (the interface), never the optional
// backend/integration/cloud adapter, preserving the core's independence: office
// stays self-hostable with zero cloud configuration and the cloud package can be
// deleted without breaking this enforcement layer.
package billing

import (
	"context"
	"sync"

	"vulos-office/backend/seam"
)

// provider is the process-wide seam provider wired by main.go. Until Configure
// is called it is the unlimited standalone default, so any handler that runs
// before wiring (e.g. a test) behaves as a no-op rather than panicking.
var (
	mu       sync.RWMutex
	provider = seam.NewStandaloneProvider(func() ([]byte, error) { return nil, nil }, false)

	// storageUsed tracks bytes this process has admitted per account. The
	// control plane is authoritative for true cross-process usage (via reported
	// Usage events), but a local running total makes the storage cap enforceable
	// before each write without an expensive full-store scan. It only matters
	// when a finite cap is configured (cloud); in standalone the cap is 0 and the
	// counter is never consulted for a decision.
	storageUsed = map[string]int64{}
	storageMu   sync.Mutex
)

// Configure installs the active seam provider. Called once from main.go after
// the standalone/cloud selection. Safe to call in tests to inject a stub.
func Configure(p seam.Provider) {
	mu.Lock()
	defer mu.Unlock()
	provider = p
}

// current returns the active provider under a read lock.
func current() seam.Provider {
	mu.RLock()
	defer mu.RUnlock()
	return provider
}

// Decision is the outcome of a gate check. Code == 0 means allowed.
type Decision struct {
	Code   int    // HTTP status to return when not allowed (402/403); 0 = allow
	Reason string // human-readable reason for the rejection
}

// Allowed reports whether the action may proceed.
func (d Decision) Allowed() bool { return d.Code == 0 }

var allow = Decision{}

// entitlementFor fetches a FRESH entitlement for accountID. It FAILS OPEN: if
// the resolver errors (e.g. the control plane is unreachable), we return the
// unlimited self-host default so a cp blip never hard-downs office. A cp that
// DOES answer with suspended/over-limit is still enforced by the callers below.
func entitlementFor(ctx context.Context, accountID string) seam.Entitlement {
	ent, err := current().Entitlements.For(ctx, accountID)
	if err != nil {
		return seam.DefaultEntitlement() // fail-open: unlimited, not suspended
	}
	return ent
}

// GateOffice gates access to the office product itself. Returns a 403 Decision
// when the entitlement explicitly disables the "office" feature OR the account
// is suspended. Unlimited/standalone → allow (the standalone entitlement has no
// "office" key and is never suspended).
func GateOffice(ctx context.Context, accountID string) Decision {
	ent := entitlementFor(ctx, accountID)
	if ent.Suspended {
		return Decision{Code: 403, Reason: "account suspended"}
	}
	if ent.Features != nil {
		if v, ok := ent.Features[seam.FeatureOffice]; ok && !v {
			return Decision{Code: 403, Reason: "office not enabled for this tier"}
		}
	}
	return allow
}

// GateStorage gates a storage write of newBytes for accountID. It returns a 402
// Decision when the account is suspended, or when the configured storage cap is
// finite and the account's current usage + newBytes would exceed it. A cap of
// <=0 (unlimited / standalone) always allows.
//
// Call BEFORE issuing the write/presigned-PUT. On a successful write, call
// MeterStorage so the running total and the cp stay in sync.
func GateStorage(ctx context.Context, accountID string, newBytes int64) Decision {
	ent := entitlementFor(ctx, accountID)
	if ent.Suspended {
		return Decision{Code: 402, Reason: "account suspended"}
	}
	if ent.MaxStorageBytes <= 0 { // unlimited
		return allow
	}
	storageMu.Lock()
	used := storageUsed[accountID]
	storageMu.Unlock()
	if used+newBytes > ent.MaxStorageBytes {
		return Decision{Code: 402, Reason: "storage quota exceeded"}
	}
	return allow
}

// MeterStorage records a successful storage write of n bytes: it advances the
// local running total and reports a storage Usage event through the seam.
func MeterStorage(ctx context.Context, accountID string, n int64) {
	if n <= 0 {
		return
	}
	storageMu.Lock()
	storageUsed[accountID] += n
	storageMu.Unlock()
	current().Usage.Report(ctx, seam.UsageEvent{
		AccountID: accountID,
		Kind:      seam.KindStorage,
		Value:     n,
	})
}

// GateSeats gates admitting one more member/seat for accountID given the count
// of seats already in use. Returns a 402 Decision when suspended, or when the
// configured seat cap is finite and currentSeats is already at/over it. A cap of
// <=0 (unlimited / standalone) always allows.
//
// Call BEFORE minting an invite / admitting a member. On a successful add, call
// MeterSeats.
func GateSeats(ctx context.Context, accountID string, currentSeats int64) Decision {
	ent := entitlementFor(ctx, accountID)
	if ent.Suspended {
		return Decision{Code: 402, Reason: "account suspended"}
	}
	if ent.MaxSeats <= 0 { // unlimited
		return allow
	}
	if currentSeats >= ent.MaxSeats {
		return Decision{Code: 402, Reason: "seat limit reached"}
	}
	return allow
}

// MeterSeats reports a seats Usage event for one added member/seat.
func MeterSeats(ctx context.Context, accountID string) {
	current().Usage.Report(ctx, seam.UsageEvent{
		AccountID: accountID,
		Kind:      seam.KindSeats,
		Value:     1,
	})
}
