/**
 * Sidebar primitives — a vertical app rail with a near-black IDE aesthetic.
 *
 * Pieces:
 *   - <Sidebar>             root container; manages width (collapsed/expanded)
 *   - <Sidebar.Brand>       logo lockup + product name (fades wordmark collapsed)
 *   - <Sidebar.Section>     labelled group; mono uppercase label, hides collapsed
 *   - <Sidebar.Item>        nav row; teal left-rail + selected tint when active
 *   - <Sidebar.Footer>      sticky bottom region (settings, collapse toggle…)
 *
 * Design DNA (vulos-cloud):
 *   - Surface sits one step above the canvas (#111 on #0c0c0c), hairline edge.
 *   - Active = 2px teal rail + #0e1f1f selected tint + #143030 border + teal
 *     icon. Restrained; the row tints rather than shouts.
 *   - Hover lifts to #1e1e1e. Mono uppercase section labels (the IDE trait).
 *   - Width transitions 200ms ease-out so collapsing feels considered.
 */

import { createContext, useContext } from 'react'
import { NavLink } from 'react-router-dom'

const SidebarCtx = createContext({ collapsed: false })

function Sidebar({ collapsed, children, className = '' }) {
  return (
    <SidebarCtx.Provider value={{ collapsed }}>
      <aside
        className={[
          'relative flex flex-col flex-shrink-0',
          'bg-bg-elev text-ink-muted border-r border-line',
          'transition-[width] duration-base ease-out',
          collapsed ? 'w-[60px]' : 'w-[244px]',
          className,
        ].join(' ')}
      >
        {children}
      </aside>
    </SidebarCtx.Provider>
  )
}

Sidebar.Brand = function SidebarBrand({ logoSrc, name = 'Vulos Office' }) {
  const { collapsed } = useContext(SidebarCtx)
  return (
    <div className={[
      'flex items-center gap-2.5 h-14 border-b border-line flex-shrink-0',
      collapsed ? 'justify-center px-0' : 'px-4',
    ].join(' ')}>
      {logoSrc ? (
        <img
          src={logoSrc}
          alt=""
          className="w-7 h-7 rounded-md object-cover flex-shrink-0 ring-1 ring-line-strong"
        />
      ) : (
        <div className="w-7 h-7 rounded-md bg-accent text-white flex items-center justify-center text-xs font-semibold flex-shrink-0">
          V
        </div>
      )}
      {!collapsed && (
        <div className="flex flex-col min-w-0 -space-y-0.5">
          <span className="text-[13px] font-semibold tracking-tightish text-ink truncate leading-tight">
            Vulos
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint leading-tight">
            Office
          </span>
        </div>
      )}
    </div>
  )
}

Sidebar.Section = function SidebarSection({ label, children, className = '' }) {
  const { collapsed } = useContext(SidebarCtx)
  return (
    <div className={`px-2 ${className}`}>
      {!collapsed && label && (
        <p className="px-2 pt-3.5 pb-1.5 font-mono text-[10px] font-medium text-ink-faint uppercase tracking-wider select-none">
          {label}
        </p>
      )}
      {collapsed && label && <div className="border-t border-line mx-2 my-2" />}
      <div className="flex flex-col gap-px">{children}</div>
    </div>
  )
}

/**
 * Sidebar.Item — accepts either `to` (renders NavLink) or `onClick` (button).
 * Active = teal left-rail + selected tint + hairline teal border + teal icon.
 */
Sidebar.Item = function SidebarItem({
  to,
  end,
  onClick,
  icon: Icon,
  iconAccent,    // optional category tint for the icon when not active
  title,
  children,
  variant = 'nav',
}) {
  const { collapsed } = useContext(SidebarCtx)

  const renderInner = (isActive) => (
    <>
      <span
        aria-hidden
        className={[
          'absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r-full',
          'transition-all duration-fast ease-out',
          isActive ? 'bg-accent opacity-100' : 'bg-accent opacity-0',
        ].join(' ')}
      />
      {Icon && (
        <Icon
          size={16}
          strokeWidth={isActive ? 2.1 : 1.8}
          className={[
            'flex-shrink-0 transition-colors duration-fast ease-out',
            isActive ? 'text-accent-press' : iconAccent || 'text-ink-faint group-hover:text-ink-muted',
          ].join(' ')}
        />
      )}
      {!collapsed && (
        <span className="truncate text-[13px] tracking-tightish flex-1 flex items-center gap-1.5">
          {children}
        </span>
      )}
    </>
  )

  const cn = (isActive) =>
    [
      'group relative flex items-center gap-2.5 h-8 px-2.5 rounded-md',
      'transition-colors duration-fast ease-out',
      collapsed ? 'justify-center' : '',
      isActive
        ? 'bg-accent-tint text-ink border border-accent-tint-2'
        : 'text-ink-muted border border-transparent hover:bg-bg-hover hover:text-ink',
      variant === 'danger' ? 'hover:bg-danger-bg hover:text-danger hover:border-transparent' : '',
    ].join(' ')

  if (to) {
    return (
      <NavLink to={to} end={end} title={title} onClick={onClick} className={({ isActive }) => cn(isActive)}>
        {({ isActive }) => renderInner(isActive)}
      </NavLink>
    )
  }
  return (
    <button type="button" onClick={onClick} title={title} className={cn(false)}>
      {renderInner(false)}
    </button>
  )
}

Sidebar.Footer = function SidebarFooter({ children }) {
  return (
    <div className="mt-auto border-t border-line pt-2 pb-1 px-2 flex flex-col gap-px">
      {children}
    </div>
  )
}

export { Sidebar }
export default Sidebar
