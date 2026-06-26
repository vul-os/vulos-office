package handlers

import (
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"
)

// fakeSeamServer captures the request the BucketStore makes so we can assert the
// injected-credential path is honored end-to-end (header read → client build →
// prefixed object key).
type seamCapture struct {
	mu     sync.Mutex
	hits   int
	method string
	path   string
}

// testBrokerSecret is the broker secret used to authorize injected seam headers
// in tests; production reads it from VULOS_STORAGE_BROKER_SECRET.
const testBrokerSecret = "test-broker-secret"

func ctxWithSeamHeaders(endpoint, bucket, prefix string) *gin.Context {
	c := ctxWithSeamHeadersAuth(endpoint, bucket, prefix, testBrokerSecret)
	return c
}

// ctxWithSeamHeadersAuth builds a request carrying the injected seam headers with
// the given broker-auth value (pass "" to omit it, simulating a spoofed request).
func ctxWithSeamHeadersAuth(endpoint, bucket, prefix, brokerAuth string) *gin.Context {
	req := httptest.NewRequest(http.MethodPost, "/api/files", nil)
	req.Header.Set("X-Vulos-Storage-Endpoint", endpoint)
	req.Header.Set("X-Vulos-Storage-Bucket", bucket)
	req.Header.Set("X-Vulos-Storage-Prefix", prefix)
	req.Header.Set("X-Vulos-Storage-Region", "auto")
	req.Header.Set("X-Vulos-Storage-Access-Key", "AK")
	req.Header.Set("X-Vulos-Storage-Secret-Key", "SK")
	if brokerAuth != "" {
		req.Header.Set("X-Vulos-Storage-Broker-Auth", brokerAuth)
	}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = req
	return c
}

func newCapturingS3(t *testing.T, cap *seamCapture) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cap.mu.Lock()
		cap.hits++
		cap.method = r.Method
		cap.path = r.URL.Path
		cap.mu.Unlock()
		_, _ = io.Copy(io.Discard, r.Body)
		w.WriteHeader(http.StatusOK)
	}))
}

func TestBucketStore_SeamHeadersRouteToInjectedBucket(t *testing.T) {
	t.Setenv("VULOS_STORAGE_BROKER_SECRET", testBrokerSecret)
	cap := &seamCapture{}
	srv := newCapturingS3(t, cap)
	defer srv.Close()

	c := ctxWithSeamHeaders(srv.URL, "user-bucket", "users/alice")
	if err := SharedBucketStore().PutObject(c, "alice", "file/doc1", []byte("data"), "application/json"); err != nil {
		t.Fatalf("PutObject: %v", err)
	}

	cap.mu.Lock()
	defer cap.mu.Unlock()
	if cap.hits != 1 {
		t.Fatalf("expected 1 request to injected endpoint, got %d", cap.hits)
	}
	// OrgScopedKey flattens "file/doc1" to "file_doc1" (no VULOS_ORG_ID in test).
	want := "/user-bucket/users/alice/office/alice/file_doc1"
	if cap.path != want {
		t.Fatalf("object path = %q, want %q", cap.path, want)
	}
	if cap.method != http.MethodPut {
		t.Fatalf("method = %q, want PUT", cap.method)
	}
}

// TestBucketStore_SeamHeadersIgnoredWithoutBrokerAuth asserts the spoofing
// defense: a client that injects X-Vulos-Storage-* headers but does NOT present a
// valid X-Vulos-Storage-Broker-Auth is treated as standalone — the injected
// endpoint is never contacted, and (with no OrgBucketClient configured) the call
// is a silent no-op.
func TestBucketStore_SeamHeadersIgnoredWithoutBrokerAuth(t *testing.T) {
	t.Setenv("VULOS_STORAGE_BROKER_SECRET", testBrokerSecret)
	cap := &seamCapture{}
	srv := newCapturingS3(t, cap)
	defer srv.Close()

	// (a) broker-auth header entirely absent.
	cAbsent := ctxWithSeamHeadersAuth(srv.URL, "user-bucket", "users/mallory", "")
	if err := SharedBucketStore().PutObject(cAbsent, "mallory", "file/x", []byte("d"), "application/json"); err != nil {
		t.Fatalf("PutObject (no broker-auth): %v", err)
	}
	// (b) broker-auth header present but wrong.
	cWrong := ctxWithSeamHeadersAuth(srv.URL, "user-bucket", "users/mallory", "WRONG-SECRET")
	if err := SharedBucketStore().PutObject(cWrong, "mallory", "file/x", []byte("d"), "application/json"); err != nil {
		t.Fatalf("PutObject (wrong broker-auth): %v", err)
	}

	cap.mu.Lock()
	defer cap.mu.Unlock()
	if cap.hits != 0 {
		t.Fatalf("injected endpoint was contacted %d times without valid broker-auth; want 0", cap.hits)
	}
}

// TestBucketStore_SeamHeadersIgnoredWhenSecretUnset asserts that when the gate is
// disabled (VULOS_STORAGE_BROKER_SECRET unset — standalone deployment), injected
// headers are ignored even if a broker-auth header is presented.
func TestBucketStore_SeamHeadersIgnoredWhenSecretUnset(t *testing.T) {
	t.Setenv("VULOS_STORAGE_BROKER_SECRET", "")
	cap := &seamCapture{}
	srv := newCapturingS3(t, cap)
	defer srv.Close()

	c := ctxWithSeamHeadersAuth(srv.URL, "user-bucket", "users/mallory", testBrokerSecret)
	if err := SharedBucketStore().PutObject(c, "mallory", "file/x", []byte("d"), "application/json"); err != nil {
		t.Fatalf("PutObject: %v", err)
	}
	cap.mu.Lock()
	defer cap.mu.Unlock()
	if cap.hits != 0 {
		t.Fatalf("injected endpoint contacted %d times with gate disabled; want 0", cap.hits)
	}
}

func TestBucketStore_NoSeamHeadersIsNoOp(t *testing.T) {
	// No headers + no process-wide OrgBucketClient configured ⇒ silent no-op.
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/api/files", nil)

	if err := SharedBucketStore().PutObject(c, "bob", "file/doc2", []byte("x"), "application/json"); err != nil {
		t.Fatalf("expected no-op nil error, got %v", err)
	}
	if data, err := SharedBucketStore().GetObject(c, "bob", "file/doc2"); err != nil || data != nil {
		t.Fatalf("expected (nil,nil) no-op, got (%v,%v)", data, err)
	}
	if err := SharedBucketStore().DeleteObject(c, "bob", "file/doc2"); err != nil {
		t.Fatalf("expected no-op nil error, got %v", err)
	}
}
