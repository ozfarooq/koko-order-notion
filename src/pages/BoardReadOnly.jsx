import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Lock, Calendar } from 'lucide-react'
import { getOrders, FC_STATUSES } from '../data/storage'

const KANBAN_COLUMNS = [
  { value: 'New',             label: 'New',             color: 'bg-blue-500',   light: 'bg-blue-50',   border: 'border-blue-200',   text: 'text-blue-700'   },
  { value: 'In Tailoring',   label: 'In Tailoring',    color: 'bg-amber-500',  light: 'bg-amber-50',  border: 'border-amber-200',  text: 'text-amber-700'  },
  { value: 'Ready',           label: 'Ready',           color: 'bg-green-500',  light: 'bg-green-50',  border: 'border-green-200',  text: 'text-green-700'  },
  { value: 'Out for Delivery',label: 'Out for Delivery',color: 'bg-purple-500', light: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700' },
  { value: 'Payment Pending', label: 'Payment Pending', color: 'bg-orange-500', light: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700' },
  { value: 'Paid',            label: 'Paid',            color: 'bg-teal-500',   light: 'bg-teal-50',   border: 'border-teal-200',   text: 'text-teal-700'   },
  { value: 'Cancelled',       label: 'Cancelled',       color: 'bg-gray-400',   light: 'bg-gray-50',   border: 'border-gray-200',   text: 'text-gray-500'   },
  { value: 'Returned',        label: 'Returned',        color: 'bg-rose-500',   light: 'bg-rose-50',   border: 'border-rose-200',   text: 'text-rose-700'   },
]

const fmt = (date) =>
  date ? new Date(date).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' }) : null

function groupByStatus(orders) {
  const grouped = {}
  KANBAN_COLUMNS.forEach((c) => { grouped[c.value] = [] })
  orders.forEach((o) => { if (grouped[o.status] !== undefined) grouped[o.status].push(o) })
  return grouped
}

function OrderCard({ order }) {
  const col = KANBAN_COLUMNS.find((c) => c.value === order.status)

  return (
    <div className={`rounded-xl border ${col?.border || 'border-gray-200'} bg-white p-4 shadow-sm`}>
      <div className="flex items-center gap-2 mb-2">
        <div className={`h-2 w-2 rounded-full flex-shrink-0 ${col?.color || 'bg-gray-400'}`} />
        <span className="font-mono text-xs font-bold text-brand-700">{order.orderNumber}</span>
      </div>

      <p className="text-sm font-semibold text-gray-900 leading-tight mb-1">{order.customer}</p>

      {order.product && (
        <p className="text-xs text-gray-500 leading-snug mb-1 line-clamp-2">{order.product}</p>
      )}
      {order.size && (
        <span className="inline-block rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600 mb-2">
          {order.size}
        </span>
      )}

      <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-100">
        {order.deliveryDate ? (
          <span className="flex items-center gap-1 text-[11px] text-gray-400">
            <Calendar size={11} />
            {fmt(order.deliveryDate)}
          </span>
        ) : <span />}
        {order.amount != null && (
          <span className="text-[11px] font-semibold text-gray-700">
            PKR {Number(order.amount).toLocaleString()}
          </span>
        )}
      </div>

      {Number(order.balanceDue) > 0 && (
        <div className="mt-2">
          <span className="inline-block rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700">
            Due: PKR {Number(order.balanceDue).toLocaleString()}
          </span>
        </div>
      )}
    </div>
  )
}

function KanbanColumn({ col, orders }) {
  return (
    <div className="flex w-72 flex-shrink-0 flex-col rounded-2xl bg-gray-100/80 overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-3">
        <div className={`h-3 w-3 rounded-full flex-shrink-0 ${col.color}`} />
        <span className="text-sm font-bold text-gray-800 flex-1">{col.label}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${col.light} ${col.text}`}>
          {orders.length}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2.5 px-3 pb-3 max-h-[calc(100vh-160px)]">
        {orders.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-gray-200 py-8 text-center">
            <p className="text-xs text-gray-400">No orders</p>
          </div>
        ) : (
          orders.map((order) => <OrderCard key={order.id} order={order} />)
        )}
      </div>
    </div>
  )
}

export default function BoardReadOnly() {
  const [orders,  setOrders]  = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try { setOrders(await getOrders()) }
    catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const grouped = groupByStatus(orders.filter((o) => !FC_STATUSES.includes(o.status)))

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#f5f3ff]">
      {/* Header */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center gap-4">
          <img
            src="/kokoLogo.jpg"
            alt="Koko Atelier"
            className="h-9 w-9 rounded-full object-cover ring-2 ring-brand-200"
            onError={(e) => { e.target.style.display = 'none' }}
          />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-gray-900">Order Status Board</h1>
              <span className="flex items-center gap-1 rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">
                <Lock size={10} /> Read Only
              </span>
            </div>
            <p className="text-sm text-gray-500">Koko Atelier — {orders.length} orders</p>
          </div>
        </div>
        <button className="btn-secondary" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mx-6 mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <strong>Error:</strong> {error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
        </div>
      ) : (
        <div className="flex flex-1 gap-4 overflow-x-auto p-6 pb-4">
          {KANBAN_COLUMNS.map((col) => (
            <KanbanColumn key={col.value} col={col} orders={grouped[col.value] || []} />
          ))}
        </div>
      )}
    </div>
  )
}
