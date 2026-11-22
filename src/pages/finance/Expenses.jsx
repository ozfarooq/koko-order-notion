import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Receipt, Plus, Search, Paperclip, Repeat, PieChart, Pencil, Ban, Wallet, Undo2, Lightbulb } from 'lucide-react'
import {
  getAccounts, getSuppliers, createSupplier, getFinCollections, getFinanceSettings, getExpenses, getExpense, createExpense, updateExpense,
  voidExpense, payBill, unpayBill, addExpenseFiles, getRecurring, saveRecurring, generateRecurring, getReport, uploadFiles, openFinanceFile, PAID_FROM,
} from '../../data/finance'
import { PageHeader, Modal, Field, Segmented, SkeletonRows, EmptyState, ErrorBanner, StatCard, fmtDate } from '../../ui/kit'
import { FinBadge, fmtRs, safePaisa, todayPk, CategorySelect, FilePick, askReason } from './shared'
import { PeriodPicker, presetRange, Num } from './reportKit'

const TABS = [{ value: 'list', label: 'Expenses' }, { value: 'recurring', label: 'Recurring bills' }, { value: 'spending', label: 'Spending' }]
const statusOf = (x) => (x.status !== 'Posted' ? x.status : x.paidFrom === 'unpaid' ? (x.paidEntryId ? 'Paid' : 'Unpaid') : 'Posted')

// Everything the studio spends: quick entry (phone friendly), bills paid later, recurring bills, and where the money went
export default function Expenses() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'list'
  const [ref, setRef] = useState(null)        // accounts, suppliers, collections, settings
  const loadRef = useCallback(() => Promise.all([getAccounts(), getSuppliers(), getFinCollections(), getFinanceSettings()])
    .then(([accounts, suppliers, collections, settings]) => setRef({ accounts, suppliers, collections, settings })).catch((e) => toast.error(e.message)), [])
  useEffect(() => { loadRef() }, [loadRef])

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
      <PageHeader eyebrow="Finance" title="Expenses" icon={Receipt} subtitle="Every rupee spent, with its receipt. Each one posts to the books straight away." />
      <div className="overflow-x-auto"><Segmented options={TABS} value={tab} onChange={(v) => setParams({ tab: v })} /></div>
      {!ref ? <SkeletonRows rows={6} />
        : tab === 'recurring' ? <RecurringTab refData={ref} />
        : tab === 'spending' ? <SpendingTab />
        : <ExpenseList refData={ref} reloadRef={loadRef} />}
    </div>
  )
}

function ExpenseList({ refData, reloadRef }) {
  const [period, setPeriod] = useState({ preset: 'month' })
  const range = presetRange(period.preset, period)
  const [f, setF] = useState({ q: '', accountId: '', paidFrom: '', status: '' })
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null)      // {} new, or an expense
  const [viewing, setViewing] = useState(null)
  const load = useCallback(() => {
    getExpenses({ ...f, from: range.from, to: range.to }).then((r) => { setRows(r); setError(null) }).catch((e) => setError(e.message))
  }, [f, range.from, range.to]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(load, f.q ? 250 : 0); return () => clearTimeout(t) }, [load])
  const set = (p) => setF((x) => ({ ...x, ...p }))
  const total = useMemo(() => (rows || []).filter((x) => x.status === 'Posted').reduce((s, x) => s + safePaisa(x.amount), 0), [rows])
  const unpaid = useMemo(() => (rows || []).filter((x) => statusOf(x) === 'Unpaid').reduce((s, x) => s + safePaisa(x.amount), 0), [rows])
  const done = () => { setEditing(null); load(); reloadRef() }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary" onClick={() => setEditing({})}><Plus size={16} />Add expense</button>
        <PeriodPicker value={period} onChange={setPeriod} />
        <div className="relative min-w-[200px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input className="input pl-9" value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder="What, supplier, reference" />
        </div>
        <div className="w-full sm:w-56"><CategorySelect accounts={refData.accounts} value={f.accountId} onChange={(v) => set({ accountId: v })} /></div>
        <select className="input w-auto" value={f.paidFrom} onChange={(e) => set({ paidFrom: e.target.value })}>
          <option value="">Paid any way</option>{Object.entries(PAID_FROM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Spent in this period" value={total / 100} prefix="Rs " />
        <StatCard label="Bills not paid yet" value={unpaid / 100} prefix="Rs " tone={unpaid ? 'orange' : 'default'} />
        <StatCard label="Expenses" value={(rows || []).filter((x) => x.status === 'Posted').length} />
      </div>
      <ErrorBanner onRetry={load}>{error}</ErrorBanner>
      {!rows ? <SkeletonRows rows={6} /> : rows.length === 0 ? (
        <EmptyState icon={Receipt} title="No expenses in this period" hint="Add one with its receipt; it posts to the books straight away." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-surface-accent text-left font-label text-[10.5px] uppercase tracking-wider text-ink">
              <tr><th className="px-4 py-2.5 font-medium">Date</th><th className="px-3 py-2.5 font-medium">What</th><th className="px-3 py-2.5 font-medium">Category</th>
                <th className="px-3 py-2.5 font-medium">Paid from</th><th className="px-3 py-2.5 text-right font-medium">Amount</th><th className="px-4 py-2.5 font-medium">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((x) => (
                <tr key={x.id} className={`cursor-pointer transition hover:bg-subtle/60 ${x.status === 'Void' ? 'opacity-50' : ''}`} onClick={() => setViewing(x.id)}>
                  <td className="whitespace-nowrap px-4 py-2.5 text-ink-soft">{fmtDate(x.date)}</td>
                  <td className="max-w-[300px] px-3 py-2.5"><p className="truncate text-ink">{x.description || x.supplierName}</p>
                    <p className="flex items-center gap-1.5 truncate text-xs text-muted">{x.description && x.supplierName}{x.collectionName && <span>· {x.collectionName}</span>}{x.files > 0 && <Paperclip size={11} />}</p></td>
                  <td className="px-3 py-2.5 text-xs text-ink-soft"><span className="font-mono text-muted">{x.accountCode}</span> {x.accountName}</td>
                  <td className="px-3 py-2.5 text-xs text-muted">{PAID_FROM[x.paidFrom]}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-ink">{fmtRs(x.amount)}</td>
                  <td className="px-4 py-2.5"><FinBadge status={statusOf(x)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <ExpenseForm refData={refData} expense={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={done} reloadRef={reloadRef} />}
      {viewing && <ExpenseView id={viewing} onClose={() => setViewing(null)} onEdit={(x) => { setViewing(null); setEditing(x) }} onChanged={load} />}
    </>
  )
}

export function ExpenseForm({ refData, expense, onClose, onSaved, reloadRef }) {
  const { accounts, suppliers, collections, settings } = refData
  const [b, setB] = useState(() => expense ? { ...expense, accountId: String(expense.accountId), supplierId: expense.supplierId ? String(expense.supplierId) : '', collectionId: expense.collectionId ? String(expense.collectionId) : '' }
    : { date: todayPk(), amount: '', accountId: '', paidFrom: 'cash', supplierId: '', description: '', reference: '', collectionId: '' })
  const [newSupplier, setNewSupplier] = useState('')
  const [files, setFiles] = useState([])
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (p) => setB((x) => ({ ...x, ...p }))
  const account = accounts.find((a) => String(a.id) === String(b.accountId))
  const big = account && account.type !== 'asset' && safePaisa(b.amount) >= safePaisa(settings.capitalisationThreshold)

  const pickSupplier = (id) => {
    const s = suppliers.find((x) => String(x.id) === id)
    set({ supplierId: id, ...(s?.defaultAccountId && !b.accountId ? { accountId: String(s.defaultAccountId) } : {}) })
  }
  const save = async () => {
    setSaving(true)
    try {
      let supplierId = b.supplierId
      if (supplierId === 'new') {
        if (!newSupplier.trim()) throw new Error('Type the new supplier name')
        supplierId = (await createSupplier({ name: newSupplier, defaultAccountId: b.accountId || null })).id
        reloadRef?.()
      }
      const fileIds = await uploadFiles(files, 'expenses')
      const payload = { date: b.date, amount: b.amount, accountId: b.accountId, paidFrom: b.paidFrom, supplierId: supplierId || null, description: b.description,
        reference: b.reference, collectionId: b.collectionId || null, fileIds }
      const x = expense ? await updateExpense(expense.id, { ...payload, reason }) : await createExpense(payload)
      toast.success(`${expense ? 'Corrected' : 'Posted'}: ${fmtRs(x.amount)} · ${x.entryNo}`)
      onSaved(x)
    } catch (err) { toast.error(err.message) } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title={expense ? 'Correct expense' : 'Add expense'} subtitle={expense ? 'The old posting is reversed and a corrected one posted' : 'Posts to the books straight away'}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : expense ? 'Save correction' : 'Post expense'}</button></>}>
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Amount (Rs)"><input inputMode="decimal" autoFocus className="input text-lg font-semibold tabular-nums" value={b.amount} onChange={(e) => set({ amount: e.target.value })} placeholder="0" /></Field>
        <Field label="Date"><input type="date" className="input" value={b.date} onChange={(e) => set({ date: e.target.value })} /></Field>
        <Field label="What was it for?" className="sm:col-span-2"><input className="input" value={b.description} onChange={(e) => set({ description: e.target.value })} placeholder="e.g. Electrician: studio wiring" /></Field>
        <Field label="Category" className="sm:col-span-2"><CategorySelect accounts={accounts} value={b.accountId} onChange={(v) => set({ accountId: v })} /></Field>
        {big && <p className="flex gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800 sm:col-span-2 dark:bg-amber-950/40 dark:text-amber-300"><Lightbulb size={14} className="mt-0.5 shrink-0" />
          This is {fmtRs(settings.capitalisationThreshold, { decimals: false })} or more. If it is equipment or furniture that will last more than a year, choose a fixed asset category (1500–1520) instead.</p>}
        <Field label="Paid from">
          <select className="input" value={b.paidFrom} onChange={(e) => set({ paidFrom: e.target.value })}>{Object.entries(PAID_FROM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </Field>
        <Field label="Supplier" hint={b.paidFrom === 'unpaid' ? 'Needed: the bill is owed to them' : 'Optional'}>
          <select className="input" value={b.supplierId} onChange={(e) => pickSupplier(e.target.value)}>
            <option value="">None</option>{suppliers.filter((s) => s.isActive || String(s.id) === b.supplierId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            <option value="new">+ New supplier…</option>
          </select>
        </Field>
        {b.supplierId === 'new' && <Field label="New supplier name" className="sm:col-span-2"><input className="input" value={newSupplier} onChange={(e) => setNewSupplier(e.target.value)} /></Field>}
        <Field label="Reference" hint="Bill or bank reference"><input className="input" value={b.reference} onChange={(e) => set({ reference: e.target.value })} /></Field>
        <Field label="For a collection" hint="Optional: costs a shoot or a batch to it">
          <select className="input" value={b.collectionId} onChange={(e) => set({ collectionId: e.target.value })}><option value="">None</option>{collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </Field>
        <div className="sm:col-span-2"><FilePick files={files} onChange={setFiles} /></div>
        {expense && <Field label="Why the correction?" className="sm:col-span-2"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong amount" /></Field>}
      </div>
    </Modal>
  )
}

function ExpenseView({ id, onClose, onEdit, onChanged }) {
  const [x, setX] = useState(null)
  const [paying, setPaying] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => getExpense(id).then(setX).catch((e) => toast.error(e.message)), [id])
  useEffect(() => { load() }, [load])
  const act = async (fn, msg) => { setBusy(true); try { await fn(); toast.success(msg); await load(); onChanged() } catch (err) { toast.error(err.message) } finally { setBusy(false) } }
  const doVoid = () => { const r = askReason('Void this expense? Its posting is reversed.'); if (r) act(() => voidExpense(id, r), 'Voided') }
  const doUnpay = () => { const r = askReason('Undo the payment of this bill?'); if (r) act(() => unpayBill(id, r), 'Payment undone') }
  const addFiles = async (list) => act(async () => addExpenseFiles(id, await uploadFiles(list, 'expenses')), 'Receipt added')

  return (
    <Modal open onClose={onClose} title={x ? fmtRs(x.amount) : 'Expense'} subtitle={x ? `${fmtDate(x.date)} · ${x.accountCode} ${x.accountName}` : ''} size="md"
      footer={x && x.status === 'Posted' && <>
        <button className="btn-secondary text-rose-700" onClick={doVoid} disabled={busy}><Ban size={15} />Void</button>
        {!x.paidEntryId && <button className="btn-secondary" onClick={() => onEdit(x)} disabled={busy}><Pencil size={15} />Correct</button>}
        {x.paidFrom === 'unpaid' && !x.paidEntryId && <button className="btn-primary" onClick={() => setPaying({ paidOn: todayPk(), paidFrom: 'bank', reference: '' })} disabled={busy}><Wallet size={15} />Pay bill</button>}
        {x.paidEntryId && <button className="btn-secondary" onClick={doUnpay} disabled={busy}><Undo2 size={15} />Undo payment</button>}
      </>}>
      {!x ? <div className="p-5"><SkeletonRows rows={4} /></div> : (
        <div className="space-y-4 p-5 text-sm">
          <div className="flex flex-wrap items-center gap-2"><FinBadge status={statusOf(x)} />{x.entryNo && <Link to={`/finance/journals/${x.entryId}`} className="font-mono text-xs font-semibold text-accent">{x.entryNo}</Link>}
            {x.paidEntryNo && <span className="text-xs text-muted">paid {fmtDate(x.paidOn)} · <Link to={`/finance/journals/${x.paidEntryId}`} className="font-mono font-semibold text-accent">{x.paidEntryNo}</Link></span>}</div>
          <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-2">
            <dt className="text-muted">What</dt><dd className="text-ink">{x.description || '—'}</dd>
            <dt className="text-muted">Supplier</dt><dd className="text-ink">{x.supplierName || '—'}</dd>
            <dt className="text-muted">Paid from</dt><dd className="text-ink">{PAID_FROM[x.paidFrom]}</dd>
            <dt className="text-muted">Reference</dt><dd className="text-ink">{x.reference || '—'}</dd>
            <dt className="text-muted">Collection</dt><dd className="text-ink">{x.collectionName || '—'}</dd>
          </dl>
          <div className="space-y-2">
            {x.fileList.map((file) => <button key={file.id} className="flex items-center gap-2 text-accent hover:underline" onClick={() => openFinanceFile(file.id)}><Paperclip size={13} />{file.name}</button>)}
            {x.status === 'Posted' && <FilePick files={[]} onChange={addFiles} label={x.fileList.length ? 'Add another receipt' : 'Attach the receipt'} />}
          </div>
          {paying && (
            <div className="space-y-3 rounded-xl border border-line bg-subtle/50 p-4">
              <p className="font-semibold text-ink">Pay {x.supplierName}</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <input type="date" className="input" value={paying.paidOn} onChange={(e) => setPaying({ ...paying, paidOn: e.target.value })} />
                <select className="input" value={paying.paidFrom} onChange={(e) => setPaying({ ...paying, paidFrom: e.target.value })}>
                  {Object.entries(PAID_FROM).filter(([k]) => k !== 'unpaid').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <input className="input" value={paying.reference} onChange={(e) => setPaying({ ...paying, reference: e.target.value })} placeholder="Bank reference" />
              </div>
              <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setPaying(null)}>Cancel</button>
                <button className="btn-primary" disabled={busy} onClick={() => act(() => payBill(id, paying), 'Bill paid').then(() => setPaying(null))}>Record payment</button></div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

// ── Recurring bills ────────────────────────────────────────────────────
function RecurringTab({ refData }) {
  const [rows, setRows] = useState(null)
  const [editing, setEditing] = useState(null)
  const [month, setMonth] = useState(todayPk().slice(0, 7))
  const [busy, setBusy] = useState(false)
  const load = () => getRecurring().then(setRows).catch((e) => toast.error(e.message))
  useEffect(() => { load() }, [])
  const generate = async () => {
    setBusy(true)
    try {
      const r = await generateRecurring(month)
      if (r.created.length) toast.success(`Posted ${r.created.length} bill${r.created.length === 1 ? '' : 's'} for ${month}`)
      else if (!r.failed.length) toast.info(`Everything for ${month} is already posted`)
      for (const f of r.failed) toast.error(`${f.name}: ${f.error}`)
      load()
    } catch (err) { toast.error(err.message) } finally { setBusy(false) }
  }
  const save = async () => {
    try { setRows(await saveRecurring(editing.id, editing)); setEditing(null); toast.success('Saved') } catch (err) { toast.error(err.message) }
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-secondary" onClick={() => setEditing({ name: '', accountId: '', amount: '', dayOfMonth: 1, paidFrom: 'bank', supplierId: '', isActive: true })}><Plus size={15} />Add recurring bill</button>
        <div className="flex-1" />
        <input type="month" className="input w-auto" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />
        <button className="btn-primary" onClick={generate} disabled={busy}><Repeat size={15} />{busy ? 'Posting…' : 'Post this month\'s bills'}</button>
      </div>
      <p className="text-xs text-muted">Each active bill posts once per month, on its day. Already-posted months are skipped, so pressing the button twice is safe.</p>
      {!rows ? <SkeletonRows rows={3} /> : rows.length === 0 ? <EmptyState icon={Repeat} title="No recurring bills" hint="Add rent, internet, software subscriptions…" /> : (
        <div className="card divide-y divide-line">
          {rows.map((r) => (
            <button key={r.id} className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-subtle/60 ${r.isActive ? '' : 'opacity-50'}`}
              onClick={() => setEditing({ ...r, accountId: String(r.accountId), supplierId: r.supplierId ? String(r.supplierId) : '' })}>
              <div className="min-w-0 flex-1"><p className="font-medium text-ink">{r.name}</p><p className="text-xs text-muted">{r.accountCode} {r.accountName} · day {r.dayOfMonth} · {PAID_FROM[r.paidFrom]}{r.lastMonth && ` · last posted ${r.lastMonth}`}</p></div>
              <span className="font-semibold tabular-nums text-ink">{fmtRs(r.amount)}</span>
            </button>
          ))}
        </div>
      )}
      {editing && (
        <Modal open onClose={() => setEditing(null)} title={editing.id ? 'Recurring bill' : 'New recurring bill'}
          footer={<><button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button><button className="btn-primary" onClick={save}>Save</button></>}>
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Name" className="sm:col-span-2"><input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Studio rent" /></Field>
            <Field label="Category" className="sm:col-span-2"><CategorySelect accounts={refData.accounts} value={editing.accountId} onChange={(v) => setEditing({ ...editing, accountId: v })} /></Field>
            <Field label="Amount (Rs)"><input inputMode="decimal" className="input" value={editing.amount} onChange={(e) => setEditing({ ...editing, amount: e.target.value })} /></Field>
            <Field label="Day of the month" hint="1 to 28"><input type="number" min={1} max={28} className="input" value={editing.dayOfMonth} onChange={(e) => setEditing({ ...editing, dayOfMonth: e.target.value })} /></Field>
            <Field label="Paid from"><select className="input" value={editing.paidFrom} onChange={(e) => setEditing({ ...editing, paidFrom: e.target.value })}>{Object.entries(PAID_FROM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Supplier"><select className="input" value={editing.supplierId} onChange={(e) => setEditing({ ...editing, supplierId: e.target.value })}><option value="">None</option>{refData.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            {editing.id && <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={editing.isActive} onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })} />Active</label>}
          </div>
        </Modal>
      )}
    </>
  )
}

// ── Spending report ────────────────────────────────────────────────────
function SpendingTab() {
  const [period, setPeriod] = useState({ preset: 'fytd' })
  const range = presetRange(period.preset, period)
  const [d, setD] = useState(null)
  useEffect(() => { setD(null); getReport('expenses', range).then(setD).catch((e) => toast.error(e.message)) }, [range.from, range.to]) // eslint-disable-line react-hooks/exhaustive-deps
  const Table = ({ title, rows, cols }) => (
    <div className="card overflow-hidden">
      <p className="border-b border-line px-4 py-2.5 font-label text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</p>
      {rows.length === 0 ? <p className="px-4 py-5 text-sm text-muted">Nothing in this period.</p> : (
        <table className="w-full text-sm"><tbody className="divide-y divide-line">
          {rows.map((r, i) => <tr key={i}>{cols.map((c, j) => <td key={j} className={`px-4 py-2 ${j === cols.length - 1 ? 'text-right' : ''}`}>{c(r)}</td>)}</tr>)}
        </tbody></table>
      )}
    </div>
  )
  return (
    <>
      <PeriodPicker value={period} onChange={setPeriod} />
      {!d ? <SkeletonRows rows={6} /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard label="Total costs" value={safePaisa(d.total) / 100} prefix="Rs " icon={PieChart} />
            <StatCard label="Cost of sales" value={d.byAccount.filter((a) => a.type === 'cogs').reduce((s, a) => s + safePaisa(a.amount), 0) / 100} prefix="Rs " />
            <StatCard label="Running costs" value={d.byAccount.filter((a) => a.type === 'expense').reduce((s, a) => s + safePaisa(a.amount), 0) / 100} prefix="Rs " />
          </div>
          <p className="text-xs text-muted">Includes wages and approved studio claims, not just expenses entered here. Click a category to see its ledger.</p>
          <div className="grid gap-4 lg:grid-cols-2">
            <Table title="By category" rows={d.byAccount} cols={[(r) => <Link className="hover:text-accent hover:underline" to={`/finance/ledgers?account=${r.id}&from=${d.from}&to=${d.to}`}><span className="mr-1.5 font-mono text-[11px] text-muted">{r.code}</span>{r.name}</Link>, (r) => <Num v={r.amount} strong />]} />
            <Table title="By month" rows={d.byMonth} cols={[(r) => fmtDate(`${r.month}-01`, { month: 'long', year: 'numeric' }), (r) => <span className="text-xs text-muted">production {fmtRs(r.cogs, { decimals: false })}</span>, (r) => <Num v={r.total} strong />]} />
            <Table title="By supplier" rows={d.bySupplier} cols={[(r) => r.name, (r) => <Num v={r.amount} strong />]} />
            <Table title="By collection" rows={d.byCollection} cols={[(r) => r.name, (r) => <Num v={r.amount} strong />]} />
          </div>
          <Table title="Ten largest expenses" rows={d.top} cols={[(r) => fmtDate(r.date), (r) => <span><span className="text-ink">{r.description || r.supplier}</span> <span className="text-xs text-muted">{r.account}</span></span>, (r) => <Num v={r.amount} strong />]} />
        </div>
      )}
    </>
  )
}
