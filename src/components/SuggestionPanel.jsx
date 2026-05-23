/**
 * SuggestionPanel — OFFICE-27
 *
 * Side-panel showing pending suggestions (track-changes) for a Docs file.
 * Reviewers can accept (folds into doc) or reject (discards) each suggestion.
 *
 * Props
 * -----
 *   fileId      {string}   open document id
 *   authorId    {string}   current user id (for display)
 *   editor      {Editor}   TipTap editor instance (used to apply accepts)
 *   onClose     {function} close the panel
 *   suggestions {Array}    current pending suggestions (from parent state)
 *   onAccept    {function(suggestion)} called after accept
 *   onReject    {function(suggestion)} called after reject
 */

import { useState } from 'react'
import { X, Check, XCircle, Type, Trash2, ChevronDown, ChevronUp } from 'lucide-react'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTs(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function kindLabel(kind) {
  return kind === 'insert' ? 'Insertion' : 'Deletion'
}

function kindColor(kind) {
  return kind === 'insert' ? 'text-green-700 bg-green-50 border-green-200' : 'text-red-700 bg-red-50 border-red-200'
}

function stateChip(state) {
  if (state === 'accepted') return <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">Accepted</span>
  if (state === 'rejected') return <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full font-medium">Rejected</span>
  return <span className="text-[10px] bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded-full font-medium">Pending</span>
}

// ---------------------------------------------------------------------------
// SuggestionItem
// ---------------------------------------------------------------------------

function SuggestionItem({ item, authorId, onAccept, onReject, busy }) {
  const [expanded, setExpanded] = useState(true)
  const isPending = item.state === 'pending'
  const isInsert = item.kind === 'insert'

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${isPending ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-100 opacity-70'}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            {isInsert
              ? <Type size={12} className="text-green-600 flex-shrink-0" />
              : <Trash2 size={12} className="text-red-500 flex-shrink-0" />
            }
            <span className="text-xs font-semibold text-gray-700">{item.author_id || 'Anonymous'}</span>
            {stateChip(item.state)}
            <span className="text-[10px] text-gray-400">{formatTs(item.created_at)}</span>
          </div>
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
          {/* Proposed text preview */}
          <div className={`rounded px-2.5 py-1.5 border text-xs font-mono break-all ${kindColor(item.kind)}`}>
            {isInsert ? (
              <span>
                <span className="text-gray-400 text-[10px] mr-1">+</span>
                {item.text || <em className="text-gray-400">empty</em>}
              </span>
            ) : (
              <span>
                <span className="text-gray-400 text-[10px] mr-1">-</span>
                chars {item.from}–{item.to}
              </span>
            )}
          </div>

          {/* Accept / Reject controls (only for pending) */}
          {isPending && (
            <div className="flex items-center gap-2 pt-0.5">
              <button
                onClick={() => onAccept(item)}
                disabled={busy}
                className="flex items-center gap-1 px-2.5 py-1 text-xs bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 transition font-medium"
              >
                <Check size={12} /> Accept
              </button>
              <button
                onClick={() => onReject(item)}
                disabled={busy}
                className="flex items-center gap-1 px-2.5 py-1 text-xs border border-red-300 text-red-600 rounded-md hover:bg-red-50 disabled:opacity-50 transition font-medium"
              >
                <XCircle size={12} /> Reject
              </button>
            </div>
          )}

          {/* Reviewer */}
          {!isPending && item.reviewer_id && (
            <p className="text-[10px] text-gray-400">
              {item.state === 'accepted' ? 'Accepted' : 'Rejected'} by {item.reviewer_id}
            </p>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SuggestionPanel (main export)
// ---------------------------------------------------------------------------

export default function SuggestionPanel({ fileId, authorId = 'You', suggestions = [], onAccept, onReject, onClose }) {
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('pending') // 'all' | 'pending' | 'accepted' | 'rejected'

  const handleAccept = async (item) => {
    setBusy(true)
    try {
      await onAccept(item)
    } finally {
      setBusy(false)
    }
  }

  const handleReject = async (item) => {
    setBusy(true)
    try {
      await onReject(item)
    } finally {
      setBusy(false)
    }
  }

  const filtered = filter === 'all'
    ? suggestions
    : suggestions.filter((s) => s.state === filter)

  const pendingCount = suggestions.filter((s) => s.state === 'pending').length

  return (
    <div className="w-72 flex-shrink-0 border-l border-gray-200 bg-gray-50 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-200 bg-white flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <Type size={15} className="text-green-600" />
          <span className="text-sm font-semibold text-gray-800">Suggestions</span>
          {pendingCount > 0 && (
            <span className="text-[10px] bg-yellow-100 text-yellow-700 rounded-full px-1.5 py-0.5 font-medium">
              {pendingCount}
            </span>
          )}
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition">
          <X size={15} />
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex border-b border-gray-200 bg-white flex-shrink-0">
        {[['pending', 'Pending'], ['all', 'All'], ['accepted', 'Accepted'], ['rejected', 'Rejected']].map(([v, label]) => (
          <button
            key={v}
            onClick={() => setFilter(v)}
            className={`flex-1 py-1.5 text-[10px] font-medium transition-colors ${filter === v ? 'text-indigo-600 border-b-2 border-indigo-500' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Suggestion list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {filtered.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-8">
            {filter === 'pending' ? 'No pending suggestions.' : `No ${filter} suggestions.`}
          </p>
        )}
        {filtered.map((item) => (
          <SuggestionItem
            key={item.id}
            item={item}
            authorId={authorId}
            onAccept={handleAccept}
            onReject={handleReject}
            busy={busy}
          />
        ))}
      </div>

      {/* Help text */}
      <div className="px-3 py-2 border-t border-gray-200 bg-white flex-shrink-0">
        <p className="text-[10px] text-gray-400 leading-relaxed">
          Accepting folds the change into the document. Rejecting discards it.
        </p>
      </div>
    </div>
  )
}
