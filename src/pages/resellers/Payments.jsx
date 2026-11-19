import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Plus, Wallet, Banknote, Undo2, Pencil, Paperclip, FileText, X, AlertTriangle } from 'lucide-react'
import { recordPayment, deletePayment, updatePayment, addPaymentFile, getPaymentFile, deletePaymentFile, pieceMoney } from '../../data/storage'
import { Modal, Field, StatCard, EmptyState, fmtDate } from '../../ui/kit'

const f2 = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const today = () => new Date().toISOString().slice(0, 10)
export const monthLabel = (k) => (k ? new Date(`${k}-01T00:00:00`).toLocaleDateString('en-PK', { month: 'long', year: 'numeric' }) : '')
const REASONS = ['Bank charges', 'Deduction for a return', 'Exchange difference', 'Rounding']
const MAX_FILE = 2.5 * 1024 * 1024

// The month most of these pieces sold in (a statement covers one month), else last month
function guessPeriod(pieces) {
  const counts = {}
  pieces.forEach((p) => { const k = (p.soldOn || '').slice(0, 7); if (k) counts[k] = (counts[k] || 0) + 1 })
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0]
  if (best) return best
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1)
  return d.toISOString().slice(0, 7)
}

// Photos are shrunk before upload; PDFs go as they are
async function readFile(file) {
  const asBase64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob) })
  if (file.type.startsWith('image/') && file.size > 400 * 1024) {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file) })
    const scale = Math.min(1, 1800 / Math.max(img.width, img.height))
    const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale)
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.82))
    return { name: file.name.replace(/\.\w+$/, '.jpg'), mime: 'image/jpeg', data: await asBase64(blob), size: blob.size }
  }
  return { name: file.name, mime: file.type, data: await asBase64(file), size: file.size }
}

async function upload(resellerId, paymentId, files) {
  for (const file of files) {
    if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type)) throw new Error(`${file.name}: attach a photo or a PDF`)
    const f = await readFile(file)
    if (f.size > MAX_FILE) throw new Error(`${file.name} is over 2.5 MB. Try a smaller file.`)
    await addPaymentFile(resellerId, paymentId, { name: f.name, mime: f.mime, data: f.data })
  }
}

async function openFile(resellerId, paymentId, file) {
  const tab = window.open('', '_blank')
  try {
    const f = await getPaymentFile(resellerId, paymentId, file.id)
    const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: f.mime }))
    if (tab) tab.location.href = url; else window.location.href = url
  } catch (err) { tab?.close(); toast.error(err.message) }
}

// Amount, month, PKR, reason, notes: the same fields for a new payment and an edit
function PaymentFields({ form, set, currency, expected }) {
  const amount = form.amount === '' ? expected : Number(form.amount)
  const diff = expected != null ? Math.round((amount - expected) * 100) / 100 : 0
  const rate = Number(form.amountPkr) > 0 && amount > 0 ? Number(form.amountPkr) / amount : null
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Date received"><input type="date" className="input" value={form.paidOn} onChange={(e) => set({ paidOn: e.target.value })} /></Field>
        <Field label="For sales in" hint="The statement month this settles"><input type="month" className="input" value={form.period} onChange={(e) => set({ period: e.target.value })} /></Field>
        <Field label={`Amount (${currency})`} hint={expected != null ? `Statement says ${f2(expected)}` : undefined}>
          <input type="number" min="0" step="0.01" className="input" value={form.amount} placeholder={expected != null ? f2(expected) : ''} onChange={(e) => set({ amount: e.target.value })} />
        </Field>
      </div>
      {Math.abs(diff) >= 1 && (
        <div className="space-y-2 rounded-xl bg-amber-50 p-3 dark:bg-amber-950/30">
          <p className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-300"><AlertTriangle size={15} />{diff < 0 ? 'Short' : 'Over'} by {currency} {f2(Math.abs(diff))} against the statement. Say why.</p>
          <input className="input" value={form.differenceReason} onChange={(e) => set({ differenceReason: e.target.value })} placeholder="Reason for the difference" />
          <div className="flex flex-wrap gap-1.5">
            {REASONS.map((r) => <button key={r} type="button" onClick={() => set({ differenceReason: r })} className="rounded-full border border-amber-300/70 bg-white/60 px-2.5 py-0.5 text-xs text-amber-900 hover:bg-white dark:bg-transparent dark:text-amber-200">{r}</button>)}
          </div>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="PKR received in the bank" hint={rate ? `1 ${currency} = ${rate.toFixed(2)} PKR` : 'Optional; add it later when the credit shows'}>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-faint">PKR</span>
            <input type="number" min="0" className="input pl-11" value={form.amountPkr} onChange={(e) => set({ amountPkr: e.target.value })} />
          </div>
        </Field>
        <Field label="Reference" className="sm:col-span-2"><input className="input" value={form.reference} onChange={(e) => set({ reference: e.target.value })} placeholder="e.g. Collage email “Payment Sept 26”, bank ref." /></Field>
      </div>
      <Field label="Notes"><input className="input" value={form.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
    </>
  )
}

function FileChips({ resellerId, payment, canWrite, onChanged }) {
  const remove = async (f) => {
    if (!window.confirm(`Remove ${f.name}?`)) return
    try { await deletePaymentFile(resellerId, payment.id, f.id); onChanged() } catch (err) { toast.error(err.message) }
  }
  return payment.files.map((f) => (
    <span key={f.id} className="inline-flex max-w-[220px] items-center gap-1 rounded-full border border-line bg-surface py-0.5 pl-2 pr-1 text-[11px] text-ink-soft">
      <button type="button" className="inline-flex min-w-0 items-center gap-1 hover:text-accent" onClick={() => openFile(resellerId, payment.id, f)}>
        <FileText size={11} className="flex-shrink-0" /><span className="truncate">{f.name}</span>
      </button>
      {canWrite && <button type="button" className="rounded-full p-0.5 text-faint hover:text-rose-600" onClick={() => remove(f)} aria-label={`Remove ${f.name}`}><X size={11} /></button>}
    </span>
  ))
}

export default function Payments({ reseller, pieces, payments, canWrite, onSaved }) {
  const cur = reseller.currency
  const unpaid = pieces.filter((p) => p.status === 'FC - Sold')
  const untracked = pieces.filter((p) => p.status === 'FC - Paid' && !p.paymentId)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [form, setForm] = useState({})
  const [files, setFiles] = useState([])
  const [saving, setSaving] = useState(false)
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const expected = Math.round(unpaid.filter((p) => selected.has(p.id)).reduce((s, p) => s + pieceMoney(p).netPayable, 0) * 100) / 100
  const pkrTotal = useMemo(() => payments.reduce((s, p) => s + (p.amountPkr || 0), 0), [payments])

  const start = () => {
    setSelected(new Set(unpaid.map((p) => p.id)))
    setForm({ paidOn: today(), period: guessPeriod(unpaid), amount: '', amountPkr: '', reference: '', notes: '', differenceReason: '' })
    setFiles([]); setOpen(true)
  }
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const save = async () => {
    setSaving(true)
    try {
      const amount = form.amount === '' ? expected : Number(form.amount)
      const r = await recordPayment(reseller.id, { ...form, amount, pieceIds: [...selected] })
      if (files.length) await upload(reseller.id, r.paymentId, files).catch((err) => toast.error(`Payment saved, but a file didn't upload: ${err.message}`))
      toast.success(`Payment recorded · ${r.pieces} piece${r.pieces === 1 ? '' : 's'} marked paid`)
      setOpen(false); onSaved()
    } catch (err) { toast.error(err.message) } finally { setSaving(false) }
  }

  const startEdit = (p) => {
    setEditing(p)
    setForm({ paidOn: p.paidOn, period: p.period || '', amount: String(p.amount), amountPkr: p.amountPkr ?? '', reference: p.reference, notes: p.notes, differenceReason: p.differenceReason })
    setFiles([])
  }
  const saveEdit = async () => {
    setSaving(true)
    try {
      await updatePayment(reseller.id, editing.id, { ...form, amount: Number(form.amount) })
      if (files.length) await upload(reseller.id, editing.id, files)
      toast.success('Payment updated'); setEditing(null); onSaved()
    } catch (err) { toast.error(err.message) } finally { setSaving(false) }
  }
  const remove = async (p) => {
    if (!window.confirm(`Remove the ${fmtDate(p.paidOn)} payment? Its ${p.pieces} piece(s) go back to "Sold".`)) return
    try { await deletePayment(reseller.id, p.id); toast.success('Payment removed'); onSaved() } catch (err) { toast.error(err.message) }
  }

  const attach = (
    <Field label="Attach proof" hint="The reseller's statement and the payment email (photo or PDF, up to 2.5 MB each)">
      <label className="flex cursor-pointer items-center gap-2 rounded-xl border-2 border-dashed border-line px-3 py-3 text-sm text-muted transition hover:border-plum-300 hover:text-accent">
        <Paperclip size={15} />{files.length ? files.map((f) => f.name).join(', ') : 'Choose files'}
        <input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" onChange={(e) => setFiles([...e.target.files])} />
      </label>
    </Field>
  )

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Owed now (sold, unpaid)" value={unpaid.reduce((s, p) => s + pieceMoney(p).netPayable, 0)} prefix={`${cur} `} tone="orange" icon={Wallet} sub={`${unpaid.length} piece${unpaid.length === 1 ? '' : 's'}`} />
        <StatCard label="Received in total" value={payments.reduce((s, p) => s + p.amount, 0)} prefix={`${cur} `} tone="green" icon={Banknote} sub={`${payments.length} payment${payments.length === 1 ? '' : 's'}`} />
        <StatCard label="Received in PKR" value={pkrTotal} prefix="PKR " icon={Banknote} sub={pkrTotal ? 'Credited to the Pakistan bank' : 'Add PKR to each payment'} />
        {canWrite && <div className="card flex items-center justify-center p-4"><button className="btn-primary" onClick={start} disabled={!unpaid.length}><Plus size={15} />Record a payment</button></div>}
      </div>

      {untracked.length > 0 && <p className="text-xs text-muted">{untracked.length} piece{untracked.length === 1 ? ' was' : 's were'} marked paid before payments were tracked ({cur} {f2(untracked.reduce((s, p) => s + pieceMoney(p).netPayable, 0))}), so {untracked.length === 1 ? 'it is not' : 'they are not'} listed below.</p>}
      {payments.length === 0 ? <EmptyState icon={Banknote} title="No payments recorded" hint={unpaid.length ? 'Record a payment when the reseller transfers money.' : 'Payments appear here once sold pieces are paid for.'} /> : (
        <div className="card overflow-hidden">
          <ul className="divide-y divide-line">
            {payments.map((p) => {
              const diff = Math.round((p.amount - p.expected) * 100) / 100
              return (
                <li key={p.id} className="flex flex-wrap items-start gap-4 px-5 py-4">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40"><Banknote size={18} /></div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="font-medium text-ink">
                      {p.period ? `${monthLabel(p.period)} sales` : 'Payment'} · {p.currency} {f2(p.amount)}
                      {p.amountPkr != null && <span className="text-muted"> · PKR {Number(p.amountPkr).toLocaleString()}{p.rate ? ` (1 ${p.currency} = ${p.rate} PKR)` : ''}</span>}
                    </p>
                    <p className="text-xs text-muted">Received {fmtDate(p.paidOn)} · {p.pieces} piece{p.pieces === 1 ? '' : 's'}{p.reference ? ` · ${p.reference}` : ''}{p.createdBy ? ` · by ${p.createdBy}` : ''}{p.notes ? ` · ${p.notes}` : ''}</p>
                    {p.pieces > 0 && Math.abs(diff) >= 1 && (
                      <p className="text-xs"><span className={`rounded-full px-2 py-0.5 font-semibold ${diff < 0 ? 'bg-rose-50 text-rose-700' : 'bg-sky-50 text-sky-700'}`}>{diff < 0 ? 'short' : 'over'} {p.currency} {f2(Math.abs(diff))}</span>{p.differenceReason && <span className="ml-2 text-muted">{p.differenceReason}</span>}</p>
                    )}
                    {p.files.length > 0 && <div className="flex flex-wrap gap-1.5 pt-1"><FileChips resellerId={reseller.id} payment={p} canWrite={canWrite} onChanged={onSaved} /></div>}
                  </div>
                  {canWrite && (
                    <div className="flex gap-1">
                      <button className="btn-icon" onClick={() => startEdit(p)} title="Edit payment, add PKR or files"><Pencil size={15} /></button>
                      <button className="btn-icon hover:text-rose-600" onClick={() => remove(p)} title="Remove payment"><Undo2 size={15} /></button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Record a payment" subtitle={`Money received from ${reseller.name}`} size="lg"
        footer={<><button className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button><button className="btn-primary" onClick={save} disabled={saving || !selected.size}>{saving ? 'Saving…' : `Mark ${selected.size} paid`}</button></>}>
        <div className="space-y-4 p-5">
          <div className="rounded-xl border border-line">
            <div className="flex items-center justify-between border-b border-line px-3 py-2 text-xs text-muted">
              <span>Pieces this payment covers · statement total {cur} {f2(expected)}</span>
              <button className="font-semibold text-accent" onClick={() => setSelected(selected.size === unpaid.length ? new Set() : new Set(unpaid.map((p) => p.id)))}>{selected.size === unpaid.length ? 'None' : 'All'}</button>
            </div>
            <ul className="max-h-56 divide-y divide-line overflow-y-auto">
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
          <PaymentFields form={form} set={set} currency={cur} expected={expected} />
          {attach}
        </div>
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit payment" subtitle={editing ? `${fmtDate(editing.paidOn)} · ${editing.pieces} piece${editing.pieces === 1 ? '' : 's'}` : ''} size="lg"
        footer={<><button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button><button className="btn-primary" onClick={saveEdit} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></>}>
        {editing && (
          <div className="space-y-4 p-5">
            <PaymentFields form={form} set={set} currency={cur} expected={editing.pieces ? editing.expected : null} />
            {editing.files.length > 0 && <div className="flex flex-wrap gap-1.5"><FileChips resellerId={reseller.id} payment={editing} canWrite={canWrite} onChanged={() => { setEditing(null); onSaved() }} /></div>}
            {attach}
          </div>
        )}
      </Modal>
    </div>
  )
}
