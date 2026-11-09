import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import { FileText, Printer, Plus, Trash2, Wallet, ReceiptText, Banknote, Undo2 } from 'lucide-react'
import { getConsignments, getPayments, enterStatement, recordPayment, deletePayment, pieceMoney } from '../../data/storage'
import { useAuth } from '../../auth/AuthContext'
import { PageHeader, Segmented, Modal, Field, StatCard, SkeletonRows, EmptyState, ErrorBanner, fmtDate } from '../../ui/kit'
import { ease } from '../../ui/motion'

const f2 = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const today = () => new Date().toISOString().slice(0, 10)
const monthKey = (d) => (d || '').slice(0, 7)
const monthLabel = (k) => new Date(`${k}-01`).toLocaleDateString('en-PK', { month: 'long', year: 'numeric' })
let seq = 0

// ── Printable statement (same columns as the reseller's own statement) ──
function StatementView({ reseller, pieces, payments }) {
  const months = useMemo(() => [...new Set(pieces.filter((p) => p.soldOn).map((p) => monthKey(p.soldOn)))].sort().reverse(), [pieces])
  const [period, setPeriod] = useState('all')
  const sold = pieces.filter((p) => ['FC - Sold', 'FC - Paid'].includes(p.status) && (period === 'all' || monthKey(p.soldOn) === period))
    .sort((a, b) => (a.soldOn || '').localeCompare(b.soldOn || ''))
  const t = sold.reduce((s, p) => {
    const m = pieceMoney(p)
    return { gross: s.gross + (Number(p.aedPrice) || 0), dd: s.dd + (p.designerDiscount || 0), rd: s.rd + (p.resellerDiscount || 0), net: s.net + m.netPrice, alt: s.alt + (p.alterationCharge || 0), comm: s.comm + m.commission, payable: s.payable + m.netPayable }
  }, { gross: 0, dd: 0, rd: 0, net: 0, alt: 0, comm: 0, payable: 0 })
  const paidHere = sold.filter((p) => p.status === 'FC - Paid').reduce((s, p) => s + pieceMoney(p).netPayable, 0)
  const cur = reseller.currency

  const print = () => { document.body.classList.add('printing-report'); window.onafterprint = () => document.body.classList.remove('printing-report'); window.print() }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <select className="input w-auto" value={period} onChange={(e) => setPeriod(e.target.value)}>
          <option value="all">All sales</option>
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <button className="btn-secondary ml-auto" onClick={print}><Printer size={15} />Print / PDF</button>
      </div>

      <div className="card overflow-x-auto p-4 sm:p-6 print:border-0 print:shadow-none">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="inline-block border-2 border-plum-950 bg-gold-400 px-3 py-1 text-xs font-bold uppercase tracking-wider text-plum-950">Designer name</p>
            <p className="mt-2 font-display text-2xl font-semibold text-ink">{reseller.name}</p>
            <p className="text-xs text-muted">Sales statement · {period === 'all' ? 'all sales' : monthLabel(period)} · generated {fmtDate(today())}</p>
          </div>
          <p className="border-2 border-plum-950 bg-gold-400 px-6 py-2 font-display text-2xl font-bold tracking-wider text-plum-950">KOKO ATELIER</p>
        </div>
        {sold.length === 0 ? <p className="py-8 text-center text-sm text-muted">No sales in this period.</p> : (
          <table className="w-full min-w-[980px] border-collapse text-sm">
            <thead>
              <tr className="bg-gold-400 text-plum-950">
                {['Date', 'Inv no', 'Code', 'Product', 'Gross price', 'Designer disc.', 'Collage disc.', 'Net price', 'Alt/Laundry', 'Commission', 'Net payable', ''].map((h) => (
                  <th key={h} className="border border-plum-950/60 px-2 py-1.5 text-center text-[11px] font-bold uppercase">{h}</th>
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
                    <td className="border border-line px-2 py-1.5 text-center font-mono text-xs">{p.resellerCode || '—'}</td>
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
          <div className="rounded-lg bg-subtle p-3"><p className="text-xs text-muted">Net payable to Koko</p><p className="font-display text-2xl font-semibold text-ink">{cur} {f2(t.payable)}</p></div>
          <div className="rounded-lg bg-subtle p-3"><p className="text-xs text-muted">Already paid</p><p className="font-display text-2xl font-semibold text-emerald-700 dark:text-emerald-400">{cur} {f2(paidHere)}</p></div>
          <div className="rounded-lg bg-subtle p-3"><p className="text-xs text-muted">Still owed</p><p className="font-display text-2xl font-semibold text-orange-600">{cur} {f2(t.payable - paidHere)}</p></div>
        </div>
        {period === 'all' && payments.length > 0 && (
          <p className="mt-3 text-xs text-muted">Payments received: {payments.map((p) => `${fmtDate(p.paidOn)} ${cur} ${f2(p.amount)}${p.reference ? ` (${p.reference})` : ''}`).join(' · ')}</p>
        )}
      </div>
    </div>
  )
}

// ── Enter several sales from a statement at once ───────────────────────
function EnterSales({ reseller, pieces, onSaved }) {
  const available = pieces.filter((p) => p.status === 'FC - At Store').sort((a, b) => a.product.localeCompare(b.product) || a.size.localeCompare(b.size))
  const blankLine = () => ({ key: ++seq, pieceId: '', soldOn: today(), invoiceNo: '', code: '', designerDiscount: '', resellerDiscount: '', alterationCharge: '' })
  const [lines, setLines] = useState([blankLine()])
  const [saving, setSaving] = useState(false)
  const byId = new Map(pieces.map((p) => [p.id, p]))
  const set = (key, patch) => setLines((l) => l.map((x) => (x.key === key ? { ...x, ...patch } : x)))
  const used = new Set(lines.map((l) => l.pieceId).filter(Boolean))

  const lineMoney = (l) => {
    const p = byId.get(l.pieceId)
    return p ? pieceMoney({ ...p, designerDiscount: Number(l.designerDiscount) || 0, resellerDiscount: Number(l.resellerDiscount) || 0, alterationCharge: Number(l.alterationCharge) || 0 }) : null
  }
  const total = lines.reduce((s, l) => s + (lineMoney(l)?.netPayable || 0), 0)

  const save = async () => {
    const filled = lines.filter((l) => l.pieceId)
    if (!filled.length) return toast.error('Choose at least one piece')
    setSaving(true)
    try {
      await enterStatement(reseller.id, filled.map((l) => ({ ...l, designerDiscount: Number(l.designerDiscount) || 0, resellerDiscount: Number(l.resellerDiscount) || 0, alterationCharge: Number(l.alterationCharge) || 0 })))
      toast.success(`${filled.length} sale${filled.length === 1 ? '' : 's'} recorded`)
      setLines([blankLine()])
      onSaved()
    } catch (err) { toast.error(err.message) } finally { setSaving(false) }
  }

  if (!available.length) return <EmptyState icon={ReceiptText} title="Nothing at the store" hint="Every piece is already sold, paid or returned." />

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">One line per piece on the reseller's statement. Choosing a piece fills in its code; net payable updates as you type.</p>
      <AnimatePresence initial={false}>
        {lines.map((l) => {
          const p = byId.get(l.pieceId)
          const m = lineMoney(l)
          return (
            <motion.div key={l.key} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.2, ease }} className="card grid gap-3 p-4 md:grid-cols-12">
              <Field label="Piece" className="md:col-span-4">
                <select className="input" value={l.pieceId} onChange={(e) => { const np = byId.get(e.target.value); set(l.key, { pieceId: e.target.value, code: np?.resellerCode || '' }) }}>
                  <option value="">Choose…</option>
                  {available.filter((a) => a.id === l.pieceId || !used.has(a.id)).map((a) => <option key={a.id} value={a.id}>{a.product} · {a.size} · {reseller.currency} {a.aedPrice}</option>)}
                </select>
              </Field>
              <Field label="Sale date" className="md:col-span-2"><input type="date" className="input" value={l.soldOn} onChange={(e) => set(l.key, { soldOn: e.target.value })} /></Field>
              <Field label="Invoice no" className="md:col-span-3"><input className="input" value={l.invoiceNo} onChange={(e) => set(l.key, { invoiceNo: e.target.value })} placeholder="Order 00843-003-0002" /></Field>
              <Field label="Code" className="md:col-span-3"><input className="input" value={l.code} onChange={(e) => set(l.key, { code: e.target.value })} placeholder="KOATLR-010" /></Field>
              <Field label="Designer disc." className="md:col-span-3">
                <div className="flex gap-1.5">
                  <input type="number" min="0" className="input" value={l.designerDiscount} onChange={(e) => set(l.key, { designerDiscount: e.target.value })} placeholder="0" />
                  <button type="button" className="btn-secondary px-2 text-xs" disabled={!p} onClick={() => set(l.key, { designerDiscount: String(Math.round((p.aedPrice || 0) * 10) / 100) })}>10%</button>
                </div>
              </Field>
              <Field label="Collage disc." className="md:col-span-2"><input type="number" min="0" className="input" value={l.resellerDiscount} onChange={(e) => set(l.key, { resellerDiscount: e.target.value })} placeholder="0" /></Field>
              <Field label="Alt / Laundry" className="md:col-span-2"><input type="number" min="0" className="input" value={l.alterationCharge} onChange={(e) => set(l.key, { alterationCharge: e.target.value })} placeholder="0" /></Field>
              <div className="flex items-end justify-between gap-3 md:col-span-5">
                <div className="text-sm">{m ? <><p className="text-xs text-muted">Net price {f2(m.netPrice)} · commission {f2(m.commission)}</p><p className="font-display text-xl font-semibold text-emerald-700 dark:text-emerald-400">Net payable {reseller.currency} {f2(m.netPayable)}</p></> : <p className="text-xs text-faint">Choose a piece</p>}</div>
                {lines.length > 1 && <button className="btn-icon hover:text-rose-600" onClick={() => setLines((x) => x.filter((y) => y.key !== l.key))} aria-label="Remove"><Trash2 size={15} /></button>}
              </div>
            </motion.div>
          )
        })}
      </AnimatePresence>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-secondary" onClick={() => setLines((l) => [...l, blankLine()])} disabled={lines.length >= available.length}><Plus size={15} />Another line</button>
        <p className="ml-auto text-sm text-muted">Total net payable <span className="font-display text-xl font-semibold text-ink">{reseller.currency} {f2(total)}</span></p>
        <button className="btn-primary" onClick={save} disabled={saving}><ReceiptText size={15} />{saving ? 'Saving…' : 'Record sales'}</button>
      </div>
    </div>
  )
}

// ── Payments received ─────────────────────────────────────────────────
function Payments({ reseller, pieces, payments, canWrite, onSaved }) {
  const unpaid = pieces.filter((p) => p.status === 'FC - Sold')
  const untracked = pieces.filter((p) => p.status === 'FC - Paid' && !p.paymentId)
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [form, setForm] = useState({ paidOn: today(), amount: '', reference: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const expected = unpaid.filter((p) => selected.has(p.id)).reduce((s, p) => s + pieceMoney(p).netPayable, 0)

  const start = () => { setSelected(new Set(unpaid.map((p) => p.id))); setForm({ paidOn: today(), amount: '', reference: '', notes: '' }); setOpen(true) }
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const save = async () => {
    setSaving(true)
    try {
      const amount = form.amount === '' ? Math.round(expected * 100) / 100 : Number(form.amount)
      const r = await recordPayment(reseller.id, { ...form, amount, pieceIds: [...selected] })
      toast.success(`Payment recorded · ${r.pieces} piece${r.pieces === 1 ? '' : 's'} marked paid`)
      setOpen(false)
      onSaved()
    } catch (err) { toast.error(err.message) } finally { setSaving(false) }
  }
  const remove = async (p) => {
    if (!window.confirm(`Remove the ${fmtDate(p.paidOn)} payment? Its ${p.pieces} piece(s) go back to "Sold".`)) return
    try { await deletePayment(reseller.id, p.id); toast.success('Payment removed'); onSaved() } catch (err) { toast.error(err.message) }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Owed now (sold, unpaid)" value={unpaid.reduce((s, p) => s + pieceMoney(p).netPayable, 0)} prefix={`${reseller.currency} `} tone="orange" icon={Wallet} sub={`${unpaid.length} piece${unpaid.length === 1 ? '' : 's'}`} />
        <StatCard label="Received in total" value={payments.reduce((s, p) => s + p.amount, 0)} prefix={`${reseller.currency} `} tone="green" icon={Banknote} sub={`${payments.length} payment${payments.length === 1 ? '' : 's'}`} />
        {canWrite && <div className="card flex items-center justify-center p-4"><button className="btn-primary" onClick={start} disabled={!unpaid.length}><Plus size={15} />Record a payment</button></div>}
      </div>

      {untracked.length > 0 && <p className="text-xs text-muted">{untracked.length} piece{untracked.length === 1 ? ' was' : 's were'} marked paid before payments were tracked ({reseller.currency} {f2(untracked.reduce((s, p) => s + pieceMoney(p).netPayable, 0))}), so {untracked.length === 1 ? 'it is not' : 'they are not'} listed below.</p>}
      {payments.length === 0 ? <EmptyState icon={Banknote} title="No payments recorded" hint={unpaid.length ? 'Record a payment when the reseller transfers money.' : 'Payments appear here once sold pieces are paid for.'} /> : (
        <div className="card overflow-hidden">
          <ul className="divide-y divide-line">
            {payments.map((p) => {
              const diff = Math.round((p.amount - p.expected) * 100) / 100
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-4 px-5 py-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40"><Banknote size={18} /></div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">{fmtDate(p.paidOn)} · {p.currency} {f2(p.amount)}</p>
                    <p className="text-xs text-muted">{p.pieces} piece{p.pieces === 1 ? '' : 's'}{p.reference ? ` · ${p.reference}` : ''}{p.createdBy ? ` · by ${p.createdBy}` : ''}{p.notes ? ` · ${p.notes}` : ''}</p>
                  </div>
                  {p.pieces > 0 && Math.abs(diff) >= 1 && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${diff < 0 ? 'bg-rose-50 text-rose-700' : 'bg-sky-50 text-sky-700'}`}>{diff < 0 ? 'short' : 'over'} {p.currency} {f2(Math.abs(diff))}</span>}
                  {canWrite && <button className="btn-icon hover:text-rose-600" onClick={() => remove(p)} title="Remove payment"><Undo2 size={15} /></button>}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Record a payment" subtitle={`Money received from ${reseller.name}`} size="lg"
        footer={<><button className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button><button className="btn-primary" onClick={save} disabled={saving || !selected.size}>{saving ? 'Saving…' : `Mark ${selected.size} paid`}</button></>}>
        <div className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Date received"><input type="date" className="input" value={form.paidOn} onChange={(e) => setForm((f) => ({ ...f, paidOn: e.target.value }))} /></Field>
            <Field label={`Amount (${reseller.currency})`} hint={`Pieces total ${f2(expected)}`}><input type="number" min="0" className="input" value={form.amount} placeholder={f2(expected)} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} /></Field>
            <Field label="Reference"><input className="input" value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} placeholder="Bank transfer ref." /></Field>
          </div>
          <div className="rounded-xl border border-line">
            <div className="flex items-center justify-between border-b border-line px-3 py-2 text-xs text-muted">
              <span>Pieces this payment covers</span>
              <button className="font-semibold text-accent" onClick={() => setSelected(selected.size === unpaid.length ? new Set() : new Set(unpaid.map((p) => p.id)))}>{selected.size === unpaid.length ? 'None' : 'All'}</button>
            </div>
            <ul className="max-h-64 divide-y divide-line overflow-y-auto">
              {unpaid.map((p) => (
                <li key={p.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-subtle">
                    <input type="checkbox" className="accent-plum-600" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                    <span className="flex-1 truncate text-sm text-ink">{p.product} <span className="text-faint">· {p.size} · sold {fmtDate(p.soldOn)}</span></span>
                    <span className="text-sm font-semibold text-ink">{f2(pieceMoney(p).netPayable)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
          <Field label="Notes"><input className="input" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></Field>
        </div>
      </Modal>
    </div>
  )
}

export default function Statements() {
  const { resellerId } = useParams()
  const { can } = useAuth()
  const canWrite = can('fc:write')
  const [data, setData] = useState(null)
  const [payments, setPayments] = useState([])
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('statement')

  const load = useCallback(async () => {
    try {
      const [d, p] = await Promise.all([getConsignments(resellerId), getPayments(resellerId).catch(() => [])])
      setData(d); setPayments(p); setError(null)
    } catch (e) { setError(e.message) }
  }, [resellerId])
  useEffect(() => { setData(null); load() }, [load])

  const reseller = data?.resellers.find((r) => String(r.id) === String(resellerId))
  const tabs = [{ value: 'statement', label: 'Statement' }, ...(canWrite ? [{ value: 'enter', label: 'Enter sales' }] : []), { value: 'payments', label: 'Payments' }]

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="print:hidden">
        <PageHeader eyebrow={reseller?.name || 'Reseller'} title="Statements" icon={FileText}
          subtitle="Sales, commission and what the reseller owes Koko" actions={<Segmented options={tabs} value={tab} onChange={setTab} />} />
      </div>
      <ErrorBanner onRetry={load}>{error}</ErrorBanner>
      {!data || !reseller ? <SkeletonRows rows={6} /> : (
        <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease }}>
          {tab === 'statement' && <StatementView reseller={reseller} pieces={data.items} payments={payments} />}
          {tab === 'enter' && canWrite && <EnterSales reseller={reseller} pieces={data.items} onSaved={() => { load(); setTab('statement') }} />}
          {tab === 'payments' && <Payments reseller={reseller} pieces={data.items} payments={payments} canWrite={canWrite} onSaved={load} />}
        </motion.div>
      )}
    </div>
  )
}
