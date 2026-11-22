import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Inbox as InboxIcon, Upload, ScanText, CheckCheck, Send, Ban, PauseCircle, RotateCcw, Keyboard, Plus, Trash2, AlertTriangle, Tags, ChevronDown, ChevronRight } from 'lucide-react'
import {
  getIntake, getIntakeItem, addToIntake, readIntakeItem, saveIntakeItem, approveIntakeItem, rejectIntakeItem, parkIntakeItem, reopenIntakeItem, approveReadyIntake,
  getIntakeLabels, saveIntakeLabel, getAccounts, getStaff, getSuppliers, getStaffOwed, getFinanceFile, uploadFiles, INTAKE_KINDS, PAID_FROM,
} from '../../data/finance'
import { PageHeader, Modal, Field, Segmented, SkeletonRows, EmptyState, ErrorBanner, fmtDate } from '../../ui/kit'
import { FinBadge, fmtRs, formatRs, safePaisa, CategorySelect, askReason } from './shared'

const GROUPS = [['review', 'To review'], ['posted', 'Posted'], ['parked', 'Parked'], ['closed', 'Rejected & duplicates']]
const PAY_FROM = Object.fromEntries(Object.entries(PAID_FROM).filter(([k]) => k !== 'unpaid'))
const LABEL_KINDS = { salary: 'Salary', claim: 'Studio claim (market spend)', advance: 'Advance', expense: 'Expense', owner_funding: 'Funds added', ignore: 'Ignore (a total)' }
const who = (i) => i.proposal?.staffName || i.proposal?.supplierName || (i.proposal?.director ? `Director: ${i.proposal.director === 'omer' ? 'Omer' : 'Usman'}` : '') || i.extracted?.toName || i.extracted?.shop || ''

// Receipts and bank screenshots in, draft postings out: read, check, approve, filed away
export default function Inbox() {
  const [group, setGroup] = useState('review')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState('')
  const [open, setOpen] = useState(null)
  const [ref, setRef] = useState(null)
  const load = useCallback(() => getIntake(group).then((d) => { setData(d); setError(null) }).catch((e) => setError(e.message)), [group])
  useEffect(() => { setData(null); load() }, [load])
  useEffect(() => { Promise.all([getAccounts(), getStaff(), getSuppliers()]).then(([accounts, staff, suppliers]) => setRef({ accounts, staff, suppliers })).catch((e) => toast.error(e.message)) }, [])

  const readAll = async (items) => {
    let ok = 0
    for (const [n, it] of items.entries()) {
      setBusy(`Reading ${n + 1} of ${items.length}…`)
      try { await readIntakeItem(it.id); ok++ } catch (err) { toast.error(`${it.fileName}: ${err.message}`) }
    }
    setBusy(''); if (ok) toast.success(`Read ${ok} file${ok === 1 ? '' : 's'}`); load()
  }
  const add = async (list) => {
    if (!list.length) return
    try {
      setBusy(`Uploading ${list.length} file${list.length === 1 ? '' : 's'}…`)
      const ids = await uploadFiles(list, 'Inbox')
      const { items } = await addToIntake(ids)
      const fresh = items.filter((i) => !i.alreadyIn), again = items.length - fresh.length
      if (fresh.length) toast.success(`${fresh.length} added to the inbox`)
      if (again) toast.info(`${again} already in the inbox (the same file was added before)`)
      setGroup('review')
      if (data?.visionConfigured) await readAll(fresh.filter((i) => i.status === 'New')); else load()
    } catch (err) { toast.error(err.message) } finally { setBusy('') }
  }
  const approveSure = async () => {
    setBusy('Approving…')
    try {
      const r = await approveReadyIntake()
      toast.success(`Posted ${r.posted}`); for (const f of r.failed) toast.error(`#${f.id}: ${f.error}`)
      load()
    } catch (err) { toast.error(err.message) } finally { setBusy('') }
  }
  const c = data?.counts || {}
  const newOnes = (data?.items || []).filter((i) => i.status === 'New')

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
      <PageHeader eyebrow="Finance" title="Inbox" icon={InboxIcon} subtitle="Drop in receipts, bills and bank screenshots. Each is read, checked against the books and posted once you approve it." />
      {data && !data.visionConfigured && (
        <p className="flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"><AlertTriangle size={16} className="mt-0.5 shrink-0" />
          Automatic reading is off until the Claude API key (ANTHROPIC_API_KEY) is added to the server. Until then, open each file and type the details in.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className={`btn-primary cursor-pointer ${busy ? 'pointer-events-none opacity-60' : ''}`}>
          <Upload size={16} />Add receipts & screenshots
          <input type="file" multiple accept="image/*,application/pdf" className="sr-only" onChange={(e) => { add([...e.target.files]); e.target.value = '' }} />
        </label>
        {data?.visionConfigured && group === 'review' && newOnes.length > 0 && <button className="btn-secondary" disabled={!!busy} onClick={() => readAll(newOnes)}><ScanText size={15} />Read {newOnes.length} new</button>}
        {c.bulk > 0 && <button className="btn-secondary" disabled={!!busy} onClick={approveSure} title="Ready items read with 85% confidence or more"><CheckCheck size={15} />Approve {c.bulk} sure one{c.bulk === 1 ? '' : 's'}</button>}
        {busy && <span className="text-sm text-muted">{busy}</span>}
      </div>
      <div className="overflow-x-auto"><Segmented options={GROUPS.map(([v, l]) => ({ value: v, label: `${l}${c[v] ? ` (${c[v]})` : ''}` }))} value={group} onChange={setGroup} /></div>
      <ErrorBanner onRetry={load}>{error}</ErrorBanner>
      {!data ? <SkeletonRows rows={6} /> : data.items.length === 0 ? (
        <EmptyState icon={InboxIcon} title={group === 'review' ? 'Nothing to review' : 'Nothing here'} hint="Add the year's receipts and bank screenshots; they are read and turned into entries for you to check." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-surface-accent text-left font-label text-[10.5px] uppercase tracking-wider text-ink">
              <tr><th className="px-4 py-2.5 font-medium">Date</th><th className="px-3 py-2.5 font-medium">What</th><th className="px-3 py-2.5 font-medium">Reference</th>
                <th className="px-3 py-2.5 text-right font-medium">Amount</th><th className="px-4 py-2.5 font-medium">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.items.map((i) => (
                <tr key={i.id} className="cursor-pointer hover:bg-subtle/60" onClick={() => setOpen(i.id)}>
                  <td className="whitespace-nowrap px-4 py-2.5 text-ink-soft">{i.date ? fmtDate(i.date) : <span className="text-faint">—</span>}</td>
                  <td className="max-w-[340px] px-3 py-2.5"><p className="truncate text-ink">{i.kind ? INTAKE_KINDS[i.kind] : <span className="text-muted">Not read yet</span>}{who(i) && <span className="text-muted"> · {who(i)}</span>}</p>
                    <p className="truncate text-xs text-muted">{i.issues.length ? <span className="text-amber-700 dark:text-amber-300">{i.issues[0]}{i.issues.length > 1 ? ` (+${i.issues.length - 1})` : ''}</span> : i.fileName}</p></td>
                  <td className="px-3 py-2.5 font-mono text-xs text-muted">{i.bankRef || i.proposal?.reference || ''}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-ink">{i.amount ? fmtRs(i.amount) : ''}</td>
                  <td className="whitespace-nowrap px-4 py-2.5"><FinBadge status={i.status} />{i.confidence != null && i.status === 'Ready' && <span className="ml-1.5 text-[11px] text-muted">{Math.round(i.confidence * 100)}%</span>}
                    {i.entryNo && <span className="ml-1.5 font-mono text-[11px] text-accent">{i.entryNo}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {ref && <StickerWords accounts={ref.accounts} />}
      {open && ref && <Review id={open} refData={ref} vision={!!data?.visionConfigured} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  )
}

// ── Review: the file beside the proposed posting ───────────────────────
function Review({ id, refData, vision, onClose, onChanged }) {
  const [item, setItem] = useState(null)
  const [file, setFile] = useState(null)        // { url, mime }
  const [kind, setKind] = useState('')
  const [p, setP] = useState({})
  const [typing, setTyping] = useState(false)
  const [busy, setBusy] = useState(false)
  const take = (i) => { setItem(i); setKind(i.kind || ''); setP(i.proposal || {}); setTyping(false) }
  useEffect(() => { getIntakeItem(id).then(take).catch((e) => toast.error(e.message)) }, [id])
  useEffect(() => {
    if (!item) return undefined
    let url
    getFinanceFile(item.fileId).then((f) => {
      const bytes = Uint8Array.from(atob(f.data), (ch) => ch.charCodeAt(0))
      url = URL.createObjectURL(new Blob([bytes], { type: f.mime })); setFile({ url, mime: f.mime })
    }).catch(() => {})
    return () => url && URL.revokeObjectURL(url)
  }, [item?.fileId]) // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn, msg, close = false) => {
    setBusy(true)
    try { const r = await fn(); if (r?.id) take(r); if (msg) toast.success(msg); onChanged(); if (close) onClose() }
    catch (err) { toast.error(err.message); getIntakeItem(id).then(take).catch(() => {}) } finally { setBusy(false) }
  }
  const open = item && ['New', 'Ready', 'Needs attention', 'Parked', 'Duplicate'].includes(item.status)
  const canPost = ['owner_funding', 'staff_payment', 'expense'].includes(kind)

  return (
    <Modal open onClose={onClose} size="xl" title={item ? (item.kind ? INTAKE_KINDS[item.kind] : 'Not read yet') : 'Inbox item'}
      subtitle={item ? `${item.fileName}${item.readBy ? ` · ${item.readBy === 'hand' ? 'typed in' : 'read automatically'}` : ''}` : ''}
      footer={item && open && <>
        <button className="btn-secondary text-rose-700" disabled={busy} onClick={() => { const r = askReason('Reject this file? Nothing is posted.'); if (r) act(() => rejectIntakeItem(id, r), 'Rejected', true) }}><Ban size={15} />Reject</button>
        {item.status !== 'Parked' && <button className="btn-secondary" disabled={busy} onClick={() => act(() => parkIntakeItem(id, ''), 'Parked', true)}><PauseCircle size={15} />Park</button>}
        {(item.status === 'Parked' || item.status === 'Duplicate') && <button className="btn-secondary" disabled={busy} onClick={() => act(() => reopenIntakeItem(id), 'Back in the queue')}><RotateCcw size={15} />Reopen</button>}
        {kind && !typing && <button className="btn-secondary" disabled={busy} onClick={() => act(() => saveIntakeItem(id, { kind, proposal: p }), 'Saved')}>Save</button>}
        {canPost && !typing && item.status !== 'Duplicate' && <button className="btn-primary" disabled={busy} onClick={() => act(() => approveIntakeItem(id, { kind, proposal: p }), 'Posted and filed away', true)}><Send size={15} />Approve & post</button>}
      </>}>
      {!item ? <div className="p-5"><SkeletonRows rows={5} /></div> : (
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="border-b border-line bg-subtle/40 p-3 lg:border-b-0 lg:border-r">
            {!file ? <SkeletonRows rows={4} /> : file.mime === 'application/pdf'
              ? <iframe title="Document" src={file.url} className="h-[70vh] w-full rounded-lg bg-white" />
              : <a href={file.url} target="_blank" rel="noreferrer"><img src={file.url} alt="Receipt or screenshot" className="mx-auto max-h-[70vh] w-auto rounded-lg object-contain" /></a>}
          </div>
          <div className="space-y-4 p-5 text-sm">
            <div className="flex flex-wrap items-center gap-2"><FinBadge status={item.status} />
              {item.entryNo && <Link to={`/finance/journals/${item.entryId}`} className="font-mono text-xs font-semibold text-accent">{item.entryNo}</Link>}
              {item.note && <span className="text-xs text-muted">{item.note}</span>}</div>
            {item.readError && <p className="text-xs text-rose-600">Reading failed: {item.readError}</p>}
            {item.issues.length > 0 && <ul className="space-y-1 rounded-xl bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">{item.issues.map((x) => <li key={x} className="flex gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{x}</li>)}</ul>}
            {open && (
              <div className="flex flex-wrap gap-2">
                {vision && <button className="btn-secondary text-xs" disabled={busy} onClick={() => act(() => readIntakeItem(id), 'Read')}><ScanText size={13} />{item.readBy ? 'Read again' : 'Read it'}</button>}
                <button className="btn-secondary text-xs" disabled={busy} onClick={() => setTyping(!typing)}><Keyboard size={13} />{typing ? 'Cancel typing' : 'Type the details in'}</button>
              </div>
            )}
            {typing ? <TypeIn item={item} busy={busy} onSave={(ex) => act(() => saveIntakeItem(id, { extracted: ex }), 'Classified')} />
              : item.status === 'New' && !item.kind ? <p className="text-muted">{vision ? 'Read it, or type the details in.' : 'Type the details in from the picture.'}</p>
              : <>
                <Field label="What is it?">
                  <select className="input" disabled={!open} value={kind} onChange={(e) => setKind(e.target.value)}>
                    <option value="">Choose…</option>{Object.entries(INTAKE_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                </Field>
                <fieldset disabled={!open} className="space-y-4">
                  {kind === 'owner_funding' && <Funding p={p} set={setP} />}
                  {kind === 'expense' && <ExpenseFields p={p} set={setP} refData={refData} />}
                  {kind === 'staff_payment' && <StaffPaymentFields p={p} set={setP} refData={refData} />}
                  {['customer_receipt', 'reseller_payment'].includes(kind) && <p className="text-muted">Money coming in is posted from phase F3 (orders and reseller statements). Park it for now; it stays here with its reading.</p>}
                </fieldset>
                {item.extracted && <Extracted e={item.extracted} />}
              </>}
          </div>
        </div>
      )}
    </Modal>
  )
}

const Common = ({ p, set, children }) => (
  <div className="grid gap-3 sm:grid-cols-3">
    <Field label="Date"><input type="date" className="input" value={p.date || ''} onChange={(e) => set({ ...p, date: e.target.value })} /></Field>
    <Field label="Amount (Rs)"><input inputMode="decimal" className="input font-semibold" value={p.amount || ''} onChange={(e) => set({ ...p, amount: e.target.value })} /></Field>
    <Field label="Bank reference"><input className="input font-mono" value={p.reference || ''} onChange={(e) => set({ ...p, reference: e.target.value })} /></Field>
    {children}
  </div>
)

function Funding({ p, set }) {
  return (
    <Common p={p} set={set}>
      <Field label="Added by"><select className="input" value={p.director || ''} onChange={(e) => set({ ...p, director: e.target.value })}><option value="">Choose…</option><option value="omer">Omer</option><option value="usman">Usman</option></select></Field>
      <Field label="Into"><select className="input" value={p.into || 'bank'} onChange={(e) => set({ ...p, into: e.target.value })}><option value="bank">Bank Alfalah</option><option value="cash">Studio petty cash</option></select></Field>
    </Common>
  )
}

function ExpenseFields({ p, set, refData }) {
  return (
    <>
      <Common p={p} set={set}>
        <Field label="Paid from"><select className="input" value={p.paidFrom || 'bank'} onChange={(e) => set({ ...p, paidFrom: e.target.value })}>{Object.entries(PAID_FROM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Supplier" className="sm:col-span-2">
          <select className="input" value={p.supplierId || ''} onChange={(e) => { const s = refData.suppliers.find((x) => String(x.id) === e.target.value); set({ ...p, supplierId: e.target.value, supplierName: s?.name || '', accountId: p.accountId || s?.defaultAccountId || '' }) }}>
            <option value="">{p.supplierName && !p.supplierId ? `New: ${p.supplierName}` : 'None'}</option>{refData.suppliers.filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </Field>
      </Common>
      {!p.supplierId && <Field label="New supplier name" hint="Added when you approve; leave empty for none"><input className="input" value={p.supplierName || ''} onChange={(e) => set({ ...p, supplierName: e.target.value })} /></Field>}
      <Field label="Category"><CategorySelect accounts={refData.accounts} value={p.accountId} onChange={(v) => set({ ...p, accountId: v })} /></Field>
      <Field label="What was it for?"><input className="input" value={p.description || ''} onChange={(e) => set({ ...p, description: e.target.value })} /></Field>
    </>
  )
}

function StaffPaymentFields({ p, set, refData }) {
  const [owed, setOwed] = useState(null)
  useEffect(() => { setOwed(null); if (p.staffId) getStaffOwed(p.staffId).then(setOwed).catch(() => {}) }, [p.staffId])
  const parts = p.parts || []
  const setPart = (i, patch) => set({ ...p, parts: parts.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
  const sum = parts.reduce((s, x) => s + (safePaisa(x.amount) || 0), 0)
  return (
    <>
      <Common p={p} set={set}>
        <Field label="Paid to"><select className="input" value={p.staffId || ''} onChange={(e) => { const s = refData.staff.find((x) => String(x.id) === e.target.value); set({ ...p, staffId: e.target.value, staffName: s?.name || '' }) }}>
          <option value="">Choose…</option>{refData.staff.filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Paid from"><select className="input" value={p.paidFrom || 'bank'} onChange={(e) => set({ ...p, paidFrom: e.target.value })}>{Object.entries(PAY_FROM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      </Common>
      <div className="space-y-2">
        <p className="font-label text-[11px] font-semibold uppercase tracking-wider text-muted">What it paid · {formatRs(sum)} of {fmtRs(p.amount || 0)}</p>
        {parts.map((x, i) => (
          <div key={i} className="space-y-2 rounded-xl border border-line p-3">
            <div className="flex flex-wrap items-center gap-2">
              <select className="input w-36 py-1.5" value={x.kind} onChange={(e) => setPart(i, { kind: e.target.value, claimId: null, payrollLineId: null, lines: e.target.value === 'claim' ? [{ accountId: '', description: '', amount: x.amount }] : undefined })}>
                <option value="salary">Salary</option><option value="claim">Studio claim</option><option value="advance">Advance</option></select>
              <input inputMode="decimal" className="input w-32 py-1.5 text-right" value={x.amount} onChange={(e) => setPart(i, { amount: e.target.value })} />
              {x.kind === 'salary' && (
                <select className="input min-w-[180px] flex-1 py-1.5" value={x.payrollLineId || ''} onChange={(e) => setPart(i, { payrollLineId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">Not linked to a payroll week</option>
                  {x.payrollLineId && !owed?.weeks.some((w) => w.payrollLineId === x.payrollLineId) && <option value={x.payrollLineId}>Week ending {fmtDate(x.weekEnding)}</option>}
                  {owed?.weeks.map((w) => <option key={w.payrollLineId} value={w.payrollLineId}>Week ending {fmtDate(w.weekEnding)} · due {fmtRs(w.due, { decimals: false })}</option>)}
                </select>)}
              {x.kind === 'claim' && (
                <select className="input min-w-[180px] flex-1 py-1.5" value={x.claimId || ''} onChange={(e) => setPart(i, { claimId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">New claim from this payment</option>
                  {owed?.claims.map((c) => <option key={c.id} value={c.id}>Approved claim w/e {fmtDate(c.weekEnding)} · {fmtRs(c.total, { decimals: false })}</option>)}
                </select>)}
              <button type="button" className="btn-icon" onClick={() => set({ ...p, parts: parts.filter((_, j) => j !== i) })} aria-label="Remove"><Trash2 size={13} /></button>
            </div>
            {x.kind === 'salary' && !x.payrollLineId && <p className="text-[11px] text-amber-700 dark:text-amber-300">Post the payroll week first if you can, so the payment settles it.</p>}
            {x.kind === 'claim' && !x.claimId && (
              <div className="space-y-1.5 pl-2">
                {(x.lines || []).map((l, k) => (
                  <div key={k} className="grid grid-cols-[1fr_90px_28px] gap-1.5 sm:grid-cols-[200px_1fr_100px_28px]">
                    <div className="col-span-3 sm:col-span-1"><CategorySelect accounts={refData.accounts} value={l.accountId} className="input py-1 text-xs" onChange={(v) => setPart(i, { lines: x.lines.map((y, m) => (m === k ? { ...y, accountId: v } : y)) })} /></div>
                    <input className="input py-1 text-xs" value={l.description} placeholder="e.g. thread, water, electrician" onChange={(e) => setPart(i, { lines: x.lines.map((y, m) => (m === k ? { ...y, description: e.target.value } : y)) })} />
                    <input inputMode="decimal" className="input py-1 text-right text-xs" value={l.amount} onChange={(e) => setPart(i, { lines: x.lines.map((y, m) => (m === k ? { ...y, amount: e.target.value } : y)) })} />
                    <button type="button" className="btn-icon" disabled={x.lines.length <= 1} onClick={() => setPart(i, { lines: x.lines.filter((_, m) => m !== k) })} aria-label="Remove"><Trash2 size={12} /></button>
                  </div>
                ))}
                <button type="button" className="btn-ghost text-xs" onClick={() => setPart(i, { lines: [...(x.lines || []), { accountId: '', description: '', amount: '' }] })}><Plus size={12} />Split the market spend</button>
              </div>
            )}
          </div>
        ))}
        <button type="button" className="btn-ghost text-xs" onClick={() => set({ ...p, parts: [...parts, { kind: 'salary', amount: '' }] })}><Plus size={12} />Add a part</button>
      </div>
    </>
  )
}

// What the reader saw (for checking against the picture)
function Extracted({ e }) {
  const [show, setShow] = useState(false)
  const rows = [['From', [e.fromName, e.fromLast4 && `…${e.fromLast4}`].filter(Boolean).join(' ')], ['To', [e.toName, e.toLast4 && `…${e.toLast4}`].filter(Boolean).join(' ')],
    ['Shop', e.shop], ['Purpose', e.purpose], ['Source', e.source], ['Time', e.time]].filter(([, v]) => v)
  return (
    <div className="rounded-xl border border-line">
      <button type="button" className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-semibold text-muted" onClick={() => setShow(!show)}>{show ? <ChevronDown size={13} /> : <ChevronRight size={13} />}What was read</button>
      {show && (
        <div className="space-y-2 border-t border-line px-3 py-2 text-xs">
          <dl className="grid grid-cols-[80px_1fr] gap-1">{rows.map(([k, v]) => [<dt key={k} className="text-muted">{k}</dt>, <dd key={`${k}v`} className="text-ink">{v}</dd>])}</dl>
          {e.noteLines?.length > 0 && <div><p className="text-muted">Note</p>{e.noteLines.map((l, i) => <p key={i} className="text-ink">{l.text}{l.amount != null && ` · ${l.amount.toLocaleString()}`}</p>)}</div>}
          {e.items?.length > 0 && <div><p className="text-muted">Items</p>{e.items.map((l, i) => <p key={i} className="text-ink">{l.description}{l.amount != null && ` · ${l.amount.toLocaleString()}`}</p>)}</div>}
        </div>
      )}
    </div>
  )
}

// Typing the details in by hand (no reader, or the reading was wrong); then classified by the same rules
const parseLines = (text) => text.split('\n').map((s) => s.trim()).filter(Boolean).map((s) => {
  const m = s.match(/^(.*?)[\s:=-]*(?:rs\.?\s*)?([\d,]+(?:\.\d{1,2})?)\s*$/i)
  return m && m[1].trim() ? { text: m[1].trim(), amount: Number(m[2].replace(/,/g, '')) } : { text: s, amount: null }
})
function TypeIn({ item, busy, onSave }) {
  const e = item.extracted || {}
  const [f, setF] = useState({ doc_type: e.docType && e.docType !== 'other' ? e.docType : 'bank_transfer', date: e.date || '', amount: e.amount ?? '', reference: e.reference || '',
    from_name: e.fromName || '', to_name: e.toName || '', shop: e.shop || '', purpose: e.purpose || '',
    notes: (e.docType === 'receipt' || e.docType === 'bill' ? e.items?.map((l) => `${l.description}${l.amount != null ? ` ${l.amount}` : ''}`) : e.noteLines?.map((l) => `${l.text}${l.amount != null ? ` ${l.amount}` : ''}`))?.join('\n') || '' })
  const set = (k) => (ev) => setF({ ...f, [k]: ev.target.value })
  const transfer = f.doc_type === 'bank_transfer'
  const lines = useMemo(() => parseLines(f.notes), [f.notes])
  const save = () => onSave({
    doc_type: f.doc_type, date: f.date, amount: f.amount, reference: f.reference, purpose: f.purpose,
    ...(transfer ? { from_name: f.from_name, to_name: f.to_name, note_lines: lines } : { shop: f.shop, items: lines.map((l) => ({ description: l.text, amount: l.amount })), total: f.amount }),
  })
  return (
    <div className="space-y-3">
      <Segmented options={[{ value: 'bank_transfer', label: 'Bank transfer' }, { value: 'receipt', label: 'Receipt' }, { value: 'bill', label: 'Bill' }]} value={f.doc_type} onChange={(v) => setF({ ...f, doc_type: v })} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Date"><input type="date" className="input" value={f.date} onChange={set('date')} /></Field>
        <Field label="Amount (Rs)"><input inputMode="decimal" className="input" value={f.amount} onChange={set('amount')} /></Field>
        <Field label="Reference"><input className="input font-mono" value={f.reference} onChange={set('reference')} /></Field>
      </div>
      {transfer ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From (name)" hint="e.g. Omer Farooq, Koko Atelier"><input className="input" value={f.from_name} onChange={set('from_name')} /></Field>
          <Field label="To (name)"><input className="input" value={f.to_name} onChange={set('to_name')} /></Field>
        </div>
      ) : <Field label="Shop / supplier"><input className="input" value={f.shop} onChange={set('shop')} /></Field>}
      <Field label={transfer ? 'Sticker note, one line each' : 'Items, one line each'} hint={transfer ? 'e.g. "Tailor Salary 17500" and "Market 5700"' : 'e.g. "Lawn fabric 3200"'}>
        <textarea rows={4} className="input font-mono text-xs" value={f.notes} onChange={set('notes')} />
      </Field>
      <div className="flex justify-end"><button className="btn-primary" disabled={busy} onClick={save}>Use these details</button></div>
    </div>
  )
}

// ── Sticker-note words ─────────────────────────────────────────────────
function StickerWords({ accounts }) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState(null)
  const [editing, setEditing] = useState(null)
  useEffect(() => { if (open && !rows) getIntakeLabels().then(setRows).catch((e) => toast.error(e.message)) }, [open, rows])
  const save = async () => { try { setRows(await saveIntakeLabel(editing.id, editing)); setEditing(null); toast.success('Saved') } catch (err) { toast.error(err.message) } }
  return (
    <div className="card">
      <button className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-ink" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}<Tags size={15} />Sticker-note words <span className="font-normal text-muted">· what "Salary", "Market", "Funds added"… on a note mean</span></button>
      {open && (!rows ? <div className="p-4"><SkeletonRows rows={3} /></div> : (
        <div className="border-t border-line">
          <table className="w-full text-sm"><tbody className="divide-y divide-line">
            {rows.map((l) => (
              <tr key={l.id} className={`cursor-pointer hover:bg-subtle/60 ${l.isActive ? '' : 'opacity-50'}`} onClick={() => setEditing({ ...l, accountId: l.accountId ? String(l.accountId) : '' })}>
                <td className="px-4 py-2 font-medium text-ink">{l.label}</td><td className="px-3 py-2 text-muted">{LABEL_KINDS[l.kind]}</td>
                <td className="px-4 py-2 text-xs text-muted">{l.accountCode && `${l.accountCode} ${l.accountName}`}</td></tr>
            ))}
          </tbody></table>
          <div className="p-3"><button className="btn-ghost text-xs" onClick={() => setEditing({ label: '', kind: 'expense', accountId: '', isActive: true })}><Plus size={12} />Add a word</button></div>
        </div>
      ))}
      {editing && (
        <Modal open onClose={() => setEditing(null)} title={editing.id ? editing.label : 'New word'} footer={<><button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button><button className="btn-primary" onClick={save}>Save</button></>}>
          <div className="grid gap-4 p-5">
            <Field label="Word on the note"><input className="input" value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} /></Field>
            <Field label="Means"><select className="input" value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value })}>{Object.entries(LABEL_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            {['claim', 'expense'].includes(editing.kind) && <Field label="Category"><CategorySelect accounts={accounts} value={editing.accountId} onChange={(v) => setEditing({ ...editing, accountId: v })} /></Field>}
            {editing.id && <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={editing.isActive} onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })} />In use</label>}
          </div>
        </Modal>
      )}
    </div>
  )
}
