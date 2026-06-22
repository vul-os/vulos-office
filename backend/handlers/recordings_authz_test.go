package handlers

// recordings_authz_test.go — regression tests for the unauthenticated recording
// read/enumeration hole. List + Download were previously mounted on the PUBLIC
// api group and only checked RoomID, so anyone who guessed a roomId could
// enumerate and download every recording. They are now on the protected group
// AND membership-checked (organizer / invitee / uploader / admin).

import (
	"net/http"
	"testing"

	"vulos-office/backend/middleware"
	"vulos-office/backend/models"

	"github.com/gin-gonic/gin"
)

// recRouter wires the recording List/Download/Delete routes with an optional
// verified identity. verifiedUser=="" simulates an UNAUTHENTICATED caller (no
// CtxUserID / CtxAuthenticated set) — the same context the handler sees if the
// protected middleware were bypassed.
func recRouter(h *RecordingHandler, verifiedUser string, authenticated, admin bool) *gin.Engine {
	r := gin.New()
	r.Use(func(c *gin.Context) {
		if authenticated {
			c.Set(middleware.CtxAuthenticated, true)
		}
		if verifiedUser != "" {
			c.Set(middleware.CtxUserID, verifiedUser)
		}
		if admin {
			c.Set(middleware.CtxIsAdmin, true)
		}
		c.Next()
	})
	r.GET("/meet/:roomId/recordings", h.List)
	r.GET("/meet/:roomId/recordings/:rid", h.Download)
	return r
}

func seedRecording(store *memStorage) (roomID, rid string) {
	roomID = "room-1"
	store.meetings[roomID] = &models.Meeting{
		ID:          roomID,
		OrganizerID: "alice",
		Invitees:    []string{"bob"},
	}
	rid = "rec-1"
	store.recordings[rid] = &models.MeetingRecording{
		ID:        rid,
		RoomID:    roomID,
		AccountID: "alice",
		FileName:  "rec.webm",
	}
	return roomID, rid
}

// An UNAUTHENTICATED caller (no verified identity) is denied List + Download.
func TestRecordings_Unauthenticated_Denied(t *testing.T) {
	store := newMemStorage()
	h := NewRecordingHandler(store)
	roomID, rid := seedRecording(store)

	r := recRouter(h, "", false, false)

	if w := doReq(r, http.MethodGet, "/meet/"+roomID+"/recordings", nil); w.Code == http.StatusOK {
		t.Fatalf("VULN: unauthenticated List returned 200 (%s)", w.Body.String())
	}
	if w := doReq(r, http.MethodGet, "/meet/"+roomID+"/recordings/"+rid, nil); w.Code == http.StatusOK {
		t.Fatalf("VULN: unauthenticated Download returned 200 (%s)", w.Body.String())
	}
}

// A NON-MEMBER authenticated user (not organizer/invitee/uploader) is denied.
func TestRecordings_NonMember_Denied(t *testing.T) {
	store := newMemStorage()
	h := NewRecordingHandler(store)
	roomID, rid := seedRecording(store)

	mallory := recRouter(h, "mallory", true, false)

	if w := doReq(mallory, http.MethodGet, "/meet/"+roomID+"/recordings", nil); w.Code == http.StatusOK {
		t.Fatalf("VULN: non-member List returned 200 (%s)", w.Body.String())
	}
	if w := doReq(mallory, http.MethodGet, "/meet/"+roomID+"/recordings/"+rid, nil); w.Code == http.StatusOK {
		t.Fatalf("VULN: non-member Download returned 200 (%s)", w.Body.String())
	}
}

// A forged X-Account-ID header must NOT promote a non-member (identity comes
// from the verified context, never the header, for non-admins).
func TestRecordings_ForgedHeader_Denied(t *testing.T) {
	store := newMemStorage()
	h := NewRecordingHandler(store)
	roomID, _ := seedRecording(store)

	mallory := recRouter(h, "mallory", true, false)
	req := newReqWithHeader(http.MethodGet, "/meet/"+roomID+"/recordings", "alice")
	w := newRecorder()
	mallory.ServeHTTP(w, req)
	if w.Code == http.StatusOK {
		t.Fatalf("VULN: forged X-Account-ID promoted a non-member to member (%d)", w.Code)
	}
}

// The organizer and an invitee CAN list; this proves the deny above was authz,
// not a broken handler.
func TestRecordings_MemberAllowed(t *testing.T) {
	store := newMemStorage()
	h := NewRecordingHandler(store)
	roomID, _ := seedRecording(store)

	for _, member := range []string{"alice", "bob"} {
		r := recRouter(h, member, true, false)
		if w := doReq(r, http.MethodGet, "/meet/"+roomID+"/recordings", nil); w.Code != http.StatusOK {
			t.Fatalf("member %q List: expected 200, got %d (%s)", member, w.Code, w.Body.String())
		}
	}
}
