import { useState } from 'react'
import { Lock, Eye, EyeOff, AlertCircle, Shield } from 'lucide-react'
import { useAuthStore } from '../store/authStore'

export default function LoginScreen() {
  const { login, error, remainingAttempts } = useAuthStore()
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!password || loading) return
    setLoading(true)
    try { await login(password) } catch { /* error in store */ }
    finally { setLoading(false); setPassword('') }
  }

  return (
    <div className="h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900">
      <div
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage: 'linear-gradient(rgba(99,102,241,0.3) 1px,transparent 1px),linear-gradient(90deg,rgba(99,102,241,0.3) 1px,transparent 1px)',
          backgroundSize: '50px 50px',
        }}
      />
      <div className="relative w-full max-w-sm mx-4">
        <div className="bg-white/95 backdrop-blur rounded-2xl shadow-2xl p-8">
          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-indigo-500/30">
              <Shield size={28} className="text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Vulos Office</h1>
            <p className="text-sm text-gray-500 mt-1">Enter your password to continue</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type={show ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-10 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder="Enter password"
                  autoFocus
                />
                <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                <div>
                  <p>{error}</p>
                  {remainingAttempts !== null && remainingAttempts > 0 && (
                    <p className="mt-0.5 text-red-500">{remainingAttempts} attempt{remainingAttempts !== 1 ? 's' : ''} remaining</p>
                  )}
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={!password || loading}
              className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition shadow-md"
            >
              {loading
                ? <span className="flex items-center justify-center gap-2"><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Signing in…</span>
                : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
