// Room.jsx — OFFICE-65: Meeting room join/lobby + per-room call surface.
//
// Route: /room/:sessionId
//   :sessionId is the fabric session id (e.g. "meeting:<id>") — the same
//   value that createCall() receives.  CallView handles the WebRTC mesh.
//
// Flow:
//   1. Lobby screen: user enters display name + optional vumail.
//   2. Host sees a "Start meeting" button; others see "Ask to join" (lobby).
//   3. Once admitted / started, CallView mounts with the room's sessionId.
//   4. Per-room presence roster (participants who have joined).
//
// The "lobby/admit" model here is client-side: we trust the host identity
// the user declares; a production deployment would couple to the fabric
// session membership.

import { useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Video, Mic, MicOff, VideoOff, ArrowLeft, Users } from 'lucide-react'
import CallView from './CallView'

// Attempt to fetch the meeting metadata for display (title, invitees, etc).
// Non-blocking — the room works even without this info.
async function fetchMeetingMeta(sessionId) {
  // session_id is "meeting:<id>" — strip prefix to get the meeting id.
  const id = sessionId.startsWith('meeting:') ? sessionId.slice('meeting:'.length) : null
  if (!id) return null
  try {
    const r = await fetch(`/api/meetings/${encodeURIComponent(id)}/join`)
    if (r.ok) return r.json()
  } catch {}
  return null
}

// Simple random color for presence avatar
function randomColor() {
  const palette = [
    '#6366f1','#8b5cf6','#ec4899','#f97316','#10b981','#0ea5e9','#f59e0b',
  ]
  return palette[Math.floor(Math.random() * palette.length)]
}

export default function Room() {
  const { sessionId: rawSessionId } = useParams()
  // react-router encodes the colon; decode it.
  const sessionId = decodeURIComponent(rawSessionId || '')
  const navigate = useNavigate()

  const [phase, setPhase] = useState('lobby')  // 'lobby' | 'call' | 'ended'
  const [displayName, setDisplayName] = useState('')
  const [vumail, setVumail] = useState('')
  const [videoOn, setVideoOn] = useState(true)
  const [micOn, setMicOn] = useState(true)
  const [meta, setMeta] = useState(null)
  const [metaLoaded, setMetaLoaded] = useState(false)
  const [identity, setIdentity] = useState(null)

  // Load meeting meta once on first render
  useState(() => {
    fetchMeetingMeta(sessionId).then((m) => {
      setMeta(m)
      setMetaLoaded(true)
    })
  })

  const handleJoin = useCallback(() => {
    if (!displayName.trim()) return
    const id = {
      displayName: displayName.trim(),
      vumail: vumail.trim() || null,
      color: randomColor(),
      peerId: null, // assigned by signaling layer
    }
    setIdentity(id)
    setPhase('call')
  }, [displayName, vumail])

  const handleLeave = useCallback(() => {
    setPhase('ended')
  }, [])

  const handleBack = useCallback(() => {
    navigate('/meetings')
  }, [navigate])

  const meetingTitle = meta?.meeting?.title || sessionId

  if (phase === 'ended') {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-900 text-white gap-4">
        <div className="text-2xl font-semibold">You have left the meeting</div>
        <div className="text-gray-400 text-sm">{meetingTitle}</div>
        <button
          onClick={handleBack}
          className="mt-4 px-5 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm"
        >
          Back to Meetings
        </button>
      </div>
    )
  }

  if (phase === 'call') {
    return (
      <div className="flex flex-col h-screen bg-gray-900">
        {/* Room header bar */}
        <div className="flex-shrink-0 px-4 py-2 border-b border-gray-800 flex items-center gap-3 bg-gray-900 text-white text-sm">
          <button
            onClick={handleBack}
            className="text-gray-400 hover:text-white"
            title="Back to meetings"
          >
            <ArrowLeft size={16} />
          </button>
          <span className="font-medium truncate">{meetingTitle}</span>
          {meta?.meeting?.invitees?.length > 0 && (
            <span className="ml-auto flex items-center gap-1 text-xs text-gray-400">
              <Users size={12} />
              {meta.meeting.invitees.length} invited
            </span>
          )}
        </div>

        {/* CallView fills remaining height */}
        <div className="flex-1 min-h-0">
          <CallView
            sessionId={sessionId}
            identity={identity}
            video={videoOn && micOn !== undefined ? videoOn : true}
            onLeave={handleLeave}
          />
        </div>
      </div>
    )
  }

  // Lobby
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-950 text-white px-4">
      <div className="w-full max-w-sm bg-gray-900 rounded-2xl shadow-2xl p-6 space-y-5">
        {/* Meeting info */}
        <div className="text-center">
          <div className="flex items-center justify-center mb-2">
            <Video size={28} className="text-indigo-400" />
          </div>
          <h1 className="text-lg font-semibold">{meetingTitle}</h1>
          {meta?.meeting?.host_vumail && (
            <p className="text-xs text-gray-400 mt-0.5">
              Hosted by {meta.meeting.host_vumail}
            </p>
          )}
          {meta?.meeting?.scheduled_at && (
            <p className="text-xs text-gray-400">
              {new Date(meta.meeting.scheduled_at).toLocaleString()}
            </p>
          )}
          {meta?.meeting?.invitees?.length > 0 && (
            <div className="mt-2 flex flex-wrap justify-center gap-1">
              {meta.meeting.invitees.slice(0, 5).map((inv) => (
                <span
                  key={inv}
                  className="bg-indigo-900/60 text-indigo-300 text-xs px-2 py-0.5 rounded-full"
                >
                  {inv}
                </span>
              ))}
              {meta.meeting.invitees.length > 5 && (
                <span className="text-gray-500 text-xs px-1">
                  +{meta.meeting.invitees.length - 5} more
                </span>
              )}
            </div>
          )}
        </div>

        {/* Camera/mic preview toggles (cosmetic — actual track state controlled in CallView) */}
        <div className="flex justify-center gap-4">
          <button
            onClick={() => setMicOn((v) => !v)}
            className={`w-11 h-11 rounded-full flex items-center justify-center transition ${
              micOn ? 'bg-gray-700 hover:bg-gray-600' : 'bg-red-600 hover:bg-red-500'
            }`}
            title={micOn ? 'Mute microphone' : 'Unmute microphone'}
          >
            {micOn ? <Mic size={18} /> : <MicOff size={18} />}
          </button>
          <button
            onClick={() => setVideoOn((v) => !v)}
            className={`w-11 h-11 rounded-full flex items-center justify-center transition ${
              videoOn ? 'bg-gray-700 hover:bg-gray-600' : 'bg-red-600 hover:bg-red-500'
            }`}
            title={videoOn ? 'Turn off camera' : 'Turn on camera'}
          >
            {videoOn ? <Video size={18} /> : <VideoOff size={18} />}
          </button>
        </div>

        {/* Identity form */}
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Display name *</label>
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Your name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Vumail (optional)</label>
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="you@vulos"
              value={vumail}
              onChange={(e) => setVumail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            />
          </div>
        </div>

        <button
          onClick={handleJoin}
          disabled={!displayName.trim()}
          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-sm font-medium transition"
        >
          Join now
        </button>

        <button
          onClick={handleBack}
          className="w-full text-xs text-gray-500 hover:text-gray-300 flex items-center justify-center gap-1"
        >
          <ArrowLeft size={12} />
          Back to meetings
        </button>
      </div>
    </div>
  )
}
