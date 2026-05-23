/**
 * PresenceBar.jsx — Presence roster component (OFFICE-24).
 *
 * Renders an avatar strip showing all live collaborators in a session.
 * Reusable by DocsEditor, SheetsEditor, SlidesEditor, and Forum.
 *
 * Props:
 *   roster  — array from usePresence().roster
 *             each entry: { accountId, displayName, color, online, isSelf?, isGuest? }
 *   max     — max avatars to show before "+N" overflow (default 5)
 *
 * Usage (in any editor top bar):
 *   import { usePresence } from '../../lib/presence.js'
 *   import PresenceBar from '../../components/PresenceBar.jsx'
 *
 *   const { roster } = usePresence({ fabric })   // fabric may be null → empty roster
 *   <PresenceBar roster={roster} />
 *
 * JSX only — no .tsx.
 */

import { useState, useRef } from 'react'
import { STATUS_ONLINE, STATUS_AWAY, STATUS_DND, STATUS_IN_CALL } from '../lib/presence.js'

// ─── PresenceDot (OFFICE-62) ────────────────────────────────────────────────
/**
 * PresenceDot — small status badge rendered next to a user avatar or name.
 *
 * Props:
 *   status   — 'online' | 'away' | 'dnd' | 'in-a-call' (from presence.js constants)
 *   size     — diameter in px (default 9)
 *   className — extra classes
 */
export function PresenceDot({ status = STATUS_ONLINE, size = 9, className = '' }) {
  const colors = {
    [STATUS_ONLINE]:  'bg-green-400',
    [STATUS_AWAY]:    'bg-yellow-400',
    [STATUS_DND]:     'bg-red-500',
    [STATUS_IN_CALL]: 'bg-indigo-400',
  }
  const titles = {
    [STATUS_ONLINE]:  'Online',
    [STATUS_AWAY]:    'Away',
    [STATUS_DND]:     'Do not disturb',
    [STATUS_IN_CALL]: 'In a call',
  }
  const color = colors[status] || colors[STATUS_ONLINE]
  const title = titles[status] || 'Online'
  return (
    <span
      className={`inline-block rounded-full border border-white dark:border-gray-800 flex-shrink-0 ${color} ${className}`}
      style={{ width: size, height: size }}
      title={title}
      aria-label={title}
    />
  )
}

// ─── StatusPicker (OFFICE-62) ────────────────────────────────────────────────
/**
 * StatusPicker — dropdown menu to change your own presence status + custom text.
 *
 * Props:
 *   currentStatus   — current status string
 *   currentText     — current custom status text
 *   onStatusChange  — (status, text) => void
 *   onClose         — () => void
 */
export function StatusPicker({ currentStatus, currentText = '', onStatusChange, onClose }) {
  const [text, setText] = useState(currentText)
  const options = [
    { value: STATUS_ONLINE,  label: 'Online',         color: 'bg-green-400' },
    { value: STATUS_AWAY,    label: 'Away',            color: 'bg-yellow-400' },
    { value: STATUS_DND,     label: 'Do not disturb', color: 'bg-red-500' },
    { value: STATUS_IN_CALL, label: 'In a call',      color: 'bg-indigo-400' },
  ]
  return (
    <div
      className="absolute bottom-full mb-1 left-0 z-50 bg-white border border-gray-200 rounded-xl shadow-lg py-2 w-56"
      onMouseLeave={onClose}
    >
      <p className="px-3 pb-1 text-xs font-semibold text-gray-400 uppercase tracking-wide">Set status</p>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => { onStatusChange(o.value, text); onClose() }}
          className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 transition ${
            currentStatus === o.value ? 'font-semibold' : ''
          }`}
        >
          <span className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${o.color}`} />
          {o.label}
          {currentStatus === o.value && <span className="ml-auto text-indigo-500 text-xs">✓</span>}
        </button>
      ))}
      <div className="mx-3 mt-2 border-t border-gray-100 pt-2">
        <input
          type="text"
          placeholder="Custom status…"
          value={text}
          maxLength={60}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { onStatusChange(currentStatus, text); onClose() }
            if (e.key === 'Escape') onClose()
          }}
          className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
      </div>
    </div>
  )
}

/** Returns initials (up to 2 chars) from a display name. */
function initials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

function Avatar({ peer, size = 32 }) {
  const [showTooltip, setShowTooltip] = useState(false)
  const label = peer.isSelf ? `${peer.displayName} (you)` : peer.displayName

  return (
    <div
      className="relative flex-shrink-0"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div
        className="flex items-center justify-center rounded-full text-white font-semibold select-none border-2 border-white dark:border-gray-800 cursor-default"
        style={{
          width: size,
          height: size,
          fontSize: size * 0.38,
          backgroundColor: peer.color,
          opacity: peer.isSelf ? 0.75 : 1,
          boxShadow: peer.isSelf ? 'none' : '0 0 0 1.5px rgba(0,0,0,0.12)',
        }}
        aria-label={label}
      >
        {initials(peer.displayName)}
      </div>

      {/* Status dot — uses PresenceDot for OFFICE-62 status-aware color */}
      {peer.online && !peer.isSelf && (
        <span className="absolute bottom-0 right-0 block">
          <PresenceDot status={peer.status} size={8} />
        </span>
      )}

      {/* Tooltip */}
      {showTooltip && (
        <div
          className="absolute z-50 bottom-full mb-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded px-2 py-1 text-xs text-white bg-gray-800 shadow pointer-events-none"
          role="tooltip"
        >
          {label}
          {peer.isGuest && <span className="ml-1 opacity-60">(guest)</span>}
          {peer.status && peer.status !== STATUS_ONLINE && (
            <span className="ml-1 opacity-75 capitalize">· {peer.status}</span>
          )}
          {peer.statusText && <span className="ml-1 opacity-75">"{peer.statusText}"</span>}
        </div>
      )}
    </div>
  )
}

/**
 * PresenceBar — avatar strip for a session's presence roster.
 *
 * @param {{ roster: Array, max?: number, className?: string }} props
 */
export default function PresenceBar({ roster = [], max = 5, className = '' }) {
  if (!roster || roster.length === 0) return null

  const visible = roster.slice(0, max)
  const overflow = roster.length - max

  return (
    <div
      className={`flex items-center gap-[-6px] ${className}`}
      aria-label={`${roster.length} collaborator${roster.length !== 1 ? 's' : ''} online`}
    >
      {/* Overlapping avatars */}
      <div className="flex items-center" style={{ gap: -8 }}>
        {visible.map((peer, idx) => (
          <div
            key={peer.accountId}
            style={{ marginLeft: idx === 0 ? 0 : -8, zIndex: visible.length - idx }}
            className="relative"
          >
            <Avatar peer={peer} size={28} />
          </div>
        ))}
      </div>

      {/* Overflow badge */}
      {overflow > 0 && (
        <div
          className="flex items-center justify-center rounded-full bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 font-medium border-2 border-white dark:border-gray-800 select-none"
          style={{ width: 28, height: 28, fontSize: 11, marginLeft: -8 }}
          title={`${overflow} more`}
        >
          +{overflow}
        </div>
      )}
    </div>
  )
}
