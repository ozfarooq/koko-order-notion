import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import OrderForm from './pages/OrderForm'
import OrderDetail from './pages/OrderDetail'
import Kanban from './pages/Kanban'
import BoardReadOnly from './pages/BoardReadOnly'
import FashionCollage from './pages/FashionCollage'
import Login from './pages/Login'
import { isLoggedIn } from './utils/auth'

function ProtectedRoute({ children }) {
  return isLoggedIn() ? children : <Navigate to="/login" replace />
}

export default function App() {
  return (
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
          <Route index element={<Dashboard />} />
          <Route path="/kanban" element={<Kanban />} />
          <Route path="/fashion-collage" element={<FashionCollage />} />
          <Route path="/orders/new" element={<OrderForm />} />
          <Route path="/orders/:id" element={<OrderDetail />} />
          <Route path="/orders/:id/edit" element={<OrderForm />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
