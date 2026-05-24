package crdt

// sync.go — OFFICE-SYNC-01: a transport-agnostic sync coordinator that
// converges a session's CRDT op-log + content-addressed blobs across an
// org's boxes.
//
// The coordinator depends only on the abstract SyncTransport interface
// defined below. The two real transports — the central Tigris rendezvous
// (vulos-cloud SYNC-RENDEZVOUS-01) and direct fabric-P2P
// (vulos-relay SYNC-P2P-01) — live in OTHER repos and are not built yet,
// so this package never imports them. A LoopbackSync implementation is
// provided for tests + dev.
//
// Design:
//   - PushPull exchanges op-log deltas with the transport and applies any
//     remote ops through Doc.ApplyRemote, which is idempotent (re-syncing
//     the same deltas is a no-op). The existing CRDT merge is reused
//     verbatim — this file adds no new merge logic.
//   - Blobs are content-addressed (BlobHash = sha256 hex of the bytes).
//     Missing blobs are fetched by hash and stored in a BlobStore.

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"sync"
)

// BlobHash is the content address of a blob: lowercase hex of its
// SHA-256 digest. It is stable and self-verifying.
type BlobHash string

// HashBlob computes the content address of b.
func HashBlob(b []byte) BlobHash {
	sum := sha256.Sum256(b)
	return BlobHash(hex.EncodeToString(sum[:]))
}

// SyncTransport is the abstract delta+blob exchange channel the office
// sync coordinator drives. It is the contract the cloud rendezvous
// (SYNC-RENDEZVOUS-01) and fabric-P2P (SYNC-P2P-01) transports must
// implement; this package ships only an in-memory LoopbackSync for tests.
//
// All methods take a context and a session id so a single transport may
// multiplex several sessions. Implementations must be safe for concurrent
// use by one coordinator.
type SyncTransport interface {
	// PushDeltas advertises the local ops for session to the transport.
	// Implementations dedup by OpID; re-pushing the same ops is a no-op.
	PushDeltas(ctx context.Context, session string, ops []Op) error

	// PullDeltas returns ops the transport holds for session that the
	// caller has not yet observed, given the caller's vector clock. The
	// returned ops may be a superset (the caller's ApplyRemote dedups),
	// but implementations SHOULD honour `have` to minimise transfer.
	PullDeltas(ctx context.Context, session string, have VectorClock) ([]Op, error)

	// PutBlob stores a content-addressed blob, returning its hash. The
	// hash MUST equal HashBlob(data).
	PutBlob(ctx context.Context, data []byte) (BlobHash, error)

	// HasBlob reports whether the transport can serve the blob.
	HasBlob(ctx context.Context, h BlobHash) (bool, error)

	// GetBlob fetches a blob by content address. It returns ErrBlobNotFound
	// if the transport does not hold it.
	GetBlob(ctx context.Context, h BlobHash) ([]byte, error)
}

// ErrBlobNotFound is returned by SyncTransport.GetBlob / BlobStore.Get
// when a hash is unknown.
var ErrBlobNotFound = errors.New("crdt: blob not found")

// ErrBlobHashMismatch is returned when fetched bytes don't hash to the
// requested content address (integrity failure).
var ErrBlobHashMismatch = errors.New("crdt: blob hash mismatch")

// BlobStore is the local content-addressed store the coordinator hydrates
// from the transport. MemBlobStore implements it for tests; the office
// MinIO/Tigris backend implements it in backend/storage for production.
type BlobStore interface {
	Put(ctx context.Context, data []byte) (BlobHash, error)
	Has(ctx context.Context, h BlobHash) (bool, error)
	Get(ctx context.Context, h BlobHash) ([]byte, error)
}

// SyncCoordinator drives convergence for a single Doc over a
// SyncTransport. It is constructed only in local-minio-sync mode; the
// default (central Tigris direct) path never instantiates one, so it is
// completely unaffected.
type SyncCoordinator struct {
	doc    *Doc
	tr     SyncTransport
	blobs  BlobStore // local store to hydrate (optional)
	mu     sync.Mutex
	pushed map[OpID]struct{} // ops already advertised to the transport
}

// NewSyncCoordinator binds a coordinator to a Doc + transport. blobs may
// be nil if the doc carries no content-addressed attachments.
func NewSyncCoordinator(doc *Doc, tr SyncTransport, blobs BlobStore) *SyncCoordinator {
	return &SyncCoordinator{
		doc:    doc,
		tr:     tr,
		blobs:  blobs,
		pushed: map[OpID]struct{}{},
	}
}

// PushPull performs one convergence round: it advertises any local ops
// the transport hasn't seen, then pulls and merges remote ops. It is
// idempotent — running it repeatedly without new edits converges and then
// becomes a no-op because ApplyRemote dedups by OpID.
//
// Returns the number of remote ops newly applied in this round.
func (c *SyncCoordinator) PushPull(ctx context.Context) (int, error) {
	if c.tr == nil {
		return 0, errors.New("crdt: nil sync transport")
	}

	// 1. Push local deltas the transport hasn't been told about yet.
	c.mu.Lock()
	log := c.doc.Log()
	var toPush []Op
	for _, op := range log {
		if _, ok := c.pushed[op.ID]; !ok {
			toPush = append(toPush, op)
		}
	}
	c.mu.Unlock()

	if len(toPush) > 0 {
		if err := c.tr.PushDeltas(ctx, c.doc.SessionID(), toPush); err != nil {
			return 0, err
		}
		c.mu.Lock()
		for _, op := range toPush {
			c.pushed[op.ID] = struct{}{}
		}
		c.mu.Unlock()
	}

	// 2. Pull remote deltas and merge (idempotent).
	remote, err := c.tr.PullDeltas(ctx, c.doc.SessionID(), c.doc.VectorClock())
	if err != nil {
		return 0, err
	}
	applied := 0
	for _, op := range remote {
		before := len(c.doc.Log())
		if err := c.doc.ApplyRemote(op); err != nil {
			return applied, err
		}
		if len(c.doc.Log()) != before {
			applied++
		}
	}
	return applied, nil
}

// FetchBlob ensures the blob addressed by h is present in the local
// BlobStore, fetching it from the transport if missing. It verifies the
// content address on fetch (returns ErrBlobHashMismatch on tampering).
func (c *SyncCoordinator) FetchBlob(ctx context.Context, h BlobHash) ([]byte, error) {
	if c.blobs != nil {
		if ok, err := c.blobs.Has(ctx, h); err == nil && ok {
			return c.blobs.Get(ctx, h)
		}
	}
	data, err := c.tr.GetBlob(ctx, h)
	if err != nil {
		return nil, err
	}
	if HashBlob(data) != h {
		return nil, ErrBlobHashMismatch
	}
	if c.blobs != nil {
		if _, err := c.blobs.Put(ctx, data); err != nil {
			return nil, err
		}
	}
	return data, nil
}

// PushBlob stores a local blob to the BlobStore (if any) and advertises
// it to the transport. Returns the content address.
func (c *SyncCoordinator) PushBlob(ctx context.Context, data []byte) (BlobHash, error) {
	h := HashBlob(data)
	if c.blobs != nil {
		if _, err := c.blobs.Put(ctx, data); err != nil {
			return "", err
		}
	}
	th, err := c.tr.PutBlob(ctx, data)
	if err != nil {
		return "", err
	}
	if th != h {
		return "", ErrBlobHashMismatch
	}
	return h, nil
}

// VectorClock returns a copy of the doc's high-water-mark clock, used by
// PullDeltas to scope what the caller still needs.
func (d *Doc) VectorClock() VectorClock {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.vc.Clone()
}
