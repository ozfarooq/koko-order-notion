import { useEffect, useMemo, useState } from 'react'
import { Outlet, NavLink, useNavigate, useLocation, Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  LogOut, KeyRound, Search, Sun, Moon, ChevronsLeft, ChevronsRight, ChevronDown, Menu, ClipboardList, Kanban, Store, X,
} from 'lucide-react'
import { useAuth, homeFor } from '../auth/AuthContext'
import { getResellers, RESELLERS_CHANGED } from '../data/storage'
import { buildNav, flattenNav } from '../app/nav'
import CommandPalette from '../app/CommandPalette'
import ChangePasswordModal from './ChangePasswordModal'
import { useTheme } from '../ui/theme'
import { ease } from '../ui/motion'

const ROLE_LABELS = { owner: 'Owner', manager: 'Manager', staff: 'Staff', reseller: 'Reseller' }
const COLLAPSE_KEY = 'koko-sidebar-collapsed'
const readCollapsed = () => { try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false } }

function Logo({ collapsed }) {
  return (
    <Link to="/" className="flex items-center gap-3 px-1">
      <img src="/kokoLogo.jpg" alt="Koko Atelier" className="h-10 w-10 flex-shrink-0 rounded-full object-cover ring-2 ring-gold-400/40" />
      {!collapsed && (
        <div className="min-w-0">
          <p className="font-display text-xl font-semibold leading-none tracking-wide text-white">Koko Atelier</p>
          <p className="mt-1 text-[9px] uppercase tracking-[0.3em] text-gold-300/80">Atelier Studio</p>
        </div>
      )}
    </Link>
  )
}

function SideLink({ item, collapsed, nested }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        `group relative flex items-center gap-3 rounded-lg ${nested ? 'py-1.5 pl-3 text-[13px]' : 'py-2 pl-3 text-sm'} pr-3 font-medium transition
         ${isActive ? 'bg-white/10 text-white' : 'text-white/55 hover:bg-white/5 hover:text-white'}`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <motion.span layoutId="nav-active" className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-gold-400" transition={{ duration: 0.3, ease }} />}
          <Icon size={nested ? 15 : 17} className={isActive ? 'text-gold-300' : ''} />
          {!collapsed && <span className="truncate">{item.label}</span>}
        </>
      )}
    </NavLink>
  )
}

function ResellerGroup({ group, collapsed, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen)
  useEffect(() => { if (defaultOpen) setOpen(true) }, [defaultOpen])
  if (collapsed) return group.items.slice(0, 2).map((i) => <SideLink key={i.to} item={i} collapsed />)
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-white/80 transition hover:bg-white/5 hover:text-white"
      >
        <span className="flex-1 truncate">{group.label}</span>
        {group.badge > 0 && <span className="rounded-full bg-gold-400/15 px-1.5 text-[10px] font-bold text-gold-300">{group.badge}</span>}
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease }} className="overflow-hidden"
          >
            <div className="ml-3 mt-0.5 space-y-0.5 border-l border-white/10 pl-2">
              {group.items.map((i) => <SideLink key={i.to} item={i} nested />)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function NavSections({ sections, collapsed, pathname }) {
  return sections.map((s) => (
    <div key={s.title} className="space-y-0.5">
      {!collapsed ? (
        <p className="px-3 pb-1 pt-4 text-[10px] font-bold uppercase tracking-[0.22em] text-white/30">{s.title}</p>
      ) : <div className="mx-3 my-3 h-px bg-white/10" />}
      {(s.items || []).map((i) => <SideLink key={i.to} item={i} collapsed={collapsed} />)}
      {(s.groups || []).map((g) => (
        <ResellerGroup key={g.id} group={g} collapsed={collapsed} defaultOpen={pathname.startsWith(g.base) || s.groups.length === 1} />
      ))}
    </div>
  ))
}

export default function Layout() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { user, logout, can } = useAuth()
  const { theme, toggle } = useTheme()
  const [resellers, setResellers] = useState([])
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)

  useEffect(() => {
    if (!can('fc:read')) return
    const load = () => getResellers().then(setResellers).catch(() => {})
    load()
    window.addEventListener(RESELLERS_CHANGED, load)
    return () => window.removeEventListener(RESELLERS_CHANGED, load)
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0') } catch { /* ignore */ } }, [collapsed])
  useEffect(() => { setMoreOpen(false) }, [pathname])

  const sections = useMemo(() => buildNav({ can, user, resellers }), [user, resellers]) // eslint-disable-line react-hooks/exhaustive-deps
  const destinations = useMemo(() => flattenNav(sections), [sections])
  const isReseller = user?.role === 'reseller'

  // Phone bottom tabs: the most-used destinations for this role
  const tabs = isReseller
    ? [{ to: homeFor(user, resellers), label: 'Dashboard', icon: Store, end: true }, { to: `/resellers/${user.resellerId}/stock`, label: 'My Stock', icon: ClipboardList }]
    : [
        can('orders:read') && { to: '/orders', label: 'Orders', icon: ClipboardList, end: true },
        can('orders:read') && { to: '/kanban', label: 'Board', icon: Kanban },
        can('fc:read') && resellers[0] && { to: `/resellers/${resellers[0].id}/stock`, label: 'Resellers', icon: Store },
      ].filter(Boolean)

  const handleLogout = async () => { await logout(); navigate('/login', { replace: true }) }

  const UserBlock = ({ compact }) => (
    <div className="space-y-0.5">
      {!compact && (
        <div className="px-3 pb-2">
          <p className="truncate text-sm font-semibold text-white">{user?.name}</p>
          <p className="text-[10px] uppercase tracking-[0.2em] text-white/40">{ROLE_LABELS[user?.role]}</p>
        </div>
      )}
      <button onClick={() => setChangingPassword(true)} title="Change password" className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-white/55 transition hover:bg-white/5 hover:text-white">
        <KeyRound size={16} />{!compact && 'Change password'}
      </button>
      <button onClick={handleLogout} title="Log out" className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-white/55 transition hover:bg-white/5 hover:text-white">
        <LogOut size={16} />{!compact && 'Log out'}
      </button>
    </div>
  )

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-canvas">
      {/* ── Desktop sidebar ── */}
      <motion.aside
        animate={{ width: collapsed ? 76 : 256 }} transition={{ duration: 0.3, ease }}
        className="relative hidden flex-shrink-0 flex-col bg-plum-950 text-white md:flex"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_60%_at_0%_0%,rgba(207,168,74,0.10),transparent_60%)]" />
        <div className="relative flex items-center justify-between px-4 pb-4 pt-5">
          <Logo collapsed={collapsed} />
        </div>
        <div className="relative mx-4 h-px bg-gradient-to-r from-gold-400/40 to-transparent" />
        <nav className="relative flex-1 space-y-1 overflow-y-auto overflow-x-hidden px-3 pb-4">
          <NavSections sections={sections} collapsed={collapsed} pathname={pathname} />
        </nav>
        <div className="relative border-t border-white/10 px-3 py-3">
          <UserBlock compact={collapsed} />
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs text-white/40 transition hover:bg-white/5 hover:text-white"
            title={collapsed ? 'Expand menu' : 'Collapse menu'}
          >
            {collapsed ? <ChevronsRight size={16} /> : <><ChevronsLeft size={16} /> Collapse</>}
          </button>
        </div>
      </motion.aside>

      {/* ── Main column ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex h-14 flex-shrink-0 items-center gap-2 border-b border-line bg-surface/80 px-3 backdrop-blur md:h-16 md:px-6">
          <div className="flex items-center gap-2 md:hidden">
            <img src="/kokoLogo.jpg" alt="" className="h-8 w-8 rounded-full object-cover ring-1 ring-gold-400/40" />
            <span className="font-display text-lg font-semibold text-ink">Koko Atelier</span>
          </div>
          <button
            onClick={() => setPaletteOpen(true)}
            className="ml-auto flex h-9 items-center gap-2 rounded-lg border border-line bg-subtle/60 px-3 text-sm text-faint transition hover:border-line-strong hover:text-muted md:ml-0 md:w-80"
          >
            <Search size={15} />
            <span className="hidden md:inline">Search orders, customers…</span>
            <kbd className="ml-auto hidden rounded border border-line bg-surface px-1.5 text-[10px] text-faint md:block">Ctrl K</kbd>
          </button>
          <div className="ml-auto hidden items-center gap-3 md:flex">
            {isReseller && <span className="text-sm text-muted">{user?.resellerName}</span>}
          </div>
          <button onClick={toggle} className="btn-icon" title={theme === 'dark' ? 'Light mode' : 'Dark mode'} aria-label="Toggle theme">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span key={theme} initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.2 }}>
                {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
              </motion.span>
            </AnimatePresence>
          </button>
        </header>

        <main className="flex-1 overflow-y-auto pb-20 md:pb-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.22, ease }}
              className="h-full"
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* ── Phone bottom tabs ── */}
      <nav data-mobile-tabs className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end}
            className={({ isActive }) => `flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${isActive ? 'text-accent' : 'text-faint'}`}>
            <t.icon size={20} />{t.label}
          </NavLink>
        ))}
        <button onClick={() => setMoreOpen(true)} className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-faint">
          <Menu size={20} />More
        </button>
      </nav>

      {/* ── Phone "More" sheet: the full menu ── */}
      <AnimatePresence>
        {moreOpen && (
          <motion.div className="fixed inset-0 z-50 bg-plum-950/50 md:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMoreOpen(false)}>
            <motion.div
              className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-plum-950 px-3 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3 text-white"
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ duration: 0.3, ease }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-white/20" />
              <div className="flex items-center justify-between px-1 pb-2">
                <Logo />
                <button className="rounded-lg p-2 text-white/60" onClick={() => setMoreOpen(false)}><X size={18} /></button>
              </div>
              <NavSections sections={sections} pathname={pathname} />
              <div className="mt-4 border-t border-white/10 pt-3"><UserBlock /></div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <CommandPalette open={paletteOpen} setOpen={setPaletteOpen} destinations={destinations} />
      {changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}
    </div>
  )
}
