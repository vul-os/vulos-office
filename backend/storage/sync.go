// sync.go — OFFICE-SYNC-01: storage-layer gate for office CRDT peer sync.
//
// The office storage backend has two sync modes:
//
//	OfficeSyncDirect (default) — the box talks to its endpoint-injected
//	  object store directly (central Tigris, or BYO MinIO). There is NO
//	  peer-to-peer convergence: this is the path wired by OFFICE-STORE-01
//	  and it is left completely unchanged by this task. NewSyncCoordinator
//	  returns (nil, nil) so callers fall through to the direct path.
//
//	OfficeSyncLocalMinio ("local-minio-sync", opt-in) — boxes in an org
//	  converge their CRDT docs + content-addressed blobs across each other
//	  via a pluggable crdt.SyncTransport. The two real transports — the
//	  central Tigris rendezvous (vulos-cloud SYNC-RENDEZVOUS-01) and direct
//	  fabric-P2P (vulos-relay SYNC-P2P-01) — live in other repos and are
//	  not built yet, so office is wired against the abstract interface and
//	  exercised against crdt.LoopbackSync in tests.
//
// No CGO; stdlib + the in-repo crdt package only.
package storage

import (
	"vulos-office/backend/crdt"
)

// OfficeSyncMode selects how an office box converges with the rest of its
// org. It is orthogonal to OfficeBEKind (which storage endpoint to use).
type OfficeSyncMode string

const (
	// OfficeSyncDirect is the default: object-store-direct, no peer sync.
	OfficeSyncDirect OfficeSyncMode = "direct"

	// OfficeSyncLocalMinio opts into CRDT peer sync across the org's boxes.
	OfficeSyncLocalMinio OfficeSyncMode = "local-minio-sync"
)

// PeerSyncEnabled reports whether the mode requires a sync coordinator.
func (m OfficeSyncMode) PeerSyncEnabled() bool {
	return m == OfficeSyncLocalMinio
}

// NewSyncCoordinator returns a CRDT sync coordinator for doc ONLY when
// mode is local-minio-sync. In the default direct mode it returns
// (nil, nil), so the caller keeps its unchanged endpoint-direct path.
//
// tr is the SyncTransport the org's boxes share; in production it is the
// cloud rendezvous or fabric-P2P adapter, in tests it is crdt.LoopbackSync.
// blobs is the local content-addressed store to hydrate (may be nil).
func NewSyncCoordinator(mode OfficeSyncMode, doc *crdt.Doc, tr crdt.SyncTransport, blobs crdt.BlobStore) *crdt.SyncCoordinator {
	if !mode.PeerSyncEnabled() {
		return nil // default path: object-store-direct, untouched.
	}
	if doc == nil || tr == nil {
		return nil
	}
	return crdt.NewSyncCoordinator(doc, tr, blobs)
}
