import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FileText, Table2, Presentation, FileSearch, Clock,
  ArrowUpRight, FolderSearch, HardDrive, RefreshCw, Loader2, Plus,
} from 'lucide-react'
import { useFilesStore } from '../store/filesStore'
import { useLocalFilesStore } from '../store/localFilesStore'
import { importFromUrl } from '../lib/importFile'
import NewFileModal from './NewFileModal'

const typeInfo = {
  doc:   { icon: FileText,     color: 'text-indigo-500',  bg: 'bg-indigo-50',  route: 'docs'   },
  sheet: { icon: Table2,       color: 'text-emerald-500', bg: 'bg-emerald-50', route: 'sheets' },
  slide: { icon: Presentation, color: 'text-amber-500',   bg: 'bg-amber-50',   route: 'slides' },
}

const localTypeInfo = {
  doc:   { icon: FileText,     color: 'text-indigo-500',  bg: 'bg-indigo-50',  label: 'Document'     },
  sheet: { icon: Table2,       color: 'text-emerald-500', bg: 'bg-emerald-50', label: 'Spreadsheet'  },
  slide: { icon: Presentation, color: 'text-amber-500',   bg: 'bg-amber-50',   label: 'Presentation' },
  pdf:   { icon: FileSearch,   color: 'text-rose-500',    bg: 'bg-rose-50',    label: 'PDF'          },
}

function formatDate(ms) {
  const diff = Date.now() - ms
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

async function openLocalFile(file, navigate, setImporting) {
  setImporting(file.path)
  try {
    await importFromUrl(file, navigate)
  } catch (e) {
    console.error(e)
    alert(`Could not open ${file.name}: ${e.message}`)
  } finally {
    setImporting(null)
  }
}

export default function Home() {
  const navigate = useNavigate()
  const { files, loading: filesLoading, fetchFiles } = useFilesStore()
  const { files: localFiles, loading: localLoading, scanned, scan } = useLocalFilesStore()
  const [showLocalAll, setShowLocalAll] = useState(false)
  const [importing, setImporting] = useState(null)
  const [showNew, setShowNew] = useState(false)

  useEffect(() => { fetchFiles() }, [])
  useEffect(() => { if (!scanned) scan() }, [scanned])

  const recentFiles = files.filter(f => typeInfo[f.type]).slice(0, 12)
  const visibleLocal = showLocalAll ? localFiles : localFiles.slice(0, 8)

  return (
    <div className="flex-1 overflow-auto bg-gray-50">
      <div className="max-w-4xl mx-auto px-8 py-10">

        {/* New file shortcut bar */}
        <div className="flex items-center gap-3 mb-10">
          {[
            { label: 'New Document',     icon: FileText,     color: 'bg-indigo-600 hover:bg-indigo-700', type: 'doc'   },
            { label: 'New Spreadsheet',  icon: Table2,       color: 'bg-emerald-600 hover:bg-emerald-700', type: 'sheet' },
            { label: 'New Presentation', icon: Presentation, color: 'bg-amber-500 hover:bg-amber-600',   type: 'slide' },
          ].map(({ label, icon: Icon, color, type }) => (
            <button key={type} onClick={() => setShowNew(true)}
              className={`flex items-center gap-2 px-4 py-2 ${color} text-white rounded-xl text-sm font-semibold shadow-sm transition`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        {/* Recent activity */}
        {recentFiles.length > 0 && (
          <section className="mb-10">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Recent</h2>
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              {recentFiles.map((file, i) => {
                const info = typeInfo[file.type]
                const Icon = info.icon
                return (
                  <button key={file.id} onClick={() => navigate(`/${info.route}/${file.id}`)}
                    className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition text-left ${i < recentFiles.length - 1 ? 'border-b border-gray-50' : ''}`}
                  >
                    <div className={`w-8 h-8 ${info.bg} rounded-lg flex items-center justify-center flex-shrink-0`}>
                      <Icon size={14} className={info.color} />
                    </div>
                    <span className="text-sm font-medium text-gray-900 flex-1 truncate">{file.name}</span>
                    <span className="text-xs text-gray-400 flex items-center gap-1 flex-shrink-0">
                      <Clock size={10} />{formatDate(new Date(file.updated_at).getTime())}
                    </span>
                    <ArrowUpRight size={13} className="text-gray-300 flex-shrink-0" />
                  </button>
                )
              })}
            </div>
          </section>
        )}

        {/* Local files from disk */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <HardDrive size={14} className="text-gray-400" />
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">On Your Computer</h2>
              {localFiles.length > 0 && (
                <span className="text-[10px] text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">{localFiles.length} files</span>
              )}
            </div>
            <button onClick={() => scan()}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition"
            >
              <RefreshCw size={12} className={localLoading ? 'animate-spin' : ''} />
              {localLoading ? 'Scanning…' : 'Rescan'}
            </button>
          </div>

          {localLoading && !scanned && (
            <div className="bg-white rounded-xl border border-gray-200 p-6 flex items-center gap-3 text-sm text-gray-500">
              <FolderSearch size={18} className="text-gray-400 animate-pulse" />
              Scanning Documents, Downloads & Desktop…
            </div>
          )}

          {scanned && localFiles.length === 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
              <FolderSearch size={28} className="text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No supported files found in Documents, Downloads or Desktop</p>
            </div>
          )}

          {localFiles.length > 0 && (
            <>
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {visibleLocal.map((file, i) => {
                  const info = localTypeInfo[file.appType]
                  if (!info) return null
                  const Icon = info.icon
                  return (
                    <button key={file.path} onClick={() => openLocalFile(file, navigate, setImporting)} disabled={importing === file.path}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition text-left group ${i < visibleLocal.length - 1 ? 'border-b border-gray-50' : ''}`}
                    >
                      <div className={`w-7 h-7 ${info.bg} rounded-md flex items-center justify-center flex-shrink-0`}>
                        <Icon size={13} className={info.color} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                        <p className="text-[10px] text-gray-400 truncate">{file.path.replace(/\/Users\/[^/]+/, '~')}</p>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0 text-[10px] text-gray-400">
                        <span>{formatSize(file.size)}</span>
                        <span>{formatDate(file.modified)}</span>
                        <span className={`px-1.5 py-0.5 rounded ${info.bg} ${info.color} font-medium uppercase text-[9px]`}>
                          {file.ext.slice(1)}
                        </span>
                        {importing === file.path
                          ? <Loader2 size={12} className="animate-spin text-indigo-500" />
                          : <ArrowUpRight size={12} className="text-gray-300 group-hover:text-gray-500 transition" />}
                      </div>
                    </button>
                  )
                })}
              </div>

              {localFiles.length > 8 && (
                <button onClick={() => setShowLocalAll(v => !v)}
                  className="mt-3 w-full py-2 text-xs text-gray-500 hover:text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition"
                >
                  {showLocalAll ? 'Show less' : `Show all ${localFiles.length} files`}
                </button>
              )}
            </>
          )}
        </section>
      </div>

      {showNew && <NewFileModal onClose={() => setShowNew(false)} />}
    </div>
  )
}
