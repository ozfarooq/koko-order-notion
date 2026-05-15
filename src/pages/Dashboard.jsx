import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { PlusCircle, ChevronDown, ChevronRight, Package, Users, TrendingUp, Clock, RefreshCw, FileDown, X } from 'lucide-react'
import { getOrders, groupByStatus, STATUS_OPTIONS } from '../data/storage'
import StatusBadge from '../components/StatusBadge'
import { generateSummaryPDF } from '../utils/generatePDF'

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

function StatusStatCard({ label, value, dot }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-1.5 mb-1">
        <div className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${dot}`} />
        <p className="text-xs text-gray-500 leading-tight">{label}</p>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
    </div>
  )
}

function OrderRow({ order, onClick, selected, onToggle }) {
  return (
    <tr
      className={`border-b border-gray-50 transition hover:bg-brand-50/50 ${selected ? 'bg-brand-50/70' : ''}`}
    >
      <td className="py-3 pl-3 pr-1" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(order.id)}
          className="h-4 w-4 rounded border-gray-300 accent-brand-600 cursor-pointer"
        />
      </td>
      <td className="py-3 pl-2 pr-2 cursor-pointer" onClick={() => onClick(order.id)}>
        <span className="font-mono text-sm font-semibold text-brand-700">{order.orderNumber}</span>
      </td>
      <td className="px-2 py-3 text-sm text-gray-800 cursor-pointer" onClick={() => onClick(order.id)}>{order.customer}</td>
      <td className="px-2 py-3 text-sm text-gray-600 max-w-xs truncate cursor-pointer" onClick={() => onClick(order.id)}>{order.product}</td>
      <td className="px-2 py-3 text-sm text-gray-600 cursor-pointer" onClick={() => onClick(order.id)}>
        {order.deliveryDate
          ? new Date(order.deliveryDate).toLocaleDateString('en-PK', {
              day: 'numeric', month: 'short', year: 'numeric',
            })
          : '—'}
      </td>
      <td className="px-2 py-3 text-sm font-medium text-gray-900 cursor-pointer" onClick={() => onClick(order.id)}>
        {order.amount != null ? `PKR ${Number(order.amount).toLocaleString()}` : '—'}
      </td>
      <td className="py-3 pl-2 pr-4 cursor-pointer" onClick={() => onClick(order.id)}>
        <StatusBadge status={order.status} />
      </td>
    </tr>
  )
}

function StatusGroup({ statusMeta, orders, onRowClick, selectedIds, onToggle }) {
  const [open, setOpen] = useState(
    statusMeta.value === 'New' || statusMeta.value === 'In Tailoring'
  )
  if (orders.length === 0) return null

  const allChecked = orders.every((o) => selectedIds.has(o.id))
  const toggleAll = () => orders.forEach((o) => onToggle(o.id, !allChecked))

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
                <th className="py-2 pl-3 pr-1">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleAll}
                    className="h-4 w-4 rounded border-gray-300 accent-brand-600 cursor-pointer"
                  />
                </th>
                <th className="py-2 pl-2 pr-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-400">Order</th>
                <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-400">Customer</th>
                <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-400">Product</th>
                <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-400">Delivery</th>
                <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-400">Amount</th>
                <th className="py-2 pl-2 pr-4 text-left text-[10px] font-bold uppercase tracking-wide text-gray-400">Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <OrderRow
                  key={order.id}
                  order={order}
                  onClick={onRowClick}
                  selected={selectedIds.has(order.id)}
                  onToggle={(id) => onToggle(id, !selectedIds.has(id))}
                />
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
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [printingPDF, setPrintingPDF] = useState(false)

  const toggleSelect = (id, forceValue) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      const shouldAdd = forceValue !== undefined ? forceValue : !next.has(id)
      shouldAdd ? next.add(id) : next.delete(id)
      return next
    })
  }

  const handlePrintSummary = async () => {
    const selected = orders.filter((o) => selectedIds.has(o.id))
    if (!selected.length) return
    setPrintingPDF(true)
    try { await generateSummaryPDF(selected) }
    finally { setPrintingPDF(false) }
  }

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

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
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
      <div className="grid grid-cols-2 gap-4">
        <StatCard icon={Package}    label="Total Orders"  value={orders.length} color="bg-brand-600" />
        <StatCard icon={TrendingUp} label="Active Orders" value={activeOrders}  color="bg-amber-500" />
      </div>
      <div className="grid grid-cols-4 gap-3 lg:grid-cols-8">
        {STATUS_OPTIONS.map((s) => (
          <StatusStatCard key={s.value} label={s.label} value={grouped[s.value]?.length || 0} dot={s.dot} />
        ))}
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
              selectedIds={selectedIds}
              onToggle={toggleSelect}
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

      {/* Floating selection bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-2xl bg-gray-900 px-5 py-3 shadow-2xl">
          <span className="text-sm font-semibold text-white">{selectedIds.size} order{selectedIds.size !== 1 ? 's' : ''} selected</span>
          <button
            className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            onClick={handlePrintSummary}
            disabled={printingPDF}
          >
            <FileDown size={15} />
            {printingPDF ? 'Generating...' : 'Print Summary'}
          </button>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-800 hover:text-white"
            onClick={() => setSelectedIds(new Set())}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  )
}
