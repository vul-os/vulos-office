package handlers

import (
	"encoding/json"
	"net/http"
	"testing"

	"vulos-office/backend/audit"
	"vulos-office/backend/fileacl"
	"vulos-office/backend/middleware"

	"github.com/gin-gonic/gin"
)

// decodeJSON unmarshals a JSON response body into v, failing the test on error.
func decodeJSON(t *testing.T, data []byte, v interface{}) {
	t.Helper()
	if err := json.Unmarshal(data, v); err != nil {
		t.Fatalf("decode JSON: %v (body: %s)", err, string(data))
	}
}

// v1Router mounts the /v1 document routes with a verified identity injected
// (mirrors fileRouter from files_authz_test.go).
func v1Router(h *V1Handler, user string, admin bool) *gin.Engine {
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set(middleware.CtxAuthenticated, true)
		c.Set(middleware.CtxUserID, user)
		if admin {
			c.Set(middleware.CtxIsAdmin, true)
		}
		c.Next()
	})
	r.GET("/v1/documents", h.ListDocuments)
	r.GET("/v1/documents/:id", h.GetDocument)
	r.POST("/v1/documents", h.CreateDocument)
	r.PATCH("/v1/documents/:id", h.PatchDocument)
	r.DELETE("/v1/documents/:id", h.DeleteDocument)
	r.GET("/v1/documents/:id/content", h.GetContent)
	r.POST("/v1/documents/:id/export", h.ExportDocument)
	r.GET("/v1/documents/:id/collaborators", h.ListCollaborators)
	r.POST("/v1/documents/:id/collaborators", h.ShareDocument)
	return r
}

func newV1Handler() (*V1Handler, *memStorage) {
	st := newMemStorage()
	acl := fileacl.NewNullStore()
	h := NewV1HandlerWithDeps(st, NewFileAuthz(acl), audit.NewNullStore())
	return h, st
}

// createV1DocAs creates a document via POST /v1/documents owned by user and
// returns its id.
func createV1DocAs(t *testing.T, h *V1Handler, user, typ string, content interface{}) string {
	t.Helper()
	r := v1Router(h, user, false)
	w := doReq(r, http.MethodPost, "/v1/documents", map[string]interface{}{
		"name": "My Doc", "type": typ, "content": content,
	})
	if w.Code != http.StatusCreated {
		t.Fatalf("create: expected 201, got %d (%s)", w.Code, w.Body.String())
	}
	var d v1Document
	decodeJSON(t, w.Body.Bytes(), &d)
	return d.ID
}

func TestV1_CreateAndGet(t *testing.T) {
	h, _ := newV1Handler()
	id := createV1DocAs(t, h, "alice", "doc", "hello")

	alice := v1Router(h, "alice", false)
	w := doReq(alice, http.MethodGet, "/v1/documents/"+id, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("get: expected 200, got %d (%s)", w.Code, w.Body.String())
	}
	var d v1Document
	decodeJSON(t, w.Body.Bytes(), &d)
	if d.Type != "doc" || d.Name != "My Doc" {
		t.Fatalf("unexpected metadata: %+v", d)
	}
}

func TestV1_NonOwnerGets404(t *testing.T) {
	h, _ := newV1Handler()
	id := createV1DocAs(t, h, "alice", "doc", "secret")

	bob := v1Router(h, "bob", false)
	if w := doReq(bob, http.MethodGet, "/v1/documents/"+id, nil); w.Code != http.StatusNotFound {
		t.Fatalf("non-owner get: expected 404, got %d", w.Code)
	}
	if w := doReq(bob, http.MethodPatch, "/v1/documents/"+id, map[string]string{"name": "x"}); w.Code != http.StatusNotFound {
		t.Fatalf("non-owner patch: expected 404, got %d", w.Code)
	}
	if w := doReq(bob, http.MethodDelete, "/v1/documents/"+id, nil); w.Code != http.StatusNotFound {
		t.Fatalf("non-owner delete: expected 404, got %d", w.Code)
	}
}

func TestV1_ListFiltersByTypeAndOwner(t *testing.T) {
	h, _ := newV1Handler()
	docID := createV1DocAs(t, h, "alice", "doc", "a")
	createV1DocAs(t, h, "alice", "sheet", map[string]interface{}{})
	createV1DocAs(t, h, "bob", "doc", "b")

	alice := v1Router(h, "alice", false)
	w := doReq(alice, http.MethodGet, "/v1/documents?type=doc", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("list: %d", w.Code)
	}
	var resp struct {
		Documents []v1Document `json:"documents"`
	}
	decodeJSON(t, w.Body.Bytes(), &resp)
	if len(resp.Documents) != 1 || resp.Documents[0].ID != docID {
		t.Fatalf("expected only alice's doc, got %+v", resp.Documents)
	}
}

func TestV1_PatchRenames(t *testing.T) {
	h, _ := newV1Handler()
	id := createV1DocAs(t, h, "alice", "doc", "a")

	alice := v1Router(h, "alice", false)
	w := doReq(alice, http.MethodPatch, "/v1/documents/"+id, map[string]string{"name": "Renamed"})
	if w.Code != http.StatusOK {
		t.Fatalf("patch: expected 200, got %d (%s)", w.Code, w.Body.String())
	}
	var d v1Document
	decodeJSON(t, w.Body.Bytes(), &d)
	if d.Name != "Renamed" {
		t.Fatalf("expected rename, got %q", d.Name)
	}
}

func TestV1_DeleteRemoves(t *testing.T) {
	h, _ := newV1Handler()
	id := createV1DocAs(t, h, "alice", "doc", "a")

	alice := v1Router(h, "alice", false)
	if w := doReq(alice, http.MethodDelete, "/v1/documents/"+id, nil); w.Code != http.StatusOK {
		t.Fatalf("delete: expected 200, got %d", w.Code)
	}
	if w := doReq(alice, http.MethodGet, "/v1/documents/"+id, nil); w.Code != http.StatusNotFound {
		t.Fatalf("get after delete: expected 404, got %d", w.Code)
	}
}

func TestV1_ContentJSON(t *testing.T) {
	h, _ := newV1Handler()
	id := createV1DocAs(t, h, "alice", "doc", "hello world")

	alice := v1Router(h, "alice", false)
	w := doReq(alice, http.MethodGet, "/v1/documents/"+id+"/content", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("content: expected 200, got %d (%s)", w.Code, w.Body.String())
	}
	var body struct {
		ID      string `json:"id"`
		Type    string `json:"type"`
		Content string `json:"content"`
	}
	decodeJSON(t, w.Body.Bytes(), &body)
	if body.Content != "hello world" {
		t.Fatalf("unexpected content: %+v", body)
	}
}

func TestV1_ExportDocPDF(t *testing.T) {
	h, _ := newV1Handler()
	id := createV1DocAs(t, h, "alice", "doc", "some text")

	alice := v1Router(h, "alice", false)
	// GET content?format=pdf
	w := doReq(alice, http.MethodGet, "/v1/documents/"+id+"/content?format=pdf", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("content pdf: expected 200, got %d (%s)", w.Code, w.Body.String())
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/pdf" {
		t.Fatalf("expected application/pdf, got %q", ct)
	}
	// POST export {format: docx}
	w = doReq(alice, http.MethodPost, "/v1/documents/"+id+"/export", map[string]string{"format": "docx"})
	if w.Code != http.StatusOK {
		t.Fatalf("export docx: expected 200, got %d (%s)", w.Code, w.Body.String())
	}
}

func TestV1_ExportUnsupportedFormat(t *testing.T) {
	h, _ := newV1Handler()
	id := createV1DocAs(t, h, "alice", "doc", "x")

	alice := v1Router(h, "alice", false)
	w := doReq(alice, http.MethodPost, "/v1/documents/"+id+"/export", map[string]string{"format": "xlsx"})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for doc→xlsx, got %d (%s)", w.Code, w.Body.String())
	}
}

func TestV1_Collaborators(t *testing.T) {
	h, _ := newV1Handler()
	id := createV1DocAs(t, h, "alice", "doc", "x")

	alice := v1Router(h, "alice", false)
	// Share with bob.
	w := doReq(alice, http.MethodPost, "/v1/documents/"+id+"/collaborators", map[string]interface{}{"account": "bob"})
	if w.Code != http.StatusOK {
		t.Fatalf("share: expected 200, got %d (%s)", w.Code, w.Body.String())
	}
	// Bob can now read it.
	bob := v1Router(h, "bob", false)
	if w := doReq(bob, http.MethodGet, "/v1/documents/"+id, nil); w.Code != http.StatusOK {
		t.Fatalf("bob get after share: expected 200, got %d", w.Code)
	}
	// Collaborators list shows bob.
	w = doReq(alice, http.MethodGet, "/v1/documents/"+id+"/collaborators", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("collaborators: %d", w.Code)
	}
	var cl struct {
		Owner         string   `json:"owner"`
		Collaborators []string `json:"collaborators"`
	}
	decodeJSON(t, w.Body.Bytes(), &cl)
	if len(cl.Collaborators) != 1 || cl.Collaborators[0] != "bob" {
		t.Fatalf("expected [bob], got %+v", cl)
	}
	// Revoke.
	w = doReq(alice, http.MethodPost, "/v1/documents/"+id+"/collaborators", map[string]interface{}{"account": "bob", "revoke": true})
	if w.Code != http.StatusOK {
		t.Fatalf("revoke: %d", w.Code)
	}
	if w := doReq(bob, http.MethodGet, "/v1/documents/"+id, nil); w.Code != http.StatusNotFound {
		t.Fatalf("bob get after revoke: expected 404, got %d", w.Code)
	}
}
