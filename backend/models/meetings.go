package models

import "time"

// MeetingRecording holds metadata for a recorded call segment uploaded by a participant.
type MeetingRecording struct {
	ID          string    `json:"id"`
	MeetingID   string    `json:"meeting_id"`
	RoomID      string    `json:"room_id"`
	OrganizerID string    `json:"organizer_id"`
	AccountID   string    `json:"account_id"` // uploader
	FileName    string    `json:"file_name"`   // e.g. "recording-<id>.webm"
	SizeBytes   int64     `json:"size_bytes"`
	DurationSec int       `json:"duration_sec,omitempty"`
	BucketKey   string    `json:"bucket_key"`  // org-scoped S3 key
	CreatedAt   time.Time `json:"created_at"`
}

// MeetingStatus represents the lifecycle state of a scheduled meeting.
type MeetingStatus string

const (
	MeetingStatusScheduled MeetingStatus = "scheduled"
	MeetingStatusActive    MeetingStatus = "active"
	MeetingStatusEnded     MeetingStatus = "ended"
	MeetingStatusCancelled MeetingStatus = "cancelled"
)

// Meeting is a named, optionally scheduled video meeting room.
// A meeting maps 1:1 to a fabric session (SessionID) which CallView uses.
// When ScheduledAt is zero the room is a permanent / instant room.
type Meeting struct {
	ID               string        `json:"id"`
	Title            string        `json:"title"`
	SessionID        string        `json:"session_id"` // fabric session / room id fed into createCall
	HostVulos        string        `json:"host_vulos"`
	Invitees         []string      `json:"invitees"`             // Vulos account addresses (@vulos.org)
	ScheduledAt      *time.Time    `json:"scheduled_at,omitempty"`
	DurationMin      int           `json:"duration_min,omitempty"` // 0 = open-ended
	Status           MeetingStatus `json:"status"`
	JoinLink         string        `json:"join_link"` // /meet/<id>
	OrganizerID      string        `json:"organizer_id,omitempty"`
	LobbyRequired    bool          `json:"lobby_required"`
	SigninRequired   bool          `json:"signin_required"`
	RecordingEnabled bool          `json:"recording_enabled"`
	CreatedAt        time.Time     `json:"created_at"`
	UpdatedAt        time.Time     `json:"updated_at"`
}

// MeetingParticipant tracks who has joined a live room (ephemeral, in-memory only).
type MeetingParticipant struct {
	Vulos       string    `json:"vulos"`
	DisplayName string    `json:"display_name"`
	JoinedAt    time.Time `json:"joined_at"`
}

// ---- request / response bodies ----

type CreateMeetingRequest struct {
	Title            string     `json:"title" binding:"required"`
	HostVulos        string     `json:"host_vulos"`
	Invitees         []string   `json:"invitees"`
	ScheduledAt      *time.Time `json:"scheduled_at,omitempty"`
	DurationMin      int        `json:"duration_min,omitempty"`
	LobbyRequired    bool       `json:"lobby_required"`
	SigninRequired   bool       `json:"signin_required"`
	RecordingEnabled bool       `json:"recording_enabled"`
	OrganizerID      string     `json:"organizer_id,omitempty"`
}

type UpdateMeetingRequest struct {
	Title       string     `json:"title"`
	Invitees    []string   `json:"invitees"`
	ScheduledAt *time.Time `json:"scheduled_at,omitempty"`
	DurationMin int        `json:"duration_min,omitempty"`
	Status      string     `json:"status,omitempty"`
}

type MeetingJoinResponse struct {
	Meeting   *Meeting `json:"meeting"`
	SessionID string   `json:"session_id"`
	JoinLink  string   `json:"join_link"`
}
