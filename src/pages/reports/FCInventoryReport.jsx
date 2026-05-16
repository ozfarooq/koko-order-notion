import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Printer } from 'lucide-react'
import { getOrders, FC_STATUSES } from '../../data/storage'

const COMMISSION = 0.30
const SIZE_ORDER = ['X-Small', 'Small', 'Medium', 'Large', 'X-Large']

const STATUS_KEYS = [
  { key: 'FC - At Store', label: 'At Store', color: 'text-sky-700 bg-sky-50' },
  { key: 'FC - Sold',     label: 'Sold',     color: 'text-violet-700 bg-violet-50' },
  { key: 'FC - Paid',     label: 'Paid',     color: 'text-emerald-700 bg-emerald-50' },
  { key: 'FC - Returned', label: 'Returned', color: 'text-rose-700 bg-rose-50' },
]

function buildReport(orders) {
  const byProduct = {}
  orders.forEach((o) => {
    const name = (o.product || 'Unknown').trim()
    if (!byProduct[name]) byProduct[name] = []
    byProduct[name].push(o)
  })

  return Object.entries(byProduct)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([product, items]) => {
      const bySizeMap = {}
      items.forEach((o) => {
        const size = o.size || '—'
        if (!bySizeMap[size]) bySizeMap[size] = { size, items: [] }
        bySizeMap[size].items.push(o)
      })

      const sizes = Object.values(bySizeMap).sort((a, b) => {
        const ia = SIZE_ORDER.indexOf(a.size)
        const ib = SIZE_ORDER.indexOf(b.size)
        if (ia === -1 && ib === -1) return a.size.localeCompare(b.size)
        if (ia === -1) return 1
        if (ib === -1) return -1
        return ia - ib
      })

      const totals = { total: items.length }
      STATUS_KEYS.forEach(({ key }) => { totals[key] = items.filter((o) => o.status === key).length })
      const totalAED = items.reduce((s, o) => s + (Number(o.aedPrice) || 0), 0)
      const revenueAED = items.filter((o) => ['FC - Sold','FC - Paid'].includes(o.status))
                              .reduce((s, o) => s + (Number(o.aedPrice) || 0), 0)

      return { product, sizes, totals, totalAED, revenueAED, items }
    })
}

export default function FCInventoryReport() {
  const [orders,  setOrders]  = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const all = await getOrders()
      setOrders(all.filter((o) => FC_STATUSES.includes(o.status)))
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const report = buildReport(orders)

  // Overall totals
  const grandTotal    = orders.length
  const grandAED      = orders.reduce((s, o) => s + (Number(o.aedPrice) || 0), 0)
  const grandRevenue  = orders.filter((o) => ['FC - Sold','FC - Paid'].includes(o.status))
                              .reduce((s, o) => s + (Number(o.aedPrice) || 0), 0)
  const grandNet      = grandRevenue * (1 - COMMISSION)

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-0.5">Reports</p>
          <h1 className="text-2xl font-bold text-gray-900">Fashion Collage Inventory Report</h1>
          <p className="text-sm text-gray-500">
            Stock breakdown by outfit · size · status — as of {new Date().toLocaleDateString('en-PK', { day:'numeric', month:'long', year:'numeric' })}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => window.print()}>
            <Printer size={14} /> Print
          </button>
          <button className="btn-secondary" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Grand summary */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card p-4">
          <p className="text-xs text-gray-500">Total Outfits</p>
          <p className="text-2xl font-bold text-gray-900">{grandTotal}</p>
        </div>
        {STATUS_KEYS.map(({ key, label, color }) => (
          <div key={key} className="card p-4">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="text-2xl font-bold text-gray-900">
              {orders.filter((o) => o.status === key).length}
            </p>
          </div>
        ))}
      </div>

      {grandRevenue > 0 && (
        <div className="card p-5 grid grid-cols-3 gap-6">
          <div>
            <p className="text-xs text-gray-500 mb-1">Total Revenue (Sold + Paid)</p>
            <p className="text-xl font-bold text-gray-900">AED {grandRevenue.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Commission 30%</p>
            <p className="text-xl font-bold text-rose-600">− AED {(grandRevenue * COMMISSION).toLocaleString(undefined,{maximumFractionDigits:0})}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Net to Koko 70%</p>
            <p className="text-xl font-bold text-emerald-700">AED {grandNet.toLocaleString(undefined,{maximumFractionDigits:0})}</p>
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
        <div className="space-y-5">
          {report.map(({ product, sizes, totals, revenueAED }) => (
            <div key={product} className="card overflow-hidden">
              {/* Product header */}
              <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <h2 className="text-sm font-bold text-gray-900">{product}</h2>
                  <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-600">
                    {totals.total} pcs
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  {STATUS_KEYS.map(({ key, label, color }) => totals[key] > 0 && (
                    <span key={key} className={`rounded-full px-2.5 py-0.5 font-semibold ${color}`}>
                      {totals[key]} {label}
                    </span>
                  ))}
                  {revenueAED > 0 && (
                    <span className="font-semibold text-emerald-700">
                      Net AED {(revenueAED * 0.7).toLocaleString(undefined,{maximumFractionDigits:0})}
                    </span>
                  )}
                </div>
              </div>

              {/* Size breakdown table */}
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-50">
                    <th className="py-2 pl-5 pr-3 text-left text-[10px] font-bold uppercase tracking-wide text-gray-400">Size</th>
                    <th className="px-3 py-2 text-center text-[10px] font-bold uppercase tracking-wide text-gray-400">Total</th>
                    {STATUS_KEYS.map(({ key, label }) => (
                      <th key={key} className="px-3 py-2 text-center text-[10px] font-bold uppercase tracking-wide text-gray-400">{label}</th>
                    ))}
                    <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-gray-400 pr-5">AED Value</th>
                    <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-gray-400 pr-5">Net (70%)</th>
                  </tr>
                </thead>
                <tbody>
                  {sizes.map(({ size, items: sItems }) => {
                    const sAED = sItems.filter((o) => ['FC - Sold','FC - Paid'].includes(o.status))
                                       .reduce((s, o) => s + (Number(o.aedPrice) || 0), 0)
                    return (
                      <tr key={size} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="py-2.5 pl-5 pr-3 text-sm font-semibold text-gray-700">{size}</td>
                        <td className="px-3 py-2.5 text-center text-sm font-bold text-gray-900">{sItems.length}</td>
                        {STATUS_KEYS.map(({ key, color }) => {
                          const cnt = sItems.filter((o) => o.status === key).length
                          return (
                            <td key={key} className="px-3 py-2.5 text-center">
                              {cnt > 0
                                ? <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${color}`}>{cnt}</span>
                                : <span className="text-sm text-gray-300">—</span>
                              }
                            </td>
                          )
                        })}
                        <td className="px-3 py-2.5 text-right text-sm text-gray-600 pr-5">
                          {sAED > 0 ? `AED ${sAED.toLocaleString()}` : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right text-sm font-semibold text-emerald-700 pr-5">
                          {sAED > 0 ? `AED ${(sAED * 0.7).toLocaleString(undefined,{maximumFractionDigits:0})}` : '—'}
                        </td>
                      </tr>
                    )
                  })}
                  {/* Product subtotal */}
                  <tr className="bg-gray-50/80 font-semibold">
                    <td className="py-2.5 pl-5 pr-3 text-xs uppercase tracking-wide text-gray-500">Total</td>
                    <td className="px-3 py-2.5 text-center text-sm font-bold text-gray-900">{totals.total}</td>
                    {STATUS_KEYS.map(({ key }) => (
                      <td key={key} className="px-3 py-2.5 text-center text-sm font-bold text-gray-700">
                        {totals[key] || '—'}
                      </td>
                    ))}
                    <td className="px-3 py-2.5 text-right text-sm font-bold text-gray-700 pr-5">
                      {revenueAED > 0 ? `AED ${revenueAED.toLocaleString()}` : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right text-sm font-bold text-emerald-700 pr-5">
                      {revenueAED > 0 ? `AED ${(revenueAED * 0.7).toLocaleString(undefined,{maximumFractionDigits:0})}` : '—'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
