const BASE = '/api'

async function request(path, options = {}) {
  const token = localStorage.getItem('session_token')
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(BASE + path, { ...options, headers })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw Object.assign(new Error(err.error || 'Request failed'), err)
  }
  return res.json()
}

export const api = {
  authStatus: () => request('/auth/status'),
  login: (password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),
  logout: () =>
    request('/auth/logout', { method: 'POST' }),

  listFiles: () => request('/files'),
  getFile: (id) => request(`/files/${id}`),
  createFile: (name, type, content) =>
    request('/files', { method: 'POST', body: JSON.stringify({ name, type, content }) }),
  updateFile: (id, name, content) =>
    request(`/files/${id}`, { method: 'PUT', body: JSON.stringify({ name, content }) }),
  deleteFile: (id) =>
    request(`/files/${id}`, { method: 'DELETE' }),

  scanLocalFiles: () => request('/local-files'),
  localFileUrl: (path) => `${BASE}/local-files/serve?path=${encodeURIComponent(path)}`,

  uploadImage: async (file) => {
    const token = localStorage.getItem('session_token')
    const form = new FormData()
    form.append('file', file)
    const headers = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await fetch(BASE + '/upload', { method: 'POST', headers, body: form })
    if (!res.ok) throw new Error('Upload failed')
    return res.json()
  },
}
