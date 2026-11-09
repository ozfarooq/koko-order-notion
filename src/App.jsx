import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import OrderForm from './pages/OrderForm'
import OrderDetail from './pages/OrderDetail'
import Kanban from './pages/Kanban'
import BoardReadOnly from './pages/BoardReadOnly'
import FashionCollage from './pages/FashionCollage'
import FCInventoryReport from './pages/reports/FCInventoryReport'
import FCPhotoReport from './pages/reports/FCPhotoReport'
import Users from './pages/Users'
import Login from './pages/Login'
import { AuthProvider, useAuth, homeFor } from './auth/AuthContext'

function Spinner() {
  return (
    <div className="flex h-screen items-center justify-center bg-[#f5f3ff]">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
    </div>
  )
}

function ProtectedRoute({ children }) {
  const { user } = useAuth()
  const location = useLocation()
  if (user === undefined) return <Spinner />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return children
}

// Pages a role can't use send the user to their own home page instead
function Require({ permission, children }) {
  const { user, can } = useAuth()
  return can(permission) ? children : <Navigate to={homeFor(user)} replace />
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/board" element={<BoardReadOnly />} />
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Require permission="orders:read"><Dashboard /></Require>} />
            <Route path="/kanban" element={<Require permission="orders:read"><Kanban /></Require>} />
            <Route path="/fashion-collage" element={<Require permission="fc:read"><FashionCollage /></Require>} />
            <Route path="/reports/fc-inventory" element={<Require permission="fc:read"><FCInventoryReport /></Require>} />
            <Route path="/reports/fc-photos" element={<Require permission="fc:read"><FCPhotoReport /></Require>} />
            <Route path="/orders/new" element={<Require permission="orders:write"><OrderForm /></Require>} />
            <Route path="/orders/:id" element={<Require permission="orders:read"><OrderDetail /></Require>} />
            <Route path="/orders/:id/edit" element={<Require permission="orders:write"><OrderForm /></Require>} />
            <Route path="/users" element={<Require permission="users:manage"><Users /></Require>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
