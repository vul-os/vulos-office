import { useEffect, useState, useCallback } from 'react'
import {
  FileSignature, Clock, CheckCircle2, XCircle, AlertCircle,
  RefreshCw, Bell, Trash2, ChevronDown, ChevronUp, Users,
} from 'lucide-react'
import { api } from '../lib/api.js'

// OFFICE-45: Envelope Dashboard — per-envelope progress panel.
// Lists all signing envelopes with signer-level status, sequential/parallel
// mode badge, and action buttons: remind, cancel.

const STATUS_META = {
  draft:     { label: 'Draft',     color: 'bg-gray-100 text-gray-600',   icon: Clock },
  sent:      { label: 'Sent',      color: 'bg-blue-100 text-blue-700',   icon: Clock },
  completed: { label: 'Complete',  color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  declined:  { label: 'Declined',  color: 'bg-red-100 text-red-700',     icon: XCircle },
  voided:    { label: 'Voided',    color: 'bg-orange-100 text-orange-700', icon: AlertCircle },
}

const SIGNER_STATUS_META = {
  pending:  { label: 'Pending',  dot: 'bg-gray-400' },
  sent:     { label: 'Sent',     dot: 'bg-blue-500' },
  viewed:   { label: 'Viewed',   dot: 'bg-yellow-500' },
  signed:   { label: 'Signed',   dot: 'bg-green-500' },
  declined: { label: 'Declined', dot: 'bg-red-500' },
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.draft
  const Icon = meta.icon
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${meta.color}`}>
      <Icon size={11} />
      {meta.label}
    </span>
  )
}

function SignerRow({ signer }) {
  const meta = SIGNER_STATUS_META[signer.status] || SIGNER_STATUS_META.pending
  return (
    <div className="flex items-center gap-2 py-1">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${meta.dot}`} />
      <span className="text-sm text-gray-700 flex-1 truncate">
        {signer.name || signer.email}
        {signer.email && signer.name && (
          <span className="ml-1 text-xs text-gray-400">&lt;{signer.email}&gt;</span>
        )}
      </span>
      <span className="text-xs text-gray-400 w-16 text-right">#{signer.order}</span>
      <span className="text-xs font-medium text-gray-500 w-16 text-right">{meta.label}</span>
    </div>
  )
}

function EnvelopeRow({ envelope, onRemind, onCancel, onRefresh }) {
  const [expanded, setExpanded] = useState(false)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const loadStatus = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.envelopeStatus(envelope.id)
      setStatus(data)
    } catch (e) {
      setError(e.message || 'Failed to load status')
    } finally {
      setLoading(false)
    }
  }, [envelope.id])

  useEffect(() => {
    if (expanded && !status) loadStatus()
  }, [expanded, status, loadStatus])

  const active = envelope.status !== 'completed' && envelope.status !== 'voided' && envelope.status !== 'declined'

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white hover:bg-gray-50 cursor-pointer"
           onClick={() => setExpanded(e => !e)}>
        <FileSignature size={16} className="text-indigo-500 flex-shrink-0" />
        <span className="font-medium text-gray-800 flex-1 truncate text-sm">{envelope.title}</span>

        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          envelope.order_mode === 'sequential'
            ? 'bg-indigo-100 text-indigo-700'
            : 'bg-teal-100 text-teal-700'
        }`}>
          {envelope.order_mode === 'sequential' ? 'Sequential' : 'Parallel'}
        </span>

        <StatusBadge status={envelope.status} />

        <div className="flex items-center gap-1 ml-1">
          {active && (
            <>
              <button
                onClick={e => { e.stopPropagation(); onRemind(envelope.id) }}
                title="Send reminders"
                className="p-1 rounded hover:bg-yellow-50 text-yellow-600 hover:text-yellow-700"
              >
                <Bell size={14} />
              </button>
              <button
                onClick={e => { e.stopPropagation(); onCancel(envelope.id) }}
                title="Cancel / void envelope"
                className="p-1 rounded hover:bg-red-50 text-red-500 hover:text-red-700"
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
          <button
            onClick={e => { e.stopPropagation(); loadStatus(); onRefresh() }}
            title="Refresh"
            className="p-1 rounded hover:bg-gray-100 text-gray-400"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
          {expanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
        </div>
      </div>

      {/* Expanded signer list */}
      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3 bg-gray-50">
          {loading && <p className="text-xs text-gray-400 py-1">Loading…</p>}
          {error && <p className="text-xs text-red-500 py-1">{error}</p>}
          {status && (
            <div>
              <div className="flex items-center gap-1 mb-2 text-xs text-gray-500">
                <Users size={12} />
                <span>{status.signers.length} signer{status.signers.length !== 1 ? 's' : ''}</span>
              </div>
              {status.signers.map(sg => (
                <SignerRow key={sg.id} signer={sg} />
              ))}
            </div>
          )}
          {!loading && !status && !error && (
            <p className="text-xs text-gray-400">No signer data — click refresh.</p>
          )}
        </div>
      )}
    </div>
  )
}

export default function EnvelopeDashboard() {
  const [envelopes, setEnvelopes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)

  const showToast = useCallback((msg, type = 'info') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }, [])

  const loadEnvelopes = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.listEnvelopes()
      setEnvelopes(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e.message || 'Failed to load envelopes')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadEnvelopes() }, [loadEnvelopes])

  const handleRemind = useCallback(async (envelopeId) => {
    try {
      const res = await api.envelopeRemind(envelopeId)
      const reminded = res.reminded || []
      showToast(`Reminders sent to ${reminded.length} signer(s).`, 'success')
    } catch (e) {
      showToast(e.message || 'Failed to send reminders', 'error')
    }
  }, [showToast])

  const handleCancel = useCallback(async (envelopeId) => {
    if (!window.confirm('Cancel (void) this envelope? This cannot be undone.')) return
    try {
      await api.envelopeCancel(envelopeId)
      showToast('Envelope voided.', 'success')
      loadEnvelopes()
    } catch (e) {
      showToast(e.message || 'Failed to cancel envelope', 'error')
    }
  }, [showToast, loadEnvelopes])

  return (
    <div className="max-w-2xl mx-auto py-6 px-4">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-md text-sm font-medium ${
          toast.type === 'success' ? 'bg-green-600 text-white'
          : toast.type === 'error' ? 'bg-red-600 text-white'
          : 'bg-gray-800 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
          <FileSignature size={18} className="text-indigo-500" />
          Signing Envelopes
        </h2>
        <button
          onClick={loadEnvelopes}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {!loading && !error && envelopes.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <FileSignature size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No signing envelopes yet.</p>
        </div>
      )}

      {!loading && !error && envelopes.length > 0 && (
        <div className="space-y-2">
          {envelopes.map(env => (
            <EnvelopeRow
              key={env.id}
              envelope={env}
              onRemind={handleRemind}
              onCancel={handleCancel}
              onRefresh={loadEnvelopes}
            />
          ))}
        </div>
      )}
    </div>
  )
}
