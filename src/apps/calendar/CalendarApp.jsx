/**
 * CalendarApp — Month + agenda view with CalDAV CRUD.
 *
 * Feature flag: VITE_FF_CALENDAR=1 (defaults to enabled in this build).
 * Marked (beta) in the sidebar.
 *
 * CalDAV endpoint: configured via VITE_CALDAV_BASE (defaults to /dav/calendars).
 * Auth: Basic auth using the same email+app-password as JMAP.
 * Constraints: JSX never .tsx. No Google SSO. Pure Vulos identity.
 */

import { useState, useEffect, useCallback } from 'react'
import { ChevronLeft, ChevronRight, Plus, X, Edit2, Trash2, Calendar } from 'lucide-react'
import { useAuthStore } from '../../store/authStore'

const CALDAV_BASE = import.meta.env.VITE_CALDAV_BASE || '/dav/calendars'
const COLLECTION = 'personal'

// ──────────────────────────────────────────────────────────────────────────────
// CalDAV API helpers
// ──────────────────────────────────────────────────────────────────────────────

function davHeaders(credentials) {
  const basic = btoa(`${credentials.email}:${credentials.appPassword}`)
  return {
    'Authorization': `Basic ${basic}`,
    'Content-Type': 'text/calendar; charset=utf-8',
  }
}

function formatICSDate(date) {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
}

function buildICS(event) {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Vulos Office//CalDAV//EN',
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTART:${formatICSDate(new Date(event.start))}`,
    `DTEND:${formatICSDate(new Date(event.end))}`,
    `SUMMARY:${event.title}`,
    event.description ? `DESCRIPTION:${event.description}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n') + '\r\n'
}

function parseICSEvents(icsText) {
  const events = []
  const vevents = icsText.split('BEGIN:VEVENT').slice(1)
  for (const block of vevents) {
    const uid = (block.match(/UID:(.+)/) || [])[1]?.trim()
    const summary = (block.match(/SUMMARY:(.+)/) || [])[1]?.trim()
    const dtstart = (block.match(/DTSTART[^:]*:(.+)/) || [])[1]?.trim()
    const dtend = (block.match(/DTEND[^:]*:(.+)/) || [])[1]?.trim()

    if (!uid || !dtstart) continue

    const parseICSTime = (s) => {
      if (!s) return null
      const clean = s.replace('Z', '').replace(/T/, 'T')
      // Format: 20260601T100000Z
      const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/)
      if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`)
      return new Date(clean)
    }

    events.push({
      uid,
      title: summary || '(no title)',
      start: parseICSTime(dtstart),
      end: parseICSTime(dtend) || parseICSTime(dtstart),
      raw: block,
    })
  }
  return events
}

async function fetchEvents(accountID, credentials) {
  const collURL = `${CALDAV_BASE}/${accountID}/${COLLECTION}/`
  const headers = davHeaders(credentials)

  // PROPFIND to list events.
  const propfind = await fetch(collURL, {
    method: 'PROPFIND',
    headers: { ...headers, 'Depth': '1' },
    body: `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop><D:getetag/><D:getcontenttype/></D:prop>
</D:propfind>`,
  })

  if (!propfind.ok && propfind.status !== 207) {
    throw new Error(`CalDAV PROPFIND failed: ${propfind.status}`)
  }

  const xmlText = await propfind.text()
  // Extract hrefs of .ics resources.
  const hrefMatches = [...xmlText.matchAll(/<[^>]*:href[^>]*>([^<]+\.ics)<\/[^>]*:href>/g)]
  const hrefs = hrefMatches.map(m => m[1])

  const events = []
  await Promise.all(hrefs.map(async (href) => {
    const r = await fetch(href, { headers })
    if (r.ok) {
      const ics = await r.text()
      events.push(...parseICSEvents(ics))
    }
  }))
  return events
}

async function putEvent(accountID, credentials, event) {
  const url = `${CALDAV_BASE}/${accountID}/${COLLECTION}/${event.uid}.ics`
  const ics = buildICS(event)
  const r = await fetch(url, {
    method: 'PUT',
    headers: davHeaders(credentials),
    body: ics,
  })
  if (!r.ok && r.status !== 201 && r.status !== 204) {
    throw new Error(`CalDAV PUT failed: ${r.status}`)
  }
}

async function deleteEvent(accountID, credentials, uid) {
  const url = `${CALDAV_BASE}/${accountID}/${COLLECTION}/${uid}.ics`
  const r = await fetch(url, {
    method: 'DELETE',
    headers: davHeaders(credentials),
  })
  if (!r.ok && r.status !== 204) {
    throw new Error(`CalDAV DELETE failed: ${r.status}`)
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Month grid helpers
// ──────────────────────────────────────────────────────────────────────────────

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfMonth(year, month) {
  return new Date(year, month, 1).getDay() // 0=Sun
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
]
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

// ──────────────────────────────────────────────────────────────────────────────
// EventModal — create / edit
// ──────────────────────────────────────────────────────────────────────────────

function EventModal({ event, onSave, onClose }) {
  const [title, setTitle] = useState(event?.title || '')
  const [start, setStart] = useState(
    event?.start
      ? new Date(event.start).toISOString().slice(0, 16)
      : new Date().toISOString().slice(0, 16)
  )
  const [end, setEnd] = useState(
    event?.end
      ? new Date(event.end).toISOString().slice(0, 16)
      : new Date(Date.now() + 3600000).toISOString().slice(0, 16)
  )
  const [description, setDescription] = useState(event?.description || '')

  const handleSave = (e) => {
    e.preventDefault()
    if (!title.trim()) return
    onSave({
      uid: event?.uid || crypto.randomUUID(),
      title: title.trim(),
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      description: description.trim(),
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <form
        onSubmit={handleSave}
        className="relative bg-bg border border-line rounded-xl shadow-lg p-6 w-full max-w-md"
        onClick={e => e.stopPropagation()}
        style={{ fontFamily: 'var(--font-sans)' }}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-ink-faint hover:text-ink"
          aria-label="Close"
        >
          <X size={16} />
        </button>
        <h2 className="text-base font-semibold text-ink mb-4">
          {event ? 'Edit event' : 'New event'}
        </h2>
        <div className="space-y-3">
          <input
            type="text"
            placeholder="Event title"
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="w-full px-3 py-2 rounded-md border border-line bg-bg text-ink text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
            autoFocus
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-ink-faint mb-1">Start</label>
              <input
                type="datetime-local"
                value={start}
                onChange={e => setStart(e.target.value)}
                className="w-full px-3 py-2 rounded-md border border-line bg-bg text-ink text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>
            <div>
              <label className="block text-xs text-ink-faint mb-1">End</label>
              <input
                type="datetime-local"
                value={end}
                onChange={e => setEnd(e.target.value)}
                className="w-full px-3 py-2 rounded-md border border-line bg-bg text-ink text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>
          </div>
          <textarea
            placeholder="Description (optional)"
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 rounded-md border border-line bg-bg text-ink text-sm resize-none focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-md text-sm text-ink-muted hover:bg-bg-elev-2 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-4 py-1.5 rounded-md text-sm text-white bg-accent hover:bg-accent-hover transition-colors"
          >
            Save
          </button>
        </div>
      </form>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Main CalendarApp component
// ──────────────────────────────────────────────────────────────────────────────

export default function CalendarApp() {
  const { status } = useAuthStore()
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [view, setView] = useState('month') // 'month' | 'agenda'
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth())
  const [showModal, setShowModal] = useState(false)
  const [editingEvent, setEditingEvent] = useState(null)

  // Credentials from auth store (email + app-password).
  const credentials = {
    email: status?.user?.email || '',
    appPassword: status?.user?.appPassword || '',
  }
  const accountID = status?.user?.id || ''

  const load = useCallback(async () => {
    if (!accountID || !credentials.email) return
    setLoading(true)
    setError(null)
    try {
      const evts = await fetchEvents(accountID, credentials)
      setEvents(evts)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [accountID, credentials.email])

  useEffect(() => { load() }, [load])

  const handleSave = async (eventData) => {
    try {
      await putEvent(accountID, credentials, eventData)
      setShowModal(false)
      setEditingEvent(null)
      await load()
    } catch (e) {
      setError(e.message)
    }
  }

  const handleDelete = async (uid) => {
    if (!confirm('Delete this event?')) return
    try {
      await deleteEvent(accountID, credentials, uid)
      await load()
    } catch (e) {
      setError(e.message)
    }
  }

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  // ── Month grid ──────────────────────────────────────────────────────────────
  const daysInMonth = getDaysInMonth(year, month)
  const firstDay = getFirstDayOfMonth(year, month)
  const today = new Date()

  const eventsForDay = (day) => {
    const d = new Date(year, month, day)
    return events.filter(e => e.start && isSameDay(new Date(e.start), d))
  }

  // ── Agenda view ──────────────────────────────────────────────────────────────
  const upcomingEvents = [...events]
    .filter(e => e.start && new Date(e.start) >= new Date())
    .sort((a, b) => new Date(a.start) - new Date(b.start))
    .slice(0, 20)

  return (
    <div className="flex flex-col h-full p-6 bg-bg text-ink overflow-y-auto" style={{ fontFamily: 'var(--font-sans)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Calendar size={18} className="text-accent" />
          <h1 className="text-lg font-semibold text-ink">Calendar</h1>
          <span className="text-xs px-1.5 py-0.5 rounded bg-accent-tint text-accent font-medium ml-1">beta</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setView(v => v === 'month' ? 'agenda' : 'month')}
            className="text-xs px-3 py-1.5 rounded-md border border-line text-ink-muted hover:bg-bg-elev-2 transition-colors"
          >
            {view === 'month' ? 'Agenda view' : 'Month view'}
          </button>
          <button
            onClick={() => { setEditingEvent(null); setShowModal(true) }}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent-hover transition-colors"
          >
            <Plus size={12} />
            New event
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-signal-error-bg text-signal-error text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : view === 'month' ? (
        /* ── Month view ── */
        <div>
          {/* Month nav */}
          <div className="flex items-center gap-3 mb-4">
            <button onClick={prevMonth} className="p-1 rounded hover:bg-bg-elev-2 text-ink-muted">
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-medium text-ink w-36 text-center">
              {MONTH_NAMES[month]} {year}
            </span>
            <button onClick={nextMonth} className="p-1 rounded hover:bg-bg-elev-2 text-ink-muted">
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 mb-1">
            {DAY_NAMES.map(d => (
              <div key={d} className="text-xs text-ink-faint text-center py-1 font-medium">{d}</div>
            ))}
          </div>

          {/* Days grid */}
          <div className="grid grid-cols-7 gap-px bg-line rounded-lg overflow-hidden border border-line">
            {/* Empty cells before first day */}
            {Array.from({ length: firstDay }, (_, i) => (
              <div key={`empty-${i}`} className="bg-bg-elev-2 min-h-[80px]" />
            ))}
            {/* Day cells */}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1
              const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day
              const dayEvents = eventsForDay(day)

              return (
                <div
                  key={day}
                  className="bg-bg min-h-[80px] p-1.5 cursor-pointer hover:bg-accent-tint/40 transition-colors"
                  onClick={() => {
                    const d = new Date(year, month, day)
                    const start = new Date(d); start.setHours(10)
                    const end = new Date(d); end.setHours(11)
                    setEditingEvent({
                      uid: '',
                      title: '',
                      start: start.toISOString(),
                      end: end.toISOString(),
                    })
                    setShowModal(true)
                  }}
                >
                  <span className={[
                    'inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium',
                    isToday ? 'bg-accent text-white' : 'text-ink-muted',
                  ].join(' ')}>
                    {day}
                  </span>
                  <div className="mt-1 space-y-px">
                    {dayEvents.slice(0, 2).map(e => (
                      <div
                        key={e.uid}
                        className="text-xs px-1 py-px rounded bg-accent-tint-2 text-accent truncate"
                        onClick={ev => { ev.stopPropagation(); setEditingEvent(e); setShowModal(true) }}
                        title={e.title}
                      >
                        {e.title}
                      </div>
                    ))}
                    {dayEvents.length > 2 && (
                      <div className="text-xs text-ink-faint px-1">+{dayEvents.length - 2} more</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        /* ── Agenda view ── */
        <div className="space-y-2 max-w-2xl">
          {upcomingEvents.length === 0 ? (
            <p className="text-sm text-ink-muted">No upcoming events.</p>
          ) : upcomingEvents.map(e => (
            <div
              key={e.uid}
              className="flex items-start justify-between gap-4 p-3 rounded-lg border border-line bg-bg-elev-1 hover:border-accent/40 transition-colors"
            >
              <div>
                <p className="text-sm font-medium text-ink">{e.title}</p>
                <p className="text-xs text-ink-muted mt-0.5">
                  {e.start ? new Date(e.start).toLocaleString() : ''}
                  {e.end && ` – ${new Date(e.end).toLocaleTimeString()}`}
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={() => { setEditingEvent(e); setShowModal(true) }}
                  className="p-1 rounded text-ink-faint hover:text-ink hover:bg-bg-elev-2"
                  title="Edit"
                >
                  <Edit2 size={13} />
                </button>
                <button
                  onClick={() => handleDelete(e.uid)}
                  className="p-1 rounded text-ink-faint hover:text-signal-error hover:bg-signal-error-bg"
                  title="Delete"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <EventModal
          event={editingEvent}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditingEvent(null) }}
        />
      )}
    </div>
  )
}
