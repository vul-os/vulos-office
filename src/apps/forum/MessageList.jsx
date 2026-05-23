/**
 * MessageList — renders a flat list of top-level messages for a channel.
 * Thread replies are shown inline when a message is expanded.
 */
import { useState } from 'react'
import { MoreHorizontal, MessageSquare, Pencil, Trash2, X, Check } from 'lucide-react'
import { STATE_DELETED, STATE_EDITED } from '../../lib/crdt/messages.js'
import { PresenceDot } from '../../components/PresenceBar.jsx'

function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDate(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

function Avatar({ name, presencePeer }) {
  const initials = (name || '?')[0].toUpperCase()
  const colors = [
    'bg-indigo-500', 'bg-emerald-500', 'bg-amber-500',
    'bg-rose-500', 'bg-sky-500', 'bg-violet-500',
  ]
  const idx = (name?.charCodeAt(0) || 0) % colors.length
  return (
    <div className="relative flex-shrink-0 w-8 h-8">
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold ${colors[idx]}`}
        style={presencePeer ? { backgroundColor: presencePeer.color } : undefined}
        title={presencePeer?.statusText
          ? `${presencePeer.displayName} — ${presencePeer.statusText}`
          : presencePeer?.displayName || name}
      >
        {initials}
      </div>
      {/* OFFICE-62: presence dot on message author avatar */}
      {presencePeer && (
        <span className="absolute bottom-0 right-0">
          <PresenceDot status={presencePeer.status} size={7} />
        </span>
      )}
    </div>
  )
}

function MessageItem({ msg, replies, onReply, onEdit, onDelete, currentUser, roster = [] }) {
  const [showMenu, setShowMenu] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editBody, setEditBody] = useState(msg.body)
  const [showReplies, setShowReplies] = useState(false)

  const isOwn = msg.author_id === currentUser
  const isDeleted = msg.state === STATE_DELETED

  function submitEdit() {
    if (editBody.trim() && editBody.trim() !== msg.body) {
      onEdit(msg.id, editBody.trim())
    }
    setEditing(false)
  }

  // Find author in presence roster for status dot
  const presencePeer = roster.find((p) => p.accountId === msg.author_id || p.displayName === msg.author_id)

  return (
    <div className="group flex gap-3 px-4 py-2 hover:bg-gray-50 rounded-lg transition">
      <Avatar name={msg.author_id} presencePeer={presencePeer} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-sm text-gray-900">{msg.author_id}</span>
          <span className="text-xs text-gray-400">{formatTime(msg.created_at)}</span>
          {msg.state === STATE_EDITED && (
            <span className="text-xs text-gray-400 italic">(edited)</span>
          )}
        </div>

        {isDeleted ? (
          <p className="text-sm text-gray-400 italic">This message was deleted.</p>
        ) : editing ? (
          <div className="mt-1 flex gap-2 items-end">
            <textarea
              className="flex-1 border border-indigo-400 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
              rows={2}
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitEdit() }
                if (e.key === 'Escape') setEditing(false)
              }}
              autoFocus
            />
            <button onClick={submitEdit} className="p-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-500"><Check size={14} /></button>
            <button onClick={() => setEditing(false)} className="p-1.5 rounded bg-gray-200 text-gray-600 hover:bg-gray-300"><X size={14} /></button>
          </div>
        ) : (
          <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">{msg.body}</p>
        )}

        {/* Thread reply count + toggle */}
        {replies.length > 0 && (
          <button
            onClick={() => setShowReplies(!showReplies)}
            className="mt-1 flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-500 font-medium"
          >
            <MessageSquare size={12} />
            {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
          </button>
        )}

        {/* Thread replies (inline) */}
        {showReplies && replies.length > 0 && (
          <div className="mt-2 ml-1 border-l-2 border-gray-200 pl-3 space-y-1">
            {replies.map((r) => (
              <div key={r.id} className="flex gap-2 py-1">
                <Avatar name={r.author_id} />
                <div className="flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-semibold text-xs text-gray-900">{r.author_id}</span>
                    <span className="text-xs text-gray-400">{formatTime(r.created_at)}</span>
                  </div>
                  {r.state === STATE_DELETED
                    ? <p className="text-xs text-gray-400 italic">Deleted.</p>
                    : <p className="text-xs text-gray-800 whitespace-pre-wrap">{r.body}</p>
                  }
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Reply button (always visible on hover if not deleted) */}
        {!isDeleted && (
          <button
            onClick={() => onReply(msg)}
            className="mt-1 text-xs text-gray-400 hover:text-indigo-600 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition"
          >
            <MessageSquare size={11} /> Reply in thread
          </button>
        )}
      </div>

      {/* Context menu (own messages only) */}
      {isOwn && !isDeleted && (
        <div className="relative flex-shrink-0 opacity-0 group-hover:opacity-100 transition">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-1 rounded hover:bg-gray-200 text-gray-400"
          >
            <MoreHorizontal size={14} />
          </button>
          {showMenu && (
            <div className="absolute right-0 top-6 z-10 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[120px]">
              <button
                onClick={() => { setEditing(true); setEditBody(msg.body); setShowMenu(false) }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
              >
                <Pencil size={12} /> Edit
              </button>
              <button
                onClick={() => { onDelete(msg.id); setShowMenu(false) }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
              >
                <Trash2 size={12} /> Delete
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function MessageList({ messages, onReply, onEdit, onDelete, currentUser, roster = [] }) {
  if (!messages || messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        No messages yet. Be the first to say something!
      </div>
    )
  }

  // Separate top-level from thread replies
  const topLevel = messages.filter((m) => !m.thread_parent)
  const replyMap = {}
  messages.filter((m) => m.thread_parent).forEach((r) => {
    if (!replyMap[r.thread_parent]) replyMap[r.thread_parent] = []
    replyMap[r.thread_parent].push(r)
  })

  // Group by date for date separators
  let lastDate = null

  return (
    <div className="flex-1 overflow-y-auto py-2 space-y-0.5">
      {topLevel.map((msg) => {
        const date = formatDate(msg.created_at)
        const showDate = date !== lastDate
        lastDate = date
        return (
          <div key={msg.id}>
            {showDate && (
              <div className="flex items-center gap-3 px-4 py-2">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-xs text-gray-400 font-medium">{date}</span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>
            )}
            <MessageItem
              msg={msg}
              replies={replyMap[msg.id] || []}
              onReply={onReply}
              onEdit={onEdit}
              onDelete={onDelete}
              currentUser={currentUser}
              roster={roster}
            />
          </div>
        )
      })}
    </div>
  )
}
