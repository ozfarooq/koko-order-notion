import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Save, User, Package, Ruler, CreditCard } from 'lucide-react'
import { addOrder, updateOrder, getOrderById, STATUS_OPTIONS } from '../data/storage'

const EMPTY_FORM = {
  customer: '',
  email: '',
  phone: '',
  address: '',
  place: '',
  product: '',
  orderDate: new Date().toISOString().split('T')[0],
  deliveryDate: '',
  amount: '',
  advancePaid: '',
  paymentNotes: '',
  specialInstructions: '',
  status: 'New',
  measurements: {
    bodyLength: '',
    shoulder: '',
    upperBust: '',
    bust: '',
    highWaist: '',
    armhole: '',
    muscle: '',
    wrist: '',
    sleevesLength: '',
    dressFullLength: '',
    lehangaWaist: '',
    lehangaLength: '',
    additionalNotes: '',
  },
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

function MeasurementField({ label, value, onChange, unit = '"' }) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="relative">
        <input
          type="number"
          step="0.25"
          value={value}
          onChange={onChange}
          placeholder="—"
          className="input pr-8"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
          {unit}
        </span>
      </div>
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
            measurements: { ...EMPTY_FORM.measurements, ...(order.measurements || {}) },
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
  const setMeasurement = (field) => (e) =>
    setForm((f) => ({ ...f, measurements: { ...f.measurements, [field]: e.target.value } }))

  const balanceDue = (Number(form.amount) || 0) - (Number(form.advancePaid) || 0)

  const validate = () => {
    const e = {}
    if (!form.customer.trim()) e.customer = 'Required'
    if (!form.product.trim()) e.product = 'Required'
    if (!form.amount) e.amount = 'Required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!validate()) return
    setSaving(true)
    const payload = { ...form, balanceDue }
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
    <div className="p-6">
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
            <Field label="City / Place">
              <input className="input" value={form.place} onChange={set('place')} placeholder="Karachi, Lahore..." />
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
          <Field label="Product Description *">
            <textarea
              className={`input resize-none ${errors.product ? 'border-red-400' : ''}`}
              rows={2}
              value={form.product}
              onChange={set('product')}
              placeholder="e.g. Gul Afshan - Small [Customized] - Without Embellishment"
            />
            {errors.product && <p className="mt-1 text-xs text-red-500">{errors.product}</p>}
          </Field>
          <Field label="Special Instructions">
            <textarea className="input resize-none" rows={2} value={form.specialInstructions} onChange={set('specialInstructions')} placeholder="Any special notes..." />
          </Field>
        </Section>

        {/* Measurements */}
        <Section icon={Ruler} title="Measurements">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <MeasurementField label="Body Length"       value={form.measurements.bodyLength}     onChange={setMeasurement('bodyLength')} />
            <MeasurementField label="Shoulder"          value={form.measurements.shoulder}       onChange={setMeasurement('shoulder')} />
            <MeasurementField label="Upper Bust"        value={form.measurements.upperBust}      onChange={setMeasurement('upperBust')}      unit="" />
            <MeasurementField label="Bust"              value={form.measurements.bust}           onChange={setMeasurement('bust')}           unit="" />
            <MeasurementField label="High Waist"        value={form.measurements.highWaist}      onChange={setMeasurement('highWaist')}      unit="" />
            <MeasurementField label="Armhole"           value={form.measurements.armhole}        onChange={setMeasurement('armhole')}        unit="" />
            <MeasurementField label="Muscle"            value={form.measurements.muscle}         onChange={setMeasurement('muscle')}         unit="" />
            <MeasurementField label="Wrist"             value={form.measurements.wrist}          onChange={setMeasurement('wrist')}          unit="" />
            <MeasurementField label="Sleeves Length"    value={form.measurements.sleevesLength}  onChange={setMeasurement('sleevesLength')}  unit="" />
            <MeasurementField label="Dress Full Length" value={form.measurements.dressFullLength}onChange={setMeasurement('dressFullLength')} unit="" />
            <MeasurementField label="Lehanga Waist"     value={form.measurements.lehangaWaist}   onChange={setMeasurement('lehangaWaist')}   unit="" />
            <MeasurementField label="Lehanga Length"    value={form.measurements.lehangaLength}  onChange={setMeasurement('lehangaLength')}  unit="" />
          </div>
          <Field label="Measurement Notes">
            <textarea className="input resize-none" rows={2} value={form.measurements.additionalNotes} onChange={setMeasurement('additionalNotes')} placeholder="e.g. Lehanga length: waist till floor (heel size included)" />
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
