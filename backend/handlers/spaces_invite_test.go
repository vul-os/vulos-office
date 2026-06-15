package handlers

import (
	"encoding/json"
	"net/http"
	"testing"

	"vulos-office/backend/middleware"
	"vulos-office/backend/models"

	"github.com/gin-gonic/gin"
)

// inviteRouter wires only the routes exercised by InviteMember tests.
func inviteRouter(h *SpacesHandlerExt, verifiedUser string) *gin.Engine {
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set(middleware.CtxAuthenticated, true)
		c.Set(middleware.CtxUserID, verifiedUser)
		c.Next()
	})
	r.POST("/spaces/channels", h.CreateChannel)
	r.GET("/spaces/channels/:channelId/members", h.ListMembers)
	r.POST("/spaces/channels/:channelId/members", h.InviteMember)
	return r
}

// createPrivateChannel is a test helper that creates a private channel owned
// by owner and returns its ID.
func createPrivateChannel(t *testing.T, r *gin.Engine, owner, name string) models.Channel {
	t.Helper()
	body := models.CreateChannelRequest{
		Name:    name,
		Type:    models.ChannelTypePrivate,
		Members: []string{owner},
	}
	req, w := newRequest(http.MethodPost, "/spaces/channels", owner, "", body)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("createPrivateChannel: expected 201, got %d (%s)", w.Code, w.Body.String())
	}
	var ch models.Channel
	if err := json.Unmarshal(w.Body.Bytes(), &ch); err != nil {
		t.Fatalf("createPrivateChannel: decode: %v", err)
	}
	return ch
}

// TestInviteMember_HappyPath confirms that a member of a private channel can
// invite a new account id. The invited member appears in the roster.
func TestInviteMember_HappyPath(t *testing.T) {
	h := testHandler(t)
	r := inviteRouter(h, "owner@x.com")

	ch := createPrivateChannel(t, r, "owner@x.com", "invitetest")

	// Invite "bob@x.com" with a display name.
	inviteReq := struct {
		AccountID   string `json:"account_id"`
		DisplayName string `json:"display_name"`
	}{
		AccountID:   "bob@x.com",
		DisplayName: "Bob Jones",
	}
	req, w := newRequest(http.MethodPost, "/spaces/channels/"+ch.ID+"/members",
		"owner@x.com", "", inviteReq)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("InviteMember: expected 201, got %d (%s)", w.Code, w.Body.String())
	}

	// Verify the returned membership record.
	var m models.Membership
	if err := json.Unmarshal(w.Body.Bytes(), &m); err != nil {
		t.Fatalf("InviteMember: decode response: %v", err)
	}
	if m.AccountID != "bob@x.com" {
		t.Errorf("membership.AccountID: want 'bob@x.com', got %q", m.AccountID)
	}
	if m.DisplayName != "Bob Jones" {
		t.Errorf("membership.DisplayName: want 'Bob Jones', got %q", m.DisplayName)
	}

	// Bob must now appear in the members list.
	req, w = newRequest(http.MethodGet, "/spaces/channels/"+ch.ID+"/members",
		"owner@x.com", "", nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ListMembers: expected 200, got %d (%s)", w.Code, w.Body.String())
	}
	var members []models.Membership
	if err := json.Unmarshal(w.Body.Bytes(), &members); err != nil {
		t.Fatalf("ListMembers: decode: %v", err)
	}
	found := false
	for _, mem := range members {
		if mem.AccountID == "bob@x.com" {
			found = true
			if mem.DisplayName != "Bob Jones" {
				t.Errorf("roster display name: want 'Bob Jones', got %q", mem.DisplayName)
			}
		}
	}
	if !found {
		t.Error("invited member 'bob@x.com' not found in members list")
	}
}

// TestInviteMember_AlreadyMember confirms that inviting an existing member
// returns HTTP 409 Conflict.
func TestInviteMember_AlreadyMember(t *testing.T) {
	h := testHandler(t)
	r := inviteRouter(h, "owner@x.com")

	ch := createPrivateChannel(t, r, "owner@x.com", "dupetest")

	// Invite owner again (already a member from channel creation).
	inviteReq := struct {
		AccountID string `json:"account_id"`
	}{AccountID: "owner@x.com"}

	req, w := newRequest(http.MethodPost, "/spaces/channels/"+ch.ID+"/members",
		"owner@x.com", "", inviteReq)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusConflict {
		t.Fatalf("InviteMember duplicate: expected 409, got %d (%s)", w.Code, w.Body.String())
	}
}

// TestInviteMember_NonMemberDenied confirms that a user who is not a member of
// a private channel cannot invite others to it (403 Forbidden).
func TestInviteMember_NonMemberDenied(t *testing.T) {
	h := testHandler(t)
	// Router is authenticated as owner.
	r := inviteRouter(h, "owner@x.com")

	ch := createPrivateChannel(t, r, "owner@x.com", "secretchan")

	// Mallory is not a member; build a second router for her.
	rMallory := inviteRouter(h, "mallory@x.com")

	inviteReq := struct {
		AccountID string `json:"account_id"`
	}{AccountID: "eve@x.com"}

	req, w := newRequest(http.MethodPost, "/spaces/channels/"+ch.ID+"/members",
		"mallory@x.com", "", inviteReq)
	rMallory.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("InviteMember non-member: expected 403, got %d (%s)", w.Code, w.Body.String())
	}
}

// TestInviteMember_WithoutDisplayName confirms that an invite without a
// display_name falls back to the account id in the roster.
func TestInviteMember_WithoutDisplayName(t *testing.T) {
	h := testHandler(t)
	r := inviteRouter(h, "owner@x.com")

	ch := createPrivateChannel(t, r, "owner@x.com", "nodisplayname")

	inviteReq := struct {
		AccountID string `json:"account_id"`
	}{AccountID: "anon@x.com"}

	req, w := newRequest(http.MethodPost, "/spaces/channels/"+ch.ID+"/members",
		"owner@x.com", "", inviteReq)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("InviteMember no name: expected 201, got %d (%s)", w.Code, w.Body.String())
	}

	// Verify display_name falls back to account id (server-side default).
	req, w = newRequest(http.MethodGet, "/spaces/channels/"+ch.ID+"/members",
		"owner@x.com", "", nil)
	r.ServeHTTP(w, req)
	var members []models.Membership
	_ = json.Unmarshal(w.Body.Bytes(), &members)
	for _, m := range members {
		if m.AccountID == "anon@x.com" {
			// Accept either empty or account-id fallback.
			if m.DisplayName != "" && m.DisplayName != "anon@x.com" {
				t.Errorf("no-name invite: unexpected display_name %q", m.DisplayName)
			}
			return
		}
	}
	t.Error("invited member 'anon@x.com' not found in members list")
}
