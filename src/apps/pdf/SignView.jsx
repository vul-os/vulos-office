import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import * as pdfjsLib from 'pdfjs-dist'
import SignaturePad from 'signature_pad'
import {
  AlertCircle,
  Check,
  CheckCircle,
  ChevronDown,
  FileText,
  Loader2,
  Lock,
  Pen,
  RefreshCw,
  Type,
  Upload,
} from 'lucide-react'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href

const FIELD_COLORS = {
  signature: 'border-indigo-500 bg-indigo-50',
  initial:   'border-purple-500 bg-purple-50',
  date:      'border-emerald-500 bg-emerald-50',
  name:      'border-sky-500 bg-sky-50',
  text:      'border-amber-500 bg-amber-50',
}

const FIELD_LABELS = {
  signature: 'Signature',
  initial:   'Initial',
  date:      'Date',
  name:      'Full Name',
  text:      'Text',
}

const TYPED_FONTS = [
  { label: 'Elegant', value: '"Dancing Script", cursive' },
  { label: 'Classic', value: '"Pacifico", cursive' },
  { label: 'Neat',    value: '"Satisfy", cursive' },
  { label: 'Formal',  value: 'Georgia, serif' },
]

// Load Google Fonts for typed signature preview
const GFONTS_LINK = 'https://fonts.googleapis.com/css2?family=Dancing+Script:wght@600&family=Pacifico&family=Satisfy&display=swap'
function ensureGFonts() {
  if (document.querySelector(`link[href="${GFONTS_LINK}"]`)) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = GFONTS_LINK
  document.head.appendChild(link)
}

// ── DrawPad: canvas-based draw mode using signature_pad ──────────
function DrawPad({ onDataUrl }) {
  const canvasRef = useRef(null)
  const padRef    = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const pad = new SignaturePad(canvas, { backgroundColor: 'rgb(255,255,255)' })
    padRef.current = pad
    const notify = () => {
      if (!pad.isEmpty()) onDataUrl(pad.toDataURL('image/png'))
      else onDataUrl(null)
    }
    pad.addEventListener('endStroke', notify)
    return () => {
      pad.removeEventListener('endStroke', notify)
      pad.off()
    }
  }, [onDataUrl])

  const clear = () => {
    padRef.current?.clear()
    onDataUrl(null)
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        width={400}
        height={120}
        className="w-full border border-gray-300 rounded-lg bg-white touch-none"
        style={{ maxHeight: 120 }}
      />
      <button
        type="button"
        onClick={clear}
        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
      >
        <RefreshCw className="w-3 h-3" /> Clear
      </button>
    </div>
  )
}

// ── TypedPad: text → PNG via canvas ─────────────────────────────
function TypedPad({ signerName, onDataUrl }) {
  const [text, setText] = useState(signerName || '')
  const [fontIdx, setFontIdx] = useState(0)
  const canvasRef = useRef(null)

  const render = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    const font = TYPED_FONTS[fontIdx].value
    ctx.font = `36px ${font}`
    ctx.fillStyle = '#1a1a2e'
    ctx.textBaseline = 'middle'
    ctx.fillText(text || '', 12, canvas.height / 2)
    if (text.trim()) onDataUrl(canvas.toDataURL('image/png'))
    else onDataUrl(null)
  }, [text, fontIdx, onDataUrl])

  useEffect(() => { ensureGFonts() }, [])
  useEffect(() => { render() }, [render])

  return (
    <div className="space-y-3">
      <input
        type="text"
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Type your name"
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
      />

      {/* font picker */}
      <div className="flex gap-2 flex-wrap">
        {TYPED_FONTS.map((f, i) => (
          <button
            key={f.label}
            type="button"
            onClick={() => setFontIdx(i)}
            className={`px-3 py-1 text-sm rounded-full border transition-colors ${
              fontIdx === i
                ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                : 'border-gray-200 text-gray-600 hover:border-gray-400'
            }`}
            style={{ fontFamily: f.value }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* preview canvas (hidden — just used for PNG generation) */}
      <canvas
        ref={canvasRef}
        width={400}
        height={80}
        className="w-full border border-gray-200 rounded-lg bg-white"
        style={{ fontFamily: TYPED_FONTS[fontIdx].value }}
      />
    </div>
  )
}

// ── UploadPad: file upload → base64 data URL ─────────────────────
function UploadPad({ onDataUrl }) {
  const [preview, setPreview] = useState(null)

  const onFile = e => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const url = ev.target.result
      setPreview(url)
      onDataUrl(url)
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="space-y-3">
      <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-lg py-6 cursor-pointer hover:border-indigo-400 transition-colors bg-gray-50">
        <Upload className="w-6 h-6 text-gray-400 mb-1" />
        <span className="text-sm text-gray-500">Click to upload PNG/JPG</span>
        <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={onFile} />
      </label>
      {preview && (
        <img src={preview} alt="uploaded signature" className="max-h-20 object-contain rounded border border-gray-200" />
      )}
    </div>
  )
}

// ── FieldFillModal: let the signer fill one field ───────────────
function FieldFillModal({ field, signerName, onSave, onClose }) {
  const isSignatureOrInitial = field.type === 'signature' || field.type === 'initial'
  const [mode, setMode] = useState('draw') // draw | type | upload
  const [dataUrl, setDataUrl] = useState(null)
  const [textValue, setTextValue] = useState(
    field.type === 'date' ? new Date().toLocaleDateString() : ''
  )

  const canSave = isSignatureOrInitial ? !!dataUrl : !!textValue.trim()

  const save = () => {
    if (!canSave) return
    onSave(field.id, isSignatureOrInitial ? dataUrl : textValue.trim())
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 text-sm">
            Fill {FIELD_LABELS[field.type] ?? field.type} field
            {field.required && <span className="ml-1 text-red-500">*</span>}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
        </div>

        <div className="p-5 space-y-4">
          {/* signature / initial: draw / type / upload tabs */}
          {isSignatureOrInitial && (
            <>
              <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                {[
                  { id: 'draw',   label: 'Draw',   icon: Pen },
                  { id: 'type',   label: 'Type',   icon: Type },
                  { id: 'upload', label: 'Upload', icon: Upload },
                ].map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => { setMode(id); setDataUrl(null) }}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm transition-colors ${
                      mode === id
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                  </button>
                ))}
              </div>

              {mode === 'draw'   && <DrawPad   onDataUrl={setDataUrl} />}
              {mode === 'type'   && <TypedPad  signerName={signerName} onDataUrl={setDataUrl} />}
              {mode === 'upload' && <UploadPad onDataUrl={setDataUrl} />}
            </>
          )}

          {/* date: auto-filled, editable */}
          {field.type === 'date' && (
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Date</label>
              <input
                type="text"
                value={textValue}
                onChange={e => setTextValue(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
          )}

          {/* name / text */}
          {(field.type === 'name' || field.type === 'text') && (
            <div>
              <label className="text-xs text-gray-500 mb-1 block">
                {FIELD_LABELS[field.type]}
              </label>
              <input
                type="text"
                value={textValue}
                onChange={e => setTextValue(e.target.value)}
                placeholder={field.type === 'name' ? 'Your full name' : 'Enter text'}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            className="px-4 py-2 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}

// ── SignView — public signer page. No Vulos login required. ──────
// Route: /sign/:token
export default function SignView() {
  const { token } = useParams()

  const [state, setState] = useState('loading') // loading | locked | error | ready | done
  const [view, setView] = useState(null)         // SignerViewResponse from API
  const [errorMsg, setErrorMsg] = useState('')

  // PDF rendering state
  const [pdfPages, setPdfPages] = useState([])
  const [pdfLoading, setPdfLoading] = useState(false)

  // Ceremony state
  const [fieldValues, setFieldValues] = useState({}) // fieldId → value (dataUrl or text)
  const [activeField, setActiveField] = useState(null) // field being filled
  const [consent, setConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  // ── fetch the scoped view from the backend ──────────────────
  useEffect(() => {
    if (!token) return

    fetch(`/api/sign/${token}`)
      .then(async (res) => {
        const data = await res.json()
        if (res.status === 403 && data.locked) {
          setState('locked')
          return
        }
        if (!res.ok) {
          setErrorMsg(data.error || 'Could not load signing session.')
          setState('error')
          return
        }
        setView(data)
        // Auto-fill date fields
        const autoValues = {}
        for (const f of (data.fields ?? [])) {
          if (f.type === 'date') autoValues[f.id] = new Date().toLocaleDateString()
        }
        setFieldValues(autoValues)
        setState('ready')
      })
      .catch(() => {
        setErrorMsg('Network error. Please try again.')
        setState('error')
      })
  }, [token])

  // ── render the source PDF once the view is ready ────────────
  useEffect(() => {
    if (state !== 'ready' || !view?.source_file) return

    const pdfUrl = view.source_file.startsWith('/')
      ? view.source_file
      : `/api/uploads/${view.source_file}`

    setPdfLoading(true)
    pdfjsLib.getDocument(pdfUrl).promise
      .then(async (pdf) => {
        const pages = []
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i)
          const scale = 1.5
          const viewport = page.getViewport({ scale })
          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          const ctx = canvas.getContext('2d')
          await page.render({ canvasContext: ctx, viewport }).promise
          pages.push({ canvas, width: viewport.width, height: viewport.height, pageNum: i })
        }
        setPdfPages(pages)
      })
      .catch(() => {})
      .finally(() => setPdfLoading(false))
  }, [state, view])

  // ── derived helpers ───────────────────────────────────────────
  const fields = view?.fields ?? []
  const requiredFields = fields.filter(f => f.required)
  const allRequiredFilled = requiredFields.every(f => !!fieldValues[f.id])
  const canSubmit = allRequiredFilled && consent && !submitting

  const isFilled = id => !!fieldValues[id]

  const handleFieldFill = (fieldId, value) => {
    setFieldValues(prev => ({ ...prev, [fieldId]: value }))
    setActiveField(null)
  }

  // ── submit ────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setSubmitError('')

    // Build fieldValues map: {fieldId: value, ...}
    const fieldValuesPayload = {}
    for (const f of fields) {
      fieldValuesPayload[f.id] = fieldValues[f.id] ?? ''
    }

    try {
      const res = await fetch(`/api/sign/${token}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fieldValuesPayload),
      })
      const data = await res.json()
      if (!res.ok) {
        setSubmitError(data.error || 'Submission failed. Please try again.')
        return
      }
      setState('done')
    } catch {
      setSubmitError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── render helpers ────────────────────────────────────────────

  if (state === 'loading') {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-3 bg-gray-50">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        <p className="text-sm text-gray-500">Loading your signing session…</p>
      </div>
    )
  }

  if (state === 'locked') {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 bg-gray-50 px-4">
        <Lock className="w-12 h-12 text-amber-400" />
        <h1 className="text-xl font-semibold text-gray-800">Not your turn yet</h1>
        <p className="text-sm text-gray-500 text-center max-w-sm">
          A prior signer must complete their signature before this link becomes active.
          You'll be notified when it's your turn.
        </p>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 bg-gray-50 px-4">
        <AlertCircle className="w-12 h-12 text-red-400" />
        <h1 className="text-xl font-semibold text-gray-800">Link unavailable</h1>
        <p className="text-sm text-gray-500 text-center max-w-sm">{errorMsg}</p>
      </div>
    )
  }

  if (state === 'done') {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 bg-gray-50 px-4">
        <CheckCircle className="w-16 h-16 text-emerald-500" />
        <h1 className="text-2xl font-semibold text-gray-800">Signed successfully</h1>
        <p className="text-sm text-gray-500 text-center max-w-sm">
          Your signature has been submitted and recorded. You may close this window.
        </p>
      </div>
    )
  }

  // state === 'ready'
  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── header ── */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
        <FileText className="w-5 h-5 text-indigo-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">
            Signing request for <span className="text-indigo-600">{view.signer_name}</span>
          </p>
          <p className="text-xs text-gray-400">
            {fields.length} field{fields.length !== 1 ? 's' : ''} assigned to you
          </p>
        </div>
        <span className="text-xs text-gray-400 shrink-0">Vulos Office</span>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">

        {/* ── field checklist ── */}
        <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
            Your assigned fields
          </h2>
          {fields.length === 0 ? (
            <p className="text-sm text-gray-400">No fields assigned to you.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {fields.map((f) => (
                <li key={f.id} className="flex items-center gap-3 py-2">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${FIELD_COLORS[f.type] ?? 'border-gray-300 bg-gray-50'}`}
                  >
                    {FIELD_LABELS[f.type] ?? f.type}
                  </span>
                  <span className="text-xs text-gray-500">
                    Page {f.page} &nbsp;·&nbsp; ({Math.round(f.x)}, {Math.round(f.y)})
                  </span>
                  {f.required && (
                    <span className="text-xs text-red-500 font-medium">Required</span>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    {isFilled(f.id)
                      ? <Check className="w-4 h-4 text-emerald-500" />
                      : null}
                    <button
                      type="button"
                      onClick={() => setActiveField(f)}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                    >
                      {isFilled(f.id) ? 'Edit' : 'Fill'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── PDF viewer with field overlays ── */}
        <section className="space-y-4">
          {pdfLoading && (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading document…
            </div>
          )}

          {pdfPages.map(({ canvas, width, height, pageNum }) => {
            const pageFields = fields.filter((f) => f.page === pageNum)
            return (
              <div
                key={pageNum}
                className="relative bg-white shadow-sm rounded-lg overflow-hidden"
                style={{ width, maxWidth: '100%' }}
              >
                <img
                  src={canvas.toDataURL()}
                  alt={`Page ${pageNum}`}
                  style={{ width: '100%', display: 'block' }}
                />

                {pageFields.map((f) => {
                  const filled = isFilled(f.id)
                  const isImg = filled && fieldValues[f.id]?.startsWith('data:image')
                  return (
                    <div
                      key={f.id}
                      onClick={() => setActiveField(f)}
                      className={`absolute border-2 rounded flex items-center justify-center cursor-pointer
                        ${filled
                          ? 'border-emerald-400 bg-emerald-50/60'
                          : `${FIELD_COLORS[f.type] ?? 'border-gray-400 bg-gray-50'} bg-opacity-60`}
                        hover:brightness-95 transition-all`}
                      style={{ left: f.x, top: f.y, width: f.w, height: f.h }}
                    >
                      {filled && isImg ? (
                        <img
                          src={fieldValues[f.id]}
                          alt="signature"
                          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                        />
                      ) : filled ? (
                        <span className="text-xs font-medium text-gray-700 px-1 truncate w-full text-center">
                          {fieldValues[f.id]}
                        </span>
                      ) : (
                        <span className="text-xs font-medium opacity-70 select-none px-1 truncate">
                          {FIELD_LABELS[f.type] ?? f.type}{f.required ? ' *' : ''}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </section>

        {/* ── consent + submit ── */}
        <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <div className={`mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
              consent ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300'
            }`}>
              {consent && <Check className="w-2.5 h-2.5 text-white" />}
            </div>
            <input
              type="checkbox"
              className="sr-only"
              checked={consent}
              onChange={e => setConsent(e.target.checked)}
            />
            <span className="text-sm text-gray-600">
              I consent to signing this document electronically. My electronic signature
              is legally equivalent to a handwritten signature.
            </span>
          </label>

          {requiredFields.length > 0 && !allRequiredFilled && (
            <p className="text-xs text-amber-600 flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5" />
              Please fill all required fields before submitting.
            </p>
          )}

          {submitError && (
            <p className="text-xs text-red-600 flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5" />
              {submitError}
            </p>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-full py-3 rounded-xl text-sm font-semibold text-white bg-indigo-600
              hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed
              transition-colors flex items-center justify-center gap-2"
          >
            {submitting
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</>
              : <><CheckCircle className="w-4 h-4" /> Submit Signature</>}
          </button>
        </section>

        <div className="pb-8" />
      </div>

      {/* ── field fill modal ── */}
      {activeField && (
        <FieldFillModal
          field={activeField}
          signerName={view.signer_name}
          onSave={handleFieldFill}
          onClose={() => setActiveField(null)}
        />
      )}
    </div>
  )
}
