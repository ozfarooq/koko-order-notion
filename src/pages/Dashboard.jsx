import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { LayoutDashboard, TrendingUp, TrendingDown, Wallet, Scissors, CalendarClock, AlertTriangle, Store, RefreshCw, Shirt } from 'lucide-react'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, Cell } from 'recharts'
import { getDashboard } from '../data/storage'
import { PageHeader, StatCard, SkeletonCards, Skeleton, ErrorBanner, money, fmtDate } from '../ui/kit'
import { listParent, listItem } from '../ui/motion'
import StatusBadge from '../components/StatusBadge'

const STATUS_HEX = {
  New: '#3b82f6', 'In Tailoring': '#f59e0b', Ready: '#22c55e', 'Payment Pending': '#f97316',
  Paid: '#14b8a6', 'Out for Delivery': '#a855f7', Returned: '#f43f5e', Cancelled: '#a8a29e',
}
const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n))
const monthShort = (k) => new Date(`${k}-01`).toLocaleDateString('en-PK', { month: 'short' })

function Panel({ title, sub, children, className = '', action }) {
  return (
    <motion.section variants={listItem} className={`card p-4 sm:p-5 ${className}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div><h2 className="font-display text-xl font-semibold text-ink">{title}</h2>{sub && <p className="text-xs text-muted">{sub}</p>}</div>
        {action}
      </div>
      {children}
    </motion.section>
  )
}

// Horizontal bar list (collections, references, products) — no chart library needed
function Bars({ rows, value, label, right, tone = 'bg-plum-500' }) {
  const max = Math.max(1, ...rows.map(value))
  return (
    <ul className="space-y-2.5">
      {rows.map((r, i) => (
        <li key={i}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-sm"><span className="truncate text-ink">{label(r)}</span><span className="whitespace-nowrap text-xs text-muted">{right(r)}</span></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-subtle2">
            <motion.div className={`h-full rounded-full ${tone}`} initial={{ width: 0 }} animate={{ width: `${(value(r) / max) * 100}%` }} transition={{ duration: 0.8, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

function ChartTip({ active, payload, label, showMoney }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-ink">{new Date(`${label}-01`).toLocaleDateString('en-PK', { month: 'long', year: 'numeric' })}</p>
      {showMoney && <p className="text-plum-700 dark:text-plum-300">Revenue {money(p.revenue)}</p>}
      {showMoney && <p className="text-gold-600">Collected {money(p.collected)}</p>}
      <p className="text-muted">{p.orders} order{p.orders === 1 ? '' : 's'}</p>
    </div>
  )
}

export default function Dashboard() {
  const [d, setD] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const load = useCallback(() => {
    setLoading(true)
    getDashboard().then((x) => { setD(x); setError(null) }).catch((e) => setError(e.message)).finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  const k = d?.kpis
  const delta = k && k.revenueLastMonth ? Math.round(((k.revenueThisMonth - k.revenueLastMonth) / k.revenueLastMonth) * 100) : null
  const statusRows = d ? Object.keys(STATUS_HEX).map((s) => ({ status: s, n: d.statuses[s] || 0 })).filter((r) => r.n > 0) : []
  const agingTotal = d ? d.aging.reduce((s, a) => s + (a.amount || 0), 0) : 0

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader eyebrow={d ? fmtDate(d.today, { weekday: 'long', day: 'numeric', month: 'long' }) : 'Overview'} title="Dashboard" icon={LayoutDashboard}
        subtitle="How Koko Atelier is doing at a glance"
        actions={<button className="btn-secondary" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Refresh</button>} />
      <ErrorBanner onRetry={load}>{error}</ErrorBanner>

      {!d ? <><SkeletonCards /><div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-80 lg:col-span-2" /><Skeleton className="h-80" /></div></> : (
        <motion.div variants={listParent} initial="hidden" animate="show" className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {d.showMoney
              ? <StatCard label="Revenue this month" value={k.revenueThisMonth} prefix="PKR " tone="plum" icon={delta != null && delta < 0 ? TrendingDown : TrendingUp}
                  sub={delta == null ? `${k.ordersThisMonth} orders` : `${delta >= 0 ? '+' : ''}${delta}% vs last month · ${k.ordersThisMonth} orders`} />
              : <StatCard label="Orders this month" value={k.ordersThisMonth} tone="plum" icon={TrendingUp} sub={`${k.ordersLastMonth} last month`} />}
            {d.showMoney
              ? <StatCard label="Balance outstanding" value={k.outstanding} prefix="PKR " tone={k.outstanding ? 'red' : 'green'} icon={Wallet} sub={k.owingOrders ? `${k.owingOrders} order${k.owingOrders === 1 ? '' : 's'} owe` : 'Everyone has paid'} />
              : <StatCard label="Orders with balance" value={k.owingOrders} tone="red" icon={Wallet} />}
            <StatCard label="In progress" value={k.inProgress} icon={Scissors} sub="New, tailoring, ready, out for delivery" />
            <StatCard label="Due this week" value={k.dueThisWeek} tone={k.overdue ? 'orange' : 'gold'} icon={k.overdue ? AlertTriangle : CalendarClock} sub={k.overdue ? `${k.overdue} overdue` : 'Nothing overdue'} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title={d.showMoney ? 'Revenue' : 'Orders'} sub="Last 12 months, by order date" className="lg:col-span-2">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={d.months} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
                    <defs>
                      <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#874d77" stopOpacity={0.35} /><stop offset="100%" stopColor="#874d77" stopOpacity={0} /></linearGradient>
                      <linearGradient id="col" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#cfa84a" stopOpacity={0.3} /><stop offset="100%" stopColor="#cfa84a" stopOpacity={0} /></linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-line" vertical={false} />
                    <XAxis dataKey="month" tickFormatter={monthShort} tick={{ fontSize: 11, fill: 'currentColor' }} className="text-faint" axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={compact} tick={{ fontSize: 11, fill: 'currentColor' }} className="text-faint" axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip content={<ChartTip showMoney={d.showMoney} />} />
                    {d.showMoney && <Area type="monotone" dataKey="collected" stroke="#cfa84a" strokeWidth={2} fill="url(#col)" />}
                    <Area type="monotone" dataKey={d.showMoney ? 'revenue' : 'orders'} stroke="#874d77" strokeWidth={2.5} fill="url(#rev)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel title="Orders by status" sub="All orders">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statusRows} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
                    <XAxis type="number" hide allowDecimals={false} />
                    <YAxis type="category" dataKey="status" width={110} tick={{ fontSize: 11, fill: 'currentColor' }} className="text-muted" axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: 'rgba(135,77,119,0.06)' }} formatter={(v) => [`${v} orders`, '']} separator="" />
                    <Bar dataKey="n" radius={[0, 6, 6, 0]} barSize={16} label={{ position: 'right', fontSize: 11, fill: 'currentColor' }}>
                      {statusRows.map((r) => <Cell key={r.status} fill={STATUS_HEX[r.status]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Upcoming deliveries" sub="Open orders due in the next 2 weeks" className="lg:col-span-2" action={<Link to="/kanban" className="text-xs font-semibold text-accent">Status board →</Link>}>
              {d.upcoming.length === 0 ? <p className="py-6 text-center text-sm text-muted">No deliveries due in the next two weeks.</p> : (
                <ul className="divide-y divide-line">
                  {d.upcoming.map((o) => (
                    <li key={o.id}>
                      <Link to={`/orders/${o.id}`} className="flex items-center gap-3 py-2.5 transition hover:bg-subtle/50">
                        <div className={`w-14 flex-shrink-0 rounded-lg py-1 text-center ${o.overdue ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300' : 'bg-subtle text-ink'}`}>
                          <p className="text-[10px] font-semibold uppercase">{fmtDate(o.deliveryDate, { month: 'short' })}</p>
                          <p className="font-display text-lg font-semibold leading-none">{fmtDate(o.deliveryDate, { day: 'numeric' })}</p>
                        </div>
                        <div className="min-w-0 flex-1"><p className="truncate font-medium text-ink">{o.customer}</p><p className="text-xs text-muted">{o.orderNumber}{o.overdue ? ' · overdue' : ''}</p></div>
                        <StatusBadge status={o.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Unpaid balances by age" sub="Since the order date">
              {d.aging.every((a) => !a.orders) ? (
                <div className="flex flex-col items-center py-8 text-center"><Wallet className="mb-2 text-emerald-600" /><p className="text-sm font-medium text-ink">All balances are cleared</p><p className="text-xs text-muted">Nothing is owed right now.</p></div>
              ) : (
                <ul className="space-y-3">
                  {d.aging.map((a, i) => (
                    <li key={a.bucket} className="flex items-center gap-3">
                      <span className={`h-9 w-1.5 rounded-full ${['bg-amber-400', 'bg-orange-500', 'bg-rose-600'][i]}`} />
                      <div className="flex-1"><p className="text-sm font-medium text-ink">{a.bucket}</p><p className="text-xs text-muted">{a.orders} order{a.orders === 1 ? '' : 's'}</p></div>
                      {d.showMoney && <p className="font-display text-lg font-semibold text-ink">{money(a.amount)}</p>}
                    </li>
                  ))}
                  {d.showMoney && <li className="border-t border-line pt-2 text-right text-xs text-muted">Total {money(agingTotal)}</li>}
                </ul>
              )}
            </Panel>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Panel title="Best collections" sub="Pieces sold, all time">
              <Bars rows={d.collections} value={(r) => r.pieces} label={(r) => r.name} right={(r) => `${r.pieces} pcs${d.showMoney ? ` · ${money(r.revenue)}` : ''}`} />
            </Panel>
            <Panel title="Best sellers" sub="Top products by pieces sold">
              <ul className="space-y-2.5">
                {d.products.map((p, i) => (
                  <li key={p.id}>
                    <Link to={`/catalogue/products/${p.id}`} className="flex items-center gap-3 rounded-lg transition hover:bg-subtle/50">
                      <span className="w-4 text-center font-display text-lg text-faint">{i + 1}</span>
                      <div className="h-11 w-9 flex-shrink-0 overflow-hidden rounded bg-subtle2">{p.imageUrl ? <img src={p.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : <Shirt size={14} className="m-auto mt-3 text-faint" />}</div>
                      <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{p.name}</p>
                      <p className="text-right text-xs text-muted">{p.pieces} pcs{d.showMoney && <><br />{money(p.revenue)}</>}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title="Where sales come from" sub="Orders by reference">
              <Bars rows={d.references} value={(r) => r.orders} label={(r) => r.name} right={(r) => `${r.orders} order${r.orders === 1 ? '' : 's'}`} tone="bg-gold-400" />
            </Panel>
          </div>

          {d.resellers.length > 0 && (
            <Panel title="Resellers" sub="Consignment stock and what is owed to Koko">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {d.resellers.map((r) => (
                  <Link key={r.id} to={`/resellers/${r.id}`} className="rounded-xl border border-line p-4 transition hover:border-plum-300 hover:shadow-sm">
                    <div className="mb-3 flex items-center gap-2"><Store size={16} className="text-gold-600" /><p className="font-display text-lg font-semibold text-ink">{r.name}</p></div>
                    <dl className="grid grid-cols-3 gap-2 text-xs">
                      <div><dt className="text-muted">At store</dt><dd className="font-display text-xl font-semibold text-ink">{r.atStore}</dd>{r.stockValue != null && <dd className="text-faint">{r.currency} {r.stockValue.toLocaleString()}</dd>}</div>
                      <div><dt className="text-muted">Sold, unpaid</dt><dd className="font-display text-xl font-semibold text-orange-600">{r.unpaid}</dd>{r.owed != null && <dd className="text-faint">{r.currency} {Math.round(r.owed).toLocaleString()}</dd>}</div>
                      <div><dt className="text-muted">Sold this month</dt><dd className="font-display text-xl font-semibold text-emerald-700 dark:text-emerald-400">{r.soldThisMonth}</dd>{r.netThisMonth != null && <dd className="text-faint">{r.currency} {Math.round(r.netThisMonth).toLocaleString()}</dd>}</div>
                    </dl>
                  </Link>
                ))}
              </div>
            </Panel>
          )}
        </motion.div>
      )}
    </div>
  )
}
