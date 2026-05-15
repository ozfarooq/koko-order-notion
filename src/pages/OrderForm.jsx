import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Save, User, Package, Tag, CreditCard, Plus, Trash2 } from 'lucide-react'
import { addOrder, updateOrder, getOrderById, STATUS_OPTIONS } from '../data/storage'
import ProductInput from '../components/ProductInput'

const SIZE_OPTIONS = ['X-Small', 'Small', 'Medium', 'Large', 'X-Large']
const EMPTY_LINE   = () => ({ name: '', size: 'Small', qty: 1 })

// Serialize product lines to a human-readable string for Notion
const formatProductLines = (lines) =>
  lines.filter((l) => l.name.trim()).map((l) => `${l.name.trim()} (${l.size}) × ${l.qty}`).join('\n')

// Parse a product string back into line objects (for editing existing orders)
const parseProductLines = (str) => {
  if (!str) return [EMPTY_LINE()]
  const lines = str.split('\n').map((line) => {
    const m = line.match(/^(.+?)\s*\(([^)]+)\)\s*[×x]\s*(\d+)$/)
    if (m) return { name: m[1].trim(), size: m[2].trim(), qty: parseInt(m[3], 10) }
    return { name: line.trim(), size: 'Small', qty: 1 }
  }).filter((l) => l.name)
  return lines.length ? lines : [EMPTY_LINE()]
}

const EMPTY_FORM = {
  customer: '',
  email: '',
  phone: '',
  address: '',
  productLines: [EMPTY_LINE()],
  orderDate: new Date().toISOString().split('T')[0],
  deliveryDate: '',
  amount: '',
  advancePaid: '',
  paymentNotes: '',
  specialInstructions: '',
  status: 'New',
  measurements: { additionalNotes: '' },
}

function Section({ icon: Icon, title, children }) {
  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-50">
          <Icon size={14} className="text-brand-600" />
        </div>
        <h2 className="section-title">{title}</h2>
      </div>
      {children}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  )
}


export default function OrderForm() {
  const navigate = useNavigate()
  const { id } = useParams()
  const isEdit = Boolean(id)

  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(isEdit)
  const [errors, setErrors] = useState({})

  useEffect(() => {
    if (!isEdit || !id) return
    setLoading(true)
    getOrderById(id)
      .then((order) => {
        if (order) {
          setForm({
            ...EMPTY_FORM,
            ...order,
            productLines: parseProductLines(order.product),
            measurements: { additionalNotes: order.measurements?.additionalNotes || '' },
            orderDate: order.orderDate || new Date().toISOString().split('T')[0],
            deliveryDate: order.deliveryDate || '',
            amount: order.amount ?? '',
            advancePaid: order.advancePaid ?? '',
          })
        }
      })
      .catch(() => navigate('/'))
      .finally(() => setLoading(false))
  }, [id, isEdit])

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))
  const setMeasurementNotes = (e) =>
    setForm((f) => ({ ...f, measurements: { additionalNotes: e.target.value } }))

  const setLine = (idx, field) => (e) =>
    setForm((f) => {
      const lines = f.productLines.map((l, i) => i === idx ? { ...l, [field]: e.target.value } : l)
      return { ...f, productLines: lines }
    })

  const addLine = () =>
    setForm((f) => ({ ...f, productLines: [...f.productLines, EMPTY_LINE()] }))

  const removeLine = (idx) =>
    setForm((f) => ({ ...f, productLines: f.productLines.filter((_, i) => i !== idx) }))

  const balanceDue = (Number(form.amount) || 0) - (Number(form.advancePaid) || 0)

  const validate = () => {
    const e = {}
    if (!form.customer.trim()) e.customer = 'Required'
    if (!form.productLines.some((l) => l.name.trim())) e.productLines = 'Add at least one product'
    if (!form.amount) e.amount = 'Required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!validate()) return
    setSaving(true)
    const filledLines = form.productLines.filter((l) => l.name.trim())
    const payload = {
      ...form,
      product:  formatProductLines(filledLines),
      size:     filledLines[0]?.size || '',
      quantity: filledLines.reduce((sum, l) => sum + (parseInt(l.qty, 10) || 0), 0),
      balanceDue,
    }
    delete payload.productLines
    try {
      if (isEdit) {
        await updateOrder(id, payload)
        navigate(`/orders/${id}`)
      } else {
        const created = await addOrder(payload)
        navigate(`/orders/${created.id}`)
      }
    } catch (err) {
      alert(`Error saving order: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-6 flex items-center gap-4">
        <button
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft size={16} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {isEdit ? 'Edit Order' : 'New Order'}
          </h1>
          <p className="text-sm text-gray-500">
            {isEdit ? 'Update order details' : 'Saved directly to Notion'}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <button className="btn-secondary" onClick={() => navigate(-1)}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
            <Save size={15} />
            {saving ? 'Saving to Notion...' : 'Save Order'}
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5 max-w-4xl">
        {/* Customer */}
        <Section icon={User} title="Customer Information">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Customer Name *">
              <input className={`input ${errors.customer ? 'border-red-400' : ''}`} value={form.customer} onChange={set('customer')} placeholder="Full name" />
              {errors.customer && <p className="mt-1 text-xs text-red-500">{errors.customer}</p>}
            </Field>
            <Field label="Email">
              <input type="email" className="input" value={form.email} onChange={set('email')} placeholder="email@example.com" />
            </Field>
            <Field label="Phone">
              <input type="tel" className="input" value={form.phone} onChange={set('phone')} placeholder="+92300 0000000" />
            </Field>
          </div>
          <Field label="Address">
            <textarea className="input resize-none" rows={2} value={form.address} onChange={set('address')} placeholder="Full delivery address" />
          </Field>
        </Section>

        {/* Product */}
        <Section icon={Package} title="Order Details">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Order Date">
              <input type="date" className="input" value={form.orderDate} onChange={set('orderDate')} />
            </Field>
            <Field label="Delivery Date">
              <input type="date" className="input" value={form.deliveryDate} onChange={set('deliveryDate')} />
            </Field>
            <Field label="Status">
              <select className="input" value={form.status} onChange={set('status')}>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </Field>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Products *</span>
              <button
                type="button"
                onClick={addLine}
                className="flex items-center gap-1 rounded-md border border-brand-300 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-100"
              >
                <Plus size={13} /> Add Product
              </button>
            </div>
            {errors.productLines && <p className="mb-2 text-xs text-red-500">{errors.productLines}</p>}
            <div className="space-y-2">
              {form.productLines.map((line, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <ProductInput
                    value={line.name}
                    onChange={setLine(idx, 'name')}
                    placeholder="Search product..."
                  />
                  <select
                    className="input w-32"
                    value={line.size}
                    onChange={setLine(idx, 'size')}
                  >
                    {SIZE_OPTIONS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="1"
                    className="input w-20"
                    value={line.qty}
                    onChange={setLine(idx, 'qty')}
                    placeholder="Qty"
                  />
                  {form.productLines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeLine(idx)}
                      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-red-200 text-red-400 hover:bg-red-50"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
          <Field label="Special Instructions">
            <textarea className="input resize-none" rows={2} value={form.specialInstructions} onChange={set('specialInstructions')} placeholder="Any special notes..." />
          </Field>
        </Section>

        {/* Measurements */}
        <Section icon={Tag} title="Measurements">
          <Field label="Measurements">
            <textarea
              className="input resize-y"
              rows={5}
              value={form.measurements.additionalNotes}
              onChange={setMeasurementNotes}
              placeholder="e.g. Bust: 36, Waist: 30, Length: 54..."
            />
          </Field>
        </Section>

        {/* Payment */}
        <Section icon={CreditCard} title="Payment">
          <div className="grid grid-cols-3 gap-4">
            <Field label="Total Amount (PKR) *">
              <input type="number" className={`input ${errors.amount ? 'border-red-400' : ''}`} value={form.amount} onChange={set('amount')} placeholder="0" />
              {errors.amount && <p className="mt-1 text-xs text-red-500">{errors.amount}</p>}
            </Field>
            <Field label="Advance Paid (PKR)">
              <input type="number" className="input" value={form.advancePaid} onChange={set('advancePaid')} placeholder="0" />
            </Field>
            <Field label="Balance Due (PKR)">
              <div className={`input cursor-default select-none font-semibold ${balanceDue > 0 ? 'text-orange-600 bg-orange-50' : 'text-green-600 bg-green-50'}`}>
                {balanceDue.toLocaleString()}
              </div>
            </Field>
          </div>
          <Field label="Payment Notes">
            <textarea className="input resize-none" rows={2} value={form.paymentNotes} onChange={set('paymentNotes')} placeholder="e.g. Upfront 25000/- Received. Remaining during COD" />
          </Field>
        </Section>

        <div className="flex justify-end gap-3 pb-6">
          <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>
            <Save size={15} />
            {saving ? 'Saving to Notion...' : isEdit ? 'Update Order' : 'Create Order'}
          </button>
        </div>
      </form>
    </div>
  )
}
