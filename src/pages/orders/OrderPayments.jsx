import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Plus, AlertTriangle, Trash2, Paperclip, X } from 'lucide-react'
import { getOrderPayments, addOrderPayment, updateOrderPayment, deleteOrderPayment, uploadPaymentFile, removePaymentFile, openPaymentFile, PAYMENT_METHODS } from '../../data/storage'
import { Modal, Field, money, fmtDate } from '../../ui/kit'
import { useAuth } from '../../auth/AuthContext'
import { confirmDialog } from '../../ui/dialog'

const todayPk = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })

// Every payment on the order, one row each. The order's "advance paid" is their sum, so recording,
// correcting or refunding here keeps the order and the accounts in step.
export default function OrderPayments({ order, onChanged }) {
  const { can } = useAuth()
  const [data, setData] = useState(null)
  const [editing, setEditing] = useState(null)       // {} new, or a payment
  const load = useCallback(() => getOrderPayments(order.id).then(setData).catch((err) => setData({ payments: [], entries: [], loadError: err.message })), [order.id])
  useEffect(() => { load() }, [load, order.advancePaid, order.status])
  const write = can('orders:write')
  const finance = can('finance:read')
  if (!data) return null
  const toConfirm = data.payments.filter((p) => !p.methodConfirmed).length

  return (
    <div className="mt-3 space-y-2 border-t border-line pt-3 text-sm">
      <div className="flex items-center justify-between">
        <p className="font-label text-[10.5px] font-semibold uppercase tracking-wider text-muted">Payments</p>
        {write && <button className="text-xs font-semibold text-accent" onClick={() => setEditing({})}><Plus size={12} className="mr-0.5 inline" />Record</button>}
      </div>
      {data.loadError ? <p className="text-xs text-rose-600">Couldn't load the payments: {data.loadError}</p>
        : data.payments.length === 0 && <p className="text-xs text-faint">None recorded.</p>}
      {data.payments.map((p) => (
        <button key={p.id} type="button" disabled={!write} onClick={() => setEditing(p)}
          className="flex w-full items-baseline gap-2 rounded-lg px-1 py-0.5 text-left hover:bg-subtle/60 disabled:hover:bg-transparent">
          <span className="w-20 shrink-0 text-xs text-muted">{fmtDate(p.paidOn, { day: 'numeric', month: 'short', year: '2-digit' })}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-ink-soft">{PAYMENT_METHODS[p.method]}{p.reference && ` · ${p.reference}`}
            {!p.methodConfirmed && <span className="ml-1 text-amber-700 dark:text-amber-300">(check)</span>}
            {finance && p.entryNo && <Link to={`/finance/journals/${p.entryId}`} onClick={(e) => e.stopPropagation()} className="ml-1 font-mono text-[10px] text-accent">{p.entryNo}</Link>}</span>
          {p.files?.length > 0 && <span role="button" tabIndex={0} title={p.files.map((f) => f.name).join(', ')} className="text-faint hover:text-accent"
            onClick={(e) => { e.stopPropagation(); openPaymentFile(p.id, p.files[0].id).catch((err) => toast.error(err.message)) }}><Paperclip size={12} className="inline" />{p.files.length > 1 && <span className="text-[10px]">{p.files.length}</span>}</span>}
          <span className={`font-semibold tabular-nums ${Number(p.amount) < 0 ? 'text-rose-600' : 'text-ink'}`}>{money(p.amount)}</span>
        </button>
      ))}
      {toConfirm > 0 && write && <p className="text-[11px] text-amber-700 dark:text-amber-300">{toConfirm === 1 ? 'One payment was' : `${toConfirm} payments were`} recorded without saying how it was paid (bank assumed). Tap to confirm.</p>}
      {order.paidOn && <p className="text-[11px] text-faint">Paid in full on {fmtDate(order.paidOn)}{order.paidOnInferred ? ' (estimated from the order dates)' : ''}</p>}
      {finance && data.postingError && <p className="flex gap-1 text-[11px] text-rose-600"><AlertTriangle size={12} className="mt-0.5 shrink-0" />Not in the accounts yet: {data.postingError}</p>}
      {finance && data.entries.length > 0 && <p className="flex flex-wrap gap-1.5 text-[10px] text-faint">In the accounts: {data.entries.map((e) => <Link key={e.id} to={`/finance/journals/${e.id}`} className={`font-mono ${e.status === 'Reversed' ? 'line-through' : 'text-accent'}`}>{e.entryNo}</Link>)}</p>}
      {editing && <PaymentModal order={order} payment={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); onChanged?.() }} />}
    </div>
  )
}

function PaymentModal({ order, payment, onClose, onSaved }) {
  const [p, setP] = useState(() => payment
    ? { ...payment, refund: Number(payment.amount) < 0, amount: String(Math.abs(Number(payment.amount))) }
    : { paidOn: todayPk(), amount: order.balanceDue > 0 ? String(order.balanceDue) : '', method: 'bank', reference: '', notes: '', refund: false })
  const [busy, setBusy] = useState(false)
  const [files, setFiles] = useState(payment?.files || [])      // receipts already stored
  const [picked, setPicked] = useState([])                       // chosen, uploaded on save
  const set = (k) => (e) => setP({ ...p, [k]: e.target.value })
  const unlink = async (f) => {
    if (!await confirmDialog(`Remove ${f.name} from this payment?`)) return
    try { const list = await removePaymentFile(payment.id, f.id); setFiles(list.find((x) => x.id === payment.id)?.files || []) } catch (err) { toast.error(err.message) }
  }
  const save = async () => {
    setBusy(true)
    try {
      const body = { paidOn: p.paidOn, amount: `${p.refund ? '-' : ''}${String(p.amount).replace(/,/g, '')}`, method: p.method, reference: p.reference, notes: p.notes }
      let id = payment?.id
      if (payment) await updateOrderPayment(payment.id, body)
      else {
        const before = new Set(((await getOrderPayments(order.id)).payments || []).map((x) => x.id))
        const after = await addOrderPayment(order.id, body)
        id = (Array.isArray(after) ? after : after.payments || []).find((x) => !before.has(x.id))?.id
      }
      for (const f of picked) {
        try { await uploadPaymentFile(id, f) } catch (err) { toast.error(`${f.name}: ${err.message}`) }
      }
      toast.success(p.refund ? 'Refund recorded' : 'Payment recorded'); onSaved()
    } catch (err) { toast.error(err.message) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!await confirmDialog('Remove this payment? The order\'s advance goes down by its amount.')) return
    setBusy(true)
    try { await deleteOrderPayment(payment.id); toast.success('Removed'); onSaved() } catch (err) { toast.error(err.message) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} size="sm" title={payment ? 'Payment' : `Record a payment · ${order.orderNumber}`}
      footer={<>{payment && <button className="btn-secondary mr-auto text-rose-700" onClick={remove} disabled={busy}><Trash2 size={14} />Remove</button>}
        <button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label={p.refund ? 'Refund (Rs)' : 'Amount (Rs)'}><input inputMode="decimal" autoFocus className="input font-semibold" value={p.amount} onChange={set('amount')} /></Field>
        <Field label="Date"><input type="date" className="input" value={p.paidOn} onChange={set('paidOn')} /></Field>
        <Field label={p.refund ? 'Paid back from' : 'Paid into'} className="sm:col-span-2">
          <select className="input" value={p.method} onChange={set('method')}>{Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </Field>
        <Field label="Reference" hint="Bank reference, Trax tracking or receipt number" className="sm:col-span-2"><input className="input" value={p.reference} onChange={set('reference')} /></Field>
        <Field label="Notes" className="sm:col-span-2"><input className="input" value={p.notes} onChange={set('notes')} /></Field>
        <label className="flex items-center gap-2 text-sm text-ink sm:col-span-2"><input type="checkbox" checked={p.refund} onChange={(e) => setP({ ...p, refund: e.target.checked })} />This is a refund to the customer</label>
        <div className="space-y-1.5 sm:col-span-2">
          {files.map((f) => (
            <div key={f.id} className="flex items-center gap-2 text-sm">
              <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-accent hover:underline" onClick={() => openPaymentFile(payment.id, f.id).catch((err) => toast.error(err.message))}><Paperclip size={13} className="shrink-0" /><span className="truncate">{f.name}</span></button>
              <button type="button" className="text-faint hover:text-rose-600" onClick={() => unlink(f)} aria-label={`Remove ${f.name}`}><X size={13} /></button>
            </div>
          ))}
          <label className="flex w-full cursor-pointer items-center gap-2 rounded-xl border border-dashed border-line px-3 py-2.5 text-sm text-muted hover:text-accent">
            <Paperclip size={14} className="shrink-0" /><span className="truncate">{picked.length ? picked.map((f) => f.name).join(', ') : files.length ? 'Attach another receipt' : 'Attach the receipt or screenshot (photo or PDF)'}</span>
            <input type="file" multiple accept="image/*,application/pdf" className="sr-only" onChange={(e) => setPicked([...e.target.files])} />
          </label>
        </div>
      </div>
    </Modal>
  )
}
