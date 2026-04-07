import { create } from 'zustand'
import { api } from '../lib/api'

function defaultContent(type) {
  switch (type) {
    case 'doc':
      return { type: 'doc', content: [{ type: 'paragraph' }] }
    case 'sheet':
      return [{ name: 'Sheet1', celldata: [], config: {} }]
    case 'slide':
      return { theme: 'black', transition: 'slide', slides: [{ id: crypto.randomUUID(), title: '', content: '<p></p>', notes: '' }] }
    default:
      return null
  }
}

export const useFilesStore = create((set, get) => ({
  files: [],
  loading: false,

  fetchFiles: async () => {
    set({ loading: true })
    try {
      const files = await api.listFiles()
      set({ files, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  createFile: async (name, type) => {
    const file = await api.createFile(name, type, defaultContent(type))
    set({ files: [file, ...get().files] })
    return file
  },

  updateFile: async (id, name, content) => {
    const file = await api.updateFile(id, name, content)
    set({ files: get().files.map((f) => (f.id === id ? file : f)) })
    return file
  },

  deleteFile: async (id) => {
    await api.deleteFile(id)
    set({ files: get().files.filter((f) => f.id !== id) })
  },

  renameFile: async (id, name) => {
    const file = get().files.find((f) => f.id === id)
    if (file) await get().updateFile(id, name, file.content)
  },
}))
