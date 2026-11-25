import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { ShoppingBasket, Plus, Trash2, Paperclip, Check, X, Undo2, Pencil, Wallet } from 'lucide-react'
import { getAccounts, getStaff, getClaims, getClaim, createClaim, updateClaim, approveClaim, unapproveClaim, rejectClaim, uploadFiles, openFinanceFile } from '../../data/finance'
import { PageHeader, Modal, Field, Segmented, SkeletonRows, EmptyState, ErrorBanner, fmtDate } from '../../ui/kit'
import { FinBadge, fmtRs, formatRs, safePaisa, todayPk, CategorySelect, FilePick, askReason } from './shared'

const FILTERS = [{ value: 'Submitted', label: 'To approve' }, { value: 'Approved', label: 'To pay' }, { value: 'Paid', label: 'Paid' }, { value: 'Rejected', label: 'Rejected' }, { value: '', label: 'All' }]
// The Saturday on or after a date (weeks end on Saturday)
export const saturdayOf = (d) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + ((6 - t.getUTCDay() + 7) % 7)); return t.toISOString().slice(0, 10) }
let seq = 0
const blankItem = () => ({ key: ++seq, accountId: '', description: '', amount: '' })

// The weekly market spend by the studio (thread, buttons, rickshaw…): submitted, approved into the books, then paid with salary
export default function Claims() {
  const [status, setStatus] = useState('Submitted')
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [ref, setRef] = useState(null)
  const [editing, setEditing] = useState(null)
  const [viewing, setViewing] = useState(null)
  const load = useCallback(() => { getClaims({ status }).then((r) => { setRows(r); setError(null) }).catch((e) => setError(e.message)) }, [status])
  useEffect(() => { setRows(null); load() }, [load])
  useEffect(() => { Promise.all([getAccounts(), getStaff()]).then(([accounts, staff]) => setRef({ accounts, staff })).catch((e) => toast.error(e.message)) }, [])

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6 lg:p-8">
      <PageHeader eyebrow="Finance" title="Studio claims" icon={ShoppingBasket} subtitle="Weekly market spend by the studio. Approving books it; it is paid with the salary."
        actions={ref && <button className="btn-primary" onClick={() => setEditing({})}><Plus size={16} />New claim</button>} />
      <div className="overflow-x-auto"><Segmented options={FILTERS} value={status} onChange={setStatus} /></div>
      <ErrorBanner onRetry={load}>{error}</ErrorBanner>
      {!rows ? <SkeletonRows rows={5} /> : rows.length === 0 ? (
        <EmptyState icon={ShoppingBasket} title={status === 'Submitted' ? 'Nothing waiting for approval' : 'No claims here'} hint="Enter the week's market spend with photos of the receipts." />
      ) : (
        <div className="card divide-y divide-line">
          {rows.map((c) => (
            <button key={c.id} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-subtle/60" onClick={() => setViewing(c.id)}>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink">{c.staffName} · week ending {fmtDate(c.weekEnding)}</p>
                <p className="flex items-center gap-1.5 text-xs text-muted">{c.lines} item{c.lines === 1 ? '' : 's'}{c.files > 0 && <><Paperclip size={11} />{c.files}</>}{c.entryNo && ` · ${c.entryNo}`}</p>
              </div>
              <span className="font-semibold tabular-nums text-ink">{fmtRs(c.total)}</span>
              <FinBadge status={c.status} />
            </button>
          ))}
        </div>
      )}
      {editing && ref && <ClaimForm refData={ref} claim={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
      {viewing && <ClaimView id={viewing} onClose={() => setViewing(null)} onEdit={(c) => { setViewing(null); setEditing(c) }} onChanged={load} />}
    </div>
  )
}

function ClaimForm({ refData, claim, onClose, onSaved }) {
  const weekly = refData.staff.filter((s) => s.isActive)
  const [staffId, setStaffId] = useState(String(claim?.staffId || weekly[0]?.id || ''))
  const [weekEnding, setWeekEnding] = useState(claim?.weekEnding || saturdayOf(todayPk()))
  const [notes, setNotes] = useState(claim?.notes || '')
  const [items, setItems] = useState(claim ? claim.lineList.map((l) => ({ key: ++seq, accountId: String(l.accountId), description: l.description, amount: l.amount })) : [blankItem(), blankItem(), blankItem()])
  const [files, setFiles] = useState([])
  const [saving, setSaving] = useState(false)
  const setItem = (key, p) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)))
  const filled = items.filter((x) => x.description || x.amount)   // a category alone (filled in from the row above) isn't an item
  const total = useMemo(() => filled.reduce((s, x) => s + (safePaisa(x.amount) || 0), 0), [filled])
  // Remember the last category so a run of thread / buttons / lining is quick to enter
  const fillCategory = (key, v) => setItems((xs) => xs.map((x, i, all) => (x.key === key ? { ...x, accountId: v } : (!x.accountId && i > all.findIndex((y) => y.key === key) ? { ...x, accountId: v } : x))))

  const save = async () => {
    setSaving(true)
    try {
      const fileIds = await uploadFiles(files, 'claims')
      const payload = { staffId, weekEnding, notes, fileIds, lines: filled.map(({ accountId, description, amount }) => ({ accountId, description, amount })) }
      const c = claim ? await updateClaim(claim.id, payload) : await createClaim(payload)
      toast.success(`Claim saved: ${fmtRs(c.total)}`)
      onSaved(c)
    } catch (err) { toast.error(err.message) } finally { setSaving(false) }
  }
  return (
    <Modal open onClose={onClose} title={claim ? 'Edit claim' : 'New studio claim'} subtitle="Waiting for approval once saved; nothing is booked yet" size="lg"
      footer={<><span className="mr-auto self-center text-sm font-semibold text-ink">Total {formatRs(total)}</span>
        <button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={saving || !filled.length}>{saving ? 'Saving…' : 'Submit claim'}</button></>}>
      <div className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Spent by"><select className="input" value={staffId} onChange={(e) => setStaffId(e.target.value)}>{weekly.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Week ending" hint="Saturday"><input type="date" className="input" value={weekEnding} onChange={(e) => setWeekEnding(e.target.value)} /></Field>
        </div>
        <div className="space-y-2">
          {items.map((x, i) => (
            <div key={x.key} className="grid grid-cols-[1fr_110px_32px] gap-2 rounded-xl border border-line p-2 sm:grid-cols-[220px_1fr_120px_32px]">
              <div className="col-span-3 sm:col-span-1"><CategorySelect accounts={refData.accounts} value={x.accountId} onChange={(v) => fillCategory(x.key, v)} className="input py-1.5 text-sm" /></div>
              <input className="input py-1.5 text-sm" value={x.description} onChange={(e) => setItem(x.key, { description: e.target.value })} placeholder={`Item ${i + 1}, e.g. thread 12 reels`} />
              <input inputMode="decimal" className="input py-1.5 text-right text-sm tabular-nums" value={x.amount} onChange={(e) => setItem(x.key, { amount: e.target.value })} placeholder="Rs" />
              <button type="button" className="btn-icon hover:text-rose-600" onClick={() => setItems((xs) => xs.filter((y) => y.key !== x.key))} disabled={items.length <= 1} aria-label="Remove"><Trash2 size={14} /></button>
            </div>
          ))}
          <button type="button" className="btn-ghost text-xs" onClick={() => setItems((xs) => [...xs, blankItem()])}><Plus size={13} />Add item</button>
        </div>
        <FilePick files={files} onChange={setFiles} label="Attach receipt photos" />
        <Field label="Notes"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}

function ClaimView({ id, onClose, onEdit, onChanged }) {
  const [c, setC] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => getClaim(id).then(setC).catch((e) => toast.error(e.message)), [id])
  useEffect(() => { load() }, [load])
  const act = async (fn, msg) => { setBusy(true); try { await fn(); toast.success(msg); await load(); onChanged() } catch (err) { toast.error(err.message) } finally { setBusy(false) } }
  return (
    <Modal open onClose={onClose} title={c ? `${c.staffName} · ${fmtRs(c.total)}` : 'Claim'} subtitle={c ? `Week ending ${fmtDate(c.weekEnding)}` : ''} size="lg"
      footer={c && <>
        {c.status === 'Submitted' && <>
          <button className="btn-secondary text-rose-700" disabled={busy} onClick={async () => { const r = await askReason('Reject this claim?'); if (r) act(() => rejectClaim(id, r), 'Rejected') }}><X size={15} />Reject</button>
          <button className="btn-secondary" disabled={busy} onClick={() => onEdit(c)}><Pencil size={15} />Edit</button>
          <button className="btn-primary" disabled={busy} onClick={() => act(() => approveClaim(id), 'Approved and booked')}><Check size={15} />Approve</button>
        </>}
        {c.status === 'Approved' && <>
          <button className="btn-secondary" disabled={busy} onClick={async () => { const r = await askReason('Undo the approval? The booking is reversed.'); if (r) act(() => unapproveClaim(id, r), 'Approval undone') }}><Undo2 size={15} />Undo approval</button>
          <Link className="btn-primary" to={`/finance/payroll?tab=payments&pay=${c.staffId}`}><Wallet size={15} />Pay {c.staffName}</Link>
        </>}
      </>}>
      {!c ? <div className="p-5"><SkeletonRows rows={4} /></div> : (
        <div className="space-y-4 p-5 text-sm">
          <div className="flex flex-wrap items-center gap-2"><FinBadge status={c.status} />{c.entryNo && <Link to={`/finance/journals/${c.approvedEntryId}`} className="font-mono text-xs font-semibold text-accent">{c.entryNo}</Link>}
            {c.payments.map((p) => <span key={p.id} className="text-xs text-muted">paid {fmtDate(p.paidOn)} · {p.entryNo}</span>)}</div>
          <table className="w-full"><tbody className="divide-y divide-line">
            {c.lineList.map((l) => <tr key={l.id}><td className="py-1.5 text-ink">{l.description || '—'}</td><td className="py-1.5 text-xs text-muted">{l.accountCode} {l.accountName}</td><td className="py-1.5 text-right tabular-nums text-ink">{fmtRs(l.amount)}</td></tr>)}
            <tr className="font-semibold"><td className="py-2 text-ink" colSpan={2}>Total</td><td className="py-2 text-right tabular-nums text-ink">{fmtRs(c.total)}</td></tr>
          </tbody></table>
          {c.notes && <p className="whitespace-pre-line text-muted">{c.notes}</p>}
          <div className="space-y-1">{c.fileList.map((f) => <button key={f.id} className="flex items-center gap-2 text-accent hover:underline" onClick={() => openFinanceFile(f.id)}><Paperclip size={13} />{f.name}</button>)}
            {!c.fileList.length && <p className="text-xs text-amber-700 dark:text-amber-300">No receipts attached.</p>}</div>
        </div>
      )}
    </Modal>
  )
}
