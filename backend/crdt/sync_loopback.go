package crdt

// sync_loopback.go — OFFICE-SYNC-01: in-memory SyncTransport + BlobStore.
//
// LoopbackSync is a single in-process rendezvous shared by N coordinators.
// It plays the role the central Tigris rendezvous (SYNC-RENDEZVOUS-01) and
// the fabric-P2P mesh (SYNC-P2P-01) will play in production, but without
// any dependency on those repos — the office sync side is testable today
// against this loopback and swaps to the real transports later by simply
// implementing the same SyncTransport interface.

import (
	"context"
	"sync"
)

// LoopbackSync is a concurrency-safe in-memory implementation of
// SyncTransport (op-log per session + a content-addressed blob map),
// shared by every coordinator that holds a reference to it.
type LoopbackSync struct {
	mu       sync.Mutex
	sessions map[string]*loopbackSession
	blobs    map[BlobHash][]byte
}

type loopbackSession struct {
	order []OpID        // insertion order for deterministic pulls
	ops   map[OpID]Op   // dedup by OpID
}

// NewLoopbackSync constructs an empty loopback rendezvous.
func NewLoopbackSync() *LoopbackSync {
	return &LoopbackSync{
		sessions: map[string]*loopbackSession{},
		blobs:    map[BlobHash][]byte{},
	}
}

func (l *LoopbackSync) session(id string) *loopbackSession {
	s, ok := l.sessions[id]
	if !ok {
		s = &loopbackSession{ops: map[OpID]Op{}}
		l.sessions[id] = s
	}
	return s
}

// PushDeltas stores ops for session, deduping by OpID (idempotent).
func (l *LoopbackSync) PushDeltas(_ context.Context, session string, ops []Op) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	s := l.session(session)
	for _, op := range ops {
		if _, ok := s.ops[op.ID]; ok {
			continue
		}
		s.ops[op.ID] = op
		s.order = append(s.order, op.ID)
	}
	return nil
}

// PullDeltas returns ops for session the caller hasn't observed per have.
func (l *LoopbackSync) PullDeltas(_ context.Context, session string, have VectorClock) ([]Op, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	s, ok := l.sessions[session]
	if !ok {
		return nil, nil
	}
	var out []Op
	for _, id := range s.order {
		if have != nil && have.Has(id) {
			continue
		}
		out = append(out, s.ops[id])
	}
	return out, nil
}

// PutBlob stores a content-addressed blob (idempotent).
func (l *LoopbackSync) PutBlob(_ context.Context, data []byte) (BlobHash, error) {
	h := HashBlob(data)
	l.mu.Lock()
	defer l.mu.Unlock()
	if _, ok := l.blobs[h]; !ok {
		cp := make([]byte, len(data))
		copy(cp, data)
		l.blobs[h] = cp
	}
	return h, nil
}

// HasBlob reports whether the loopback holds the blob.
func (l *LoopbackSync) HasBlob(_ context.Context, h BlobHash) (bool, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	_, ok := l.blobs[h]
	return ok, nil
}

// GetBlob fetches a blob by content address.
func (l *LoopbackSync) GetBlob(_ context.Context, h BlobHash) ([]byte, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	b, ok := l.blobs[h]
	if !ok {
		return nil, ErrBlobNotFound
	}
	cp := make([]byte, len(b))
	copy(cp, b)
	return cp, nil
}

// MemBlobStore is an in-memory BlobStore for tests + ephemeral sessions.
type MemBlobStore struct {
	mu    sync.Mutex
	blobs map[BlobHash][]byte
}

// NewMemBlobStore constructs an empty in-memory blob store.
func NewMemBlobStore() *MemBlobStore {
	return &MemBlobStore{blobs: map[BlobHash][]byte{}}
}

func (s *MemBlobStore) Put(_ context.Context, data []byte) (BlobHash, error) {
	h := HashBlob(data)
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.blobs[h]; !ok {
		cp := make([]byte, len(data))
		copy(cp, data)
		s.blobs[h] = cp
	}
	return h, nil
}

func (s *MemBlobStore) Has(_ context.Context, h BlobHash) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, ok := s.blobs[h]
	return ok, nil
}

func (s *MemBlobStore) Get(_ context.Context, h BlobHash) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, ok := s.blobs[h]
	if !ok {
		return nil, ErrBlobNotFound
	}
	cp := make([]byte, len(b))
	copy(cp, b)
	return cp, nil
}
