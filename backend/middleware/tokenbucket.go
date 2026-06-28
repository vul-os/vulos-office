package middleware

// tokenbucket.go — token-bucket rate limiter for write and collaborative-edit
// endpoints.
//
// Unlike the fixed-window RateLimiter (used only on the low-volume password-
// change path), a token-bucket allows a short burst and then smoothly refills.
// This fits active editing sessions better: a user saving every few seconds
// is not penalised until the bucket runs dry, at which point saves are queued
// by returning 429 + Retry-After until tokens replenish.
//
// The implementation is intentionally dependency-free (only stdlib + gin).

import (
	"math"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// TokenBucket is a per-key token-bucket rate limiter.
//
//	cap  — bucket capacity (maximum burst size, in requests)
//	rate — refill rate in tokens per second
//
// State is kept in a mutex-guarded map. Keys are pruned opportunistically
// when they have been idle for longer than cap/rate (fully refilled and
// therefore equivalent to a brand-new bucket) to bound memory use.
type TokenBucket struct {
	mu      sync.Mutex
	buckets map[string]*tbEntry
	cap     float64
	rate    float64 // tokens / second
	keyFn   func(*gin.Context) string
}

type tbEntry struct {
	tokens float64
	last   time.Time
}

// NewTokenBucket builds a limiter with the given capacity and refill rate.
// Key defaults to the requesting client IP.
func NewTokenBucket(cap, rate float64) *TokenBucket {
	return &TokenBucket{
		buckets: make(map[string]*tbEntry),
		cap:     cap,
		rate:    rate,
		keyFn:   func(c *gin.Context) string { return c.ClientIP() },
	}
}

// Allow reports whether the next request from key is permitted.
// Returns (true, 0) when allowed; (false, retryAfter) when denied.
func (tb *TokenBucket) Allow(key string) (bool, time.Duration) {
	tb.mu.Lock()
	defer tb.mu.Unlock()

	now := time.Now()

	// Opportunistic prune: remove buckets that have been idle long enough to
	// be fully refilled — they would behave identically to a fresh bucket.
	refillSec := tb.cap / tb.rate
	for k, e := range tb.buckets {
		if now.Sub(e.last).Seconds() > refillSec {
			delete(tb.buckets, k)
		}
	}

	e, ok := tb.buckets[key]
	if !ok {
		// First request from this key: allocate a full bucket and consume one.
		tb.buckets[key] = &tbEntry{tokens: tb.cap - 1, last: now}
		return true, 0
	}

	// Refill proportionally to elapsed time, capped at capacity.
	elapsed := now.Sub(e.last).Seconds()
	e.tokens = math.Min(tb.cap, e.tokens+elapsed*tb.rate)
	e.last = now

	if e.tokens < 1 {
		// Time until one token is available.
		wait := time.Duration((1-e.tokens)/tb.rate*float64(time.Second)) + time.Millisecond
		return false, wait
	}
	e.tokens--
	return true, 0
}

// Middleware returns a gin HandlerFunc that enforces the token-bucket limit.
// Denied requests receive HTTP 429 with a Retry-After header indicating when
// the client may retry.
func (tb *TokenBucket) Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		ok, retryAfter := tb.Allow(tb.keyFn(c))
		if !ok {
			c.Header("Retry-After", strconv.Itoa(int(retryAfter.Seconds())+1))
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": "rate limit exceeded; please slow down",
			})
			return
		}
		c.Next()
	}
}
