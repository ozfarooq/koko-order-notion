import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Printer, ArrowUp, ArrowDown } from 'lucide-react'
import { getOrders, FC_STATUSES } from '../../data/storage'

const COMMISSION = 0.30
const SIZE_ORDER = ['X-Small', 'Small', 'Medium', 'Large', 'X-Large']
const IMG_EXTS = ['.jpg', '.JPG', '.jpeg', '.JPG', '.png', '.PNG']

function ProductImage({ name }) {
  const [extIdx, setExtIdx] = useState(0)
  const [failed, setFailed] = useState(false)

  const src = `/Images/${name}${IMG_EXTS[extIdx]}`

  const handleError = () => {
    const next = extIdx + 1
    if (next < IMG_EXTS.length) {
      setExtIdx(next)
    } else {
      setFailed(true)
    }
  }

  if (failed) {
    return (
      <div className="h-48 w-full rounded-xl bg-gray-100 flex items-center justify-center text-gray-300 text-xs">
        No image
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={name}
      onError={handleError}
      className="h-48 w-full rounded-xl object-cover"
    />
  )
}

function buildReport(orders, sortDir) {
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
        if (!bySizeMap[size]) bySizeMap[size] = []
        bySizeMap[size].push(o)
      })

      const sizes = Object.entries(bySizeMap)
        .sort(([a], [b]) => {
          const ia = SIZE_ORDER.indexOf(a)
          const ib = SIZE_ORDER.indexOf(b)
          if (ia === -1 && ib === -1) return a.localeCompare(b)
          if (ia === -1) return 1
          if (ib === -1) return -1
          return ia - ib
        })
        .map(([size, sItems]) => {
          const totalAED = sItems.reduce((s, o) => s + (Number(o.aedPrice) || 0), 0)
          const commission = totalAED * COMMISSION
          const net = totalAED - commission
          return { size, qty: sItems.length, totalAED, commission, net }
        })

      const totalQty = items.length
      const totalAED = items.reduce((s, o) => s + (Number(o.aedPrice) || 0), 0)
      const totalCommission = totalAED * COMMISSION
      const totalNet = totalAED - totalCommission

      return { product, sizes, totalQty, totalAED, totalCommission, totalNet }
    })
}

export default function FCPhotoReport() {
  const [orders,  setOrders]  = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [sortDir, setSortDir] = useState('asc')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const all = await getOrders()
      setOrders(all.filter((o) => FC_STATUSES.includes(o.status)))
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const report = buildReport(orders, sortDir)

  const grandQty = orders.length
  const grandAED = orders.reduce((s, o) => s + (Number(o.aedPrice) || 0), 0)
  const grandNet = grandAED * (1 - COMMISSION)

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-0.5">Reports</p>
          <h1 className="text-2xl font-bold text-gray-900">Fashion Collage — Product Sheet</h1>
          <p className="text-sm text-gray-500">
            {grandQty} outfits · as of {new Date().toLocaleDateString('en-PK', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <button
            className="btn-secondary"
            onClick={() => setSortDir((d) => d === 'asc' ? 'desc' : 'asc')}
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

      {/* Grand totals */}
      <div className="grid grid-cols-3 gap-3 print:hidden">
        <div className="card p-4">
          <p className="text-xs text-gray-500">Total Outfits</p>
          <p className="text-2xl font-bold text-gray-900">{grandQty}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500">Commission (30%)</p>
          <p className="text-2xl font-bold text-rose-600">
            {grandAED > 0 ? `AED ${(grandAED * COMMISSION).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500">Net to Koko (70%)</p>
          <p className="text-2xl font-bold text-emerald-700">
            {grandNet > 0 ? `AED ${grandNet.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
          </p>
        </div>
      </div>

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
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 print:grid-cols-3">
          {report.map(({ product, sizes, totalQty, totalAED, totalCommission, totalNet }) => (
            <div key={product} className="card overflow-hidden flex flex-col print:break-inside-avoid">
              {/* Product image */}
              <div className="p-3 pb-2">
                <ProductImage name={product} />
              </div>

              {/* Product name + totals */}
              <div className="px-4 pb-3 border-b border-gray-100">
                <h2 className="text-sm font-bold text-gray-900 leading-tight">{product}</h2>
                <p className="text-xs text-gray-400 mt-0.5">{totalQty} {totalQty === 1 ? 'outfit' : 'outfits'}</p>
                {totalAED > 0 && (
                  <div className="mt-2 flex gap-3 text-xs">
                    <span className="text-rose-600 font-semibold">
                      FC: AED {totalCommission.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                    <span className="text-emerald-700 font-semibold">
                      Net: AED {totalNet.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                )}
              </div>

              {/* Size breakdown */}
              <table className="w-full text-xs flex-1">
                <thead>
                  <tr className="bg-gray-50/80">
                    <th className="py-1.5 pl-4 pr-2 text-left font-bold uppercase tracking-wide text-gray-400">Size</th>
                    <th className="px-2 py-1.5 text-center font-bold uppercase tracking-wide text-gray-400">Qty</th>
                    <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide text-gray-400">Commission</th>
                    <th className="px-2 py-1.5 pr-4 text-right font-bold uppercase tracking-wide text-gray-400">FC Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {sizes.map(({ size, qty, commission, net }) => (
                    <tr key={size} className="border-t border-gray-50">
                      <td className="py-1.5 pl-4 pr-2 font-semibold text-gray-700">{size}</td>
                      <td className="px-2 py-1.5 text-center font-bold text-gray-900">{qty}</td>
                      <td className="px-2 py-1.5 text-right text-rose-600 font-medium">
                        {commission > 0 ? `AED ${commission.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
                      </td>
                      <td className="px-2 py-1.5 pr-4 text-right text-emerald-700 font-semibold">
                        {net > 0 ? `AED ${net.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
                      </td>
                    </tr>
                  ))}
                  {sizes.length > 1 && totalAED > 0 && (
                    <tr className="border-t border-gray-200 bg-gray-50/80 font-semibold">
                      <td className="py-1.5 pl-4 pr-2 text-xs uppercase tracking-wide text-gray-500">Total</td>
                      <td className="px-2 py-1.5 text-center text-gray-900">{totalQty}</td>
                      <td className="px-2 py-1.5 text-right text-rose-600">
                        AED {totalCommission.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </td>
                      <td className="px-2 py-1.5 pr-4 text-right text-emerald-700">
                        AED {totalNet.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ))}

          {report.length === 0 && (
            <div className="col-span-full card flex flex-col items-center gap-3 py-16 text-center">
              <p className="text-gray-500">No Fashion Collage outfits found.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
