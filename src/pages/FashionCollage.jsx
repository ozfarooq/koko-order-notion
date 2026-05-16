import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, Store } from 'lucide-react'
import { getOrders, updateOrder, FC_STATUS_OPTIONS, FC_STATUSES } from '../data/storage'

const COMMISSION = 0.30

function StatusPill({ status }) {
  const meta = FC_STATUS_OPTIONS.find((s) => s.value === status)
  if (!meta) return null
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${meta.color}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  )
}

function SummaryCard({ label, value, sub, color = 'text-gray-900' }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

export default function FashionCollage() {
  const navigate = useNavigate()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editingPrice, setEditingPrice] = useState({}) // id -> draft price string
  const [savingId, setSavingId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const all = await getOrders()
      setOrders(all.filter((o) => FC_STATUSES.includes(o.status)))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleStatusChange = async (order, newStatus) => {
    setOrders((prev) => prev.map((o) => o.id === order.id ? { ...o, status: newStatus } : o))
    try {
      await updateOrder(order.id, { status: newStatus })
    } catch {
      setOrders((prev) => prev.map((o) => o.id === order.id ? { ...o, status: order.status } : o))
    }
  }

  const handlePriceBlur = async (order) => {
    const draft = editingPrice[order.id]
    if (draft === undefined) return
    const price = draft === '' ? null : Number(draft)
    setEditingPrice((p) => { const n = { ...p }; delete n[order.id]; return n })
    if (price === order.aedPrice) return
    setSavingId(order.id)
    setOrders((prev) => prev.map((o) => o.id === order.id ? { ...o, aedPrice: price } : o))
    try {
      await updateOrder(order.id, { aedPrice: price })
    } catch {
      setOrders((prev) => prev.map((o) => o.id === order.id ? { ...o, aedPrice: order.aedPrice } : o))
    } finally {
      setSavingId(null)
    }
  }

  // ── Stats ──────────────────────────────────────────────────────────
  const total     = orders.length
  const atStore   = orders.filter((o) => o.status === 'FC - At Store').length
  const sold      = orders.filter((o) => o.status === 'FC - Sold').length
  const paid      = orders.filter((o) => o.status === 'FC - Paid').length
  const returned  = orders.filter((o) => o.status === 'FC - Returned').length

  const soldOrders   = orders.filter((o) => ['FC - Sold', 'FC - Paid'].includes(o.status))
  const totalAED     = soldOrders.reduce((s, o) => s + (Number(o.aedPrice) || 0), 0)
  const commission   = totalAED * COMMISSION
  const netReceivable= totalAED - commission
  const paidAED      = orders.filter((o) => o.status === 'FC - Paid').reduce((s, o) => s + (Number(o.aedPrice) || 0), 0)
  const pendingAED   = orders.filter((o) => o.status === 'FC - Sold').reduce((s, o) => s + ((Number(o.aedPrice) || 0) * (1 - COMMISSION)), 0)

  // Group by status order
  const grouped = {}
  FC_STATUS_OPTIONS.forEach((s) => { grouped[s.value] = [] })
  orders.forEach((o) => { if (grouped[o.status]) grouped[o.status].push(o) })

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-100">
            <Store size={20} className="text-sky-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Fashion Collage Dubai</h1>
            <p className="text-sm text-gray-500">Consignment stock tracking · 30% commission</p>
          </div>
        </div>
        <button className="btn-secondary" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="Total Outfits"  value={total}    sub={`${atStore} at store · ${returned} returned`} />
        <SummaryCard label="Sold"           value={sold}     sub="Awaiting payment"   color="text-violet-700" />
        <SummaryCard label="Paid"           value={paid}     sub="Payment received"   color="text-emerald-700" />
        <SummaryCard label="AED Receivable" value={`AED ${pendingAED.toLocaleString(undefined,{maximumFractionDigits:0})}`} sub="70% of sold items" color="text-orange-600" />
      </div>

      {/* Financial summary */}
      {totalAED > 0 && (
        <div className="card p-5">
          <h2 className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-4">Financial Summary (Sold + Paid)</h2>
          <div className="grid grid-cols-3 gap-6">
            <div>
              <p className="text-xs text-gray-500">Total Sale Value</p>
              <p className="text-xl font-bold text-gray-900">AED {totalAED.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Commission (30%)</p>
              <p className="text-xl font-bold text-rose-600">− AED {commission.toLocaleString(undefined,{maximumFractionDigits:0})}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Net to Koko (70%)</p>
              <p className="text-xl font-bold text-emerald-700">AED {netReceivable.toLocaleString(undefined,{maximumFractionDigits:0})}</p>
              {paidAED > 0 && <p className="text-xs text-gray-400 mt-0.5">AED {(paidAED * 0.7).toLocaleString(undefined,{maximumFractionDigits:0})} already received</p>}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <strong>Error:</strong> {error}
        </div>
      )}

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
        </div>
      ) : (
        <div className="space-y-4">
          {FC_STATUS_OPTIONS.map((statusMeta) => {
            const items = grouped[statusMeta.value] || []
            if (items.length === 0) return null
            const groupTotal = items.reduce((s, o) => s + (Number(o.aedPrice) || 0), 0)
            const isRevenue = ['FC - Sold', 'FC - Paid'].includes(statusMeta.value)
            return (
              <div key={statusMeta.value} className="card overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-50">
                  <StatusPill status={statusMeta.value} />
                  <span className="text-xs text-gray-400 font-semibold">{items.length} outfits</span>
                  {isRevenue && groupTotal > 0 && (
                    <span className="ml-auto text-xs font-semibold text-gray-600">
                      AED {groupTotal.toLocaleString()} total · Net AED {(groupTotal * 0.7).toLocaleString(undefined,{maximumFractionDigits:0})}
                    </span>
                  )}
                </div>
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50/80">
                      <th className="py-2 pl-4 pr-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-400">Product</th>
                      <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-400">Size</th>
                      <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-400">AED Price</th>
                      <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-400">Commission (30%)</th>
                      <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-400">Net to Koko (70%)</th>
                      <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-400">Status</th>
                      <th className="py-2 pl-2 pr-4 text-left text-[10px] font-bold uppercase tracking-wide text-gray-400">Order</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((order) => {
                      const aed   = Number(order.aedPrice) || 0
                      const comm  = aed * COMMISSION
                      const net   = aed - comm
                      const isDrafting = editingPrice[order.id] !== undefined
                      const draftAed  = isDrafting ? Number(editingPrice[order.id]) || 0 : aed
                      return (
                        <tr key={order.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="py-3 pl-4 pr-2 text-sm text-gray-800 max-w-xs truncate cursor-pointer" onClick={() => navigate(`/orders/${order.id}`)}>
                            {order.product || '—'}
                          </td>
                          <td className="px-2 py-3 text-sm text-gray-600">{order.size || '—'}</td>
                          <td className="px-2 py-3">
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-gray-400">AED</span>
                              <input
                                type="number"
                                className="w-24 rounded-lg border border-gray-200 px-2 py-1 text-sm font-semibold text-gray-800 focus:border-brand-400 focus:outline-none"
                                value={isDrafting ? editingPrice[order.id] : (order.aedPrice ?? '')}
                                placeholder="0"
                                onChange={(e) => setEditingPrice((p) => ({ ...p, [order.id]: e.target.value }))}
                                onBlur={() => handlePriceBlur(order)}
                              />
                              {savingId === order.id && <span className="text-xs text-gray-400">saving…</span>}
                            </div>
                          </td>
                          <td className="px-2 py-3 text-sm text-rose-600 font-medium">
                            {draftAed > 0 ? `AED ${(draftAed * COMMISSION).toLocaleString(undefined,{maximumFractionDigits:0})}` : '—'}
                          </td>
                          <td className="px-2 py-3 text-sm text-emerald-700 font-semibold">
                            {draftAed > 0 ? `AED ${(draftAed * 0.7).toLocaleString(undefined,{maximumFractionDigits:0})}` : '—'}
                          </td>
                          <td className="px-2 py-3">
                            <select
                              className="rounded-lg border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-700 focus:outline-none focus:border-brand-400"
                              value={order.status}
                              onChange={(e) => handleStatusChange(order, e.target.value)}
                            >
                              {FC_STATUS_OPTIONS.map((s) => (
                                <option key={s.value} value={s.value}>{s.label}</option>
                              ))}
                            </select>
                          </td>
                          <td className="py-3 pl-2 pr-4 font-mono text-xs text-brand-700 cursor-pointer hover:underline" onClick={() => navigate(`/orders/${order.id}`)}>
                            {order.orderNumber}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          })}

          {orders.length === 0 && (
            <div className="card flex flex-col items-center gap-3 py-16 text-center">
              <Store size={32} className="text-gray-300" />
              <p className="text-gray-500">No Fashion Collage outfits found.</p>
              <p className="text-sm text-gray-400">Move outfits to an FC status in Notion to see them here.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
