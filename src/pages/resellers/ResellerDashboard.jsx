import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { LayoutDashboard, Package, CheckCircle2, Wallet, Undo2, Store, FileText, Images, ArrowRight, TrendingUp, Truck, RefreshCw } from 'lucide-react'
import { getConsignments, pieceMoney } from '../../data/storage'
import { useAuth } from '../../auth/AuthContext'
import { PageHeader, StatCard, SkeletonCards, Skeleton, ErrorBanner, EmptyState, fmtDate } from '../../ui/kit'
import { listParent, listItem } from '../../ui/motion'
import { StatusPill } from './ResellerStock'

const fmt = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })

function Panel({ title, action, children }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="section-title">{title}</h2>{action}
      </div>
      {children}
    </div>
  )
}

export default function ResellerDashboard() {
  const { resellerId } = useParams()
  const { user, can } = useAuth()
  const showMoney = can('fc:money')
  const isReseller = user?.role === 'reseller'
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setError(null)
    try { setData(await getConsignments(resellerId)) } catch (err) { setError(err.message) }
  }, [resellerId])
  useEffect(() => { setData(null); load() }, [load])

  const reseller = data?.resellers.find((r) => String(r.id) === String(resellerId))
  const pieces = data?.items || []
  const cur = reseller?.currency || 'AED'

  const stats = useMemo(() => {
    const by = (s) => pieces.filter((p) => p.status === `FC - ${s}`)
    const atStore = by('At Store'), sold = by('Sold'), paid = by('Paid'), returned = by('Returned')
    const sum = (list, f) => list.reduce((s, p) => s + f(p), 0)
    const salesByProduct = {}
    ;[...sold, ...paid].forEach((p) => { salesByProduct[p.product] = (salesByProduct[p.product] || { name: p.product, imageUrl: p.imageUrl, count: 0, value: 0 }); salesByProduct[p.product].count++; salesByProduct[p.product].value += Number(p.aedPrice) || 0 })
    const stockByProduct = {}
    atStore.forEach((p) => { stockByProduct[p.product] = (stockByProduct[p.product] || { name: p.product, imageUrl: p.imageUrl, sizes: [] }); stockByProduct[p.product].sizes.push(p.size) })
    return {
      atStore, sold, paid, returned,
      stockValue: sum(atStore, (p) => Number(p.aedPrice) || 0),
      owed: sum(sold, (p) => pieceMoney(p).netPayable),
      received: sum(paid, (p) => pieceMoney(p).netPayable),
      soldValue: sum([...sold, ...paid], (p) => Number(p.aedPrice) || 0),
      recent: [...sold, ...paid, ...returned].filter((p) => p.soldOn || p.returnedOn)
        .sort((a, b) => (b.soldOn || b.returnedOn || '').localeCompare(a.soldOn || a.returnedOn || '') || (b.updatedAt || '').localeCompare(a.updatedAt || ''))
        .slice(0, 6),
      bestSellers: Object.values(salesByProduct).sort((a, b) => b.count - a.count).slice(0, 5),
      stock: Object.values(stockByProduct).sort((a, b) => b.sizes.length - a.sizes.length),
      sellThrough: pieces.length ? Math.round(((sold.length + paid.length) / Math.max(1, pieces.length - returned.length)) * 100) : 0,
    }
  }, [pieces])

  const base = `/resellers/${resellerId}`
  const links = [
    { to: `${base}/stock`, label: isReseller ? 'My Stock' : 'Stock', icon: Store, hint: `${stats.atStore.length} at store` },
    { to: `${base}/reports/inventory`, label: 'Inventory report', icon: FileText, hint: 'By product, size & status' },
    { to: `${base}/reports/product-sheet`, label: 'Product sheet', icon: Images, hint: 'Photos & prices to print' },
  ]

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        eyebrow={isReseller ? 'Welcome' : 'Reseller dashboard'}
        title={reseller?.name || (data ? 'Reseller' : '…')}
        subtitle={reseller ? [reseller.city, reseller.country].filter(Boolean).join(', ') + (showMoney && reseller.commissionPct != null ? ` · ${reseller.commissionPct}% commission · prices in ${cur}` : '') : ''}
        icon={LayoutDashboard}
        actions={<button className="btn-secondary" onClick={load}><RefreshCw size={14} />Refresh</button>}
      />

      <ErrorBanner onRetry={load}>{error}</ErrorBanner>
      {data && !reseller && <EmptyState icon={Store} title="Reseller not found" hint="Pick a reseller from the menu." />}

      {error || (data && !reseller) ? null : !data ? <SkeletonCards /> : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="At store" value={stats.atStore.length} icon={Package} sub={showMoney ? `${cur} ${fmt(stats.stockValue)} stock value` : `${pieces.length} handed over in total`} />
          <StatCard label="Sold, awaiting payment" value={stats.sold.length} tone="plum" icon={CheckCircle2} sub={showMoney ? `${cur} ${fmt(stats.owed)} owed to Koko` : undefined} />
          <StatCard label="Paid" value={stats.paid.length} tone="green" icon={Wallet} sub={showMoney ? `${cur} ${fmt(stats.received)} received` : undefined} />
          <StatCard label="Returned" value={stats.returned.length} tone="red" icon={Undo2} sub={`${stats.sellThrough}% sell-through`} />
        </div>
      )}

      {showMoney && data && reseller && (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label={isReseller ? 'Payable to Koko now' : 'Owed to Koko now'} value={stats.owed} prefix={`${cur} `} tone="orange" icon={Wallet} />
          <StatCard label="Stock value at store" value={stats.stockValue} prefix={`${cur} `} tone="gold" icon={Store} />
          <StatCard label="Total sold (gross)" value={stats.soldValue} prefix={`${cur} `} icon={TrendingUp} />
        </div>
      )}

      {/* Quick links */}
      <motion.div variants={listParent} initial="hidden" animate="show" className="grid gap-3 sm:grid-cols-3">
        {links.map((l) => (
          <motion.div key={l.to} variants={listItem}>
            <Link to={l.to} className="card group flex items-center gap-4 p-4 transition hover:-translate-y-0.5 hover:shadow-lift">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-plum-50 text-plum-600 dark:bg-plum-900/40 dark:text-plum-300"><l.icon size={18} /></div>
              <div className="flex-1"><p className="font-semibold text-ink">{l.label}</p><p className="text-xs text-muted">{l.hint}</p></div>
              <ArrowRight size={16} className="text-faint transition group-hover:translate-x-1 group-hover:text-accent" />
            </Link>
          </motion.div>
        ))}
      </motion.div>

      {error || (data && !reseller) ? null : !data ? <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-72" /><Skeleton className="h-72" /></div> : pieces.length === 0 ? (
        <EmptyState icon={Store} title="No stock handed over yet" hint="Pieces appear here once a handover is recorded." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Latest activity">
            {stats.recent.length === 0 ? <p className="p-5 text-sm text-muted">No sales recorded yet.</p> : (
              <ul className="divide-y divide-line">
                {stats.recent.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                    {p.imageUrl && <img src={p.imageUrl} alt="" className="h-10 w-10 rounded-md object-cover" loading="lazy" />}
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-ink">{p.product} <span className="text-faint">· {p.size}</span></p>
                      <p className="text-xs text-muted">{fmtDate(p.soldOn || p.returnedOn)}{p.resellerInvoiceNo && ` · ${p.resellerInvoiceNo}`}</p></div>
                    <div className="text-right"><StatusPill status={p.status} />{showMoney && <p className="mt-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">{cur} {fmt(pieceMoney(p).netPayable)}</p>}</div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Best sellers">
            {stats.bestSellers.length === 0 ? <p className="p-5 text-sm text-muted">No sales yet.</p> : (
              <ul className="divide-y divide-line">
                {stats.bestSellers.map((b, i) => (
                  <li key={b.name} className="flex items-center gap-3 px-5 py-3">
                    <span className="w-5 font-display text-lg text-gold-500">{i + 1}</span>
                    {b.imageUrl && <img src={b.imageUrl} alt="" className="h-10 w-10 rounded-md object-cover" loading="lazy" />}
                    <p className="flex-1 truncate text-sm font-medium text-ink">{b.name}</p>
                    <div className="text-right text-xs"><p className="font-semibold text-ink">{b.count} sold</p>{showMoney && <p className="text-muted">{cur} {fmt(b.value)}</p>}</div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="In store now" action={<Link to={`${base}/stock`} className="text-xs font-semibold text-accent">View all</Link>}>
            <ul className="divide-y divide-line">
              {stats.stock.slice(0, 8).map((s) => (
                <li key={s.name} className="flex items-center gap-3 px-5 py-2.5">
                  {s.imageUrl && <img src={s.imageUrl} alt="" className="h-9 w-9 rounded-md object-cover" loading="lazy" />}
                  <p className="flex-1 truncate text-sm text-ink">{s.name}</p>
                  <div className="flex flex-wrap justify-end gap-1">{s.sizes.map((z, i) => <span key={i} className="rounded bg-subtle2 px-1.5 py-0.5 text-[10px] font-semibold text-ink-soft">{z}</span>)}</div>
                </li>
              ))}
              {stats.stock.length === 0 && <li className="p-5 text-sm text-muted">Nothing at the store right now.</li>}
            </ul>
          </Panel>

          <Panel title="Handovers">
            <ul className="divide-y divide-line">
              {data.consignments.map((c) => {
                const items = pieces.filter((p) => p.consignmentId === c.id)
                const soldN = items.filter((p) => ['FC - Sold', 'FC - Paid'].includes(p.status)).length
                return (
                  <li key={c.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gold-50 text-gold-600 dark:bg-gold-700/20 dark:text-gold-300"><Truck size={16} /></div>
                    <div className="flex-1"><p className="text-sm font-medium text-ink">{fmtDate(c.handoverDate)}</p><p className="text-xs text-muted">{items.length} pieces · {soldN} sold{showMoney && c.commissionPct != null ? ` · ${c.commissionPct}% commission` : ''}</p></div>
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-subtle2"><div className="h-full rounded-full bg-gold-400" style={{ width: `${items.length ? (soldN / items.length) * 100 : 0}%` }} /></div>
                  </li>
                )
              })}
            </ul>
          </Panel>
        </div>
      )}
    </div>
  )
}
