import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, PlusCircle, LogOut, Kanban } from 'lucide-react'
import { logout } from '../utils/auth'

export default function Layout() {
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

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
          <div className="hidden h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-2xl font-bold">
            K
          </div>
          <div className="text-center">
            <p className="text-sm font-bold tracking-wide">Koko Atelier</p>
            <p className="text-[10px] text-white/40 tracking-widest uppercase">Orders</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 px-3 py-4">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                isActive ? 'bg-brand-600 text-white' : 'text-white/60 hover:bg-white/10 hover:text-white'
              }`
            }
          >
            <LayoutDashboard size={16} />
            Dashboard
          </NavLink>

          <NavLink
            to="/kanban"
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                isActive ? 'bg-brand-600 text-white' : 'text-white/60 hover:bg-white/10 hover:text-white'
              }`
            }
          >
            <Kanban size={16} />
            Order Status Board
          </NavLink>

          <NavLink
            to="/orders/new"
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                isActive ? 'bg-brand-600 text-white' : 'text-white/60 hover:bg-white/10 hover:text-white'
              }`
            }
          >
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
