import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { BookOpen, Plus, Trash2, Save, Send, AlertTriangle, CheckCircle2, Paperclip } from 'lucide-react'
import { getAccounts, getPeriods, getEntry, createEntry, updateDraft, attachEntryFile, readFile } from '../../data/finance'
import { PageHeader, Field, SkeletonRows } from '../../ui/kit'
import { AccountSelect, safePaisa, formatRs, todayPk, periodFor } from './shared'

let seq = 0
const blankLine = () => ({ key: ++seq, accountId: '', description: '', debit: '', credit: '' })

// Manual journal: lines with running totals; Post stays off until debits equal credits
export default function JournalEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [accounts, setAccounts] = useState(null)
  const [periods, setPeriods] = useState([])
  const [date, setDate] = useState(todayPk())
  const [memo, setMemo] = useState('')
  const [lines, setLines] = useState([blankLine(), blankLine()])
  const [reason, setReason] = useState('')
  const [files, setFiles] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([getAccounts(), getPeriods(), id ? getEntry(id) : null]).then(([a, p, e]) => {
      setAccounts(a); setPeriods(p)
      if (e) {
        if (e.status !== 'Draft') { toast.error('Only drafts can be edited'); navigate(`/finance/journals/${id}`, { replace: true }); return }
        setDate(e.date); setMemo(e.memo)
        setLines(e.lines.map((l) => ({ key: ++seq, accountId: String(l.accountId), description: l.description, debit: Number(l.debit) ? l.debit : '', credit: Number(l.credit) ? l.credit : '' })))
      }
    }).catch((err) => toast.error(err.message))
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const setLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const totals = useMemo(() => {
    let d = 0, c = 0, bad = false
    for (const l of lines) { const a = safePaisa(l.debit), b = safePaisa(l.credit); if (Number.isNaN(a) || Number.isNaN(b)) bad = true; else { d += a; c += b } }
    return { d, c, bad }
  }, [lines])
  const filled = lines.filter((l) => l.accountId || l.debit || l.credit)
  const lineProblem = filled.find((l) => !l.accountId || (safePaisa(l.debit) > 0) === (safePaisa(l.credit) > 0))
  const period = periodFor(periods, date)
  const balanced = !totals.bad && totals.d === totals.c && totals.d > 0
  const canPost = balanced && filled.length >= 2 && !lineProblem && period && period.status !== 'Locked' && (period.status !== 'Closed' || reason.trim())

  const save = async (post) => {
    setSaving(true)
    try {
      const payload = { date, memo, post, overrideReason: reason, lines: filled.map(({ accountId, description, debit, credit }) => ({ accountId, description, debit, credit })) }
      const e = id ? await updateDraft(id, payload) : await createEntry(payload)
      for (const f of files) await attachEntryFile(e.id, await readFile(f)).catch((err) => toast.error(`${f.name}: ${err.message}`))
      toast.success(post ? `${e.entryNo} posted` : 'Draft saved')
      navigate(`/finance/journals/${e.id}`)
    } catch (err) { toast.error(err.message) } finally { setSaving(false) }
  }

  if (!accounts) return <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8"><SkeletonRows rows={6} /></div>
  const diff = totals.d - totals.c

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader eyebrow="Finance" title={id ? 'Edit draft journal' : 'New journal'} icon={BookOpen} subtitle="A manual entry. Debits must equal credits before it can be posted." />
      <div className="card grid gap-4 p-5 sm:grid-cols-[180px_1fr]">
        <Field label="Date" hint={period ? `${period.name} · ${period.status}` : 'No accounting period for this date'}>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Memo"><input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="e.g. Funds added by Omer, Askari ref 326622377526" /></Field>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-surface-accent text-left font-label text-[10.5px] uppercase tracking-wider text-ink">
            <tr><th className="w-10 px-3 py-2.5" /><th className="px-2 py-2.5 font-medium">Account</th><th className="px-2 py-2.5 font-medium">Description</th>
              <th className="w-36 px-2 py-2.5 text-right font-medium">Debit</th><th className="w-36 px-2 py-2.5 text-right font-medium">Credit</th><th className="w-10" /></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {lines.map((l, i) => (
              <tr key={l.key}>
                <td className="px-3 py-1.5 text-xs text-faint">{i + 1}</td>
                <td className="px-2 py-1.5"><AccountSelect accounts={accounts} manual value={l.accountId} onChange={(v) => setLine(l.key, { accountId: v })} className="input py-1.5 text-sm" /></td>
                <td className="px-2 py-1.5"><input className="input py-1.5 text-sm" value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} /></td>
                <td className="px-2 py-1.5"><input inputMode="decimal" className="input py-1.5 text-right text-sm tabular-nums" value={l.debit} placeholder="0.00"
                  onChange={(e) => setLine(l.key, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} /></td>
                <td className="px-2 py-1.5"><input inputMode="decimal" className="input py-1.5 text-right text-sm tabular-nums" value={l.credit} placeholder="0.00"
                  onChange={(e) => setLine(l.key, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} /></td>
                <td className="pr-3"><button type="button" className="btn-icon hover:text-rose-600" disabled={lines.length <= 2} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label="Remove line"><Trash2 size={14} /></button></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line bg-subtle/60 font-semibold tabular-nums">
              <td colSpan={3} className="px-3 py-2.5"><button type="button" className="btn-ghost text-xs" onClick={() => setLines((ls) => [...ls, blankLine()])}><Plus size={13} />Add line</button></td>
              <td className="px-2 py-2.5 text-right text-ink">{totals.bad ? '—' : formatRs(totals.d)}</td>
              <td className="px-2 py-2.5 text-right text-ink">{totals.bad ? '—' : formatRs(totals.c)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="space-y-3">
        {totals.bad ? <p className="flex items-center gap-2 text-sm text-rose-600"><AlertTriangle size={15} />An amount isn't valid (numbers with up to 2 decimals).</p>
          : balanced ? <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400"><CheckCircle2 size={15} />Balanced · {formatRs(totals.d)}</p>
          : <p className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300"><AlertTriangle size={15} />{totals.d || totals.c ? `Not balanced: ${diff > 0 ? 'debits' : 'credits'} are ${formatRs(Math.abs(diff))} higher` : 'Enter the amounts'}</p>}
        {lineProblem && <p className="text-xs text-muted">Each line needs an account and either a debit or a credit.</p>}
        {period?.status === 'Closed' && (
          <Field label={`${period.name} is closed. Reason for posting into it`}><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Late supplier bill for September" /></Field>
        )}
        {period?.status === 'Locked' && <p className="text-sm text-rose-600">{period.name} is locked; nothing can be posted into it.</p>}
        <label className="flex w-fit cursor-pointer items-center gap-2 rounded-xl border border-dashed border-line px-3 py-2 text-sm text-muted hover:text-accent">
          <Paperclip size={14} />{files.length ? files.map((f) => f.name).join(', ') : 'Attach a receipt or working (optional)'}
          <input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf,.csv,.xlsx" className="sr-only" onChange={(e) => setFiles([...e.target.files])} />
        </label>
        <div className="flex flex-wrap justify-end gap-2">
          <button className="btn-secondary" onClick={() => navigate(-1)}>Cancel</button>
          <button className="btn-secondary" onClick={() => save(false)} disabled={saving || filled.length < 1}><Save size={15} />Save draft</button>
          <button className="btn-primary" onClick={() => save(true)} disabled={saving || !canPost} title={canPost ? '' : 'Balance the entry first'}><Send size={15} />{saving ? 'Saving…' : 'Post'}</button>
        </div>
      </div>
    </div>
  )
}
