import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import { Globe, PlusCircle, ChevronDown, Package, TrendingUp, RefreshCw, FileDown, X, Sheet, Search, ClipboardList, Wallet, CalendarClock } from 'lucide-react'
import { getOrders, groupByStatus, STATUS_OPTIONS } from '../data/storage'
import StatusBadge from '../components/StatusBadge'
import { PageHeader, StatCard, SkeletonCards, SkeletonRows, EmptyState, ErrorBanner, money, fmtDate } from '../ui/kit'
import { ease } from '../ui/motion'
import { useAuth } from '../auth/AuthContext'
import WebsiteImport from './orders/WebsiteImport'

const ACTIVE = (o) => !['Cancelled', 'Returned', 'Paid'].includes(o.status)
const DEFAULT_OPEN = ['New', 'In Tailoring', 'Ready', 'Payment Pending', 'Out for Delivery']
// Dates in the studio's own time (the browser's local date), as YYYY-MM-DD
const localDay = (d = new Date()) => d.toLocaleDateString('en-CA')
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return localDay(d) }
const RANGES = [
  { value: 'all', label: 'All orders' }, { value: 'today', label: 'Today' }, { value: '7', label: 'Last 7 days' },
  { value: '15', label: 'Last 15 days' }, { value: '30', label: 'Last 30 days' }, { value: 'custom', label: 'Custom' },
]
// [from, to] by order date for a range choice; null = no date filter
function rangeDates(range, custom) {
  if (range === 'all') return null
  if (range === 'today') return [localDay(), localDay()]
  if (range === 'custom') return custom.from || custom.to ? [custom.from || '0000-01-01', custom.to || '9999-12-31'] : null
  return [daysAgo(Number(range) - 1), localDay()]
}

function Checkbox({ checked, onChange }) {
  return (
    <input type="checkbox" checked={checked} onChange={onChange} onClick={(e) => e.stopPropagation()}
      className="h-4 w-4 cursor-pointer rounded border-line-strong accent-plum-600" />
  )
}

function StatusGroup({ statusMeta, orders, onOpen, selectedIds, onToggle, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen)
  if (orders.length === 0) return null
  const allChecked = orders.every((o) => selectedIds.has(o.id))
  const toggleAll = () => orders.forEach((o) => onToggle(o.id, !allChecked))
  const total = orders.reduce((s, o) => s + (Number(o.amount) || 0), 0)

  return (
    <motion.div layout className="card overflow-hidden">
      <button className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-subtle/60" onClick={() => setOpen(!open)}>
        <ChevronDown size={15} className={`text-faint transition-transform ${open ? '' : '-rotate-90'}`} />
        <StatusBadge status={statusMeta.value} />
        <span className="text-xs font-semibold text-faint">{orders.length}</span>
        <span className="ml-auto hidden text-xs text-muted sm:block">{money(total)}</span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} transition={{ duration: 0.25, ease }} className="overflow-hidden border-t border-line">
            {/* Desktop table */}
            <table className="hidden w-full md:table">
              <thead>
                <tr className="bg-subtle/70">
                  <th className="w-10 py-2 pl-4"><Checkbox checked={allChecked} onChange={toggleAll} /></th>
                  {['Order', 'Customer', 'Product', 'Delivery', 'Amount', 'Balance'].map((h) => <th key={h} className="th">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {orders.map((o) => (
                  <tr key={o.id} onClick={() => onOpen(o.id)}
                      className={`cursor-pointer transition hover:bg-plum-50/50 dark:hover:bg-plum-900/20 ${selectedIds.has(o.id) ? 'bg-plum-50/70 dark:bg-plum-900/30' : ''}`}>
                    <td className="py-3 pl-4"><Checkbox checked={selectedIds.has(o.id)} onChange={() => onToggle(o.id, !selectedIds.has(o.id))} /></td>
                    <td className="td whitespace-nowrap text-xs">
                      <span className="tabular-nums font-semibold text-accent">{o.orderNumber}</span>
                      {(o.shopifyOrderNumber || o.channel) && <span className="block text-[11px] text-faint">{o.shopifyOrderNumber ? `Shopify ${o.shopifyOrderNumber}` : o.channel}</span>}
                    </td>
                    <td className="td font-medium text-ink">{o.customer}{o.reference && <span className="ml-2 text-[11px] text-faint">{o.reference}</span>}</td>
                    <td className="td max-w-xs truncate">{o.product}</td>
                    <td className="td whitespace-nowrap">{fmtDate(o.deliveryDate)}</td>
                    <td className="td whitespace-nowrap font-medium text-ink">{o.orderType === 'PR' ? <span className="rounded-full bg-pink-50 px-2 py-0.5 text-[11px] font-semibold text-pink-700 dark:bg-pink-950/40 dark:text-pink-300">PR / gift</span> : money(o.amount)}</td>
                    <td className={`td whitespace-nowrap font-semibold ${o.balanceDue > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-faint'}`}>{o.balanceDue > 0 ? money(o.balanceDue) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Phone cards */}
            <div className="divide-y divide-line md:hidden">
              {orders.map((o) => (
                <div key={o.id} onClick={() => onOpen(o.id)} className={`flex gap-3 p-4 active:bg-subtle ${selectedIds.has(o.id) ? 'bg-plum-50/70 dark:bg-plum-900/30' : ''}`}>
                  <div className="pt-0.5"><Checkbox checked={selectedIds.has(o.id)} onChange={() => onToggle(o.id, !selectedIds.has(o.id))} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate font-medium text-ink">{o.customer}</p>
                      <p className="text-sm font-semibold text-ink">{o.orderType === 'PR' ? <span className="text-pink-700 dark:text-pink-300">PR / gift</span> : money(o.amount)}</p>
                    </div>
                    <p className="truncate text-xs text-muted">{o.product}</p>
                    <div className="mt-1.5 flex items-center justify-between text-[11px] text-faint">
                      <span className="tabular-nums font-medium text-accent">{o.orderNumber}</span>
                      <span>{o.deliveryDate ? `Due ${fmtDate(o.deliveryDate, { day: 'numeric', month: 'short' })}` : ''}</span>
                      {o.balanceDue > 0 && <span className="font-semibold text-rose-600">Due {money(o.balanceDue)}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

export default function Orders() {
  const navigate = useNavigate()
  const { can } = useAuth()
  const [importingWeb, setImportingWeb] = useState(false)
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [range, setRange] = useState('all')
  const [custom, setCustom] = useState({ from: '', to: '' })
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [busy, setBusy] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try { setOrders(await getOrders()) }
    catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const toggleSelect = (id, value) => setSelectedIds((prev) => {
    const next = new Set(prev)
    value ? next.add(id) : next.delete(id)
    return next
  })

  const dates = rangeDates(range, custom)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return orders.filter((o) =>
      (statusFilter === 'all' || (statusFilter === 'active' ? ACTIVE(o) : o.status === statusFilter)) &&
      (!dates || (o.orderDate && o.orderDate >= dates[0] && o.orderDate <= dates[1])) &&
      (!q || [o.orderNumber, o.customer, o.product, o.phone, o.reference, o.shopifyOrderNumber, o.channel, o.prHandle, o.orderType === 'PR' ? 'pr gift' : ''].some((v) => (v || '').toLowerCase().includes(q))))
  }, [orders, query, statusFilter, dates?.[0], dates?.[1]]) // eslint-disable-line react-hooks/exhaustive-deps
  const grouped = groupByStatus(filtered)
  // Totals for the chosen period: sales only (PR / gift, cancelled and returned don't count as revenue)
  const period = useMemo(() => {
    const sales = filtered.filter((o) => o.orderType !== 'PR' && !['Cancelled', 'Returned'].includes(o.status))
    return {
      orders: filtered.length, pr: filtered.filter((o) => o.orderType === 'PR').length,
      sales: sales.reduce((s, o) => s + (Number(o.amount) || 0), 0),
      advance: sales.reduce((s, o) => s + (Number(o.advancePaid) || 0), 0),
      balance: sales.reduce((s, o) => s + Math.max(0, Number(o.balanceDue) || 0), 0),
    }
  }, [filtered])

  const active = orders.filter(ACTIVE)
  const outstanding = orders.filter((o) => o.status !== 'Cancelled').reduce((s, o) => s + Math.max(0, Number(o.balanceDue) || 0), 0)
  const weekAhead = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)
  const today = new Date().toISOString().slice(0, 10)
  const dueSoon = active.filter((o) => o.deliveryDate && o.deliveryDate >= today && o.deliveryDate <= weekAhead).length

  const selected = () => orders.filter((o) => selectedIds.has(o.id))
  const handlePrintSummary = async () => {
    setBusy('pdf')
    try {
      const { generateSummaryPDF } = await import('../utils/generatePDF')
      await generateSummaryPDF(selected())
      toast.success('Order summary downloaded')
    } catch (err) { toast.error(`Couldn't create the PDF: ${err.message}`) }
    finally { setBusy(null) }
  }
  const handleCourierExcel = async () => {
    setBusy('xlsx')
    try {
      const { generateCourierExcel } = await import('../utils/generateCourierExcel')
      generateCourierExcel(selected())
      toast.success('Courier booking sheet downloaded')
    } catch (err) { toast.error(`Couldn't create the sheet: ${err.message}`) }
    finally { setBusy(null) }
  }

  const chips = [{ value: 'all', label: 'All' }, { value: 'active', label: 'In progress' }, ...STATUS_OPTIONS.map((s) => ({ value: s.value, label: s.label }))]

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <WebsiteImport open={importingWeb} onClose={() => setImportingWeb(false)} onDone={load} />
      <PageHeader
        eyebrow="Retail"
        title="Orders"
        subtitle={`${orders.length} orders · ${active.length} in progress`}
        icon={ClipboardList}
        actions={
          <>
            <button className="btn-secondary" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Refresh</button>
            {can('orders:write') && <button className="btn-secondary" onClick={() => setImportingWeb(true)}><Globe size={14} />Import from website</button>}
            {can('orders:write') && <button className="btn-primary" onClick={() => navigate('/orders/new')}><PlusCircle size={16} />New order</button>}
          </>
        }
      />

      {loading ? <SkeletonCards /> : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="All orders" value={orders.length} icon={Package} />
          <StatCard label="In progress" value={active.length} tone="plum" icon={TrendingUp} />
          <StatCard label="Due this week" value={dueSoon} tone="gold" icon={CalendarClock} />
          <StatCard label="Balance outstanding" value={outstanding} prefix="PKR " tone={outstanding > 0 ? "red" : "green"} icon={Wallet} />
        </div>
      )}

      {/* Search + status filter */}
      <div className="space-y-3">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input className="input pl-9" placeholder="Search by order no., Shopify no., customer, product, phone or channel" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {/* Order date range */}
        <div className="flex flex-wrap items-center gap-2">
          <CalendarClock size={15} className="text-faint" />
          <div className="inline-flex flex-wrap rounded-xl border border-line bg-subtle/60 p-0.5">
            {RANGES.map((r) => (
              <button key={r.value} type="button" onClick={() => setRange(r.value)}
                className={`whitespace-nowrap rounded-lg px-3 py-1 text-xs font-semibold transition ${range === r.value ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>{r.label}</button>
            ))}
          </div>
          {range === 'custom' && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <input type="date" className="input w-auto py-1.5 text-sm" value={custom.from} max={custom.to || undefined} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} aria-label="From" />
              <span>to</span>
              <input type="date" className="input w-auto py-1.5 text-sm" value={custom.to} min={custom.from || undefined} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} aria-label="To" />
            </div>
          )}
        </div>
        {dates && !loading && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm">
            <span className="text-muted">{dates[0] === dates[1] ? fmtDate(dates[0]) : `${dates[0] > '0001' ? fmtDate(dates[0]) : 'Start'} – ${dates[1] < '9999' ? fmtDate(dates[1]) : 'today'}`} · by order date</span>
            <span><span className="font-semibold text-ink">{period.orders}</span> <span className="text-muted">order{period.orders === 1 ? '' : 's'}{period.pr ? ` (${period.pr} PR)` : ''}</span></span>
            <span><span className="text-muted">Sales</span> <span className="font-semibold text-ink">{money(period.sales)}</span></span>
            <span><span className="text-muted">Advance</span> <span className="font-semibold text-emerald-700 dark:text-emerald-400">{money(period.advance)}</span></span>
            <span><span className="text-muted">Balance</span> <span className={`font-semibold ${period.balance ? 'text-rose-600' : 'text-ink'}`}>{money(period.balance)}</span></span>
          </div>
        )}
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          {chips.map((c) => (
            <button key={c.value} onClick={() => setStatusFilter(c.value)}
              className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold transition ${statusFilter === c.value
                ? 'border-brand-primary bg-brand-primary text-white'
                : 'border-line bg-surface text-muted hover:border-line-strong hover:text-ink'}`}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <ErrorBanner onRetry={load}>{error && `Couldn't load orders: ${error}`}</ErrorBanner>

      {loading ? <SkeletonRows rows={6} /> : filtered.length === 0 ? (
        <EmptyState icon={Package} title={orders.length ? 'No matching orders' : 'No orders yet'}
          hint={orders.length ? 'Try a different search, status or date range.' : 'Create your first order to get started.'}
          action={can('orders:write') && !orders.length && <button className="btn-primary" onClick={() => navigate('/orders/new')}><PlusCircle size={16} />Create order</button>} />
      ) : (
        <div className="space-y-3">
          {STATUS_OPTIONS.map((s) => (
            <StatusGroup key={`${s.value}-${range}`} statusMeta={s} orders={grouped[s.value] || []} onOpen={(id) => navigate(`/orders/${id}`)}
              selectedIds={selectedIds} onToggle={toggleSelect} defaultOpen={DEFAULT_OPEN.includes(s.value) || statusFilter === s.value || !!query || range !== 'all'} />
          ))}
        </div>
      )}

      {/* Selection bar */}
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }} transition={{ duration: 0.3, ease }}
            className="fixed inset-x-3 bottom-20 z-40 mx-auto flex max-w-xl flex-wrap items-center gap-2 rounded-2xl bg-plum-950 px-4 py-3 shadow-lift md:bottom-6"
          >
            <span className="flex-1 text-sm font-semibold text-white">{selectedIds.size} selected</span>
            <button className="btn-gold px-3 py-1.5 text-xs" onClick={handlePrintSummary} disabled={!!busy}><FileDown size={14} />{busy === 'pdf' ? 'Creating…' : 'Summary PDF'}</button>
            <button className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20" onClick={handleCourierExcel} disabled={!!busy}>
              <Sheet size={14} />{busy === 'xlsx' ? 'Exporting…' : 'Courier sheet'}
            </button>
            <button className="rounded-lg p-1.5 text-white/50 hover:text-white" onClick={() => setSelectedIds(new Set())} aria-label="Clear selection"><X size={16} /></button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
