import { create } from 'zustand'
import { api } from '../lib/api'

export const useAuthStore = create((set) => ({
  status: null,
  loading: true,
  error: null,
  remainingAttempts: null,

  fetchStatus: async () => {
    try {
      const status = await api.authStatus()
      set({ status, loading: false })
    } catch {
      set({ status: { enabled: false, authenticated: true }, loading: false })
    }
  },

  login: async (password) => {
    set({ error: null, remainingAttempts: null })
    try {
      const res = await api.login(password)
      if (res.token) localStorage.setItem('session_token', res.token)
      set({ status: { enabled: true, authenticated: true }, error: null })
    } catch (err) {
      set({ error: err.error || 'Login failed', remainingAttempts: err.remaining_attempts ?? null })
      throw err
    }
  },

  logout: async () => {
    try { await api.logout() } catch { /* ignore */ }
    localStorage.removeItem('session_token')
    set({ status: { enabled: true, authenticated: false }, error: null })
  },
}))
