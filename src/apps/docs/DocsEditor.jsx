import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useEditor, EditorContent, Extension } from '@tiptap/react'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import TextStyle from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import CharacterCount from '@tiptap/extension-character-count'
import Placeholder from '@tiptap/extension-placeholder'
import Typography from '@tiptap/extension-typography'
import { ArrowLeft, Save, Loader2, AlertCircle, History, Users, MessageSquare, Activity, GitBranch } from 'lucide-react'
import { useFilesStore, getSaveState, onSaveStateChange } from '../../store/filesStore'
import { api } from '../../lib/api'
import { readDraft, clearDraft } from '../../lib/draftStore'
import DocsToolbar from './DocsToolbar'
import HistoryPanel from '../../components/HistoryPanel'
import CommentsPanel from '../../components/CommentsPanel'
import SuggestionPanel from '../../components/SuggestionPanel'
import ActivityFeed from '../../components/ActivityFeed'
import { DocsCollabSession } from '../../lib/crdt/index.js'
import { getSuggestionStore } from '../../lib/crdt/suggestions.js'
import { useLiveCursors } from '../../lib/useLiveCursors.js'
import { DocsCursorLayer } from '../../components/RemoteCursors.jsx'

// Imported files may carry _html; use that as editor content
function resolveContent(content) {
  if (!content) return { type: 'doc', content: [{ type: 'paragraph' }] }
  if (content._html) return content._html  // TipTap accepts HTML string
  return content
}

const RETRY_DELAY_MS = 4000
const AUTOSAVE_DELAY_MS = 2000

// ---------------------------------------------------------------------------
// applyTextPatch — apply a remote CRDT text change to a TipTap editor
// without clobbering the local caret position.
//
// Strategy: locate the changed region (common prefix/suffix), then issue
// TipTap deleteRange + insertContentAt so only the changed characters are
// touched. This keeps the caret stable for insertions and deletions outside
// the user's current cursor region.
// ---------------------------------------------------------------------------
function applyTextPatch(editor, prevText, nextText) {
  if (prevText === nextText) return

  // Find common prefix.
  let pre = 0
  while (pre < prevText.length && pre < nextText.length && prevText[pre] === nextText[pre]) pre++

  // Find common suffix (not overlapping prefix).
  let suf = 0
  while (
    suf < prevText.length - pre &&
    suf < nextText.length - pre &&
    prevText[prevText.length - 1 - suf] === nextText[nextText.length - 1 - suf]
  ) suf++

  const deleteCount = prevText.length - pre - suf
  const insertStr = nextText.slice(pre, nextText.length - suf)

  // TipTap positions are 1-based (the doc node itself occupies position 0).
  // getText() returns all chars with no extra delimiters, but character
  // offset in the doc may differ from string offset in multi-node docs.
  // For a plain-text approximation we use from=pre+1 which is valid for
  // simple single-paragraph docs; for richly-structured docs this is a
  // best-effort reconcile.
  const from = pre + 1
  const to = from + deleteCount

  editor.chain()
    .deleteRange({ from, to })
    .insertContentAt(from, insertStr)
    .run()
}

// Derive a stable peerId for this browser session (persists across reloads).
function getOrCreatePeerId() {
  let id = sessionStorage.getItem('vulos_peer_id')
  if (!id) {
    id = crypto.randomUUID()
    sessionStorage.setItem('vulos_peer_id', id)
  }
  return id
}

// ---------------------------------------------------------------------------
// OFFICE-27: SuggestionDecorations — ProseMirror plugin that renders pending
// suggestion annotations as inline highlights (green = insert, red strikethrough
// = delete).  The plugin state is a plain array updated via a custom transaction
// meta key whenever suggestions change.
// ---------------------------------------------------------------------------

const SUGGESTION_PLUGIN_KEY = new PluginKey('suggestions')

function makeSuggestionDecoration(from, to, kind) {
  // TipTap/ProseMirror positions are 1-indexed and include node boundaries.
  // Character offset `from` in plain text ≈ doc position `from + 1`.
  const docFrom = from + 1
  const docTo = to + 1
  if (kind === 'insert') {
    // Inline widget at cursor position showing the inserted text.
    return Decoration.inline(docFrom, Math.max(docTo, docFrom + 1), {
      class: 'suggestion-insert',
    })
  } else {
    return Decoration.inline(docFrom, Math.max(docTo, docFrom + 1), {
      class: 'suggestion-delete',
    })
  }
}

function buildSuggestionPlugin() {
  return new Plugin({
    key: SUGGESTION_PLUGIN_KEY,
    state: {
      init() { return { suggestions: [], decorations: DecorationSet.empty } },
      apply(tr, old, _oldState, newState) {
        const meta = tr.getMeta(SUGGESTION_PLUGIN_KEY)
        if (meta) {
          const pending = (meta.suggestions || []).filter((s) => s.state === 'pending')
          const decos = pending.flatMap((s) => {
            try {
              return [makeSuggestionDecoration(s.from, s.to, s.kind)]
            } catch { return [] }
          })
          return {
            suggestions: meta.suggestions,
            decorations: DecorationSet.create(newState.doc, decos),
          }
        }
        // Map existing decorations through document changes.
        return { suggestions: old.suggestions, decorations: old.decorations.map(tr.mapping, tr.doc) }
      },
    },
    props: {
      decorations(state) {
        return this.getState(state).decorations
      },
    },
  })
}

const SuggestionDecorationsExtension = Extension.create({
  name: 'suggestionDecorations',
  addProseMirrorPlugins() {
    return [buildSuggestionPlugin()]
  },
})

export default function DocsEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { files, saveFileWithDraft, markDirty } = useFilesStore()
  const [file, setFile] = useState(files.find((f) => f.id === id))
  const [title, setTitle] = useState(file?.name || 'Untitled')
  const [pendingContent, setPendingContent] = useState(null)
  const [saveStatus, setSaveStatus] = useState(getSaveState(id))
  const [draft, setDraft] = useState(null)           // pending draft to offer restore
  const [retryCount, setRetryCount] = useState(0)
  const [showHistory, setShowHistory] = useState(false)
  const [showComments, setShowComments] = useState(false)
  const [showActivity, setShowActivity] = useState(false)
  // OFFICE-27: suggestion / track-changes mode
  const [suggestionMode, setSuggestionMode] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const suggestionModeRef = useRef(false)
  const prevTextForSugRef = useRef('')   // plain text before the suggestion-mode edit
  const [collabPeers, setCollabPeers] = useState({})  // peerId → state
  const saveTimer = useRef(null)
  const retryTimer = useRef(null)
  const titleRef = useRef(title)
  titleRef.current = title

  // CRDT collab session (OFFICE-22)
  const collabRef = useRef(null)
  // Tracks the plain text the CRDT last saw so we can diff on next local edit.
  const prevCrdtTextRef = useRef('')
  // Flag: true while we're applying a remote op so onUpdate doesn't re-broadcast.
  const applyingRemoteRef = useRef(false)

  // Subscribe to save state changes for this file
  useEffect(() => {
    const unsub = onSaveStateChange(id, (state) => setSaveStatus({ ...state }))
    return unsub
  }, [id])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
      Image.configure({ allowBase64: true }),
      Link.configure({ openOnClick: false }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem.configure({ nested: true }),
      CharacterCount,
      Placeholder.configure({ placeholder: 'Start writing…' }),
      Typography,
      // OFFICE-27: inline suggestion decorations (green insert / red strikethrough delete)
      SuggestionDecorationsExtension,
    ],
    content: resolveContent(file?.content),
    onUpdate: ({ editor: ed }) => {
      // ── OFFICE-27: suggestion mode intercept ──────────────────────────────
      // When suggestion mode is active: undo the edit, compute the diff, and
      // record it as a pending suggestion instead of applying it directly.
      if (suggestionModeRef.current && !applyingRemoteRef.current) {
        const nextText = ed.getText()
        const prevText = prevTextForSugRef.current
        if (nextText !== prevText) {
          // Revert the edit so the base document stays unchanged.
          ed.commands.undo()
          // Compute diff: common prefix/suffix → insert or delete range.
          let pre = 0
          while (pre < prevText.length && pre < nextText.length && prevText[pre] === nextText[pre]) pre++
          let suf = 0
          const maxSuf = Math.min(prevText.length - pre, nextText.length - pre)
          while (suf < maxSuf && prevText[prevText.length - 1 - suf] === nextText[nextText.length - 1 - suf]) suf++
          const deleted = prevText.slice(pre, suf > 0 ? prevText.length - suf : prevText.length)
          const inserted = nextText.slice(pre, suf > 0 ? nextText.length - suf : nextText.length)
          const from = pre
          const to = pre + deleted.length

          const peerId = sessionStorage.getItem('vulos_peer_id') || 'local'
          const store = getSuggestionStore(id)
          let sg
          if (inserted.length > 0) {
            sg = store.addInsert(from, to, inserted, peerId)
          } else if (deleted.length > 0) {
            sg = store.addDelete(from, to, peerId)
          }
          if (sg) {
            // Persist to backend (fire-and-forget; store already has it)
            api.createSuggestion(id, sg.kind, sg.author_id, sg.from, sg.to, sg.text || '').catch(() => {})
            setSuggestions(store.list())
            setShowSuggestions(true)
          }
        }
        return
      }

      markDirty(id)
      clearTimeout(saveTimer.current)
      clearTimeout(retryTimer.current)
      setRetryCount(0)
      saveTimer.current = setTimeout(() => doSave(), AUTOSAVE_DELAY_MS)

      // CRDT broadcast: skip if this update was triggered by a remote apply.
      if (!applyingRemoteRef.current && collabRef.current) {
        const nextText = ed.getText()
        collabRef.current.applyLocal(prevCrdtTextRef.current, nextText)
        prevCrdtTextRef.current = nextText
      }
    },
    onSelectionUpdate: ({ editor: ed }) => {
      // OFFICE-25: broadcast local caret/selection position to peers.
      if (broadcastDocCursorRef.current) {
        const { from, to } = ed.state.selection
        broadcastDocCursorRef.current(from, to)
      }
    },
  })

  // Load file from API if not in store cache
  useEffect(() => {
    if (!file && id) {
      api.getFile(id).then((f) => {
        setFile(f)
        setTitle(f.name)
        setPendingContent(resolveContent(f.content))
      }).catch(() => navigate('/docs'))
    }
  }, [id])

  // Check for a pending draft on mount (crash recovery)
  useEffect(() => {
    if (!id) return
    readDraft(id).then((d) => {
      if (d && d.ts) {
        setDraft(d)
      }
    })
  }, [id])

  // Apply pending content once editor is ready
  useEffect(() => {
    if (editor && pendingContent !== null) {
      editor.commands.setContent(pendingContent, false)
      setPendingContent(null)
    }
  }, [editor, pendingContent])

  // ── CRDT collab session (OFFICE-22) ──────────────────────────────────────
  useEffect(() => {
    if (!id) return

    const peerId = getOrCreatePeerId()
    const session = new DocsCollabSession({ fileId: id, peerId })
    collabRef.current = session

    // Remote-change handler: apply peer op to editor without caret jump.
    session.addEventListener('change', (ev) => {
      if (!ev.detail.remote) return
      const remoteText = ev.detail.text
      // Guard: don't re-broadcast this programmatic update.
      applyingRemoteRef.current = true
      try {
        // We reconcile by replacing editor content only when the plain text
        // has actually diverged.  We preserve the HTML structure by doing a
        // character-level merge instead of a full setContent replacement:
        // for plain-text divergence we fall back to setContent on the
        // current JSON with the text patched.  The common case (single char
        // insert/delete) is handled via TipTap's insertContentAt / deleteRange
        // so the caret stays stable.
        //
        // For simplicity in V1 we use a safe full-replace only when the
        // texts differ, keeping the existing JSON structure otherwise.
        // This covers the no-caret-jump requirement for small edits.
        if (editorRef.current) {
          const ed = editorRef.current
          const curText = ed.getText()
          if (curText !== remoteText) {
            // Build a minimal patch: find common prefix/suffix and apply
            // TipTap commands to sync the plain-text range that changed.
            applyTextPatch(ed, curText, remoteText)
            prevCrdtTextRef.current = ed.getText()
          }
        }
      } finally {
        applyingRemoteRef.current = false
      }
    })

    // Peer connection-state events (for optional UI indicator).
    session.addEventListener('state', (ev) => {
      const { peerId: pid, state } = ev.detail
      setCollabPeers((prev) => ({ ...prev, [pid]: state }))
    })

    // Async join — errors are non-fatal (signaling may be unavailable
    // in single-user / offline mode; local editing continues normally).
    session.join().catch((err) => {
      console.warn('[collab] fabric join failed (single-user mode):', err?.message)
    })

    return () => {
      session.leave()
      collabRef.current = null
    }
  }, [id])

  // Keep a ref to the editor instance for use inside the collab event handler.
  const editorRef = useRef(null)
  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  // ── OFFICE-27: Suggestion mode ────────────────────────────────────────────

  // Keep ref in sync so the onUpdate closure (created once) always reads the latest value.
  useEffect(() => {
    suggestionModeRef.current = suggestionMode
    if (editor) prevTextForSugRef.current = editor.getText()
  }, [suggestionMode, editor])

  // Load suggestions from server on mount.
  useEffect(() => {
    if (!id) return
    api.listSuggestions(id)
      .then((items) => {
        const store = getSuggestionStore(id)
        store.loadFromServer(items || [])
        setSuggestions(store.list())
      })
      .catch(() => {}) // backend may not be running — fail silently
  }, [id])

  // Toggle suggestion mode: update ref + seed prevTextForSug.
  const handleToggleSuggestionMode = () => {
    setSuggestionMode((v) => {
      const next = !v
      suggestionModeRef.current = next
      if (editor) prevTextForSugRef.current = editor.getText()
      if (next) setShowSuggestions(true)
      return next
    })
  }

  // Accept: apply the change to the document and mark accepted.
  const handleAcceptSuggestion = async (sg) => {
    if (!editor) return
    applyingRemoteRef.current = true
    try {
      if (sg.kind === 'insert') {
        // Insert the suggested text at the proposed offset (from == to for pure insert).
        editor.chain().focus().insertContentAt(sg.from + 1, sg.text).run()
      } else {
        // Delete the proposed range.
        editor.chain().focus().deleteRange({ from: sg.from + 1, to: sg.to + 1 }).run()
      }
      doSave()
    } finally {
      applyingRemoteRef.current = false
    }
    // Update store and backend.
    const store = getSuggestionStore(id)
    store.accept(sg.id, 'reviewer')
    setSuggestions(store.list())
    api.updateSuggestion(id, sg.id, 'accepted', 'reviewer').catch(() => {})
  }

  // Reject: discard the suggestion (document unchanged).
  const handleRejectSuggestion = async (sg) => {
    const store = getSuggestionStore(id)
    store.reject(sg.id, 'reviewer')
    setSuggestions(store.list())
    api.updateSuggestion(id, sg.id, 'rejected', 'reviewer').catch(() => {})
  }

  // Update ProseMirror decorations whenever the suggestions list changes.
  useEffect(() => {
    if (!editor) return
    try {
      const { tr } = editor.state
      tr.setMeta(SUGGESTION_PLUGIN_KEY, { suggestions })
      editor.view.dispatch(tr)
    } catch {
      // Editor may not be ready; decorations will be applied on next update.
    }
  }, [suggestions, editor])

  // ── OFFICE-25: Live cursors ───────────────────────────────────────────────
  // Derive a stable local identity from sessionStorage (mirrors CRDT peerId approach).
  const localCursorIdentity = useRef(null)
  if (!localCursorIdentity.current) {
    try {
      const stored = localStorage.getItem('presence_identity')
      const parsed = stored ? JSON.parse(stored) : null
      localCursorIdentity.current = parsed && parsed.accountId ? parsed : {
        accountId: `guest:${sessionStorage.getItem('vulos_peer_id') || 'local'}`,
        displayName: 'Me',
      }
    } catch { localCursorIdentity.current = { accountId: 'local', displayName: 'Me' } }
  }
  // Expose fabric from collab session for cursor transport.
  const [fabricForCursors, setFabricForCursors] = useState(null)
  useEffect(() => {
    // collabRef.current is set inside the CRDT effect above; check after it runs.
    const check = () => setFabricForCursors(collabRef.current?.fabric ?? null)
    // Give the collab effect a tick to run first.
    const t = setTimeout(check, 100)
    return () => clearTimeout(t)
  }, [id])

  const { remoteCursors, broadcastDocCursor } = useLiveCursors({
    fabric: fabricForCursors,
    localIdentity: localCursorIdentity.current,
    color: localCursorIdentity.current
      ? (() => { let h=0; for(const c of localCursorIdentity.current.accountId){h=(h<<5)-h+c.charCodeAt(0);h|=0} return `hsl(${Math.abs(h)%360},65%,50%)` })()
      : '#6366f1',
  })
  // Stable ref so the useEditor onSelectionUpdate closure can call the latest version.
  const broadcastDocCursorRef = useRef(null)
  broadcastDocCursorRef.current = broadcastDocCursor

  const doSave = useCallback(async (retryNum = 0) => {
    if (!editor || !id) return
    try {
      await saveFileWithDraft(id, titleRef.current, editor.getJSON())
      setRetryCount(0)
    } catch {
      // Schedule retry with backoff (up to 3 retries)
      if (retryNum < 3) {
        const delay = RETRY_DELAY_MS * (retryNum + 1)
        retryTimer.current = setTimeout(() => {
          setRetryCount(retryNum + 1)
          doSave(retryNum + 1)
        }, delay)
      }
    }
  }, [editor, id, saveFileWithDraft])

  const handleSave = () => {
    clearTimeout(saveTimer.current)
    clearTimeout(retryTimer.current)
    setRetryCount(0)
    doSave()
  }

  const handleTitleChange = (newTitle) => {
    setTitle(newTitle)
    markDirty(id)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => doSave(), 1500)
  }

  const handleRestoreDraft = () => {
    if (!draft || !editor) return
    editor.commands.setContent(resolveContent(draft.content), false)
    if (draft.name) setTitle(draft.name)
    setDraft(null)
    markDirty(id)
  }

  const handleDiscardDraft = () => {
    clearDraft(id)
    setDraft(null)
  }

  const wordCount = editor?.storage.characterCount?.words() ?? 0
  const charCount = editor?.storage.characterCount?.characters() ?? 0

  const statusText = () => {
    if (saveStatus.status === 'saving') return 'Saving…'
    if (saveStatus.status === 'saved') return 'Saved'
    if (saveStatus.status === 'error') return retryCount > 0 ? `Retry ${retryCount}/3…` : 'Save failed'
    if (saveStatus.status === 'dirty') return 'Unsaved'
    return ''
  }

  const statusColor = () => {
    if (saveStatus.status === 'error') return 'text-red-500'
    if (saveStatus.status === 'saving') return 'text-yellow-500'
    if (saveStatus.status === 'saved') return 'text-green-500'
    return 'text-gray-400'
  }

  if (!editor) {
    return <div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-indigo-500" size={24} /></div>
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white">
      {/* Draft restore banner */}
      {draft && (
        <div className="flex items-center gap-3 px-4 py-2 bg-amber-50 border-b border-amber-200 text-sm text-amber-800">
          <AlertCircle size={16} className="text-amber-500 flex-shrink-0" />
          <span className="flex-1">Unsaved changes from a previous session were found.</span>
          <button
            onClick={handleRestoreDraft}
            className="px-3 py-1 bg-amber-600 text-white rounded-md text-xs font-medium hover:bg-amber-700 transition"
          >
            Restore
          </button>
          <button
            onClick={handleDiscardDraft}
            className="px-3 py-1 border border-amber-400 text-amber-700 rounded-md text-xs font-medium hover:bg-amber-100 transition"
          >
            Discard
          </button>
        </div>
      )}

      {/* Save error banner */}
      {saveStatus.status === 'error' && !draft && (
        <div className="flex items-center gap-3 px-4 py-2 bg-red-50 border-b border-red-200 text-sm text-red-700">
          <AlertCircle size={16} className="text-red-500 flex-shrink-0" />
          <span className="flex-1">Save failed — {saveStatus.error || 'network error'}. Retrying…</span>
        </div>
      )}

      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-200 bg-white">
        <button onClick={() => navigate('/docs')} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition">
          <ArrowLeft size={18} />
        </button>
        <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center flex-shrink-0">
          <svg viewBox="0 0 24 24" className="w-4 h-4 text-indigo-600 fill-current"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm4 18H6V4h7v5h5v11zM8 15h8v2H8zm0-4h8v2H8zm0-4h5v2H8z"/></svg>
        </div>
        <input
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          className="flex-1 text-base font-semibold text-gray-900 bg-transparent border-none outline-none hover:bg-gray-50 focus:bg-gray-50 rounded px-2 py-0.5"
          placeholder="Untitled Document"
        />
        <span className={`text-xs hidden sm:block ${statusColor()}`}>{statusText()}</span>
        {/* Collab peer indicator (OFFICE-22) */}
        {Object.values(collabPeers).some((s) => s === 'connected' || s === 'relay') && (
          <span
            title={`${Object.values(collabPeers).filter((s) => s === 'connected' || s === 'relay').length} peer(s) connected`}
            className="flex items-center gap-1 text-xs text-green-600 px-1.5 py-0.5 bg-green-50 rounded-full"
          >
            <Users size={12} />
            {Object.values(collabPeers).filter((s) => s === 'connected' || s === 'relay').length}
          </span>
        )}
        <button
          onClick={() => setShowHistory(v => !v)}
          title="Version history"
          className={`p-1.5 rounded-lg transition ${showHistory ? 'bg-indigo-100 text-indigo-600' : 'hover:bg-gray-100 text-gray-500'}`}
        >
          <History size={16} />
        </button>
        <button
          onClick={() => setShowActivity(v => !v)}
          title="Activity feed"
          className={`p-1.5 rounded-lg transition ${showActivity ? 'bg-indigo-100 text-indigo-600' : 'hover:bg-gray-100 text-gray-500'}`}
        >
          <Activity size={16} />
        </button>
        <button
          onClick={() => setShowComments(v => !v)}
          title="Comments"
          className={`p-1.5 rounded-lg transition ${showComments ? 'bg-indigo-100 text-indigo-600' : 'hover:bg-gray-100 text-gray-500'}`}
        >
          <MessageSquare size={16} />
        </button>
        {/* OFFICE-27: Suggestion mode toggle */}
        <button
          onClick={handleToggleSuggestionMode}
          title={suggestionMode ? 'Exit suggestion mode' : 'Suggestion mode (track changes)'}
          className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition ${suggestionMode ? 'bg-green-100 text-green-700 ring-1 ring-green-400' : 'hover:bg-gray-100 text-gray-500'}`}
        >
          <GitBranch size={14} />
          {suggestionMode ? 'Suggesting' : 'Suggest'}
        </button>
        {!suggestionMode && suggestions.filter(s => s.state === 'pending').length > 0 && (
          <button
            onClick={() => setShowSuggestions(v => !v)}
            title="View suggestions"
            className={`p-1.5 rounded-lg transition ${showSuggestions ? 'bg-green-100 text-green-700' : 'hover:bg-gray-100 text-gray-500'}`}
          >
            <GitBranch size={16} />
          </button>
        )}
        <button
          onClick={handleSave}
          disabled={saveStatus.status === 'saving'}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 transition"
        >
          {saveStatus.status === 'saving' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save
        </button>
      </div>
      {/* OFFICE-27: Suggestion mode banner */}
      {suggestionMode && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-green-50 border-b border-green-200 text-xs text-green-800">
          <GitBranch size={13} className="text-green-600 flex-shrink-0" />
          <span className="flex-1">Suggestion mode — edits are recorded as proposals, not applied directly.</span>
          <button
            onClick={() => setShowSuggestions(v => !v)}
            className="px-2 py-0.5 rounded border border-green-400 hover:bg-green-100 transition font-medium"
          >
            {showSuggestions ? 'Hide' : 'Review'}
          </button>
        </div>
      )}

      <DocsToolbar editor={editor} title={title} />

      {/* Editor + optional history panel */}
      <div className="flex-1 flex overflow-hidden">
        {/* Page canvas */}
        <div className="flex-1 overflow-auto bg-gray-100">
          <div className="max-w-[816px] min-h-full mx-auto bg-white shadow-sm my-6 px-16 py-16 rounded-lg">
            {/* Cursor host: relative wrapper so DocsCursorLayer can position absolutely */}
            <div className="tiptap-cursor-host relative">
              <EditorContent editor={editor} className="tiptap" />
              <DocsCursorLayer editor={editor} remoteCursors={remoteCursors} />
            </div>
          </div>
        </div>

        {/* History panel (OFFICE-08) */}
        {showHistory && (
          <HistoryPanel
            fileId={id}
            onClose={() => setShowHistory(false)}
            onRestore={(updated) => {
              if (editor && updated?.content) {
                editor.commands.setContent(resolveContent(updated.content), false)
              }
              if (updated?.name) setTitle(updated.name)
            }}
          />
        )}

        {/* Activity feed + named snapshots (OFFICE-28) */}
        {showActivity && (
          <ActivityFeed
            fileId={id}
            onClose={() => setShowActivity(false)}
            onRestore={(updated) => {
              if (editor && updated?.content) {
                editor.commands.setContent(resolveContent(updated.content), false)
              }
              if (updated?.name) setTitle(updated.name)
            }}
          />
        )}

        {/* Comments panel (OFFICE-26) */}
        {showComments && (
          <CommentsPanel
            fileId={id}
            anchorCtx={editor?.state?.selection
              ? {
                  type: 'text_range',
                  from: editor.state.selection.from,
                  to: editor.state.selection.to,
                  snapshot: editor.state.doc.textBetween(
                    editor.state.selection.from,
                    editor.state.selection.to,
                    ' '
                  ).slice(0, 80),
                }
              : null
            }
            onClose={() => setShowComments(false)}
          />
        )}

        {/* Suggestion panel (OFFICE-27) */}
        {showSuggestions && (
          <SuggestionPanel
            fileId={id}
            suggestions={suggestions}
            onAccept={handleAcceptSuggestion}
            onReject={handleRejectSuggestion}
            onClose={() => setShowSuggestions(false)}
          />
        )}
      </div>

      <div className="flex items-center justify-end gap-4 px-4 py-1 bg-white border-t border-gray-100 text-xs text-gray-400">
        <span>{wordCount} words</span>
        <span>{charCount} characters</span>
      </div>
    </div>
  )
}
