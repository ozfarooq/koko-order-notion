import { useState } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { LayoutDashboard, PlusCircle, LogOut, Kanban, Store, BarChart2, ChevronDown, FileText } from 'lucide-react'
import { logout } from '../utils/auth'

export default function Layout() {
  const navigate  = useNavigate()
  const location  = useLocation()
  const reportsOpen = location.pathname.startsWith('/reports')
  const [reportsExpanded, setReportsExpanded] = useState(reportsOpen)

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  const navCls = ({ isActive }) =>
    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
      isActive ? 'bg-brand-600 text-white' : 'text-white/60 hover:bg-white/10 hover:text-white'
    }`

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="flex w-56 flex-col bg-[#1a1035] text-white">
        {/* Logo */}
        <div className="flex flex-col items-center gap-2 border-b border-white/10 px-4 py-6">
          <img
            src="/kokoLogo.jpg"
            alt="Koko Atelier"
            className="h-14 w-14 rounded-full object-cover ring-2 ring-white/20"
            onError={(e) => {
              e.target.style.display = 'none'
              e.target.nextSibling.style.display = 'flex'
            }}
          />
          <div className="hidden h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-2xl font-bold">K</div>
          <div className="text-center">
            <p className="text-sm font-bold tracking-wide">Koko Atelier</p>
            <p className="text-[10px] text-white/40 tracking-widest uppercase">Orders</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          <NavLink to="/" end className={navCls}>
            <LayoutDashboard size={16} />
            Dashboard
          </NavLink>

          <NavLink to="/kanban" className={navCls}>
            <Kanban size={16} />
            Order Status Board
          </NavLink>

          <NavLink to="/fashion-collage" className={navCls}>
            <Store size={16} />
            Fashion Collage
          </NavLink>

          {/* Reports section */}
          <div>
            <button
              onClick={() => setReportsExpanded((v) => !v)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition
                ${reportsOpen ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/10 hover:text-white'}`}
            >
              <BarChart2 size={16} />
              <span className="flex-1 text-left">Reports</span>
              <ChevronDown
                size={13}
                className={`transition-transform duration-200 ${reportsExpanded ? 'rotate-180' : ''}`}
              />
            </button>

            {reportsExpanded && (
              <div className="mt-1 ml-3 space-y-0.5 border-l border-white/10 pl-3">
                <NavLink
                  to="/reports/fc-inventory"
                  className={({ isActive }) =>
                    `flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition ${
                      isActive ? 'bg-brand-600 text-white' : 'text-white/50 hover:bg-white/10 hover:text-white'
                    }`
                  }
                >
                  <FileText size={13} />
                  FC Inventory
                </NavLink>
                <NavLink
                  to="/reports/fc-photos"
                  className={({ isActive }) =>
                    `flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition ${
                      isActive ? 'bg-brand-600 text-white' : 'text-white/50 hover:bg-white/10 hover:text-white'
                    }`
                  }
                >
                  <FileText size={13} />
                  FC Product Sheet
                </NavLink>
              </div>
            )}
          </div>

          <NavLink to="/orders/new" className={navCls}>
            <PlusCircle size={16} />
            New Order
          </NavLink>
        </nav>

        <div className="border-t border-white/10 px-3 py-3 space-y-2">
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            <LogOut size={16} />
            Logout
          </button>
          <p className="text-[10px] text-white/30 text-center">Koko Atelier &copy; 2026</p>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-hidden bg-[#f5f3ff]">
        <Outlet />
      </main>
    </div>
  )
}
