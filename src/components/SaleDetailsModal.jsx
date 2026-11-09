import { useState, useEffect } from 'react'
import { X, Save } from 'lucide-react'
import { pieceMoney, FC_STATUS_OPTIONS } from '../data/storage'

const fmt = (n) => (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const toInput = (v) => (v == null || v === 0 ? '' : String(v))

function Field({ label, hint, children, wide }) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-gray-400">{hint}</p>}
    </div>
  )
}

function Line({ label, value, sign = '', strong, color = 'text-gray-700' }) {
  return (
    <div className={`flex justify-between py-1 text-sm ${strong ? 'border-t border-gray-200 pt-2 font-bold' : ''}`}>
      <span className={strong ? 'text-gray-900' : 'text-gray-500'}>{label}</span>
      <span className={color}>{sign}AED {fmt(value)}</span>
    </div>
  )
}

// Edit one consignment piece the way it appears on the reseller's sales statement.
export default function SaleDetailsModal({ piece, onClose, onSave }) {
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    setForm({
      status: piece.status,
      aedPrice: toInput(piece.aedPrice),
      designerDiscount: toInput(piece.designerDiscount),
      resellerDiscount: toInput(piece.resellerDiscount),
      alterationCharge: toInput(piece.alterationCharge),
      resellerInvoiceNo: piece.resellerInvoiceNo || '',
      resellerCode: piece.resellerCode || '',
      soldOn: piece.soldOn || '',
      paidOn: piece.paidOn || '',
      notes: piece.notes || '',
    })
    setError(null)
  }, [piece])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!form) return null

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const preview = { ...piece, ...form }
  const money = pieceMoney(preview, form.aedPrice)
  const gross = Number(form.aedPrice) || 0
  const discounts = (Number(form.designerDiscount) || 0) + (Number(form.resellerDiscount) || 0)
  const isSale = ['FC - Sold', 'FC - Paid'].includes(form.status)
  const invalid = discounts > gross ? 'Discounts cannot be more than the gross price' : null

  const applyPercent = (pct) =>
    setForm((f) => ({ ...f, designerDiscount: String(Math.round((Number(f.aedPrice) || 0) * pct) / 100) }))

  const handleSave = async () => {
    if (invalid) return
    setSaving(true)
    setError(null)
    try {
      await onSave({
        status: form.status,
        aedPrice: form.aedPrice === '' ? null : Number(form.aedPrice),
        designerDiscount: Number(form.designerDiscount) || 0,
        resellerDiscount: Number(form.resellerDiscount) || 0,
        alterationCharge: Number(form.alterationCharge) || 0,
        resellerInvoiceNo: form.resellerInvoiceNo,
        resellerCode: form.resellerCode,
        notes: form.notes,
        ...(isSale && form.soldOn ? { soldOn: form.soldOn } : {}),
        ...(form.status === 'FC - Paid' && form.paidOn ? { paidOn: form.paidOn } : {}),
      })
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div className="card w-full max-w-3xl max-h-[90vh] overflow-y-auto" onMouseDown={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-4 border-b border-gray-100 p-5">
          {piece.imageUrl && <img src={piece.imageUrl} alt="" className="h-14 w-14 rounded-lg object-cover bg-gray-100" />}
          <div className="flex-1">
            <h2 className="text-lg font-bold text-gray-900">{piece.product} <span className="font-normal text-gray-400">· {piece.size || '—'}</span></h2>
            <p className="text-xs text-gray-500">Sale details as on the {piece.reseller || 'reseller'} statement · handed over {piece.handoverDate}</p>
          </div>
          <button className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="grid gap-6 p-5 md:grid-cols-[1fr_260px]">
          {/* Fields */}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Status">
              <select className="input" value={form.status} onChange={set('status')}>
                {FC_STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="Sale date" hint={isSale ? 'Date on the statement' : 'Set when sold'}>
              <input type="date" className="input" value={form.soldOn} onChange={set('soldOn')} disabled={!isSale} />
            </Field>
            <Field label="Invoice no">
              <input className="input" value={form.resellerInvoiceNo} onChange={set('resellerInvoiceNo')} placeholder="Order 00843-003-0002" />
            </Field>
            <Field label="Reseller code" hint={`Applies to every ${piece.product} piece`}>
              <input className="input" value={form.resellerCode} onChange={set('resellerCode')} placeholder="KOATLR-010" />
            </Field>
            <Field label={`Gross price (${piece.currency || 'AED'})`}>
              <input type="number" min="0" className="input" value={form.aedPrice} onChange={set('aedPrice')} />
            </Field>
            <Field label="Designer discount" hint="Discount Koko offers">
              <div className="flex gap-2">
                <input type="number" min="0" className="input" value={form.designerDiscount} onChange={set('designerDiscount')} placeholder="0" />
                <button type="button" className="btn-secondary px-2 text-xs" onClick={() => applyPercent(10)} title="10% of gross">10%</button>
              </div>
            </Field>
            <Field label="Collage discount" hint="Discount the reseller offers">
              <input type="number" min="0" className="input" value={form.resellerDiscount} onChange={set('resellerDiscount')} placeholder="0" />
            </Field>
            <Field label="Alt / Laundry" hint="Deducted after commission">
              <input type="number" min="0" className="input" value={form.alterationCharge} onChange={set('alterationCharge')} placeholder="0" />
            </Field>
            {form.status === 'FC - Paid' && (
              <Field label="Payment date">
                <input type="date" className="input" value={form.paidOn} onChange={set('paidOn')} />
              </Field>
            )}
            <Field label="Notes" wide>
              <textarea className="input" rows={2} value={form.notes} onChange={set('notes')} />
            </Field>
          </div>

          {/* Statement breakdown */}
          <div className="h-fit rounded-xl bg-gray-50 p-4">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">Statement</h3>
            <Line label="Gross price" value={gross} />
            <Line label="Designer discount" value={form.designerDiscount} sign="− " color="text-rose-600" />
            <Line label="Collage discount" value={form.resellerDiscount} sign="− " color="text-rose-600" />
            <Line label="Net price" value={money.netPrice} strong />
            <Line label={`Commission (${piece.commissionPct}%)`} value={money.commission} sign="− " color="text-rose-600" />
            <Line label="Alt / Laundry" value={form.alterationCharge} sign="− " color="text-rose-600" />
            <Line label="Net payable" value={money.netPayable} strong color="text-emerald-700" />
          </div>
        </div>

        {(invalid || error) && (
          <div className="mx-5 mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{invalid || error}</div>
        )}

        <div className="flex justify-end gap-2 border-t border-gray-100 p-4">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving || !!invalid}>
            <Save size={14} />
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
