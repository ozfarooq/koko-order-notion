import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Edit2, Trash2, FileDown, User, Package, Tag,
  CreditCard, Calendar, RefreshCw, Save, X, Plus,
} from 'lucide-react'
import { getOrderById, deleteOrder, updateOrder, STATUS_OPTIONS } from '../data/storage'
import StatusBadge from '../components/StatusBadge'
import { generateOrderPDF } from '../utils/generatePDF'

const SIZE_OPTIONS = ['X-Small', 'Small', 'Medium', 'Large', 'X-Large']
const EMPTY_LINE   = () => ({ name: '', size: 'Small', qty: 1 })

const formatProductLines = (lines) =>
  lines.filter((l) => l.name.trim()).map((l) => `${l.name.trim()} (${l.size}) × ${l.qty}`).join('\n')

const parseProductLines = (str) => {
  if (!str) return [EMPTY_LINE()]
  const lines = str.split('\n').map((line) => {
    const m = line.match(/^(.+?)\s*\(([^)]+)\)\s*[×x]\s*(\d+)$/)
    if (m) return { name: m[1].trim(), size: m[2].trim(), qty: parseInt(m[3], 10) }
    return { name: line.trim(), size: 'Small', qty: 1 }
  }).filter((l) => l.name)
  return lines.length ? lines : [EMPTY_LINE()]
}

function InfoRow({ label, value }) {
  if (!value && value !== 0) return null
  return (
    <div className="flex gap-3 py-1.5">
      <span className="w-36 flex-shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</span>
      <span className="text-sm text-gray-800 whitespace-pre-wrap">{value}</span>
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

const fmt = (date) =>
  date ? new Date(date).toLocaleDateString('en-PK', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'

export default function OrderDetail() {
  const navigate  = useNavigate()
  const { id }    = useParams()
  const [order,      setOrder]      = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [showDelete, setShowDelete] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [editing,    setEditing]    = useState(false)
  const [form,       setForm]       = useState(null)
  const [saving,     setSaving]     = useState(false)

  const loadOrder = async () => {
    setLoading(true)
    try   { setOrder(await getOrderById(id)) }
    catch { navigate('/') }
    finally { setLoading(false) }
  }

  useEffect(() => { loadOrder() }, [id])

  if (loading) return (
    <div className="flex h-64 items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
    </div>
  )
  if (!order) return null

  // ── Edit helpers ───────────────────────────────────────────────────
  const startEdit = () => {
    setForm({
      customer:            order.customer || '',
      email:               order.email || '',
      phone:               order.phone || '',
      address:             order.address || '',
      productLines:        parseProductLines(order.product),
      status:              order.status || 'New',
      orderDate:           order.orderDate || '',
      deliveryDate:        order.deliveryDate || '',
      amount:              order.amount ?? '',
      advancePaid:         order.advancePaid ?? '',
      paymentNotes:        order.paymentNotes || '',
      specialInstructions: order.specialInstructions || '',
      measurements:        { additionalNotes: order.measurements?.additionalNotes || '' },
    })
    setEditing(true)
  }

  const cancelEdit = () => { setEditing(false); setForm(null) }

  const saveEdit = async () => {
    const filledLines = form.productLines.filter((l) => l.name.trim())
    if (!form.customer.trim() || !filledLines.length) return
    setSaving(true)
    const payload = {
      ...form,
      product:   formatProductLines(filledLines),
      size:      filledLines[0]?.size || '',
      quantity:  filledLines.reduce((sum, l) => sum + (parseInt(l.qty, 10) || 0), 0),
      balanceDue: (Number(form.amount) || 0) - (Number(form.advancePaid) || 0),
    }
    delete payload.productLines
    try {
      setOrder(await updateOrder(id, payload))
      setEditing(false)
      setForm(null)
    } catch (err) {
      alert(`Error saving: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const set     = (f) => (e) => setForm((p) => ({ ...p, [f]: e.target.value }))
  const setNotes = (e) => setForm((p) => ({ ...p, measurements: { additionalNotes: e.target.value } }))
  const setLine  = (idx, f) => (e) =>
    setForm((p) => ({ ...p, productLines: p.productLines.map((l, i) => i === idx ? { ...l, [f]: e.target.value } : l) }))
  const addLine    = () => setForm((p) => ({ ...p, productLines: [...p.productLines, EMPTY_LINE()] }))
  const removeLine = (idx) => setForm((p) => ({ ...p, productLines: p.productLines.filter((_, i) => i !== idx) }))

  const handleDelete = async () => {
    try { await deleteOrder(id); navigate('/') }
    catch (err) { alert(`Error deleting: ${err.message}`) }
  }

  const handlePDF = async () => {
    setGenerating(true)
    try { await generateOrderPDF(order) } finally { setGenerating(false) }
  }

  const balanceDue = form
    ? (Number(form.amount) || 0) - (Number(form.advancePaid) || 0)
    : Number(order.balanceDue || 0)

  const measurementNotes = order.measurements?.additionalNotes || ''

  return (
    <div className="p-6">
      {/* ── Header ── */}
      <div className="mb-6 flex items-start gap-4">
        <button
          className="mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50"
          onClick={() => navigate('/')}
        >
          <ArrowLeft size={16} />
        </button>

        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="font-mono text-2xl font-bold text-gray-900">{order.orderNumber}</h1>
            {editing ? (
              <select className="input w-44 text-sm" value={form.status} onChange={set('status')}>
                {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            ) : (
              <StatusBadge status={order.status} size="lg" />
            )}
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {editing ? form.customer || '—' : order.customer} &middot; Order Date: {fmt(order.orderDate)}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          {editing ? (
            <>
              <button className="btn-secondary" onClick={cancelEdit} disabled={saving}>
                <X size={15} /> Cancel
              </button>
              <button className="btn-primary" onClick={saveEdit} disabled={saving}>
                <Save size={15} /> {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </>
          ) : (
            <>
              <button className="btn-secondary" onClick={loadOrder}><RefreshCw size={14} /></button>
              <button className="btn-secondary" onClick={handlePDF} disabled={generating}>
                <FileDown size={15} /> {generating ? 'Generating...' : 'Download PDF'}
              </button>
              <button className="btn-secondary" onClick={startEdit}>
                <Edit2 size={15} /> Edit
              </button>
              {showDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-red-600 font-medium">Sure?</span>
                  <button className="btn-danger" onClick={handleDelete}>Yes, Delete</button>
                  <button className="btn-secondary" onClick={() => setShowDelete(false)}>No</button>
                </div>
              ) : (
                <button className="btn-secondary text-red-500 hover:text-red-600" onClick={() => setShowDelete(true)}>
                  <Trash2 size={15} />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="grid grid-cols-3 gap-5 max-w-5xl">
        {/* Left column */}
        <div className="col-span-2 space-y-5">

          {/* Customer */}
          <div className="card p-5">
            <div className="mb-3 flex items-center gap-2">
              <User size={14} className="text-brand-500" />
              <h2 className="section-title">Customer</h2>
            </div>
            {editing ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Name *">
                    <input className="input" value={form.customer} onChange={set('customer')} placeholder="Full name" />
                  </Field>
                  <Field label="Email">
                    <input type="email" className="input" value={form.email} onChange={set('email')} placeholder="email@example.com" />
                  </Field>
                  <Field label="Phone">
                    <input type="tel" className="input" value={form.phone} onChange={set('phone')} placeholder="+92300 0000000" />
                  </Field>
                </div>
                <Field label="Address">
                  <textarea className="input resize-none" rows={3} value={form.address} onChange={set('address')} placeholder="Full delivery address" />
                </Field>
              </div>
            ) : (
              <>
                <InfoRow label="Name"    value={order.customer} />
                <InfoRow label="Email"   value={order.email} />
                <InfoRow label="Phone"   value={order.phone} />
                <InfoRow label="Address" value={order.address} />
              </>
            )}
          </div>

          {/* Order Details */}
          <div className="card p-5">
            <div className="mb-3 flex items-center gap-2">
              <Package size={14} className="text-brand-500" />
              <h2 className="section-title">Order Details</h2>
            </div>
            {editing ? (
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Products *</span>
                    <button type="button" onClick={addLine} className="flex items-center gap-1 rounded-md border border-brand-300 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-100">
                      <Plus size={13} /> Add Product
                    </button>
                  </div>
                  <div className="space-y-2">
                    {form.productLines.map((line, idx) => (
                      <div key={idx} className="flex gap-2 items-center">
                        <input className="input flex-1" value={line.name} onChange={setLine(idx, 'name')} placeholder="Product name" />
                        <select className="input w-32" value={line.size} onChange={setLine(idx, 'size')}>
                          {SIZE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <input type="number" min="1" className="input w-20" value={line.qty} onChange={setLine(idx, 'qty')} />
                        {form.productLines.length > 1 && (
                          <button type="button" onClick={() => removeLine(idx)} className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-red-200 text-red-400 hover:bg-red-50">
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
              </div>
            ) : (
              <>
                <InfoRow label="Product"              value={order.product} />
                <InfoRow label="Size"                 value={order.size || '—'} />
                <InfoRow label="Quantity"             value={order.quantity != null ? order.quantity : '—'} />
                <InfoRow label="Order Date"           value={fmt(order.orderDate)} />
                <InfoRow label="Delivery Date"        value={fmt(order.deliveryDate)} />
                <InfoRow label="Special Instructions" value={order.specialInstructions} />
              </>
            )}
          </div>

          {/* Measurements — always show in edit mode */}
          {(editing || measurementNotes) && (
            <div className="card p-5">
              <div className="mb-3 flex items-center gap-2">
                <Tag size={14} className="text-brand-500" />
                <h2 className="section-title">Measurements</h2>
              </div>
              {editing ? (
                <textarea
                  className="input resize-y w-full"
                  rows={6}
                  value={form.measurements.additionalNotes}
                  onChange={setNotes}
                  placeholder="e.g. Bust: 36, Waist: 30, Length: 54..."
                />
              ) : (
                <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{measurementNotes}</p>
              )}
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-5">

          {/* Payment */}
          <div className="card p-5">
            <div className="mb-3 flex items-center gap-2">
              <CreditCard size={14} className="text-brand-500" />
              <h2 className="section-title">Payment</h2>
            </div>
            {editing ? (
              <div className="space-y-3">
                <Field label="Total Amount (PKR) *">
                  <input type="number" className="input" value={form.amount} onChange={set('amount')} placeholder="0" />
                </Field>
                <Field label="Advance Paid (PKR)">
                  <input type="number" className="input" value={form.advancePaid} onChange={set('advancePaid')} placeholder="0" />
                </Field>
                <div>
                  <label className="label">Balance Due</label>
                  <div className={`input cursor-default select-none font-semibold ${balanceDue > 0 ? 'text-orange-600 bg-orange-50' : 'text-green-600 bg-green-50'}`}>
                    PKR {balanceDue.toLocaleString()}
                  </div>
                </div>
                <Field label="Payment Notes">
                  <textarea className="input resize-none" rows={2} value={form.paymentNotes} onChange={set('paymentNotes')} placeholder="e.g. Upfront 25000/- Received..." />
                </Field>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Total Amount</span>
                  <span className="text-sm font-semibold text-gray-900">PKR {Number(order.amount || 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Advance Paid</span>
                  <span className="text-sm font-semibold text-green-600">PKR {Number(order.advancePaid || 0).toLocaleString()}</span>
                </div>
                <div className="h-px bg-gray-100" />
                <div className="flex justify-between">
                  <span className="text-sm font-semibold text-gray-700">Balance Due</span>
                  <span className={`text-sm font-bold ${Number(order.balanceDue) > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                    PKR {Number(order.balanceDue || 0).toLocaleString()}
                  </span>
                </div>
                {order.paymentNotes && (
                  <div className="mt-1 rounded-lg bg-amber-50 border border-amber-100 p-3">
                    <p className="text-xs text-amber-800">{order.paymentNotes}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Timeline */}
          <div className="card p-5">
            <div className="mb-3 flex items-center gap-2">
              <Calendar size={14} className="text-brand-500" />
              <h2 className="section-title">Timeline</h2>
            </div>
            {editing ? (
              <div className="space-y-3">
                <Field label="Order Date">
                  <input type="date" className="input" value={form.orderDate} onChange={set('orderDate')} />
                </Field>
                <Field label="Delivery Date">
                  <input type="date" className="input" value={form.deliveryDate} onChange={set('deliveryDate')} />
                </Field>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Order Placed</p>
                  <p className="text-sm font-medium text-gray-800">{fmt(order.orderDate)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Delivery Date</p>
                  <p className="text-sm font-medium text-gray-800">{fmt(order.deliveryDate)}</p>
                </div>
              </div>
            )}
          </div>

          {!editing && (
            <button className="btn-primary w-full justify-center py-3" onClick={handlePDF} disabled={generating}>
              <FileDown size={16} />
              {generating ? 'Generating PDF...' : 'Generate Customer PDF'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
