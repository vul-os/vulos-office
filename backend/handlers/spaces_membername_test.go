package handlers

import (
	"encoding/json"
	"net/http"
	"testing"

	"vulos-office/backend/middleware"
	"vulos-office/backend/models"

	"github.com/gin-gonic/gin"
)

// memberRouter wires the member-name-relevant routes with a verified identity,
// mirroring middleware.Auth (JWT subject → CtxUserID).
func memberRouter(h *SpacesHandlerExt, verifiedUser string) *gin.Engine {
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set(middleware.CtxAuthenticated, true)
		c.Set(middleware.CtxUserID, verifiedUser)
		c.Next()
	})
	r.POST("/spaces/channels", h.CreateChannel)
	r.GET("/spaces/channels/:channelId/members", h.ListMembers)
	r.PUT("/spaces/channels/:channelId/members/me/name", h.SetMyDisplayName)
	return r
}

// rosterNames fetches /members and returns account_id → display_name.
func rosterNames(t *testing.T, r *gin.Engine, channelID, asUser string) map[string]string {
	t.Helper()
	req, w := newRequest(http.MethodGet, "/spaces/channels/"+channelID+"/members", asUser, "", nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ListMembers: expected 200, got %d (%s)", w.Code, w.Body.String())
	}
	var members []models.Membership
	if err := json.Unmarshal(w.Body.Bytes(), &members); err != nil {
		t.Fatalf("decode members: %v", err)
	}
	out := map[string]string{}
	for _, m := range members {
		out[m.AccountID] = m.DisplayName
	}
	return out
}

// TestRosterShowsCapturedName is the headline NAME-CAPTURE-01 test: a member
// invited WITH a name shows that name in the roster (not the email fallback),
// while a member invited WITHOUT a name falls back to the account id/email.
func TestRosterShowsCapturedName(t *testing.T) {
	h := testHandler(t)
	r := memberRouter(h, "owner@x.com")

	// Invite "jane@x.com" with the name "Jane Doe" and "bob@x.com" with no name.
	create := models.CreateChannelRequest{
		Name:    "team",
		Type:    models.ChannelTypePrivate,
		Members: []string{"owner@x.com", "jane@x.com", "bob@x.com"},
		MemberNames: map[string]string{
			"jane@x.com": "Jane Doe",
		},
	}
	req, w := newRequest(http.MethodPost, "/spaces/channels", "owner@x.com", "", create)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateChannel: expected 201, got %d (%s)", w.Code, w.Body.String())
	}
	var ch models.Channel
	if err := json.Unmarshal(w.Body.Bytes(), &ch); err != nil {
		t.Fatalf("decode channel: %v", err)
	}

	names := rosterNames(t, r, ch.ID, "owner@x.com")

	// Named member: shows the captured name, NOT the email.
	if names["jane@x.com"] != "Jane Doe" {
		t.Errorf("named member roster: want 'Jane Doe', got %q", names["jane@x.com"])
	}
	// Unnamed member: email/account-id fallback applied by the handler.
	if names["bob@x.com"] != "bob@x.com" {
		t.Errorf("unnamed member fallback: want 'bob@x.com', got %q", names["bob@x.com"])
	}
}

// TestSetMyDisplayName covers the "your display name" profile control: a member
// sets their own name on first join and it surfaces in the roster.
func TestSetMyDisplayName(t *testing.T) {
	h := testHandler(t)
	r := memberRouter(h, "owner@x.com")

	create := models.CreateChannelRequest{
		Name:    "team",
		Type:    models.ChannelTypePrivate,
		Members: []string{"owner@x.com", "bob@x.com"},
	}
	req, w := newRequest(http.MethodPost, "/spaces/channels", "owner@x.com", "", create)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateChannel: expected 201, got %d (%s)", w.Code, w.Body.String())
	}
	var ch models.Channel
	_ = json.Unmarshal(w.Body.Bytes(), &ch)

	// Bob sets his own name (acting as bob@x.com).
	rb := memberRouter(h, "bob@x.com")
	req, w = newRequest(http.MethodPut, "/spaces/channels/"+ch.ID+"/members/me/name",
		"bob@x.com", "", models.SetDisplayNameRequest{DisplayName: "Bob Smith"})
	rb.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("SetMyDisplayName: expected 200, got %d (%s)", w.Code, w.Body.String())
	}

	names := rosterNames(t, r, ch.ID, "owner@x.com")
	if names["bob@x.com"] != "Bob Smith" {
		t.Errorf("after self-set: want 'Bob Smith', got %q", names["bob@x.com"])
	}
}

// TestSetMyDisplayNameNonMember confirms a non-member cannot set a name on a
// private channel (access is denied before the store is touched).
func TestSetMyDisplayNameNonMember(t *testing.T) {
	h := testHandler(t)
	r := memberRouter(h, "owner@x.com")

	create := models.CreateChannelRequest{
		Name:    "secret",
		Type:    models.ChannelTypePrivate,
		Members: []string{"owner@x.com"},
	}
	req, w := newRequest(http.MethodPost, "/spaces/channels", "owner@x.com", "", create)
	r.ServeHTTP(w, req)
	var ch models.Channel
	_ = json.Unmarshal(w.Body.Bytes(), &ch)

	rm := memberRouter(h, "mallory@x.com")
	req, w = newRequest(http.MethodPut, "/spaces/channels/"+ch.ID+"/members/me/name",
		"mallory@x.com", "", models.SetDisplayNameRequest{DisplayName: "Mallory"})
	rm.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("non-member SetMyDisplayName: want 403, got %d (%s)", w.Code, w.Body.String())
	}
}
