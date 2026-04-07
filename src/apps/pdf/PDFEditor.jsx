import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import * as pdfjsLib from 'pdfjs-dist'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import SignaturePad from 'signature_pad'
import {
  ArrowLeft, Download, ZoomIn, ZoomOut, Maximize2,
  MousePointer2, Type, PenLine, Pencil, LayoutList,
  SlidersHorizontal, Plus, X, Trash2, Bold, Italic,
  Underline as UnderlineIcon, ChevronLeft, ChevronRight,
  Upload, Save,
} from 'lucide-react'

// Set worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href

function genId() {
  return Math.random().toString(36).slice(2, 11)
}

function hexToRgb01(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  return { r, g, b }
}

const TOOLS = {
  SELECT: 'select',
  TEXT: 'text',
  SIGNATURE: 'signature',
  DRAW: 'draw',
}

const CURSORS = {
  select: 'default',
  text: 'text',
  signature: 'crosshair',
  draw: 'crosshair',
}

export default function PDFEditor() {
  const navigate = useNavigate()
  const location = useLocation()

  // PDF state
  const [pdfArrayBuffer, setPdfArrayBuffer] = useState(null)
  const [pdfJsDoc, setPdfJsDoc] = useState(null)
  const [totalPages, setTotalPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [zoom, setZoom] = useState(1.0)
  const [filename, setFilename] = useState('')
  const [loadingPdf, setLoadingPdf] = useState(false)

  // Tool state
  const [activeTool, setActiveTool] = useState(TOOLS.SELECT)
  const [textDefaults, setTextDefaults] = useState({
    fontSize: 14,
    fontFamily: 'Helvetica',
    color: '#1a1a2e',
    bold: false,
    italic: false,
    underline: false,
  })

  // Annotations: { [pageNum]: [annotation, ...] }
  const [annotations, setAnnotations] = useState({})
  const [selectedId, setSelectedId] = useState(null)

  // Signatures
  const [savedSigs, setSavedSigs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('vulos_pdf_sigs') || '[]') }
    catch { return [] }
  })

  // UI state
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [panelOpen, setPanelOpen] = useState(true)
  const [sigModalOpen, setSigModalOpen] = useState(false)
  const [sigTab, setSigTab] = useState('draw')
  const [sigFont, setSigFont] = useState('Dancing Script')
  const [typedName, setTypedName] = useState('')
  const [saveToLib, setSaveToLib] = useState(true)
  const [toast, setToast] = useState(null)
  const [dragOver, setDragOver] = useState(false)

  // Draw state
  const [isDrawing, setIsDrawing] = useState(false)
  const drawPathsRef = useRef({}) // { [pageNum]: [{id, points, color, size}] }
  const currentDrawPoints = useRef([])

  // Refs
  const pageCanvasRef = useRef(null)
  const drawCanvasRef = useRef(null)
  const annotLayerRef = useRef(null)
  const canvasAreaRef = useRef(null)
  const sigCanvasRef = useRef(null)
  const sigPadRef = useRef(null)
  const pendingSigPos = useRef(null)
  const dragState = useRef({ active: false })
  const thumbnailRefs = useRef({})
  const fileInputRef = useRef(null)

  // ─── Toast ───────────────────────────────────────────────
  const showToast = useCallback((msg) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2800)
  }, [])

  // ─── Persist signatures ───────────────────────────────────
  useEffect(() => {
    localStorage.setItem('vulos_pdf_sigs', JSON.stringify(savedSigs))
  }, [savedSigs])

  // ─── Load PDF ─────────────────────────────────────────────
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
      setAnnotations({})
      setSelectedId(null)
      setFilename(file.name)
      showToast('PDF loaded successfully')
    } catch (e) {
      showToast('Error loading PDF: ' + e.message)
    } finally {
      setLoadingPdf(false)
    }
  }, [showToast])

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
      setAnnotations({})
      setSelectedId(null)
      setFilename(name || 'document.pdf')
      showToast('PDF loaded successfully')
    } catch (e) {
      showToast('Error loading PDF: ' + e.message)
    } finally {
      setLoadingPdf(false)
    }
  }, [showToast])

  // Auto-load from sessionStorage (set by importFile.js) or router state
  useEffect(() => {
    const pending = sessionStorage.getItem('pendingPDF')
    if (pending) {
      sessionStorage.removeItem('pendingPDF')
      try {
        const { name, url, data } = JSON.parse(pending)
        if (url) {
          loadPDFFromUrl(url, name)
        } else if (data) {
          // base64 encoded bytes
          const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0))
          const file = new File([bytes], name, { type: 'application/pdf' })
          loadPDF(file)
        }
      } catch (e) {
        console.error('Failed to load pending PDF', e)
      }
      return
    }
    const { localFileUrl, localFileName } = location.state || {}
    if (localFileUrl) loadPDFFromUrl(localFileUrl, localFileName)
  }, [])

  const handleFileInput = (e) => {
    if (e.target.files[0]) loadPDF(e.target.files[0])
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) loadPDF(file)
  }

  // ─── Render Page ──────────────────────────────────────────
  const renderPage = useCallback(async (pageNum, scale) => {
    if (!pdfJsDoc) return
    const canvas = pageCanvasRef.current
    const drawCanvas = drawCanvasRef.current
    if (!canvas) return

    const page = await pdfJsDoc.getPage(pageNum)
    const viewport = page.getViewport({ scale })

    canvas.width = viewport.width
    canvas.height = viewport.height
    if (drawCanvas) {
      drawCanvas.width = viewport.width
      drawCanvas.height = viewport.height
    }

    const ctx = canvas.getContext('2d')
    await page.render({ canvasContext: ctx, viewport }).promise

    // Redraw paths for this page
    redrawPaths(pageNum, drawCanvas)
  }, [pdfJsDoc])

  useEffect(() => {
    if (pdfJsDoc) renderPage(currentPage, zoom)
  }, [pdfJsDoc, currentPage, zoom, renderPage])

  // Render thumbnails when doc loads
  useEffect(() => {
    if (!pdfJsDoc) return
    for (let i = 1; i <= totalPages; i++) {
      renderThumbnail(i)
    }
  }, [pdfJsDoc, totalPages])

  const renderThumbnail = async (pageNum) => {
    const canvas = thumbnailRefs.current[pageNum]
    if (!canvas || !pdfJsDoc) return
    try {
      const page = await pdfJsDoc.getPage(pageNum)
      const vp = page.getViewport({ scale: 0.22 })
      canvas.width = vp.width
      canvas.height = vp.height
      const ctx = canvas.getContext('2d')
      await page.render({ canvasContext: ctx, viewport: vp }).promise
    } catch {}
  }

  // ─── Draw paths ───────────────────────────────────────────
  const redrawPaths = (pageNum, canvas) => {
    const c = canvas || drawCanvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    ctx.clearRect(0, 0, c.width, c.height)
    const paths = drawPathsRef.current[pageNum] || []
    paths.forEach(({ points, color, size }) => {
      if (points.length < 2) return
      ctx.beginPath()
      ctx.strokeStyle = color
      ctx.lineWidth = size
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.moveTo(points[0].x, points[0].y)
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
      ctx.stroke()
    })
  }

  const getCanvasPoint = (e, canvas) => {
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const onDrawStart = (e) => {
    if (activeTool !== TOOLS.DRAW) return
    setIsDrawing(true)
    const pt = getCanvasPoint(e, drawCanvasRef.current)
    currentDrawPoints.current = [pt]
    e.preventDefault()
  }

  const onDrawMove = (e) => {
    if (!isDrawing || activeTool !== TOOLS.DRAW) return
    const pt = getCanvasPoint(e, drawCanvasRef.current)
    currentDrawPoints.current.push(pt)
    // Live draw
    const ctx = drawCanvasRef.current.getContext('2d')
    ctx.clearRect(0, 0, drawCanvasRef.current.width, drawCanvasRef.current.height)
    // redraw old
    ;(drawPathsRef.current[currentPage] || []).forEach(({ points, color, size }) => {
      if (points.length < 2) return
      ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = size
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      ctx.moveTo(points[0].x, points[0].y)
      points.slice(1).forEach(p => ctx.lineTo(p.x, p.y))
      ctx.stroke()
    })
    // draw current
    const pts = currentDrawPoints.current
    if (pts.length > 1) {
      ctx.beginPath()
      ctx.strokeStyle = textDefaults.color
      ctx.lineWidth = 2.5
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      ctx.moveTo(pts[0].x, pts[0].y)
      pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y))
      ctx.stroke()
    }
    e.preventDefault()
  }

  const onDrawEnd = () => {
    if (!isDrawing) return
    setIsDrawing(false)
    const pts = currentDrawPoints.current
    if (pts.length > 1) {
      drawPathsRef.current = {
        ...drawPathsRef.current,
        [currentPage]: [
          ...(drawPathsRef.current[currentPage] || []),
          { id: genId(), points: pts, color: textDefaults.color, size: 2.5 },
        ],
      }
    }
    currentDrawPoints.current = []
  }

  // ─── Annotations ──────────────────────────────────────────
  const getPageAnns = (page) => annotations[page] || []

  const addAnn = (ann) => {
    setAnnotations(prev => ({
      ...prev,
      [ann.pageIndex]: [...(prev[ann.pageIndex] || []), ann],
    }))
  }

  const updateAnn = (id, changes) => {
    setAnnotations(prev => {
      const next = { ...prev }
      for (const key of Object.keys(next)) {
        next[key] = next[key].map(a => a.id === id ? { ...a, ...changes } : a)
      }
      return next
    })
  }

  const deleteAnn = (id) => {
    setAnnotations(prev => {
      const next = { ...prev }
      for (const key of Object.keys(next)) {
        next[key] = next[key].filter(a => a.id !== id)
      }
      return next
    })
    if (selectedId === id) setSelectedId(null)
  }

  const findAnn = (id) => {
    for (const anns of Object.values(annotations)) {
      const a = anns.find(a => a.id === id)
      if (a) return a
    }
    return null
  }

  const selectedAnn = selectedId ? findAnn(selectedId) : null

  // ─── Canvas interactions ──────────────────────────────────
  const handleCanvasClick = (e) => {
    if (!pdfJsDoc) return
    if (dragState.current.moved) return
    const rect = pageCanvasRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    if (activeTool === TOOLS.TEXT) {
      const id = genId()
      addAnn({
        id,
        type: 'text',
        pageIndex: currentPage,
        x, y,
        content: '',
        fontSize: textDefaults.fontSize,
        fontFamily: textDefaults.fontFamily,
        color: textDefaults.color,
        bold: textDefaults.bold,
        italic: textDefaults.italic,
        underline: textDefaults.underline,
        editing: true,
      })
      setSelectedId(id)
    } else if (activeTool === TOOLS.SIGNATURE) {
      pendingSigPos.current = { x, y }
      openSigModal()
    }
  }

  // ─── Annotation drag ─────────────────────────────────────
  const onAnnMouseDown = (e, ann) => {
    if (activeTool !== TOOLS.SELECT) return
    e.stopPropagation()
    setSelectedId(ann.id)
    dragState.current = {
      active: true,
      annId: ann.id,
      startX: e.clientX,
      startY: e.clientY,
      origX: ann.x,
      origY: ann.y,
      moved: false,
    }
    const onMove = (me) => {
      const dx = me.clientX - dragState.current.startX
      const dy = me.clientY - dragState.current.startY
      if (Math.abs(dx) + Math.abs(dy) > 2) dragState.current.moved = true
      updateAnn(dragState.current.annId, {
        x: dragState.current.origX + dx,
        y: dragState.current.origY + dy,
      })
    }
    const onUp = () => {
      dragState.current.active = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // ─── Signature modal ─────────────────────────────────────
  const openSigModal = () => {
    setSigModalOpen(true)
    setTimeout(() => {
      const canvas = sigCanvasRef.current
      if (!canvas) return
      const wrap = canvas.parentElement
      canvas.width = wrap ? wrap.clientWidth - 2 : 516
      canvas.height = 180
      if (sigPadRef.current) sigPadRef.current.off()
      sigPadRef.current = new SignaturePad(canvas, {
        backgroundColor: 'rgba(0,0,0,0)',
        penColor: '#1a1a2e',
        velocityFilterWeight: 0.7,
        minWidth: 1,
        maxWidth: 3,
      })
    }, 80)
  }

  const closeSigModal = () => {
    setSigModalOpen(false)
    pendingSigPos.current = null
    if (sigPadRef.current) sigPadRef.current.clear()
    setTypedName('')
  }

  const renderTypedSig = async (text, font) => {
    return new Promise(resolve => {
      const c = document.createElement('canvas')
      const ctx = c.getContext('2d')
      c.width = 600; c.height = 120
      ctx.font = `64px '${font}'`
      ctx.fillStyle = '#1a1a2e'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, 20, 60)
      // Trim
      const d = ctx.getImageData(0, 0, c.width, c.height)
      let minX = c.width, minY = c.height, maxX = 0, maxY = 0
      for (let py = 0; py < c.height; py++) {
        for (let px = 0; px < c.width; px++) {
          if (d.data[(py * c.width + px) * 4 + 3] > 8) {
            minX = Math.min(minX, px); maxX = Math.max(maxX, px)
            minY = Math.min(minY, py); maxY = Math.max(maxY, py)
          }
        }
      }
      if (maxX > minX) {
        const out = document.createElement('canvas')
        out.width = maxX - minX + 24; out.height = maxY - minY + 16
        out.getContext('2d').drawImage(c, minX - 12, minY - 8, out.width, out.height, 0, 0, out.width, out.height)
        resolve(out.toDataURL('image/png'))
      } else {
        resolve(c.toDataURL('image/png'))
      }
    })
  }

  const applySig = async () => {
    let imageData = null
    if (sigTab === 'draw') {
      if (!sigPadRef.current || sigPadRef.current.isEmpty()) {
        showToast('Please draw your signature first')
        return
      }
      imageData = sigPadRef.current.toDataURL('image/png')
    } else {
      if (!typedName.trim()) { showToast('Please type your name'); return }
      imageData = await renderTypedSig(typedName.trim(), sigFont)
    }

    if (saveToLib) {
      const newSig = { id: genId(), imageData }
      setSavedSigs(prev => [...prev, newSig])
    }

    if (pendingSigPos.current && pdfJsDoc) {
      placeSig(imageData, pendingSigPos.current.x, pendingSigPos.current.y)
    }

    closeSigModal()
  }

  const placeSig = (imageData, x, y) => {
    addAnn({
      id: genId(),
      type: 'signature',
      pageIndex: currentPage,
      x: x - 100,
      y: y - 40,
      width: 220,
      height: 88,
      imageData,
    })
    setActiveTool(TOOLS.SELECT)
  }

  // ─── Zoom ─────────────────────────────────────────────────
  const changeZoom = (delta) => {
    setZoom(z => Math.round(Math.min(3, Math.max(0.25, z + delta)) * 10) / 10)
  }

  const fitPage = async () => {
    if (!pdfJsDoc) return
    const area = canvasAreaRef.current
    const page = await pdfJsDoc.getPage(currentPage)
    const vp = page.getViewport({ scale: 1 })
    const sw = (area.clientWidth - 80) / vp.width
    const sh = (area.clientHeight - 80) / vp.height
    setZoom(Math.round(Math.min(sw, sh, 2) * 10) / 10)
  }

  // ─── Navigate pages ───────────────────────────────────────
  const goToPage = (n) => {
    if (n < 1 || n > totalPages) return
    setCurrentPage(n)
    setSelectedId(null)
  }

  // ─── Keyboard shortcuts ───────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName
      if (['INPUT', 'TEXTAREA'].includes(tag) || document.activeElement?.contentEditable === 'true') return
      switch (e.key) {
        case 'v': case 'V': setActiveTool(TOOLS.SELECT); break
        case 't': case 'T': setActiveTool(TOOLS.TEXT); break
        case 's': case 'S': setActiveTool(TOOLS.SIGNATURE); break
        case 'd': case 'D': setActiveTool(TOOLS.DRAW); break
        case 'Delete': case 'Backspace':
          if (selectedId) { deleteAnn(selectedId); e.preventDefault() }
          break
        case 'Escape': setSelectedId(null); setActiveTool(TOOLS.SELECT); break
        case '=': case '+': changeZoom(0.1); break
        case '-': changeZoom(-0.1); break
        case 'ArrowLeft': goToPage(currentPage - 1); break
        case 'ArrowRight': goToPage(currentPage + 1); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, currentPage, totalPages])

  // ─── Save PDF ─────────────────────────────────────────────
  const savePDF = async () => {
    if (!pdfArrayBuffer) return
    showToast('Preparing PDF…')
    try {
      const doc = await PDFDocument.load(pdfArrayBuffer)
      const pages = doc.getPages()
      const hv = await doc.embedFont(StandardFonts.Helvetica)
      const hvB = await doc.embedFont(StandardFonts.HelveticaBold)
      const hvI = await doc.embedFont(StandardFonts.HelveticaOblique)
      const hvBI = await doc.embedFont(StandardFonts.HelveticaBoldOblique)

      for (let pNum = 1; pNum <= totalPages; pNum++) {
        const pdfPage = pages[pNum - 1]
        const { width: pW, height: pH } = pdfPage.getSize()
        const jsPage = await pdfJsDoc.getPage(pNum)
        const vp = jsPage.getViewport({ scale: zoom })
        const cW = vp.width, cH = vp.height

        const anns = annotations[pNum] || []
        for (const ann of anns) {
          if (ann.type === 'text' && ann.content?.trim()) {
            const pdfX = (ann.x / cW) * pW
            const pdfY = pH - ((ann.y / cH) * pH) - ann.fontSize * (pH / cH)
            const font = ann.bold && ann.italic ? hvBI : ann.bold ? hvB : ann.italic ? hvI : hv
            const size = ann.fontSize * (pH / cH)
            const { r, g, b } = hexToRgb01(ann.color || '#000000')
            pdfPage.drawText(ann.content, {
              x: Math.max(0, pdfX),
              y: Math.max(0, pdfY),
              size, font, color: rgb(r, g, b),
            })
          } else if (ann.type === 'signature' && ann.imageData) {
            try {
              const res = await fetch(ann.imageData)
              const blob = await res.blob()
              const bytes = new Uint8Array(await blob.arrayBuffer())
              const img = await doc.embedPng(bytes)
              const pdfX = (ann.x / cW) * pW
              const pdfY = pH - ((ann.y + ann.height) / cH) * pH
              pdfPage.drawImage(img, {
                x: Math.max(0, pdfX),
                y: Math.max(0, pdfY),
                width: (ann.width / cW) * pW,
                height: (ann.height / cH) * pH,
              })
            } catch {}
          }
        }

        // Embed draw layer
        const paths = drawPathsRef.current[pNum]
        if (paths?.length) {
          const tmp = document.createElement('canvas')
          tmp.width = cW; tmp.height = cH
          const ctx = tmp.getContext('2d')
          paths.forEach(({ points, color, size }) => {
            if (points.length < 2) return
            ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = size
            ctx.lineCap = 'round'; ctx.lineJoin = 'round'
            ctx.moveTo(points[0].x, points[0].y)
            points.slice(1).forEach(p => ctx.lineTo(p.x, p.y))
            ctx.stroke()
          })
          try {
            const res = await fetch(tmp.toDataURL('image/png'))
            const bytes = new Uint8Array(await (await res.blob()).arrayBuffer())
            const img = await doc.embedPng(bytes)
            pdfPage.drawImage(img, { x: 0, y: 0, width: pW, height: pH })
          } catch {}
        }
      }

      const bytes = await doc.save()
      const blob = new Blob([bytes], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = (filename.replace(/\.pdf$/i, '') || 'document') + '_edited.pdf'
      a.click()
      URL.revokeObjectURL(url)
      showToast('PDF downloaded!')
    } catch (e) {
      showToast('Save error: ' + e.message)
      console.error(e)
    }
  }

  // ─── Total annotations count ──────────────────────────────
  const totalAnns = Object.values(annotations).reduce((s, a) => s + a.filter(x => x.type === 'signature' || x.content?.trim()).length, 0)
    + Object.values(drawPathsRef.current).reduce((s, p) => s + p.length, 0)

  // ─── Render ───────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: '#0f1117', fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      {/* Google fonts */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Dancing+Script:wght@700&family=Pinyon+Script&display=swap');
        .pdf-annot-text:focus { outline: none; }
        .pdf-annot-text[contenteditable="true"] { cursor: text; }
        .pdf-annot-text { cursor: default; white-space: pre-wrap; word-break: break-word; min-width: 20px; min-height: 1em; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #374151; border-radius: 3px; }
        .sig-canvas-wrap { position: relative; }
        .tool-tip { position: relative; }
        .tool-tip:hover::after {
          content: attr(data-tip);
          position: absolute;
          bottom: -28px; left: 50%;
          transform: translateX(-50%);
          background: #111827;
          color: #f9fafb;
          font-size: 11px;
          padding: 3px 8px;
          border-radius: 4px;
          white-space: nowrap;
          pointer-events: none;
          z-index: 999;
        }
      `}</style>

      {/* ── TOP BAR ── */}
      <div style={{ background: '#0d1117', borderBottom: '1px solid rgba(255,255,255,.06)', height: 52, display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', flexShrink: 0, zIndex: 50 }}>
        <button
          onClick={() => navigate('/pdf-editor')}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 6, border: 'none', background: 'transparent', color: '#9ca3af', cursor: 'pointer', fontSize: 13 }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,.07)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <ArrowLeft size={15} /> Back
        </button>

        <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,.1)', margin: '0 4px' }} />

        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#f9fafb', fontWeight: 600, fontSize: 15, letterSpacing: '-0.02em' }}>
          <div style={{ width: 28, height: 28, background: 'linear-gradient(135deg,#4f8ef7,#7c3aed)', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 14 }}>📄</span>
          </div>
          PDF
        </div>

        {filename && (
          <span style={{ color: '#6b7280', fontSize: 13, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginLeft: 4 }}>
            — {filename}
          </span>
        )}

        <div style={{ flex: 1 }} />

        {/* Zoom controls */}
        {pdfJsDoc && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {[
              { icon: <ZoomOut size={14} />, action: () => changeZoom(-0.15), tip: 'Zoom out' },
              { icon: <ZoomIn size={14} />, action: () => changeZoom(0.15), tip: 'Zoom in' },
              { icon: <Maximize2 size={13} />, action: fitPage, tip: 'Fit page' },
            ].map(({ icon, action, tip }, i) => (
              <button key={i} onClick={action} title={tip}
                style={{ width: 30, height: 30, borderRadius: 5, border: 'none', background: 'rgba(255,255,255,.06)', color: '#9ca3af', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,.12)'; e.currentTarget.style.color = '#fff' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,.06)'; e.currentTarget.style.color = '#9ca3af' }}
              >{icon}</button>
            ))}
            <span style={{ color: '#9ca3af', fontSize: 12, minWidth: 44, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
          </div>
        )}

        <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,.1)', margin: '0 4px' }} />

        <button onClick={() => fileInputRef.current?.click()}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 6, border: 'none', background: 'rgba(255,255,255,.07)', color: '#d1d5db', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,.12)'}
          onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,.07)'}
        >
          <Upload size={14} /> Open PDF
        </button>

        <button onClick={savePDF} disabled={!pdfJsDoc}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 16px', borderRadius: 6, border: 'none', background: pdfJsDoc ? '#4f8ef7' : '#1f2937', color: pdfJsDoc ? '#fff' : '#4b5563', cursor: pdfJsDoc ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 600 }}
          onMouseEnter={e => { if (pdfJsDoc) e.currentTarget.style.background = '#3b7ef0' }}
          onMouseLeave={e => { if (pdfJsDoc) e.currentTarget.style.background = '#4f8ef7' }}
        >
          <Download size={14} /> Download PDF
        </button>
      </div>

      {/* ── TOOLBAR ── */}
      <div style={{ background: '#161b27', borderBottom: '1px solid rgba(255,255,255,.05)', height: 46, display: 'flex', alignItems: 'center', gap: 6, padding: '0 14px', flexShrink: 0 }}>
        {/* Tool groups */}
        <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,.04)', borderRadius: 6, padding: '3px' }}>
          {[
            { tool: TOOLS.SELECT, icon: <MousePointer2 size={15} />, label: 'Select (V)' },
            { tool: TOOLS.TEXT, icon: <Type size={15} />, label: 'Text (T)' },
            { tool: TOOLS.SIGNATURE, icon: <PenLine size={15} />, label: 'Signature (S)' },
            { tool: TOOLS.DRAW, icon: <Pencil size={15} />, label: 'Draw (D)' },
          ].map(({ tool, icon, label }) => (
            <button key={tool} onClick={() => setActiveTool(tool)} title={label}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 34, height: 30, borderRadius: 5, border: 'none',
                background: activeTool === tool ? '#4f8ef7' : 'transparent',
                color: activeTool === tool ? '#fff' : '#9ca3af',
                cursor: 'pointer', transition: 'all .12s',
              }}
              onMouseEnter={e => { if (activeTool !== tool) { e.currentTarget.style.background = 'rgba(255,255,255,.08)'; e.currentTarget.style.color = '#fff' } }}
              onMouseLeave={e => { if (activeTool !== tool) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9ca3af' } }}
            >{icon}</button>
          ))}
        </div>

        <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,.08)', margin: '0 4px' }} />

        {/* Text formatting (shown when text tool or text selected) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, opacity: activeTool === TOOLS.TEXT || (selectedAnn?.type === 'text') ? 1 : 0.3, pointerEvents: activeTool === TOOLS.TEXT || (selectedAnn?.type === 'text') ? 'all' : 'none', transition: 'opacity .15s' }}>
          <select value={textDefaults.fontSize} onChange={e => {
            const v = parseInt(e.target.value)
            setTextDefaults(p => ({ ...p, fontSize: v }))
            if (selectedAnn?.type === 'text') updateAnn(selectedAnn.id, { fontSize: v })
          }}
            style={{ background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 4, color: '#e5e7eb', fontSize: 12, padding: '3px 6px', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            {[8,10,11,12,14,16,18,20,24,28,32,36,42,48,60,72].map(s => <option key={s} value={s}>{s}px</option>)}
          </select>

          <select value={textDefaults.fontFamily} onChange={e => {
            setTextDefaults(p => ({ ...p, fontFamily: e.target.value }))
            if (selectedAnn?.type === 'text') updateAnn(selectedAnn.id, { fontFamily: e.target.value })
          }}
            style={{ background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 4, color: '#e5e7eb', fontSize: 12, padding: '3px 6px', cursor: 'pointer', fontFamily: 'inherit', width: 110 }}
          >
            <option value="Helvetica">Helvetica</option>
            <option value="Times New Roman">Times New Roman</option>
            <option value="Courier">Courier</option>
            <option value="Georgia">Georgia</option>
          </select>

          {[
            { key: 'bold', icon: <Bold size={13} />, label: 'Bold' },
            { key: 'italic', icon: <Italic size={13} />, label: 'Italic' },
            { key: 'underline', icon: <UnderlineIcon size={13} />, label: 'Underline' },
          ].map(({ key, icon, label }) => (
            <button key={key} title={label}
              onClick={() => {
                const val = !textDefaults[key]
                setTextDefaults(p => ({ ...p, [key]: val }))
                if (selectedAnn?.type === 'text') updateAnn(selectedAnn.id, { [key]: val })
              }}
              style={{
                width: 30, height: 28, borderRadius: 4, border: 'none',
                background: textDefaults[key] ? '#4f8ef7' : 'rgba(255,255,255,.06)',
                color: textDefaults[key] ? '#fff' : '#9ca3af',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >{icon}</button>
          ))}

          {/* Color picker */}
          <div style={{ position: 'relative', width: 28, height: 28 }}>
            <div style={{ width: 22, height: 22, borderRadius: '50%', background: textDefaults.color, border: '2px solid rgba(255,255,255,.2)', margin: 3, cursor: 'pointer' }} />
            <input type="color" value={textDefaults.color}
              onChange={e => {
                setTextDefaults(p => ({ ...p, color: e.target.value }))
                if (selectedAnn?.type === 'text') updateAnn(selectedAnn.id, { color: e.target.value })
              }}
              style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }}
            />
          </div>
        </div>

        <div style={{ flex: 1 }} />

        {/* Panel toggles */}
        <button onClick={() => setSidebarOpen(v => !v)} title="Toggle page thumbnails"
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 5, border: 'none', background: sidebarOpen ? 'rgba(79,142,247,.15)' : 'rgba(255,255,255,.04)', color: sidebarOpen ? '#4f8ef7' : '#9ca3af', cursor: 'pointer', fontSize: 12, fontWeight: 500 }}
        >
          <LayoutList size={14} /> Pages
        </button>
        <button onClick={() => setPanelOpen(v => !v)} title="Toggle properties"
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 5, border: 'none', background: panelOpen ? 'rgba(79,142,247,.15)' : 'rgba(255,255,255,.04)', color: panelOpen ? '#4f8ef7' : '#9ca3af', cursor: 'pointer', fontSize: 12, fontWeight: 500 }}
        >
          <SlidersHorizontal size={14} /> Properties
        </button>
      </div>

      {/* ── WORKSPACE ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* LEFT SIDEBAR */}
        {sidebarOpen && (
          <div style={{ width: 190, background: '#111827', borderRight: '1px solid rgba(255,255,255,.04)', display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden' }}>
            <div style={{ padding: '10px 12px 6px', borderBottom: '1px solid rgba(255,255,255,.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ color: '#6b7280', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.08em' }}>Pages</span>
              {totalPages > 0 && <span style={{ color: '#4b5563', fontSize: 11 }}>{totalPages} total</span>}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {!pdfJsDoc ? (
                <div style={{ color: '#374151', fontSize: 12, textAlign: 'center', padding: '24px 8px' }}>Open a PDF to see pages</div>
              ) : (
                Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
                  <div key={n} onClick={() => goToPage(n)}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, padding: 5, borderRadius: 5, cursor: 'pointer', background: currentPage === n ? 'rgba(79,142,247,.12)' : 'transparent', transition: 'background .12s' }}
                    onMouseEnter={e => { if (currentPage !== n) e.currentTarget.style.background = 'rgba(255,255,255,.04)' }}
                    onMouseLeave={e => { if (currentPage !== n) e.currentTarget.style.background = 'transparent' }}
                  >
                    <div style={{ background: 'white', borderRadius: 3, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,.4)', border: `2px solid ${currentPage === n ? '#4f8ef7' : 'transparent'}`, width: '100%' }}>
                      <canvas ref={el => { if (el) thumbnailRefs.current[n] = el }} style={{ display: 'block', width: '100%' }} />
                    </div>
                    <span style={{ color: currentPage === n ? '#4f8ef7' : '#6b7280', fontSize: 11 }}>{n}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* MAIN CANVAS AREA */}
        <div ref={canvasAreaRef}
          style={{ flex: 1, overflowAuto: 'scroll', overflow: 'auto', background: '#1e2330', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 28, position: 'relative' }}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          {!pdfJsDoc ? (
            /* Drop zone */
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 18, width: '100%', maxWidth: 560, margin: 'auto',
              border: `2px dashed ${dragOver ? '#4f8ef7' : '#374151'}`,
              borderRadius: 16, background: dragOver ? 'rgba(79,142,247,.04)' : 'rgba(255,255,255,.02)',
              padding: 60, cursor: 'pointer', transition: 'all .2s',
            }}
              onClick={() => fileInputRef.current?.click()}
            >
              <div style={{ width: 64, height: 64, background: 'rgba(79,142,247,.1)', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Upload size={28} color="#4f8ef7" />
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: '#f9fafb', fontSize: 18, fontWeight: 600, marginBottom: 6 }}>Open a PDF to get started</div>
                <div style={{ color: '#6b7280', fontSize: 14 }}>Drag & drop a PDF here, or click to browse</div>
              </div>
              <button style={{ padding: '10px 28px', background: '#4f8ef7', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                Browse Files
              </button>
            </div>
          ) : (
            <>
              {/* Page + annotations */}
              <div style={{ position: 'relative', boxShadow: '0 12px 48px rgba(0,0,0,.5)', cursor: CURSORS[activeTool] }}
                onClick={handleCanvasClick}
              >
                {loadingPdf && (
                  <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, borderRadius: 2 }}>
                    <div style={{ width: 28, height: 28, border: '3px solid #4f8ef7', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
                  </div>
                )}
                <canvas ref={pageCanvasRef} style={{ display: 'block' }} />

                {/* Draw canvas */}
                <canvas ref={drawCanvasRef}
                  style={{ position: 'absolute', top: 0, left: 0, pointerEvents: activeTool === TOOLS.DRAW ? 'all' : 'none', cursor: activeTool === TOOLS.DRAW ? 'crosshair' : 'default' }}
                  onMouseDown={onDrawStart}
                  onMouseMove={onDrawMove}
                  onMouseUp={onDrawEnd}
                  onMouseLeave={onDrawEnd}
                />

                {/* Annotations layer */}
                <div ref={annotLayerRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                  {getPageAnns(currentPage).map(ann => (
                    <AnnotationElement
                      key={ann.id}
                      ann={ann}
                      selected={selectedId === ann.id}
                      activeTool={activeTool}
                      onMouseDown={onAnnMouseDown}
                      onDelete={() => deleteAnn(ann.id)}
                      onUpdate={changes => updateAnn(ann.id, changes)}
                      onSelect={() => setSelectedId(ann.id)}
                    />
                  ))}
                </div>
              </div>

              {/* Page navigation */}
              {totalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 20 }}>
                  <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1}
                    style={{ width: 34, height: 34, borderRadius: 6, border: 'none', background: currentPage <= 1 ? '#1f2937' : '#374151', color: currentPage <= 1 ? '#4b5563' : '#d1d5db', cursor: currentPage <= 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  ><ChevronLeft size={17} /></button>
                  <span style={{ color: '#9ca3af', fontSize: 13, background: '#1f2937', padding: '5px 14px', borderRadius: 6 }}>
                    Page {currentPage} of {totalPages}
                  </span>
                  <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= totalPages}
                    style={{ width: 34, height: 34, borderRadius: 6, border: 'none', background: currentPage >= totalPages ? '#1f2937' : '#374151', color: currentPage >= totalPages ? '#4b5563' : '#d1d5db', cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  ><ChevronRight size={17} /></button>
                </div>
              )}
            </>
          )}
        </div>

        {/* RIGHT PANEL */}
        {panelOpen && (
          <div style={{ width: 230, background: '#fff', borderLeft: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px', borderBottom: '1px solid #f3f4f6' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.08em' }}>Properties</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>

              {/* Selected annotation */}
              {selectedAnn && (
                <div style={{ marginBottom: 16, padding: 12, background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>Selection</div>
                  {selectedAnn.type === 'text' && (
                    <>
                      <PanelRow label="Size">
                        <input type="number" min={6} max={120} value={selectedAnn.fontSize}
                          onChange={e => updateAnn(selectedAnn.id, { fontSize: parseInt(e.target.value) || 12 })}
                          style={{ width: '100%', padding: '4px 8px', border: '1px solid #e5e7eb', borderRadius: 4, fontSize: 13, fontFamily: 'inherit' }}
                        />
                      </PanelRow>
                      <PanelRow label="Color">
                        <input type="color" value={selectedAnn.color}
                          onChange={e => updateAnn(selectedAnn.id, { color: e.target.value })}
                          style={{ width: '100%', height: 30, padding: '2px 4px', border: '1px solid #e5e7eb', borderRadius: 4, cursor: 'pointer' }}
                        />
                      </PanelRow>
                    </>
                  )}
                  {selectedAnn.type === 'signature' && (
                    <div style={{ marginBottom: 8 }}>
                      <img src={selectedAnn.imageData} alt="sig" style={{ width: '100%', objectFit: 'contain', maxHeight: 60 }} />
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
                        {Math.round(selectedAnn.width)} × {Math.round(selectedAnn.height)} px<br />
                        Drag to reposition · resize from corner
                      </div>
                    </div>
                  )}
                  <button onClick={() => deleteAnn(selectedAnn.id)}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '6px 0', background: '#fef2f2', color: '#ef4444', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontWeight: 500 }}
                    onMouseEnter={e => e.currentTarget.style.background = '#fee2e2'}
                    onMouseLeave={e => e.currentTarget.style.background = '#fef2f2'}
                  >
                    <Trash2 size={13} /> Delete
                  </button>
                </div>
              )}

              {/* Saved signatures */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Saved Signatures</div>
                {savedSigs.length === 0 ? (
                  <div style={{ color: '#9ca3af', fontSize: 12, textAlign: 'center', padding: '14px 0' }}>No signatures saved yet</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {savedSigs.map(sig => (
                      <div key={sig.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', border: '1px solid #e5e7eb', borderRadius: 8, cursor: pdfJsDoc ? 'pointer' : 'default', transition: 'all .12s' }}
                        onMouseEnter={e => { if (pdfJsDoc) e.currentTarget.style.borderColor = '#4f8ef7' }}
                        onMouseLeave={e => e.currentTarget.style.borderColor = '#e5e7eb'}
                        onClick={() => {
                          if (!pdfJsDoc) { showToast('Open a PDF first'); return }
                          const canvas = pageCanvasRef.current
                          if (!canvas) return
                          placeSig(sig.imageData, canvas.width / 2, canvas.height / 2)
                          showToast('Signature placed — drag to position')
                        }}
                      >
                        <img src={sig.imageData} alt="sig" style={{ height: 28, maxWidth: 110, objectFit: 'contain', flex: 1 }} />
                        <button onClick={e => { e.stopPropagation(); setSavedSigs(p => p.filter(s => s.id !== sig.id)) }}
                          style={{ width: 20, height: 20, border: 'none', background: 'transparent', color: '#ef4444', cursor: 'pointer', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}
                        >×</button>
                      </div>
                    ))}
                  </div>
                )}
                <button onClick={() => { pendingSigPos.current = null; openSigModal() }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '7px 0', background: '#f9fafb', color: '#4b5563', border: '1px dashed #d1d5db', borderRadius: 6, fontSize: 13, cursor: 'pointer', marginTop: 8, fontWeight: 500 }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#f3f4f6'; e.currentTarget.style.borderColor = '#9ca3af' }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#f9fafb'; e.currentTarget.style.borderColor = '#d1d5db' }}
                >
                  <Plus size={13} /> New Signature
                </button>
              </div>

              {/* Stats */}
              <div style={{ padding: 10, background: '#f9fafb', borderRadius: 8, border: '1px solid #f3f4f6' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Document</div>
                {[
                  ['Pages', totalPages || '—'],
                  ['Annotations', totalAnns],
                  ['Zoom', Math.round(zoom * 100) + '%'],
                  ['Current page', pdfJsDoc ? currentPage : '—'],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6b7280', marginBottom: 5 }}>
                    <span>{k}</span>
                    <span style={{ color: '#1f2937', fontWeight: 500 }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── STATUS BAR ── */}
      <div style={{ background: '#0d1117', borderTop: '1px solid rgba(255,255,255,.05)', height: 26, display: 'flex', alignItems: 'center', gap: 20, padding: '0 14px', flexShrink: 0 }}>
        {[
          ['Tool', activeTool.charAt(0).toUpperCase() + activeTool.slice(1)],
          ['Zoom', Math.round(zoom * 100) + '%'],
          ['Page', pdfJsDoc ? `${currentPage} / ${totalPages}` : '—'],
          ['Annotations', totalAnns],
        ].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 11, color: '#4b5563' }}>
            {k}: <span style={{ color: '#9ca3af' }}>{v}</span>
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: '#374151' }}>V · Select &nbsp; T · Text &nbsp; S · Signature &nbsp; D · Draw &nbsp; Del · Delete</span>
      </div>

      {/* ── SIGNATURE MODAL ── */}
      {sigModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) closeSigModal() }}
        >
          <div style={{ background: '#fff', borderRadius: 14, boxShadow: '0 24px 80px rgba(0,0,0,.3)', width: 580, maxWidth: '95vw', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px 14px', borderBottom: '1px solid #f3f4f6' }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>Add Signature</span>
              <button onClick={closeSigModal} style={{ width: 28, height: 28, borderRadius: 6, border: 'none', background: '#f3f4f6', color: '#6b7280', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={16} /></button>
            </div>

            <div style={{ padding: 20 }}>
              {/* Tabs */}
              <div style={{ display: 'flex', borderBottom: '1px solid #f3f4f6', marginBottom: 16 }}>
                {['draw', 'type'].map(tab => (
                  <button key={tab} onClick={() => setSigTab(tab)}
                    style={{ padding: '8px 20px', border: 'none', background: 'transparent', fontSize: 14, fontWeight: 500, cursor: 'pointer', color: sigTab === tab ? '#4f8ef7' : '#6b7280', borderBottom: `2px solid ${sigTab === tab ? '#4f8ef7' : 'transparent'}`, marginBottom: -1, fontFamily: 'inherit', textTransform: 'capitalize' }}
                  >{tab === 'draw' ? 'Draw' : 'Type'}</button>
                ))}
              </div>

              {sigTab === 'draw' ? (
                <div>
                  <div className="sig-canvas-wrap" style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', background: '#fafafa', position: 'relative' }}>
                    <canvas ref={sigCanvasRef} style={{ display: 'block', touchAction: 'none' }} />
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#d1d5db', fontSize: 14, pointerEvents: 'none' }}
                      id="sig-hint"
                    >Sign with your mouse or touch</div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                    <button onClick={() => { sigPadRef.current?.clear(); document.getElementById('sig-hint') && (document.getElementById('sig-hint').style.opacity = 1) }}
                      style={{ padding: '5px 14px', background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}
                    >Clear</button>
                  </div>
                </div>
              ) : (
                <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: 20 }}>
                  <input type="text" placeholder="Type your name…" value={typedName} onChange={e => setTypedName(e.target.value)} maxLength={60}
                    style={{ width: '100%', border: 'none', background: 'transparent', fontFamily: `'${sigFont}', cursive`, fontSize: 42, color: '#1a1a2e', textAlign: 'center', outline: 'none', marginBottom: 12, boxSizing: 'border-box' }}
                  />
                  <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 6, padding: '12px 0', textAlign: 'center', minHeight: 70, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontFamily: `'${sigFont}', cursive`, fontSize: 48, color: '#1a1a2e' }}>{typedName || ''}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
                    {[['Dancing Script', 'Signature Style'], ['Pinyon Script', 'Elegant Style']].map(([f, label]) => (
                      <button key={f} onClick={() => setSigFont(f)}
                        style={{ padding: '5px 16px', border: `1px solid ${sigFont === f ? '#4f8ef7' : '#e5e7eb'}`, borderRadius: 20, background: sigFont === f ? 'rgba(79,142,247,.08)' : 'white', color: sigFont === f ? '#4f8ef7' : '#6b7280', cursor: 'pointer', fontFamily: `'${f}', cursive`, fontSize: 18 }}
                      >Aa</button>
                    ))}
                  </div>
                </div>
              )}

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#6b7280', cursor: 'pointer', marginTop: 14 }}>
                <input type="checkbox" checked={saveToLib} onChange={e => setSaveToLib(e.target.checked)} style={{ accentColor: '#4f8ef7' }} />
                Save this signature for future use
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 20px', borderTop: '1px solid #f3f4f6' }}>
              <button onClick={closeSigModal} style={{ padding: '8px 18px', background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 7, fontSize: 13, cursor: 'pointer', fontWeight: 500, fontFamily: 'inherit' }}>Cancel</button>
              <button onClick={applySig} style={{ padding: '8px 20px', background: '#4f8ef7', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit' }}>Apply Signature</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 44, left: '50%', transform: 'translateX(-50%)', background: '#1f2937', color: '#f9fafb', padding: '10px 20px', borderRadius: 24, fontSize: 13, boxShadow: '0 8px 32px rgba(0,0,0,.3)', zIndex: 2000, pointerEvents: 'none' }}>
          {toast}
        </div>
      )}

      <input ref={fileInputRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={handleFileInput} />

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

// ─── Annotation Element ────────────────────────────────────
function AnnotationElement({ ann, selected, activeTool, onMouseDown, onDelete, onUpdate, onSelect }) {
  const textRef = useRef(null)
  const [editing, setEditing] = useState(ann.editing || false)
  const [resizing, setResizing] = useState(false)
  const resizeStart = useRef({})

  useEffect(() => {
    if (editing && textRef.current) {
      textRef.current.focus()
      const range = document.createRange()
      range.selectNodeContents(textRef.current)
      range.collapse(false)
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
    }
  }, [editing])

  const handleMouseDown = (e) => {
    if (activeTool !== 'select') return
    onSelect()
    onMouseDown(e, ann)
  }

  const handleDblClick = (e) => {
    if (ann.type !== 'text') return
    e.stopPropagation()
    setEditing(true)
    onSelect()
  }

  const handleBlur = () => {
    setEditing(false)
    const content = textRef.current?.textContent || ''
    onUpdate({ content, editing: false })
    if (!content.trim()) onDelete()
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); textRef.current?.blur() }
    e.stopPropagation()
  }

  // Signature resize
  const onResizeDown = (e) => {
    e.stopPropagation(); e.preventDefault()
    resizeStart.current = { mx: e.clientX, my: e.clientY, w: ann.width, h: ann.height }
    setResizing(true)
    const onMove = (me) => {
      onUpdate({
        width: Math.max(50, resizeStart.current.w + me.clientX - resizeStart.current.mx),
        height: Math.max(20, resizeStart.current.h + me.clientY - resizeStart.current.my),
      })
    }
    const onUp = () => {
      setResizing(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  if (ann.type === 'text') {
    return (
      <div
        style={{ position: 'absolute', left: ann.x, top: ann.y, pointerEvents: 'all', userSelect: 'none', zIndex: selected ? 10 : 5 }}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDblClick}
      >
        <div style={{ position: 'relative', padding: '2px 4px', outline: selected ? '2px solid #4f8ef7' : editing ? '2px dashed #4f8ef7' : 'none', outlineOffset: 2, borderRadius: 2 }}>
          <span
            ref={textRef}
            className="pdf-annot-text"
            contentEditable={editing}
            suppressContentEditableWarning
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            onClick={e => { if (editing) e.stopPropagation() }}
            style={{
              fontSize: ann.fontSize, fontFamily: ann.fontFamily,
              color: ann.color, fontWeight: ann.bold ? 700 : 400,
              fontStyle: ann.italic ? 'italic' : 'normal',
              textDecoration: ann.underline ? 'underline' : 'none',
              display: 'block', minWidth: 20, minHeight: '1em',
              cursor: editing ? 'text' : activeTool === 'select' ? 'move' : 'default',
            }}
          >{ann.content}</span>
          {selected && (
            <button onClick={e => { e.stopPropagation(); onDelete() }}
              style={{ position: 'absolute', top: -10, right: -10, width: 20, height: 20, background: '#ef4444', border: '2px solid white', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'white', fontWeight: 700, zIndex: 20 }}
            >×</button>
          )}
        </div>
      </div>
    )
  }

  if (ann.type === 'signature') {
    return (
      <div
        style={{ position: 'absolute', left: ann.x, top: ann.y, width: ann.width, height: ann.height, pointerEvents: 'all', userSelect: 'none', zIndex: selected ? 10 : 5 }}
        onMouseDown={handleMouseDown}
      >
        <div style={{ position: 'relative', width: '100%', height: '100%', outline: selected ? '2px solid #4f8ef7' : 'none', outlineOffset: 2 }}>
          <img src={ann.imageData} alt="signature" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
          {selected && (
            <>
              <button onClick={e => { e.stopPropagation(); onDelete() }}
                style={{ position: 'absolute', top: -10, right: -10, width: 20, height: 20, background: '#ef4444', border: '2px solid white', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'white', fontWeight: 700, zIndex: 20 }}
              >×</button>
              <div onMouseDown={onResizeDown}
                style={{ position: 'absolute', bottom: -5, right: -5, width: 12, height: 12, background: '#4f8ef7', border: '2px solid white', borderRadius: 2, cursor: 'se-resize', zIndex: 20 }}
              />
            </>
          )}
        </div>
      </div>
    )
  }

  return null
}

function PanelRow({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <span style={{ fontSize: 12, color: '#6b7280', width: 44, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  )
}
