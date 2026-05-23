/**
 * ActivityFeed — OFFICE-28
 *
 * A side panel with two tabs:
 *   1. Activity  — chronological list of edits / comments / signings / snapshots
 *   2. Snapshots — all named snapshots; create a new named snapshot; restore
 *
 * Props:
 *   fileId    string   — the document ID
 *   onRestore fn       — called with the restored File object after a successful restore
 *   onClose   fn       — called when the panel is closed
 */

import { useState, useEffect, useCallback } from 'react'
import {
  Activity, Bookmark, X, Loader2, AlertCircle, RotateCcw,
  Plus, CheckCircle, ChevronRight, Edit3, MessageSquare, Shield,
} from 'lucide-react'
import { api } from '../lib/api'

// ---- helpers ---------------------------------------------------------------

function formatRelative(dateStr) {
  const d = new Date(dateStr)
  const now = new Date()
  const diffMs = now - d
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 30) return `${diffDay}d ago`
  return d.toLocaleDateString()
}

const KIND_ICON = {
  edit:     <Edit3     size={12} className="text-indigo-400" />,
  comment:  <MessageSquare size={12} className="text-blue-400" />,
  sign:     <Shield    size={12} className="text-emerald-400" />,
  snapshot: <Bookmark  size={12} className="text-amber-500"  />,
}

const KIND_BADGE = {
  edit:     'bg-indigo-50 text-indigo-600',
  comment:  'bg-blue-50 text-blue-600',
  sign:     'bg-emerald-50 text-emerald-600',
  snapshot: 'bg-amber-50 text-amber-700',
}

// ---- sub-components --------------------------------------------------------

function ActivityList({ fileId }) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getActivity(fileId)
      // Show newest first in the feed
      setEvents([...data].reverse())
    } catch (e) {
      setError(e.message || 'Failed to load activity')
    } finally {
      setLoading(false)
    }
  }, [fileId])

  useEffect(() => { load() }, [load])

  if (loading) return (
    <div className="flex items-center justify-center py-12">
      <Loader2 size={20} className="animate-spin text-indigo-400" />
    </div>
  )

  if (error) return (
    <div className="flex flex-col items-center gap-2 py-10 px-4 text-center">
      <AlertCircle size={20} className="text-red-400" />
      <p className="text-xs text-red-500">{error}</p>
      <button onClick={load} className="text-xs text-indigo-600 underline hover:text-indigo-800">Retry</button>
    </div>
  )

  if (events.length === 0) return (
    <div className="py-10 px-4 text-center">
      <p className="text-xs text-gray-400">No activity yet.</p>
      <p className="text-xs text-gray-400 mt-1">Edits, comments, and signings appear here.</p>
    </div>
  )

  return (
    <ul className="divide-y divide-gray-50">
      {events.map((ev) => (
        <li key={ev.id} className="px-4 py-3 hover:bg-gray-50 transition">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 flex-shrink-0">{KIND_ICON[ev.kind] || KIND_ICON.edit}</span>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-gray-800 leading-snug">{ev.summary}</p>
              {ev.author && (
                <p className="text-[11px] text-gray-400 mt-0.5">by {ev.author}</p>
              )}
              <p className="text-[11px] text-gray-400 mt-0.5">{formatRelative(ev.timestamp)}</p>
            </div>
            <span className={`flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded capitalize ${KIND_BADGE[ev.kind] || KIND_BADGE.edit}`}>
              {ev.kind}
            </span>
          </div>
        </li>
      ))}
    </ul>
  )
}

function SnapshotsTab({ fileId, onRestore }) {
  const [versions, setVersions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [restoring, setRestoring] = useState(null)
  const [labelInput, setLabelInput] = useState('')
  const [creating, setCreating] = useState(false)
  const [toast, setToast] = useState(null)

  const showToast = (msg, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.listVersions(fileId)
      setVersions(data)
    } catch (e) {
      setError(e.message || 'Failed to load snapshots')
    } finally {
      setLoading(false)
    }
  }, [fileId])

  useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    const label = labelInput.trim()
    if (!label) return
    setCreating(true)
    try {
      await api.createNamedSnapshot(fileId, label)
      setLabelInput('')
      showToast('Snapshot created')
      await load()
    } catch (e) {
      showToast(e.message || 'Failed to create snapshot', false)
    } finally {
      setCreating(false)
    }
  }

  const handleRestore = async (vid) => {
    setRestoring(vid)
    try {
      const updated = await api.restoreVersion(fileId, vid)
      showToast('Version restored')
      onRestore?.(updated)
      await load()
    } catch (e) {
      showToast(e.message || 'Restore failed', false)
    } finally {
      setRestoring(null)
    }
  }

  // Named snapshots only (versions with a label)
  const named = versions.filter((v) => v.label)
  // All versions for the "auto-saves" list
  const auto = versions.filter((v) => !v.label)

  return (
    <div className="flex flex-col h-full">
      {/* Create named snapshot */}
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
        <p className="text-xs font-semibold text-gray-600 mb-2">Create named snapshot</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={labelInput}
            onChange={(e) => setLabelInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
            placeholder="e.g. v1 final draft"
            className="flex-1 text-xs border border-gray-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          <button
            onClick={handleCreate}
            disabled={creating || !labelInput.trim()}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-indigo-600 text-white rounded-md text-xs font-medium hover:bg-indigo-700 disabled:opacity-50 transition"
          >
            {creating ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
            Save
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={18} className="animate-spin text-indigo-400" />
          </div>
        )}

        {error && !loading && (
          <div className="flex flex-col items-center gap-2 py-8 px-4 text-center">
            <AlertCircle size={18} className="text-red-400" />
            <p className="text-xs text-red-500">{error}</p>
            <button onClick={load} className="text-xs text-indigo-600 underline">Retry</button>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Named snapshots */}
            {named.length > 0 && (
              <div>
                <p className="px-4 pt-3 pb-1 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Named</p>
                <ul className="divide-y divide-gray-50">
                  {named.map((v, idx) => (
                    <VersionRow
                      key={v.id}
                      v={v}
                      idx={idx}
                      restoring={restoring}
                      onRestore={handleRestore}
                      isNamed
                    />
                  ))}
                </ul>
              </div>
            )}

            {named.length === 0 && (
              <div className="px-4 py-6 text-center">
                <Bookmark size={20} className="mx-auto text-gray-300 mb-2" />
                <p className="text-xs text-gray-400">No named snapshots yet.</p>
                <p className="text-xs text-gray-400 mt-0.5">Give a name above to pin this state.</p>
              </div>
            )}

            {/* Auto-saves */}
            {auto.length > 0 && (
              <div>
                <p className="px-4 pt-3 pb-1 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Auto-saves</p>
                <ul className="divide-y divide-gray-50">
                  {auto.map((v, idx) => (
                    <VersionRow
                      key={v.id}
                      v={v}
                      idx={idx}
                      restoring={restoring}
                      onRestore={handleRestore}
                    />
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>

      {toast && (
        <div className={`mx-3 mb-3 flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-white ${toast.ok ? 'bg-gray-800' : 'bg-red-600'}`}>
          {toast.ok ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
          {toast.msg}
        </div>
      )}
    </div>
  )
}

function VersionRow({ v, idx, restoring, onRestore, isNamed = false }) {
  return (
    <li className="px-4 py-3 hover:bg-gray-50 group transition">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {isNamed && (
            <div className="flex items-center gap-1 mb-0.5">
              <Bookmark size={11} className="text-amber-500 flex-shrink-0" />
              <p className="text-xs font-semibold text-amber-700 truncate">{v.label}</p>
            </div>
          )}
          <p className="text-xs text-gray-700 truncate" title={v.name}>{v.name}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {formatRelative(v.created_at)}
            {idx === 0 && !isNamed && (
              <span className="ml-2 bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded text-[10px] font-semibold">
                latest
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => onRestore(v.id)}
          disabled={restoring === v.id}
          title="Restore this version"
          className="flex-shrink-0 flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded transition opacity-0 group-hover:opacity-100 disabled:opacity-50"
        >
          {restoring === v.id ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
          Restore
        </button>
      </div>
    </li>
  )
}

// ---- main export -----------------------------------------------------------

export default function ActivityFeed({ fileId, onRestore, onClose }) {
  const [tab, setTab] = useState('activity') // 'activity' | 'snapshots'

  return (
    <div className="w-72 flex flex-col border-l border-gray-200 bg-white h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setTab('activity')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition ${
              tab === 'activity'
                ? 'bg-indigo-100 text-indigo-700'
                : 'text-gray-500 hover:bg-gray-200'
            }`}
          >
            <Activity size={12} />
            Activity
          </button>
          <button
            onClick={() => setTab('snapshots')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition ${
              tab === 'snapshots'
                ? 'bg-indigo-100 text-indigo-700'
                : 'text-gray-500 hover:bg-gray-200'
            }`}
          >
            <Bookmark size={12} />
            Snapshots
          </button>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition"
            title="Close"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'activity' && <ActivityList fileId={fileId} />}
        {tab === 'snapshots' && <SnapshotsTab fileId={fileId} onRestore={onRestore} />}
      </div>
    </div>
  )
}
