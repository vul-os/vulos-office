/**
 * ContactsApp — List + detail view with CardDAV CRUD.
 *
 * Feature flag: VITE_FF_CONTACTS=1 (defaults to enabled in this build).
 * Marked (beta) in the sidebar.
 *
 * CardDAV endpoint: configured via VITE_CARDDAV_BASE (defaults to /dav/addressbooks).
 * Auth: Basic auth using the same email+app-password as JMAP.
 * Constraints: JSX never .tsx. No Google SSO. Pure Vulos identity.
 */

import { useState, useEffect, useCallback } from 'react'
import { Users, Plus, Search, X, Edit2, Trash2, ChevronRight, User } from 'lucide-react'
import { useAuthStore } from '../../store/authStore'

const CARDDAV_BASE = import.meta.env.VITE_CARDDAV_BASE || '/dav/addressbooks'
const COLLECTION = 'contacts'

// ──────────────────────────────────────────────────────────────────────────────
// CardDAV API helpers
// ──────────────────────────────────────────────────────────────────────────────

function davHeaders(credentials) {
  const basic = btoa(`${credentials.email}:${credentials.appPassword}`)
  return {
    'Authorization': `Basic ${basic}`,
    'Content-Type': 'text/vcard; charset=utf-8',
  }
}

function buildVCF(contact) {
  const lines = [
    'BEGIN:VCARD',
    'VERSION:4.0',
    `UID:${contact.uid}`,
    `FN:${contact.fullName || ''}`,
  ]
  if (contact.email) lines.push(`EMAIL:${contact.email}`)
  if (contact.phone) lines.push(`TEL:${contact.phone}`)
  if (contact.org) lines.push(`ORG:${contact.org}`)
  if (contact.note) lines.push(`NOTE:${contact.note}`)
  lines.push('END:VCARD', '')
  return lines.join('\r\n')
}

function parseVCF(vcf, uid) {
  const get = (key) => {
    const m = vcf.match(new RegExp(`^${key}[^:]*:(.+)`, 'm'))
    return m ? m[1].trim() : ''
  }
  return {
    uid: get('UID') || uid,
    fullName: get('FN'),
    email: get('EMAIL'),
    phone: get('TEL'),
    org: get('ORG'),
    note: get('NOTE'),
    raw: vcf,
  }
}

async function fetchContacts(accountID, credentials) {
  const collURL = `${CARDDAV_BASE}/${accountID}/${COLLECTION}/`
  const headers = davHeaders(credentials)

  const propfind = await fetch(collURL, {
    method: 'PROPFIND',
    headers: { ...headers, 'Depth': '1' },
    body: `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop><D:getetag/><D:getcontenttype/></D:prop>
</D:propfind>`,
  })

  if (!propfind.ok && propfind.status !== 207) {
    throw new Error(`CardDAV PROPFIND failed: ${propfind.status}`)
  }

  const xmlText = await propfind.text()
  const hrefMatches = [...xmlText.matchAll(/<[^>]*:href[^>]*>([^<]+\.vcf)<\/[^>]*:href>/g)]
  const hrefs = hrefMatches.map(m => m[1])

  const contacts = []
  await Promise.all(hrefs.map(async (href) => {
    const r = await fetch(href, { headers })
    if (r.ok) {
      const vcf = await r.text()
      const uid = href.split('/').pop().replace('.vcf', '')
      contacts.push(parseVCF(vcf, uid))
    }
  }))
  return contacts.sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''))
}

async function putContact(accountID, credentials, contact) {
  const url = `${CARDDAV_BASE}/${accountID}/${COLLECTION}/${contact.uid}.vcf`
  const r = await fetch(url, {
    method: 'PUT',
    headers: davHeaders(credentials),
    body: buildVCF(contact),
  })
  if (!r.ok && r.status !== 201 && r.status !== 204) {
    throw new Error(`CardDAV PUT failed: ${r.status}`)
  }
}

async function deleteContact(accountID, credentials, uid) {
  const url = `${CARDDAV_BASE}/${accountID}/${COLLECTION}/${uid}.vcf`
  const r = await fetch(url, {
    method: 'DELETE',
    headers: davHeaders(credentials),
  })
  if (!r.ok && r.status !== 204) {
    throw new Error(`CardDAV DELETE failed: ${r.status}`)
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// ContactForm — create / edit
// ──────────────────────────────────────────────────────────────────────────────

function ContactForm({ contact, onSave, onClose }) {
  const [fullName, setFullName] = useState(contact?.fullName || '')
  const [email, setEmail] = useState(contact?.email || '')
  const [phone, setPhone] = useState(contact?.phone || '')
  const [org, setOrg] = useState(contact?.org || '')
  const [note, setNote] = useState(contact?.note || '')

  const handleSave = (e) => {
    e.preventDefault()
    if (!fullName.trim()) return
    onSave({
      uid: contact?.uid || crypto.randomUUID(),
      fullName: fullName.trim(),
      email: email.trim(),
      phone: phone.trim(),
      org: org.trim(),
      note: note.trim(),
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
        <button type="button" onClick={onClose}
          className="absolute top-4 right-4 text-ink-faint hover:text-ink">
          <X size={16} />
        </button>
        <h2 className="text-base font-semibold text-ink mb-4">
          {contact ? 'Edit contact' : 'New contact'}
        </h2>
        <div className="space-y-3">
          {[
            { label: 'Full name *', value: fullName, set: setFullName, placeholder: 'Alice Wonderland', required: true },
            { label: 'Email', value: email, set: setEmail, placeholder: 'alice@example.com', type: 'email' },
            { label: 'Phone', value: phone, set: setPhone, placeholder: '+1 555 000 0000', type: 'tel' },
            { label: 'Organisation', value: org, set: setOrg, placeholder: 'Acme Corp' },
          ].map(f => (
            <div key={f.label}>
              <label className="block text-xs text-ink-faint mb-1">{f.label}</label>
              <input
                type={f.type || 'text'}
                placeholder={f.placeholder}
                value={f.value}
                onChange={e => f.set(e.target.value)}
                required={f.required}
                className="w-full px-3 py-2 rounded-md border border-line bg-bg text-ink text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>
          ))}
          <div>
            <label className="block text-xs text-ink-faint mb-1">Note</label>
            <textarea
              placeholder="Notes…"
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 rounded-md border border-line bg-bg text-ink text-sm resize-none focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={onClose}
            className="px-4 py-1.5 rounded-md text-sm text-ink-muted hover:bg-bg-elev-2 transition-colors">
            Cancel
          </button>
          <button type="submit"
            className="px-4 py-1.5 rounded-md text-sm text-white bg-accent hover:bg-accent-hover transition-colors">
            Save
          </button>
        </div>
      </form>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// ContactDetail
// ──────────────────────────────────────────────────────────────────────────────

function ContactDetail({ contact, onEdit, onDelete }) {
  if (!contact) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-ink-faint gap-2">
        <User size={32} strokeWidth={1} />
        <p className="text-sm">Select a contact</p>
      </div>
    )
  }

  return (
    <div className="p-6" style={{ fontFamily: 'var(--font-sans)' }}>
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-accent-tint flex items-center justify-center">
            <span className="text-lg font-semibold text-accent">
              {(contact.fullName || '?')[0].toUpperCase()}
            </span>
          </div>
          <div>
            <h2 className="text-base font-semibold text-ink">{contact.fullName}</h2>
            {contact.org && <p className="text-xs text-ink-muted">{contact.org}</p>}
          </div>
        </div>
        <div className="flex gap-1.5">
          <button onClick={() => onEdit(contact)}
            className="p-1.5 rounded text-ink-faint hover:text-ink hover:bg-bg-elev-2" title="Edit">
            <Edit2 size={14} />
          </button>
          <button onClick={() => onDelete(contact.uid)}
            className="p-1.5 rounded text-ink-faint hover:text-signal-error hover:bg-signal-error-bg" title="Delete">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {contact.email && (
          <Field label="Email">
            <a href={`mailto:${contact.email}`} className="text-accent hover:underline">{contact.email}</a>
          </Field>
        )}
        {contact.phone && (
          <Field label="Phone">
            <a href={`tel:${contact.phone}`} className="text-ink">{contact.phone}</a>
          </Field>
        )}
        {contact.org && <Field label="Organisation"><span className="text-ink">{contact.org}</span></Field>}
        {contact.note && <Field label="Note"><span className="text-ink-muted whitespace-pre-wrap">{contact.note}</span></Field>}
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <p className="text-xs text-ink-faint mb-0.5">{label}</p>
      <p className="text-sm">{children}</p>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Main ContactsApp
// ──────────────────────────────────────────────────────────────────────────────

export default function ContactsApp() {
  const { status } = useAuthStore()
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [editingContact, setEditingContact] = useState(null)

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
      const list = await fetchContacts(accountID, credentials)
      setContacts(list)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [accountID, credentials.email])

  useEffect(() => { load() }, [load])

  const handleSave = async (contactData) => {
    try {
      await putContact(accountID, credentials, contactData)
      setShowForm(false)
      setEditingContact(null)
      await load()
      setSelected(contactData)
    } catch (e) {
      setError(e.message)
    }
  }

  const handleDelete = async (uid) => {
    if (!confirm('Delete this contact?')) return
    try {
      await deleteContact(accountID, credentials, uid)
      if (selected?.uid === uid) setSelected(null)
      await load()
    } catch (e) {
      setError(e.message)
    }
  }

  const filtered = contacts.filter(c =>
    !search || [c.fullName, c.email, c.org]
      .filter(Boolean)
      .some(v => v.toLowerCase().includes(search.toLowerCase()))
  )

  // Group by first letter
  const grouped = {}
  for (const c of filtered) {
    const letter = (c.fullName || '#')[0].toUpperCase()
    const key = /[A-Z]/.test(letter) ? letter : '#'
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(c)
  }
  const groupKeys = Object.keys(grouped).sort()

  return (
    <div className="flex h-full bg-bg text-ink" style={{ fontFamily: 'var(--font-sans)' }}>
      {/* Left panel: list */}
      <div className="w-72 flex flex-col border-r border-line flex-shrink-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <div className="flex items-center gap-2">
            <Users size={15} className="text-accent" />
            <span className="text-sm font-semibold text-ink">Contacts</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-accent-tint text-accent font-medium">beta</span>
          </div>
          <button
            onClick={() => { setEditingContact(null); setShowForm(true) }}
            className="p-1 rounded text-accent hover:bg-accent-tint"
            title="New contact"
          >
            <Plus size={14} />
          </button>
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b border-line">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-bg-elev-2 border border-line">
            <Search size={12} className="text-ink-faint flex-shrink-0" />
            <input
              type="text"
              placeholder="Search contacts…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 text-xs bg-transparent text-ink outline-none placeholder:text-ink-faint"
            />
            {search && (
              <button onClick={() => setSearch('')} className="text-ink-faint hover:text-ink">
                <X size={10} />
              </button>
            )}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-24">
              <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-6 text-xs text-ink-faint text-center">
              {search ? 'No matching contacts.' : 'No contacts yet.'}
            </div>
          ) : groupKeys.map(key => (
            <div key={key}>
              <div className="px-4 py-1 text-xs font-semibold text-ink-faint bg-bg-elev-2 border-b border-line sticky top-0">
                {key}
              </div>
              {grouped[key].map(c => (
                <button
                  key={c.uid}
                  onClick={() => setSelected(c)}
                  className={[
                    'w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-accent-tint/40 transition-colors',
                    selected?.uid === c.uid ? 'bg-accent-tint border-r-2 border-accent' : '',
                  ].join(' ')}
                >
                  <div className="w-7 h-7 rounded-full bg-accent-tint flex-shrink-0 flex items-center justify-center">
                    <span className="text-xs font-semibold text-accent">
                      {(c.fullName || '?')[0].toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-ink truncate">{c.fullName}</p>
                    {c.email && <p className="text-xs text-ink-faint truncate">{c.email}</p>}
                  </div>
                  <ChevronRight size={12} className="text-ink-faint ml-auto flex-shrink-0" />
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Right panel: detail */}
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="m-4 px-4 py-3 rounded-lg bg-signal-error-bg text-signal-error text-sm">
            {error}
            <button onClick={() => setError(null)} className="ml-2 underline">dismiss</button>
          </div>
        )}
        <ContactDetail
          contact={selected}
          onEdit={(c) => { setEditingContact(c); setShowForm(true) }}
          onDelete={handleDelete}
        />
      </div>

      {showForm && (
        <ContactForm
          contact={editingContact}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditingContact(null) }}
        />
      )}
    </div>
  )
}
