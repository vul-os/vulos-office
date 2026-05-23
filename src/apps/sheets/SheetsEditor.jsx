import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Workbook } from '@fortune-sheet/react'
import '@fortune-sheet/react/dist/index.css'
import { ArrowLeft, Save, Loader2, Download, AlertCircle, MessageSquare } from 'lucide-react'
import { useFilesStore, getSaveState, onSaveStateChange } from '../../store/filesStore'
import { api } from '../../lib/api'
import { readDraft, clearDraft } from '../../lib/draftStore'
import { exportSheetsToXlsx, exportSheetsToCsv } from './sheetsExport'
import { GridSession, getGridReplicaId } from '../../lib/crdt/grid.js'
import CommentsPanel from '../../components/CommentsPanel'
import { useLiveCursors } from '../../lib/useLiveCursors.js'
import { SheetsCursorLayer } from '../../components/RemoteCursors.jsx'

const RETRY_DELAY_MS = 4000
const AUTOSAVE_DELAY_MS = 3000

export default function SheetsEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { files, saveFileWithDraft, markDirty } = useFilesStore()
  const [file, setFile] = useState(files.find((f) => f.id === id))
  const [title, setTitle] = useState(file?.name || 'Untitled Sheet')
  const [data, setData] = useState(file?.content || [{ name: 'Sheet1', celldata: [], config: {} }])
  const [saveStatus, setSaveStatus] = useState(getSaveState(id))
  const [draft, setDraft] = useState(null)
  const [retryCount, setRetryCount] = useState(0)
  const [showComments, setShowComments] = useState(false)
  const saveTimer = useRef(null)
  const retryTimer = useRef(null)
  const titleRef = useRef(title)
  titleRef.current = title
  const dataRef = useRef(data)
  dataRef.current = data
  const gridSessionRef = useRef(null)

  // OFFICE-23: boot a GridSession for CRDT collaboration on this file.
  // fabricClient is null until OFFICE-20 supplies one; the session still
  // runs local-only (localStorage persistence + offline convergence).
  useEffect(() => {
    if (!id) return
    const replicaId = getGridReplicaId()
    const session = new GridSession({ sessionId: id, replicaId, fabricClient: null })
    gridSessionRef.current = session

    // Request a snapshot from any already-connected peers.
    session.requestSnapshot()

    // On remote op — merge CRDT cells into the current sheet data.
    const onRemote = () => {
      const crdtCells = session.cells()
      if (crdtCells.length === 0) return
      setData((prev) => {
        // Merge CRDT cells into the first sheet's celldata without clobbering
        // cells that are not managed by the CRDT (e.g. formatting).
        const sheets = prev.map((sheet, idx) => {
          if (idx !== 0) return sheet
          // Build a map of existing celldata keyed by "r_c".
          const existing = new Map((sheet.celldata || []).map((c) => [`${c.r}_${c.c}`, c]))
          for (const { r, c, v } of crdtCells) {
            const key = `${r}_${c}`
            const ex = existing.get(key)
            // Only update if the value actually differs to avoid flicker.
            if (!ex || (typeof ex.v === 'object' ? ex.v?.v : ex.v) !== v) {
              existing.set(key, { r, c, v: { v, m: v, ct: { fa: 'General', t: 'n' } } })
            }
          }
          return { ...sheet, celldata: [...existing.values()] }
        })
        return sheets
      })
      markDirty(id)
    }

    session.addEventListener('remoteOp', onRemote)
    return () => {
      session.removeEventListener('remoteOp', onRemote)
      session.destroy()
      gridSessionRef.current = null
    }
  }, [id]) // eslint-disable-line

  // Subscribe to save state changes for this file
  useEffect(() => {
    const unsub = onSaveStateChange(id, (state) => setSaveStatus({ ...state }))
    return unsub
  }, [id])

  useEffect(() => {
    if (!file && id) {
      api.getFile(id).then((f) => {
        setFile(f)
        setTitle(f.name)
        setData(f.content || [{ name: 'Sheet1', celldata: [], config: {} }])
      }).catch(() => navigate('/sheets'))
    }
  }, [id])

  // Check for a pending draft on mount (crash recovery)
  useEffect(() => {
    if (!id) return
    readDraft(id).then((d) => {
      if (d && d.ts) setDraft(d)
    })
  }, [id])

  // ── OFFICE-25: Live cursors ───────────────────────────────────────────────
  // fabric is null until OFFICE-20 is wired; hook is a graceful no-op until then.
  const { remoteCursors, broadcastSheetCursor } = useLiveCursors({ fabric: null, localIdentity: null, color: '#6366f1' })

  // Reference to the Fortune Sheet container so we can measure cell positions.
  const workbookWrapRef = useRef(null)

  /** Approximate cell rect from the Fortune Sheet DOM (best-effort). */
  const getCellRect = useCallback((row, col) => {
    const container = workbookWrapRef.current
    if (!container) return null
    // Fortune Sheet renders cells as <td> inside .luckysheet-cell-main.
    // Row/col indexing starts at 0. We query the tr[row] > td[col+1] pattern.
    try {
      const tbody = container.querySelector('.luckysheet-cell-main tbody')
      if (!tbody) return null
      const tr = tbody.querySelectorAll('tr')[row]
      if (!tr) return null
      // col+1 because the first td is the row-header
      const td = tr.querySelectorAll('td')[col + 1]
      if (!td) return null
      const containerRect = container.getBoundingClientRect()
      const tdRect = td.getBoundingClientRect()
      return {
        top:    tdRect.top    - containerRect.top,
        left:   tdRect.left   - containerRect.left,
        width:  tdRect.width,
        height: tdRect.height,
      }
    } catch {
      return null
    }
  }, [])

  const doSave = useCallback(async (contentOverride, retryNum = 0) => {
    if (!id) return
    const content = contentOverride !== undefined ? contentOverride : dataRef.current
    try {
      await saveFileWithDraft(id, titleRef.current, content)
      setRetryCount(0)
    } catch {
      if (retryNum < 3) {
        const delay = RETRY_DELAY_MS * (retryNum + 1)
        retryTimer.current = setTimeout(() => {
          setRetryCount(retryNum + 1)
          doSave(undefined, retryNum + 1)
        }, delay)
      }
    }
  }, [id, saveFileWithDraft])

  const handleChange = (newData) => {
    setData(newData)
    markDirty(id)
    clearTimeout(saveTimer.current)
    clearTimeout(retryTimer.current)
    setRetryCount(0)
    // OFFICE-25: broadcast the first edited cell as the local cursor position.
    if (Array.isArray(newData) && newData[0]?.celldata?.length) {
      const last = newData[0].celldata[newData[0].celldata.length - 1]
      if (last) broadcastSheetCursor(last.r, last.c)
    }
    // OFFICE-23: emit CRDT ops for changed cells so peers converge.
    // Compare the first sheet's celldata to detect which cells changed.
    const session = gridSessionRef.current
    if (session && Array.isArray(newData) && newData[0]?.celldata) {
      for (const cell of newData[0].celldata) {
        const row = cell.r
        const col = cell.c
        const val = typeof cell.v === 'object'
          ? (cell.v?.v ?? cell.v?.m ?? '')
          : (cell.v ?? '')
        const existing = session.cells().find((c) => c.r === row && c.c === col)
        if (!existing || existing.v !== String(val)) {
          if (val === '' || val === null || val === undefined) {
            session.clearCell(row, col)
          } else {
            session.setCell(row, col, String(val))
          }
        }
      }
      session.saveLocal()
    }
    saveTimer.current = setTimeout(() => doSave(newData), AUTOSAVE_DELAY_MS)
  }

  const handleSave = () => {
    clearTimeout(saveTimer.current)
    clearTimeout(retryTimer.current)
    setRetryCount(0)
    doSave(dataRef.current)
  }

  const handleRestoreDraft = () => {
    if (!draft) return
    setData(draft.content)
    if (draft.name) setTitle(draft.name)
    setDraft(null)
    markDirty(id)
  }

  const handleDiscardDraft = () => {
    clearDraft(id)
    setDraft(null)
  }

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
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-200 bg-white flex-shrink-0">
        <button onClick={() => navigate('/sheets')} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition">
          <ArrowLeft size={18} />
        </button>
        <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center flex-shrink-0">
          <svg viewBox="0 0 24 24" className="w-4 h-4 text-emerald-600 fill-current"><path d="M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zm-8 14H7v-2h4v2zm0-4H7v-2h4v2zm0-4H7V7h4v2zm6 8h-4v-2h4v2zm0-4h-4v-2h4v2zm0-4h-4V7h4v2z"/></svg>
        </div>
        <input
          value={title}
          onChange={(e) => { setTitle(e.target.value); markDirty(id) }}
          className="flex-1 text-base font-semibold text-gray-900 bg-transparent border-none outline-none hover:bg-gray-50 focus:bg-gray-50 rounded px-2 py-0.5"
          placeholder="Untitled Sheet"
        />
        <span className={`text-xs hidden sm:block ${statusColor()}`}>{statusText()}</span>
        <button
          onClick={() => setShowComments(v => !v)}
          title="Comments"
          className={`p-1.5 rounded-lg transition ${showComments ? 'bg-emerald-100 text-emerald-600' : 'hover:bg-gray-100 text-gray-500'}`}
        >
          <MessageSquare size={16} />
        </button>
        <button
          onClick={handleSave}
          disabled={saveStatus.status === 'saving'}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-60 transition"
        >
          {saveStatus.status === 'saving' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save
        </button>
        <div className="relative group">
          <button className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition">
            <Download size={14} /> Export ▾
          </button>
          <div className="absolute right-0 top-full mt-1 w-40 bg-white border border-gray-200 rounded-xl shadow-xl z-30 py-1 text-sm hidden group-hover:block">
            <button onClick={() => exportSheetsToXlsx(data, title)} className="w-full text-left px-3 py-2 hover:bg-gray-50 text-gray-700">Excel (.xlsx)</button>
            <button onClick={() => exportSheetsToCsv(data, title)} className="w-full text-left px-3 py-2 hover:bg-gray-50 text-gray-700">CSV (.csv)</button>
          </div>
        </div>
      </div>

      {/* Workbook + optional comments panel */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-hidden relative" ref={workbookWrapRef}>
          <Workbook
            data={data}
            onChange={handleChange}
          />
          {/* OFFICE-25: remote cell selection overlays */}
          <SheetsCursorLayer remoteCursors={remoteCursors} getCellRect={getCellRect} />
        </div>

        {/* Comments panel (OFFICE-26) */}
        {showComments && (
          <CommentsPanel
            fileId={id}
            anchorCtx={{ type: 'cell', sheet: 'Sheet1', row: 0, col: 0, snapshot: '' }}
            onClose={() => setShowComments(false)}
          />
        )}
      </div>
    </div>
  )
}
