/**
 * RecordingControl — real recording control for Vulos Meet (P2P mesh).
 *
 * Records the local participant's stream (cam + mic) using MediaRecorder,
 * uploads the resulting WebM blob to the backend after stopping, and shows
 * a list of past recordings for the organizer to download.
 *
 * Props:
 *   call        {object}   — call object from createCall (has .localStream)
 *   roomId      {string}   — the meeting room ID (for the upload endpoint)
 *   isOrganizer {boolean}  — only organisers can start recording
 *   onRecording {function} — callback(bool) invoked when recording state changes
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { Circle } from 'lucide-react'
import { Tooltip } from '../../../components/ui'

// ── Consent banner ────────────────────────────────────────────────────────────

function ConsentBanner({ onAccept, onCancel }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Recording consent"
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,.55)' }}
    >
      <div
        className="relative w-full max-w-sm mx-4 rounded-lg border border-paper/15 p-5 space-y-4"
        style={{ background: 'var(--ink)', color: 'var(--paper)' }}
      >
        <h2 className="text-md font-semibold tracking-tightish">Start recording?</h2>
        <p className="text-sm text-paper/75 leading-relaxed">
          This call will be recorded. All participants will be notified before
          recording begins. The recording is stored and can be downloaded by the
          meeting organiser. Continue?
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="h-8 px-4 rounded-md text-sm text-paper/70 hover:text-paper hover:bg-paper/10 transition-colors duration-fast tracking-tightish"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="h-8 px-4 rounded-md text-sm font-medium bg-danger text-white hover:opacity-90 transition-opacity duration-fast tracking-tightish"
          >
            Start recording
          </button>
        </div>
      </div>
    </div>
  )
}

// ── RecordingControl (default export, used in Controls dock) ──────────────────

export default function RecordingControl({ call, roomId, isOrganizer, onRecording }) {
  const [recording, setRecording] = useState(false)
  const [consentShown, setConsentShown] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const mrRef = useRef(null)
  const chunksRef = useRef([])

  // Announce recording state upstream.
  useEffect(() => {
    onRecording?.(recording)
  }, [recording, onRecording])

  const startRecording = useCallback(() => {
    if (!call?.localStream) {
      setUploadError('No local stream available to record.')
      return
    }

    chunksRef.current = []
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
      ? 'video/webm;codecs=vp8,opus'
      : 'video/webm'

    let mr
    try {
      mr = new MediaRecorder(call.localStream, { mimeType })
    } catch (e) {
      setUploadError('MediaRecorder not supported: ' + e.message)
      return
    }

    mr.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
    }

    mr.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' })
      chunksRef.current = []
      setUploading(true)
      setUploadError(null)
      try {
        const fd = new FormData()
        fd.append('recording', blob, `recording-${roomId}.webm`)
        const res = await fetch(`/api/meet/${roomId}/recordings`, {
          method: 'POST',
          body: fd,
          credentials: 'include',
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || `HTTP ${res.status}`)
        }
      } catch (err) {
        setUploadError('Upload failed: ' + err.message)
      } finally {
        setUploading(false)
      }
    }

    mr.start(1000) // 1-second timeslices
    mrRef.current = mr
    setRecording(true)
    setUploadError(null)
  }, [call, roomId])

  const stopRecording = useCallback(() => {
    if (mrRef.current && mrRef.current.state !== 'inactive') {
      mrRef.current.stop()
    }
    mrRef.current = null
    setRecording(false)
  }, [])

  const handleClick = () => {
    if (!isOrganizer) return
    if (recording) {
      stopRecording()
    } else {
      setConsentShown(true)
    }
  }

  // Non-organizer: show disabled tooltip.
  if (!isOrganizer) {
    return (
      <Tooltip label="Only the meeting organiser can start recording." side="top">
        <button
          type="button"
          disabled
          aria-label="Recording (organiser only)"
          className={[
            'inline-flex items-center gap-1.5 h-10 px-3 rounded-md text-sm',
            'bg-paper/5 text-paper/35 cursor-not-allowed',
            'border border-paper/10',
            'transition-colors duration-fast',
          ].join(' ')}
        >
          <Circle size={12} className="text-danger/40" fill="currentColor" />
          <span className="tracking-tightish text-xs">Rec</span>
        </button>
      </Tooltip>
    )
  }

  return (
    <>
      {consentShown && (
        <ConsentBanner
          onAccept={() => { setConsentShown(false); startRecording() }}
          onCancel={() => setConsentShown(false)}
        />
      )}

      <Tooltip
        label={
          uploading
            ? 'Uploading recording…'
            : uploadError || (recording ? 'Stop recording' : 'Start recording (your local stream)')
        }
        side="top"
      >
        <button
          type="button"
          onClick={handleClick}
          disabled={uploading}
          aria-label={recording ? 'Stop recording' : 'Start recording'}
          aria-pressed={recording ? 'true' : 'false'}
          className={[
            'inline-flex items-center gap-1.5 h-10 px-3 rounded-md text-sm',
            'border transition-colors duration-fast',
            'focus-visible:outline-none focus-visible:shadow-focus',
            recording
              ? 'bg-danger/15 border-danger/40 text-danger'
              : uploadError
                ? 'bg-warning/10 border-warning/30 text-warning'
                : 'bg-paper/5 border-paper/10 text-paper/70 hover:text-paper hover:bg-paper/10',
            uploading ? 'opacity-60 cursor-wait' : '',
          ].join(' ')}
        >
          <Circle
            size={12}
            fill="currentColor"
            className={[
              recording ? 'animate-pulse text-danger' : 'text-danger/50',
            ].join(' ')}
          />
          <span className="tracking-tightish text-xs">
            {uploading ? 'Uploading…' : recording ? 'Stop' : 'Rec'}
          </span>
          {uploadError && (
            <span className="text-[9px] uppercase tracking-eyebrow text-warning">!</span>
          )}
        </button>
      </Tooltip>
    </>
  )
}

// ── RecordingsList — organiser view of past recordings ────────────────────────

export function RecordingsList({ roomId, isOrganizer }) {
  const [recordings, setRecordings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!roomId) return
    setLoading(true)
    fetch(`/api/meet/${roomId}/recordings`, { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        setRecordings(Array.isArray(data) ? data : [])
        setLoading(false)
      })
      .catch((e) => {
        setError(e.message)
        setLoading(false)
      })
  }, [roomId])

  if (!isOrganizer) return null
  if (loading) {
    return (
      <p className="text-2xs text-paper/40 italic tracking-tightish">Loading recordings…</p>
    )
  }
  if (error) {
    return <p className="text-2xs text-warning tracking-tightish">Recordings error: {error}</p>
  }
  if (recordings.length === 0) {
    return (
      <p className="text-2xs text-paper/40 italic tracking-tightish">No recordings yet.</p>
    )
  }

  return (
    <ul className="space-y-1">
      {recordings.map((r) => (
        <li key={r.id} className="flex items-center gap-2">
          <a
            href={`/api/meet/${roomId}/recordings/${r.id}`}
            download={r.file_name}
            className="text-2xs text-accent underline tracking-tightish hover:opacity-80"
          >
            {r.file_name || `Recording ${r.id.slice(0, 6)}`}
          </a>
          <span className="text-[9px] text-paper/40 tracking-tightish">
            {new Date(r.created_at).toLocaleString()}
          </span>
          {r.size_bytes > 0 && (
            <span className="text-[9px] text-paper/30 tracking-tightish">
              {(r.size_bytes / (1024 * 1024)).toFixed(1)} MB
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}
