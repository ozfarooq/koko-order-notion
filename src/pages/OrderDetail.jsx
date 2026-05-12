import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Edit2, Trash2, FileDown, User, Package, Ruler,
  CreditCard, Calendar, RefreshCw,
} from 'lucide-react'
import { getOrderById, deleteOrder, updateOrder, STATUS_OPTIONS } from '../data/storage'
import StatusBadge from '../components/StatusBadge'
import { generateOrderPDF } from '../utils/generatePDF'

function InfoRow({ label, value }) {
  if (!value && value !== 0) return null
  return (
    <div className="flex gap-3 py-1.5">
      <span className="w-36 flex-shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</span>
      <span className="text-sm text-gray-800 whitespace-pre-wrap">{value}</span>
    </div>
  )
}

function MeasurementPill({ label, value, unit = '' }) {
  if (!value) return null
  return (
    <div className="flex flex-col rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-center">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</span>
      <span className="mt-0.5 text-sm font-bold text-gray-800">{value}{unit}</span>
    </div>
  )
}

export default function OrderDetail() {
  const navigate = useNavigate()
  const { id } = useParams()
  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showDelete, setShowDelete] = useState(false)
  const [changingStatus, setChangingStatus] = useState(false)
  const [generating, setGenerating] = useState(false)

  const loadOrder = async () => {
    setLoading(true)
    try {
      const o = await getOrderById(id)
      setOrder(o)
    } catch {
      navigate('/')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadOrder() }, [id])

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
      </div>
    )
  }

  if (!order) return null

  const m = order.measurements || {}
  const hasMeasurements = Object.values(m).some((v) => v && v !== '')

  const handleDelete = async () => {
    try {
      await deleteOrder(id)
      navigate('/')
    } catch (err) {
      alert(`Error deleting: ${err.message}`)
    }
  }

  const handleStatusChange = async (e) => {
    setChangingStatus(false)
    try {
      const updated = await updateOrder(id, { status: e.target.value })
      setOrder(updated)
    } catch (err) {
      alert(`Error updating status: ${err.message}`)
    }
  }

  const handleGeneratePDF = async () => {
    setGenerating(true)
    try { await generateOrderPDF(order) }
    finally { setGenerating(false) }
  }

  const fmt = (date) =>
    date
      ? new Date(date).toLocaleDateString('en-PK', { day: 'numeric', month: 'long', year: 'numeric' })
      : '—'

  return (
    <div className="p-6">
      {/* Header */}
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
            {changingStatus ? (
              <select className="input w-44 text-sm" value={order.status} onChange={handleStatusChange} onBlur={() => setChangingStatus(false)} autoFocus>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            ) : (
              <button onClick={() => setChangingStatus(true)} title="Click to change status">
                <StatusBadge status={order.status} size="lg" />
              </button>
            )}
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {order.customer} &middot; Order Date: {fmt(order.orderDate)}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          <button className="btn-secondary" onClick={loadOrder}>
            <RefreshCw size={14} />
          </button>
          <button className="btn-secondary" onClick={handleGeneratePDF} disabled={generating}>
            <FileDown size={15} />
            {generating ? 'Generating...' : 'Download PDF'}
          </button>
          <button className="btn-secondary" onClick={() => navigate(`/orders/${id}/edit`)}>
            <Edit2 size={15} />
            Edit
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
        </div>
      </div>

      <div className="grid grid-cols-3 gap-5 max-w-5xl">
        {/* Left column */}
        <div className="col-span-2 space-y-5">
          <div className="card p-5">
            <div className="mb-3 flex items-center gap-2">
              <User size={14} className="text-brand-500" />
              <h2 className="section-title">Customer</h2>
            </div>
            <InfoRow label="Name"    value={order.customer} />
            <InfoRow label="Email"   value={order.email} />
            <InfoRow label="Phone"   value={order.phone} />
            <InfoRow label="Place"   value={order.place} />
            <InfoRow label="Address" value={order.address} />
          </div>

          <div className="card p-5">
            <div className="mb-3 flex items-center gap-2">
              <Package size={14} className="text-brand-500" />
              <h2 className="section-title">Order Details</h2>
            </div>
            <InfoRow label="Product"              value={order.product} />
            <InfoRow label="Order Date"           value={fmt(order.orderDate)} />
            <InfoRow label="Delivery Date"        value={fmt(order.deliveryDate)} />
            <InfoRow label="Special Instructions" value={order.specialInstructions} />
          </div>

          {hasMeasurements && (
            <div className="card p-5">
              <div className="mb-3 flex items-center gap-2">
                <Ruler size={14} className="text-brand-500" />
                <h2 className="section-title">Measurements</h2>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                <MeasurementPill label="Body Length"      value={m.bodyLength}      unit={m.bodyLength ? '"' : ''} />
                <MeasurementPill label="Shoulder"         value={m.shoulder}        unit={m.shoulder ? '"' : ''} />
                <MeasurementPill label="Upper Bust"       value={m.upperBust} />
                <MeasurementPill label="Bust"             value={m.bust} />
                <MeasurementPill label="High Waist"       value={m.highWaist} />
                <MeasurementPill label="Armhole"          value={m.armhole} />
                <MeasurementPill label="Muscle"           value={m.muscle} />
                <MeasurementPill label="Wrist"            value={m.wrist} />
                <MeasurementPill label="Sleeves Length"   value={m.sleevesLength} />
                <MeasurementPill label="Dress Full Length"value={m.dressFullLength} />
                <MeasurementPill label="Lehanga Waist"    value={m.lehangaWaist} />
                <MeasurementPill label="Lehanga Length"   value={m.lehangaLength} />
              </div>
              {m.additionalNotes && (
                <p className="mt-3 text-sm text-gray-600 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap">{m.additionalNotes}</p>
              )}
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-5">
          <div className="card p-5">
            <div className="mb-3 flex items-center gap-2">
              <CreditCard size={14} className="text-brand-500" />
              <h2 className="section-title">Payment</h2>
            </div>
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
            </div>
            {order.paymentNotes && (
              <div className="mt-3 rounded-lg bg-amber-50 border border-amber-100 p-3">
                <p className="text-xs text-amber-800">{order.paymentNotes}</p>
              </div>
            )}
          </div>

          <div className="card p-5">
            <div className="mb-3 flex items-center gap-2">
              <Calendar size={14} className="text-brand-500" />
              <h2 className="section-title">Timeline</h2>
            </div>
            <div className="space-y-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Order Placed</p>
                <p className="text-sm font-medium text-gray-800">{fmt(order.orderDate)}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Delivery Date</p>
                <p className="text-sm font-medium text-gray-800">{fmt(order.deliveryDate)}</p>
              </div>
            </div>
          </div>

          <button className="btn-primary w-full justify-center py-3" onClick={handleGeneratePDF} disabled={generating}>
            <FileDown size={16} />
            {generating ? 'Generating PDF...' : 'Generate Customer PDF'}
          </button>
        </div>
      </div>
    </div>
  )
}
