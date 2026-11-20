import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import { FileText, Printer, Trash2, ReceiptText, Banknote, Search, ChevronDown, Plus, Download } from 'lucide-react'
import { getConsignments, getPayments, getProducts, enterStatement, updateConsignmentItem, pieceMoney } from '../../data/storage'
import Payments from './Payments'
import SaleDetailsModal from './SaleDetailsModal'
import { monthKey, monthLabel, monthShort, monthlySummary, PayBadge } from './months'
import { useAuth } from '../../auth/AuthContext'
import { PageHeader, Segmented, Field, SkeletonRows, EmptyState, ErrorBanner, fmtDate } from '../../ui/kit'
import { ease } from '../../ui/motion'
import { downloadElementPdf } from '../../utils/statementPdf'

const f2 = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const f0 = (n) => Math.round(Number(n) || 0).toLocaleString()
const today = () => new Date().toISOString().slice(0, 10)
const SIZES = ['X-Small', 'Small', 'Medium', 'Large', 'X-Large', 'Custom']
const SHORT = { 'X-Small': 'XS', Small: 'S', Medium: 'M', Large: 'L', 'X-Large': 'XL', Custom: 'Custom' }
const sizeRank = (s) => { const i = SIZES.indexOf(s); return i < 0 ? 99 : i }
let seq = 0

// ── Month by month: what sold, what's payable, what came in ────────────
function MonthSummary({ months, cur, showPkr, period, onPick, onRecord }) {
  if (!months.length) return null
  const th = 'px-3 py-2 font-label text-[10.5px] font-medium uppercase tracking-wider text-muted'
  return (
    <div className="card overflow-hidden print:hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="section-title">Month by month</h2>
        <p className="text-xs text-muted">Click a month to see its statement</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] text-sm">
          <thead className="bg-subtle">
            <tr>
              <th className={`${th} text-left`}>Month</th><th className={`${th} text-right`}>Pieces</th><th className={`${th} text-right`}>Gross</th><th className={`${th} text-right`}>Net</th>
              <th className={`${th} text-right`}>Commission</th><th className={`${th} text-right`}>Alt/Laundry</th><th className={`${th} text-right`}>Payable</th>
              <th className={`${th} text-right`}>Received {cur}</th>{showPkr && <th className={`${th} text-right`}>Received PKR</th>}<th className={`${th} text-left`}>Payment</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {months.map((m) => (
              <tr key={m.month} onClick={() => onPick(period === m.month ? 'all' : m.month)}
                className={`cursor-pointer tabular-nums transition hover:bg-subtle ${period === m.month ? 'bg-plum-50/60 dark:bg-plum-900/20' : ''}`}>
                <td className="whitespace-nowrap px-3 py-2.5 font-medium text-ink">{monthLabel(m.month)}</td>
                <td className="px-3 py-2.5 text-right text-ink-soft">{m.pieces}</td>
                <td className="px-3 py-2.5 text-right text-ink-soft">{f2(m.gross)}</td>
                <td className="px-3 py-2.5 text-right text-ink-soft">{f2(m.net)}</td>
                <td className="px-3 py-2.5 text-right text-ink-soft">{f2(m.commission)}</td>
                <td className="px-3 py-2.5 text-right text-ink-soft">{m.alteration ? f2(m.alteration) : '—'}</td>
                <td className="px-3 py-2.5 text-right font-semibold text-ink">{f2(m.payable)}</td>
                <td className="px-3 py-2.5 text-right font-semibold text-emerald-700 dark:text-emerald-400">{m.received ? f2(m.received) : '—'}</td>
                {showPkr && <td className="px-3 py-2.5 text-right text-ink">{m.receivedPkr != null ? f0(m.receivedPkr) : '—'}</td>}
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <PayBadge status={m.status} />
                    {m.payments.length > 0 && <span className="text-xs text-muted">{m.payments.map((p) => fmtDate(p.paidOn)).join(', ')}</span>}
                    {m.status !== 'Paid' && <span className="text-xs text-rose-600">{cur} {f2(m.duePayable)} due</span>}
                    {onRecord && m.status !== 'Paid' && (
                      <button className="text-xs font-semibold text-accent hover:underline" onClick={(e) => { e.stopPropagation(); onRecord(m.month) }}>Record payment</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Printable statement (same columns as the reseller's own statement) ──
function StatementView({ reseller, pieces, payments, months, showPkr, onRecord }) {
  const [params] = useSearchParams()
  const [period, setPeriod] = useState(() => (/^\d{4}-\d{2}$/.test(params.get('month') || '') ? params.get('month') : 'all'))
  const [saving, setSaving] = useState(false)
  const sheet = useRef(null)
  const sold = pieces.filter((p) => ['FC - Sold', 'FC - Paid'].includes(p.status) && (period === 'all' || monthKey(p.soldOn) === period))
    .sort((a, b) => (a.soldOn || '').localeCompare(b.soldOn || ''))
  const t = sold.reduce((s, p) => {
    const m = pieceMoney(p)
    return { gross: s.gross + (Number(p.aedPrice) || 0), dd: s.dd + (p.designerDiscount || 0), rd: s.rd + (p.resellerDiscount || 0), net: s.net + m.netPrice, alt: s.alt + (p.alterationCharge || 0), comm: s.comm + m.commission, payable: s.payable + m.netPayable }
  }, { gross: 0, dd: 0, rd: 0, net: 0, alt: 0, comm: 0, payable: 0 })
  const paidHere = sold.filter((p) => p.status === 'FC - Paid').reduce((s, p) => s + pieceMoney(p).netPayable, 0)
  const cur = reseller.currency
  const thisMonth = months.find((m) => m.month === period)

  const download = async () => {
    setSaving(true)
    try {
      const name = `${reseller.name} statement ${period === 'all' ? 'all sales' : monthLabel(period)}`.replace(/[^\w -]+/g, '')
      await downloadElementPdf(sheet.current, `${name}.pdf`)
    } catch (err) { toast.error(`Couldn't make the PDF: ${err.message}`) } finally { setSaving(false) }
  }
  const print = () => { document.body.classList.add('printing-report'); window.onafterprint = () => document.body.classList.remove('printing-report'); window.print() }

  return (
    <div className="space-y-4">
      <MonthSummary months={months} cur={cur} showPkr={showPkr} period={period} onPick={setPeriod} onRecord={onRecord} />

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <select className="input w-auto" value={period} onChange={(e) => setPeriod(e.target.value)}>
          <option value="all">All sales</option>
          {months.map((m) => <option key={m.month} value={m.month}>{monthLabel(m.month)}</option>)}
        </select>
        <button className="btn-primary ml-auto" onClick={download} disabled={saving}><Download size={15} />{saving ? 'Preparing…' : `Download ${period === 'all' ? 'statement' : `${monthLabel(period)} statement`}`}</button>
        <button className="btn-secondary" onClick={print}><Printer size={15} />Print</button>
      </div>

      <div ref={sheet} data-pdf-root className="card overflow-x-auto p-4 sm:p-6 print:border-0 print:shadow-none">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Designer name</p>
            <p className="mt-2 font-display text-2xl font-semibold text-ink">{reseller.name}</p>
            <p className="text-xs text-muted">Sales statement · {period === 'all' ? 'all sales' : monthLabel(period)} · generated {fmtDate(today())}</p>
          </div>
          <img src="/brand/wordmark.png" alt="Koko Atelier" className="h-12 w-auto dark:invert" />
        </div>
        {sold.length > 0 && (
          <div className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-5">
            {[['Total gross', t.gross], ['Total net', t.net], ['Total commission', t.comm], ['Alteration / laundry', t.alt], ['Total payable', t.payable]].map(([k, v], i) => (
              <div key={k} className={`bg-surface px-3 py-2.5 ${i === 4 ? 'col-span-2 sm:col-span-1' : ''}`}>
                <p className="font-label text-[10px] font-semibold uppercase tracking-wider text-muted">{k}</p>
                <p className={`font-display text-lg font-semibold tabular-nums ${i === 4 ? 'text-accent' : 'text-ink'}`}>{f2(v)}</p>
              </div>
            ))}
          </div>
        )}
        {sold.length === 0 ? <p className="py-8 text-center text-sm text-muted">No sales in this period.</p> : (
          <table className="w-full min-w-[980px] border-collapse text-sm">
            <thead>
              <tr className="bg-surface-accent text-ink">
                {['Date', 'Inv no', 'Code', 'Product', 'Gross price', 'Designer disc.', 'Collage disc.', 'Net price', 'Alt/Laundry', 'Commission', 'Net payable', ''].map((h) => (
                  <th key={h} className="border border-gold-500/40 px-2 py-2 text-center font-label text-[10.5px] font-medium uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sold.map((p) => {
                const m = pieceMoney(p)
                return (
                  <tr key={p.id} className="text-ink">
                    <td className="border border-line px-2 py-1.5 whitespace-nowrap">{p.soldOn || '—'}</td>
                    <td className="border border-line px-2 py-1.5 text-xs">{p.resellerInvoiceNo || '—'}</td>
                    <td className="border border-line px-2 py-1.5 text-center tabular-nums font-medium text-xs">{p.resellerCode || '—'}</td>
                    <td className="border border-line px-2 py-1.5 uppercase">{p.product} <span className="text-faint">({p.size})</span></td>
                    <td className="border border-line px-2 py-1.5 text-right">{f2(p.aedPrice)}</td>
                    <td className="border border-line px-2 py-1.5 text-right">{p.designerDiscount ? f2(p.designerDiscount) : ''}</td>
                    <td className="border border-line px-2 py-1.5 text-right">{p.resellerDiscount ? f2(p.resellerDiscount) : ''}</td>
                    <td className="border border-line px-2 py-1.5 text-right">{f2(m.netPrice)}</td>
                    <td className="border border-line px-2 py-1.5 text-right">{p.alterationCharge ? f2(p.alterationCharge) : ''}</td>
                    <td className="border border-line px-2 py-1.5 text-right">{f2(m.commission)}</td>
                    <td className="border border-line px-2 py-1.5 text-right font-semibold">{f2(m.netPayable)}</td>
                    <td className="border border-line px-2 py-1.5 text-center text-[10px] font-semibold">{p.status === 'FC - Paid' ? <span className="text-emerald-700">PAID</span> : <span className="text-orange-600">DUE</span>}</td>
                  </tr>
                )
              })}
              <tr className="bg-subtle font-semibold text-ink">
                <td className="border border-line px-2 py-1.5" colSpan={4}>Total · {sold.length} piece{sold.length === 1 ? '' : 's'}</td>
                {[t.gross, t.dd, t.rd, t.net, t.alt, t.comm, t.payable].map((v, i) => <td key={i} className="border border-line px-2 py-1.5 text-right">{f2(v)}</td>)}
                <td className="border border-line" />
              </tr>
            </tbody>
          </table>
        )}
        <div className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-xl border border-line bg-surface p-4 shadow-sm"><p className="text-xs text-muted">Net payable to Koko</p><p className="font-display text-2xl font-semibold text-ink">{cur} {f2(t.payable)}</p></div>
          <div className="rounded-xl border border-line bg-surface p-4 shadow-sm"><p className="text-xs text-muted">Already paid</p><p className="font-display text-2xl font-semibold text-emerald-700 dark:text-emerald-400">{cur} {f2(paidHere)}</p></div>
          <div className="rounded-xl border border-line bg-surface p-4 shadow-sm"><p className="text-xs text-muted">Still owed</p><p className="font-display text-2xl font-semibold text-rose-600">{cur} {f2(t.payable - paidHere)}</p></div>
        </div>
        {period !== 'all' && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <Banknote size={15} className={thisMonth?.payments.length ? 'text-emerald-600' : 'text-faint'} />
            {thisMonth?.payments.length
              ? thisMonth.payments.map((p) => <span key={p.id} className="text-ink">Paid {fmtDate(p.paidOn)} · {cur} {f2(p.amount)}{p.amountPkr != null && <span data-pdf-hide> · PKR {f0(p.amountPkr)}</span>}{p.reference ? ` · ${p.reference}` : ''}</span>)
              : <span className="text-muted">No payment recorded for {monthLabel(period)} yet.</span>}
          </div>
        )}
        {period === 'all' && payments.length > 0 && (
          <p className="mt-3 text-xs text-muted">Payments received: {payments.map((p) => `${fmtDate(p.paidOn)} ${cur} ${f2(p.amount)}${p.reference ? ` (${p.reference})` : ''}`).join(' · ')}</p>
        )}
      </div>
    </div>
  )
}

// ── Outfit picker: collection → outfit photo → tap a size ─────────────
function OutfitPicker({ available, used, onPick, cur }) {
  const [collections, setCollections] = useState(null)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(true)
  useEffect(() => {
    getProducts().then((ps) => setCollections(new Map(ps.map((p) => [p.id, p.collection])))).catch(() => setCollections(new Map()))
  }, [])

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase()
    const outfits = new Map()
    available.filter((p) => !used.has(p.id)).forEach((p) => {
      const collection = collections?.get(p.productId) || 'Other outfits'
      if (term && !p.product.toLowerCase().includes(term) && !collection.toLowerCase().includes(term)) return
      if (!outfits.has(p.productId)) outfits.set(p.productId, { productId: p.productId, name: p.product, imageUrl: p.imageUrl, price: p.aedPrice, collection, sizes: new Map() })
      const o = outfits.get(p.productId)
      o.sizes.set(p.size, (o.sizes.get(p.size) || 0) + 1)
    })
    const byCollection = new Map()
    ;[...outfits.values()].sort((a, b) => a.name.localeCompare(b.name)).forEach((o) => {
      if (!byCollection.has(o.collection)) byCollection.set(o.collection, [])
      byCollection.get(o.collection).push(o)
    })
    return [...byCollection.entries()].sort((a, b) => (a[0] === 'Other outfits') - (b[0] === 'Other outfits') || a[0].localeCompare(b[0]))
  }, [available, used, collections, q])

  return (
    <div className="card overflow-hidden">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-3 border-b border-line px-5 py-3 text-left">
        <div><h2 className="section-title">At the store</h2><p className="text-xs text-muted">Tap a size to add a sale line</p></div>
        <ChevronDown size={16} className={`text-faint transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="max-h-[560px] space-y-4 overflow-y-auto p-4 sm:p-5">
          <div className="relative max-w-sm">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input className="input pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search outfit or collection" />
          </div>
          {!collections ? <SkeletonRows rows={2} /> : groups.length === 0 ? <p className="text-sm text-muted">{q ? 'No outfit matches.' : 'Every piece at the store is already on a line.'}</p> : groups.map(([name, outfits]) => (
            <div key={name}>
              <p className="eyebrow mb-2">{name}</p>
              <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7">
                {outfits.map((o) => (
                  <div key={o.productId} className="overflow-hidden rounded-xl border border-line bg-surface">
                    <div className="aspect-[3/4] bg-subtle">{o.imageUrl && <img src={o.imageUrl} alt="" className="h-full w-full object-cover object-top" loading="lazy" />}</div>
                    <div className="space-y-1.5 p-2">
                      <div><p className="truncate text-sm font-medium text-ink">{o.name}</p><p className="text-[11px] text-muted">{cur} {f0(o.price)}</p></div>
                      <div className="flex flex-wrap gap-1">
                        {[...o.sizes.entries()].sort((a, b) => sizeRank(a[0]) - sizeRank(b[0])).map(([size, n]) => (
                          <button key={size} type="button" onClick={() => onPick(o.productId, size)} title={`Add ${o.name} · ${size}`}
                            className="rounded-lg border border-line px-2 py-1 text-xs font-semibold text-ink transition hover:border-plum-400 hover:bg-plum-50 hover:text-accent dark:hover:bg-plum-900/30">
                            {SHORT[size] || size}{n > 1 && <span className="ml-1 font-normal text-faint">×{n}</span>}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Sales already recorded, month by month; click one to view or correct it ──
function RecordedSales({ months, cur, onOpen }) {
  const [openMonth, setOpenMonth] = useState(months[0]?.month)
  if (!months.length) return null
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-line px-5 py-3"><h2 className="section-title">Recorded sales</h2></div>
      <div className="divide-y divide-line">
        {months.filter((m) => m.pieces).map((m) => {
          const isOpen = openMonth === m.month
          return (
            <div key={m.month}>
              <button type="button" onClick={() => setOpenMonth(isOpen ? null : m.month)} className="flex w-full flex-wrap items-center gap-3 px-5 py-3 text-left transition hover:bg-subtle">
                <ChevronDown size={15} className={`text-faint transition ${isOpen ? '' : '-rotate-90'}`} />
                <span className="font-medium text-ink">{monthLabel(m.month)}</span>
                <span className="text-xs text-muted">{m.pieces} piece{m.pieces === 1 ? '' : 's'}</span>
                <span className="ml-auto text-sm font-semibold tabular-nums text-ink">{cur} {f2(m.payable)}</span>
                <PayBadge status={m.status} />
              </button>
              {isOpen && (
                <div className="overflow-x-auto border-t border-line bg-subtle/40">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead><tr className="text-left font-label text-[10.5px] uppercase tracking-wider text-muted">
                      <th className="px-5 py-2 font-medium">Date</th><th className="px-3 py-2 font-medium">Outfit</th><th className="px-3 py-2 font-medium">Invoice</th>
                      <th className="px-3 py-2 text-right font-medium">Gross</th><th className="px-3 py-2 text-right font-medium">Discounts</th><th className="px-3 py-2 text-right font-medium">Alt</th>
                      <th className="px-3 py-2 text-right font-medium">Net payable</th><th className="px-5 py-2 font-medium" />
                    </tr></thead>
                    <tbody className="divide-y divide-line">
                      {m.items.map((p) => (
                        <tr key={p.id} onClick={() => onOpen(p)} className="cursor-pointer tabular-nums transition hover:bg-surface">
                          <td className="whitespace-nowrap px-5 py-2 text-ink-soft">{fmtDate(p.soldOn)}</td>
                          <td className="px-3 py-2"><div className="flex items-center gap-2.5">
                            {p.imageUrl ? <img src={p.imageUrl} alt="" className="h-9 w-9 rounded-md object-cover object-top" loading="lazy" /> : <div className="h-9 w-9 rounded-md bg-subtle2" />}
                            <span className="font-medium text-ink">{p.product} <span className="font-normal text-faint">· {p.size}</span></span>
                          </div></td>
                          <td className="px-3 py-2 text-xs text-muted">{p.resellerInvoiceNo || '—'}</td>
                          <td className="px-3 py-2 text-right text-ink-soft">{f2(p.aedPrice)}</td>
                          <td className="px-3 py-2 text-right text-ink-soft">{(p.designerDiscount || 0) + (p.resellerDiscount || 0) ? f2((p.designerDiscount || 0) + (p.resellerDiscount || 0)) : '—'}</td>
                          <td className="px-3 py-2 text-right text-ink-soft">{p.alterationCharge ? f2(p.alterationCharge) : '—'}</td>
                          <td className="px-3 py-2 text-right font-semibold text-ink">{f2(pieceMoney(p).netPayable)}</td>
                          <td className="px-5 py-2 text-right text-[10px] font-semibold">{p.status === 'FC - Paid' ? <span className="text-emerald-700">PAID</span> : <span className="text-orange-600">DUE</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Enter several sales from a statement at once ───────────────────────
function EnterSales({ reseller, pieces, months, onSaved }) {
  const available = pieces.filter((p) => p.status === 'FC - At Store')
  const [lines, setLines] = useState([])
  const [saving, setSaving] = useState(false)
  const [detail, setDetail] = useState(null)
  const byId = new Map(pieces.map((p) => [p.id, p]))
  const set = (key, patch) => setLines((l) => l.map((x) => (x.key === key ? { ...x, ...patch } : x)))
  const used = new Set(lines.map((l) => l.pieceId))
  const cur = reseller.currency

  // One tap = one sale line for the next free piece of that outfit and size
  const pick = (productId, size) => {
    const p = available.find((a) => a.productId === productId && a.size === size && !used.has(a.id))
    if (!p) return
    setLines((l) => [...l, { key: ++seq, pieceId: p.id, soldOn: l[l.length - 1]?.soldOn || today(), invoiceNo: '', code: p.resellerCode || '', designerDiscount: '', resellerDiscount: '', alterationCharge: '' }])
  }
  const lineMoney = (l) => {
    const p = byId.get(l.pieceId)
    return p ? pieceMoney({ ...p, designerDiscount: Number(l.designerDiscount) || 0, resellerDiscount: Number(l.resellerDiscount) || 0, alterationCharge: Number(l.alterationCharge) || 0 }) : null
  }
  const total = lines.reduce((s, l) => s + (lineMoney(l)?.netPayable || 0), 0)

  const save = async () => {
    if (!lines.length) return toast.error('Tap a size above to add a sale')
    setSaving(true)
    try {
      await enterStatement(reseller.id, lines.map((l) => ({ ...l, designerDiscount: Number(l.designerDiscount) || 0, resellerDiscount: Number(l.resellerDiscount) || 0, alterationCharge: Number(l.alterationCharge) || 0 })))
      toast.success(`${lines.length} sale${lines.length === 1 ? '' : 's'} recorded`)
      setLines([])
      onSaved()
    } catch (err) { toast.error(err.message) } finally { setSaving(false) }
  }

  return (
    <div className="space-y-4">
      {available.length ? <OutfitPicker available={available} used={used} onPick={pick} cur={cur} />
        : <EmptyState icon={ReceiptText} title="Nothing at the store" hint="Every piece is already sold, paid or returned." />}

      {lines.length > 0 && (
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {lines.map((l) => {
              const p = byId.get(l.pieceId)
              const m = lineMoney(l)
              return (
                <motion.div key={l.key} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.2, ease }} className="card grid gap-3 p-4 md:grid-cols-12">
                  <div className="flex items-center gap-3 md:col-span-4">
                    {p.imageUrl ? <img src={p.imageUrl} alt="" className="h-14 w-11 flex-shrink-0 rounded-md object-cover object-top" /> : <div className="h-14 w-11 flex-shrink-0 rounded-md bg-subtle2" />}
                    <div className="min-w-0"><p className="truncate font-medium text-ink">{p.product}</p><p className="text-xs text-muted">{p.size} · {cur} {f2(p.aedPrice)}</p></div>
                  </div>
                  <Field label="Sale date" className="md:col-span-2"><input type="date" className="input" value={l.soldOn} onChange={(e) => set(l.key, { soldOn: e.target.value })} /></Field>
                  <Field label="Invoice no" className="md:col-span-3"><input className="input" value={l.invoiceNo} onChange={(e) => set(l.key, { invoiceNo: e.target.value })} placeholder="Order 00843-003-0002" /></Field>
                  <Field label="Code" className="md:col-span-3"><input className="input" value={l.code} onChange={(e) => set(l.key, { code: e.target.value })} placeholder="KOATLR-010" /></Field>
                  <Field label="Designer disc." className="md:col-span-3">
                    <div className="flex gap-1.5">
                      <input type="number" min="0" className="input" value={l.designerDiscount} onChange={(e) => set(l.key, { designerDiscount: e.target.value })} placeholder="0" />
                      <button type="button" className="btn-secondary px-2 text-xs" onClick={() => set(l.key, { designerDiscount: String(Math.round((p.aedPrice || 0) * 10) / 100) })}>10%</button>
                    </div>
                  </Field>
                  <Field label="Collage disc." className="md:col-span-2"><input type="number" min="0" className="input" value={l.resellerDiscount} onChange={(e) => set(l.key, { resellerDiscount: e.target.value })} placeholder="0" /></Field>
                  <Field label="Alt / Laundry" className="md:col-span-2"><input type="number" min="0" className="input" value={l.alterationCharge} onChange={(e) => set(l.key, { alterationCharge: e.target.value })} placeholder="0" /></Field>
                  <div className="flex items-end justify-between gap-3 md:col-span-5">
                    <div className="text-sm"><p className="text-xs text-muted">Net price {f2(m.netPrice)} · commission {f2(m.commission)}</p><p className="font-display text-[17px] font-semibold text-emerald-700 dark:text-emerald-400">Net payable {cur} {f2(m.netPayable)}</p></div>
                    <button className="btn-icon hover:text-rose-600" onClick={() => setLines((x) => x.filter((y) => y.key !== l.key))} aria-label="Remove"><Trash2 size={15} /></button>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <p className="text-sm text-muted">{lines.length} line{lines.length === 1 ? '' : 's'} · total net payable <span className="font-display text-[17px] font-semibold text-ink">{cur} {f2(total)}</span></p>
            <button className="btn-primary" onClick={save} disabled={saving}><ReceiptText size={15} />{saving ? 'Saving…' : 'Record sales'}</button>
          </div>
        </div>
      )}
      {!lines.length && available.length > 0 && <p className="flex items-center gap-2 text-sm text-muted"><Plus size={14} />Pick outfits above; each one becomes a sale line here.</p>}

      <RecordedSales months={months} cur={cur} onOpen={setDetail} />
      {detail && (
        <SaleDetailsModal piece={detail} onClose={() => setDetail(null)}
          onSave={async (changes) => { await updateConsignmentItem(detail.id, changes); toast.success('Sale details saved'); onSaved() }} />
      )}
    </div>
  )
}

export default function Statements() {
  const { resellerId } = useParams()
  const { user, can } = useAuth()
  const canWrite = can('fc:write')
  const [data, setData] = useState(null)
  const [payments, setPayments] = useState([])
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('statement')
  const [payMonth, setPayMonth] = useState(null)

  const load = useCallback(async () => {
    try {
      const [d, p] = await Promise.all([getConsignments(resellerId), getPayments(resellerId).catch(() => [])])
      setData(d); setPayments(p); setError(null)
    } catch (e) { setError(e.message) }
  }, [resellerId])
  useEffect(() => { setData(null); load() }, [load])

  const reseller = data?.resellers.find((r) => String(r.id) === String(resellerId))
  const months = useMemo(() => monthlySummary(data?.items || [], payments), [data, payments])
  const tabs = [{ value: 'statement', label: 'Statement' }, ...(canWrite ? [{ value: 'enter', label: 'Enter sales' }] : []), { value: 'payments', label: 'Payments' }]
  const recordFor = canWrite ? (month) => { setPayMonth(month); setTab('payments') } : null

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="print:hidden">
        <PageHeader eyebrow={reseller?.name || 'Reseller'} title="Statements" icon={FileText}
          subtitle="Sales, commission and what the reseller owes Koko" actions={<Segmented options={tabs} value={tab} onChange={setTab} />} />
      </div>
      <ErrorBanner onRetry={load}>{error}</ErrorBanner>
      {!data || !reseller ? <SkeletonRows rows={6} /> : (
        <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease }}>
          {tab === 'statement' && <StatementView reseller={reseller} pieces={data.items} payments={payments} months={months} showPkr={user?.role !== 'reseller'} onRecord={recordFor} />}
          {tab === 'enter' && canWrite && <EnterSales reseller={reseller} pieces={data.items} months={months} onSaved={load} />}
          {tab === 'payments' && <Payments reseller={reseller} pieces={data.items} payments={payments} canWrite={canWrite} onSaved={load}
            startMonth={payMonth} onStarted={() => setPayMonth(null)} />}
        </motion.div>
      )}
    </div>
  )
}
