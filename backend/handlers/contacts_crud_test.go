package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"vulos-office/backend/middleware"
	"vulos-office/backend/storage/contactstore"

	"github.com/gin-gonic/gin"
)

// contactsCRUDRouter wires the individual contact CRUD routes.
func contactsCRUDRouter(verifiedUser string, admin bool) *gin.Engine {
	h := NewContactsVCFHandler()
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set(middleware.CtxAuthenticated, true)
		c.Set(middleware.CtxUserID, verifiedUser)
		if admin {
			c.Set(middleware.CtxIsAdmin, true)
		}
		c.Next()
	})
	r.GET("/contacts", h.ListContacts)
	r.POST("/contacts", h.CreateContact)
	r.GET("/contacts/:uid", h.GetContact)
	r.PUT("/contacts/:uid", h.UpdateContact)
	r.DELETE("/contacts/:uid", h.DeleteContact)
	return r
}

func TestContactsCRUD_CreateGetUpdateDelete(t *testing.T) {
	// Reset store before test.
	contactstore.Default().Clear()

	r := contactsCRUDRouter("alice", false)

	// POST — create
	body := `{"display_name":"Alice Smith","emails":[{"label":"work","address":"alice@example.com"}]}`
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/contacts", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("POST /contacts: expected 201 got %d — %s", w.Code, w.Body.String())
	}
	var created map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &created)
	uid, _ := created["uid"].(string)
	if uid == "" {
		t.Fatal("expected uid in response")
	}

	// GET single
	w2 := httptest.NewRecorder()
	req2, _ := http.NewRequest(http.MethodGet, "/contacts/"+uid, nil)
	r.ServeHTTP(w2, req2)
	if w2.Code != http.StatusOK {
		t.Fatalf("GET /contacts/:uid: expected 200 got %d", w2.Code)
	}

	// GET list
	w3 := httptest.NewRecorder()
	req3, _ := http.NewRequest(http.MethodGet, "/contacts", nil)
	r.ServeHTTP(w3, req3)
	if w3.Code != http.StatusOK {
		t.Fatalf("GET /contacts: expected 200 got %d", w3.Code)
	}
	var list []interface{}
	json.Unmarshal(w3.Body.Bytes(), &list)
	if len(list) == 0 {
		t.Fatal("expected at least one contact in list")
	}

	// PUT — update
	updateBody := fmt.Sprintf(`{"uid":"%s","display_name":"Alice Updated","emails":[{"label":"home","address":"alice2@example.com"}]}`, uid)
	w4 := httptest.NewRecorder()
	req4, _ := http.NewRequest(http.MethodPut, "/contacts/"+uid, bytes.NewBufferString(updateBody))
	req4.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w4, req4)
	if w4.Code != http.StatusOK {
		t.Fatalf("PUT /contacts/:uid: expected 200 got %d — %s", w4.Code, w4.Body.String())
	}

	// DELETE
	w5 := httptest.NewRecorder()
	req5, _ := http.NewRequest(http.MethodDelete, "/contacts/"+uid, nil)
	r.ServeHTTP(w5, req5)
	if w5.Code != http.StatusNoContent {
		t.Fatalf("DELETE /contacts/:uid: expected 204 got %d", w5.Code)
	}

	// GET after delete should 404
	w6 := httptest.NewRecorder()
	req6, _ := http.NewRequest(http.MethodGet, "/contacts/"+uid, nil)
	r.ServeHTTP(w6, req6)
	if w6.Code != http.StatusNotFound {
		t.Fatalf("GET after DELETE: expected 404 got %d", w6.Code)
	}
}

func TestContactsCRUD_NonOwnerDenied(t *testing.T) {
	contactstore.Default().Clear()

	rAlice := contactsCRUDRouter("alice", false)
	rBob := contactsCRUDRouter("bob", false)

	// Alice creates a contact.
	body := `{"display_name":"Alice Private"}`
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/contacts", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rAlice.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("create: expected 201 got %d", w.Code)
	}
	var created map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &created)
	uid, _ := created["uid"].(string)

	// Bob tries to GET Alice's contact → 404.
	w2 := httptest.NewRecorder()
	req2, _ := http.NewRequest(http.MethodGet, "/contacts/"+uid, nil)
	rBob.ServeHTTP(w2, req2)
	if w2.Code != http.StatusNotFound {
		t.Fatalf("non-owner GET: expected 404 got %d", w2.Code)
	}

	// Bob tries to PUT → 404.
	w3 := httptest.NewRecorder()
	req3, _ := http.NewRequest(http.MethodPut, "/contacts/"+uid, bytes.NewBufferString(`{"display_name":"hacked"}`))
	req3.Header.Set("Content-Type", "application/json")
	rBob.ServeHTTP(w3, req3)
	if w3.Code != http.StatusNotFound {
		t.Fatalf("non-owner PUT: expected 404 got %d", w3.Code)
	}

	// Bob tries to DELETE → 404.
	w4 := httptest.NewRecorder()
	req4, _ := http.NewRequest(http.MethodDelete, "/contacts/"+uid, nil)
	rBob.ServeHTTP(w4, req4)
	if w4.Code != http.StatusNotFound {
		t.Fatalf("non-owner DELETE: expected 404 got %d", w4.Code)
	}
}

func TestContactsCRUD_ListIsolation(t *testing.T) {
	contactstore.Default().Clear()

	rAlice := contactsCRUDRouter("alice", false)
	rBob := contactsCRUDRouter("bob", false)

	// Alice creates a contact.
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/contacts",
		bytes.NewBufferString(`{"display_name":"Alice Contact"}`))
	req.Header.Set("Content-Type", "application/json")
	rAlice.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("create: expected 201 got %d", w.Code)
	}

	// Bob's list should be empty.
	w2 := httptest.NewRecorder()
	req2, _ := http.NewRequest(http.MethodGet, "/contacts", nil)
	rBob.ServeHTTP(w2, req2)
	if w2.Code != http.StatusOK {
		t.Fatalf("Bob list: expected 200 got %d", w2.Code)
	}
	var list []interface{}
	json.Unmarshal(w2.Body.Bytes(), &list)
	if len(list) != 0 {
		t.Fatalf("Bob should see 0 contacts, got %d", len(list))
	}

	// Alice's list should have 1.
	w3 := httptest.NewRecorder()
	req3, _ := http.NewRequest(http.MethodGet, "/contacts", nil)
	rAlice.ServeHTTP(w3, req3)
	var aliceList []interface{}
	json.Unmarshal(w3.Body.Bytes(), &aliceList)
	if len(aliceList) != 1 {
		t.Fatalf("Alice should see 1 contact, got %d", len(aliceList))
	}
}
