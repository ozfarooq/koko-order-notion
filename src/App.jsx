import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom'
import { Toaster } from 'sonner'
import Layout from './components/Layout'
import Login from './pages/Login'
import { AuthProvider, useAuth, homeFor } from './auth/AuthContext'
import { getResellers } from './data/storage'
import { MotionProvider } from './ui/motion'
import { useTheme } from './ui/theme'

// Each page loads on demand, so the first visit only downloads what it needs
const Dashboard       = lazy(() => import('./pages/Dashboard'))
const Orders          = lazy(() => import('./pages/Orders'))
const Kanban          = lazy(() => import('./pages/Kanban'))
const OrderForm       = lazy(() => import('./pages/OrderForm'))
const OrderDetail     = lazy(() => import('./pages/OrderDetail'))
const BoardReadOnly   = lazy(() => import('./pages/BoardReadOnly'))
const Users           = lazy(() => import('./pages/Users'))
const Customers       = lazy(() => import('./pages/customers/Customers'))
const CustomerProfile = lazy(() => import('./pages/customers/CustomerProfile'))
const Catalogue       = lazy(() => import('./pages/catalogue/Catalogue'))
const ProductPage     = lazy(() => import('./pages/catalogue/ProductPage'))
const ResellerHome    = lazy(() => import('./pages/resellers/ResellerDashboard'))
const ResellerStock   = lazy(() => import('./pages/resellers/ResellerStock'))
const InventoryReport = lazy(() => import('./pages/resellers/InventoryReport'))
const ProductSheet    = lazy(() => import('./pages/resellers/ProductSheet'))
const Handovers       = lazy(() => import('./pages/resellers/Handovers'))
const Statements      = lazy(() => import('./pages/resellers/Statements'))
const ResellerSettings = lazy(() => import('./pages/resellers/ResellerSettings'))

function Spinner({ full }) {
  return (
    <div className={`flex items-center justify-center ${full ? 'h-[100dvh] bg-canvas' : 'h-64'}`}>
      <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-plum-200 border-t-plum-600" />
    </div>
  )
}

function ProtectedRoute({ children }) {
  const { user } = useAuth()
  const location = useLocation()
  if (user === undefined) return <Spinner full />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return children
}

// Pages a role can't use send the user to their own home page instead
function Require({ permission, children }) {
  const { user, can } = useAuth()
  return can(permission) ? children : <Navigate to={homeFor(user)} replace />
}

// Reseller logins only ever see their own reseller: any other id is swapped for theirs
function ResellerScope({ children }) {
  const { user } = useAuth()
  const { resellerId } = useParams()
  const { pathname } = useLocation()
  if (user?.role === 'reseller' && String(user.resellerId) !== String(resellerId))
    return <Navigate to={pathname.replace(/^\/resellers\/[^/]+/, `/resellers/${user.resellerId}`)} replace />
  return children
}

function Home() {
  const { user } = useAuth()
  return <Navigate to={homeFor(user)} replace />
}

// Old Fashion Collage links → the same page for the first reseller
function LegacyReseller({ to }) {
  const [target, setTarget] = useState(null)
  useEffect(() => { getResellers().then((r) => setTarget(r[0] ? `/resellers/${r[0].id}${to}` : '/')).catch(() => setTarget('/')) }, [to])
  return target ? <Navigate to={target} replace /> : <Spinner />
}

function ThemedToaster() {
  const { theme } = useTheme()
  return <Toaster theme={theme} position="top-center" richColors closeButton toastOptions={{ className: 'font-sans' }} />
}

export default function App() {
  return (
    <MotionProvider>
      <AuthProvider>
        <BrowserRouter>
          <ThemedToaster />
          <Suspense fallback={<Spinner full />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/board" element={<BoardReadOnly />} />
              <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
                <Route index element={<Home />} />
                <Route path="/dashboard" element={<Require permission="orders:read"><Dashboard /></Require>} />
                <Route path="/orders" element={<Require permission="orders:read"><Orders /></Require>} />
                <Route path="/kanban" element={<Require permission="orders:read"><Kanban /></Require>} />
                <Route path="/orders/new" element={<Require permission="orders:write"><OrderForm /></Require>} />
                <Route path="/orders/:id" element={<Require permission="orders:read"><OrderDetail /></Require>} />
                <Route path="/orders/:id/edit" element={<Require permission="orders:write"><OrderForm /></Require>} />

                <Route path="/customers" element={<Require permission="customers:read"><Customers /></Require>} />
                <Route path="/customers/:id" element={<Require permission="customers:read"><CustomerProfile /></Require>} />
                <Route path="/catalogue" element={<Require permission="products:read"><Catalogue /></Require>} />
                <Route path="/catalogue/collections/:collectionId" element={<Require permission="products:read"><Catalogue /></Require>} />
                <Route path="/catalogue/products/:id" element={<Require permission="products:read"><ProductPage /></Require>} />

                <Route path="/resellers/:resellerId" element={<Require permission="fc:read"><ResellerScope><ResellerHome /></ResellerScope></Require>} />
                <Route path="/resellers/:resellerId/stock" element={<Require permission="fc:read"><ResellerScope><ResellerStock /></ResellerScope></Require>} />
                <Route path="/resellers/:resellerId/reports/inventory" element={<Require permission="fc:read"><ResellerScope><InventoryReport /></ResellerScope></Require>} />
                <Route path="/resellers/:resellerId/handovers" element={<Require permission="fc:read"><ResellerScope><Handovers /></ResellerScope></Require>} />
                <Route path="/resellers/:resellerId/statements" element={<Require permission="fc:money"><ResellerScope><Statements /></ResellerScope></Require>} />
                <Route path="/resellers/:resellerId/settings" element={<Require permission="resellers:manage"><ResellerSettings /></Require>} />
                <Route path="/resellers/new" element={<Require permission="resellers:manage"><ResellerSettings /></Require>} />
                <Route path="/resellers/:resellerId/reports/product-sheet" element={<Require permission="fc:read"><ResellerScope><ProductSheet /></ResellerScope></Require>} />

                <Route path="/fashion-collage" element={<LegacyReseller to="/stock" />} />
                <Route path="/reports/fc-inventory" element={<LegacyReseller to="/reports/inventory" />} />
                <Route path="/reports/fc-photos" element={<LegacyReseller to="/reports/product-sheet" />} />

                <Route path="/users" element={<Require permission="users:manage"><Users /></Require>} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </MotionProvider>
  )
}
