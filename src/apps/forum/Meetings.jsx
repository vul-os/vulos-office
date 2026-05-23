// Meetings.jsx — OFFICE-65: Scheduled meetings dashboard.
//
// Shows a list of rooms/scheduled meetings, lets the host create new ones,
// and provides a copy-to-clipboard join link per meeting.
// Clicking "Join" navigates to /room/<sessionId> which renders Room.jsx.
//
// Props: none — fetches from /api/meetings on mount.

import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Calendar, Clock, Copy, Plus, Trash2, Video, Users, CheckCircle, XCircle,
} from 'lucide-react'

const API = '/api/meetings'

async function apiFetch(path, opts = {}) {
  const token = localStorage.getItem('session_token')
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(path, { ...opts, headers })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `HTTP ${res.status}`)
  }
  return res.json()
}

function formatDt(isoStr) {
  if (!isoStr) return null
  const d = new Date(isoStr)
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function statusColor(s) {
  if (s === 'active') return 'text-emerald-500'
  if (s === 'ended') return 'text-gray-400'
  if (s === 'cancelled') return 'text-red-400'
  return 'text-amber-400' // scheduled
}

export default function Meetings() {
  const [meetings, setMeetings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState(null)
  const navigate = useNavigate()

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const data = await apiFetch(API)
      setMeetings(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleDelete = useCallback(async (id) => {
    if (!window.confirm('Delete this meeting room?')) return
    try {
      await apiFetch(`${API}/${id}`, { method: 'DELETE' })
      setMeetings((m) => m.filter((x) => x.id !== id))
    } catch (e) {
      alert(`Delete failed: ${e.message}`)
    }
  }, [])

  const handleJoin = useCallback((m) => {
    // Navigate to the Room component — SPA-side route.
    navigate(`/room/${encodeURIComponent(m.session_id)}`)
  }, [navigate])

  const handleCopyLink = useCallback(async (m) => {
    const url = `${window.location.origin}/room/${encodeURIComponent(m.session_id)}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(m.id)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      prompt('Copy this link:', url)
    }
  }, [])

  const handleCreated = useCallback((m) => {
    setMeetings((prev) => [m, ...prev])
    setCreating(false)
  }, [])

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="px-6 py-4 border-b flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Video size={20} className="text-indigo-500" />
          Meeting Rooms
        </h1>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg"
        >
          <Plus size={14} />
          New Room
        </button>
      </div>

      {/* Create modal */}
      {creating && (
        <CreateModal onCreated={handleCreated} onClose={() => setCreating(false)} />
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading && (
          <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
            Loading…
          </div>
        )}
        {error && !loading && (
          <div className="text-red-500 text-sm">{error}</div>
        )}
        {!loading && !error && meetings.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 text-gray-400 text-sm gap-2">
            <Video size={32} className="opacity-30" />
            <span>No rooms yet. Create one to get started.</span>
          </div>
        )}
        {!loading && meetings.length > 0 && (
          <ul className="space-y-3">
            {meetings.map((m) => (
              <MeetingCard
                key={m.id}
                meeting={m}
                copied={copied === m.id}
                onJoin={handleJoin}
                onCopyLink={handleCopyLink}
                onDelete={handleDelete}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function MeetingCard({ meeting: m, copied, onJoin, onCopyLink, onDelete }) {
  return (
    <li className="border rounded-xl p-4 flex items-start justify-between gap-4 hover:bg-gray-50 transition">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-gray-900 truncate">{m.title}</span>
          <span className={`text-xs font-medium capitalize ${statusColor(m.status)}`}>
            {m.status}
          </span>
        </div>

        <div className="mt-1 flex flex-wrap gap-3 text-xs text-gray-500">
          {m.scheduled_at && (
            <span className="flex items-center gap-1">
              <Calendar size={11} />
              {formatDt(m.scheduled_at)}
              {m.duration_min > 0 && (
                <span className="flex items-center gap-1 ml-1">
                  <Clock size={11} />
                  {m.duration_min} min
                </span>
              )}
            </span>
          )}
          {m.host_vumail && (
            <span className="flex items-center gap-1">
              Host: {m.host_vumail}
            </span>
          )}
          {Array.isArray(m.invitees) && m.invitees.length > 0 && (
            <span className="flex items-center gap-1">
              <Users size={11} />
              {m.invitees.length} invitee{m.invitees.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {Array.isArray(m.invitees) && m.invitees.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {m.invitees.map((inv) => (
              <span
                key={inv}
                className="bg-indigo-50 text-indigo-700 text-xs px-2 py-0.5 rounded-full"
              >
                {inv}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={() => onCopyLink(m)}
          title="Copy join link"
          className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition"
        >
          {copied ? <CheckCircle size={16} className="text-emerald-500" /> : <Copy size={16} />}
        </button>
        <button
          onClick={() => onJoin(m)}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg flex items-center gap-1"
        >
          <Video size={13} />
          Join
        </button>
        <button
          onClick={() => onDelete(m.id)}
          title="Delete room"
          className="p-2 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 transition"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </li>
  )
}

function CreateModal({ onCreated, onClose }) {
  const [form, setForm] = useState({
    title: '',
    host_vumail: '',
    invitees_raw: '',   // comma-separated
    scheduled_at: '',
    duration_min: 60,
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.title.trim()) return
    setBusy(true)
    setErr(null)
    try {
      const body = {
        title: form.title.trim(),
        host_vumail: form.host_vumail.trim() || undefined,
        invitees: form.invitees_raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        duration_min: form.duration_min || 0,
      }
      if (form.scheduled_at) {
        body.scheduled_at = new Date(form.scheduled_at).toISOString()
      }
      const m = await apiFetch(API, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      onCreated(m)
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900">New Meeting Room</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <XCircle size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Title *</label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              placeholder="Weekly Sync"
              value={form.title}
              onChange={(e) => update('title', e.target.value)}
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Your vumail</label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              placeholder="you@vulos"
              value={form.host_vumail}
              onChange={(e) => update('host_vumail', e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Invitees (comma-separated vumail addresses)
            </label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              placeholder="alice@vulos, bob@vulos"
              value={form.invitees_raw}
              onChange={(e) => update('invitees_raw', e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Scheduled time (optional)
              </label>
              <input
                type="datetime-local"
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                value={form.scheduled_at}
                onChange={(e) => update('scheduled_at', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Duration (min)
              </label>
              <input
                type="number"
                min="0"
                max="480"
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                value={form.duration_min}
                onChange={(e) => update('duration_min', parseInt(e.target.value, 10) || 0)}
              />
            </div>
          </div>

          {err && <p className="text-red-500 text-xs">{err}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-sm rounded-lg"
            >
              {busy ? 'Creating…' : 'Create Room'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
