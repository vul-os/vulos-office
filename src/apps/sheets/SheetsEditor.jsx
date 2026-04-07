import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Workbook } from '@fortune-sheet/react'
import '@fortune-sheet/react/dist/index.css'
import { ArrowLeft, Save, Loader2, Download } from 'lucide-react'
import { useFilesStore } from '../../store/filesStore'
import { api } from '../../lib/api'
import { exportSheetsToXlsx, exportSheetsToCsv } from './sheetsExport'

export default function SheetsEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { files, updateFile } = useFilesStore()
  const [file, setFile] = useState(files.find((f) => f.id === id))
  const [title, setTitle] = useState(file?.name || 'Untitled Sheet')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(true)
  const [data, setData] = useState(file?.content || [{ name: 'Sheet1', celldata: [], config: {} }])
  const workbookRef = useRef(null)
  const saveTimer = useRef(null)

  useEffect(() => {
    if (!file && id) {
      api.getFile(id).then((f) => {
        setFile(f)
        setTitle(f.name)
        setData(f.content || [{ name: 'Sheet1', celldata: [], config: {} }])
      }).catch(() => navigate('/'))
    }
  }, [id])

  const autosave = useCallback(async (currentData) => {
    if (!id) return
    setSaving(true)
    try {
      await updateFile(id, title, currentData)
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }, [id, title])

  const handleChange = (newData) => {
    setData(newData)
    setSaved(false)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => autosave(newData), 3000)
  }

  const handleSave = () => {
    clearTimeout(saveTimer.current)
    autosave(data)
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-200 bg-white flex-shrink-0">
        <button onClick={() => navigate('/')} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition">
          <ArrowLeft size={18} />
        </button>
        <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center flex-shrink-0">
          <svg viewBox="0 0 24 24" className="w-4 h-4 text-emerald-600 fill-current"><path d="M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zm-8 14H7v-2h4v2zm0-4H7v-2h4v2zm0-4H7V7h4v2zm6 8h-4v-2h4v2zm0-4h-4v-2h4v2zm0-4h-4V7h4v2z"/></svg>
        </div>
        <input
          value={title}
          onChange={(e) => { setTitle(e.target.value); setSaved(false) }}
          className="flex-1 text-base font-semibold text-gray-900 bg-transparent border-none outline-none hover:bg-gray-50 focus:bg-gray-50 rounded px-2 py-0.5"
          placeholder="Untitled Sheet"
        />
        <span className="text-xs text-gray-400 hidden sm:block">{saving ? 'Saving…' : saved ? 'Saved' : 'Unsaved'}</span>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-60 transition"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save
        </button>
        <div className="relative group">
          <button className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition">
            <Download size={14} /> Export ▾
          </button>
          <div className="absolute right-0 top-full mt-1 w-40 bg-white border border-gray-200 rounded-xl shadow-xl z-30 py-1 text-sm hidden group-hover:block">
            <button onClick={() => exportSheetsToXlsx(data, title)} className="w-full text-left px-3 py-2 hover:bg-gray-50 text-gray-700">Excel (.xlsx)</button>
            <button onClick={() => exportSheetsToCsv(data, title)} className="w-full text-left px-3 py-2 hover:bg-gray-50 text-gray-700">CSV (.csv)</button>
          </div>
        </div>
      </div>

      {/* Workbook */}
      <div className="flex-1 overflow-hidden">
        <Workbook
          ref={workbookRef}
          data={data}
          onChange={handleChange}
        />
      </div>
    </div>
  )
}
