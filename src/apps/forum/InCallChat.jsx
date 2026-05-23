/**
 * InCallChat — lightweight in-call chat sidebar (OFFICE-66).
 *
 * Posts messages to the call's originating channel/thread via the Forum API
 * (api.forumSendMessage) and the CRDT MessageStore, so chat persists in Forum
 * history after the call ends.
 *
 * Props:
 *   channelId   — Forum channel/thread id tied to this call session
 *   threadParent — optional parent message id (for meeting-room threads)
 *   identity    — { displayName, vumail } used as author label
 *   onClose     — called when the panel is dismissed
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { Send, X } from 'lucide-react'
import { api } from '../../lib/api.js'
import { getDefaultStore } from '../../lib/crdt/messages.js'

const POLL_MS = 3000

export default function InCallChat({ channelId, threadParent = '', identity, onClose }) {
  const [messages, setMessages] = useState([])
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef(null)
  const pollRef = useRef(null)
  const store = getDefaultStore()

  // Load + merge messages from the channel/thread
  const loadMessages = useCallback(async () => {
    if (!channelId) return
    try {
      const remote = await api.forumListMessages(channelId)
      store.mergeOps(
        remote.map((m) => ({
          op: m.state === 'deleted' ? 'tombstone' : m.state === 'edited' ? 'edit' : 'append',
          channel_id: channelId,
          msg: {
            id: m.id,
            channel_id: channelId,
            thread_parent: m.thread_parent || '',
            author_id: m.author_id,
            body: m.body,
            state: m.state,
            seq_clock: m.seq_clock || '',
            created_at: m.created_at,
            updated_at: m.updated_at,
          },
          applied_at: m.updated_at,
        }))
      )
    } catch (_) {
      // Offline-tolerant: show whatever is in the local CRDT store
    }
    const all = store.listMessages(channelId)
    // When threadParent is set, show only that thread; otherwise show the full channel
    const visible = threadParent
      ? all.filter((m) => m.thread_parent === threadParent || m.id === threadParent)
      : all
    setMessages(visible.filter((m) => m.state !== 'deleted'))
  }, [channelId, threadParent, store])

  useEffect(() => {
    loadMessages()
    pollRef.current = setInterval(loadMessages, POLL_MS)
    return () => clearInterval(pollRef.current)
  }, [loadMessages])

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const handleSend = useCallback(async () => {
    const text = body.trim()
    if (!text || !channelId) return
    setSending(true)
    try {
      // Optimistic: add to local CRDT store immediately
      const authorId = identity?.vumail || identity?.displayName || 'you'
      store.send(channelId, authorId, text, threadParent)
      setMessages(
        store
          .listMessages(channelId)
          .filter((m) =>
            threadParent
              ? m.thread_parent === threadParent || m.id === threadParent
              : true
          )
          .filter((m) => m.state !== 'deleted')
      )
      setBody('')
      // Persist to the server so it appears in Forum history
      await api.forumSendMessage(channelId, text, threadParent)
      // Reload to pick up server-assigned ids / clock values
      await loadMessages()
    } catch (e) {
      console.error('[InCallChat] send failed', e)
    } finally {
      setSending(false)
    }
  }, [body, channelId, threadParent, identity, store, loadMessages])

  const handleKey = useCallback(
    (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  return (
    <aside className="w-72 flex flex-col border-l border-gray-800 bg-gray-900 text-white text-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 shrink-0">
        <span className="font-semibold text-gray-200">In-call chat</span>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
            title="Close chat"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {messages.length === 0 && (
          <p className="text-gray-500 text-xs text-center mt-4">
            No messages yet. Chat here — messages persist in Forum after the call.
          </p>
        )}
        {messages.map((m) => (
          <ChatMessage key={m.id} message={m} selfId={identity?.vumail || identity?.displayName} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="shrink-0 px-3 py-2 border-t border-gray-800 flex gap-2 items-end">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Message…"
          rows={2}
          className="flex-1 resize-none bg-gray-800 text-white placeholder-gray-500 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          onClick={handleSend}
          disabled={!body.trim() || sending}
          className="p-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded flex items-center justify-center"
          title="Send"
        >
          <Send size={14} />
        </button>
      </div>
    </aside>
  )
}

function ChatMessage({ message, selfId }) {
  const isSelf = message.author_id === selfId
  return (
    <div className={`flex flex-col ${isSelf ? 'items-end' : 'items-start'}`}>
      <span className="text-[10px] text-gray-500 mb-0.5">
        {isSelf ? 'You' : message.author_id}
      </span>
      <div
        className={`max-w-[90%] px-2 py-1 rounded text-xs leading-relaxed whitespace-pre-wrap break-words ${
          isSelf ? 'bg-blue-700 text-white' : 'bg-gray-700 text-gray-100'
        }`}
      >
        {message.body}
      </div>
    </div>
  )
}
