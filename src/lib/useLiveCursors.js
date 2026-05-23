/**
 * useLiveCursors.js — OFFICE-25: Live cursors + selections.
 *
 * Broadcasts throttled cursor/selection positions over the presence fabric
 * channel and collects remote peers' positions.
 *
 * Channel: "cursors" (separate from the "presence" channel used by OFFICE-24)
 *
 * Message shape (JSON):
 *   { channel: 'cursors', payload: { accountId, from, to, slideId? } }
 *   - docs:   from/to are TipTap document positions (integers)
 *   - sheets: from/to encode "row,col" as a string e.g. "2,3"
 *   - slides: from/to are both the slide id string; slideId echoes the same
 *
 * Usage:
 *   const { remoteCursors, broadcastDocCursor, broadcastSheetCursor, broadcastSlideCursor }
 *     = useLiveCursors({ fabric, localIdentity, color })
 *
 * remoteCursors: Map<accountId, { accountId, displayName, color, from, to, slideId? }>
 *
 * JSX only — no .tsx.
 */

import { useEffect, useRef, useState, useCallback } from 'react'

const CURSOR_CHANNEL = 'cursors'
const THROTTLE_MS = 80   // max one broadcast per 80 ms

export function useLiveCursors({ fabric, localIdentity, color }) {
  /** @type {[Map<string, object>, Function]} */
  const [remoteCursors, setRemoteCursors] = useState(new Map())
  const lastSentRef = useRef(0)
  const pendingRef  = useRef(null)

  // Listen for remote cursor frames on the fabric.
  useEffect(() => {
    if (!fabric) {
      setRemoteCursors(new Map())
      return
    }

    const onMessage = ({ detail: { data } }) => {
      let text
      try { text = typeof data === 'string' ? data : new TextDecoder().decode(data) } catch { return }
      let frame
      try { frame = JSON.parse(text) } catch { return }
      if (frame.channel !== CURSOR_CHANNEL) return
      const p = frame.payload
      if (!p || !p.accountId) return
      // Ignore own echoes (shouldn't happen but defensive).
      if (localIdentity && p.accountId === localIdentity.accountId) return

      setRemoteCursors((prev) => {
        const next = new Map(prev)
        next.set(p.accountId, p)
        return next
      })
    }

    fabric.addEventListener('message', onMessage)
    return () => fabric.removeEventListener('message', onMessage)
  }, [fabric]) // eslint-disable-line react-hooks/exhaustive-deps

  // Internal: send a cursor frame immediately or schedule one.
  const _sendCursor = useCallback((payload) => {
    if (!fabric || !localIdentity) return
    const now = Date.now()
    const send = () => {
      lastSentRef.current = Date.now()
      pendingRef.current = null
      const frame = JSON.stringify({ channel: CURSOR_CHANNEL, payload })
      fabric.send(frame)
    }
    const elapsed = now - lastSentRef.current
    if (elapsed >= THROTTLE_MS) {
      send()
    } else {
      clearTimeout(pendingRef.current)
      pendingRef.current = setTimeout(send, THROTTLE_MS - elapsed)
    }
  }, [fabric, localIdentity])

  /** Broadcast a Docs (TipTap) caret / selection.
   * @param {number} from  - TipTap doc position (anchor)
   * @param {number} to    - TipTap doc position (head; equals from for bare caret)
   */
  const broadcastDocCursor = useCallback((from, to) => {
    if (!localIdentity) return
    _sendCursor({
      accountId: localIdentity.accountId,
      displayName: localIdentity.displayName,
      color,
      from,
      to,
      type: 'doc',
    })
  }, [_sendCursor, localIdentity, color])

  /** Broadcast a Sheets cell selection.
   * @param {number} row
   * @param {number} col
   */
  const broadcastSheetCursor = useCallback((row, col) => {
    if (!localIdentity) return
    _sendCursor({
      accountId: localIdentity.accountId,
      displayName: localIdentity.displayName,
      color,
      from: `${row},${col}`,
      to: `${row},${col}`,
      type: 'sheet',
    })
  }, [_sendCursor, localIdentity, color])

  /** Broadcast the active slide id in SlidesEditor.
   * @param {string} slideId
   */
  const broadcastSlideCursor = useCallback((slideId) => {
    if (!localIdentity) return
    _sendCursor({
      accountId: localIdentity.accountId,
      displayName: localIdentity.displayName,
      color,
      from: slideId,
      to: slideId,
      type: 'slide',
      slideId,
    })
  }, [_sendCursor, localIdentity, color])

  return { remoteCursors, broadcastDocCursor, broadcastSheetCursor, broadcastSlideCursor }
}
