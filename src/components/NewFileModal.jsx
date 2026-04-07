import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, FileText, Table2, Presentation } from 'lucide-react'
import { useFilesStore } from '../store/filesStore'

const TYPES = [
  { type: 'doc', label: 'Document', icon: FileText, desc: 'Rich text with images, tables & more', color: 'text-indigo-600 bg-indigo-50 border-indigo-200' },
  { type: 'sheet', label: 'Spreadsheet', icon: Table2, desc: 'Formulas, charts & data', color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  { type: 'slide', label: 'Presentation', icon: Presentation, desc: 'Slides with themes & transitions', color: 'text-amber-600 bg-amber-50 border-amber-200' },
]

const ROUTE = { doc: 'docs', sheet: 'sheets', slide: 'slides' }

// lockType: if provided, skip the type picker and always use that type
export default function NewFileModal({ onClose, defaultType, lockType }) {
  const [selectedType, setSelectedType] = useState(lockType || defaultType || 'doc')
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const { createFile } = useFilesStore()
  const navigate = useNavigate()

  const selected = TYPES.find(t => t.type === selectedType)

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!name.trim() || creating) return
    setCreating(true)
    try {
      const file = await createFile(name.trim(), selectedType)
      onClose()
      navigate(`/${ROUTE[selectedType]}/${file.id}`)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            {selected && <selected.icon size={18} className={selected.color.split(' ')[0]} />}
            <h2 className="text-base font-semibold text-gray-900">
              {lockType ? `New ${selected?.label}` : 'New File'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition">
            <X size={17} />
          </button>
        </div>

        <form onSubmit={handleCreate} className="p-5 space-y-4">
          {/* Type picker — only shown when not locked */}
          {!lockType && (
            <>
              <div className="grid grid-cols-3 gap-2.5">
                {TYPES.map(({ type, label, icon: Icon, color }) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setSelectedType(type)}
                    className={`flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all ${
                      selectedType === type
                        ? color + ' border-current shadow-sm'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <Icon size={20} />
                    <span className="text-xs font-semibold">{label}</span>
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400 text-center">{selected?.desc}</p>
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              placeholder={`Untitled ${selected?.label}`}
              autoFocus
            />
          </div>

          <div className="flex gap-2.5 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-50 transition">
              Cancel
            </button>
            <button type="submit" disabled={!name.trim() || creating}
              className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition">
              {creating ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
