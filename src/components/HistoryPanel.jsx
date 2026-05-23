import { useState, useEffect, useCallback } from 'react'
import { History, RotateCcw, ChevronRight, Loader2, X, AlertCircle } from 'lucide-react'
import { api } from '../lib/api'

function formatRelative(dateStr) {
  const d = new Date(dateStr)
  const now = new Date()
  const diffMs = now - d
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 30) return `${diffDay}d ago`
  return d.toLocaleDateString()
}

/**
 * HistoryPanel — shows the version history for a document and lets the user
 * restore a prior version.
 *
 * Props:
 *   fileId   string   — the document ID
 *   onRestore fn      — called with the restored File object after a successful restore
 *   onClose  fn       — called when the panel is closed
 */
export default function HistoryPanel({ fileId, onRestore, onClose }) {
  const [versions, setVersions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [restoring, setRestoring] = useState(null)  // version ID being restored
  const [toast, setToast] = useState(null)

  const showToast = (msg, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  const load = useCallback(async () => {
    if (!fileId) return
    setLoading(true)
    setError(null)
    try {
      const data = await api.listVersions(fileId)
      setVersions(data)
    } catch (e) {
      setError(e.message || 'Failed to load history')
    } finally {
      setLoading(false)
    }
  }, [fileId])

  useEffect(() => { load() }, [load])

  const handleRestore = async (vid) => {
    setRestoring(vid)
    try {
      const updated = await api.restoreVersion(fileId, vid)
      showToast('Version restored')
      onRestore?.(updated)
      // Reload list so the new auto-snapshot shows up.
      await load()
    } catch (e) {
      showToast(e.message || 'Restore failed', false)
    } finally {
      setRestoring(null)
    }
  }

  return (
    <div className="w-72 flex flex-col border-l border-gray-200 bg-white h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center gap-2">
          <History size={14} className="text-gray-500" />
          <span className="text-sm font-semibold text-gray-700">Version History</span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition"
            title="Close"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={20} className="animate-spin text-indigo-400" />
          </div>
        )}

        {error && !loading && (
          <div className="flex flex-col items-center gap-2 py-10 px-4 text-center">
            <AlertCircle size={20} className="text-red-400" />
            <p className="text-xs text-red-500">{error}</p>
            <button
              onClick={load}
              className="text-xs text-indigo-600 underline hover:text-indigo-800"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && versions.length === 0 && (
          <div className="py-10 px-4 text-center">
            <p className="text-xs text-gray-400">No saved versions yet.</p>
            <p className="text-xs text-gray-400 mt-1">Versions are created automatically on each save.</p>
          </div>
        )}

        {!loading && !error && versions.length > 0 && (
          <ul className="divide-y divide-gray-50">
            {versions.map((v, idx) => (
              <li key={v.id} className="px-4 py-3 hover:bg-gray-50 group transition">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-gray-800 truncate" title={v.name}>
                      {v.name || 'Untitled'}
                    </p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {formatRelative(v.created_at)}
                      {idx === 0 && (
                        <span className="ml-2 bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded text-[10px] font-semibold">
                          latest
                        </span>
                      )}
                    </p>
                  </div>
                  <button
                    onClick={() => handleRestore(v.id)}
                    disabled={restoring === v.id}
                    title="Restore this version"
                    className="flex-shrink-0 flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded transition opacity-0 group-hover:opacity-100 disabled:opacity-50"
                  >
                    {restoring === v.id
                      ? <Loader2 size={11} className="animate-spin" />
                      : <RotateCcw size={11} />
                    }
                    Restore
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className={`mx-3 mb-3 flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-white ${toast.ok ? 'bg-gray-800' : 'bg-red-600'}`}>
          {toast.ok ? <ChevronRight size={12} /> : <AlertCircle size={12} />}
          {toast.msg}
        </div>
      )}
    </div>
  )
}
