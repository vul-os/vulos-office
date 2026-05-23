/**
 * ForumApp — Slack-equivalent surface: channels, DMs, threads.
 * Routes: /forum  /forum/:channelId
 *
 * Channel sidebar (public/private channels + DMs) + ChannelView message pane.
 * Backed by the CRDT message store (OFFICE-60); presence hooks are stubs
 * pending OFFICE-24 being wired in (OFFICE-62 extends).
 */
import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Hash, Lock, AtSign, Plus, Users, Search, X, ChevronDown, ChevronRight,
} from 'lucide-react'
import ChannelView from './ChannelView.jsx'
import { api } from '../../lib/api.js'
import { usePresence, STATUS_ONLINE } from '../../lib/presence.js'
import { PresenceDot, StatusPicker } from '../../components/PresenceBar.jsx'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ChannelIcon({ type, size = 14 }) {
  if (type === 'dm') return <AtSign size={size} className="text-indigo-400 flex-shrink-0" />
  if (type === 'private') return <Lock size={size} className="text-amber-400 flex-shrink-0" />
  return <Hash size={size} className="text-gray-400 flex-shrink-0" />
}

// ---------------------------------------------------------------------------
// CreateChannelModal
// ---------------------------------------------------------------------------

function CreateChannelModal({ onClose, onCreated }) {
  const [name, setName] = useState('')
  const [type, setType] = useState('public')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function submit(e) {
    e.preventDefault()
    const n = name.trim().toLowerCase().replace(/\s+/g, '-')
    if (!n) return
    setLoading(true)
    setError(null)
    try {
      const ch = await api.forumCreateChannel(n, type)
      onCreated(ch)
      onClose()
    } catch (err) {
      setError(err.message || 'Create failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="font-bold text-gray-900">Create a channel</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="px-6 py-4 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <div className="flex items-center gap-2 border border-gray-300 rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-indigo-400 focus-within:border-transparent">
              <Hash size={14} className="text-gray-400" />
              <input
                type="text"
                placeholder="e.g. team-design"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="flex-1 text-sm outline-none"
                autoFocus
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              <option value="public">Public — anyone can join</option>
              <option value="private">Private — invite only</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition">
              Cancel
            </button>
            <button type="submit" disabled={loading || !name.trim()}
              className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 disabled:opacity-40 transition">
              {loading ? 'Creating…' : 'Create Channel'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// NewDMModal
// ---------------------------------------------------------------------------

function NewDMModal({ onClose, onCreated }) {
  const [recipient, setRecipient] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function submit(e) {
    e.preventDefault()
    const r = recipient.trim()
    if (!r) return
    setLoading(true)
    setError(null)
    try {
      // DM channels are named by participants; use a sorted pair
      const dmName = ['me', r].sort().join('-')
      const ch = await api.forumCreateChannel(dmName, 'dm', ['me', r])
      onCreated(ch)
      onClose()
    } catch (err) {
      setError(err.message || 'Create failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="font-bold text-gray-900">New Direct Message</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="px-6 py-4 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">To (account id / name)</label>
            <input
              type="text"
              placeholder="e.g. alice"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition">
              Cancel
            </button>
            <button type="submit" disabled={loading || !recipient.trim()}
              className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 disabled:opacity-40 transition">
              {loading ? 'Opening…' : 'Open DM'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function ForumSidebar({ channels, activeId, onSelect, onRefresh, roster, localStatus, localStatusText, onSetStatus }) {
  const [showCreateChannel, setShowCreateChannel] = useState(false)
  const [showNewDM, setShowNewDM] = useState(false)
  const [channelsOpen, setChannelsOpen] = useState(true)
  const [dmsOpen, setDmsOpen] = useState(true)
  const [search, setSearch] = useState('')
  const [showStatusPicker, setShowStatusPicker] = useState(false)

  const publicChannels = channels.filter((c) => c.type !== 'dm')
  const dms = channels.filter((c) => c.type === 'dm')

  const filtered = (list) =>
    search ? list.filter((c) => c.name.toLowerCase().includes(search.toLowerCase())) : list

  function SectionHeader({ label, open, onToggle, onAdd, addTitle }) {
    return (
      <div className="flex items-center justify-between px-2 py-1.5 group">
        <button
          onClick={onToggle}
          className="flex items-center gap-1 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:text-gray-700 transition"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {label}
        </button>
        <button
          onClick={onAdd}
          title={addTitle}
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-700 transition"
        >
          <Plus size={13} />
        </button>
      </div>
    )
  }

  function ChannelRow({ channel }) {
    const isActive = channel.id === activeId
    // For DM channels, find the peer's presence status if available
    const dmPeer = channel.type === 'dm'
      ? roster.find((p) => !p.isSelf && channel.name.includes(p.displayName || p.accountId))
      : null
    return (
      <button
        onClick={() => onSelect(channel)}
        className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition text-left ${
          isActive
            ? 'bg-indigo-100 text-indigo-900 font-medium'
            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
        }`}
      >
        <div className="relative flex-shrink-0">
          <ChannelIcon type={channel.type} />
          {dmPeer && (
            <span className="absolute -bottom-0.5 -right-0.5">
              <PresenceDot status={dmPeer.status} size={6} />
            </span>
          )}
        </div>
        <span className="truncate">{channel.name}</span>
      </button>
    )
  }

  return (
    <div className="w-60 flex-shrink-0 bg-gray-50 border-r border-gray-200 flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200">
        <div className="flex items-center gap-2 bg-white border border-gray-300 rounded-lg px-3 py-1.5 focus-within:ring-2 focus-within:ring-indigo-400 focus-within:border-transparent">
          <Search size={13} className="text-gray-400" />
          <input
            type="text"
            placeholder="Find channel…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 text-sm outline-none"
          />
        </div>
      </div>

      {/* Channel list */}
      <div className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
        {/* Channels section */}
        <SectionHeader
          label="Channels"
          open={channelsOpen}
          onToggle={() => setChannelsOpen(!channelsOpen)}
          onAdd={() => setShowCreateChannel(true)}
          addTitle="Create channel"
        />
        {channelsOpen && filtered(publicChannels).map((ch) => (
          <ChannelRow key={ch.id} channel={ch} />
        ))}

        {/* DMs section */}
        <div className="mt-3" />
        <SectionHeader
          label="Direct Messages"
          open={dmsOpen}
          onToggle={() => setDmsOpen(!dmsOpen)}
          onAdd={() => setShowNewDM(true)}
          addTitle="New direct message"
        />
        {dmsOpen && filtered(dms).map((ch) => (
          <ChannelRow key={ch.id} channel={ch} />
        ))}

        {filtered(publicChannels).length === 0 && filtered(dms).length === 0 && search && (
          <p className="text-xs text-gray-400 px-3 py-2">No channels found.</p>
        )}
      </div>

      {/* Presence footer — OFFICE-62 */}
      <div className="border-t border-gray-200 px-3 py-2 space-y-1.5">
        {/* Online members list */}
        {roster.filter((p) => !p.isSelf).length > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <Users size={11} />
            <span className="font-medium text-gray-500">
              {roster.filter((p) => !p.isSelf).length} online
            </span>
            <div className="flex flex-wrap gap-1 ml-1">
              {roster.filter((p) => !p.isSelf).slice(0, 5).map((p) => (
                <span
                  key={p.accountId}
                  className="flex items-center gap-1 bg-gray-100 rounded-full px-1.5 py-0.5 text-gray-600"
                  title={p.statusText ? `${p.displayName} — ${p.statusText}` : p.displayName}
                >
                  <PresenceDot status={p.status} size={6} />
                  <span className="truncate max-w-[60px]">{p.displayName}</span>
                </span>
              ))}
            </div>
          </div>
        )}
        {/* My status button */}
        <div className="relative">
          <button
            onClick={() => setShowStatusPicker((v) => !v)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-100 transition text-left"
          >
            <PresenceDot status={localStatus} size={8} />
            <span className="text-xs text-gray-600 truncate">
              {localStatusText || localStatus || STATUS_ONLINE}
            </span>
          </button>
          {showStatusPicker && (
            <StatusPicker
              currentStatus={localStatus}
              currentText={localStatusText}
              onStatusChange={onSetStatus}
              onClose={() => setShowStatusPicker(false)}
            />
          )}
        </div>
      </div>

      {showCreateChannel && (
        <CreateChannelModal
          onClose={() => setShowCreateChannel(false)}
          onCreated={(ch) => { onRefresh(); onSelect(ch) }}
        />
      )}
      {showNewDM && (
        <NewDMModal
          onClose={() => setShowNewDM(false)}
          onCreated={(ch) => { onRefresh(); onSelect(ch) }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ForumApp — root component
// ---------------------------------------------------------------------------

export default function ForumApp() {
  const { channelId } = useParams()
  const navigate = useNavigate()
  const [channels, setChannels] = useState([])
  const [activeChannel, setActiveChannel] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // OFFICE-62: presence — fabric is null until OFFICE-20 is wired; roster is empty but
  // the local-status picker and dot rendering are fully functional.
  const { roster, manager: presenceManager } = usePresence({ fabric: null })
  const [localStatus, setLocalStatus] = useState(STATUS_ONLINE)
  const [localStatusText, setLocalStatusText] = useState('')

  function handleSetStatus(status, text) {
    setLocalStatus(status)
    setLocalStatusText(text)
    if (presenceManager) presenceManager.setStatus(status, text)
  }

  // Current user identity
  const currentUser = 'me'

  const loadChannels = useCallback(async () => {
    try {
      const chs = await api.forumListChannels()
      setChannels(chs || [])
      return chs || []
    } catch (e) {
      setError(e.message || 'Failed to load channels')
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadChannels().then((chs) => {
      if (channelId) {
        const found = chs.find((c) => c.id === channelId)
        if (found) setActiveChannel(found)
      } else if (chs.length > 0) {
        setActiveChannel(chs[0])
        navigate(`/forum/${chs[0].id}`, { replace: true })
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function selectChannel(ch) {
    setActiveChannel(ch)
    navigate(`/forum/${ch.id}`)
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-red-500 text-sm">{error}</div>
    )
  }

  return (
    <div className="flex flex-1 min-h-0">
      <ForumSidebar
        channels={channels}
        activeId={activeChannel?.id}
        onSelect={selectChannel}
        onRefresh={loadChannels}
        roster={roster}
        localStatus={localStatus}
        localStatusText={localStatusText}
        onSetStatus={handleSetStatus}
      />
      <ChannelView
        channel={activeChannel}
        currentUser={currentUser}
        roster={roster}
      />
    </div>
  )
}
