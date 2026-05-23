import { useCallback, useRef, useState } from 'react'
import {
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  FileSearch,
  Hash,
  Link,
  Loader2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Upload,
  User,
  XCircle,
} from 'lucide-react'

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

function Badge({ ok, label }) {
  if (ok) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
        <CheckCircle size={11} /> {label}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
      <XCircle size={11} /> {label}
    </span>
  )
}

function HashDisplay({ hash, label }) {
  if (!hash) return null
  return (
    <div className="flex items-start gap-2 mt-1">
      <Hash size={13} className="mt-0.5 text-gray-400 shrink-0" />
      <div>
        <span className="text-xs text-gray-500">{label}: </span>
        <span className="font-mono text-xs text-gray-700 break-all">{hash}</span>
      </div>
    </div>
  )
}

function SignerRow({ signer }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-white hover:bg-gray-50 transition-colors text-left"
      >
        <User size={15} className="text-gray-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="font-medium text-sm text-gray-800">{signer.name || signer.signer_id}</span>
          {signer.email && (
            <span className="ml-2 text-xs text-gray-400">{signer.email}</span>
          )}
        </div>
        <Badge ok={signer.token_ok} label={signer.token_ok ? 'Valid' : 'Invalid'} />
        {open ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 border-t bg-gray-50 space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="font-medium">Signer ID:</span>
            <span className="font-mono">{signer.signer_id}</span>
          </div>
          {signer.identity && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className="font-medium">Identity:</span>
              <span>{signer.identity}</span>
            </div>
          )}
          {signer.signed_at && signer.signed_at !== '0001-01-01T00:00:00Z' && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className="font-medium">Signed at:</span>
              <span>{new Date(signer.signed_at).toLocaleString()}</span>
            </div>
          )}
          {signer.token_error && (
            <div className="mt-2 p-2 rounded bg-red-50 border border-red-200 text-xs text-red-700">
              <AlertCircle size={12} className="inline mr-1" />
              {signer.token_error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────

export default function Verify() {
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState(null)
  const [envelopeId, setEnvelopeId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const inputRef = useRef(null)

  // ── drag-and-drop ──
  const onDragOver = useCallback((e) => {
    e.preventDefault()
    setDragging(true)
  }, [])
  const onDragLeave = useCallback(() => setDragging(false), [])
  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped && dropped.type === 'application/pdf') {
      setFile(dropped)
      setResult(null)
      setError(null)
    }
  }, [])

  function onFileInput(e) {
    const chosen = e.target.files[0]
    if (chosen) {
      setFile(chosen)
      setResult(null)
      setError(null)
    }
  }

  // ── submit ──
  async function handleVerify(e) {
    e.preventDefault()
    setError(null)
    setResult(null)
    setLoading(true)

    try {
      let res
      if (file) {
        const form = new FormData()
        form.append('pdf', file)
        res = await fetch('/api/sign/verify', { method: 'POST', body: form })
      } else if (envelopeId.trim()) {
        res = await fetch('/api/sign/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ envelope_id: envelopeId.trim() }),
        })
      } else {
        setError('Upload a sealed PDF or enter an envelope ID.')
        setLoading(false)
        return
      }

      const data = await res.json()
      if (res.ok || res.status === 422) {
        setResult(data)
      } else {
        setError(data.error || 'Verification request failed.')
      }
    } catch (err) {
      setError('Network error: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  function reset() {
    setFile(null)
    setResult(null)
    setError(null)
    setEnvelopeId('')
    if (inputRef.current) inputRef.current.value = ''
  }

  // ─────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Header */}
        <div className="text-center space-y-1">
          <div className="flex justify-center">
            <FileSearch size={36} className="text-indigo-500" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Verify Signed Document</h1>
          <p className="text-sm text-gray-500">
            Upload a sealed PDF to verify its cryptographic integrity and audit chain.
            No account required.
          </p>
        </div>

        {/* Upload form */}
        {!result && (
          <form onSubmit={handleVerify} className="bg-white rounded-xl border shadow-sm p-6 space-y-5">

            {/* Drop zone */}
            <div
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              className={`relative cursor-pointer border-2 border-dashed rounded-lg p-8 text-center transition-colors
                ${dragging ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/40'}`}
            >
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={onFileInput}
              />
              <Upload size={24} className="mx-auto mb-2 text-gray-400" />
              {file
                ? <p className="text-sm font-medium text-indigo-700">{file.name}</p>
                : <p className="text-sm text-gray-500">Drop a sealed PDF here, or <span className="text-indigo-600 font-medium">click to browse</span></p>
              }
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 border-t" />
              <span className="text-xs text-gray-400">or verify by envelope ID</span>
              <div className="flex-1 border-t" />
            </div>

            {/* Envelope ID input */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Link size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={envelopeId}
                  onChange={(e) => setEnvelopeId(e.target.value)}
                  placeholder="Envelope ID (e.g. abc123-...)"
                  className="w-full pl-8 pr-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                <AlertCircle size={15} className="shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || (!file && !envelopeId.trim())}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Shield size={16} />}
              {loading ? 'Verifying…' : 'Verify Document'}
            </button>
          </form>
        )}

        {/* Result panel */}
        {result && (
          <div className="space-y-4">
            {/* Overall verdict */}
            <div className={`rounded-xl border-2 p-5 flex items-center gap-4
              ${result.ok ? 'border-emerald-400 bg-emerald-50' : 'border-red-400 bg-red-50'}`}
            >
              {result.ok
                ? <ShieldCheck size={36} className="text-emerald-500 shrink-0" />
                : <ShieldAlert size={36} className="text-red-500 shrink-0" />
              }
              <div className="flex-1">
                <p className={`font-bold text-lg ${result.ok ? 'text-emerald-800' : 'text-red-800'}`}>
                  {result.ok ? 'Document verified — all checks passed' : 'Verification failed — tampering detected'}
                </p>
                {result.title && (
                  <p className="text-sm text-gray-600 mt-0.5">{result.title}</p>
                )}
                {result.envelope_id && (
                  <p className="font-mono text-xs text-gray-500 mt-1">{result.envelope_id}</p>
                )}
              </div>
            </div>

            {/* Check rows */}
            <div className="bg-white rounded-xl border shadow-sm divide-y">

              {/* Hash match */}
              <div className="px-4 py-3 flex items-start gap-3">
                <div className="pt-0.5">
                  {result.hash_match
                    ? <CheckCircle size={16} className="text-emerald-500" />
                    : <XCircle size={16} className="text-red-500" />
                  }
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-800">Document hash</span>
                    <Badge ok={result.hash_match} label={result.hash_match ? 'Match' : 'Mismatch'} />
                  </div>
                  <HashDisplay hash={result.final_doc_hash} label="Expected" />
                  {result.hash_error && (
                    <p className="mt-1 text-xs text-red-600">{result.hash_error}</p>
                  )}
                </div>
              </div>

              {/* Chain integrity */}
              <div className="px-4 py-3 flex items-start gap-3">
                <div className="pt-0.5">
                  {result.chain_ok
                    ? <CheckCircle size={16} className="text-emerald-500" />
                    : <XCircle size={16} className="text-red-500" />
                  }
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-800">Audit chain integrity</span>
                    <Badge ok={result.chain_ok} label={result.chain_ok ? 'Intact' : 'Broken'} />
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{result.total_audit_events} audit event{result.total_audit_events !== 1 ? 's' : ''}</p>
                  {result.chain_error && (
                    <p className="mt-1 text-xs text-red-600">{result.chain_error}</p>
                  )}
                </div>
              </div>

              {/* Sealed at */}
              {result.sealed_at && result.sealed_at !== '0001-01-01T00:00:00Z' && (
                <div className="px-4 py-3 text-xs text-gray-500">
                  Sealed {new Date(result.sealed_at).toLocaleString()}
                </div>
              )}
            </div>

            {/* Per-signer results */}
            {result.signers && result.signers.length > 0 && (
              <div className="space-y-2">
                <h2 className="text-sm font-semibold text-gray-700 px-1">
                  Signers ({result.signers.length})
                </h2>
                {result.signers.map((s) => (
                  <SignerRow key={s.signer_id} signer={s} />
                ))}
              </div>
            )}

            {/* Verify another */}
            <button
              type="button"
              onClick={reset}
              className="w-full py-2 rounded-lg border border-gray-200 hover:border-indigo-300 text-sm text-gray-600 hover:text-indigo-700 transition-colors"
            >
              Verify another document
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
