/**
 * src/shells/RequireAuth.jsx — auth boundary shared by all subdomain shells.
 *
 * Calls GET /api/auth/me on mount. On 401, redirects to:
 *   https://app.vulos.org/login?next=<current-url>
 *
 * The shared vc_session cookie (Domain=vulos.org) is automatically sent by
 * the browser, so a user already logged in at app.vulos.org will pass this
 * check transparently.
 */

import { useEffect, useState } from 'react'
import { LoadingState } from '../components/ui'

export default function RequireAuth({ children, apiBase = '' }) {
  const [state, setState] = useState('loading')

  useEffect(() => {
    const base = apiBase ? apiBase.replace(/\/$/, '') : ''
    fetch(`${base}/api/auth/me`, { credentials: 'include' })
      .then(r => {
        if (r.status === 401) {
          const next = encodeURIComponent(window.location.href)
          window.location.href = `https://app.vulos.org/login?next=${next}`
        } else {
          setState('authed')
        }
      })
      .catch(() => setState('authed')) // offline / dev: allow through
  }, [apiBase])

  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <LoadingState label="Checking your session…" />
      </div>
    )
  }

  return children
}
