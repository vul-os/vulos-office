import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Search, LayoutGrid, List, MoreVertical, Clock,
  Trash2, Pencil, ArrowUpRight, FileText, Table2, Presentation,
  HardDrive, FolderOpen, ExternalLink,
} from 'lucide-react'
import { useFilesStore } from '../store/filesStore'
import { useLocalFilesStore } from '../store/localFilesStore'
import { api } from '../lib/api'
import NewFileModal from './NewFileModal'

const CONFIG = {
  doc: {
    label: 'Documents', singularLabel: 'Document',
    icon: FileText, color: 'text-indigo-600', bg: 'bg-indigo-50',
    btnBg: 'bg-indigo-600 hover:bg-indigo-700', accent: '#4f46e5',
    route: 'docs', emptyMsg: 'No documents yet',
    localExts: ['.doc', '.docx', '.txt', '.md', '.rtf', '.odt'],
    extLabel: 'docx, doc, txt, md',
  },
  sheet: {
    label: 'Spreadsheets', singularLabel: 'Spreadsheet',
    icon: Table2, color: 'text-emerald-600', bg: 'bg-emerald-50',
    btnBg: 'bg-emerald-600 hover:bg-emerald-700', accent: '#059669',
    route: 'sheets', emptyMsg: 'No spreadsheets yet',
    localExts: ['.xls', '.xlsx', '.csv', '.ods'],
    extLabel: 'xlsx, xls, csv',
  },
  slide: {
    label: 'Presentations', singularLabel: 'Presentation',
    icon: Presentation, color: 'text-amber-600', bg: 'bg-amber-50',
    btnBg: 'bg-amber-500 hover:bg-amber-600', accent: '#d97706',
    route: 'slides', emptyMsg: 'No presentations yet',
    localExts: ['.ppt', '.pptx', '.odp'],
    extLabel: 'pptx, ppt',
  },
}

function formatDate(s) {
  const diff = Date.now() - new Date(s).getTime()
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`
  return new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatSize(b) {
  if (b < 1024) return b + ' B'
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB'
  return (b / (1024 * 1024)).toFixed(1) + ' MB'
}

export default function AppHome({ type }) {
  const cfg = CONFIG[type]
  const Icon = cfg.icon
  const navigate = useNavigate()
  const { files, loading, fetchFiles, deleteFile, renameFile } = useFilesStore()
  const { files: localFiles, scanned, scan } = useLocalFilesStore()
  const [showNew, setShowNew] = useState(false)
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState('grid')
  const [menuOpen, setMenuOpen] = useState(null)
  const [renaming, setRenaming] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [tab, setTab] = useState('vulos') // 'vulos' | 'local'

  useEffect(() => { fetchFiles() }, [])
  useEffect(() => { if (!scanned) scan() }, [scanned])

  const myFiles = files
    .filter(f => f.type === type)
    .filter(f => f.name.toLowerCase().includes(search.toLowerCase()))

  const myLocalFiles = localFiles
    .filter(f => cfg.localExts.includes(f.ext))
    .filter(f => f.name.toLowerCase().includes(search.toLowerCase()))

  const openFile = (f) => navigate(`/${cfg.route}/${f.id}`)

  const startRename = (f) => { setRenaming(f.id); setRenameValue(f.name); setMenuOpen(null) }
  const commitRename = async (id) => { if (renameValue.trim()) await renameFile(id, renameValue.trim()); setRenaming(null) }

  return (
    <div className="flex-1 overflow-auto bg-gray-50">
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-3">
        <div className={`w-7 h-7 rounded-lg ${cfg.bg} flex items-center justify-center flex-shrink-0`}>
          <Icon size={15} className={cfg.color} />
        </div>
        <h1 className="text-sm font-bold text-gray-900">{cfg.label}</h1>

        <div className="flex-1 max-w-sm relative mx-2">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            className="w-full pl-8 pr-3 py-1.5 bg-gray-100 rounded-lg text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-indigo-400 transition"
          />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-1">
            <button onClick={() => setViewMode('grid')} className={`p-1.5 rounded-md transition ${viewMode === 'grid' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}><LayoutGrid size={13} /></button>
            <button onClick={() => setViewMode('list')} className={`p-1.5 rounded-md transition ${viewMode === 'list' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}><List size={13} /></button>
          </div>
          <button onClick={() => setShowNew(true)}
            className={`flex items-center gap-1.5 px-4 py-2 ${cfg.btnBg} text-white rounded-xl text-sm font-semibold shadow-sm transition`}
          >
            <Plus size={14} /> New {cfg.singularLabel}
          </button>
        </div>
      </div>

      {/* Tabs: Vulos files vs Local files */}
      <div className="bg-white border-b border-gray-100 px-6">
        <div className="flex gap-0">
          {[
            { key: 'vulos', label: `In Vulos (${myFiles.length})` },
            { key: 'local', label: `On Computer (${myLocalFiles.length})`, icon: HardDrive },
          ].map(({ key, label, icon: TabIcon }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition ${
                tab === key ? `border-current ${cfg.color}` : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {TabIcon && <TabIcon size={13} />}
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6">

        {/* ── VULOS FILES TAB ── */}
        {tab === 'vulos' && (
          <>
            {loading && (
              <div className="flex justify-center py-24">
                <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: cfg.accent, borderTopColor: 'transparent' }} />
              </div>
            )}

            {!loading && myFiles.length === 0 && (
              <div className="flex flex-col items-center justify-center py-28 text-center">
                <div className={`w-20 h-20 ${cfg.bg} rounded-3xl flex items-center justify-center mb-5`}>
                  <Icon size={36} className={`${cfg.color} opacity-50`} />
                </div>
                <p className="text-lg font-bold text-gray-900 mb-1">
                  {search ? 'No results' : cfg.emptyMsg}
                </p>
                <p className="text-sm text-gray-400 mb-6">
                  {search ? 'Try a different term' : `Start fresh with a blank ${cfg.singularLabel.toLowerCase()}`}
                </p>
                {!search && (
                  <button onClick={() => setShowNew(true)}
                    className={`flex items-center gap-2 px-5 py-2.5 ${cfg.btnBg} text-white rounded-xl text-sm font-semibold transition`}
                  >
                    <Plus size={15} /> New {cfg.singularLabel}
                  </button>
                )}
              </div>
            )}

            {/* Grid */}
            {!loading && myFiles.length > 0 && viewMode === 'grid' && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {myFiles.map(file => (
                  <FileCard key={file.id} file={file} cfg={cfg} Icon={Icon}
                    renaming={renaming} renameValue={renameValue}
                    setRenaming={setRenaming} setRenameValue={setRenameValue}
                    menuOpen={menuOpen} setMenuOpen={setMenuOpen}
                    onOpen={() => openFile(file)}
                    onRename={() => startRename(file)}
                    onRenameCommit={() => commitRename(file.id)}
                    onDelete={() => { deleteFile(file.id); setMenuOpen(null) }}
                  />
                ))}
              </div>
            )}

            {/* List */}
            {!loading && myFiles.length > 0 && viewMode === 'list' && (
              <FileListTable files={myFiles} cfg={cfg} Icon={Icon}
                renaming={renaming} renameValue={renameValue}
                setRenaming={setRenaming} setRenameValue={setRenameValue}
                menuOpen={menuOpen} setMenuOpen={setMenuOpen}
                onOpen={openFile}
                onRename={startRename}
                onRenameCommit={commitRename}
                onDelete={(id) => { deleteFile(id); setMenuOpen(null) }}
              />
            )}
          </>
        )}

        {/* ── LOCAL FILES TAB ── */}
        {tab === 'local' && (
          <>
            {myLocalFiles.length === 0 && (
              <div className="flex flex-col items-center justify-center py-28 text-center">
                <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mb-4">
                  <HardDrive size={28} className="text-gray-300" />
                </div>
                <p className="text-base font-semibold text-gray-700 mb-1">
                  {search ? 'No matching local files' : `No ${cfg.extLabel} files found`}
                </p>
                <p className="text-sm text-gray-400">
                  Scanned Documents, Downloads & Desktop
                </p>
              </div>
            )}

            {myLocalFiles.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {myLocalFiles.map((file, i) => (
                  <div key={file.path}
                    className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition group ${i < myLocalFiles.length - 1 ? 'border-b border-gray-50' : ''}`}
                  >
                    <div className={`w-8 h-8 ${cfg.bg} rounded-lg flex items-center justify-center flex-shrink-0`}>
                      <Icon size={15} className={cfg.color} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                      <p className="text-[10px] text-gray-400 truncate">{file.path.replace(/\/Users\/[^/]+/, '~')}</p>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-400 flex-shrink-0">
                      <span>{formatSize(file.size)}</span>
                      <span className="flex items-center gap-1"><Clock size={10} />{formatDate(new Date(file.modified))}</span>
                      <span className={`px-1.5 py-0.5 rounded ${cfg.bg} ${cfg.color} font-semibold uppercase text-[9px]`}>
                        {file.ext.slice(1)}
                      </span>
                    </div>
                    <button onClick={() => window.open(api.localFileUrl(file.path), '_blank')}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 rounded-lg transition ml-2"
                    >
                      <FolderOpen size={12} /> Open
                    </button>
                    <button onClick={() => window.open(api.localFileUrl(file.path), '_blank')}
                      title="Open externally"
                      className="p-1.5 text-gray-400 hover:text-gray-600 transition"
                    >
                      <ExternalLink size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {showNew && <NewFileModal onClose={() => setShowNew(false)} lockType={type} />}
      {menuOpen && <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(null)} />}
    </div>
  )
}

function FileCard({ file, cfg, Icon, renaming, renameValue, setRenaming, setRenameValue, menuOpen, setMenuOpen, onOpen, onRename, onRenameCommit, onDelete }) {
  return (
    <div className="group bg-white rounded-xl border border-gray-200 hover:border-gray-300 hover:shadow-md transition-all cursor-pointer overflow-hidden">
      <div className={`h-28 ${cfg.bg} flex items-center justify-center relative`} onClick={onOpen}>
        <Icon size={32} className={`${cfg.color} opacity-30`} />
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition">
          <ArrowUpRight size={13} className="text-gray-500" />
        </div>
      </div>
      <div className="p-3" onClick={onOpen}>
        {renaming === file.id ? (
          <input autoFocus value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onBlur={onRenameCommit}
            onKeyDown={e => { if (e.key === 'Enter') onRenameCommit(); if (e.key === 'Escape') setRenaming(null) }}
            className="w-full text-xs font-semibold border border-indigo-400 rounded px-1 focus:outline-none"
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <p className="text-xs font-semibold text-gray-900 truncate">{file.name}</p>
        )}
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-[10px] text-gray-400 flex items-center gap-1">
            <Clock size={9} />{formatDate(file.updated_at)}
          </span>
          <div className="relative" onClick={e => e.stopPropagation()}>
            <button onClick={() => setMenuOpen(menuOpen === file.id ? null : file.id)}
              className="p-0.5 rounded hover:bg-gray-100 text-gray-400 opacity-0 group-hover:opacity-100 transition"
            ><MoreVertical size={12} /></button>
            {menuOpen === file.id && (
              <div className="absolute right-0 bottom-full mb-1 w-32 bg-white border border-gray-200 rounded-xl shadow-xl z-20 py-1 text-xs">
                <button className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 text-gray-700" onClick={onRename}><Pencil size={12} /> Rename</button>
                <button className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-red-50 text-red-600" onClick={onDelete}><Trash2 size={12} /> Delete</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function FileListTable({ files, cfg, Icon, renaming, renameValue, setRenaming, setRenameValue, menuOpen, setMenuOpen, onOpen, onRename, onRenameCommit, onDelete }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50">
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Name</th>
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Modified</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {files.map(file => (
            <tr key={file.id} className="group hover:bg-gray-50 cursor-pointer" onClick={() => onOpen(file)}>
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 ${cfg.bg} rounded-lg flex items-center justify-center flex-shrink-0`}>
                    <Icon size={14} className={cfg.color} />
                  </div>
                  {renaming === file.id ? (
                    <input autoFocus value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={() => onRenameCommit(file.id)}
                      onKeyDown={e => { if (e.key === 'Enter') onRenameCommit(file.id); if (e.key === 'Escape') setRenaming(null) }}
                      className="font-medium border border-indigo-400 rounded px-1 text-sm focus:outline-none"
                      onClick={e => e.stopPropagation()}
                    />
                  ) : (
                    <span className="font-medium text-gray-900">{file.name}</span>
                  )}
                </div>
              </td>
              <td className="px-4 py-3 text-gray-400 text-xs">{formatDate(file.updated_at)}</td>
              <td className="px-2 py-3" onClick={e => e.stopPropagation()}>
                <div className="relative">
                  <button onClick={() => setMenuOpen(menuOpen === file.id ? null : file.id)}
                    className="p-1 rounded hover:bg-gray-100 text-gray-400 opacity-0 group-hover:opacity-100 transition"
                  ><MoreVertical size={14} /></button>
                  {menuOpen === file.id && (
                    <div className="absolute right-0 top-full mt-1 w-32 bg-white border border-gray-200 rounded-xl shadow-xl z-20 py-1 text-xs">
                      <button className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 text-gray-700" onClick={() => onRename(file)}><Pencil size={12} /> Rename</button>
                      <button className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-red-50 text-red-600" onClick={() => onDelete(file.id)}><Trash2 size={12} /> Delete</button>
                    </div>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
