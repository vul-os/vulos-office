package spaces_test

import (
	"path/filepath"
	"testing"
	"time"

	"vulos-office/backend/models"
	"vulos-office/backend/spaces"
)

// TestPresencePersistsAcrossRestart proves user status, reactions, and pins all
// survive re-opening the SQLite persister (the P1 durability fix). Previously
// these lived only in memory in handlers/spaces_ext.go and were lost on restart.
func TestPresencePersistsAcrossRestart(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "spaces.db")

	// --- session 1: write presence state, then close ---
	p1, err := spaces.NewSQLitePersister(dbPath)
	if err != nil {
		t.Fatalf("open persister: %v", err)
	}

	if err := p1.SaveStatus(&models.UserStatus{
		UserID: "alice", Status: "busy", CustomText: "in a meeting",
		UntilUnix: 1700000000, UpdatedAt: time.Now(),
	}); err != nil {
		t.Fatalf("save status: %v", err)
	}
	if err := p1.SaveReaction(&models.Reaction{
		MessageID: "m1", Emoji: "👍", UserID: "alice", CreatedAt: time.Now(),
	}); err != nil {
		t.Fatalf("save reaction: %v", err)
	}
	if err := p1.SavePin(&models.PinnedMessage{
		ChannelID: "c1", MessageID: "m1", AuthorID: "alice", Body: "pin me",
		PinnedBy: "alice", PinnedAt: time.Now(),
	}); err != nil {
		t.Fatalf("save pin: %v", err)
	}
	if err := p1.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	// --- session 2: re-open and verify everything survived ---
	p2, err := spaces.NewSQLitePersister(dbPath)
	if err != nil {
		t.Fatalf("reopen persister: %v", err)
	}
	defer p2.Close()

	statuses, err := p2.ListStatuses()
	if err != nil {
		t.Fatalf("list statuses: %v", err)
	}
	if len(statuses) != 1 || statuses[0].UserID != "alice" || statuses[0].Status != "busy" ||
		statuses[0].CustomText != "in a meeting" || statuses[0].UntilUnix != 1700000000 {
		t.Fatalf("status did not survive restart: %+v", statuses)
	}

	reactions, err := p2.ListReactions()
	if err != nil {
		t.Fatalf("list reactions: %v", err)
	}
	if len(reactions) != 1 || reactions[0].MessageID != "m1" || reactions[0].Emoji != "👍" || reactions[0].UserID != "alice" {
		t.Fatalf("reaction did not survive restart: %+v", reactions)
	}

	pins, err := p2.ListPins()
	if err != nil {
		t.Fatalf("list pins: %v", err)
	}
	if len(pins) != 1 || pins[0].ChannelID != "c1" || pins[0].MessageID != "m1" || pins[0].Body != "pin me" {
		t.Fatalf("pin did not survive restart: %+v", pins)
	}

	// --- mutation durability: unreact + unpin must also persist ---
	if err := p2.DeleteReaction("m1", "👍", "alice"); err != nil {
		t.Fatalf("delete reaction: %v", err)
	}
	if err := p2.DeletePin("c1", "m1"); err != nil {
		t.Fatalf("delete pin: %v", err)
	}
	if err := p2.Close(); err != nil {
		t.Fatalf("close p2: %v", err)
	}

	p3, err := spaces.NewSQLitePersister(dbPath)
	if err != nil {
		t.Fatalf("reopen persister 3: %v", err)
	}
	defer p3.Close()
	if rs, _ := p3.ListReactions(); len(rs) != 0 {
		t.Fatalf("reaction removal did not survive restart: %+v", rs)
	}
	if ps, _ := p3.ListPins(); len(ps) != 0 {
		t.Fatalf("pin removal did not survive restart: %+v", ps)
	}
	// Status is sticky (no clear op) — should still be present.
	if ss, _ := p3.ListStatuses(); len(ss) != 1 {
		t.Fatalf("status should still be present after restart: %+v", ss)
	}
}
