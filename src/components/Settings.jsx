import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Save, Shield, Database, HardDrive,
  Eye, EyeOff, CheckCircle2, AlertCircle, Loader2,
} from 'lucide-react'
import { useAuthStore } from '../store/authStore'

function Section({ title, icon: Icon, children }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-gray-100 bg-gray-50">
        <Icon size={15} className="text-gray-500" />
        <h2 className="text-sm font-semibold text-gray-700">{title}</h2>
      </div>
      <div className="divide-y divide-gray-50">{children}</div>
    </div>
  )
}

function Row({ label, hint, children }) {
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-4">
      <div>
        <p className="text-sm font-medium text-gray-800">{label}</p>
        {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  )
}

export default function Settings() {
  const navigate = useNavigate()
  const { status } = useAuthStore()

  // Auth settings (local state only — shows current config values read from status)
  const [showPassword, setShowPassword] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)

  // App preferences stored in localStorage
  const [autosaveDelay, setAutosaveDelay] = useState(() =>
    parseInt(localStorage.getItem('vulos_autosave_delay') ?? '2000')
  )
  const [spellcheck, setSpellcheck] = useState(() =>
    localStorage.getItem('vulos_spellcheck') !== 'false'
  )
  const [defaultView, setDefaultView] = useState(() =>
    localStorage.getItem('vulos_default_view') ?? 'grid'
  )

  const showToast = (msg, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 2800)
  }

  const savePrefs = () => {
    localStorage.setItem('vulos_autosave_delay', autosaveDelay)
    localStorage.setItem('vulos_spellcheck', spellcheck)
    localStorage.setItem('vulos_default_view', defaultView)
    showToast('Preferences saved')
  }

  const changePassword = async () => {
    if (!newPassword.trim()) return
    setSaving(true)
    try {
      const token = localStorage.getItem('session_token')
      const res = await fetch('/api/auth/password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ password: newPassword }),
      })
      if (res.ok) {
        setNewPassword('')
        showToast('Password updated — restart the server to apply')
      } else {
        const { error } = await res.json().catch(() => ({}))
        showToast(error || 'Failed to update password', false)
      }
    } catch {
      showToast('Server unreachable', false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex-1 overflow-auto bg-gray-50">
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition">
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-sm font-bold text-gray-900">Settings</h1>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">

        {/* Preferences */}
        <Section title="Preferences" icon={HardDrive}>
          <Row label="Autosave delay" hint="How long after typing before changes are saved automatically">
            <select
              value={autosaveDelay}
              onChange={e => setAutosaveDelay(Number(e.target.value))}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
            >
              <option value={1000}>1 second</option>
              <option value={2000}>2 seconds</option>
              <option value={3000}>3 seconds</option>
              <option value={5000}>5 seconds</option>
            </select>
          </Row>
          <Row label="Spell check" hint="Enable browser spell checking in document editors">
            <button
              onClick={() => setSpellcheck(v => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${spellcheck ? 'bg-indigo-600' : 'bg-gray-200'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${spellcheck ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </Row>
          <Row label="Default file view" hint="Grid or list view on app home pages">
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
              {['grid', 'list'].map(v => (
                <button key={v} onClick={() => setDefaultView(v)}
                  className={`px-3 py-1 rounded-md text-sm font-medium transition capitalize ${defaultView === v ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}
                >{v}</button>
              ))}
            </div>
          </Row>
          <div className="px-5 py-3 flex justify-end border-t border-gray-50">
            <button onClick={savePrefs}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition"
            >
              <Save size={13} /> Save Preferences
            </button>
          </div>
        </Section>

        {/* Security */}
        <Section title="Security" icon={Shield}>
          {status?.enabled ? (
            <>
              <Row label="Login protection" hint="Password authentication is currently enabled">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full">
                  <CheckCircle2 size={12} /> Enabled
                </span>
              </Row>
              <Row label="Change password" hint="Updates config.yaml — requires server restart to take effect">
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      placeholder="New password"
                      className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 pr-8 focus:outline-none focus:ring-2 focus:ring-indigo-400 w-44"
                    />
                    <button onClick={() => setShowPassword(v => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                  <button
                    onClick={changePassword}
                    disabled={!newPassword.trim() || saving}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition"
                  >
                    {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                    Update
                  </button>
                </div>
              </Row>
            </>
          ) : (
            <Row label="Login protection" hint="Enable via config.yaml: set auth.enabled: true">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">
                <AlertCircle size={12} /> Disabled
              </span>
            </Row>
          )}
        </Section>

        {/* Storage */}
        <Section title="Storage" icon={Database}>
          <Row label="Storage backend" hint="Configured in config.yaml">
            <span className="text-sm font-mono bg-gray-100 text-gray-700 px-3 py-1 rounded-lg">
              local files
            </span>
          </Row>
          <Row label="Data directory" hint="Where your files are saved on disk">
            <span className="text-sm font-mono bg-gray-100 text-gray-700 px-3 py-1 rounded-lg">
              ./data/
            </span>
          </Row>
        </Section>

        {/* About */}
        <div className="text-center text-xs text-gray-400 pb-4">
          Vulos Office — open source local-first office suite
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium text-white transition ${toast.ok ? 'bg-gray-900' : 'bg-red-600'}`}>
          {toast.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
          {toast.msg}
        </div>
      )}
    </div>
  )
}
