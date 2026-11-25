import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { HandCoins, Plus, Trash2, Send, Save, Undo2, Ban, ChevronDown, ChevronRight, Wallet, Clock } from 'lucide-react'
import {
  getStaff, getFinCollections, getPayrollRuns, getPayrollRun, createPayrollRun, savePayrollRun, deletePayrollRun, postPayrollRun, unpostPayrollRun,
  getStaffPayments, createStaffPayment, voidStaffPayment, getStaffOwed, uploadFiles, PAID_FROM,
} from '../../data/finance'
import { PageHeader, Modal, Field, Segmented, SkeletonRows, EmptyState, ErrorBanner, fmtDate } from '../../ui/kit'
import { FinBadge, fmtRs, formatRs, safePaisa, todayPk, FilePick, askReason } from './shared'
import { saturdayOf } from './Claims'
import { confirmDialog } from '../../ui/dialog'

const TABS = [{ value: 'weeks', label: 'Weekly payroll' }, { value: 'payments', label: 'Payments to staff' }]
const PAY_FROM = Object.fromEntries(Object.entries(PAID_FROM).filter(([k]) => k !== 'unpaid'))
const JOBS = { order: 'Customer order', batch: 'Collection batch', sample: 'Sample / shoot', other: 'Other work', idle: 'Idle / waiting' }

export default function Payroll() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'weeks'
  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
      <PageHeader eyebrow="Finance" title="Payroll" icon={HandCoins} subtitle="Weekly wages (week ending Saturday) and every payment to staff" />
      <Segmented options={TABS} value={tab} onChange={(v) => setParams({ tab: v })} />
      {tab === 'payments' ? <Payments payStaff={params.get('pay')} /> : <Weeks />}
    </div>
  )
}

function Weeks() {
  const navigate = useNavigate()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [weekEnding, setWeekEnding] = useState(saturdayOf(todayPk()))
  const load = () => getPayrollRuns().then((r) => { setRows(r); setError(null) }).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])
  const create = async () => {
    try { const r = await createPayrollRun(weekEnding); navigate(`/finance/payroll/${r.id}`) } catch (err) { toast.error(err.message) }
  }
  return (
    <>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Week ending (Saturday)"><input type="date" className="input w-auto" value={weekEnding} onChange={(e) => setWeekEnding(e.target.value)} /></Field>
        <button className="btn-primary" onClick={create}><Plus size={16} />Start this week</button>
      </div>
      <ErrorBanner onRetry={load}>{error}</ErrorBanner>
      {!rows ? <SkeletonRows rows={4} /> : rows.length === 0 ? <EmptyState icon={HandCoins} title="No payroll yet" hint="Start a week: everyone on a weekly salary is filled in at full attendance." /> : (
        <div className="card divide-y divide-line">
          {rows.map((r) => (
            <Link key={r.id} to={`/finance/payroll/${r.id}`} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-subtle/60">
              <div className="flex-1"><p className="font-medium text-ink">Week ending {fmtDate(r.weekEnding)}</p><p className="text-xs text-muted">{r.staff} staff{Number(r.income) ? ` · income ${fmtRs(r.income, { decimals: false })}` : ''}</p></div>
              <span className="font-semibold tabular-nums text-ink">{fmtRs(r.gross)}</span><FinBadge status={r.status} />
            </Link>
          ))}
        </div>
      )}
    </>
  )
}

// ── One week ───────────────────────────────────────────────────────────
let seq = 0
export function PayrollWeek() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [run, setRun] = useState(null)
  const [lines, setLines] = useState([])
  const [income, setIncome] = useState([])
  const [notes, setNotes] = useState('')
  const [staff, setStaff] = useState([])
  const [collections, setCollections] = useState([])
  const [open, setOpen] = useState({})
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)

  const take = (r) => {
    setRun(r); setNotes(r.notes); setDirty(false)
    setLines(r.lines.map((l) => ({ ...l, key: ++seq, override: '', hours: l.hours.map((h) => ({ ...h, key: ++seq })) })))
    setIncome(r.income.map((x) => ({ ...x, key: ++seq })))
  }
  const load = useCallback(() => getPayrollRun(id).then(take).catch((e) => toast.error(e.message)), [id])
  useEffect(() => { load(); Promise.all([getStaff(), getFinCollections()]).then(([s, c]) => { setStaff(s); setCollections(c) }).catch(() => {}) }, [load])

  const draft = run?.status === 'Draft'
  const wd = run?.workingDays || 6
  const grossOf = (l) => (l.override !== '' ? safePaisa(l.override) : draft ? Math.round((safePaisa(l.weeklySalary) * Number(l.daysPresent || 0)) / wd) : safePaisa(l.grossPay))
  const setLine = (key, p) => { setDirty(true); setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l))) }
  const setHour = (lk, hk, p) => setLine(lk, { hours: lines.find((l) => l.key === lk).hours.map((h) => (h.key === hk ? { ...h, ...p } : h)) })
  const totals = useMemo(() => lines.reduce((t, l) => { const g = grossOf(l), a = safePaisa(l.advanceRecovered) || 0; return { gross: t.gross + g, adv: t.adv + a, net: t.net + g - a } }, { gross: 0, adv: 0, net: 0 }), [lines, run]) // eslint-disable-line react-hooks/exhaustive-deps
  const missing = staff.filter((s) => s.isActive && !lines.some((l) => l.staffId === s.id))

  const payload = () => ({
    notes,
    lines: lines.map((l) => ({ staffId: l.staffId, weeklySalary: l.weeklySalary, daysPresent: l.daysPresent, hoursWorked: l.hoursWorked, grossPay: l.override,
      advanceRecovered: l.advanceRecovered, notes: l.notes, hours: l.hours.map(({ jobType, collectionId, description, hours }) => ({ jobType, collectionId: collectionId || null, description, hours })) })),
    income: income.map(({ kind, staffId, description, pieces, amount, receivedInto }) => ({ kind, staffId, description, pieces, amount, receivedInto })),
  })
  const run_ = async (fn, msg) => { setBusy(true); try { take(await fn()); if (msg) toast.success(msg) } catch (err) { toast.error(err.message) } finally { setBusy(false) } }
  const save = () => run_(() => savePayrollRun(id, payload()), 'Saved')
  const post = () => run_(async () => { await savePayrollRun(id, payload()); return postPayrollRun(id) }, 'Posted to the books')
  const unpost = async () => { const r = await askReason('Undo this week? Its postings are reversed and it becomes a draft again.'); if (r) run_(() => unpostPayrollRun(id, r), 'Week undone') }
  const remove = async () => { if (!await confirmDialog('Delete this draft week?')) return; try { await deletePayrollRun(id); navigate('/finance/payroll') } catch (err) { toast.error(err.message) } }

  if (!run) return <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8"><SkeletonRows rows={6} /></div>
  const inputCls = 'input py-1 text-sm tabular-nums disabled:bg-transparent disabled:ring-0'
  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
      <PageHeader eyebrow="Payroll" title={`Week ending ${fmtDate(run.weekEnding)}`} icon={HandCoins}
        subtitle={run.parts.length > 1 ? `Runs over a month end: wages are booked ${run.parts.map((p) => `${p.days} days in ${fmtDate(`${p.month}-01`, { month: 'long' })}`).join(' and ')}` : `${wd} working days · Sunday off`}
        actions={<FinBadge status={run.status} />} />

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-surface-accent text-left font-label text-[10.5px] uppercase tracking-wider text-ink">
            <tr><th className="w-8" /><th className="px-2 py-2.5 font-medium">Staff</th><th className="w-28 px-2 py-2.5 text-right font-medium">Salary / week</th>
              <th className="w-20 px-2 py-2.5 text-right font-medium">Days</th><th className="w-20 px-2 py-2.5 text-right font-medium">Hours</th>
              <th className="w-32 px-2 py-2.5 text-right font-medium">Pay</th><th className="w-28 px-2 py-2.5 text-right font-medium">Advance back</th>
              <th className="w-28 px-2 py-2.5 text-right font-medium">Net</th><th className="w-24 px-3 py-2.5 font-medium">{draft ? '' : 'Paid'}</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {lines.map((l) => {
              const g = grossOf(l), net = g - (safePaisa(l.advanceRecovered) || 0)
              const jobHours = l.hours.reduce((s, h) => s + Number(h.hours || 0), 0)
              return [
                <tr key={l.key}>
                  <td className="pl-3"><button className="btn-icon" onClick={() => setOpen((o) => ({ ...o, [l.key]: !o[l.key] }))} aria-label="Hours by job">{open[l.key] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button></td>
                  <td className="px-2 py-1.5"><p className="font-medium text-ink">{l.name}</p><p className="text-xs text-muted">{l.roleTitle}{l.isProduction ? ' · production' : ''}{jobHours ? ` · ${jobHours} h by job` : ''}</p></td>
                  <td className="px-2 py-1.5"><input disabled={!draft} inputMode="decimal" className={`${inputCls} text-right`} value={l.weeklySalary} onChange={(e) => setLine(l.key, { weeklySalary: e.target.value })} /></td>
                  <td className="px-2 py-1.5"><input disabled={!draft} inputMode="decimal" className={`${inputCls} text-right`} value={l.daysPresent} onChange={(e) => setLine(l.key, { daysPresent: e.target.value })} /></td>
                  <td className="px-2 py-1.5"><input disabled={!draft} inputMode="decimal" className={`${inputCls} text-right`} value={l.hoursWorked} onChange={(e) => setLine(l.key, { hoursWorked: e.target.value })} /></td>
                  <td className="px-2 py-1.5"><input disabled={!draft} inputMode="decimal" className={`${inputCls} text-right font-semibold`} value={l.override !== '' ? l.override : (g / 100).toFixed(2)}
                    onChange={(e) => setLine(l.key, { override: e.target.value })} title="Worked out from the days; type to change it" /></td>
                  <td className="px-2 py-1.5"><input disabled={!draft} inputMode="decimal" className={`${inputCls} text-right`} value={l.advanceRecovered} onChange={(e) => setLine(l.key, { advanceRecovered: e.target.value })} /></td>
                  <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-ink">{formatRs(net)}</td>
                  <td className="px-3 py-1.5">{draft
                    ? <button className="btn-icon hover:text-rose-600" onClick={() => { setDirty(true); setLines((ls) => ls.filter((x) => x.key !== l.key)) }} aria-label="Remove from this week"><Trash2 size={14} /></button>
                    : net <= 0 ? <span className="text-faint">—</span> : safePaisa(l.paid) >= net ? <FinBadge status="Paid" /> : <Link className="text-xs font-semibold text-accent" to={`/finance/payroll?tab=payments&pay=${l.staffId}`}>Pay</Link>}</td>
                </tr>,
                open[l.key] && (
                  <tr key={`${l.key}-h`} className="bg-subtle/40"><td /><td colSpan={8} className="px-2 py-3">
                    <p className="mb-2 flex items-center gap-1.5 text-xs text-muted"><Clock size={12} />Hours by job: what the week went into (used for costing designs later)</p>
                    <div className="space-y-1.5">
                      {l.hours.map((h) => (
                        <div key={h.key} className="flex flex-wrap items-center gap-2">
                          <select disabled={!draft} className="input w-44 py-1 text-sm" value={h.jobType} onChange={(e) => setHour(l.key, h.key, { jobType: e.target.value })}>{Object.entries(JOBS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                          {h.jobType === 'batch' && <select disabled={!draft} className="input w-48 py-1 text-sm" value={h.collectionId || ''} onChange={(e) => setHour(l.key, h.key, { collectionId: e.target.value })}><option value="">Collection…</option>{collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
                          <input disabled={!draft} className="input min-w-[160px] flex-1 py-1 text-sm" value={h.description} onChange={(e) => setHour(l.key, h.key, { description: e.target.value })} placeholder={h.jobType === 'order' ? 'Order number or customer' : 'Details'} />
                          <input disabled={!draft} inputMode="decimal" className="input w-20 py-1 text-right text-sm" value={h.hours} onChange={(e) => setHour(l.key, h.key, { hours: e.target.value })} placeholder="h" />
                          {draft && <button className="btn-icon" onClick={() => setLine(l.key, { hours: l.hours.filter((x) => x.key !== h.key) })} aria-label="Remove"><Trash2 size={13} /></button>}
                        </div>
                      ))}
                      {draft && <button className="btn-ghost text-xs" onClick={() => setLine(l.key, { hours: [...l.hours, { key: ++seq, jobType: 'order', description: '', hours: '' }] })}><Plus size={12} />Add job</button>}
                    </div>
                  </td></tr>
                ),
              ]
            })}
          </tbody>
          <tfoot><tr className="border-t-2 border-line bg-subtle/60 font-semibold tabular-nums">
            <td colSpan={5} className="px-3 py-2.5">{draft && missing.length > 0 && (
              <select className="input w-auto py-1 text-sm" value="" onChange={(e) => { const s = staff.find((x) => String(x.id) === e.target.value); if (s) { setDirty(true); setLines((ls) => [...ls, { key: ++seq, staffId: s.id, name: s.name, roleTitle: s.roleTitle, isProduction: s.isProduction, weeklySalary: s.weeklySalary || '0', daysPresent: wd, hoursWorked: '', override: '', advanceRecovered: '0', notes: '', hours: [] }]) } }}>
                <option value="">+ Add someone to this week…</option>{missing.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>)}</td>
            <td className="px-2 py-2.5 text-right text-ink">{formatRs(totals.gross)}</td><td className="px-2 py-2.5 text-right text-ink">{formatRs(totals.adv)}</td>
            <td className="px-2 py-2.5 text-right text-ink">{formatRs(totals.net)}</td><td />
          </tr></tfoot>
        </table>
      </div>

      <div className="card space-y-3 p-5">
        <div><p className="font-semibold text-ink">Studio income this week</p><p className="text-xs text-muted">Custom tailoring or alterations done for outside customers (4300), and commission on per-piece work such as Manaf's (4400)</p></div>
        {income.map((x) => (
          <div key={x.key} className="flex flex-wrap items-center gap-2">
            <select disabled={!draft} className="input w-40 py-1.5 text-sm" value={x.kind} onChange={(e) => { setDirty(true); setIncome((xs) => xs.map((y) => (y.key === x.key ? { ...y, kind: e.target.value } : y))) }}><option value="commission">Commission</option><option value="custom_work">Custom work</option></select>
            <select disabled={!draft} className="input w-44 py-1.5 text-sm" value={x.staffId} onChange={(e) => { setDirty(true); setIncome((xs) => xs.map((y) => (y.key === x.key ? { ...y, staffId: e.target.value } : y))) }}>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <input disabled={!draft} className="input w-20 py-1.5 text-sm" value={x.pieces || ''} onChange={(e) => { setDirty(true); setIncome((xs) => xs.map((y) => (y.key === x.key ? { ...y, pieces: e.target.value } : y))) }} placeholder="Pieces" />
            <input disabled={!draft} className="input min-w-[140px] flex-1 py-1.5 text-sm" value={x.description} onChange={(e) => { setDirty(true); setIncome((xs) => xs.map((y) => (y.key === x.key ? { ...y, description: e.target.value } : y))) }} placeholder="Details" />
            <select disabled={!draft} className="input w-44 py-1.5 text-sm" value={x.receivedInto} onChange={(e) => { setDirty(true); setIncome((xs) => xs.map((y) => (y.key === x.key ? { ...y, receivedInto: e.target.value } : y))) }}>{Object.entries(PAY_FROM).map(([k, v]) => <option key={k} value={k}>Into {v.toLowerCase()}</option>)}</select>
            <input disabled={!draft} inputMode="decimal" className="input w-28 py-1.5 text-right text-sm" value={x.amount} onChange={(e) => { setDirty(true); setIncome((xs) => xs.map((y) => (y.key === x.key ? { ...y, amount: e.target.value } : y))) }} placeholder="Rs" />
            {draft && <button className="btn-icon" onClick={() => { setDirty(true); setIncome((xs) => xs.filter((y) => y.key !== x.key)) }} aria-label="Remove"><Trash2 size={13} /></button>}
          </div>
        ))}
        {draft && <button className="btn-ghost text-xs" onClick={() => { setDirty(true); setIncome((xs) => [...xs, { key: ++seq, kind: 'commission', staffId: (staff.find((s) => s.payType === 'per_piece_external') || staff[0])?.id, description: '', pieces: '', amount: '', receivedInto: 'cash' }]) }}><Plus size={12} />Add income</button>}
        {!draft && !income.length && <p className="text-sm text-muted">None.</p>}
      </div>

      <Field label="Notes"><input disabled={!draft} className="input" value={notes} onChange={(e) => { setDirty(true); setNotes(e.target.value) }} /></Field>
      {run.entries.length > 0 && <p className="flex flex-wrap gap-2 text-xs text-muted">Postings: {run.entries.map((e) => <Link key={e.id} to={`/finance/journals/${e.id}`} className={`font-mono font-semibold ${e.status === 'Reversed' ? 'text-faint line-through' : 'text-accent'}`}>{e.entryNo}</Link>)}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        {draft ? <>
          {!run.entries.length && <button className="btn-secondary text-rose-700" onClick={remove} disabled={busy}><Trash2 size={15} />Delete</button>}
          <button className="btn-secondary" onClick={save} disabled={busy || !dirty}><Save size={15} />Save</button>
          <button className="btn-primary" onClick={post} disabled={busy}><Send size={15} />{busy ? 'Posting…' : 'Post week'}</button>
        </> : <>
          <button className="btn-secondary" onClick={unpost} disabled={busy}><Undo2 size={15} />Undo week</button>
          <Link className="btn-primary" to="/finance/payroll?tab=payments"><Wallet size={15} />Pay staff</Link>
        </>}
      </div>
    </div>
  )
}

// ── Payments to staff ──────────────────────────────────────────────────
function Payments({ payStaff }) {
  const [rows, setRows] = useState(null)
  const [staff, setStaff] = useState([])
  const [paying, setPaying] = useState(payStaff || null)
  const load = () => { getStaffPayments().then(setRows).catch((e) => toast.error(e.message)); getStaff().then(setStaff).catch(() => {}) }
  useEffect(() => { load() }, [])
  useEffect(() => { if (payStaff) setPaying(payStaff) }, [payStaff])
  const doVoid = async (p) => { const r = await askReason(`Void the payment of ${fmtRs(p.amount)} to ${p.staffName}?`); if (!r) return; try { await voidStaffPayment(p.id, r); toast.success('Voided'); load() } catch (err) { toast.error(err.message) } }
  const owing = staff.filter((s) => safePaisa(s.owedWages) > 0 || safePaisa(s.owedClaims) > 0)
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary" onClick={() => setPaying('')}><Wallet size={16} />Pay someone</button>
        {owing.map((s) => <button key={s.id} className="rounded-full border border-line px-3 py-1 text-xs text-ink hover:border-accent" onClick={() => setPaying(String(s.id))}>
          {s.name}: owed {formatRs(Math.max(0, safePaisa(s.owedWages)) + Math.max(0, safePaisa(s.owedClaims)), { decimals: false })}</button>)}
      </div>
      {!rows ? <SkeletonRows rows={4} /> : rows.length === 0 ? <EmptyState icon={Wallet} title="No payments yet" hint="Pay salary and approved claims together in one transfer." /> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="bg-surface-accent text-left font-label text-[10.5px] uppercase tracking-wider text-ink">
              <tr><th className="px-4 py-2.5 font-medium">Date</th><th className="px-3 py-2.5 font-medium">Paid to</th><th className="px-3 py-2.5 font-medium">For</th>
                <th className="px-3 py-2.5 font-medium">From</th><th className="px-3 py-2.5 text-right font-medium">Amount</th><th className="px-4 py-2.5" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((p) => (
                <tr key={p.id} className={p.status === 'Void' ? 'opacity-50' : ''}>
                  <td className="whitespace-nowrap px-4 py-2.5 text-ink-soft">{fmtDate(p.paidOn)}</td>
                  <td className="px-3 py-2.5 text-ink">{p.staffName}{p.reference && <p className="font-mono text-[11px] text-muted">{p.reference}</p>}</td>
                  <td className="px-3 py-2.5 text-xs text-muted">{p.parts.map((x) => `${x.kind}${x.weekEnding ? ` w/e ${fmtDate(x.weekEnding, { day: 'numeric', month: 'short' })}` : ''} ${fmtRs(x.amount, { decimals: false })}`).join(' + ')}</td>
                  <td className="px-3 py-2.5 text-xs text-muted">{PAY_FROM[p.paidFrom]}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-ink">{fmtRs(p.amount)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right">{p.status === 'Void' ? <FinBadge status="Void" /> : <>
                    <Link to={`/finance/journals/${p.entryId}`} className="mr-2 font-mono text-xs font-semibold text-accent">{p.entryNo}</Link>
                    <button className="btn-icon hover:text-rose-600" onClick={() => doVoid(p)} aria-label="Void"><Ban size={14} /></button></>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {paying !== null && <PayModal staff={staff} initial={paying} onClose={() => setPaying(null)} onPaid={() => { setPaying(null); load() }} />}
    </>
  )
}

// One transfer: tick the weeks and claims it covers, add an advance if any
function PayModal({ staff, initial, onClose, onPaid }) {
  const [staffId, setStaffId] = useState(initial || '')
  const [owed, setOwed] = useState(null)
  const [weeks, setWeeks] = useState({})
  const [claims, setClaims] = useState({})
  const [advance, setAdvance] = useState('')
  const [b, setB] = useState({ paidOn: todayPk(), paidFrom: 'bank', reference: '', notes: '' })
  const [files, setFiles] = useState([])
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setOwed(null); if (!staffId) return
    getStaffOwed(staffId).then((o) => { setOwed(o); setWeeks(Object.fromEntries(o.weeks.map((w) => [w.payrollLineId, w.due]))); setClaims(Object.fromEntries(o.claims.map((c) => [c.id, true]))) }).catch((e) => toast.error(e.message))
  }, [staffId])
  const parts = owed ? [
    ...owed.weeks.filter((w) => weeks[w.payrollLineId] !== undefined && safePaisa(weeks[w.payrollLineId]) > 0).map((w) => ({ kind: 'salary', payrollLineId: w.payrollLineId, amount: weeks[w.payrollLineId] })),
    ...owed.claims.filter((c) => claims[c.id]).map((c) => ({ kind: 'claim', claimId: c.id, amount: c.total })),
    ...(safePaisa(advance) > 0 ? [{ kind: 'advance', amount: advance }] : []),
  ] : []
  const total = parts.reduce((s, x) => s + (safePaisa(x.amount) || 0), 0)
  const pay = async () => {
    setSaving(true)
    try {
      const fileIds = await uploadFiles(files, 'staff-payments')
      const p = await createStaffPayment({ staffId, ...b, amount: (total / 100).toFixed(2), parts, fileIds })
      toast.success(`Paid ${p.staffName} ${fmtRs(p.amount)} · ${p.entryNo}`)
      onPaid()
    } catch (err) { toast.error(err.message) } finally { setSaving(false) }
  }
  return (
    <Modal open onClose={onClose} title="Pay staff" subtitle="Salary and approved claims can go in one transfer" size="lg"
      footer={<><span className="mr-auto self-center text-sm font-semibold text-ink">Total {formatRs(total)}</span><button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={pay} disabled={saving || !total}>{saving ? 'Saving…' : `Record ${formatRs(total)}`}</button></>}>
      <div className="space-y-4 p-5 text-sm">
        <Field label="Paid to"><select className="input" value={staffId} onChange={(e) => setStaffId(e.target.value)}><option value="">Choose…</option>{staff.filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        {staffId && !owed && <SkeletonRows rows={2} />}
        {owed && <>
          <div className="space-y-2">
            <p className="font-label text-[11px] font-semibold uppercase tracking-wider text-muted">Salary</p>
            {owed.weeks.length === 0 && <p className="text-muted">No posted weeks waiting to be paid.</p>}
            {owed.weeks.map((w) => (
              <label key={w.payrollLineId} className="flex items-center gap-3">
                <input type="checkbox" checked={weeks[w.payrollLineId] !== undefined} onChange={(e) => setWeeks((x) => { const n = { ...x }; if (e.target.checked) n[w.payrollLineId] = w.due; else delete n[w.payrollLineId]; return n })} />
                <span className="flex-1 text-ink">Week ending {fmtDate(w.weekEnding)} <span className="text-xs text-muted">net {fmtRs(w.net)}{safePaisa(w.paid) ? `, paid ${fmtRs(w.paid)}` : ''}</span></span>
                {weeks[w.payrollLineId] !== undefined && <input inputMode="decimal" className="input w-32 py-1 text-right" value={weeks[w.payrollLineId]} onChange={(e) => setWeeks((x) => ({ ...x, [w.payrollLineId]: e.target.value }))} />}
              </label>
            ))}
          </div>
          <div className="space-y-2">
            <p className="font-label text-[11px] font-semibold uppercase tracking-wider text-muted">Approved claims</p>
            {owed.claims.length === 0 && <p className="text-muted">None waiting.</p>}
            {owed.claims.map((c) => (
              <label key={c.id} className="flex items-center gap-3"><input type="checkbox" checked={!!claims[c.id]} onChange={(e) => setClaims((x) => ({ ...x, [c.id]: e.target.checked }))} />
                <span className="flex-1 text-ink">Week ending {fmtDate(c.weekEnding)}</span><span className="tabular-nums text-ink">{fmtRs(c.total)}</span></label>
            ))}
          </div>
          <Field label="Advance (optional)" hint={safePaisa(owed.advances) ? `Already advanced: ${fmtRs(owed.advances)}` : 'Recovered from a later week\'s pay'}><input inputMode="decimal" className="input w-40" value={advance} onChange={(e) => setAdvance(e.target.value)} /></Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Date"><input type="date" className="input" value={b.paidOn} onChange={(e) => setB({ ...b, paidOn: e.target.value })} /></Field>
            <Field label="Paid from"><select className="input" value={b.paidFrom} onChange={(e) => setB({ ...b, paidFrom: e.target.value })}>{Object.entries(PAY_FROM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Bank reference"><input className="input" value={b.reference} onChange={(e) => setB({ ...b, reference: e.target.value })} placeholder="e.g. 323447769421" /></Field>
          </div>
          <FilePick files={files} onChange={setFiles} label="Attach the transfer screenshot" />
        </>}
      </div>
    </Modal>
  )
}
