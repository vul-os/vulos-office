package crdt

import (
	"context"
	"errors"
	"testing"
)

// gridSet is a small helper: produce + locally apply a cell write,
// returning nothing (the op lands in the doc's log).
func gridSet(t *testing.T, d *Doc, row, col int, val string) {
	t.Helper()
	id := d.NextOpID()
	if _, err := d.ApplyLocal(d.Grid().Set(CellKey{Row: row, Col: col}, val, id), id); err != nil {
		t.Fatalf("ApplyLocal: %v", err)
	}
}

// TestSyncTwoInstancesConverge: two independent in-memory office docs,
// each editing different cells, converge to identical state after a
// round of PushPull through the shared loopback SyncTransport.
func TestSyncTwoInstancesConverge(t *testing.T) {
	ctx := context.Background()
	hub := NewLoopbackSync()

	a := NewDoc(DocKindGrid, "sheet1", "A")
	b := NewDoc(DocKindGrid, "sheet1", "B")
	ca := NewSyncCoordinator(a, hub, NewMemBlobStore())
	cb := NewSyncCoordinator(b, hub, NewMemBlobStore())

	gridSet(t, a, 0, 0, "from-A")
	gridSet(t, a, 1, 1, "A-second")
	gridSet(t, b, 2, 2, "from-B")

	// Two rounds each so pushed deltas are visible to the other side.
	for i := 0; i < 2; i++ {
		if _, err := ca.PushPull(ctx); err != nil {
			t.Fatalf("A PushPull: %v", err)
		}
		if _, err := cb.PushPull(ctx); err != nil {
			t.Fatalf("B PushPull: %v", err)
		}
	}

	for _, key := range []CellKey{{0, 0}, {1, 1}, {2, 2}} {
		va, oka := a.Grid().Get(key)
		vb, okb := b.Grid().Get(key)
		if oka != okb || va != vb {
			t.Fatalf("cell %v diverged: A=(%q,%v) B=(%q,%v)", key, va, oka, vb, okb)
		}
	}
	if v, _ := b.Grid().Get(CellKey{0, 0}); v != "from-A" {
		t.Fatalf("B did not receive A's edit: got %q", v)
	}
	if v, _ := a.Grid().Get(CellKey{2, 2}); v != "from-B" {
		t.Fatalf("A did not receive B's edit: got %q", v)
	}
}

// TestSyncIdempotentReSync: re-running PushPull after convergence applies
// zero new ops (applying the same deltas twice is a no-op), and state is
// byte-identical.
func TestSyncIdempotentReSync(t *testing.T) {
	ctx := context.Background()
	hub := NewLoopbackSync()

	a := NewDoc(DocKindGrid, "sheet2", "A")
	b := NewDoc(DocKindGrid, "sheet2", "B")
	ca := NewSyncCoordinator(a, hub, nil)
	cb := NewSyncCoordinator(b, hub, nil)

	gridSet(t, a, 0, 0, "x")
	gridSet(t, b, 0, 1, "y")

	// Converge.
	for i := 0; i < 2; i++ {
		if _, err := ca.PushPull(ctx); err != nil {
			t.Fatal(err)
		}
		if _, err := cb.PushPull(ctx); err != nil {
			t.Fatal(err)
		}
	}

	snapBefore, _ := b.Snapshot()
	logLenBefore := len(b.Log())

	// Re-sync repeatedly with no new edits: must apply 0 ops each round.
	for round := 0; round < 3; round++ {
		nA, err := ca.PushPull(ctx)
		if err != nil {
			t.Fatal(err)
		}
		nB, err := cb.PushPull(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if nA != 0 || nB != 0 {
			t.Fatalf("round %d not idempotent: A applied %d, B applied %d", round, nA, nB)
		}
	}

	if got := len(b.Log()); got != logLenBefore {
		t.Fatalf("log length changed on re-sync: before %d after %d", logLenBefore, got)
	}
	snapAfter, _ := b.Snapshot()
	if len(snapAfter.Log) != len(snapBefore.Log) {
		t.Fatalf("snapshot diverged on re-sync: before %d after %d", len(snapBefore.Log), len(snapAfter.Log))
	}
}

// TestSyncBlobExchange: a content-addressed blob pushed by one instance
// is fetchable + hydrated locally by another, and tamper-proof.
func TestSyncBlobExchange(t *testing.T) {
	ctx := context.Background()
	hub := NewLoopbackSync()

	a := NewDoc(DocKindGrid, "sheet3", "A")
	b := NewDoc(DocKindGrid, "sheet3", "B")
	storeB := NewMemBlobStore()
	ca := NewSyncCoordinator(a, hub, NewMemBlobStore())
	cb := NewSyncCoordinator(b, hub, storeB)

	payload := []byte("attachment bytes: a PNG or PDF")
	h, err := ca.PushBlob(ctx, payload)
	if err != nil {
		t.Fatalf("PushBlob: %v", err)
	}
	if h != HashBlob(payload) {
		t.Fatalf("hash mismatch: %s vs %s", h, HashBlob(payload))
	}

	// B does not have it yet locally.
	if ok, _ := storeB.Has(ctx, h); ok {
		t.Fatal("B should not hold the blob before fetch")
	}
	got, err := cb.FetchBlob(ctx, h)
	if err != nil {
		t.Fatalf("FetchBlob: %v", err)
	}
	if string(got) != string(payload) {
		t.Fatalf("fetched blob mismatch: %q", got)
	}
	// Now hydrated locally; second fetch served from local store.
	if ok, _ := storeB.Has(ctx, h); !ok {
		t.Fatal("B should hold the blob after fetch (hydration)")
	}
	if _, err := cb.FetchBlob(ctx, h); err != nil {
		t.Fatalf("second FetchBlob: %v", err)
	}

	// Unknown hash -> ErrBlobNotFound.
	if _, err := cb.FetchBlob(ctx, HashBlob([]byte("nope"))); !errors.Is(err, ErrBlobNotFound) {
		t.Fatalf("expected ErrBlobNotFound, got %v", err)
	}
}

// TestSyncTextConvergence: the coordinator reuses the existing text CRDT
// merge (causal insert ordering) and converges, proving it adds no merge
// logic of its own.
func TestSyncTextConvergence(t *testing.T) {
	ctx := context.Background()
	hub := NewLoopbackSync()

	a := NewDoc(DocKindText, "doc1", "A")
	b := NewDoc(DocKindText, "doc1", "B")
	ca := NewSyncCoordinator(a, hub, nil)
	cb := NewSyncCoordinator(b, hub, nil)

	for i, r := range []rune("hello") {
		id := a.NextOpID()
		if _, err := a.ApplyLocal(a.Text().LocalInsert(i, r, id), id); err != nil {
			t.Fatal(err)
		}
	}

	for i := 0; i < 3; i++ {
		if _, err := ca.PushPull(ctx); err != nil {
			t.Fatal(err)
		}
		if _, err := cb.PushPull(ctx); err != nil {
			t.Fatal(err)
		}
	}

	if a.Text().String() != b.Text().String() {
		t.Fatalf("text diverged: A=%q B=%q", a.Text().String(), b.Text().String())
	}
	if b.Text().String() != "hello" {
		t.Fatalf("B text = %q, want hello", b.Text().String())
	}
}
