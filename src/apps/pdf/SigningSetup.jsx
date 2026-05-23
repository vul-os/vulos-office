import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import * as pdfjsLib from 'pdfjs-dist'
import {
  ArrowLeft, Plus, Trash2, X, Save, ChevronLeft, ChevronRight,
  User, FileSignature, Type as TypeIcon, Calendar, Pen, AlignLeft,
  CheckSquare, Square, ToggleLeft, ToggleRight, Upload,
} from 'lucide-react'
import { api } from '../../lib/api.js'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href

function genId() {
  return Math.random().toString(36).slice(2, 11)
}

// Signer color palette — one color per signer for visual distinction.
const SIGNER_COLORS = [
  '#4f8ef7', '#7c3aed', '#10b981', '#f59e0b', '#ef4444',
  '#06b6d4', '#d946ef', '#84cc16', '#f97316', '#6366f1',
]

// Field type definitions.
const FIELD_TYPES = [
  { type: 'signature', label: 'Signature', icon: FileSignature, w: 200, h: 60 },
  { type: 'initial',   label: 'Initial',   icon: Pen,           w: 100, h: 50 },
  { type: 'date',      label: 'Date',       icon: Calendar,      w: 130, h: 36 },
  { type: 'name',      label: 'Full Name',  icon: User,          w: 180, h: 36 },
  { type: 'text',      label: 'Text',       icon: AlignLeft,     w: 200, h: 36 },
]

const FIELD_BG = {
  signature: 'rgba(79,142,247,.15)',
  initial:   'rgba(124,58,237,.15)',
  date:      'rgba(16,185,129,.15)',
  name:      'rgba(245,158,11,.15)',
  text:      'rgba(107,114,128,.12)',
}

const FIELD_BORDER = {
  signature: '#4f8ef7',
  initial:   '#7c3aed',
  date:      '#10b981',
  name:      '#f59e0b',
  text:      '#9ca3af',
}

export default function SigningSetup() {
  const navigate = useNavigate()
  const location = useLocation()

  // PDF rendering
  const [pdfJsDoc, setPdfJsDoc]       = useState(null)
  const [totalPages, setTotalPages]    = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [zoom, setZoom]               = useState(1.0)
  const [filename, setFilename]       = useState('')
  const [fileId, setFileId]           = useState(null)
  const [envelopeId, setEnvelopeId]   = useState(null) // null = new, string = editing
  const [loadingPdf, setLoadingPdf]   = useState(false)
  const pageCanvasRef    = useRef(null)
  const canvasAreaRef    = useRef(null)
  const thumbnailRefs    = useRef({})
  const fileInputRef     = useRef(null)

  // Signers: [{ id, name, email, order, color }]
  const [signers, setSigners] = useState([])
  const [orderMode, setOrderMode] = useState('sequential') // sequential | parallel
  const [envelopeTitle, setEnvelopeTitle] = useState('')

  // Fields: [{ id, page, x, y, w, h, type, signerId, required }]
  const [fields, setFields] = useState([])
  const [selectedFieldId, setSelectedFieldId] = useState(null)
  const [activePlaceType, setActivePlaceType] = useState(null) // placing a field of this type

  // Drag state for field repositioning
  const dragRef = useRef({ active: false })

  // UI
  const [toast, setToast]           = useState(null)
  const [saving, setSaving]         = useState(false)
  const [dragOver, setDragOver]     = useState(false)
  const [pdfArrayBuffer, setPdfArrayBuffer] = useState(null)

  const showToast = useCallback((msg) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }, [])

  // ── Load PDF ────────────────────────────────────────────────
  const loadPDF = useCallback(async (file) => {
    if (!file || file.type !== 'application/pdf') {
      showToast('Please provide a valid PDF file')
      return
    }
    setLoadingPdf(true)
    try {
      const buf = await file.arrayBuffer()
      setPdfArrayBuffer(buf.slice())
      const doc = await pdfjsLib.getDocument({ data: buf }).promise
      setPdfJsDoc(doc)
      setTotalPages(doc.numPages)
      setCurrentPage(1)
      setFilename(file.name)
      if (!envelopeTitle) setEnvelopeTitle(file.name.replace(/\.pdf$/i, ''))
      showToast('PDF loaded')
    } catch (e) {
      showToast('Error loading PDF: ' + e.message)
    } finally {
      setLoadingPdf(false)
    }
  }, [showToast, envelopeTitle])

  const loadPDFFromUrl = useCallback(async (url, name) => {
    setLoadingPdf(true)
    try {
      const res = await fetch(url)
      const buf = await res.arrayBuffer()
      setPdfArrayBuffer(buf.slice())
      const doc = await pdfjsLib.getDocument({ data: buf }).promise
      setPdfJsDoc(doc)
      setTotalPages(doc.numPages)
      setCurrentPage(1)
      setFilename(name || 'document.pdf')
      if (!envelopeTitle) setEnvelopeTitle((name || 'document.pdf').replace(/\.pdf$/i, ''))
      showToast('PDF loaded')
    } catch (e) {
      showToast('Error loading PDF: ' + e.message)
    } finally {
      setLoadingPdf(false)
    }
  }, [showToast, envelopeTitle])

  // Auto-load from router state or session (same as PDFEditor)
  useEffect(() => {
    const state = location.state || {}

    // Load existing envelope if provided.
    if (state.envelopeId) {
      setEnvelopeId(state.envelopeId)
      api.getEnvelope(state.envelopeId).then(env => {
        setEnvelopeTitle(env.title || '')
        setOrderMode(env.order_mode || 'sequential')
        const loadedSigners = (env.signers || []).map((s, i) => ({
          id: s.id,
          name: s.name,
          email: s.email || '',
          order: s.order,
          color: SIGNER_COLORS[i % SIGNER_COLORS.length],
        }))
        setSigners(loadedSigners)
        const loadedFields = (env.fields || []).map(f => ({
          id: f.id,
          page: f.page,
          x: f.x, y: f.y, w: f.w, h: f.h,
          type: f.type,
          signerId: f.signer_id,
          required: f.required,
        }))
        setFields(loadedFields)
      }).catch(() => showToast('Could not load envelope'))
    }

    // Load PDF.
    if (state.fileId) setFileId(state.fileId)
    const pending = sessionStorage.getItem('pendingPDF')
    if (pending) {
      sessionStorage.removeItem('pendingPDF')
      try {
        const { name, url, data, fileId: fid } = JSON.parse(pending)
        if (fid) setFileId(fid)
        if (url) loadPDFFromUrl(url, name)
        else if (data) {
          const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0))
          loadPDF(new File([bytes], name, { type: 'application/pdf' }))
        }
      } catch {}
      return
    }
    const { localFileUrl, localFileName } = state
    if (localFileUrl) loadPDFFromUrl(localFileUrl, localFileName)
  }, [])

  // ── Render page ─────────────────────────────────────────────
  const renderPage = useCallback(async (pageNum, scale) => {
    if (!pdfJsDoc || !pageCanvasRef.current) return
    try {
      const page = await pdfJsDoc.getPage(pageNum)
      const viewport = page.getViewport({ scale })
      const canvas = pageCanvasRef.current
      canvas.width = viewport.width
      canvas.height = viewport.height
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
    } catch {}
  }, [pdfJsDoc])

  useEffect(() => {
    if (pdfJsDoc) renderPage(currentPage, zoom)
  }, [pdfJsDoc, currentPage, zoom, renderPage])

  // Thumbnails
  useEffect(() => {
    if (!pdfJsDoc) return
    for (let i = 1; i <= totalPages; i++) renderThumbnail(i)
  }, [pdfJsDoc, totalPages])

  const renderThumbnail = async (pageNum) => {
    const canvas = thumbnailRefs.current[pageNum]
    if (!canvas || !pdfJsDoc) return
    try {
      const page = await pdfJsDoc.getPage(pageNum)
      const vp = page.getViewport({ scale: 0.22 })
      canvas.width = vp.width; canvas.height = vp.height
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise
    } catch {}
  }

  // ── Signer management ────────────────────────────────────────
  const addSigner = () => {
    const newSigner = {
      id: genId(),
      name: `Signer ${signers.length + 1}`,
      email: '',
      order: signers.length + 1,
      color: SIGNER_COLORS[signers.length % SIGNER_COLORS.length],
    }
    setSigners(prev => [...prev, newSigner])
  }

  const updateSigner = (id, changes) => {
    setSigners(prev => prev.map(s => s.id === id ? { ...s, ...changes } : s))
  }

  const removeSigner = (id) => {
    setSigners(prev => prev.filter(s => s.id !== id))
    // Unassign fields from this signer
    setFields(prev => prev.map(f => f.signerId === id ? { ...f, signerId: null } : f))
  }

  // ── Field placement ──────────────────────────────────────────
  const handleCanvasClick = (e) => {
    if (!pdfJsDoc || !activePlaceType) return
    const canvas = pageCanvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const ft = FIELD_TYPES.find(f => f.type === activePlaceType)
    const newField = {
      id: genId(),
      page: currentPage,
      x: x - ft.w / 2,
      y: y - ft.h / 2,
      w: ft.w,
      h: ft.h,
      type: activePlaceType,
      signerId: signers.length === 1 ? signers[0].id : null,
      required: true,
    }
    setFields(prev => [...prev, newField])
    setSelectedFieldId(newField.id)
    setActivePlaceType(null)
  }

  const removeField = (id) => {
    setFields(prev => prev.filter(f => f.id !== id))
    if (selectedFieldId === id) setSelectedFieldId(null)
  }

  const updateField = (id, changes) => {
    setFields(prev => prev.map(f => f.id === id ? { ...f, ...changes } : f))
  }

  // Drag to reposition a field
  const onFieldMouseDown = (e, field) => {
    e.stopPropagation()
    if (activePlaceType) return
    setSelectedFieldId(field.id)
    const startX = e.clientX, startY = e.clientY
    const origX = field.x, origY = field.y
    let moved = false
    dragRef.current = { active: true }

    const onMove = (me) => {
      moved = true
      dragRef.current.moved = true
      updateField(field.id, {
        x: origX + (me.clientX - startX),
        y: origY + (me.clientY - startY),
      })
    }
    const onUp = () => {
      dragRef.current.active = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      if (!moved) setSelectedFieldId(prev => prev === field.id ? prev : field.id)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // ── Save envelope ────────────────────────────────────────────
  const saveEnvelope = async () => {
    if (!envelopeTitle.trim()) { showToast('Please enter an envelope title'); return }
    if (signers.length === 0) { showToast('Add at least one signer'); return }
    setSaving(true)
    try {
      const payload = {
        source_file_id: fileId || '',
        title: envelopeTitle.trim(),
        order_mode: orderMode,
        status: 'draft',
        fields: fields.map(f => ({
          id: f.id,
          page: f.page,
          x: f.x, y: f.y, w: f.w, h: f.h,
          type: f.type,
          signer_id: f.signerId || '',
          required: f.required,
        })),
        signers: signers.map(s => ({
          id: s.id,
          name: s.name,
          email: s.email || '',
          order: s.order,
          status: 'pending',
        })),
      }
      let saved
      if (envelopeId) {
        saved = await api.updateEnvelope(envelopeId, payload)
      } else {
        saved = await api.createEnvelope(payload)
        setEnvelopeId(saved.id)
      }
      showToast('Envelope saved!')
    } catch (e) {
      showToast('Save error: ' + (e.message || 'Unknown error'))
    } finally {
      setSaving(false)
    }
  }

  // ── Helpers ──────────────────────────────────────────────────
  const currentPageFields = fields.filter(f => f.page === currentPage)
  const selectedField = selectedFieldId ? fields.find(f => f.id === selectedFieldId) : null
  const signerForField = (f) => signers.find(s => s.id === f?.signerId)

  const signerColor = (signerId) => {
    const s = signers.find(x => x.id === signerId)
    return s?.color || '#9ca3af'
  }

  // ── Render ───────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0f1117', fontFamily: "'DM Sans', system-ui, sans-serif", overflow: 'hidden' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-thumb { background: #374151; border-radius: 3px; }
        .field-drag { cursor: move; }
        .signer-chip { display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600; }
      `}</style>

      {/* TOP BAR */}
      <div style={{ background: '#0d1117', borderBottom: '1px solid rgba(255,255,255,.06)', height: 52, display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', flexShrink: 0 }}>
        <button onClick={() => navigate(-1)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 6, border: 'none', background: 'transparent', color: '#9ca3af', cursor: 'pointer', fontSize: 13 }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,.07)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <ArrowLeft size={15} /> Back
        </button>

        <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,.1)' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#f9fafb', fontWeight: 600, fontSize: 15 }}>
          <div style={{ width: 28, height: 28, background: 'linear-gradient(135deg,#7c3aed,#4f8ef7)', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <FileSignature size={14} color="#fff" />
          </div>
          Prepare to Sign
        </div>

        {/* Envelope title */}
        <input
          value={envelopeTitle}
          onChange={e => setEnvelopeTitle(e.target.value)}
          placeholder="Envelope title…"
          style={{ flex: 1, maxWidth: 320, padding: '5px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.05)', color: '#f9fafb', fontSize: 13, outline: 'none', marginLeft: 8 }}
        />

        <div style={{ flex: 1 }} />

        {/* Order mode toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,.04)', borderRadius: 6, padding: '3px 4px' }}>
          {['sequential', 'parallel'].map(mode => (
            <button key={mode} onClick={() => setOrderMode(mode)}
              style={{ padding: '4px 12px', borderRadius: 4, border: 'none', background: orderMode === mode ? 'rgba(79,142,247,.25)' : 'transparent', color: orderMode === mode ? '#4f8ef7' : '#9ca3af', cursor: 'pointer', fontSize: 12, fontWeight: 500, textTransform: 'capitalize' }}
            >{mode}</button>
          ))}
        </div>

        <button onClick={() => fileInputRef.current?.click()}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 6, border: 'none', background: 'rgba(255,255,255,.07)', color: '#d1d5db', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}
        >
          <Upload size={14} /> Open PDF
        </button>

        <button onClick={saveEnvelope} disabled={saving || !pdfJsDoc}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 18px', borderRadius: 6, border: 'none', background: pdfJsDoc && !saving ? '#7c3aed' : '#1f2937', color: pdfJsDoc && !saving ? '#fff' : '#4b5563', cursor: pdfJsDoc && !saving ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 600 }}
        >
          <Save size={14} /> {saving ? 'Saving…' : 'Save Envelope'}
        </button>
      </div>

      {/* FIELD TYPE TOOLBAR */}
      <div style={{ background: '#161b27', borderBottom: '1px solid rgba(255,255,255,.05)', height: 46, display: 'flex', alignItems: 'center', gap: 6, padding: '0 14px', flexShrink: 0 }}>
        <span style={{ color: '#6b7280', fontSize: 12, fontWeight: 600, marginRight: 4 }}>Place field:</span>
        {FIELD_TYPES.map(({ type, label, icon: Icon }) => (
          <button key={type} onClick={() => setActivePlaceType(prev => prev === type ? null : type)}
            title={`Place ${label} field`}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 5, border: `1px solid ${activePlaceType === type ? FIELD_BORDER[type] : 'transparent'}`, background: activePlaceType === type ? FIELD_BG[type] : 'rgba(255,255,255,.04)', color: activePlaceType === type ? FIELD_BORDER[type] : '#9ca3af', cursor: 'pointer', fontSize: 12, fontWeight: 500, transition: 'all .12s' }}
            onMouseEnter={e => { if (activePlaceType !== type) { e.currentTarget.style.background = 'rgba(255,255,255,.08)'; e.currentTarget.style.color = '#fff' } }}
            onMouseLeave={e => { if (activePlaceType !== type) { e.currentTarget.style.background = 'rgba(255,255,255,.04)'; e.currentTarget.style.color = '#9ca3af' } }}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
        {activePlaceType && (
          <span style={{ color: '#f59e0b', fontSize: 12, marginLeft: 8 }}>
            Click on the PDF to place a <b>{FIELD_TYPES.find(f => f.type === activePlaceType)?.label}</b> field — or press Esc to cancel
          </span>
        )}
      </div>

      {/* WORKSPACE */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* LEFT: Page thumbnails */}
        <div style={{ width: 160, background: '#111827', borderRight: '1px solid rgba(255,255,255,.04)', display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden' }}>
          <div style={{ padding: '10px 12px 6px', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
            <span style={{ color: '#6b7280', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.08em' }}>Pages</span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {!pdfJsDoc ? (
              <div style={{ color: '#374151', fontSize: 12, textAlign: 'center', padding: '20px 8px' }}>Open a PDF to start</div>
            ) : (
              Array.from({ length: totalPages }, (_, i) => i + 1).map(n => {
                const pageFieldCount = fields.filter(f => f.page === n).length
                return (
                  <div key={n} onClick={() => setCurrentPage(n)}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: 5, borderRadius: 5, cursor: 'pointer', background: currentPage === n ? 'rgba(79,142,247,.12)' : 'transparent', transition: 'background .12s' }}
                    onMouseEnter={e => { if (currentPage !== n) e.currentTarget.style.background = 'rgba(255,255,255,.04)' }}
                    onMouseLeave={e => { if (currentPage !== n) e.currentTarget.style.background = 'transparent' }}
                  >
                    <div style={{ position: 'relative', background: 'white', borderRadius: 3, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,.4)', border: `2px solid ${currentPage === n ? '#4f8ef7' : 'transparent'}`, width: '100%' }}>
                      <canvas ref={el => { if (el) thumbnailRefs.current[n] = el }} style={{ display: 'block', width: '100%' }} />
                      {pageFieldCount > 0 && (
                        <div style={{ position: 'absolute', top: 3, right: 3, background: '#7c3aed', color: '#fff', borderRadius: 10, fontSize: 9, fontWeight: 700, padding: '1px 5px' }}>{pageFieldCount}</div>
                      )}
                    </div>
                    <span style={{ color: currentPage === n ? '#4f8ef7' : '#6b7280', fontSize: 11 }}>{n}</span>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* CENTER: PDF canvas */}
        <div ref={canvasAreaRef}
          style={{ flex: 1, overflow: 'auto', background: '#1e2330', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 28, position: 'relative' }}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) loadPDF(f) }}
        >
          {!pdfJsDoc ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, width: '100%', maxWidth: 500, margin: 'auto', border: `2px dashed ${dragOver ? '#7c3aed' : '#374151'}`, borderRadius: 16, background: 'rgba(255,255,255,.02)', padding: 60, cursor: 'pointer', transition: 'all .2s' }}
              onClick={() => fileInputRef.current?.click()}
            >
              <div style={{ width: 64, height: 64, background: 'rgba(124,58,237,.1)', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Upload size={28} color="#7c3aed" />
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: '#f9fafb', fontSize: 18, fontWeight: 600, marginBottom: 6 }}>Open a PDF to set up signing</div>
                <div style={{ color: '#6b7280', fontSize: 14 }}>Drag & drop or click to browse</div>
              </div>
            </div>
          ) : (
            <>
              <div style={{ position: 'relative', boxShadow: '0 12px 48px rgba(0,0,0,.5)', cursor: activePlaceType ? 'crosshair' : 'default' }}
                onClick={handleCanvasClick}
              >
                {loadingPdf && (
                  <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
                    <div style={{ width: 28, height: 28, border: '3px solid #7c3aed', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
                  </div>
                )}
                <canvas ref={pageCanvasRef} style={{ display: 'block' }} />

                {/* Field overlay */}
                {currentPageFields.map(field => {
                  const signer = signerForField(field)
                  const color = signer?.color || FIELD_BORDER[field.type]
                  const isSelected = selectedFieldId === field.id
                  return (
                    <div key={field.id}
                      className="field-drag"
                      onMouseDown={e => onFieldMouseDown(e, field)}
                      style={{
                        position: 'absolute',
                        left: field.x, top: field.y,
                        width: field.w, height: field.h,
                        border: `2px solid ${isSelected ? color : color + '99'}`,
                        background: FIELD_BG[field.type],
                        borderRadius: 4,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 2,
                        cursor: 'move',
                        userSelect: 'none',
                        boxShadow: isSelected ? `0 0 0 2px ${color}55` : 'none',
                        zIndex: isSelected ? 10 : 5,
                        transition: 'box-shadow .1s',
                      }}
                    >
                      <span style={{ fontSize: 10, fontWeight: 700, color, opacity: .9, letterSpacing: '.04em' }}>
                        {FIELD_TYPES.find(f => f.type === field.type)?.label}
                      </span>
                      {signer && (
                        <span style={{ fontSize: 9, color: signer.color, background: signer.color + '22', padding: '1px 6px', borderRadius: 8, fontWeight: 600 }}>
                          {signer.name}
                        </span>
                      )}
                      {!field.required && (
                        <span style={{ fontSize: 8, color: '#9ca3af' }}>optional</span>
                      )}

                      {/* Delete button (shown on hover/select) */}
                      {isSelected && (
                        <button
                          onMouseDown={e => { e.stopPropagation(); removeField(field.id) }}
                          style={{ position: 'absolute', top: -10, right: -10, width: 20, height: 20, background: '#ef4444', border: '2px solid #0f1117', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'white', fontWeight: 700, zIndex: 20 }}
                        >×</button>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Page nav */}
              {totalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 20 }}>
                  <button onClick={() => { if (currentPage > 1) setCurrentPage(p => p - 1) }} disabled={currentPage <= 1}
                    style={{ width: 34, height: 34, borderRadius: 6, border: 'none', background: currentPage <= 1 ? '#1f2937' : '#374151', color: currentPage <= 1 ? '#4b5563' : '#d1d5db', cursor: currentPage <= 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  ><ChevronLeft size={17} /></button>
                  <span style={{ color: '#9ca3af', fontSize: 13, background: '#1f2937', padding: '5px 14px', borderRadius: 6 }}>
                    Page {currentPage} of {totalPages}
                  </span>
                  <button onClick={() => { if (currentPage < totalPages) setCurrentPage(p => p + 1) }} disabled={currentPage >= totalPages}
                    style={{ width: 34, height: 34, borderRadius: 6, border: 'none', background: currentPage >= totalPages ? '#1f2937' : '#374151', color: currentPage >= totalPages ? '#4b5563' : '#d1d5db', cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  ><ChevronRight size={17} /></button>
                </div>
              )}
            </>
          )}
        </div>

        {/* RIGHT PANEL */}
        <div style={{ width: 260, background: '#0d1117', borderLeft: '1px solid rgba(255,255,255,.06)', display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden' }}>

          {/* Signers section */}
          <div style={{ borderBottom: '1px solid rgba(255,255,255,.06)', padding: '10px 12px 6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ color: '#9ca3af', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>Signers</span>
              <button onClick={addSigner}
                style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '3px 8px', borderRadius: 4, border: 'none', background: 'rgba(79,142,247,.15)', color: '#4f8ef7', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}
              ><Plus size={11} /> Add</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
              {signers.length === 0 ? (
                <div style={{ color: '#4b5563', fontSize: 12, padding: '8px 0' }}>No signers yet — click Add</div>
              ) : signers.map((signer, idx) => (
                <div key={signer.id} style={{ background: 'rgba(255,255,255,.04)', borderRadius: 6, padding: '6px 8px', border: `1px solid ${signer.color}33` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: signer.color, flexShrink: 0 }} />
                    <input value={signer.name} onChange={e => updateSigner(signer.id, { name: e.target.value })}
                      placeholder="Signer name"
                      style={{ flex: 1, background: 'transparent', border: 'none', color: '#f9fafb', fontSize: 12, fontWeight: 500, outline: 'none', fontFamily: 'inherit' }}
                    />
                    <button onClick={() => removeSigner(signer.id)}
                      style={{ width: 16, height: 16, border: 'none', background: 'transparent', color: '#4b5563', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                      onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                      onMouseLeave={e => e.currentTarget.style.color = '#4b5563'}
                    ><X size={12} /></button>
                  </div>
                  <input value={signer.email} onChange={e => updateSigner(signer.id, { email: e.target.value })}
                    placeholder="email@example.com"
                    type="email"
                    style={{ width: '100%', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 4, color: '#9ca3af', fontSize: 11, padding: '3px 6px', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
                  />
                  {orderMode === 'sequential' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                      <span style={{ color: '#4b5563', fontSize: 10 }}>Order:</span>
                      <input type="number" min={1} max={signers.length}
                        value={signer.order}
                        onChange={e => updateSigner(signer.id, { order: parseInt(e.target.value) || 1 })}
                        style={{ width: 40, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 4, color: '#9ca3af', fontSize: 11, padding: '2px 4px', outline: 'none', fontFamily: 'inherit', textAlign: 'center' }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Field details (selected) */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
            <div style={{ marginBottom: 8 }}>
              <span style={{ color: '#9ca3af', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>
                {selectedField ? 'Field Properties' : 'Fields'}
              </span>
            </div>

            {selectedField ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* Type badge */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: FIELD_BG[selectedField.type], borderRadius: 6, border: `1px solid ${FIELD_BORDER[selectedField.type]}66` }}>
                  {(() => { const ft = FIELD_TYPES.find(f => f.type === selectedField.type); const Icon = ft?.icon; return Icon ? <Icon size={13} color={FIELD_BORDER[selectedField.type]} /> : null })()}
                  <span style={{ fontSize: 12, fontWeight: 600, color: FIELD_BORDER[selectedField.type] }}>
                    {FIELD_TYPES.find(f => f.type === selectedField.type)?.label} — Page {selectedField.page}
                  </span>
                </div>

                {/* Assign signer */}
                <div>
                  <label style={{ display: 'block', color: '#6b7280', fontSize: 11, marginBottom: 4 }}>Assigned Signer</label>
                  <select value={selectedField.signerId || ''}
                    onChange={e => updateField(selectedField.id, { signerId: e.target.value || null })}
                    style={{ width: '100%', background: '#1f2937', border: '1px solid rgba(255,255,255,.1)', borderRadius: 5, color: '#e5e7eb', fontSize: 12, padding: '5px 8px', outline: 'none', fontFamily: 'inherit' }}
                  >
                    <option value="">— Unassigned —</option>
                    {signers.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>

                {/* Required toggle */}
                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
                    <button onClick={() => updateField(selectedField.id, { required: !selectedField.required })}
                      style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', color: selectedField.required ? '#4f8ef7' : '#4b5563', display: 'flex', alignItems: 'center' }}
                    >
                      {selectedField.required ? <CheckSquare size={16} /> : <Square size={16} />}
                    </button>
                    <span style={{ fontSize: 12, color: selectedField.required ? '#e5e7eb' : '#6b7280' }}>
                      Required
                    </span>
                  </label>
                </div>

                {/* Position / size */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {[['x', 'X'], ['y', 'Y'], ['w', 'W'], ['h', 'H']].map(([key, label]) => (
                    <div key={key}>
                      <label style={{ display: 'block', color: '#6b7280', fontSize: 10, marginBottom: 2 }}>{label} (px)</label>
                      <input type="number" value={Math.round(selectedField[key])}
                        onChange={e => updateField(selectedField.id, { [key]: parseFloat(e.target.value) || 0 })}
                        style={{ width: '100%', background: '#1f2937', border: '1px solid rgba(255,255,255,.1)', borderRadius: 4, color: '#e5e7eb', fontSize: 11, padding: '4px 6px', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
                      />
                    </div>
                  ))}
                </div>

                <button onClick={() => removeField(selectedField.id)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '7px 0', background: 'rgba(239,68,68,.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,.2)', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 500 }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,.2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'rgba(239,68,68,.1)'}
                >
                  <Trash2 size={12} /> Delete field
                </button>
              </div>
            ) : (
              <div>
                {/* Field list */}
                {fields.length === 0 ? (
                  <div style={{ color: '#4b5563', fontSize: 12, lineHeight: 1.6 }}>
                    No fields yet.<br />
                    Use the toolbar above to place Signature, Date, Name, or Text fields onto the PDF.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {fields.map(f => {
                      const signer = signerForField(f)
                      const color = signer?.color || FIELD_BORDER[f.type]
                      return (
                        <div key={f.id} onClick={() => { setCurrentPage(f.page); setSelectedFieldId(f.id) }}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 5, cursor: 'pointer', background: 'rgba(255,255,255,.04)', border: `1px solid ${color}33`, transition: 'background .1s' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,.08)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,.04)'}
                        >
                          <div style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
                          <span style={{ fontSize: 11, color: '#e5e7eb', flex: 1 }}>
                            {FIELD_TYPES.find(ft => ft.type === f.type)?.label}
                            <span style={{ color: '#6b7280' }}> p.{f.page}</span>
                          </span>
                          {signer && (
                            <span style={{ fontSize: 9, color: signer.color, fontWeight: 600 }}>{signer.name}</span>
                          )}
                          {!f.required && <span style={{ fontSize: 9, color: '#4b5563' }}>opt</span>}
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Summary */}
                {fields.length > 0 && (
                  <div style={{ marginTop: 12, padding: '8px', background: 'rgba(255,255,255,.03)', borderRadius: 6 }}>
                    <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>Summary</div>
                    {signers.map(s => {
                      const count = fields.filter(f => f.signerId === s.id).length
                      const unassigned = fields.filter(f => !f.signerId).length
                      return (
                        <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#9ca3af', marginBottom: 2 }}>
                          <span style={{ color: s.color }}>{s.name}</span>
                          <span>{count} field{count !== 1 ? 's' : ''}</span>
                        </div>
                      )
                    })}
                    {fields.filter(f => !f.signerId).length > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#ef4444', marginTop: 2 }}>
                        <span>Unassigned</span>
                        <span>{fields.filter(f => !f.signerId).length}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 44, left: '50%', transform: 'translateX(-50%)', background: '#1f2937', color: '#f9fafb', padding: '10px 20px', borderRadius: 24, fontSize: 13, boxShadow: '0 8px 32px rgba(0,0,0,.3)', zIndex: 2000, pointerEvents: 'none' }}>
          {toast}
        </div>
      )}

      <input ref={fileInputRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={e => { if (e.target.files[0]) loadPDF(e.target.files[0]); e.target.value = '' }} />

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
