import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  Home, FileText, Table2, Presentation, FileSearch, MessageSquare,
  LogOut, ChevronLeft, ChevronRight, Settings, Plus,
} from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { useFilesStore } from '../store/filesStore'
import NewFileModal from './NewFileModal'

const NAV_APPS = [
  { label: 'Docs',   icon: FileText,       route: '/docs',   color: 'text-indigo-400' },
  { label: 'Sheets', icon: Table2,         route: '/sheets', color: 'text-emerald-400' },
  { label: 'Slides', icon: Presentation,   route: '/slides', color: 'text-amber-400' },
  { label: 'PDF',    icon: FileSearch,     route: '/pdf',    color: 'text-rose-400' },
  { label: 'Forum',  icon: MessageSquare,  route: '/forum',  color: 'text-sky-400' },
]

function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const { status, logout } = useAuthStore()
  const { files } = useFilesStore()
  const navigate = useNavigate()

  const recentFiles = files.slice(0, 6)
  const typeRoute = (f) => `/${f.type === 'doc' ? 'docs' : f.type === 'sheet' ? 'sheets' : 'slides'}/${f.id}`

  return (
    <>
      <aside className={`flex flex-col bg-gray-900 text-gray-100 transition-all duration-200 flex-shrink-0 ${collapsed ? 'w-14' : 'w-56'}`}>

        {/* Logo */}
        <div className="flex items-center gap-2.5 px-3 py-4 border-b border-gray-800">
          <img src="/vula-office.png" alt="Vulos Office" className="w-8 h-8 rounded-lg flex-shrink-0 object-cover" />
          {!collapsed && <span className="font-bold text-sm tracking-wide truncate">Vulos Office</span>}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 overflow-y-auto px-2 space-y-0.5">

          <button
            onClick={() => setShowNew(true)}
            title="New File"
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-500 transition text-white mb-2 ${collapsed ? 'justify-center' : ''}`}
          >
            <Plus size={15} className="flex-shrink-0" />
            {!collapsed && 'New File'}
          </button>

          <NavLink to="/" end title="Home"
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition ${collapsed ? 'justify-center' : ''} ${isActive ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`
            }
          >
            <Home size={15} className="flex-shrink-0" />
            {!collapsed && 'Home'}
          </NavLink>

          {/* App links */}
          {!collapsed && <p className="px-3 pt-3 pb-1 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Apps</p>}
          {collapsed && <div className="my-1 border-t border-gray-800" />}

          {NAV_APPS.map(({ label, icon: Icon, route, color }) => (
            <NavLink key={route} to={route} title={label}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition ${collapsed ? 'justify-center' : ''} ${isActive ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`
              }
            >
              <Icon size={15} className={`flex-shrink-0 ${color}`} />
              {!collapsed && label}
            </NavLink>
          ))}

          {/* Recent files */}
          {!collapsed && recentFiles.length > 0 && (
            <>
              <p className="px-3 pt-3 pb-1 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Recent</p>
              {recentFiles.map((f) => (
                <button key={f.id} onClick={() => navigate(typeRoute(f))} title={f.name}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-800 hover:text-white rounded-lg transition text-left"
                >
                  <span className="truncate">{f.name}</span>
                </button>
              ))}
            </>
          )}
        </nav>

        {/* Bottom */}
        <div className="border-t border-gray-800 py-2 px-2 space-y-0.5">
          <NavLink to="/settings" title="Settings"
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition ${collapsed ? 'justify-center' : ''} ${isActive ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`
            }
          >
            <Settings size={15} />
            {!collapsed && 'Settings'}
          </NavLink>

          {status?.enabled && (
            <button
              onClick={logout}
              title="Sign Out"
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-gray-400 hover:bg-red-900/40 hover:text-red-400 transition ${collapsed ? 'justify-center' : ''}`}
            >
              <LogOut size={15} />
              {!collapsed && 'Sign Out'}
            </button>
          )}

          <button
            onClick={() => setCollapsed(!collapsed)}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-800 hover:text-white transition ${collapsed ? 'justify-center' : ''}`}
          >
            {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
            {!collapsed && <span className="text-xs">Collapse</span>}
          </button>
        </div>
      </aside>

      {showNew && <NewFileModal onClose={() => setShowNew(false)} />}
    </>
  )
}

export default function Layout({ children }) {
  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">{children}</main>
    </div>
  )
}
