package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func init() { gin.SetMode(gin.TestMode) }

// tbRouter wires a token-bucket limiter over a simple GET /ping endpoint.
func tbRouter(cap, rate float64) *gin.Engine {
	tb := NewTokenBucket(cap, rate)
	r := gin.New()
	r.GET("/ping", tb.Middleware(), func(c *gin.Context) {
		c.Status(http.StatusOK)
	})
	return r
}

func tbGet(r *gin.Engine) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/ping", nil))
	return w
}

// TestTokenBucket_AllowsBurst verifies that a fresh bucket permits up to cap
// requests immediately without throttling.
func TestTokenBucket_AllowsBurst(t *testing.T) {
	r := tbRouter(5, 1)
	for i := 0; i < 5; i++ {
		if w := tbGet(r); w.Code != http.StatusOK {
			t.Fatalf("request %d within burst: expected 200, got %d", i+1, w.Code)
		}
	}
}

// TestTokenBucket_DeniesWhenExhausted verifies that requests beyond the burst
// capacity are rejected with 429.
func TestTokenBucket_DeniesWhenExhausted(t *testing.T) {
	// Very slow refill so the bucket stays empty during the test.
	r := tbRouter(3, 0.001)
	for i := 0; i < 3; i++ {
		tbGet(r) // consume burst
	}
	w := tbGet(r)
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("over-burst request: expected 429, got %d", w.Code)
	}
}

// TestTokenBucket_RetryAfterHeaderPresent verifies the Retry-After header is
// included on 429 responses so clients know when to retry.
func TestTokenBucket_RetryAfterHeaderPresent(t *testing.T) {
	r := tbRouter(1, 0.001) // near-frozen refill
	tbGet(r)                // consume the single token
	w := tbGet(r)
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d", w.Code)
	}
	if ra := w.Header().Get("Retry-After"); ra == "" {
		t.Fatal("expected Retry-After header on 429 response")
	}
}

// TestTokenBucket_RefillsOverTime verifies that after a bucket is exhausted,
// the refill mechanism allows subsequent requests once enough time has passed.
func TestTokenBucket_RefillsOverTime(t *testing.T) {
	// 1 token capacity, 200 tokens/second → full refill in ~5 ms.
	r := tbRouter(1, 200)
	tbGet(r) // consume the only token

	if w := tbGet(r); w.Code != http.StatusTooManyRequests {
		t.Fatalf("immediately after exhaust: expected 429, got %d", w.Code)
	}

	// Wait for one full token to refill (>= 5 ms at 200 tps).
	time.Sleep(15 * time.Millisecond)

	if w := tbGet(r); w.Code != http.StatusOK {
		t.Fatalf("after refill wait: expected 200, got %d", w.Code)
	}
}

// TestTokenBucket_Allow_KeyIsolation verifies that different keys have
// independent buckets — exhausting one key does not block another.
func TestTokenBucket_Allow_KeyIsolation(t *testing.T) {
	tb := NewTokenBucket(2, 0.001) // very slow refill, 2 burst
	// Exhaust key "alice".
	tb.Allow("alice")
	tb.Allow("alice")
	ok, _ := tb.Allow("alice")
	if ok {
		t.Fatal("alice should be rate-limited")
	}
	// "bob" has an independent bucket and must still be allowed.
	ok, _ = tb.Allow("bob")
	if !ok {
		t.Fatal("bob has an independent bucket and should not be affected")
	}
}

// TestTokenBucket_IdleBucketsArePruned verifies that fully-refilled (idle)
// buckets are removed so the map doesn't grow without bound.
func TestTokenBucket_IdleBucketsArePruned(t *testing.T) {
	// Very fast refill: cap=1, rate=1000 → full in 1 ms.
	tb := NewTokenBucket(1, 1000)
	tb.Allow("transient") // creates the entry

	// Wait long enough for the bucket to be fully refilled and eligible for pruning.
	time.Sleep(5 * time.Millisecond)

	// Trigger pruning via the next Allow call.
	tb.Allow("trigger-prune")

	tb.mu.Lock()
	defer tb.mu.Unlock()
	if _, exists := tb.buckets["transient"]; exists {
		t.Fatal("idle fully-refilled bucket should have been pruned")
	}
}
