import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { PlusCircle, ChevronDown, ChevronRight, Package, Users, TrendingUp, Clock, RefreshCw } from 'lucide-react'
import { getOrders, groupByStatus, STATUS_OPTIONS } from '../data/storage'
import StatusBadge from '../components/StatusBadge'

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="card flex items-center gap-4 p-4">
      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${color}`}>
        <Icon size={18} className="text-white" />
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        <p className="text-xs text-gray-500">{label}</p>
      </div>
    </div>
  )
}

function OrderRow({ order, onClick }) {
  return (
    <tr
      className="cursor-pointer border-b border-gray-50 transition hover:bg-brand-50/50"
      onClick={() => onClick(order.id)}
    >
      <td className="py-3 pl-4 pr-2">
        <span className="font-mono text-sm font-semibold text-brand-700">{order.orderNumber}</span>
      </td>
      <td className="px-2 py-3 text-sm text-gray-800">{order.customer}</td>
      <td className="px-2 py-3 text-sm text-gray-600 max-w-xs truncate">{order.product}</td>
      <td className="px-2 py-3 text-sm text-gray-600">
        {order.deliveryDate
          ? new Date(order.deliveryDate).toLocaleDateString('en-PK', {
              day: 'numeric', month: 'short', year: 'numeric',
            })
          : '—'}
      </td>
      <td className="px-2 py-3 text-sm font-medium text-gray-900">
        {order.amount != null ? `PKR ${Number(order.amount).toLocaleString()}` : '—'}
      </td>
      <td className="py-3 pl-2 pr-4">
        <StatusBadge status={order.status} />
      </td>
    </tr>
  )
}

function StatusGroup({ statusMeta, orders, onRowClick }) {
  const [open, setOpen] = useState(
    statusMeta.value === 'New' || statusMeta.value === 'In Tailoring'
  )
  if (orders.length === 0) return null

  return (
    <div className="card overflow-hidden">
      <button
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-gray-50"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
        <StatusBadge status={statusMeta.value} size="sm" />
        <span className="ml-auto text-xs font-semibold text-gray-400">{orders.length}</span>
      </button>

      {open && (
        <div className="border-t border-gray-50">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50/80">
                <th className="py-2 pl-4 pr-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-400">Order</th>
                <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-400">Customer</th>
                <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-400">Product</th>
                <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-400">Delivery</th>
                <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-400">Amount</th>
                <th className="py-2 pl-2 pr-4 text-left text-[10px] font-bold uppercase tracking-wide text-gray-400">Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <OrderRow key={order.id} order={order} onClick={onRowClick} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getOrders()
      setOrders(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const grouped = groupByStatus(orders)
  const activeOrders = orders.filter((o) => !['Cancelled', 'Returned', 'Paid'].includes(o.status)).length
  const pendingPayment = orders.filter((o) => ['Payment Pending', 'New'].includes(o.status)).length
  const inTailoring = orders.filter((o) => o.status === 'In Tailoring').length

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Orders Dashboard</h1>
          <p className="text-sm text-gray-500">Koko Atelier — synced with Notion</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button className="btn-primary" onClick={() => navigate('/orders/new')}>
            <PlusCircle size={16} />
            New Order
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Package}    label="Total Orders"     value={orders.length} color="bg-brand-600" />
        <StatCard icon={TrendingUp} label="Active Orders"    value={activeOrders}  color="bg-amber-500" />
        <StatCard icon={Clock}      label="In Tailoring"     value={inTailoring}   color="bg-purple-500" />
        <StatCard icon={Users}      label="Pending Payment"  value={pendingPayment} color="bg-orange-500" />
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <strong>Error loading orders:</strong> {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card h-12 animate-pulse bg-gray-100" />
          ))}
        </div>
      )}

      {/* Order Groups */}
      {!loading && (
        <div className="space-y-3">
          {STATUS_OPTIONS.map((statusMeta) => (
            <StatusGroup
              key={statusMeta.value}
              statusMeta={statusMeta}
              orders={grouped[statusMeta.value] || []}
              onRowClick={(id) => navigate(`/orders/${id}`)}
            />
          ))}

          {!error && orders.length === 0 && (
            <div className="card flex flex-col items-center gap-4 py-16 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-50">
                <Package size={28} className="text-brand-400" />
              </div>
              <div>
                <p className="text-lg font-semibold text-gray-700">No orders yet</p>
                <p className="text-sm text-gray-400">Create your first order to get started</p>
              </div>
              <button className="btn-primary" onClick={() => navigate('/orders/new')}>
                <PlusCircle size={16} />
                Create Order
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
