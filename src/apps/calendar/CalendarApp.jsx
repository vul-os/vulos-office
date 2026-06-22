/**
 * CalendarApp — Google Calendar parity: month/week/day/agenda views,
 * recurring events (RRULE), multi-calendar sidebar, RSVP, ICS export,
 * reminders, time zones, rich event creation.
 *
 * Architecture: all persistence goes through CalDAV (PROPFIND/PUT/DELETE).
 * Rich metadata (invitees, recurrence, color, reminders) is written into the
 * ICS VEVENT block so CalDAV clients (Apple Calendar, Thunderbird) see it.
 *
 * Constraints: JSX never .tsx | no heavy deps | reuse design tokens.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  ChevronLeft, ChevronRight, Plus, X, Edit2, Trash2, Calendar,
  Clock, MapPin, Users, RefreshCw, Bell, Eye, EyeOff, Download,
  Link, Check, Circle, MoreHorizontal, List, CalendarDays, CalendarRange,
  CalendarX2, AlertCircle, Menu,
} from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import { Button, IconButton, Input, LoadingState } from '../../components/ui'

// ── Tokenised form controls ──────────────────────────────────────────────────
// <Input> covers <input>; calendar also needs <select>/<textarea>. These thin
// wrappers reuse the exact same token styling (border-line, focus-within ring,
// 44px-friendly heights) so the Calendar app stops shipping ad-hoc inline
// inputs and reads as one design language with the rest of the suite.
const fieldBase =
  'w-full bg-paper border border-line rounded-md text-ink text-sm ' +
  'transition-[border-color,box-shadow] duration-fast ease-out ' +
  'focus:outline-none focus:border-accent focus:shadow-focus ' +
  'placeholder:text-ink-faint'

function FieldLabel({ children, htmlFor }) {
  return (
    <label htmlFor={htmlFor} className="block text-xs text-ink-muted font-medium mb-1.5 tracking-tightish">
      {children}
    </label>
  )
}

function Select({ className = '', ...rest }) {
  return <select className={`${fieldBase} h-9 px-2.5 ${className}`} {...rest} />
}

function Textarea({ className = '', ...rest }) {
  return <textarea className={`${fieldBase} px-3 py-2 resize-none ${className}`} {...rest} />
}

// ─── constants ────────────────────────────────────────────────────────────────

const CALDAV_BASE = import.meta.env.VITE_CALDAV_BASE || '/dav/calendars'
const API_BASE = import.meta.env.VITE_API_BASE || '/api'

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]
const DAY_NAMES_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const DAY_NAMES_ABBR  = ['S','M','T','W','T','F','S']

const EVENT_COLORS = [
  '#0f6a6c','#3b82f6','#8b5cf6','#ef4444','#f59e0b',
  '#10b981','#f97316','#ec4899','#6366f1','#14b8a6','#84cc16','#e11d48',
]

const DEFAULT_CALENDARS = [
  { id: 'personal', name: 'Personal', color: '#0f6a6c', visible: true },
  { id: 'birthdays', name: 'Birthdays', color: '#ef4444', visible: true },
]

// ─── CalDAV helpers ──────────────────────────────────────────────────────────

function davHeaders(creds) {
  const basic = btoa(`${creds.email}:${creds.appPassword}`)
  return {
    Authorization: `Basic ${basic}`,
    'Content-Type': 'text/calendar; charset=utf-8',
  }
}

function formatICSDate(d) {
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
}

function parseICSTime(s) {
  if (!s) return null
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/)
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`)
  const d = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (d) return new Date(`${d[1]}-${d[2]}-${d[3]}T00:00:00Z`)
  return null
}

function unfoldICS(raw) {
  return raw.replace(/\r?\n[ \t]/g, '')
}

function buildICS(ev) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Vulos Office//CalDAV//EN',
    'BEGIN:VEVENT',
    `UID:${ev.uid}`,
    ev.allDay
      ? `DTSTART;VALUE=DATE:${ev.start.replace(/[-:]/g,'').slice(0,8)}`
      : `DTSTART:${formatICSDate(new Date(ev.start))}`,
    ev.allDay
      ? `DTEND;VALUE=DATE:${ev.end.replace(/[-:]/g,'').slice(0,8)}`
      : `DTEND:${formatICSDate(new Date(ev.end))}`,
    `SUMMARY:${icsEscape(ev.title)}`,
    ev.description ? `DESCRIPTION:${icsEscape(ev.description)}` : '',
    ev.location    ? `LOCATION:${icsEscape(ev.location)}` : '',
    ev.recurrence  ? ev.recurrence : '',
    ev.timeZone    ? `X-VULOS-TIMEZONE:${ev.timeZone}` : '',
    ev.color       ? `X-VULOS-COLOR:${ev.color}` : '',
    ev.calendarId  ? `X-VULOS-CALENDAR:${ev.calendarId}` : '',
    ev.visibility  ? `CLASS:${ev.visibility === 'private' ? 'PRIVATE' : 'PUBLIC'}` : '',
    ev.meetUrl     ? `X-VULOS-MEET:${ev.meetUrl}` : '',
    ...(ev.invitees || []).map(i => `ATTENDEE;CN=${i.name || ''};RSVP=TRUE:mailto:${i.email}`),
    ...(ev.reminders || []).map(r =>
      `BEGIN:VALARM\r\nTRIGGER:-PT${r.minutesBefore}M\r\nACTION:${r.channel === 'email' ? 'EMAIL' : 'DISPLAY'}\r\nDESCRIPTION:Reminder\r\nEND:VALARM`
    ),
  ].filter(Boolean)
  lines.push('END:VEVENT', 'END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}

function parseICSEvent(block) {
  const get = (key) => {
    const m = block.match(new RegExp(`^${key}[^:]*:(.+)`, 'm'))
    return m ? m[1].trim() : ''
  }
  const uid     = get('UID')
  const summary = get('SUMMARY')
  const dtstart = get('DTSTART')
  const dtend   = get('DTEND')
  if (!uid || !dtstart) return null

  const inviteesRaw = [...block.matchAll(/^ATTENDEE[^:]*:mailto:(.+)/gm)]
  const invitees = inviteesRaw.map(m => ({
    email: m[1].trim(),
    name: '',
    status: 'pending',
  }))

  const reminders = []
  const alarmBlocks = block.split('BEGIN:VALARM').slice(1)
  for (const ab of alarmBlocks) {
    const trigger = get.call({ match: s => ab.match(s) }, 'TRIGGER')
    const action  = (ab.match(/^ACTION:(.+)/m)||[])[1]?.trim() || 'DISPLAY'
    const minsMatch = trigger.match(/PT(\d+)M/)
    if (minsMatch) {
      reminders.push({
        minutesBefore: parseInt(minsMatch[1], 10),
        channel: action === 'EMAIL' ? 'email' : 'in-app',
      })
    }
  }

  return {
    uid,
    title: summary || '(no title)',
    start: parseICSTime(dtstart),
    end:   parseICSTime(dtend) || parseICSTime(dtstart),
    allDay: dtstart.length === 8 || dtstart.includes('VALUE=DATE'),
    description: get('DESCRIPTION'),
    location:    get('LOCATION'),
    recurrence:  get('RRULE') ? 'RRULE:' + get('RRULE') : '',
    color:       get('X-VULOS-COLOR') || '',
    calendarId:  get('X-VULOS-CALENDAR') || 'personal',
    timeZone:    get('X-VULOS-TIMEZONE') || '',
    meetUrl:     get('X-VULOS-MEET') || '',
    visibility:  (get('CLASS') || '').toLowerCase() === 'private' ? 'private' : 'public',
    invitees,
    reminders,
    raw: block,
  }
}

function parseICSEvents(icsText) {
  const unfolded = unfoldICS(icsText)
  const events = []
  const blocks = unfolded.split('BEGIN:VEVENT').slice(1)
  for (const block of blocks) {
    const ev = parseICSEvent(block)
    if (ev) events.push(ev)
  }
  return events
}

function icsEscape(s) {
  return (s || '').replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\n/g,'\\n')
}

// ─── API helpers ─────────────────────────────────────────────────────────────

async function fetchEvents(accountID, creds) {
  const collURL = `${CALDAV_BASE}/${accountID}/personal/`
  const headers = davHeaders(creds)
  const res = await fetch(collURL, {
    method: 'PROPFIND',
    headers: { ...headers, Depth: '1' },
    body: `<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:getetag/></D:prop></D:propfind>`,
  })
  if (!res.ok && res.status !== 207) throw new Error(`CalDAV PROPFIND ${res.status}`)
  const xml = await res.text()
  const hrefs = [...xml.matchAll(/<[^>]*:href[^>]*>([^<]+\.ics)<\/[^>]*:href>/g)].map(m => m[1])
  const events = []
  await Promise.all(hrefs.map(async href => {
    const r = await fetch(href, { headers })
    if (r.ok) events.push(...parseICSEvents(await r.text()))
  }))
  return events
}

async function putEvent(accountID, creds, event) {
  const url = `${CALDAV_BASE}/${accountID}/personal/${event.uid}.ics`
  const r = await fetch(url, { method: 'PUT', headers: davHeaders(creds), body: buildICS(event) })
  if (!r.ok && r.status !== 201 && r.status !== 204) throw new Error(`CalDAV PUT ${r.status}`)
}

async function deleteEvent(accountID, creds, uid) {
  const url = `${CALDAV_BASE}/${accountID}/personal/${uid}.ics`
  const r = await fetch(url, { method: 'DELETE', headers: davHeaders(creds) })
  if (!r.ok && r.status !== 204) throw new Error(`CalDAV DELETE ${r.status}`)
}

async function rsvpEvent(eventID, email, status) {
  const r = await fetch(`${API_BASE}/calendar/events/${eventID}/rsvp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, email }),
  })
  if (!r.ok) throw new Error(`RSVP failed ${r.status}`)
}

// ─── date helpers ─────────────────────────────────────────────────────────────

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function addDays(d, n) {
  const r = new Date(d); r.setDate(r.getDate() + n); return r
}

function getWeekStart(d) {
  const s = new Date(d); s.setDate(d.getDate() - d.getDay()); return startOfDay(s)
}

function hoursFromMidnight(d) {
  return d.getHours() + d.getMinutes() / 60
}

// ─── sub-components ───────────────────────────────────────────────────────────

// ── CalendarsSidebar ──────────────────────────────────────────────────────────

function CalendarsSidebar({ calendars, onToggle, onAdd, onExport }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const inputRef = useRef(null)

  useEffect(() => { if (adding) inputRef.current?.focus() }, [adding])

  const submit = (e) => {
    e?.preventDefault()
    const n = name.trim()
    if (n) onAdd(n)
    setName('')
    setAdding(false)
  }

  return (
    <div className="flex-shrink-0 p-3 overflow-y-auto">
      <div className="flex items-center justify-between mb-3">
        <span className="text-2xs font-semibold text-ink-faint uppercase tracking-eyebrow">My calendars</span>
        <IconButton size="sm" onClick={() => setAdding(true)} title="Add calendar">
          <Plus size={13} />
        </IconButton>
      </div>

      {calendars.map(cal => (
        <div key={cal.id} className="flex items-center gap-2 min-h-[36px] py-1.5 px-1 rounded hover:bg-bg-elev-2 group">
          <button
            onClick={() => onToggle(cal.id)}
            className="flex-shrink-0 w-7 h-7 -my-1 flex items-center justify-center rounded hover:bg-bg-sunk"
            title={cal.visible ? `Hide ${cal.name}` : `Show ${cal.name}`}
            aria-pressed={cal.visible}
          >
            {cal.visible
              ? <div className="w-3 h-3 rounded-sm" style={{ background: cal.color }} />
              : <div className="w-3 h-3 rounded-sm border-2" style={{ borderColor: cal.color }} />
            }
          </button>
          <span className="text-sm text-ink flex-1 truncate">{cal.name}</span>
          <button
            onClick={() => onExport(cal.id)}
            className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity w-7 h-7 flex items-center justify-center rounded hover:bg-bg-sunk text-ink-faint hover:text-ink"
            title="Export .ics"
          >
            <Download size={12} />
          </button>
        </div>
      ))}

      {adding && (
        <form onSubmit={submit} className="mt-2 flex items-center gap-1.5">
          <Input
            ref={inputRef}
            size="sm"
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={submit}
            onKeyDown={e => { if (e.key === 'Escape') { setName(''); setAdding(false) } }}
            placeholder="Calendar name"
            className="flex-1"
            aria-label="New calendar name"
          />
        </form>
      )}
    </div>
  )
}

// ── MiniMonthNav ──────────────────────────────────────────────────────────────

function MiniMonthNav({ year, month, onPrev, onNext, onDayClick, today, selectedDate }) {
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  return (
    <div className="p-3 border-b border-line">
      <div className="flex items-center justify-between mb-2">
        <button onClick={onPrev} className="p-0.5 rounded hover:bg-bg-elev-2 text-ink-faint"><ChevronLeft size={12} /></button>
        <span className="text-xs font-medium text-ink">{MONTH_NAMES[month].slice(0,3)} {year}</span>
        <button onClick={onNext} className="p-0.5 rounded hover:bg-bg-elev-2 text-ink-faint"><ChevronRight size={12} /></button>
      </div>
      <div className="grid grid-cols-7 gap-px text-center mb-1">
        {DAY_NAMES_ABBR.map((d, i) => <span key={i} className="text-[9px] text-ink-faint font-medium">{d}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-px">
        {Array.from({ length: firstDay }, (_, i) => <span key={`e${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1
          const d = new Date(year, month, day)
          const isToday = isSameDay(d, today)
          const isSel = selectedDate && isSameDay(d, selectedDate)
          return (
            <button
              key={day}
              onClick={() => onDayClick(d)}
              className={[
                'text-[10px] w-5 h-5 mx-auto flex items-center justify-center rounded-full transition-colors',
                isToday ? 'bg-accent text-white' : '',
                isSel && !isToday ? 'bg-accent-tint text-accent font-semibold' : '',
                !isToday && !isSel ? 'text-ink-muted hover:bg-bg-elev-2' : '',
              ].join(' ')}
            >
              {day}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── MonthView ─────────────────────────────────────────────────────────────────

function MonthView({ year, month, events, calendars, today, onDayClick, onEventClick }) {
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const visibleCalIds = new Set(calendars.filter(c => c.visible).map(c => c.id))
  const calColorMap = Object.fromEntries(calendars.map(c => [c.id, c.color]))

  const eventsForDay = useCallback((day) => {
    const d = new Date(year, month, day)
    return events
      .filter(e => e.start && isSameDay(new Date(e.start), d) && visibleCalIds.has(e.calendarId))
      .sort((a, b) => new Date(a.start) - new Date(b.start))
  }, [events, year, month, visibleCalIds])

  const totalCells = firstDay + daysInMonth
  const rows = Math.ceil(totalCells / 7)

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* DOW header */}
      <div className="grid grid-cols-7 border-b border-line bg-bg-elev-2">
        {DAY_NAMES_SHORT.map(d => (
          <div key={d} className="text-xs text-ink-faint text-center py-1.5 font-medium">{d}</div>
        ))}
      </div>
      {/* Grid */}
      <div className="flex-1 grid grid-rows-[repeat(auto-fit,minmax(0,1fr))] overflow-hidden">
        {Array.from({ length: rows }, (_, rowIdx) => (
          <div key={rowIdx} className="grid grid-cols-7 border-b border-line last:border-0 min-h-[80px]">
            {Array.from({ length: 7 }, (_, colIdx) => {
              const cellIdx = rowIdx * 7 + colIdx
              const day = cellIdx - firstDay + 1
              if (day < 1 || day > daysInMonth) {
                return <div key={colIdx} className="border-r border-line last:border-0 bg-bg-elev-2 opacity-40" />
              }
              const dayEvents = eventsForDay(day)
              const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day

              return (
                <div
                  key={colIdx}
                  className="border-r border-line last:border-0 p-1 cursor-pointer hover:bg-accent-tint/30 transition-colors overflow-hidden"
                  onClick={() => onDayClick(new Date(year, month, day))}
                >
                  <span className={[
                    'inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium mb-0.5',
                    isToday ? 'bg-accent text-white' : 'text-ink-muted',
                  ].join(' ')}>
                    {day}
                  </span>
                  <div className="space-y-px">
                    {dayEvents.slice(0, 3).map(e => (
                      <div
                        key={e.uid}
                        className="text-[11px] px-1 py-px rounded truncate text-white cursor-pointer hover:opacity-90"
                        style={{ background: e.color || calColorMap[e.calendarId] || '#0f6a6c' }}
                        onClick={ev => { ev.stopPropagation(); onEventClick(e) }}
                        title={e.title}
                      >
                        {e.title}
                      </div>
                    ))}
                    {dayEvents.length > 3 && (
                      <div className="text-[10px] text-ink-faint px-1">+{dayEvents.length - 3} more</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── WeekView / DayView ────────────────────────────────────────────────────────

const HOUR_HEIGHT = 48 // px per hour

function TimelineView({ days, events, calendars, onSlotClick, onEventClick }) {
  const scrollRef = useRef(null)
  const visibleCalIds = new Set(calendars.filter(c => c.visible).map(c => c.id))
  const calColorMap = Object.fromEntries(calendars.map(c => [c.id, c.color]))
  const now = new Date()

  useEffect(() => {
    // Scroll to 8am on mount
    if (scrollRef.current) scrollRef.current.scrollTop = HOUR_HEIGHT * 7
  }, [])

  const eventsForDay = (dayDate) =>
    events.filter(e =>
      e.start && isSameDay(new Date(e.start), dayDate) &&
      !e.allDay &&
      visibleCalIds.has(e.calendarId)
    )

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header row with day labels */}
      <div className="flex border-b border-line bg-bg-elev-2 flex-shrink-0">
        <div className="w-12 flex-shrink-0" />
        {days.map(day => {
          const isToday = isSameDay(day, now)
          return (
            <div key={day.toISOString()} className="flex-1 text-center py-1.5 border-l border-line">
              <div className="text-xs text-ink-faint">{DAY_NAMES_SHORT[day.getDay()]}</div>
              <div className={[
                'text-sm font-semibold mx-auto w-7 h-7 flex items-center justify-center rounded-full',
                isToday ? 'bg-accent text-white' : 'text-ink',
              ].join(' ')}>{day.getDate()}</div>
            </div>
          )
        })}
      </div>

      {/* Scrollable time grid */}
      <div className="flex-1 overflow-y-auto" ref={scrollRef}>
        <div className="relative flex" style={{ height: HOUR_HEIGHT * 24 }}>
          {/* Time labels */}
          <div className="w-12 flex-shrink-0 relative">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="absolute right-2 text-[10px] text-ink-faint" style={{ top: HOUR_HEIGHT * h - 7 }}>
                {h === 0 ? '' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h-12}pm`}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map(day => {
            const dayEvents = eventsForDay(day)
            const isToday = isSameDay(day, now)
            return (
              <div
                key={day.toISOString()}
                className="flex-1 border-l border-line relative"
                style={{ height: HOUR_HEIGHT * 24 }}
                onClick={e => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  const y = e.clientY - rect.top
                  const hour = Math.floor(y / HOUR_HEIGHT)
                  const d = new Date(day); d.setHours(hour); d.setMinutes(0)
                  onSlotClick(d)
                }}
              >
                {/* Hour lines */}
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="absolute left-0 right-0 border-t border-line" style={{ top: HOUR_HEIGHT * h }} />
                ))}

                {/* Now line */}
                {isToday && (
                  <div
                    className="absolute left-0 right-0 border-t-2 border-red-400 z-20"
                    style={{ top: hoursFromMidnight(now) * HOUR_HEIGHT }}
                  >
                    <div className="w-2 h-2 rounded-full bg-red-400 absolute -left-1 -top-1" />
                  </div>
                )}

                {/* Events */}
                {dayEvents.map(ev => {
                  const startH = hoursFromMidnight(new Date(ev.start))
                  const endH   = hoursFromMidnight(new Date(ev.end))
                  const top    = startH * HOUR_HEIGHT
                  const height = Math.max((endH - startH) * HOUR_HEIGHT, 18)
                  const color  = ev.color || calColorMap[ev.calendarId] || '#0f6a6c'
                  return (
                    <div
                      key={ev.uid}
                      className="absolute left-0.5 right-0.5 rounded px-1 py-px cursor-pointer hover:opacity-90 transition-opacity z-10 overflow-hidden"
                      style={{ top, height, background: color }}
                      onClick={e => { e.stopPropagation(); onEventClick(ev) }}
                    >
                      <div className="text-[11px] text-white font-medium leading-tight truncate">{ev.title}</div>
                      {height > 24 && (
                        <div className="text-[10px] text-white/80 truncate">
                          {new Date(ev.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── AgendaView ────────────────────────────────────────────────────────────────

function AgendaView({ events, calendars, today, onEventClick }) {
  const visibleCalIds = new Set(calendars.filter(c => c.visible).map(c => c.id))
  const calColorMap = Object.fromEntries(calendars.map(c => [c.id, c.color]))

  const sorted = [...events]
    .filter(e => e.start && new Date(e.start) >= startOfDay(today) && visibleCalIds.has(e.calendarId))
    .sort((a, b) => new Date(a.start) - new Date(b.start))

  // Group by day
  const groups = {}
  for (const ev of sorted) {
    const key = startOfDay(new Date(ev.start)).toISOString()
    if (!groups[key]) groups[key] = []
    groups[key].push(ev)
  }
  const groupKeys = Object.keys(groups).sort()

  if (groupKeys.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 text-center px-6 py-12 gap-3">
        <div className="w-12 h-12 rounded-full bg-bg-elev-2 flex items-center justify-center">
          <CalendarX2 size={22} className="text-ink-faint" />
        </div>
        <div>
          <p className="text-sm font-medium text-ink">No upcoming events</p>
          <p className="text-xs text-ink-faint mt-1">Events you create will appear here.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-6 max-w-2xl w-full">
      {groupKeys.map(key => {
        const d = new Date(key)
        const isToday = isSameDay(d, today)
        return (
          <div key={key}>
            <div className="flex items-center gap-2 mb-2">
              <div className={[
                'text-sm font-semibold',
                isToday ? 'text-accent' : 'text-ink',
              ].join(' ')}>
                {isToday ? 'Today' : d.toLocaleDateString(undefined, { weekday:'long', month:'long', day:'numeric' })}
              </div>
              {isToday && <span className="w-1.5 h-1.5 rounded-full bg-accent" />}
            </div>
            <div className="space-y-1">
              {groups[key].map(ev => (
                <div
                  key={ev.uid}
                  className="flex items-start gap-3 p-2.5 rounded-lg border border-line bg-bg-elev-1 hover:border-accent/40 cursor-pointer transition-colors"
                  onClick={() => onEventClick(ev)}
                >
                  <div className="w-1 self-stretch rounded-full flex-shrink-0 mt-0.5" style={{ background: ev.color || calColorMap[ev.calendarId] || '#0f6a6c' }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-ink truncate">{ev.title}</div>
                    <div className="text-xs text-ink-muted mt-0.5">
                      {ev.allDay ? 'All day' : `${new Date(ev.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – ${new Date(ev.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}
                      {ev.location && ` · ${ev.location}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── RRule Editor ──────────────────────────────────────────────────────────────

const FREQ_OPTIONS = [
  { value: '', label: 'Does not repeat' },
  { value: 'RRULE:FREQ=DAILY', label: 'Daily' },
  { value: 'RRULE:FREQ=WEEKLY', label: 'Weekly' },
  { value: 'RRULE:FREQ=MONTHLY', label: 'Monthly' },
  { value: 'RRULE:FREQ=YEARLY', label: 'Yearly' },
  { value: 'custom', label: 'Custom…' },
]

const WEEKDAY_CODES = ['MO','TU','WE','TH','FR','SA','SU']
const WEEKDAY_LABELS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

function RRuleEditor({ value, onChange }) {
  const isCustom = value && !['','RRULE:FREQ=DAILY','RRULE:FREQ=WEEKLY','RRULE:FREQ=MONTHLY','RRULE:FREQ=YEARLY'].includes(value)
  const [showCustom, setShowCustom] = useState(isCustom)
  const [freq, setFreq] = useState('WEEKLY')
  const [interval, setInterval] = useState(1)
  const [byDay, setByDay] = useState([])
  const [endType, setEndType] = useState('never') // 'never' | 'count' | 'until'
  const [count, setCount] = useState(10)
  const [until, setUntil] = useState('')

  const buildRRule = useCallback(() => {
    let r = `RRULE:FREQ=${freq}`
    if (interval > 1) r += `;INTERVAL=${interval}`
    if (freq === 'WEEKLY' && byDay.length > 0) r += `;BYDAY=${byDay.join(',')}`
    if (endType === 'count') r += `;COUNT=${count}`
    if (endType === 'until' && until) r += `;UNTIL=${until.replace(/-/g, '')}T000000Z`
    return r
  }, [freq, interval, byDay, endType, count, until])

  const handlePreset = (v) => {
    if (v === 'custom') {
      setShowCustom(true)
      onChange(buildRRule())
    } else {
      setShowCustom(false)
      onChange(v)
    }
  }

  const currentPreset = isCustom || showCustom ? 'custom' : (value || '')

  return (
    <div className="space-y-2">
      <select
        value={currentPreset}
        onChange={e => handlePreset(e.target.value)}
        className="w-full px-2 py-1.5 rounded-md border border-line bg-bg text-ink text-xs focus:outline-none focus:ring-2 focus:ring-accent/40"
      >
        {FREQ_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      {showCustom && (
        <div className="border border-line rounded-lg p-3 space-y-3 bg-bg-elev-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-faint">Every</span>
            <input
              type="number" min={1} max={99}
              value={interval}
              onChange={e => { setInterval(+e.target.value); onChange(buildRRule()) }}
              className="w-12 px-2 py-1 rounded border border-line bg-bg text-ink text-xs focus:outline-none"
            />
            <select
              value={freq}
              onChange={e => { setFreq(e.target.value); onChange(buildRRule()) }}
              className="px-2 py-1 rounded border border-line bg-bg text-ink text-xs focus:outline-none"
            >
              <option value="DAILY">day(s)</option>
              <option value="WEEKLY">week(s)</option>
              <option value="MONTHLY">month(s)</option>
              <option value="YEARLY">year(s)</option>
            </select>
          </div>

          {freq === 'WEEKLY' && (
            <div className="flex gap-1 flex-wrap">
              {WEEKDAY_CODES.map((code, i) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => {
                    const next = byDay.includes(code) ? byDay.filter(c => c !== code) : [...byDay, code]
                    setByDay(next)
                    onChange(buildRRule())
                  }}
                  className={[
                    'w-8 h-8 rounded-full text-xs font-medium border transition-colors',
                    byDay.includes(code)
                      ? 'bg-accent text-white border-accent'
                      : 'border-line text-ink-muted hover:border-accent/40',
                  ].join(' ')}
                >
                  {WEEKDAY_LABELS[i].slice(0,1)}
                </button>
              ))}
            </div>
          )}

          <div className="space-y-1.5">
            <div className="text-xs text-ink-faint font-medium">Ends</div>
            {[
              { type: 'never', label: 'Never' },
              { type: 'count', label: 'After' },
              { type: 'until', label: 'On date' },
            ].map(opt => (
              <label key={opt.type} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio" name="endType" value={opt.type}
                  checked={endType === opt.type}
                  onChange={() => { setEndType(opt.type); onChange(buildRRule()) }}
                  className="accent-accent"
                />
                <span className="text-xs text-ink">{opt.label}</span>
                {opt.type === 'count' && endType === 'count' && (
                  <input
                    type="number" min={1} max={999}
                    value={count}
                    onChange={e => { setCount(+e.target.value); onChange(buildRRule()) }}
                    className="w-14 px-2 py-0.5 rounded border border-line bg-bg text-ink text-xs focus:outline-none ml-1"
                  />
                )}
                {opt.type === 'count' && endType === 'count' && (
                  <span className="text-xs text-ink-faint">occurrences</span>
                )}
                {opt.type === 'until' && endType === 'until' && (
                  <input
                    type="date"
                    value={until}
                    onChange={e => { setUntil(e.target.value); onChange(buildRRule()) }}
                    className="px-2 py-0.5 rounded border border-line bg-bg text-ink text-xs focus:outline-none ml-1"
                  />
                )}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── EventModal ────────────────────────────────────────────────────────────────

function EventModal({ event, calendars, contacts, onSave, onClose, onDelete }) {
  const isNew = !event?.uid
  const [title, setTitle]           = useState(event?.title || '')
  const [allDay, setAllDay]         = useState(event?.allDay || false)
  const [start, setStart]           = useState(
    event?.start ? new Date(event.start).toISOString().slice(0,16) : new Date().toISOString().slice(0,16)
  )
  const [end, setEnd]               = useState(
    event?.end ? new Date(event.end).toISOString().slice(0,16) : new Date(Date.now()+3600000).toISOString().slice(0,16)
  )
  const [description, setDesc]      = useState(event?.description || '')
  const [location, setLocation]     = useState(event?.location || '')
  const [calendarId, setCalendarId] = useState(event?.calendarId || calendars[0]?.id || 'personal')
  const [color, setColor]           = useState(event?.color || '')
  const [visibility, setVis]        = useState(event?.visibility || 'default')
  const [recurrence, setRecurrence] = useState(event?.recurrence || '')
  const [reminders, setReminders]   = useState(event?.reminders || [{ minutesBefore: 10, channel: 'in-app' }])
  const [inviteeInput, setInvInput] = useState('')
  const [invitees, setInvitees]     = useState(event?.invitees || [])
  const [timeZone, setTZ]           = useState(event?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [tab, setTab]               = useState('details') // 'details' | 'guests' | 'more'
  const [titleError, setTitleError] = useState('')

  // Invitee autocomplete
  const [suggestions, setSuggestions] = useState([])
  const handleInvInput = (v) => {
    setInvInput(v)
    if (v.length >= 2) {
      setSuggestions(contacts.filter(c =>
        c.email && (c.fullName?.toLowerCase().includes(v.toLowerCase()) || c.email.toLowerCase().includes(v.toLowerCase()))
      ).slice(0, 5))
    } else {
      setSuggestions([])
    }
  }

  const addInvitee = (email, name = '') => {
    if (!email || invitees.some(i => i.email === email)) return
    setInvitees(prev => [...prev, { email, name, status: 'pending' }])
    setInvInput('')
    setSuggestions([])
  }

  const removeInvitee = (email) => setInvitees(prev => prev.filter(i => i.email !== email))

  const addReminder = () => setReminders(prev => [...prev, { minutesBefore: 10, channel: 'in-app' }])
  const removeReminder = (idx) => setReminders(prev => prev.filter((_, i) => i !== idx))
  const updateReminder = (idx, key, val) => setReminders(prev => prev.map((r, i) => i === idx ? { ...r, [key]: val } : r))

  const handleSave = (e) => {
    e.preventDefault()
    if (!title.trim()) {
      setTitleError('Give your event a title.')
      setTab('details')
      return
    }
    onSave({
      uid: event?.uid || crypto.randomUUID(),
      title: title.trim(),
      allDay,
      start: new Date(start).toISOString(),
      end:   new Date(end).toISOString(),
      description: description.trim(),
      location: location.trim(),
      calendarId,
      color,
      visibility,
      recurrence,
      reminders,
      invitees,
      timeZone,
    })
  }

  const calColor = calendars.find(c => c.id === calendarId)?.color || '#0f6a6c'
  const effectiveColor = color || calColor

  // Escape-to-close + focus restore (mirrors the shared <Modal> behaviour, kept
  // local because this dialog is a bespoke tabbed form with a colour stripe).
  const formRef = useRef(null)
  const priorFocusRef = useRef(null)
  useEffect(() => {
    priorFocusRef.current = document.activeElement
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      const el = priorFocusRef.current
      if (el && typeof el.focus === 'function') el.focus()
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in"
      style={{ background: 'rgba(26, 25, 22, 0.36)', backdropFilter: 'blur(2px)' }}
      onClick={onClose}
    >
      <form
        ref={formRef}
        role="dialog"
        aria-modal="true"
        aria-label={isNew ? 'New event' : 'Edit event'}
        onSubmit={handleSave}
        className="relative bg-paper text-ink border border-line shadow-e3 w-full max-w-lg max-h-[92vh] sm:max-h-[90vh] flex flex-col rounded-t-xl sm:rounded-xl overflow-hidden animate-scale-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Color stripe */}
        <div className="h-1.5 flex-shrink-0" style={{ background: effectiveColor }} />

        {/* Header */}
        <div className="flex items-start gap-2 px-4 sm:px-5 pt-3.5 pb-3 border-b border-line">
          <div className="flex-1 min-w-0">
            <input
              type="text"
              placeholder="Event title"
              value={title}
              onChange={e => { setTitle(e.target.value); if (titleError) setTitleError('') }}
              autoFocus
              aria-invalid={!!titleError}
              className={[
                'w-full text-base font-semibold text-ink bg-transparent outline-none',
                'placeholder:text-ink-faint border-b transition-colors',
                titleError ? 'border-danger' : 'border-transparent focus:border-line-strong',
              ].join(' ')}
            />
            <p className="text-2xs text-danger mt-1 min-h-[0.85rem]" role="alert" aria-live="polite">
              {titleError}
            </p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0 pt-0.5">
            {!isNew && (
              <IconButton size="sm" onClick={() => onDelete(event.uid)} title="Delete event"
                className="hover:text-danger hover:bg-danger-bg">
                <Trash2 size={14} />
              </IconButton>
            )}
            <IconButton size="sm" onClick={onClose} title="Close"><X size={15} /></IconButton>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-line px-2 sm:px-5 flex-shrink-0">
          {[['details','Details'],['guests','Guests'],['more','More']].map(([t, l]) => (
            <button
              key={t} type="button" onClick={() => setTab(t)}
              aria-pressed={tab === t}
              className={[
                'text-sm h-10 px-3 border-b-2 transition-colors tracking-tightish',
                tab === t ? 'border-accent text-accent font-medium' : 'border-transparent text-ink-faint hover:text-ink',
              ].join(' ')}
            >
              {l}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-4">

          {tab === 'details' && (
            <>
              {/* All-day toggle */}
              <label className="flex items-center gap-2.5 cursor-pointer min-h-[28px]">
                <input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} className="accent-accent w-4 h-4" />
                <span className="text-sm text-ink">All day</span>
              </label>

              {/* Times */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <FieldLabel>Start</FieldLabel>
                  <input
                    type={allDay ? 'date' : 'datetime-local'}
                    value={allDay ? start.slice(0,10) : start}
                    onChange={e => setStart(e.target.value)}
                    aria-label="Start"
                    className={`${fieldBase} h-9 px-2.5`}
                  />
                </div>
                <div>
                  <FieldLabel>End</FieldLabel>
                  <input
                    type={allDay ? 'date' : 'datetime-local'}
                    value={allDay ? end.slice(0,10) : end}
                    onChange={e => setEnd(e.target.value)}
                    aria-label="End"
                    className={`${fieldBase} h-9 px-2.5`}
                  />
                </div>
              </div>

              {/* Location */}
              <Input
                leading={<MapPin size={14} />}
                placeholder="Add location"
                value={location}
                onChange={e => setLocation(e.target.value)}
                aria-label="Location"
              />

              {/* Description */}
              <Textarea
                placeholder="Description"
                value={description}
                onChange={e => setDesc(e.target.value)}
                maxLength={5000}
                rows={3}
                aria-label="Description"
              />

              {/* Recurrence */}
              <div>
                <FieldLabel>Repeat</FieldLabel>
                <RRuleEditor value={recurrence} onChange={setRecurrence} />
              </div>

              {/* Reminders */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <FieldLabel>Reminders</FieldLabel>
                  <Button type="button" variant="ghost" size="sm" onClick={addReminder}>
                    <Plus size={12} /> Add
                  </Button>
                </div>
                <div className="space-y-1.5">
                  {reminders.map((r, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="number" min={0} max={10080}
                        value={r.minutesBefore}
                        onChange={e => updateReminder(i, 'minutesBefore', +e.target.value)}
                        aria-label="Minutes before"
                        className={`${fieldBase} w-16 h-9 px-2`}
                      />
                      <span className="text-xs text-ink-faint whitespace-nowrap">min before via</span>
                      <Select
                        value={r.channel}
                        onChange={e => updateReminder(i, 'channel', e.target.value)}
                        className="flex-1"
                        aria-label="Reminder channel"
                      >
                        <option value="in-app">In-app</option>
                        <option value="email">Email</option>
                        <option value="push">Push</option>
                      </Select>
                      <IconButton size="sm" onClick={() => removeReminder(i)} title="Remove reminder"
                        className="hover:text-danger flex-shrink-0">
                        <X size={13} />
                      </IconButton>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {tab === 'guests' && (
            <>
              {/* Invitee input */}
              <div className="relative">
                <Input
                  placeholder="Add guests by email or name"
                  value={inviteeInput}
                  onChange={e => handleInvInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); addInvitee(inviteeInput) }
                  }}
                  aria-label="Add guests"
                />
                {suggestions.length > 0 && (
                  <div className="absolute z-20 top-full left-0 right-0 bg-bg border border-line rounded-lg shadow-lg mt-1 overflow-hidden">
                    {suggestions.map(c => (
                      <button
                        key={c.email} type="button"
                        onClick={() => addInvitee(c.email, c.fullName)}
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent-tint text-left"
                      >
                        <div className="w-6 h-6 rounded-full bg-accent-tint flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-semibold text-accent">{(c.fullName || c.email)[0].toUpperCase()}</span>
                        </div>
                        <div>
                          <div className="text-xs font-medium text-ink">{c.fullName}</div>
                          <div className="text-[10px] text-ink-faint">{c.email}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Invitee list */}
              <div className="space-y-1">
                {invitees.map(inv => (
                  <div key={inv.email} className="flex items-center gap-2 p-2 rounded-lg bg-bg-elev-2">
                    <div className="w-6 h-6 rounded-full bg-accent-tint flex items-center justify-center flex-shrink-0">
                      <span className="text-[10px] font-semibold text-accent">{(inv.name || inv.email)[0].toUpperCase()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      {inv.name && <div className="text-xs font-medium text-ink truncate">{inv.name}</div>}
                      <div className="text-[10px] text-ink-faint truncate">{inv.email}</div>
                    </div>
                    <span className={[
                      'text-[10px] px-1.5 py-0.5 rounded-full',
                      inv.status === 'accepted' ? 'bg-signal-success-bg text-signal-success' :
                      inv.status === 'declined' ? 'bg-signal-error-bg text-signal-error' :
                      'bg-bg-elev-2 text-ink-faint',
                    ].join(' ')}>{inv.status}</span>
                    <button type="button" onClick={() => removeInvitee(inv.email)} className="text-ink-faint hover:text-signal-error">
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>

              {/* RSVP summary */}
              {invitees.length > 0 && (
                <div className="flex gap-3 text-xs text-ink-faint">
                  <span className="text-signal-success">{invitees.filter(i => i.status === 'accepted').length} yes</span>
                  <span className="text-signal-error">{invitees.filter(i => i.status === 'declined').length} no</span>
                  <span>{invitees.filter(i => i.status === 'pending').length} pending</span>
                </div>
              )}
            </>
          )}

          {tab === 'more' && (
            <>
              {/* Calendar */}
              <div>
                <FieldLabel>Calendar</FieldLabel>
                <Select value={calendarId} onChange={e => setCalendarId(e.target.value)} aria-label="Calendar">
                  {calendars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </div>

              {/* Color */}
              <div>
                <FieldLabel>Color</FieldLabel>
                <div className="flex gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setColor('')}
                    className={['w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all',
                      !color ? 'border-ink scale-110' : 'border-transparent hover:scale-105',
                    ].join(' ')}
                    style={{ background: calColor }}
                    title="Calendar default"
                    aria-pressed={!color}
                  >
                    {!color && <Check size={11} className="text-white" />}
                  </button>
                  {EVENT_COLORS.map(c => (
                    <button
                      key={c} type="button" onClick={() => setColor(c)}
                      className={['w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all',
                        color === c ? 'border-ink scale-110' : 'border-transparent hover:scale-105',
                      ].join(' ')}
                      style={{ background: c }}
                      title={c}
                      aria-pressed={color === c}
                    >
                      {color === c && <Check size={11} className="text-white" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Visibility */}
              <div>
                <FieldLabel>Visibility</FieldLabel>
                <Select value={visibility} onChange={e => setVis(e.target.value)} aria-label="Visibility">
                  <option value="default">Default</option>
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                </Select>
              </div>

              {/* Time zone */}
              <Input
                label="Time zone"
                value={timeZone}
                onChange={e => setTZ(e.target.value)}
                placeholder="e.g. America/New_York"
              />
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 sm:px-5 py-3 border-t border-line bg-bg-elev2 flex-shrink-0">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">{isNew ? 'Create event' : 'Save'}</Button>
        </div>
      </form>
    </div>
  )
}

// ─── Main CalendarApp ─────────────────────────────────────────────────────────

export default function CalendarApp() {
  const { status } = useAuthStore()
  const creds = {
    email: status?.user?.email || '',
    appPassword: status?.user?.appPassword || '',
  }
  const accountID = status?.user?.id || ''

  // View state
  const [view, setView] = useState('month') // month | week | day | agenda
  const [year,  setYear]  = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth())
  const [selectedDate, setSelectedDate] = useState(new Date())
  const today = useMemo(() => new Date(), [])

  // Data
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [contacts, setContacts] = useState([]) // for invitee autocomplete

  // Calendars
  const [calendars, setCalendars] = useState(DEFAULT_CALENDARS)

  // Modal
  const [showModal, setShowModal] = useState(false)
  const [editingEvent, setEditingEvent] = useState(null)

  // Mobile sidebar drawer (the mini-month + calendars list collapse off-canvas
  // below lg and slide in over a scrim).
  const [mobileNav, setMobileNav] = useState(false)

  // Load
  const load = useCallback(async () => {
    if (!accountID || !creds.email) { setLoading(false); return }
    setLoading(true); setError(null)
    try {
      const evts = await fetchEvents(accountID, creds)
      setEvents(evts)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [accountID, creds.email])

  useEffect(() => { load() }, [load])

  // Keyboard shortcuts: m/w/d/a to switch views
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.key === 'm') setView('month')
      if (e.key === 'w') setView('week')
      if (e.key === 'd') setView('day')
      if (e.key === 'a') setView('agenda')
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const handleSave = async (evData) => {
    try {
      await putEvent(accountID, creds, evData)
      setShowModal(false); setEditingEvent(null)
      await load()
    } catch (e) { setError(e.message) }
  }

  const handleDelete = async (uid) => {
    if (!confirm('Delete this event?')) return
    try {
      await deleteEvent(accountID, creds, uid)
      setShowModal(false); setEditingEvent(null)
      await load()
    } catch (e) { setError(e.message) }
  }

  const openNewEvent = (d) => {
    const s = new Date(d); if (s.getHours() === 0) s.setHours(10)
    const en = new Date(s); en.setHours(en.getHours() + 1)
    setEditingEvent({ uid: '', title: '', start: s.toISOString(), end: en.toISOString(), calendarId: calendars[0]?.id || 'personal' })
    setShowModal(true)
  }

  const toggleCalendar = (id) => {
    setCalendars(prev => prev.map(c => c.id === id ? { ...c, visible: !c.visible } : c))
  }

  const exportCalendar = async (calID) => {
    try {
      const r = await fetch(`${API_BASE}/calendar/export/${calID}`)
      if (!r.ok) throw new Error('Export failed')
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `${calID}.ics`; a.click()
      URL.revokeObjectURL(url)
    } catch (e) { setError(e.message) }
  }

  // Navigation
  const prevPeriod = () => {
    if (view === 'month') {
      if (month === 0) { setMonth(11); setYear(y => y - 1) } else setMonth(m => m - 1)
    } else if (view === 'week') {
      setSelectedDate(d => addDays(d, -7))
    } else {
      setSelectedDate(d => addDays(d, -1))
    }
  }
  const nextPeriod = () => {
    if (view === 'month') {
      if (month === 11) { setMonth(0); setYear(y => y + 1) } else setMonth(m => m + 1)
    } else if (view === 'week') {
      setSelectedDate(d => addDays(d, 7))
    } else {
      setSelectedDate(d => addDays(d, 1))
    }
  }
  const goToday = () => {
    const now = new Date()
    setYear(now.getFullYear()); setMonth(now.getMonth()); setSelectedDate(now)
  }

  const periodLabel = () => {
    if (view === 'month') return `${MONTH_NAMES[month]} ${year}`
    if (view === 'week') {
      const ws = getWeekStart(selectedDate)
      const we = addDays(ws, 6)
      return `${ws.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${we.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
    }
    if (view === 'day') {
      return selectedDate.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    }
    return 'Agenda'
  }

  // Week days
  const weekDays = useMemo(() => {
    const ws = getWeekStart(selectedDate)
    return Array.from({ length: 7 }, (_, i) => addDays(ws, i))
  }, [selectedDate])

  const VIEW_ICONS = {
    month:  <CalendarDays size={13} />,
    week:   <CalendarRange size={13} />,
    day:    <Calendar size={13} />,
    agenda: <List size={13} />,
  }

  return (
    <div className="flex h-full bg-bg text-ink overflow-hidden" style={{ fontFamily: 'var(--font-sans)' }}>
      {(() => {
        const addCalendar = (name) => setCalendars(prev => [
          ...prev,
          { id: name.toLowerCase().replace(/\s+/g, '-'), name, color: EVENT_COLORS[prev.length % EVENT_COLORS.length], visible: true },
        ])
        const sidebarBody = (
          <>
            <MiniMonthNav
              year={year} month={month}
              onPrev={prevPeriod} onNext={nextPeriod}
              onDayClick={d => { setSelectedDate(d); setYear(d.getFullYear()); setMonth(d.getMonth()); setMobileNav(false) }}
              today={today} selectedDate={selectedDate}
            />
            <CalendarsSidebar
              calendars={calendars}
              onToggle={toggleCalendar}
              onAdd={addCalendar}
              onExport={exportCalendar}
            />
          </>
        )
        return (
          <>
            {/* Sidebar — fixed rail ≥lg */}
            <div className="hidden lg:flex flex-col w-52 flex-shrink-0 border-r border-line">
              {sidebarBody}
            </div>

            {/* Sidebar — off-canvas drawer <lg */}
            {mobileNav && (
              <div className="fixed inset-0 z-40 lg:hidden">
                <div
                  className="absolute inset-0 bg-black/40 animate-fade-in"
                  onClick={() => setMobileNav(false)}
                  aria-hidden
                />
                <div className="absolute left-0 top-0 bottom-0 w-64 max-w-[80vw] bg-bg-elev-1 border-r border-line shadow-e3 flex flex-col overflow-y-auto animate-slide-in-right">
                  <div className="flex items-center justify-between px-3 h-12 border-b border-line flex-shrink-0">
                    <span className="text-sm font-semibold text-ink">Calendar</span>
                    <IconButton size="sm" onClick={() => setMobileNav(false)} title="Close menu">
                      <X size={15} />
                    </IconButton>
                  </div>
                  {sidebarBody}
                </div>
              </div>
            )}
          </>
        )
      })()}

      {/* Main */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-2 sm:py-2.5 border-b border-line flex-shrink-0 bg-bg-elev-1">
          <IconButton size="sm" className="lg:hidden" onClick={() => setMobileNav(true)} title="Open menu">
            <Menu size={16} />
          </IconButton>
          <Button size="sm" onClick={goToday}>Today</Button>
          <IconButton size="sm" onClick={prevPeriod} title="Previous"><ChevronLeft size={16} /></IconButton>
          <IconButton size="sm" onClick={nextPeriod} title="Next"><ChevronRight size={16} /></IconButton>
          <span className="text-sm font-semibold text-ink flex-1 min-w-0 truncate">{periodLabel()}</span>

          {/* View switcher */}
          <div className="flex items-center rounded-md border border-line overflow-hidden flex-shrink-0">
            {['month','week','day','agenda'].map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                title={`${v} view (${v[0]})`}
                aria-pressed={view === v}
                className={[
                  'flex items-center gap-1 px-2.5 h-8 text-xs transition-colors',
                  view === v ? 'bg-accent text-white' : 'text-ink-muted hover:bg-bg-elev-2',
                ].join(' ')}
              >
                {VIEW_ICONS[v]}
                <span className="hidden md:inline capitalize">{v}</span>
              </button>
            ))}
          </div>

          <Button size="sm" variant="primary" onClick={() => openNewEvent(selectedDate)} className="flex-shrink-0">
            <Plus size={13} />
            <span className="hidden sm:inline">New event</span>
          </Button>

          <IconButton size="sm" onClick={load} title="Refresh"><RefreshCw size={14} /></IconButton>
        </div>

        {/* Error — inline, dismissible, announced to assistive tech */}
        <div role="alert" aria-live="assertive">
          {error && (
            <div className="mx-4 mt-2 px-3.5 py-2.5 rounded-lg bg-danger-bg text-danger text-sm flex items-start gap-2.5 animate-fade-in">
              <AlertCircle size={15} className="flex-shrink-0 mt-px" />
              <span className="flex-1 min-w-0">{error}</span>
              <button
                onClick={() => setError(null)}
                className="text-xs underline underline-offset-2 hover:no-underline flex-shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>

        {loading ? (
          <LoadingState label="Loading your calendar…" />
        ) : (
          <div className="flex flex-col flex-1 overflow-hidden">
            {view === 'month' && (
              <MonthView
                year={year} month={month} events={events}
                calendars={calendars} today={today}
                onDayClick={openNewEvent}
                onEventClick={ev => { setEditingEvent(ev); setShowModal(true) }}
              />
            )}
            {view === 'week' && (
              <TimelineView
                days={weekDays} events={events} calendars={calendars}
                onSlotClick={openNewEvent}
                onEventClick={ev => { setEditingEvent(ev); setShowModal(true) }}
              />
            )}
            {view === 'day' && (
              <TimelineView
                days={[selectedDate]} events={events} calendars={calendars}
                onSlotClick={openNewEvent}
                onEventClick={ev => { setEditingEvent(ev); setShowModal(true) }}
              />
            )}
            {view === 'agenda' && (
              <AgendaView
                events={events} calendars={calendars} today={today}
                onEventClick={ev => { setEditingEvent(ev); setShowModal(true) }}
              />
            )}
          </div>
        )}
      </div>

      {/* Event modal */}
      {showModal && (
        <EventModal
          event={editingEvent}
          calendars={calendars}
          contacts={contacts}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditingEvent(null) }}
          onDelete={handleDelete}
        />
      )}
    </div>
  )
}
