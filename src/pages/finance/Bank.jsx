import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Landmark, Upload, CheckCircle2, AlertTriangle, RefreshCw, Trash2, ChevronDown, ChevronRight, Lock, Unlock, ArrowDownLeft, ArrowUpRight, Search, Brain } from 'lucide-react'
import {
  getBankStatements, getBankStatement, previewBankStatement, importBankStatement, deleteBankStatement, autoMatchStatement, reconcileStatement,
  matchBankLine, unmatchBankLine, ignoreBankLine, bookBankLine, getBankRules, deleteBankRule, findOrdersForPayment, readStatementFile, uploadFiles,
  getAccounts, getStaff, getSuppliers,
} from '../../data/finance'
import { PageHeader, Modal, Field, Segmented, SkeletonRows, EmptyState, StatCard, fmtDate } from '../../ui/kit'
import { FinBadge, fmtRs, safePaisa, CategorySelect, AccountSelect, askReason } from './shared'
import { Num } from './reportKit'
import { useAuth } from '../../auth/AuthContext'

const CHANNEL = { ibft: 'IBFT', raast: 'Raast', transfer: 'Transfer', charge: 'Charge', other: '' }
const ACTIONS = { bank_charge: 'Bank charge', director: 'Funds from / to a director', staff: 'Staff payment', expense: 'Expense / supplier', customer: 'Customer payment', other: 'Another account' }

// Bank statements: read in the browser, matched to the books, the rest booked from the line
export default function Bank() {
  const navigate = useNavigate()
  const [rows, setRows] = useState(null)
  const [preview, setPreview] = useState(null)       // { file, read, summary }
  const [busy, setBusy] = useState('')
  const load = () => getBankStatements().then(setRows).catch((e) => toast.error(e.message))
  useEffect(() => { load() }, [])

  const pick = async (file) => {
    if (!file) return
    setBusy('Reading the statement…')
    try {
      const read = await readStatementFile(file)
      const summary = await previewBankStatement(read)
      setPreview({ file, read, summary })
    } catch (err) { toast.error(err.message) } finally { setBusy('') }
  }
  const doImport = async () => {
    setBusy('Importing…')
    try {
      // The original file is kept with the statement as proof (in the app's own database)
      let fileId = null
      if (preview.file.size <= 2.5 * 1024 * 1024) fileId = (await uploadFiles([preview.file], 'Bank statements'))[0]
      const st = await importBankStatement({ ...preview.read, fileId })
      toast.success(`Imported ${st.lines.length} lines; ${st.autoMatched} matched to the books`)
      navigate(`/finance/bank/${st.id}`)
    } catch (err) { toast.error(err.message) } finally { setBusy('') }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
      <PageHeader eyebrow="Finance" title="Bank reconciliation" icon={Landmark}
        subtitle="Import the monthly statement. It is read here in the app, matched to the books, and you book whatever is missing."
        actions={<label className={`btn-primary cursor-pointer ${busy ? 'pointer-events-none opacity-60' : ''}`}><Upload size={16} />{busy || 'Import statement'}
          <input type="file" accept=".pdf,.csv,.xlsx,.xls,application/pdf" className="sr-only" onChange={(e) => { pick(e.target.files[0]); e.target.value = '' }} /></label>} />
      <p className="text-xs text-muted">Bank Alfalah monthly statement as PDF (from Alfa or internet banking), or a CSV / Excel export. Statements are never sent outside the app; only the last 4 digits of account and phone numbers are kept with the lines.</p>
      {!rows ? <SkeletonRows rows={4} /> : rows.length === 0 ? <EmptyState icon={Landmark} title="No statements yet" hint="Import October 2026 to start." /> : (
        <div className="card divide-y divide-line">
          {rows.map((s) => (
            <Link key={s.id} to={`/finance/bank/${s.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm hover:bg-subtle/60">
              <div className="min-w-0 flex-1"><p className="font-medium text-ink">{fmtDate(s.from)} to {fmtDate(s.to)}</p><p className="text-xs text-muted">{s.account} · {s.lines} lines · {s.source.toUpperCase()}</p></div>
              <span className="text-xs text-muted">closing <b className="text-ink">{fmtRs(s.closing)}</b></span>
              {s.unmatched ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-600/20">{s.unmatched} to do</span> : null}
              <FinBadge status={s.status === 'Reconciled' ? 'Posted' : 'Open'} />
              {s.status === 'Reconciled' && <span className="text-[11px] font-semibold text-emerald-700">Reconciled</span>}
            </Link>
          ))}
        </div>
      )}
      <Rules />
      {preview && <PreviewModal p={preview} busy={busy} onClose={() => setPreview(null)} onImport={doImport} />}
    </div>
  )
}

function PreviewModal({ p, busy, onClose, onImport }) {
  const s = p.summary
  const ok = s.checks.balanceChain && s.checks.closingMatches !== false && s.account && s.lines.length
  return (
    <Modal open onClose={onClose} size="lg" title="Check the statement" subtitle={p.file.name}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!ok || !!busy} onClick={onImport}>{busy || `Import ${s.lines.length} lines`}</button></>}>
      <div className="space-y-4 p-5 text-sm">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Period" value={s.from ? `${fmtDate(s.from, { day: 'numeric', month: 'short' })} – ${fmtDate(s.to, { day: 'numeric', month: 'short' })}` : '—'} />
          <StatCard label="Opening" value={s.opening ? safePaisa(s.opening) / 100 : 0} prefix="Rs " />
          <StatCard label="Closing" value={s.closing ? safePaisa(s.closing) / 100 : 0} prefix="Rs " />
          <StatCard label="Lines" value={s.lines.length} />
        </div>
        <ul className="space-y-1">
          <Check ok={!!s.account} text={s.account ? `Account: ${s.account.code} ${s.account.name} (ending ${s.accountLast4 || '—'})` : `No bank account ends in ${s.accountLast4 || '(not found)'}`} />
          <Check ok={s.checks.balanceChain} text={s.checks.balanceChain ? 'Every line follows from the running balance' : 'Some lines don\'t follow from the running balance (marked below)'} />
          <Check ok={s.checks.closingMatches !== false} text={`Opening ${fmtRs(s.opening || 0)} + in ${fmtRs(s.moneyIn)} − out ${fmtRs(s.moneyOut)} = closing ${fmtRs(s.closing || 0)}`} />
          {s.warnings.map((w) => <Check key={w} ok={false} text={w} />)}
        </ul>
        <div className="max-h-72 overflow-auto rounded-xl border border-line">
          <table className="w-full text-xs"><tbody className="divide-y divide-line">
            {s.lines.map((l) => (
              <tr key={l.lineNo} className={l.issue ? 'bg-rose-50 dark:bg-rose-950/30' : ''}>
                <td className="whitespace-nowrap px-3 py-1.5 text-muted">{fmtDate(l.date, { day: 'numeric', month: 'short' })}</td>
                <td className="px-3 py-1.5 text-ink">{l.party || l.narration.slice(0, 60)}<span className="ml-1 text-faint">{CHANNEL[l.channel]}</span>{l.issue && <p className="text-rose-600">{l.issue}</p>}</td>
                <td className={`whitespace-nowrap px-3 py-1.5 text-right tabular-nums ${safePaisa(l.amount) > 0 ? 'text-emerald-700' : 'text-ink'}`}>{fmtRs(l.amount)}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      </div>
    </Modal>
  )
}
const Check = ({ ok, text }) => <li className={`flex gap-2 ${ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600'}`}>{ok ? <CheckCircle2 size={15} className="mt-0.5 shrink-0" /> : <AlertTriangle size={15} className="mt-0.5 shrink-0" />}{text}</li>

function Rules() {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState(null)
  useEffect(() => { if (open && !rows) getBankRules().then(setRows).catch(() => {}) }, [open, rows])
  return (
    <div className="card">
      <button className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-ink" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}<Brain size={15} />Names the app has learned <span className="font-normal text-muted">· who a name on the statement usually is</span></button>
      {open && (!rows ? <div className="p-4"><SkeletonRows rows={2} /></div> : (
        <div className="divide-y divide-line border-t border-line">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-2 text-sm">
              <span className="w-56 truncate font-medium capitalize text-ink">{r.pattern}</span>
              <span className="w-12 text-xs text-muted">{r.direction === 'any' ? 'in/out' : r.direction}</span>
              <span className="flex-1 truncate text-xs text-ink-soft">{ACTIONS[r.action] || r.action}{r.director ? `: ${r.director === 'omer' ? 'Omer' : 'Usman'}` : ''}{r.staff && `: ${r.staff}`}{r.supplier && `: ${r.supplier}`}{r.account && ` · ${r.account}`}</span>
              <button className="btn-icon hover:text-rose-600" onClick={async () => setRows(await deleteBankRule(r.id))} aria-label="Forget"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ── One statement ──────────────────────────────────────────────────────
const FILTERS = [{ value: 'Unmatched', label: 'To do' }, { value: 'Matched', label: 'Matched' }, { value: 'Ignored', label: 'Ignored' }, { value: '', label: 'All' }]
export function BankStatement() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [st, setSt] = useState(null)
  const [filter, setFilter] = useState('Unmatched')
  const [open, setOpen] = useState(null)
  const [ref, setRef] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => getBankStatement(id).then(setSt).catch((e) => toast.error(e.message)), [id])
  useEffect(() => { load() }, [load])
  useEffect(() => { Promise.all([getAccounts(), getStaff(), getSuppliers()]).then(([accounts, staff, suppliers]) => setRef({ accounts, staff, suppliers })).catch(() => {}) }, [])
  const act = async (fn, msg) => { setBusy(true); try { const r = await fn(); if (r?.lines) setSt(r); if (msg) toast.success(typeof msg === 'function' ? msg(r) : msg) } catch (err) { toast.error(err.message) } finally { setBusy(false) } }
  const shown = useMemo(() => (st ? st.lines.filter((l) => !filter || l.status === filter) : []), [st, filter])
  if (!st) return <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8"><SkeletonRows rows={8} /></div>
  const r = st.reconciliation
  const locked = st.status === 'Reconciled'
  const current = open && st.lines.find((l) => l.id === open)

  const reconcile = () => {
    if (safePaisa(r.difference) !== 0) { const note = askReason(`There is an unexplained difference of ${fmtRs(r.difference)} (often months not imported yet, or opening balances). Reconcile anyway?`); if (note) act(() => reconcileStatement(st.id, { reconciled: true, note }), 'Reconciled') }
    else act(() => reconcileStatement(st.id, { reconciled: true }), 'Reconciled')
  }
  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
      <PageHeader eyebrow="Bank reconciliation" title={`${fmtDate(st.from)} to ${fmtDate(st.to)}`} icon={Landmark} subtitle={`${st.account} · ${st.lines.length} lines`}
        actions={<div className="flex flex-wrap gap-2">
          {!locked && <button className="btn-secondary" disabled={busy} onClick={() => act(() => autoMatchStatement(st.id), (x) => `${x.autoMatched} more matched`)}><RefreshCw size={15} />Match again</button>}
          {!locked ? <button className="btn-primary" disabled={busy || r.counts.unmatched > 0} onClick={reconcile} title={r.counts.unmatched ? 'Deal with every line first' : ''}><Lock size={15} />Mark reconciled</button>
            : user?.role === 'owner' && <button className="btn-secondary" disabled={busy} onClick={() => act(() => reconcileStatement(st.id, { reconciled: false }), 'Reopened')}><Unlock size={15} />Reopen</button>}
          {!locked && <button className="btn-icon border border-line hover:text-rose-600" title="Delete this import" onClick={async () => { if (window.confirm('Delete this imported statement? Anything already booked from it stays in the books.')) { try { await deleteBankStatement(st.id); navigate('/finance/bank') } catch (err) { toast.error(err.message) } } }}><Trash2 size={15} /></button>}
        </div>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Bank closing" value={safePaisa(r.bankClosing) / 100} prefix="Rs " />
        <StatCard label="Books at the same date" value={safePaisa(r.bookBalance) / 100} prefix="Rs " />
        <StatCard label="On the statement, not in the books" value={safePaisa(r.notInBooks) / 100} prefix="Rs " tone={safePaisa(r.notInBooks) ? 'orange' : 'default'} />
        <StatCard label="In the books, not on a statement" value={safePaisa(r.notOnStatement) / 100} prefix="Rs " />
        <StatCard label="Unexplained difference" value={safePaisa(r.difference) / 100} prefix="Rs " tone={safePaisa(r.difference) ? 'red' : 'green'} />
      </div>
      <p className="text-xs text-muted">Bank closing = books + statement lines not yet in the books − book items on no statement. {locked ? `Reconciled ${fmtDate(st.reconciledAt)}${st.note ? `: ${st.note}` : ''}.` : `${r.counts.matched} matched · ${r.counts.unmatched} to do · ${r.counts.ignored} ignored.`}</p>
      {r.outstanding.length > 0 && <Outstanding rows={r.outstanding} />}

      <Segmented options={FILTERS.map((f) => ({ ...f, label: `${f.label}${f.value === 'Unmatched' && r.counts.unmatched ? ` (${r.counts.unmatched})` : ''}` }))} value={filter} onChange={setFilter} />
      {shown.length === 0 ? <p className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 size={15} />{filter === 'Unmatched' ? 'Every line is matched, booked or ignored.' : 'Nothing here.'}</p> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-surface-accent text-left font-label text-[10.5px] uppercase tracking-wider text-ink">
              <tr><th className="px-4 py-2.5 font-medium">Date</th><th className="px-3 py-2.5 font-medium">Who / what</th><th className="px-3 py-2.5 text-right font-medium">In</th>
                <th className="px-3 py-2.5 text-right font-medium">Out</th><th className="px-4 py-2.5 font-medium">In the books</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((l) => {
                const amt = safePaisa(l.amount)
                return (
                  <tr key={l.id} className="cursor-pointer hover:bg-subtle/60" onClick={() => setOpen(l.id)}>
                    <td className="whitespace-nowrap px-4 py-2.5 text-ink-soft">{fmtDate(l.date, { day: 'numeric', month: 'short' })}</td>
                    <td className="max-w-[340px] px-3 py-2.5"><p className="truncate font-medium text-ink">{l.party || l.narration.slice(0, 60)}</p>
                      <p className="truncate text-xs text-muted">{CHANNEL[l.channel]}{l.partyLast4 && ` · …${l.partyLast4}`}{l.reference && ` · ${l.reference}`}</p></td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{amt > 0 ? fmtRs(l.amount) : ''}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-ink">{amt < 0 ? fmtRs(-amt / 100) : ''}</td>
                    <td className="px-4 py-2.5 text-xs">
                      {l.status === 'Matched' ? <span className="text-ink-soft"><span className="font-mono font-semibold text-accent">{l.entryNo}</span> {l.note || (l.matchedBy === 'auto' ? 'matched automatically' : '')}</span>
                        : l.status === 'Ignored' ? <span className="text-muted">Ignored: {l.note}</span>
                        : <span className="text-amber-700 dark:text-amber-300">{l.candidates?.length ? `Could be ${l.candidates[0].entryNo}` : l.suggest?.label ? `Looks like: ${l.suggest.label}` : 'Not in the books'}</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {current && ref && <LineModal l={current} refData={ref} locked={locked} busy={busy} onClose={() => setOpen(null)}
        run={(fn, msg) => act(fn, msg).then(() => setOpen(null))} />}
    </div>
  )
}

function Outstanding({ rows }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="card">
      <button className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-ink" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<b>{rows.length}</b> book item{rows.length === 1 ? '' : 's'} up to this date that no imported statement shows yet
        <span className="text-xs text-muted">(other months not imported, or not cleared by the bank)</span></button>
      {open && (
        <table className="w-full border-t border-line text-sm"><tbody className="divide-y divide-line">
          {rows.map((o) => <tr key={o.entryId}><td className="px-4 py-1.5 text-ink-soft">{fmtDate(o.date)}</td><td className="px-3 py-1.5"><Link to={`/finance/journals/${o.entryId}`} className="font-mono text-xs text-accent">{o.entryNo}</Link> <span className="text-muted">{o.memo}</span></td><td className="px-4 py-1.5 text-right"><Num v={o.amount} /></td></tr>)}
        </tbody></table>
      )}
    </div>
  )
}

// What to do with one line: match it to an entry, book it, or ignore it
function LineModal({ l, refData, locked, busy, onClose, run }) {
  const amt = safePaisa(l.amount), dir = amt > 0 ? 'in' : 'out'
  const s = l.suggest || {}
  const [b, setB] = useState({ action: s.action || (dir === 'out' ? 'expense' : 'other'), director: s.director || '', staffId: s.staffId || '', kind: 'salary',
    accountId: s.accountId ? String(s.accountId) : '', supplierId: s.supplierId ? String(s.supplierId) : '', supplierName: s.supplierId ? '' : (dir === 'out' ? l.party : ''),
    description: '', orderId: '', remember: true })
  const set = (p) => setB((x) => ({ ...x, ...p }))
  const actions = Object.entries(ACTIONS).filter(([k]) => !(dir === 'in' && ['staff', 'expense', 'bank_charge'].includes(k)))
  return (
    <Modal open onClose={onClose} size="lg" title={`${dir === 'in' ? 'Money in' : 'Money out'} · ${fmtRs(Math.abs(amt) / 100)}`} subtitle={`${fmtDate(l.date)} · ${l.party || 'No name on the statement'}`}
      footer={l.status === 'Unmatched' && !locked ? <>
        <button className="btn-secondary mr-auto" disabled={busy} onClick={() => { const r = askReason('Ignore this line? Nothing is booked for it.'); if (r) run(() => ignoreBankLine(l.id, r), 'Ignored') }}>Ignore</button>
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy} onClick={() => run(() => bookBankLine(l.id, b), 'Booked')}>Book it</button></>
        : !locked && l.status !== 'Unmatched' ? <button className="btn-secondary" disabled={busy} onClick={() => run(() => (l.status === 'Ignored' ? unmatchBankLine(l.id) : unmatchBankLine(l.id)), 'Back to do')}>{l.status === 'Ignored' ? 'Un-ignore' : 'Unmatch'}</button> : null}>
      <div className="space-y-4 p-5 text-sm">
        <p className="rounded-xl bg-subtle/70 p-3 text-xs leading-relaxed text-ink-soft">{l.narration}{l.reference && <><br /><span className="text-muted">Bank transaction </span><span className="font-mono">{l.reference}</span></>}</p>
        {l.status === 'Matched' && <p className="flex items-center gap-2 text-emerald-700"><CheckCircle2 size={15} />In the books as <Link to={`/finance/journals/${l.entryId}`} className="font-mono font-semibold text-accent">{l.entryNo}</Link> {l.entryMemo}</p>}
        {l.status === 'Ignored' && <p className="text-muted">Ignored: {l.note}</p>}
        {l.status === 'Unmatched' && !locked && <>
          {l.candidates?.length > 0 && (
            <div className="space-y-1.5">
              <p className="section-title">Already in the books?</p>
              {l.candidates.map((c) => (
                <div key={c.entryId} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2">
                  <span className="font-mono text-xs font-semibold text-accent">{c.entryNo}</span><span className="flex-1 truncate text-xs text-ink-soft">{fmtDate(c.date)} · {c.memo}</span>
                  <button className="btn-secondary text-xs" disabled={busy} onClick={() => run(() => matchBankLine(l.id, c.entryId), 'Matched')}>This one</button>
                </div>
              ))}
            </div>
          )}
          <div className="space-y-3">
            <p className="section-title">{l.candidates?.length ? 'Or book it' : 'Not in the books yet: book it'}{s.from === 'rule' && <span className="ml-2 normal-case tracking-normal text-emerald-700">· remembered</span>}</p>
            <Field label="This is"><select className="input" value={b.action} onChange={(e) => set({ action: e.target.value })}>{actions.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            {b.action === 'bank_charge' && <Field label="Account" hint="6600 Bank charges unless you choose another"><AccountSelect accounts={refData.accounts} value={b.accountId} onChange={(v) => set({ accountId: v })} manual /></Field>}
            {b.action === 'director' && <Field label={dir === 'in' ? 'Funds added by' : 'Paid to / taken by'}><select className="input" value={b.director} onChange={(e) => set({ director: e.target.value })}><option value="">Choose…</option><option value="omer">Omer</option><option value="usman">Usman</option></select></Field>}
            {b.action === 'staff' && <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Paid to"><select className="input" value={b.staffId} onChange={(e) => set({ staffId: e.target.value })}><option value="">Choose…</option>{refData.staff.filter((x) => x.isActive).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
              <Field label="For" hint="To settle a payroll week and claims together, use Payroll › Payments to staff; this records a simple payment"><select className="input" value={b.kind} onChange={(e) => set({ kind: e.target.value })}><option value="salary">Salary</option><option value="advance">Advance</option></select></Field></div>}
            {b.action === 'expense' && <>
              <Field label="Category"><CategorySelect accounts={refData.accounts} value={b.accountId} onChange={(v) => set({ accountId: v })} /></Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Supplier"><select className="input" value={b.supplierId} onChange={(e) => set({ supplierId: e.target.value })}><option value="">{b.supplierName ? `New: ${b.supplierName}` : 'None'}</option>{refData.suppliers.filter((x) => x.isActive).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
                {!b.supplierId && <Field label="New supplier name"><input className="input" value={b.supplierName} onChange={(e) => set({ supplierName: e.target.value })} /></Field>}
              </div>
              <Field label="What for"><input className="input" value={b.description} onChange={(e) => set({ description: e.target.value })} placeholder="e.g. Fabric for VÉLORA" /></Field>
            </>}
            {b.action === 'customer' && <OrderPick amount={Math.abs(amt) / 100} value={b.orderId} onChange={(v) => set({ orderId: v })} refund={dir === 'out'} />}
            {b.action === 'other' && <>
              <Field label="Account"><AccountSelect accounts={refData.accounts} value={b.accountId} onChange={(v) => set({ accountId: v })} manual /></Field>
              <Field label="Memo"><input className="input" value={b.description} onChange={(e) => set({ description: e.target.value })} /></Field>
            </>}
            {l.party && b.action !== 'customer' && <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={b.remember} onChange={(e) => set({ remember: e.target.checked })} />Remember "{l.party}" for next month</label>}
          </div>
        </>}
      </div>
    </Modal>
  )
}

function OrderPick({ amount, value, onChange, refund }) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState([])
  useEffect(() => { const t = setTimeout(() => findOrdersForPayment(q, amount).then(setRows).catch(() => {}), 250); return () => clearTimeout(t) }, [q, amount])
  return (
    <Field label={refund ? 'Refund for order' : 'Payment for order'} hint="Orders whose balance equals this amount come first">
      <div className="relative mb-2"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input className="input pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order number or customer" /></div>
      <div className="max-h-56 space-y-1 overflow-auto">
        {rows.map((o) => (
          <button key={o.id} type="button" onClick={() => onChange(o.id)} className={`flex w-full items-center gap-2 rounded-lg border px-3 py-1.5 text-left text-xs ${value === o.id ? 'border-brand-primary bg-plum-50 dark:bg-plum-900/30' : 'border-line hover:bg-subtle'}`}>
            <span className="font-semibold text-ink">{o.orderNumber}</span><span className="flex-1 truncate text-muted">{o.customer} · {o.status}</span>
            <span className="tabular-nums text-ink">due {fmtRs(o.balance, { decimals: false })}</span>
          </button>
        ))}
      </div>
    </Field>
  )
}
