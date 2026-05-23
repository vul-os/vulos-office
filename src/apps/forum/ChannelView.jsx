/**
 * ChannelView — message view + compose for a single channel/DM.
 * Pulls messages from the REST API backed by the CRDT ForumStore (OFFICE-60).
 * Live sync is via polling (full fabric P2P is OFFICE-20; this plugs in there).
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { Send, Hash, Lock, AtSign, X } from 'lucide-react'
import MessageList from './MessageList.jsx'
import { api } from '../../lib/api.js'
import { getDefaultStore } from '../../lib/crdt/messages.js'
import { PresenceDot } from '../../components/PresenceBar.jsx'

const POLL_INTERVAL_MS = 3000

export default function ChannelView({ channel, currentUser, roster = [] }) {
  const [messages, setMessages] = useState([])
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [replyTo, setReplyTo] = useState(null)
  const [error, setError] = useState(null)
  const bottomRef = useRef(null)
  const pollRef = useRef(null)
  const crdtStore = getDefaultStore()

  const loadMessages = useCallback(async () => {
    if (!channel) return
    try {
      const msgs = await api.forumListMessages(channel.id)
      // Merge into CRDT store so local + remote ops converge
      crdtStore.mergeOps(msgs.map((m) => ({
        op: m.state === 'deleted' ? 'tombstone' : m.state === 'edited' ? 'edit' : 'append',
        channel_id: m.channel_id,
        msg: m,
        applied_at: m.updated_at,
      })))
      setMessages(crdtStore.listMessages(channel.id))
    } catch (e) {
      // On error keep existing messages
      console.warn('[ChannelView] poll error', e)
    }
  }, [channel, crdtStore])

  // Initial load + polling for live updates
  useEffect(() => {
    setMessages([])
    setError(null)
    if (!channel) return
    loadMessages()
    pollRef.current = setInterval(loadMessages, POLL_INTERVAL_MS)
    return () => clearInterval(pollRef.current)
  }, [channel?.id, loadMessages])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  async function send() {
    const text = body.trim()
    if (!text || sending) return
    setSending(true)
    setError(null)
    try {
      await api.forumSendMessage(channel.id, text, replyTo?.id || '')
      setBody('')
      setReplyTo(null)
      await loadMessages()
      // Mark read
      const last = messages[messages.length - 1]
      if (last) api.forumMarkRead(channel.id, last.seq_clock).catch(() => {})
    } catch (e) {
      setError(e.message || 'Send failed')
    } finally {
      setSending(false)
    }
  }

  async function handleEdit(msgId, newBody) {
    try {
      await api.forumEditMessage(channel.id, msgId, newBody)
      await loadMessages()
    } catch (e) {
      setError(e.message || 'Edit failed')
    }
  }

  async function handleDelete(msgId) {
    try {
      await api.forumDeleteMessage(channel.id, msgId)
      await loadMessages()
    } catch (e) {
      setError(e.message || 'Delete failed')
    }
  }

  if (!channel) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        Select a channel or DM to start messaging.
      </div>
    )
  }

  const isDM = channel.type === 'dm'
  const isPrivate = channel.type === 'private'

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-gray-200 bg-white flex-shrink-0">
        {isDM
          ? <AtSign size={16} className="text-indigo-400" />
          : isPrivate
            ? <Lock size={15} className="text-amber-400" />
            : <Hash size={15} className="text-gray-400" />
        }
        <span className="font-semibold text-gray-900">{channel.name}</span>
        <span className="text-xs text-gray-400 ml-1 capitalize">{channel.type}</span>
        {/* OFFICE-62: presence members strip in header */}
        {roster.length > 0 && (
          <div className="ml-auto flex items-center gap-1.5" title={`${roster.length} member${roster.length !== 1 ? 's' : ''} online`}>
            {roster.slice(0, 6).map((p) => (
              <span
                key={p.accountId}
                className="relative inline-flex items-center justify-center w-6 h-6 rounded-full text-white text-xs font-bold flex-shrink-0"
                style={{ backgroundColor: p.color }}
                title={p.statusText ? `${p.displayName} (${p.status}) — ${p.statusText}` : `${p.displayName} (${p.status})`}
              >
                {(p.displayName || '?')[0].toUpperCase()}
                <span className="absolute -bottom-0.5 -right-0.5">
                  <PresenceDot status={p.status} size={6} />
                </span>
              </span>
            ))}
            {roster.length > 6 && (
              <span className="text-xs text-gray-400">+{roster.length - 6}</span>
            )}
          </div>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-sm text-red-600 flex items-center justify-between">
          {error}
          <button onClick={() => setError(null)}><X size={14} /></button>
        </div>
      )}

      {/* Message list */}
      <MessageList
        messages={messages}
        onReply={setReplyTo}
        onEdit={handleEdit}
        onDelete={handleDelete}
        currentUser={currentUser || 'me'}
        roster={roster}
      />

      <div ref={bottomRef} />

      {/* Compose */}
      <div className="px-4 py-3 border-t border-gray-200 bg-white flex-shrink-0">
        {replyTo && (
          <div className="mb-2 flex items-center gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-1.5">
            <span>Replying to <span className="font-semibold">{replyTo.author_id}</span></span>
            <button onClick={() => setReplyTo(null)} className="ml-auto text-gray-400 hover:text-gray-600">
              <X size={12} />
            </button>
          </div>
        )}
        <div className="flex gap-2 items-end">
          <textarea
            className="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent max-h-40"
            rows={1}
            placeholder={`Message ${isDM ? '' : '#'}${channel.name}…`}
            value={body}
            onChange={(e) => {
              setBody(e.target.value)
              // Auto-grow: reset then set to scrollHeight
              e.target.style.height = 'auto'
              e.target.style.height = e.target.scrollHeight + 'px'
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
          />
          <button
            onClick={send}
            disabled={!body.trim() || sending}
            className="p-2.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition flex-shrink-0"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
