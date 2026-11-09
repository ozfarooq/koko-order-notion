import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { RefreshCw, Printer, ArrowUp, ArrowDown } from 'lucide-react'
import { getConsignments, pieceMoney } from '../../data/storage'

// Net payable per piece, as on the reseller's statement (discounts, commission, alteration/laundry)
const netOf = (o) => pieceMoney(o).netPayable
const SIZE_ORDER = ['X-Small', 'Small', 'Medium', 'Large', 'X-Large']

const STATUS_KEYS = [
  { key: 'FC - At Store', label: 'At Store', color: 'text-sky-700 bg-sky-50' },
  { key: 'FC - Sold',     label: 'Sold',     color: 'text-violet-700 bg-violet-50' },
  { key: 'FC - Paid',     label: 'Paid',     color: 'text-emerald-700 bg-emerald-50' },
  { key: 'FC - Returned', label: 'Returned', color: 'text-rose-700 bg-rose-50' },
]

function buildReport(orders, sortDir = 'asc') {
  const byProduct = {}
  orders.forEach((o) => {
    const name = (o.product || 'Unknown').trim()
    if (!byProduct[name]) byProduct[name] = []
    byProduct[name].push(o)
  })

  return Object.entries(byProduct)
    .sort(([a], [b]) => sortDir === 'asc' ? a.localeCompare(b) : b.localeCompare(a))
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

      const revenueNet = items.filter((o) => ['FC - Sold','FC - Paid'].includes(o.status)).reduce((s, o) => s + netOf(o), 0)

      return { product, sizes, totals, totalAED, revenueAED, revenueNet, items }
    })
}

export default function FCInventoryReport() {
  const { resellerId } = useParams()
  const [reseller, setReseller] = useState(null)
  const [orders,  setOrders]  = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [sortDir, setSortDir] = useState('asc')
  const [pct,     setPct]     = useState(0)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const data = await getConsignments(resellerId)
      const r = data.resellers.find((x) => String(x.id) === String(resellerId)) || data.resellers[0]
      setOrders(data.items)
      setReseller(r || null)
      setPct(r?.commissionPct ?? 0)
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }, [resellerId])

  useEffect(() => { load() }, [load])

  const report = buildReport(orders, sortDir)

  // Overall totals
  const grandTotal    = orders.length
  const grandAED      = orders.reduce((s, o) => s + (Number(o.aedPrice) || 0), 0)
  const grandRevenue  = orders.filter((o) => ['FC - Sold','FC - Paid'].includes(o.status))
                              .reduce((s, o) => s + (Number(o.aedPrice) || 0), 0)
  const grandNet      = orders.filter((o) => ['FC - Sold','FC - Paid'].includes(o.status)).reduce((s, o) => s + netOf(o), 0)
  const grandCommission = orders.filter((o) => ['FC - Sold','FC - Paid'].includes(o.status)).reduce((s, o) => s + pieceMoney(o).commission, 0)

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-faint mb-0.5">Reports</p>
          <h1 className="text-3xl text-ink">{reseller?.name || 'Reseller'} · Inventory</h1>
          <p className="text-sm text-muted">
            Stock breakdown by outfit · size · status — as of {new Date().toLocaleDateString('en-PK', { day:'numeric', month:'long', year:'numeric' })}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn-secondary"
            onClick={() => setSortDir((d) => d === 'asc' ? 'desc' : 'asc')}
            title={`Sort product name ${sortDir === 'asc' ? 'Z→A' : 'A→Z'}`}
          >
            {sortDir === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
            Product {sortDir === 'asc' ? 'A→Z' : 'Z→A'}
          </button>
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
          <p className="text-xs text-muted">Total Outfits</p>
          <p className="text-2xl font-bold text-ink">{grandTotal}</p>
        </div>
        {STATUS_KEYS.map(({ key, label, color }) => (
          <div key={key} className="card p-4">
            <p className="text-xs text-muted">{label}</p>
            <p className="text-2xl font-bold text-ink">
              {orders.filter((o) => o.status === key).length}
            </p>
          </div>
        ))}
      </div>

      {grandRevenue > 0 && (
        <div className="card p-5 grid grid-cols-3 gap-6">
          <div>
            <p className="text-xs text-muted mb-1">Total Revenue (Sold + Paid)</p>
            <p className="text-xl font-bold text-ink">AED {grandRevenue.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-muted mb-1">Commission {pct}%</p>
            <p className="text-xl font-bold text-rose-600">− AED {grandCommission.toLocaleString(undefined,{maximumFractionDigits:0})}</p>
          </div>
          <div>
            <p className="text-xs text-muted mb-1">Net to Koko {100 - pct}%</p>
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
          {report.map(({ product, sizes, totals, revenueAED, revenueNet }) => (
            <div key={product} className="card overflow-x-auto">
              {/* Product header */}
              <div className="flex items-center justify-between px-5 py-3 bg-subtle border-b border-line">
                <div className="flex items-center gap-3">
                  <h2 className="text-sm font-bold text-ink">{product}</h2>
                  <span className="rounded-full bg-subtle2 px-2 py-0.5 text-xs font-semibold text-ink-soft">
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
                      Net AED {revenueNet.toLocaleString(undefined,{maximumFractionDigits:0})}
                    </span>
                  )}
                </div>
              </div>

              {/* Size breakdown table */}
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line">
                    <th className="py-2 pl-5 pr-3 text-left text-[10px] font-bold uppercase tracking-wide text-faint">Size</th>
                    <th className="px-3 py-2 text-center text-[10px] font-bold uppercase tracking-wide text-faint">Total</th>
                    {STATUS_KEYS.map(({ key, label }) => (
                      <th key={key} className="px-3 py-2 text-center text-[10px] font-bold uppercase tracking-wide text-faint">{label}</th>
                    ))}
                    <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-faint pr-5">AED Value</th>
                    <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-faint pr-5">Net ({100 - pct}%)</th>
                  </tr>
                </thead>
                <tbody>
                  {sizes.map(({ size, items: sItems }) => {
                    const sAED = sItems.filter((o) => ['FC - Sold','FC - Paid'].includes(o.status))
                                       .reduce((s, o) => s + (Number(o.aedPrice) || 0), 0)
                    const sNet = sItems.filter((o) => ['FC - Sold','FC - Paid'].includes(o.status))
                                       .reduce((s, o) => s + netOf(o), 0)
                    return (
                      <tr key={size} className="border-b border-line hover:bg-subtle/50">
                        <td className="py-2.5 pl-5 pr-3 text-sm font-semibold text-ink-soft">{size}</td>
                        <td className="px-3 py-2.5 text-center text-sm font-bold text-ink">{sItems.length}</td>
                        {STATUS_KEYS.map(({ key, color }) => {
                          const cnt = sItems.filter((o) => o.status === key).length
                          return (
                            <td key={key} className="px-3 py-2.5 text-center">
                              {cnt > 0
                                ? <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${color}`}>{cnt}</span>
                                : <span className="text-sm text-faint">—</span>
                              }
                            </td>
                          )
                        })}
                        <td className="px-3 py-2.5 text-right text-sm text-ink-soft pr-5">
                          {sAED > 0 ? `AED ${sAED.toLocaleString()}` : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right text-sm font-semibold text-emerald-700 pr-5">
                          {sAED > 0 ? `AED ${sNet.toLocaleString(undefined,{maximumFractionDigits:0})}` : '—'}
                        </td>
                      </tr>
                    )
                  })}
                  {/* Product subtotal */}
                  <tr className="bg-subtle/80 font-semibold">
                    <td className="py-2.5 pl-5 pr-3 text-xs uppercase tracking-wide text-muted">Total</td>
                    <td className="px-3 py-2.5 text-center text-sm font-bold text-ink">{totals.total}</td>
                    {STATUS_KEYS.map(({ key }) => (
                      <td key={key} className="px-3 py-2.5 text-center text-sm font-bold text-ink-soft">
                        {totals[key] || '—'}
                      </td>
                    ))}
                    <td className="px-3 py-2.5 text-right text-sm font-bold text-ink-soft pr-5">
                      {revenueAED > 0 ? `AED ${revenueAED.toLocaleString()}` : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right text-sm font-bold text-emerald-700 pr-5">
                      {revenueAED > 0 ? `AED ${revenueNet.toLocaleString(undefined,{maximumFractionDigits:0})}` : '—'}
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
