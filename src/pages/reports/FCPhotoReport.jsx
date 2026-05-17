import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Printer } from 'lucide-react'
import { getOrders, FC_STATUSES } from '../../data/storage'

const COMMISSION = 0.30
const SIZE_ORDER = ['X-Small', 'Small', 'Medium', 'Large', 'X-Large']
const IMG_EXTS = ['.jpg', '.JPG', '.jpeg', '.png', '.PNG']

function ProductImage({ name }) {
  const [extIdx, setExtIdx] = useState(0)
  const [failed, setFailed]   = useState(false)

  const handleError = () => {
    const next = extIdx + 1
    if (next < IMG_EXTS.length) setExtIdx(next)
    else setFailed(true)
  }

  if (failed) {
    return (
      <div className="w-full aspect-[3/4] rounded-2xl bg-gray-100 flex items-center justify-center text-gray-300 text-sm">
        No image
      </div>
    )
  }

  return (
    <img
      src={`/Images/${name}${IMG_EXTS[extIdx]}`}
      alt={name}
      onError={handleError}
      className="w-full aspect-[3/4] rounded-2xl object-cover"
    />
  )
}

function buildInventory(orders) {
  const byProduct = {}
  orders
    .filter((o) => o.status === 'FC - At Store')
    .forEach((o) => {
      const name = (o.product || 'Unknown').trim()
      if (!byProduct[name]) byProduct[name] = []
      byProduct[name].push(o)
    })

  return Object.entries(byProduct)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([product, items]) => {
      // Sizes with counts
      const sizeMap = {}
      items.forEach((o) => {
        const s = o.size || '—'
        sizeMap[s] = (sizeMap[s] || 0) + 1
      })
      const sizes = Object.entries(sizeMap).sort(([a], [b]) => {
        const ia = SIZE_ORDER.indexOf(a), ib = SIZE_ORDER.indexOf(b)
        if (ia === -1 && ib === -1) return a.localeCompare(b)
        if (ia === -1) return 1
        if (ib === -1) return -1
        return ia - ib
      })
      // Price — use first item's aedPrice (or show range if different)
      const prices = [...new Set(items.map((o) => o.aedPrice).filter(Boolean))]
      const priceLabel = prices.length === 0
        ? null
        : prices.length === 1
          ? `AED ${Number(prices[0]).toLocaleString()}`
          : `AED ${Math.min(...prices.map(Number)).toLocaleString()} – ${Math.max(...prices.map(Number)).toLocaleString()}`

      return { product, sizes, totalQty: items.length, priceLabel }
    })
}

function buildSold(orders) {
  return orders
    .filter((o) => ['FC - Sold', 'FC - Paid'].includes(o.status))
    .sort((a, b) => (a.product || '').localeCompare(b.product || ''))
    .map((o) => {
      const aed        = Number(o.aedPrice) || 0
      const commission = aed * COMMISSION
      const koko       = aed - commission
      return {
        id:         o.id,
        product:    o.product || '—',
        size:       o.size    || '—',
        status:     o.status,
        aed,
        commission,
        koko,
      }
    })
}

export default function FCPhotoReport() {
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

  const inventory = buildInventory(orders)
  const sold      = buildSold(orders)

  const soldTotal      = sold.reduce((s, r) => s + r.aed, 0)
  const soldCommission = soldTotal * COMMISSION
  const soldKoko       = soldTotal - soldCommission

  return (
    <div className="h-full overflow-y-auto print:h-auto print:overflow-visible">
      <div className="max-w-5xl mx-auto p-6 space-y-10">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Koko Atelier — Fashion Collage</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              {new Date().toLocaleDateString('en-PK', { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
          <div className="flex gap-2 print:hidden">
            <button
              className="btn-secondary"
              onClick={() => {
                document.body.classList.add('printing-report')
                window.print()
                document.body.classList.remove('printing-report')
              }}
            >
              <Printer size={14} /> Print / Save PDF
            </button>
            <button className="btn-secondary" onClick={load} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <strong>Error:</strong> {error}
          </div>
        )}

        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
          </div>
        ) : (
          <>
            {/* ── INVENTORY ── */}
            {inventory.length > 0 && (
              <section>
                <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">
                  In Store — {inventory.reduce((s, p) => s + p.totalQty, 0)} outfits
                </h2>
                <div className="grid grid-cols-2 gap-6 sm:grid-cols-3">
                  {inventory.map(({ product, sizes, totalQty, priceLabel }) => (
                    <div key={product} className="flex flex-col gap-3 print:break-inside-avoid">
                      <ProductImage name={product} />
                      <div>
                        <h3 className="text-base font-bold text-gray-900 leading-tight">{product}</h3>
                        {priceLabel && (
                          <p className="text-sm font-semibold text-gray-600 mt-0.5">{priceLabel}</p>
                        )}
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {sizes.map(([size, qty]) => (
                            <span
                              key={size}
                              className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-700"
                            >
                              {size} × {qty}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── SOLD ── */}
            {sold.length > 0 && (
              <section>
                <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">
                  Sold — {sold.length} outfits
                </h2>
                <div className="card overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100">
                        <th className="py-3 pl-5 pr-3 text-left text-[11px] font-bold uppercase tracking-wide text-gray-400">Product</th>
                        <th className="px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-gray-400">Size</th>
                        <th className="px-3 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-gray-400">Amount Sold</th>
                        <th className="px-3 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-gray-400">Commission (30%)</th>
                        <th className="px-3 py-3 pr-5 text-right text-[11px] font-bold uppercase tracking-wide text-gray-400">Koko Amount (70%)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sold.map((row) => (
                        <tr key={row.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="py-3 pl-5 pr-3 text-sm font-semibold text-gray-800">{row.product}</td>
                          <td className="px-3 py-3 text-sm text-gray-600">{row.size}</td>
                          <td className="px-3 py-3 text-right text-sm font-semibold text-gray-800">
                            {row.aed > 0 ? `AED ${row.aed.toLocaleString()}` : '—'}
                          </td>
                          <td className="px-3 py-3 text-right text-sm font-semibold text-rose-600">
                            {row.commission > 0 ? `AED ${row.commission.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
                          </td>
                          <td className="px-3 py-3 pr-5 text-right text-sm font-bold text-emerald-700">
                            {row.koko > 0 ? `AED ${row.koko.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
                          </td>
                        </tr>
                      ))}
                      {/* Totals row */}
                      <tr className="bg-gray-50 font-bold">
                        <td colSpan={2} className="py-3 pl-5 pr-3 text-xs uppercase tracking-wide text-gray-500">Total</td>
                        <td className="px-3 py-3 text-right text-sm text-gray-800">
                          {soldTotal > 0 ? `AED ${soldTotal.toLocaleString()}` : '—'}
                        </td>
                        <td className="px-3 py-3 text-right text-sm text-rose-600">
                          {soldCommission > 0 ? `AED ${soldCommission.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
                        </td>
                        <td className="px-3 py-3 pr-5 text-right text-sm text-emerald-700">
                          {soldKoko > 0 ? `AED ${soldKoko.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {inventory.length === 0 && sold.length === 0 && (
              <div className="card flex flex-col items-center gap-3 py-16 text-center">
                <p className="text-gray-500">No Fashion Collage outfits found.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
