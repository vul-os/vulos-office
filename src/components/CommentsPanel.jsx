/**
 * CommentsPanel — OFFICE-26
 *
 * A side-panel showing all comments for a file:
 *   - Anchored to text range / cell / slide
 *   - Threaded replies
 *   - Resolve / reopen
 *   - Author identity (authorId prop or "You")
 *   - Backed by the CRDT CommentStore; persists via REST
 *
 * Props
 * -----
 *   fileId    {string}   the open document's id
 *   anchorCtx {object}   context passed by the editor when adding a comment:
 *                          { type, from, to, snapshot }     (Docs)
 *                          { type, sheet, row, col, snapshot } (Sheets)
 *                          { type, slideId, snapshot }      (Slides)
 *   authorId  {string}   identity of the current user (vumail / session id)
 *   onClose   {function} called when the user clicks the X
 */

import { useEffect, useState, useRef, useCallback } from 'react'
import { X, MessageSquare, CheckCircle, RotateCcw, Trash2, Send, ChevronDown, ChevronUp } from 'lucide-react'
import { api } from '../lib/api'
import { getCommentStore } from '../lib/crdt/comments'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTs(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function anchorLabel(anchor) {
  if (!anchor) return ''
  if (anchor.orphaned) return '(anchor removed)'
  if (anchor.type === 'text_range') return anchor.snapshot || `chars ${anchor.from}–${anchor.to}`
  if (anchor.type === 'cell') return `${anchor.sheet} ${anchor.row}:${anchor.col}`
  if (anchor.type === 'slide') return `slide ${anchor.slide_id}`
  return ''
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ReplyItem({ reply, fileId, commentId, authorId, onDeleted }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(reply.body)
  const [busy, setBusy] = useState(false)

  const handleSave = async () => {
    if (!draft.trim() || draft === reply.body) { setEditing(false); return }
    setBusy(true)
    try {
      await api.updateReply(fileId, commentId, reply.id, { body: draft.trim() })
      const store = getCommentStore(fileId)
      store.editReply(commentId, reply.id, draft.trim())
      setEditing(false)
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    setBusy(true)
    try {
      await api.deleteReply(fileId, commentId, reply.id)
      const store = getCommentStore(fileId)
      store.deleteReply(commentId, reply.id)
      onDeleted(reply.id)
    } finally {
      setBusy(false)
    }
  }

  if (reply.deleted) {
    return (
      <div className="pl-3 text-xs text-gray-400 italic py-1 border-l-2 border-gray-100">
        [deleted]
      </div>
    )
  }

  const isOwn = reply.author_id === authorId

  return (
    <div className="pl-3 border-l-2 border-indigo-100 py-1.5 space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-600">{reply.author_id || 'Anonymous'}</span>
        <span className="text-[10px] text-gray-400">{formatTs(reply.created_at)}</span>
      </div>
      {editing ? (
        <div className="space-y-1">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            className="w-full text-xs border border-indigo-300 rounded px-2 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          <div className="flex gap-1">
            <button
              onClick={handleSave}
              disabled={busy}
              className="px-2 py-0.5 text-[10px] bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-60"
            >
              Save
            </button>
            <button
              onClick={() => { setEditing(false); setDraft(reply.body) }}
              className="px-2 py-0.5 text-[10px] border border-gray-300 rounded hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-gray-700 whitespace-pre-wrap">{reply.body}</p>
      )}
      {isOwn && !editing && (
        <div className="flex gap-2">
          <button onClick={() => setEditing(true)} className="text-[10px] text-indigo-500 hover:underline">Edit</button>
          <button onClick={handleDelete} disabled={busy} className="text-[10px] text-red-400 hover:underline">Delete</button>
        </div>
      )}
    </div>
  )
}

function CommentItem({ item, fileId, authorId, onUpdated, onDeleted }) {
  const [expanded, setExpanded] = useState(true)
  const [replyDraft, setReplyDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editDraft, setEditDraft] = useState(item.body)
  const [replies, setReplies] = useState(item.replies || [])

  // Keep replies in sync with parent updates
  useEffect(() => { setReplies(item.replies || []) }, [item.replies])

  const handleReply = async () => {
    const body = replyDraft.trim()
    if (!body) return
    setBusy(true)
    try {
      const r = await api.createReply(fileId, item.id, authorId, body)
      const store = getCommentStore(fileId)
      store.addReply(item.id, authorId, body)
      setReplies((prev) => [...prev, r])
      setReplyDraft('')
    } finally {
      setBusy(false)
    }
  }

  const handleResolve = async () => {
    setBusy(true)
    try {
      const updated = await api.updateComment(fileId, item.id, { state: 'resolved' })
      const store = getCommentStore(fileId)
      store.resolve(item.id)
      onUpdated({ ...item, ...updated })
    } finally {
      setBusy(false)
    }
  }

  const handleReopen = async () => {
    setBusy(true)
    try {
      const updated = await api.updateComment(fileId, item.id, { state: 'open' })
      const store = getCommentStore(fileId)
      store.reopen(item.id)
      onUpdated({ ...item, ...updated })
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    if (!window.confirm('Delete this comment and all replies?')) return
    setBusy(true)
    try {
      await api.deleteComment(fileId, item.id)
      onDeleted(item.id)
    } finally {
      setBusy(false)
    }
  }

  const handleSaveEdit = async () => {
    const body = editDraft.trim()
    if (!body || body === item.body) { setEditing(false); return }
    setBusy(true)
    try {
      const updated = await api.updateComment(fileId, item.id, { body })
      const store = getCommentStore(fileId)
      store.editComment(item.id, body)
      onUpdated({ ...item, ...updated })
      setEditing(false)
    } finally {
      setBusy(false)
    }
  }

  const isResolved = item.state === 'resolved'
  const isOwn = item.author_id === authorId

  return (
    <div className={`rounded-lg border p-3 space-y-2 transition-colors ${isResolved ? 'bg-gray-50 border-gray-200 opacity-70' : 'bg-white border-gray-200'}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold text-gray-700">{item.author_id || 'Anonymous'}</span>
            {isResolved && (
              <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">Resolved</span>
            )}
            <span className="text-[10px] text-gray-400">{formatTs(item.created_at)}</span>
          </div>
          {item.anchor && (
            <p className="text-[10px] text-indigo-500 mt-0.5 truncate" title={anchorLabel(item.anchor)}>
              {anchorLabel(item.anchor)}
            </p>
          )}
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-gray-400 hover:text-gray-600 flex-shrink-0 mt-0.5"
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {expanded && (
        <>
          {/* Body */}
          {editing ? (
            <div className="space-y-1.5">
              <textarea
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                rows={3}
                className="w-full text-sm border border-indigo-300 rounded px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
              <div className="flex gap-1.5">
                <button
                  onClick={handleSaveEdit}
                  disabled={busy}
                  className="px-2.5 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-60"
                >
                  Save
                </button>
                <button
                  onClick={() => { setEditing(false); setEditDraft(item.body) }}
                  className="px-2.5 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-800 whitespace-pre-wrap">{item.body}</p>
          )}

          {/* Replies */}
          {replies.length > 0 && (
            <div className="space-y-2 pt-1">
              {replies.map((r) => (
                <ReplyItem
                  key={r.id}
                  reply={r}
                  fileId={fileId}
                  commentId={item.id}
                  authorId={authorId}
                  onDeleted={(rid) => setReplies((prev) => prev.filter((x) => x.id !== rid))}
                />
              ))}
            </div>
          )}

          {/* Reply input */}
          {!isResolved && (
            <div className="flex items-end gap-1.5 pt-1">
              <textarea
                value={replyDraft}
                onChange={(e) => setReplyDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReply() } }}
                rows={1}
                placeholder="Reply…"
                className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-300 min-h-[28px]"
              />
              <button
                onClick={handleReply}
                disabled={!replyDraft.trim() || busy}
                className="p-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-40 flex-shrink-0"
              >
                <Send size={12} />
              </button>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-0.5 flex-wrap">
            {isResolved ? (
              <button
                onClick={handleReopen}
                disabled={busy}
                className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-indigo-600 transition"
              >
                <RotateCcw size={10} /> Reopen
              </button>
            ) : (
              <button
                onClick={handleResolve}
                disabled={busy}
                className="flex items-center gap-1 text-[10px] text-green-600 hover:text-green-700 transition"
              >
                <CheckCircle size={10} /> Resolve
              </button>
            )}
            {isOwn && !editing && (
              <>
                <button
                  onClick={() => setEditing(true)}
                  className="text-[10px] text-indigo-500 hover:underline"
                >
                  Edit
                </button>
                <button
                  onClick={handleDelete}
                  disabled={busy}
                  className="flex items-center gap-0.5 text-[10px] text-red-400 hover:text-red-600"
                >
                  <Trash2 size={10} /> Delete
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// CommentsPanel (main export)
// ---------------------------------------------------------------------------

export default function CommentsPanel({ fileId, anchorCtx, authorId = 'You', onClose }) {
  const [comments, setComments] = useState([])
  const [newBody, setNewBody] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('all') // 'all' | 'open' | 'resolved'
  const textareaRef = useRef(null)

  // Hydrate from server + CRDT store on mount
  useEffect(() => {
    if (!fileId) return
    setLoading(true)
    api.listComments(fileId)
      .then((items) => {
        const store = getCommentStore(fileId)
        store.loadFromServer(items)
        setComments(store.list())
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [fileId])

  const refresh = useCallback(() => {
    const store = getCommentStore(fileId)
    setComments(store.list())
  }, [fileId])

  const handleAdd = async () => {
    const body = newBody.trim()
    if (!body) return
    const anchor = anchorCtx || { type: 'slide', slide_id: '', snapshot: '' }
    setBusy(true)
    try {
      const c = await api.createComment(fileId, anchor, authorId, body)
      const store = getCommentStore(fileId)
      store.addComment(anchor, authorId, body)
      setComments(store.list())
      setNewBody('')
    } catch (err) {
      console.error('createComment failed', err)
    } finally {
      setBusy(false)
    }
  }

  const handleUpdated = useCallback((updated) => {
    const store = getCommentStore(fileId)
    // The store already has the change; just re-read.
    setComments(store.list())
  }, [fileId])

  const handleDeleted = useCallback((commentId) => {
    setComments((prev) => prev.filter((c) => c.id !== commentId))
  }, [])

  const filtered = filter === 'all'
    ? comments
    : comments.filter((c) => c.state === filter)

  return (
    <div className="w-72 flex-shrink-0 border-l border-gray-200 bg-gray-50 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-200 bg-white flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <MessageSquare size={15} className="text-indigo-500" />
          <span className="text-sm font-semibold text-gray-800">Comments</span>
          {comments.length > 0 && (
            <span className="text-[10px] bg-indigo-100 text-indigo-700 rounded-full px-1.5 py-0.5 font-medium">
              {comments.length}
            </span>
          )}
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition">
          <X size={15} />
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex border-b border-gray-200 bg-white flex-shrink-0">
        {[['all', 'All'], ['open', 'Open'], ['resolved', 'Resolved']].map(([v, label]) => (
          <button
            key={v}
            onClick={() => setFilter(v)}
            className={`flex-1 py-1.5 text-xs font-medium transition-colors ${filter === v ? 'text-indigo-600 border-b-2 border-indigo-500' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* New comment input */}
      <div className="p-3 border-b border-gray-200 bg-white flex-shrink-0 space-y-1.5">
        {anchorCtx && (
          <p className="text-[10px] text-indigo-500 truncate" title={anchorLabel(anchorCtx)}>
            Anchor: {anchorLabel(anchorCtx)}
          </p>
        )}
        <textarea
          ref={textareaRef}
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAdd() } }}
          rows={2}
          placeholder="Add a comment…"
          className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-300"
        />
        <button
          onClick={handleAdd}
          disabled={!newBody.trim() || busy}
          className="w-full py-1.5 text-xs font-medium bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 transition"
        >
          {busy ? 'Posting…' : 'Post Comment'}
        </button>
      </div>

      {/* Comment list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {loading && (
          <p className="text-xs text-gray-400 text-center py-4">Loading…</p>
        )}
        {!loading && filtered.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-8">
            {filter === 'all' ? 'No comments yet.' : `No ${filter} comments.`}
          </p>
        )}
        {filtered.map((item) => (
          <CommentItem
            key={item.id}
            item={item}
            fileId={fileId}
            authorId={authorId}
            onUpdated={handleUpdated}
            onDeleted={handleDeleted}
          />
        ))}
      </div>
    </div>
  )
}
