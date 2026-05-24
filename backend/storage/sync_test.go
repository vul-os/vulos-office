package storage_test

import (
	"context"
	"testing"

	"vulos-office/backend/crdt"
	"vulos-office/backend/storage"
)

// TestSyncModeDefaultUnaffected: the default (direct) mode does NOT build
// a coordinator — callers fall through to the unchanged endpoint-direct
// path. This is the OFFICE-STORE-01 behaviour and must be preserved.
func TestSyncModeDefaultUnaffected(t *testing.T) {
	doc := crdt.NewDoc(crdt.DocKindGrid, "s", "A")
	hub := crdt.NewLoopbackSync()

	// Zero value and explicit Direct both mean "no peer sync".
	for _, mode := range []storage.OfficeSyncMode{"", storage.OfficeSyncDirect} {
		if mode.PeerSyncEnabled() {
			t.Fatalf("mode %q must not enable peer sync", mode)
		}
		if c := storage.NewSyncCoordinator(mode, doc, hub, nil); c != nil {
			t.Fatalf("mode %q returned a coordinator, want nil (direct path untouched)", mode)
		}
	}
}

// TestSyncModeLocalMinioBuildsCoordinator: only local-minio-sync wires a
// coordinator, and that coordinator converges two docs through the
// loopback transport.
func TestSyncModeLocalMinioBuildsCoordinator(t *testing.T) {
	ctx := context.Background()
	hub := crdt.NewLoopbackSync()

	if !storage.OfficeSyncLocalMinio.PeerSyncEnabled() {
		t.Fatal("local-minio-sync must enable peer sync")
	}

	a := crdt.NewDoc(crdt.DocKindGrid, "s", "A")
	b := crdt.NewDoc(crdt.DocKindGrid, "s", "B")
	ca := storage.NewSyncCoordinator(storage.OfficeSyncLocalMinio, a, hub, nil)
	cb := storage.NewSyncCoordinator(storage.OfficeSyncLocalMinio, b, hub, nil)
	if ca == nil || cb == nil {
		t.Fatal("local-minio-sync returned nil coordinator")
	}

	id := a.NextOpID()
	if _, err := a.ApplyLocal(a.Grid().Set(crdt.CellKey{Row: 0, Col: 0}, "v", id), id); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if _, err := ca.PushPull(ctx); err != nil {
			t.Fatal(err)
		}
		if _, err := cb.PushPull(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if v, ok := b.Grid().Get(crdt.CellKey{Row: 0, Col: 0}); !ok || v != "v" {
		t.Fatalf("B did not converge: got (%q,%v)", v, ok)
	}
}

// TestSyncModeNilGuards: local-minio-sync with nil doc/transport returns
// nil rather than a half-wired coordinator.
func TestSyncModeNilGuards(t *testing.T) {
	hub := crdt.NewLoopbackSync()
	doc := crdt.NewDoc(crdt.DocKindGrid, "s", "A")
	if c := storage.NewSyncCoordinator(storage.OfficeSyncLocalMinio, nil, hub, nil); c != nil {
		t.Fatal("nil doc should yield nil coordinator")
	}
	if c := storage.NewSyncCoordinator(storage.OfficeSyncLocalMinio, doc, nil, nil); c != nil {
		t.Fatal("nil transport should yield nil coordinator")
	}
}
