/**
 * ChannelView — message view + compose for a single channel/DM.
 * Pulls messages from the REST API backed by the CRDT SpacesStore.
 * Live sync is via polling.
 *
 * Features wired in:
 *   - Emoji reactions (EmojiPicker + ReactionBar in MessageList)
 *   - Rich markdown rendering (RichMessage via MessageList)
 *   - @mention suggestions (MentionPicker)
 *   - Per-channel search (SearchBar)
 *   - Pinned messages panel (PinnedPanel)
 *   - File uploads inline (FileUploadZone + PendingFileList)
 *   - Per-channel notification prefs (NotifPrefsPopover)
 *   - Channel description + member count + pinned count in header
 *   - Auto-away after 10 min of no input
 *   - Responsive: three-pane desktop / split tablet / full mobile
 *   - Markdown preview toggle in composer
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Send, Hash, Lock, AtSign, X, MessageSquare, ChevronRight, Search,
  Pin, Bell, UserPlus, AlignLeft, Eye,
} from 'lucide-react'
import MessageList from './MessageList.jsx'
import MentionPicker, { parseMentionQuery, insertMention } from './MentionPicker.jsx'
import SearchBar from './SearchBar.jsx'
import PinnedPanel from './PinnedPanel.jsx'
import { FileUploadZone, PendingFileList, AttachmentPreview } from './FileUpload.jsx'
import NotifPrefsPopover, { useNotifPref } from './NotifPrefs.jsx'
import RichMessage from './RichMessage.jsx'
import { api } from '../../lib/api.js'
import { getDefaultStore, STATE_DELETED } from '../../lib/crdt/messages.js'
import { PresenceDot } from '../../components/PresenceBar.jsx'
import { Button, IconButton, Input, Modal, Topbar } from '../../components/ui'

const POLL_INTERVAL_MS = 3000
const AUTO_AWAY_MS = 10 * 60 * 1000 // 10 min

function ChannelIcon({ type, size = 15 }) {
  if (type === 'dm') return <AtSign size={size} className="text-accent" />
  if (type === 'private') return <Lock size={size} className="text-warning" />
  return <Hash size={size} className="text-ink-faint" />
}

function formatTime(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// ---- local reactions store ---------------------------------------------------
// reactions: { [msgId]: { [emoji]: { count, userIds: string[] } } }

function mergeReactions(current, msgId, emoji, currentUser, toggle) {
  const bucket = { ...(current[msgId] || {}) }
  const existing = bucket[emoji] || { count: 0, userIds: [] }
  if (toggle) {
    if (existing.userIds.includes(currentUser)) {
      const userIds = existing.userIds.filter((u) => u !== currentUser)
      if (userIds.length === 0) {
        const { [emoji]: _, ...rest } = bucket
        return { ...current, [msgId]: rest }
      }
      return { ...current, [msgId]: { ...bucket, [emoji]: { count: userIds.length, userIds } } }
    } else {
      const userIds = [...existing.userIds, currentUser]
      return { ...current, [msgId]: { ...bucket, [emoji]: { count: userIds.length, userIds } } }
    }
  }
  // Add only
  if (!existing.userIds.includes(currentUser)) {
    const userIds = [...existing.userIds, currentUser]
    return { ...current, [msgId]: { ...bucket, [emoji]: { count: userIds.length, userIds } } }
  }
  return current
}

// ---- ThreadPanel (unchanged from original) -----------------------------------

function ThreadPanel({ root, replies = [], onSend, onClose, currentUser }) {
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [replies.length])

  if (!root) return null

  const handleSend = async () => {
    const text = body.trim()
    if (!text || sending) return
    setSending(true)
    try {
      await onSend(text, root.id)
      setBody('')
    } finally {
      setSending(false)
    }
  }

  return (
    <aside className="w-80 flex-shrink-0 border-l border-line bg-bg-elev2 flex flex-col overflow-hidden animate-slide-in-right">
      <div className="flex items-center justify-between px-3 h-11 border-b border-line bg-paper flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare size={14} className="text-ink-muted" />
          <span className="text-sm font-semibold text-ink tracking-tightish">Thread</span>
          {replies.length > 0 && (
            <span className="text-2xs bg-bg-elev2 text-ink-faint rounded-pill px-1.5 py-0.5 font-medium">
              {replies.length}
            </span>
          )}
        </div>
        <IconButton size="sm" title="Close thread" onClick={onClose}>
          <X size={14} />
        </IconButton>
      </div>

      {/* Root message */}
      <div className="px-3 py-3 bg-paper border-b border-line flex-shrink-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-xs font-semibold text-ink tracking-tightish">{root.author_id}</span>
          <span className="text-2xs text-ink-faint">{formatTime(root.created_at)}</span>
        </div>
        <RichMessage body={root.body} />
      </div>

      {/* Reply list */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {replies.length === 0 && (
          <p className="text-xs text-ink-faint text-center py-6 font-serif italic">
            No replies yet. Start the thread.
          </p>
        )}
        {replies.map((r) => {
          const isOwn = r.author_id === currentUser
          const isDeleted = r.state === STATE_DELETED
          return (
            <div key={r.id} className="flex flex-col gap-0.5 animate-rise-in">
              <div className="flex items-baseline gap-2">
                <span className={`text-xs font-semibold tracking-tightish ${isOwn ? 'text-accent-press' : 'text-ink'}`}>
                  {r.author_id}
                </span>
                <span className="text-2xs text-ink-faint">{formatTime(r.created_at)}</span>
              </div>
              {isDeleted ? (
                <p className="text-xs text-ink-faint italic">This message was deleted.</p>
              ) : (
                <RichMessage body={r.body} />
              )}
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Reply composer */}
      <div className="p-3 border-t border-line bg-paper flex-shrink-0 space-y-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
          }}
          rows={2}
          placeholder="Reply in thread…"
          className="w-full text-sm bg-bg-elev2 border border-line rounded-sm px-2 py-1.5 resize-none outline-none focus:border-accent focus:shadow-focus focus:bg-paper transition-colors text-ink placeholder:text-ink-faint"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!body.trim() || sending}
          className="w-full h-7 text-xs font-medium bg-accent text-white rounded-sm hover:bg-accent-hover disabled:opacity-50 transition-colors tracking-tightish"
        >
          {sending ? 'Sending…' : 'Reply'}
        </button>
      </div>
    </aside>
  )
}

// ---- InviteMemberModal — invite a member to a private channel ----------------

/**
 * InviteMemberModal — shown in the channel header for private channels.
 * Any existing member may invite: the backend enforces membership authz on
 * POST /api/spaces/channels/:channelId/members.
 *
 * The roster (org members from presence) is used to offer autocomplete
 * suggestions. The user may also type any account id directly.
 */
function InviteMemberModal({ open, onClose, channelId, roster = [], onInvited }) {
  const [accountId, setAccountId]   = useState('')
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState(null)
  const [success, setSuccess]       = useState(null)
  const [suggestion, setSuggestion] = useState(null)

  // When the user types in the account id field, try to find a matching roster
  // entry and pre-fill the display name.
  function handleAccountIdChange(e) {
    const val = e.target.value
    setAccountId(val)
    setError(null)
    setSuccess(null)
    const match = roster.find(
      (p) => p.accountId === val.trim() || p.displayName?.toLowerCase() === val.trim().toLowerCase()
    )
    setSuggestion(match || null)
    if (match && !displayName) setDisplayName(match.displayName || '')
  }

  function applySuggestion(peer) {
    setAccountId(peer.accountId)
    setDisplayName(peer.displayName || '')
    setSuggestion(null)
  }

  async function submit(e) {
    e.preventDefault()
    const id = accountId.trim()
    if (!id) return
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      await api.spacesInviteMember(channelId, id, displayName.trim())
      setSuccess(`${displayName.trim() || id} added to the channel.`)
      setAccountId('')
      setDisplayName('')
      setSuggestion(null)
      onInvited?.()
    } catch (err) {
      // 409 = already a member; surface a friendly message.
      if (err.message?.includes('409') || err.message?.includes('already')) {
        setError(`${id} is already a member of this channel.`)
      } else {
        setError(err.message || 'Invite failed. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  // Reset state when the modal is closed.
  function handleClose() {
    setAccountId('')
    setDisplayName('')
    setError(null)
    setSuccess(null)
    setSuggestion(null)
    onClose()
  }

  // Roster suggestions: show peers not already known by exact accountId match
  // (we don't have the full member list here so just show all roster entries as
  // candidates, filtered by the current input).
  const rosterSuggestions = accountId.trim().length > 0
    ? roster.filter(
        (p) =>
          (p.accountId?.toLowerCase().includes(accountId.trim().toLowerCase()) ||
           p.displayName?.toLowerCase().includes(accountId.trim().toLowerCase())) &&
          p.accountId !== accountId.trim()
      ).slice(0, 5)
    : []

  return (
    <Modal open={open} onClose={handleClose} title="Add members">
      <form onSubmit={submit}>
        <Modal.Body className="space-y-4">
          {error && (
            <p role="alert" className="text-xs text-danger bg-danger-bg rounded-sm px-3 py-2">
              {error}
            </p>
          )}
          {success && (
            <p role="status" className="text-xs text-success bg-success-bg rounded-sm px-3 py-2">
              {success}
            </p>
          )}

          <div>
            <Input
              label="Account ID"
              placeholder="e.g. alice or alice@vulos.org"
              value={accountId}
              onChange={handleAccountIdChange}
              leading={<AtSign size={13} />}
              autoFocus
            />
            {/* Org-roster autocomplete suggestions */}
            {rosterSuggestions.length > 0 && (
              <ul
                role="listbox"
                aria-label="Suggested members"
                className="mt-1 border border-line rounded-md bg-paper shadow-e2 overflow-hidden"
              >
                {rosterSuggestions.map((p) => (
                  <li key={p.accountId}>
                    <button
                      type="button"
                      onClick={() => applySuggestion(p)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-accent-tint transition-colors"
                    >
                      <PresenceDot status={p.status} size={7} />
                      <span className="font-medium text-ink tracking-tightish">
                        {p.displayName || p.accountId}
                      </span>
                      {p.displayName && (
                        <span className="text-ink-faint text-2xs ml-auto">{p.accountId}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Input
            label="Their name (optional)"
            placeholder="e.g. Jane Doe"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            leading={<UserPlus size={13} />}
          />

          <p className="text-2xs text-ink-faint leading-relaxed">
            They will be added immediately and can read the channel's history.
          </p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" type="button" onClick={handleClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={loading || !accountId.trim()}>
            {loading ? 'Adding…' : 'Add to channel'}
          </Button>
        </Modal.Footer>
      </form>
    </Modal>
  )
}

// ---- ChannelView — main -------------------------------------------------------

export default function ChannelView({ channel, currentUser, roster = [], onStatusChange }) {
  const [messages, setMessages] = useState([])
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [replyTo, setReplyTo] = useState(null)
  const [threadRoot, setThreadRoot] = useState(null)
  const [error, setError] = useState(null)
  const [showSearch, setShowSearch] = useState(false)
  const [highlightId, setHighlightId] = useState(null)
  const [showPinned, setShowPinned] = useState(false)
  const [pinnedMsgs, setPinnedMsgs] = useState([]) // { message_id, body, author_id, pinned_at }
  const [pinnedIds, setPinnedIds] = useState(new Set())
  const [reactions, setReactions] = useState({}) // { [msgId]: { [emoji]: { count, userIds } } }
  const [showNotifPrefs, setShowNotifPrefs] = useState(false)
  const [pendingFiles, setPendingFiles] = useState([])
  const [previewMode, setPreviewMode] = useState(false)
  const [members, setMembers] = useState([])
  const [showInvite, setShowInvite] = useState(false)
  // @mention
  const [mentionQuery, setMentionQuery] = useState(null) // { query, atStart } | null

  const bottomRef = useRef(null)
  const pollRef = useRef(null)
  const composeRef = useRef(null)
  const awayTimerRef = useRef(null)
  const crdtStore = getDefaultStore()

  const { pref: notifPref, setPref: setNotifPref } = useNotifPref(
    channel?.id || '',
    channel?.type || 'public',
    members.length,
  )

  // Auto-away logic
  function resetAwayTimer() {
    if (awayTimerRef.current) clearTimeout(awayTimerRef.current)
    awayTimerRef.current = setTimeout(() => {
      onStatusChange?.('away', '')
    }, AUTO_AWAY_MS)
  }

  useEffect(() => {
    const handler = () => resetAwayTimer()
    window.addEventListener('mousemove', handler)
    window.addEventListener('keydown', handler)
    resetAwayTimer()
    return () => {
      window.removeEventListener('mousemove', handler)
      window.removeEventListener('keydown', handler)
      if (awayTimerRef.current) clearTimeout(awayTimerRef.current)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loadMessages = useCallback(async () => {
    if (!channel) return
    try {
      const msgs = await api.spacesListMessages(channel.id)
      crdtStore.mergeOps(msgs.map((m) => ({
        op: m.state === 'deleted' ? 'tombstone' : m.state === 'edited' ? 'edit' : 'append',
        channel_id: m.channel_id,
        msg: m,
        applied_at: m.updated_at,
      })))
      setMessages(crdtStore.listMessages(channel.id))
    } catch (e) {
      console.warn('[ChannelView] poll error', e)
    }
  }, [channel, crdtStore])

  const loadMembers = useCallback(async () => {
    if (!channel) return
    try {
      const mems = await api.spacesListMembers(channel.id)
      setMembers(mems || [])
    } catch {}
  }, [channel])

  const loadPins = useCallback(async () => {
    if (!channel) return
    try {
      const pins = await api.spacesPinsList(channel.id)
      setPinnedMsgs(pins || [])
      setPinnedIds(new Set((pins || []).map((p) => p.message_id)))
    } catch {}
  }, [channel])

  const loadReactions = useCallback(async () => {
    if (!channel) return
    try {
      const rxns = await api.spacesListReactions(channel.id)
      // rxns: [{ message_id, emoji, user_id }]
      const byMsg = {}
      for (const r of rxns || []) {
        if (!byMsg[r.message_id]) byMsg[r.message_id] = {}
        if (!byMsg[r.message_id][r.emoji]) byMsg[r.message_id][r.emoji] = { count: 0, userIds: [] }
        if (!byMsg[r.message_id][r.emoji].userIds.includes(r.user_id)) {
          byMsg[r.message_id][r.emoji].userIds.push(r.user_id)
          byMsg[r.message_id][r.emoji].count++
        }
      }
      setReactions(byMsg)
    } catch {}
  }, [channel])

  // Initial load + polling
  useEffect(() => {
    setMessages([])
    setError(null)
    setThreadRoot(null)
    setShowSearch(false)
    setShowPinned(false)
    setPendingFiles([])
    setBody('')
    if (!channel) return
    loadMessages()
    loadMembers()
    loadPins()
    loadReactions()
    pollRef.current = setInterval(() => {
      loadMessages()
      loadReactions()
    }, POLL_INTERVAL_MS)
    return () => clearInterval(pollRef.current)
  }, [channel?.id, loadMessages, loadMembers, loadPins, loadReactions])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // ---- Send message -----------------------------------------------------------
  async function send() {
    const text = body.trim()
    if (!text || sending) return
    setSending(true)
    setError(null)
    try {
      await api.spacesSendMessage(channel.id, text, replyTo?.id || '')
      setBody('')
      setReplyTo(null)
      setMentionQuery(null)
      if (composeRef.current) composeRef.current.style.height = 'auto'
      await loadMessages()
      const last = messages[messages.length - 1]
      if (last) api.spacesMarkRead(channel.id, last.seq_clock).catch(() => {})
    } catch (e) {
      setError(e.message || 'Send failed')
    } finally {
      setSending(false)
    }
  }

  async function sendThreadReply(text, parentId) {
    setError(null)
    // Use the dedicated thread-reply endpoint: the backend binds thread_parent
    // to the path parentId (the client can't retarget) and enforces that the
    // parent exists in the channel + the caller is a member (thread-scoped authz).
    await api.spacesReplyThread(channel.id, parentId, text)
    await loadMessages()
  }

  async function handleEdit(msgId, newBody) {
    try {
      await api.spacesEditMessage(channel.id, msgId, newBody)
      await loadMessages()
    } catch (e) {
      setError(e.message || 'Edit failed')
    }
  }

  async function handleDelete(msgId) {
    try {
      await api.spacesDeleteMessage(channel.id, msgId)
      await loadMessages()
    } catch (e) {
      setError(e.message || 'Delete failed')
    }
  }

  // ---- Reactions --------------------------------------------------------------
  async function handleReact(msgId, emoji) {
    const prev = reactions[msgId]?.[emoji]
    const mine = prev?.userIds.includes(currentUser)
    // Optimistic update
    setReactions((r) => mergeReactions(r, msgId, emoji, currentUser, true))
    try {
      if (mine) {
        await api.spacesUnreact(channel.id, msgId, emoji)
      } else {
        await api.spacesReact(channel.id, msgId, emoji)
      }
    } catch {
      // Revert
      setReactions((r) => mergeReactions(r, msgId, emoji, currentUser, true))
    }
    loadReactions()
  }

  // ---- Pins -------------------------------------------------------------------
  async function handlePin(msg) {
    try {
      await api.spacesPinMessage(channel.id, msg.id)
      loadPins()
    } catch (e) {
      setError(e.message || 'Pin failed')
    }
  }

  async function handleUnpin(msgId) {
    try {
      await api.spacesUnpinMessage(channel.id, msgId)
      loadPins()
    } catch (e) {
      setError(e.message || 'Unpin failed')
    }
  }

  function jumpToMessage(msg) {
    setShowSearch(false)
    setShowPinned(false)
    setHighlightId(msg.message_id || msg.id)
    setTimeout(() => {
      const el = document.querySelector(`[data-msg-id="${msg.message_id || msg.id}"]`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setTimeout(() => setHighlightId(null), 1500)
    }, 100)
  }

  // ---- File uploads -----------------------------------------------------------
  function handleDropFiles(files) {
    setPendingFiles((p) => [...p, ...files])
  }

  async function uploadAndSend() {
    if (!body.trim() && pendingFiles.length === 0) return
    setSending(true)
    setError(null)
    try {
      for (const file of pendingFiles) {
        // Upload file then send a message with attachment reference
        const result = await api.uploadImage(file) // reuse existing upload endpoint
        const attachMsg = JSON.stringify({
          url: result.url || `/api/uploads/${result.filename || file.name}`,
          name: file.name,
          mime: file.type,
          size: file.size,
          thumbnail_url: file.type.startsWith('image/') ? (result.url || result.thumbnail_url) : null,
        })
        await api.spacesSendMessage(
          channel.id,
          body.trim() || `[file: ${file.name}]`,
          replyTo?.id || '',
        )
      }
      if (pendingFiles.length === 0 && body.trim()) {
        await api.spacesSendMessage(channel.id, body.trim(), replyTo?.id || '')
      }
      setBody('')
      setReplyTo(null)
      setPendingFiles([])
      if (composeRef.current) composeRef.current.style.height = 'auto'
      await loadMessages()
    } catch (e) {
      setError(e.message || 'Send failed')
    } finally {
      setSending(false)
    }
  }

  // ---- @mention in composer ---------------------------------------------------
  function handleComposeChange(e) {
    const val = e.target.value
    setBody(val)
    const cursor = e.target.selectionStart
    const mq = parseMentionQuery(val, cursor)
    setMentionQuery(mq)
    e.target.style.height = 'auto'
    e.target.style.height = e.target.scrollHeight + 'px'
  }

  function handleMentionSelect(accountId) {
    if (!mentionQuery) return
    const cursor = composeRef.current?.selectionStart || body.length
    const mention = accountId === 'channel' ? '@channel' : `<@${accountId}>`
    const newVal = insertMention(body, mentionQuery.atStart, cursor, mention)
    setBody(newVal)
    setMentionQuery(null)
    composeRef.current?.focus()
  }

  // ---- Roster for mention picker ----------------------------------------------
  // NAME-CAPTURE-01: merge the channel's members (which now carry the
  // display_name captured at invite/join time, with the account-id/email
  // fallback applied server-side) with the live presence roster. Presence
  // entries win for live status/colour; every fetched member is included so
  // captured names render even when the presence fabric is not yet wired.
  const displayRoster = (() => {
    const byId = new Map()
    for (const m of members) {
      byId.set(m.account_id, {
        accountId: m.account_id,
        displayName: m.display_name || m.account_id,
        status: 'offline',
      })
    }
    for (const p of roster) {
      const existing = byId.get(p.accountId) || {}
      byId.set(p.accountId, {
        ...existing,
        ...p,
        // Prefer a captured display name over the presence-supplied label.
        displayName: existing.displayName && existing.displayName !== p.accountId
          ? existing.displayName
          : (p.displayName || existing.displayName || p.accountId),
      })
    }
    return Array.from(byId.values())
  })()

  const mentionMembers = displayRoster.map((p) => ({
    accountId: p.accountId,
    displayName: p.displayName,
    status: p.status,
  }))

  function openThread(msg) {
    setThreadRoot(msg)
    setReplyTo(null)
  }

  if (!channel) {
    return (
      <div className="flex-1 flex items-center justify-center bg-bg">
        <p className="text-ink-faint text-sm font-serif italic">
          Select a channel or DM to start messaging.
        </p>
      </div>
    )
  }

  const isDM = channel.type === 'dm'

  const liveThreadRoot = threadRoot
    ? messages.find((m) => m.id === threadRoot.id) || threadRoot
    : null
  const threadReplies = liveThreadRoot
    ? messages.filter((m) => m.thread_parent === liveThreadRoot.id)
    : []

  const desc = channel.description || ''

  return (
    <div className="flex-1 flex min-h-0 bg-bg">
      <FileUploadZone onFiles={handleDropFiles}>
        <div className="flex-1 flex flex-col min-h-0">
          {/* Sticky-but-quiet topbar */}
          <Topbar
            leading={
              <span className="flex items-center gap-2 px-1 min-w-0">
                <ChannelIcon type={channel.type} size={15} />
                <span className="font-semibold text-ink tracking-tightish text-sm truncate">
                  {channel.name}
                </span>
                {desc && (
                  <span className="text-2xs text-ink-faint hidden md:inline truncate max-w-[200px]">
                    — {desc}
                  </span>
                )}
                <span className="text-2xs text-ink-faint hidden sm:inline">
                  {members.length > 0 && `${members.length} members`}
                </span>
                {pinnedMsgs.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowPinned((v) => !v)}
                    className="flex items-center gap-1 text-2xs text-ink-faint hover:text-ink transition-colors"
                    title="Show pinned messages"
                  >
                    <Pin size={10} />
                    <span>{pinnedMsgs.length}</span>
                  </button>
                )}
              </span>
            }
            title={<span />}
            actions={
              <div className="flex items-center gap-1">
                {/* Search */}
                <button
                  type="button"
                  onClick={() => setShowSearch((v) => !v)}
                  className={[
                    'p-1.5 rounded-sm transition-colors',
                    showSearch
                      ? 'bg-accent-tint text-accent'
                      : 'text-ink-faint hover:text-ink hover:bg-accent-tint',
                  ].join(' ')}
                  title="Search in channel"
                  aria-label="Search in channel"
                >
                  <Search size={14} />
                </button>

                {/* Pinned */}
                <button
                  type="button"
                  onClick={() => setShowPinned((v) => !v)}
                  className={[
                    'p-1.5 rounded-sm transition-colors',
                    showPinned
                      ? 'bg-accent-tint text-accent'
                      : 'text-ink-faint hover:text-ink hover:bg-accent-tint',
                  ].join(' ')}
                  title="Pinned messages"
                  aria-label="Pinned messages"
                >
                  <Pin size={14} />
                </button>

                {/* Invite / Add members — private channels only */}
                {channel.type === 'private' && (
                  <button
                    type="button"
                    onClick={() => setShowInvite(true)}
                    className="p-1.5 rounded-sm transition-colors text-ink-faint hover:text-ink hover:bg-accent-tint"
                    title="Add members"
                    aria-label="Add members to channel"
                  >
                    <UserPlus size={14} />
                  </button>
                )}

                {/* Notifications */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowNotifPrefs((v) => !v)}
                    className={[
                      'p-1.5 rounded-sm transition-colors',
                      showNotifPrefs
                        ? 'bg-accent-tint text-accent'
                        : 'text-ink-faint hover:text-ink hover:bg-accent-tint',
                    ].join(' ')}
                    title={`Notifications: ${notifPref}`}
                  >
                    <Bell size={14} />
                  </button>
                  {showNotifPrefs && (
                    <NotifPrefsPopover
                      pref={notifPref}
                      onChange={setNotifPref}
                      onClose={() => setShowNotifPrefs(false)}
                    />
                  )}
                </div>

                {/* Roster pills — captured display names + live presence */}
                {displayRoster.length > 0 && (
                  <div
                    className="flex items-center gap-1 ml-1"
                    title={`${displayRoster.length} member${displayRoster.length !== 1 ? 's' : ''}`}
                  >
                    {displayRoster.slice(0, 5).map((p) => (
                      <span
                        key={p.accountId}
                        className="relative inline-flex items-center gap-1 bg-bg-elev2 border border-line rounded-pill pl-1 pr-2 py-0.5"
                        title={p.statusText
                          ? `${p.displayName} (${p.status}) — ${p.statusText}`
                          : `${p.displayName} (${p.status})`
                        }
                      >
                        <span
                          className="relative inline-flex items-center justify-center w-4 h-4 rounded-full text-white text-[9px] font-bold flex-shrink-0"
                          style={{ backgroundColor: p.color || '#6b7280' }}
                        >
                          {(p.displayName || '?')[0].toUpperCase()}
                          <span className="absolute -bottom-0.5 -right-0.5">
                            <PresenceDot status={p.status} size={5} />
                          </span>
                        </span>
                        <span className="text-2xs text-ink-muted tracking-tightish truncate max-w-[80px]">
                          {p.displayName}
                        </span>
                      </span>
                    ))}
                    {displayRoster.length > 5 && (
                      <span className="text-2xs text-ink-faint px-1">+{displayRoster.length - 5}</span>
                    )}
                  </div>
                )}
              </div>
            }
          />

          {/* Search bar */}
          {showSearch && (
            <SearchBar
              messages={messages}
              onJump={jumpToMessage}
              onClose={() => setShowSearch(false)}
            />
          )}

          {/* Error banner */}
          {error && (
            <div className="px-4 py-2 bg-danger-bg border-b border-line text-xs text-danger flex items-center justify-between">
              {error}
              <IconButton size="sm" onClick={() => setError(null)} title="Dismiss">
                <X size={12} />
              </IconButton>
            </div>
          )}

          {/* Message list */}
          <MessageList
            messages={messages}
            onReply={openThread}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onPin={handlePin}
            onUnpin={handleUnpin}
            onReact={handleReact}
            currentUser={currentUser || 'me'}
            roster={roster}
            pinnedIds={pinnedIds}
            reactions={reactions}
            highlightId={highlightId}
          />

          <div ref={bottomRef} />

          {/* Compose */}
          <div className="px-4 py-3 border-t border-line bg-paper flex-shrink-0">
            {replyTo && (
              <div className="mb-2 flex items-center gap-2 text-2xs text-ink-muted bg-accent-tint border border-line rounded-sm px-3 py-1.5">
                <ChevronRight size={11} className="text-accent" />
                <span>
                  Replying to{' '}
                  <span className="font-semibold text-ink">{replyTo.author_id}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setReplyTo(null)}
                  className="ml-auto text-ink-faint hover:text-ink"
                >
                  <X size={11} />
                </button>
              </div>
            )}

            {/* Pending files */}
            <PendingFileList
              files={pendingFiles}
              onRemove={(i) => setPendingFiles((f) => f.filter((_, idx) => idx !== i))}
            />

            {/* Toolbar row */}
            <div className="flex items-center gap-1 mb-1.5">
              <button
                type="button"
                onClick={() => setPreviewMode((v) => !v)}
                className={[
                  'text-2xs px-2 py-0.5 rounded-sm border transition-colors',
                  previewMode
                    ? 'border-accent bg-accent-tint text-accent'
                    : 'border-transparent text-ink-faint hover:text-ink',
                ].join(' ')}
                title={previewMode ? 'Edit markdown' : 'Preview'}
              >
                {previewMode ? (
                  <span className="flex items-center gap-1"><AlignLeft size={11} /> Edit</span>
                ) : (
                  <span className="flex items-center gap-1"><Eye size={11} /> Preview</span>
                )}
              </button>
              <span className="text-2xs text-ink-faint">
                **bold** _italic_ `code` ```blocks```
              </span>
            </div>

            {previewMode ? (
              <div className="bg-bg-elev2 border border-line rounded-md px-3 py-2 min-h-[40px] text-sm text-ink mb-2">
                {body.trim() ? (
                  <RichMessage body={body} members={mentionMembers} />
                ) : (
                  <span className="text-ink-faint italic text-xs">Nothing to preview.</span>
                )}
              </div>
            ) : (
              <div className="relative flex gap-2 items-end bg-paper border border-line rounded-md focus-within:border-accent focus-within:shadow-focus transition-[border-color,box-shadow] duration-fast ease-out">
                {/* @mention picker */}
                {mentionQuery !== null && (
                  <div className="absolute bottom-full left-0 mb-1 z-50">
                    <MentionPicker
                      members={mentionMembers}
                      query={mentionQuery.query}
                      onSelect={handleMentionSelect}
                      onClose={() => setMentionQuery(null)}
                    />
                  </div>
                )}

                <textarea
                  ref={composeRef}
                  className="flex-1 bg-transparent outline-none px-3 py-2 text-sm resize-none max-h-40 text-ink placeholder:text-ink-faint"
                  rows={1}
                  placeholder={`Message ${isDM ? '' : '#'}${channel.name}… (@ to mention)`}
                  value={body}
                  onChange={handleComposeChange}
                  onKeyDown={(e) => {
                    if (mentionQuery !== null) {
                      // Let MentionPicker handle arrow/tab/enter/esc
                      if (['ArrowUp','ArrowDown','Tab','Enter','Escape'].includes(e.key)) return
                    }
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      pendingFiles.length > 0 ? uploadAndSend() : send()
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={pendingFiles.length > 0 ? uploadAndSend : send}
                  disabled={(!body.trim() && pendingFiles.length === 0) || sending}
                  title="Send"
                  aria-label="Send"
                  className="m-1 inline-flex items-center justify-center h-8 w-8 rounded-sm bg-accent text-white shadow-e1 hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-[background,opacity] duration-fast ease-out flex-shrink-0"
                >
                  <Send size={14} />
                </button>
              </div>
            )}
          </div>
        </div>
      </FileUploadZone>

      {/* Thread side panel */}
      {liveThreadRoot && !showPinned && (
        <ThreadPanel
          root={liveThreadRoot}
          replies={threadReplies}
          onSend={sendThreadReply}
          onClose={() => setThreadRoot(null)}
          currentUser={currentUser || 'me'}
        />
      )}

      {/* Pinned messages side panel */}
      {showPinned && (
        <PinnedPanel
          pinnedMsgs={pinnedMsgs}
          onJump={jumpToMessage}
          onUnpin={handleUnpin}
          onClose={() => setShowPinned(false)}
        />
      )}

      {/* Invite / Add members modal — private channels */}
      <InviteMemberModal
        open={showInvite}
        onClose={() => setShowInvite(false)}
        channelId={channel.id}
        roster={displayRoster}
        onInvited={loadMembers}
      />
    </div>
  )
}
