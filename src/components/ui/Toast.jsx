/**
 * Toast — tiny app-wide transient notifier.
 * ----------------------------------------------------------------------------
 * Replaces native `alert()` (which blocks the thread and can't be themed) with
 * a non-blocking, tokenised, screen-reader-announced toast. Lifted from the PDF
 * editor's ad-hoc `showToast` into a shared hook so every surface uses one.
 *
 *   const { showToast, toast } = useToast()
 *   showToast('Could not open file')        // neutral
 *   showToast('Saved', 'success')           // tone: success | error | info
 *   …
 *   {toast}   // render once near the root of the surface
 */

import { useCallback, useRef, useState } from 'react'

const toneCn = {
  info:    'border-line text-ink',
  success: 'border-accent-tint-2 text-ink',
  error:   'border-danger text-ink',
}

export function useToast() {
  const [msg, setMsg] = useState(null)
  const [tone, setTone] = useState('info')
  const timer = useRef(null)

  const showToast = useCallback((text, t = 'info') => {
    setMsg(text)
    setTone(t)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setMsg(null), 3000)
  }, [])

  const toast = (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-5 left-1/2 -translate-x-1/2 z-[100] flex justify-center px-4"
    >
      {msg && (
        <div
          className={[
            'pointer-events-auto max-w-sm px-3.5 py-2 rounded-lg text-sm font-medium',
            'bg-bg-elev2 border shadow-e3 animate-scale-in',
            toneCn[tone] || toneCn.info,
          ].join(' ')}
        >
          {msg}
        </div>
      )}
    </div>
  )

  return { showToast, toast, hasToast: !!msg }
}

export default useToast
