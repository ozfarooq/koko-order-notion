import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { BookOpen, Undo2, Pencil, Send, Trash2, Paperclip, FileText, ArrowLeft } from 'lucide-react'
import { getEntry, getPeriods, reverseEntry, postDraft, deleteDraft, attachEntryFile, readFile, openFinanceFile, ENTRY_LABELS } from '../../data/finance'
import { PageHeader, Modal, Field, SkeletonRows, ErrorBanner, fmtDate } from '../../ui/kit'
import { FinBadge, fmtRs, todayPk, periodFor, toPaisa, formatRs } from './shared'
import { confirmDialog, promptDialog } from '../../ui/dialog'

export default function EntryView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [e, setE] = useState(null)
  const [periods, setPeriods] = useState([])
  const [error, setError] = useState(null)
  const [reversing, setReversing] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => Promise.all([getEntry(id), getPeriods()]).then(([x, p]) => { setE(x); setPeriods(p); setError(null) }).catch((err) => setError(err.message)), [id])
  useEffect(() => { load() }, [load])

  const act = async (fn, done) => {
    setBusy(true)
    try { const r = await fn(); toast.success(done(r)); return r } catch (err) { toast.error(err.message) } finally { setBusy(false) }
  }
  const reverse = async () => {
    const r = await act(() => reverseEntry(e.id, reversing), (x) => `${e.entryNo} reversed by ${x.entryNo}`)
    if (r) { setReversing(null); navigate(`/finance/journals/${r.id}`) }
  }
  const post = async () => {
    const p = periodFor(periods, e.date)
    let reason
    if (p?.status === 'Closed') { reason = await promptDialog({ title: `${p.name} is closed`, message: 'Only you can post into a closed month, and the reason is kept with the entry.', label: 'Reason for posting into it', required: true, confirmLabel: 'Post' }); if (!reason) return }
    if (await act(() => postDraft(e.id, reason), (x) => `${x.entryNo} posted`)) load()
  }
  const remove = async () => {
    if (!await confirmDialog('Delete this draft?')) return
    if (await act(() => deleteDraft(e.id).then(() => true), () => 'Draft deleted')) navigate('/finance/journals')
  }
  const attach = async (list) => {
    for (const f of list) await act(async () => attachEntryFile(e.id, await readFile(f)), () => `${f.name} attached`)
    load()
  }

  if (error) return <div className="mx-auto max-w-5xl p-4 sm:p-6 lg:p-8"><ErrorBanner onRetry={load}>{error}</ErrorBanner></div>
  if (!e) return <div className="mx-auto max-w-5xl p-4 sm:p-6 lg:p-8"><SkeletonRows rows={6} /></div>
  const reversePeriod = reversing ? periodFor(periods, reversing.date) : null

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 lg:p-8">
      <Link to="/finance/journals" className="inline-flex items-center gap-1 text-sm text-muted hover:text-accent"><ArrowLeft size={14} />Journals</Link>
      <PageHeader eyebrow={ENTRY_LABELS[e.entryType] || e.entryType} title={e.entryNo || 'Draft journal'} icon={BookOpen} subtitle={e.memo || undefined}
        actions={<>
          {e.status === 'Draft' && <>
            <button className="btn-ghost text-rose-600" onClick={remove} disabled={busy}><Trash2 size={15} />Delete</button>
            <button className="btn-secondary" onClick={() => navigate(`/finance/journals/${e.id}/edit`)}><Pencil size={15} />Edit</button>
            <button className="btn-primary" onClick={post} disabled={busy}><Send size={15} />Post</button>
          </>}
          {e.status === 'Posted' && <button className="btn-secondary" onClick={() => setReversing({ date: todayPk(), reason: '', overrideReason: '' })}><Undo2 size={15} />Reverse</button>}
        </>} />

      <div className="card grid gap-x-6 gap-y-3 p-5 text-sm sm:grid-cols-4">
        <div><p className="label">Status</p><FinBadge status={e.status} /></div>
        <div><p className="label">Date</p><p className="text-ink">{fmtDate(e.date)}</p></div>
        <div><p className="label">Period</p><p className="text-ink">{e.periodName}</p></div>
        <div><p className="label">Amount</p><p className="font-semibold text-ink">{fmtRs(e.total)}</p></div>
        {e.postedBy && <div className="sm:col-span-2"><p className="label">Posted</p><p className="text-ink">{e.postedBy} · {fmtDate(e.postedAt, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</p></div>}
        {e.reversalOf && <div className="sm:col-span-2"><p className="label">Reverses</p><Link className="font-mono text-xs font-semibold text-accent" to={`/finance/journals/${e.reversalOf.id}`}>{e.reversalOf.entryNo}</Link></div>}
        {e.reversedBy && <div className="sm:col-span-2"><p className="label">Reversed by</p><Link className="font-mono text-xs font-semibold text-accent" to={`/finance/journals/${e.reversedBy.id}`}>{e.reversedBy.entryNo}</Link></div>}
        {e.overrideReason && <div className="sm:col-span-4"><p className="label">Posted into a closed period because</p><p className="text-ink">{e.overrideReason}</p></div>}
        {e.sourceType && e.sourceType !== 'reversal' && <div className="sm:col-span-2"><p className="label">Source</p><p className="text-ink">{e.sourceType} · {e.sourceEvent}</p></div>}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-surface-accent text-left font-label text-[10.5px] uppercase tracking-wider text-ink">
            <tr><th className="px-4 py-2.5 font-medium">Account</th><th className="px-3 py-2.5 font-medium">Description</th><th className="px-3 py-2.5 text-right font-medium">Debit</th><th className="px-4 py-2.5 text-right font-medium">Credit</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {e.lines.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-2.5"><span className="font-mono text-xs text-muted">{l.accountCode}</span> <span className="text-ink">{l.accountName}</span></td>
                <td className="px-3 py-2.5 text-ink-soft">{l.description || <span className="text-faint">—</span>}{l.currency !== 'PKR' && <span className="ml-1 text-xs text-muted">({l.currency} {l.amountFc} @ {l.fxRate})</span>}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-ink">{Number(l.debit) ? fmtRs(l.debit, { symbol: '' }) : ''}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink">{Number(l.credit) ? fmtRs(l.credit, { symbol: '' }) : ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t-2 border-line bg-subtle/60 font-semibold tabular-nums">
            <td colSpan={2} className="px-4 py-2.5 text-ink">Total</td>
            <td className="px-3 py-2.5 text-right text-ink">{fmtRs(e.total, { symbol: '' })}</td>
            <td className="px-4 py-2.5 text-right text-ink">{formatRs(e.lines.reduce((s, l) => s + toPaisa(l.credit), 0), { symbol: '' })}</td>
          </tr></tfoot>
        </table>
      </div>

      <div className="space-y-2">
        <p className="label">Attachments</p>
        <div className="flex flex-wrap items-center gap-2">
          {e.files.map((f) => (
            <button key={f.id} type="button" onClick={() => openFinanceFile(f.id).catch((err) => toast.error(err.message))}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs text-ink-soft hover:text-accent"><FileText size={12} />{f.name}</button>
          ))}
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-dashed border-line px-3 py-1 text-xs text-muted hover:text-accent">
            <Paperclip size={12} />Attach
            <input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf,.csv,.xlsx" className="sr-only" onChange={(x) => attach([...x.target.files])} />
          </label>
        </div>
      </div>

      <Modal open={!!reversing} onClose={() => setReversing(null)} title={`Reverse ${e.entryNo}`} subtitle="Posts a mirror entry with debits and credits swapped. The original stays in the books, marked Reversed." size="md"
        footer={<><button className="btn-secondary" onClick={() => setReversing(null)}>Cancel</button><button className="btn-primary" onClick={reverse} disabled={busy || !reversing?.reason.trim()}><Undo2 size={15} />Reverse</button></>}>
        {reversing && (
          <div className="space-y-4 p-5">
            <Field label="Reversal date" hint={reversePeriod ? `${reversePeriod.name} · ${reversePeriod.status}` : 'No accounting period for this date'}>
              <input type="date" className="input" value={reversing.date} onChange={(x) => setReversing((r) => ({ ...r, date: x.target.value }))} />
            </Field>
            <Field label="Why is it being reversed?"><input autoFocus className="input" value={reversing.reason} onChange={(x) => setReversing((r) => ({ ...r, reason: x.target.value }))} placeholder="e.g. Entered twice, wrong account" /></Field>
            {reversePeriod?.status === 'Closed' && <Field label={`${reversePeriod.name} is closed. Reason for posting into it`}><input className="input" value={reversing.overrideReason} onChange={(x) => setReversing((r) => ({ ...r, overrideReason: x.target.value }))} /></Field>}
          </div>
        )}
      </Modal>
    </div>
  )
}
