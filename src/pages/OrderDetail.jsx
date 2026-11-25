import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  ArrowLeft, Pencil, Trash2, FileDown, Phone, Mail, MapPin, MessageCircle, Shirt, CreditCard, Ruler, Clock, Truck, StickyNote, User, Gift, Warehouse,
} from 'lucide-react'
import { getOrderById, getOrderHistory, deleteOrder, updateOrder, addStockPieces, STATUS_OPTIONS, STOCK_SIZES } from '../data/storage'
import { MEASUREMENT_FIELDS, hasMeasurements } from '../data/measurements'
import StatusBadge from '../components/StatusBadge'
import { Modal, Skeleton, money, fmtDate } from '../ui/kit'
import { listParent, listItem } from '../ui/motion'
import { useAuth } from '../auth/AuthContext'
import { FEATURES } from '../app/nav'
import OrderPayments from './orders/OrderPayments'
import { promptDialog } from '../ui/dialog'

const waLink = (phone) => {
  const d = (phone || '').replace(/\D/g, '')
  if (!d) return null
  return `https://wa.me/${d.startsWith('0') ? '92' + d.slice(1) : d}`
}
const fmtWhen = (d) => new Date(d).toLocaleString('en-PK', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })

// Turn an audit entry into a readable line
function describe(e) {
  if (e.action === 'order.create') return `Created ${e.changes.orderNumber || 'order'}`
  const c = e.changes || {}
  const keys = Object.keys(c)
  if (keys.length === 1 && c.status) return `Status → ${c.status}`
  const parts = []
  if (c.status) parts.push(`status → ${c.status}`)
  if (c.items || c.product) parts.push('items')
  if (c.amount !== undefined || c.advancePaid !== undefined) parts.push('payment')
  if (c.deliveryDate !== undefined || c.address !== undefined) parts.push('delivery')
  if (c.measurements) parts.push('measurements')
  return parts.length ? `Updated ${parts.join(', ')}` : 'Updated order'
}

function Card({ icon: Icon, title, children, action, className = '' }) {
  return (
    <motion.section variants={listItem} className={`card p-5 ${className}`}>
      <div className="mb-3 flex items-center gap-2">
        <Icon size={15} className="text-gold-500" />
        <h2 className="section-title flex-1">{title}</h2>{action}
      </div>
      {children}
    </motion.section>
  )
}

export default function OrderDetail() {
  const navigate = useNavigate()
  const { id } = useParams()
  const { can } = useAuth()
  const [order, setOrder] = useState(null)
  const [history, setHistory] = useState([])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(null)

  const load = useCallback(async () => {
    try {
      const [o, h] = await Promise.all([getOrderById(id), getOrderHistory(id).catch(() => [])])
      setOrder(o)
      setHistory(h)
    } catch { toast.error('Order not found'); navigate('/orders') }
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])

  const [restocking, setRestocking] = useState(false)
  // Trax tracking number (matches courier settlements to orders)
  const editTracking = async () => {
    const v = await promptDialog({ title: 'Trax tracking number', message: 'The number on the Trax airway bill for this parcel. It is shown on the order and links it to Trax settlements.', label: 'Tracking number', defaultValue: order.trackingNumber || '', placeholder: 'e.g. 22320263606690' })
    if (v === null) return
    try { setOrder(await updateOrder(id, { trackingNumber: v })); toast.success('Saved') } catch (err) { toast.error(err.message) }
  }

  const changeStatus = async (status) => {
    const prev = order.status
    setOrder((o) => ({ ...o, status }))
    try {
      const saved = await updateOrder(id, { status })
      setOrder(saved)
      setHistory(await getOrderHistory(id))
      toast.success(`Moved to ${status}`)
      // A returned outfit can go back into studio stock to be sold again
      if (status === 'Returned' && can('inventory:write') && restockable(saved).length) setRestocking(true)
    } catch (err) { setOrder((o) => ({ ...o, status: prev })); toast.error(err.message) }
  }

  const handlePDF = async () => {
    setBusy('pdf')
    try {
      const { generateOrderPDF } = await import('../utils/generatePDF')
      await generateOrderPDF(order)
      toast.success('PDF downloaded')
    } catch (err) { toast.error(`Couldn't create the PDF: ${err.message}`) }
    finally { setBusy(null) }
  }

  const handleDelete = async () => {
    setBusy('delete')
    try { await deleteOrder(id); toast.success(`${order.orderNumber} deleted`); navigate('/orders') }
    catch (err) { toast.error(`Couldn't delete: ${err.message}`); setBusy(null) }
  }

  if (!order) return <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6 lg:p-8"><Skeleton className="h-16 w-80" /><div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-64 lg:col-span-2" /><Skeleton className="h-64" /></div></div>

  const m = order.measurements || {}
  const subtotal = order.items.reduce((s, i) => s + (Number(i.unitPrice) || 0) * i.quantity, 0)
  const wa = waLink(order.phone)
  const paidPct = order.amount ? Math.min(100, Math.round(((order.advancePaid || 0) / order.amount) * 100)) : 0

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <button className="btn-icon w-fit border border-line bg-surface" onClick={() => navigate('/orders')} aria-label="Back"><ArrowLeft size={16} /></button>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="tabular-nums font-medium text-2xl font-bold tracking-tight text-ink sm:text-3xl">{order.orderNumber}</h1>
            <StatusBadge status={order.status} />
            {order.orderType === 'PR' && <span className="inline-flex items-center gap-1 rounded-full bg-pink-50 px-2 py-0.5 text-xs font-semibold text-pink-700 dark:bg-pink-950/40 dark:text-pink-300"><Gift size={12} />PR / gift</span>}
            {order.channel && order.channel !== 'Shopify' && <span className="rounded-full bg-subtle2 px-2 py-0.5 text-xs font-semibold text-muted">{order.channel}</span>}
            {order.shopifyOrderNumber && (order.shopifyAdminUrl
              ? <a href={order.shopifyAdminUrl} target="_blank" rel="noreferrer" className="rounded-full bg-subtle2 px-2 py-0.5 text-xs font-semibold text-muted hover:text-accent">Shopify {order.shopifyOrderNumber} ↗</a>
              : <span className="rounded-full bg-subtle2 px-2 py-0.5 text-xs font-semibold text-muted">Shopify {order.shopifyOrderNumber}</span>)}
          </div>
          <p className="mt-1 text-sm text-muted">
            {order.customer} · ordered {fmtDate(order.orderDate)}{order.reference && ` · ${order.reference}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can('orders:write') && (
            <select className="input w-auto py-2 text-sm font-semibold" value={order.status} onChange={(e) => changeStatus(e.target.value)} aria-label="Change status">
              {STATUS_OPTIONS.map((s) => <option key={s.value}>{s.value}</option>)}
            </select>
          )}
          <button className="btn-secondary" onClick={handlePDF} disabled={!!busy}><FileDown size={15} />{busy === 'pdf' ? 'Creating…' : 'PDF'}</button>
          {can('orders:write') && <Link to={`/orders/${id}/edit`} className="btn-primary"><Pencil size={15} />Edit</Link>}
          {can('orders:delete') && <button className="btn-icon border border-line bg-surface hover:text-rose-600" onClick={() => setConfirmDelete(true)} aria-label="Delete"><Trash2 size={15} /></button>}
        </div>
      </div>

      <motion.div variants={listParent} initial="hidden" animate="show" className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card icon={Shirt} title={`Items · ${order.quantity}`}>
            <ul className="divide-y divide-line">
              {order.items.map((i) => (
                <li key={i.id} className="flex items-center gap-4 py-3">
                  <div className="h-20 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-subtle2">
                    {i.imageUrl ? <img src={i.imageUrl} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-faint"><Shirt size={20} /></div>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-lg font-semibold text-ink">{i.product}</p>
                    <p className="text-xs text-muted">{[i.collection, i.size && `Size ${i.size}`, `Qty ${i.quantity}`].filter(Boolean).join(' · ')}</p>
                    {i.note && i.productId && <p className="mt-0.5 truncate text-[11px] text-faint">{i.note}</p>}
                    {(order.stockPieces || []).filter((s) => s.productId === i.productId && s.size === i.size).slice(0, 1).map((s) => (
                      <span key={s.id} className="mt-1 inline-flex items-center gap-1 rounded-full bg-gold-50 px-2 py-0.5 text-[11px] font-semibold text-gold-700 dark:bg-gold-700/20 dark:text-gold-200">
                        <Warehouse size={11} />From studio stock{s.kind === 'Sample' ? ' · shoot sample' : ''} · {s.status === 'At Studio' ? 'reserved' : s.status.toLowerCase()}
                      </span>
                    ))}
                  </div>
                  {i.unitPrice != null && <p className="text-sm font-semibold text-ink">{money(i.unitPrice * i.quantity)}</p>}
                </li>
              ))}
            </ul>
            {order.orderType !== 'PR' && subtotal > 0 && subtotal !== order.amount && <p className="mt-2 text-right text-xs text-muted">Items total {money(subtotal)} · order total {money(order.amount)}</p>}
          </Card>

          {(hasMeasurements(m)) && (
            <Card icon={Ruler} title="Measurements">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {MEASUREMENT_FIELDS.filter((f) => m[f.key]).map((f) => (
                  <div key={f.key} className="rounded-lg bg-subtle p-2.5"><p className="text-[10px] uppercase tracking-wider text-faint">{f.label}</p><p className="font-display text-[17px] font-semibold text-ink">{m[f.key]}″</p></div>
                ))}
              </div>
              {m.additionalNotes && <p className="mt-3 whitespace-pre-wrap text-sm text-ink-soft">{m.additionalNotes}</p>}
            </Card>
          )}

          {(order.specialInstructions || order.paymentNotes) && (
            <Card icon={StickyNote} title="Notes">
              {order.specialInstructions && <p className="whitespace-pre-wrap text-sm text-ink-soft">{order.specialInstructions}</p>}
              {order.paymentNotes && <p className="mt-2 rounded-lg bg-gold-50 p-2.5 text-sm text-gold-700 dark:bg-gold-700/15 dark:text-gold-200">Payment: {order.paymentNotes}</p>}
            </Card>
          )}

          <Card icon={Clock} title="Activity">
            <ol className="relative space-y-4 border-l border-line pl-5">
              {[...history].reverse().map((e, i) => (
                <li key={i} className="relative">
                  <span className={`absolute -left-[25px] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-surface ${i === 0 ? 'bg-gold-400' : 'bg-line-strong'}`} />
                  <p className="text-sm font-medium text-ink">{describe(e)}</p>
                  <p className="text-xs text-muted">{fmtWhen(e.at)}{e.user ? ` · ${e.user}` : ''}</p>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-5">
          <Card icon={User} title="Customer"
            action={FEATURES.customers && can('customers:read') ? <Link to={`/customers/${order.customerId}`} className="text-xs font-semibold text-accent">Profile</Link> : null}>
            <p className="font-display text-2xl font-semibold text-ink">{order.customer}</p>
            <div className="mt-3 space-y-2 text-sm">
              {order.phone && <a href={`tel:${order.phone}`} className="flex items-center gap-2 text-ink-soft hover:text-accent"><Phone size={14} className="text-faint" />{order.phone}</a>}
              {order.email && <a href={`mailto:${order.email}`} className="flex items-center gap-2 truncate text-ink-soft hover:text-accent"><Mail size={14} className="text-faint" />{order.email}</a>}
            </div>
            {wa && <a href={wa} target="_blank" rel="noreferrer" className="btn-secondary mt-4 w-full"><MessageCircle size={15} className="text-emerald-600" />WhatsApp</a>}
          </Card>

          {order.orderType === 'PR' ? (
          <Card icon={Gift} title="PR / gift">
            <div className="space-y-2 text-sm">
              {order.prHandle && <div className="flex justify-between"><span className="text-muted">For</span><span className="font-semibold text-ink">{order.prHandle}</span></div>}
              <div className="flex items-baseline justify-between">
                <span className="text-muted">Value given</span>
                <span className="font-display text-2xl font-semibold text-ink">{money(order.giftValue)}</span>
              </div>
              <p className="border-t border-line pt-2 text-xs text-faint">Sent free. Not counted as revenue.</p>
            </div>
          </Card>
          ) : (
          <Card icon={CreditCard} title="Payment">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted">Total</span><span className="font-semibold text-ink">{money(order.amount)}</span></div>
              <div className="flex justify-between"><span className="text-muted">Advance paid</span><span className="font-semibold text-emerald-700 dark:text-emerald-400">{money(order.advancePaid)}</span></div>
              <div className="h-1.5 overflow-hidden rounded-full bg-subtle2"><motion.div className="h-full rounded-full bg-emerald-500" initial={{ width: 0 }} animate={{ width: `${paidPct}%` }} transition={{ duration: 0.8 }} /></div>
              <div className="flex items-baseline justify-between border-t border-line pt-2">
                <span className="text-muted">Balance due</span>
                <span className={`font-display text-2xl font-semibold ${order.balanceDue > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'}`}>{money(order.balanceDue)}</span>
              </div>
            </div>
            <OrderPayments order={order} onChanged={load} />
          </Card>
          )}

          <Card icon={Truck} title="Delivery">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted">Due</span><span className="font-semibold text-ink">{fmtDate(order.deliveryDate)}</span></div>
              <div className="flex items-center justify-between gap-2"><span className="text-muted">Trax tracking</span>
                <span className="flex items-center gap-1.5">
                  <span className="font-mono text-xs text-ink">{order.trackingNumber || <span className="font-sans text-faint">—</span>}</span>
                  {can('orders:write') && <button className="text-xs font-semibold text-accent" onClick={editTracking}>{order.trackingNumber ? 'Change' : 'Add'}</button>}
                </span></div>
              {(order.address || order.city) && (
                <p className="flex gap-2 text-ink-soft"><MapPin size={14} className="mt-0.5 flex-shrink-0 text-faint" /><span className="whitespace-pre-wrap">{[order.address, order.city, order.country || 'Pakistan'].filter(Boolean).join('\n')}</span></p>
              )}
            </div>
          </Card>
        </div>
      </motion.div>

      <RestockModal open={restocking} order={order} onClose={() => setRestocking(false)} />

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title={`Delete ${order.orderNumber}?`} size="sm"
        footer={<><button className="btn-secondary" onClick={() => setConfirmDelete(false)}>Cancel</button><button className="btn-danger" onClick={handleDelete} disabled={busy === 'delete'}>{busy === 'delete' ? 'Deleting…' : 'Delete order'}</button></>}>
        <p className="p-5 text-sm text-ink-soft">This removes the order and its items for good. The customer record stays.</p>
      </Modal>
    </div>
  )
}

// Items of a returned order that can go back on the studio rail (studio pieces it was filled from are put back automatically)
const restockable = (order) => order.items.filter((i) => i.productId && STOCK_SIZES.includes(i.size)
  && !(order.stockPieces || []).some((s) => s.productId === i.productId && s.size === i.size))

function RestockModal({ open, order, onClose }) {
  const items = order ? restockable(order) : []
  const [picked, setPicked] = useState(new Set())
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (open) setPicked(new Set(items.map((i) => i.id))) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    setSaving(true)
    try {
      let n = 0
      for (const i of items.filter((x) => picked.has(x.id))) {
        const r = await addStockPieces({ productId: i.productId, sizes: { [i.size]: i.quantity }, status: 'At Studio', source: 'Customer return', notes: `Returned from ${order.orderNumber}` })
        n += r.created
      }
      toast.success(`${n} piece${n === 1 ? '' : 's'} back in studio stock`)
      onClose()
    } catch (err) { toast.error(err.message) } finally { setSaving(false) }
  }
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Back into studio stock?" subtitle={`${order?.orderNumber} was returned. Add the outfits to the studio so they can be sold again.`}
      footer={<><button className="btn-secondary" onClick={onClose}>Not now</button><button className="btn-primary" onClick={save} disabled={saving || !picked.size}><Warehouse size={15} />{saving ? 'Adding…' : 'Add to stock'}</button></>}>
      <ul className="space-y-2 p-5">
        {items.map((i) => (
          <li key={i.id}>
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-line p-2.5 transition hover:bg-subtle">
              <input type="checkbox" className="h-4 w-4 accent-[#7B2D45]" checked={picked.has(i.id)}
                onChange={() => setPicked((p) => { const n = new Set(p); n.has(i.id) ? n.delete(i.id) : n.add(i.id); return n })} />
              {i.imageUrl && <img src={i.imageUrl} alt="" className="h-12 w-9 rounded object-cover" />}
              <span className="text-sm text-ink">{i.product} <span className="text-muted">· {i.size}{i.quantity > 1 ? ` × ${i.quantity}` : ''}</span></span>
            </label>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
