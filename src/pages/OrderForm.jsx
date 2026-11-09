import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import { ArrowLeft, Save, Plus, Trash2, Shirt, User, Ruler, CreditCard, Truck, StickyNote, RotateCcw, Minus } from 'lucide-react'
import { addOrder, updateOrder, getOrderById, getCustomer, STATUS_OPTIONS } from '../data/storage'
import { MEASUREMENT_FIELDS, SIZE_OPTIONS } from '../data/measurements'
import CustomerPicker from './orders/CustomerPicker'
import ProductPicker from './orders/ProductPicker'
import { Field, money, Skeleton } from '../ui/kit'
import { ease } from '../ui/motion'

const today = () => new Date().toISOString().slice(0, 10)
const REFERENCES = ['Walkin', 'Outstation', 'Website', 'Instagram', 'WhatsApp', 'Usman Ahmed']
let keySeq = 0
const lineKey = () => `l${++keySeq}`

const EMPTY = {
  customerId: null, customer: '', phone: '', email: '', address: '', city: '',
  items: [], status: 'New', orderDate: today(), deliveryDate: '', reference: '', shopifyOrderNumber: '',
  amount: '', amountManual: false, advancePaid: '', paymentNotes: '', specialInstructions: '',
  measurements: {},
}

function Section({ icon: Icon, title, hint, children, action }) {
  return (
    <motion.section layout className="card p-5">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-plum-50 text-plum-600 dark:bg-plum-900/40 dark:text-plum-300"><Icon size={16} /></div>
        <div className="flex-1"><h2 className="font-display text-xl font-semibold text-ink">{title}</h2>{hint && <p className="text-xs text-muted">{hint}</p>}</div>
        {action}
      </div>
      {children}
    </motion.section>
  )
}

export default function OrderForm() {
  const navigate = useNavigate()
  const { id } = useParams()
  const isEdit = Boolean(id)
  const [form, setForm] = useState(EMPTY)
  const [orderNumber, setOrderNumber] = useState('')
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})
  const [picking, setPicking] = useState(false)
  const { state } = useLocation()

  // "New order" from a customer profile starts with that customer filled in
  useEffect(() => {
    if (isEdit || !state?.customerId) return
    getCustomer(state.customerId).then((c) => setForm((f) => ({
      ...f, customerId: c.id, customer: c.name, phone: c.phone, email: c.email, address: c.address, city: c.city,
      measurements: c.latestMeasurements ? Object.fromEntries(Object.entries(c.latestMeasurements).filter(([k]) => !['orderId', 'orderNumber'].includes(k))) : f.measurements,
    }))).catch(() => {})
  }, [state?.customerId, isEdit])

  useEffect(() => {
    if (!isEdit) return
    getOrderById(id).then((o) => {
      const items = o.items.map((i) => ({
        key: lineKey(), productId: i.productId, product: i.product, imageUrl: i.imageUrl, collection: i.collection,
        size: i.size || '', quantity: i.quantity, unitPrice: i.unitPrice ?? '', note: i.note || '',
      }))
      const subtotal = items.reduce((s, i) => s + (Number(i.unitPrice) || 0) * i.quantity, 0)
      setOrderNumber(o.orderNumber)
      setForm({
        ...EMPTY,
        customerId: o.customerId, customer: o.customer, phone: o.phone, email: o.email, address: o.address, city: o.city,
        items, status: o.status, orderDate: o.orderDate || today(), deliveryDate: o.deliveryDate || '',
        reference: o.reference || '', shopifyOrderNumber: o.shopifyOrderNumber || '',
        amount: o.amount ?? '', amountManual: Number(o.amount) !== subtotal, advancePaid: o.advancePaid ?? '',
        paymentNotes: o.paymentNotes, specialInstructions: o.specialInstructions, measurements: o.measurements || {},
      })
    }).catch(() => { toast.error('Order not found'); navigate('/orders') })
      .finally(() => setLoading(false))
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const setLine = (key, patch) => setForm((f) => ({ ...f, items: f.items.map((l) => (l.key === key ? { ...l, ...patch } : l)) }))
  const removeLine = (key) => setForm((f) => ({ ...f, items: f.items.filter((l) => l.key !== key) }))
  const addProduct = (p) => {
    setPicking(false)
    setForm((f) => ({ ...f, items: [...f.items, { key: lineKey(), productId: p.id, product: p.name, imageUrl: p.imageUrl, collection: p.collection, size: 'Medium', quantity: 1, unitPrice: p.pricePkr ?? '' }] }))
    setErrors((e) => ({ ...e, items: undefined }))
  }
  const addCustomLine = () => setForm((f) => ({ ...f, items: [...f.items, { key: lineKey(), productId: null, product: '', size: 'Custom', quantity: 1, unitPrice: '' }] }))

  const subtotal = useMemo(() => form.items.reduce((s, l) => s + (Number(l.unitPrice) || 0) * (Number(l.quantity) || 0), 0), [form.items])
  const amount = form.amountManual ? Number(form.amount) || 0 : subtotal
  const balance = amount - (Number(form.advancePaid) || 0)

  const validate = () => {
    const e = {}
    if (!form.customer.trim()) e.customer = 'Choose or add a customer'
    if (!form.items.some((l) => l.productId || l.product.trim())) e.items = 'Add at least one product'
    if (!amount) e.amount = 'Enter the order amount'
    setErrors(e)
    if (Object.keys(e).length) toast.error(Object.values(e)[0])
    return !Object.keys(e).length
  }

  const handleSubmit = async (e) => {
    e?.preventDefault()
    if (!validate()) return
    setSaving(true)
    const payload = {
      customerId: form.customerId, customer: form.customer, phone: form.phone, email: form.email, address: form.address, city: form.city,
      items: form.items.filter((l) => l.productId || l.product.trim()).map((l) => ({
        productId: l.productId, product: l.product, size: l.size, quantity: Number(l.quantity) || 1,
        unitPrice: l.unitPrice === '' ? null : Number(l.unitPrice), note: l.note,
      })),
      status: form.status, orderDate: form.orderDate, deliveryDate: form.deliveryDate,
      reference: form.reference, shopifyOrderNumber: form.shopifyOrderNumber,
      amount, advancePaid: Number(form.advancePaid) || 0,
      paymentNotes: form.paymentNotes, specialInstructions: form.specialInstructions, measurements: form.measurements,
    }
    try {
      if (isEdit) {
        await updateOrder(id, payload)
        toast.success(`${orderNumber} updated`)
        navigate(`/orders/${id}`)
      } else {
        const created = await addOrder(payload)
        toast.success(`${created.orderNumber} created`)
        navigate(`/orders/${created.id}`)
      }
    } catch (err) {
      toast.error(`Couldn't save: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6 lg:p-8"><Skeleton className="h-12 w-64" /><Skeleton className="h-64" /><Skeleton className="h-64" /></div>

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-6xl space-y-6 p-4 pb-28 sm:p-6 lg:p-8 lg:pb-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button type="button" className="btn-icon border border-line bg-surface" onClick={() => navigate(-1)} aria-label="Back"><ArrowLeft size={16} /></button>
        <div className="flex-1">
          <p className="eyebrow">{isEdit ? 'Edit order' : 'New order'}</p>
          <h1 className="text-3xl text-ink">{isEdit ? orderNumber : 'Create an order'}</h1>
        </div>
        <button type="submit" className="btn-primary hidden lg:inline-flex" disabled={saving}><Save size={15} />{saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create order'}</button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Section icon={User} title="Customer" hint="Search existing customers so repeat clients keep one record">
            <CustomerPicker value={form} onChange={(c) => { setForm((f) => ({ ...f, ...c })); setErrors((e) => ({ ...e, customer: undefined })) }} error={errors.customer} />
            <AnimatePresence initial={false}>
              {(form.customerId || form.customer) && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25, ease }} className="overflow-hidden">
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <Field label="Name"><input className="input" value={form.customer} onChange={set('customer')} /></Field>
                    <Field label="Phone"><input className="input" type="tel" value={form.phone} onChange={set('phone')} placeholder="03xx xxxxxxx" /></Field>
                    <Field label="Email" className="sm:col-span-2"><input className="input" type="email" value={form.email} onChange={set('email')} /></Field>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </Section>

          <Section icon={Shirt} title="Items" hint="Prices come from Shopify; adjust per line if needed"
            action={<button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setPicking(true)}><Plus size={14} />Add product</button>}>
            {form.items.length === 0 ? (
              <button type="button" onClick={() => setPicking(true)}
                className={`flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-10 text-sm transition hover:border-plum-300 hover:text-accent ${errors.items ? 'border-rose-300 text-rose-600' : 'border-line text-muted'}`}>
                <Shirt size={24} />Choose products from the catalogue
              </button>
            ) : (
              <ul className="space-y-3">
                <AnimatePresence initial={false}>
                  {form.items.map((l) => (
                    <motion.li key={l.key} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.22, ease }}
                      className="flex flex-col gap-3 rounded-xl border border-line p-3 sm:flex-row sm:items-center">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <div className="h-16 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-subtle2">
                          {l.imageUrl ? <img src={l.imageUrl} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-faint"><Shirt size={18} /></div>}
                        </div>
                        <div className="min-w-0 flex-1">
                          {l.productId
                            ? <><p className="truncate font-medium text-ink">{l.product}</p><p className="truncate text-xs text-faint">{l.collection || 'Separates'}</p></>
                            : <input className="input" placeholder="Custom item description" value={l.product} onChange={(e) => setLine(l.key, { product: e.target.value })} />}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <select className="input w-28" value={l.size} onChange={(e) => setLine(l.key, { size: e.target.value })}>
                          {[...new Set([...SIZE_OPTIONS, l.size].filter(Boolean))].map((s) => <option key={s}>{s}</option>)}
                        </select>
                        <div className="flex items-center rounded-lg border border-line">
                          <button type="button" className="px-2 py-2 text-muted hover:text-ink" onClick={() => setLine(l.key, { quantity: Math.max(1, (Number(l.quantity) || 1) - 1) })} aria-label="Less"><Minus size={13} /></button>
                          <span className="w-6 text-center text-sm font-semibold text-ink">{l.quantity}</span>
                          <button type="button" className="px-2 py-2 text-muted hover:text-ink" onClick={() => setLine(l.key, { quantity: (Number(l.quantity) || 1) + 1 })} aria-label="More"><Plus size={13} /></button>
                        </div>
                        <div className="relative w-32">
                          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-faint">PKR</span>
                          <input type="number" min="0" className="input pl-10" value={l.unitPrice} onChange={(e) => setLine(l.key, { unitPrice: e.target.value })} placeholder="Price" />
                        </div>
                        <button type="button" className="btn-icon hover:text-rose-600" onClick={() => removeLine(l.key)} aria-label="Remove"><Trash2 size={15} /></button>
                      </div>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
            <div className="mt-3 flex items-center justify-between text-sm">
              <button type="button" className="text-xs font-semibold text-muted hover:text-accent" onClick={addCustomLine}>+ Custom item</button>
              {form.items.length > 0 && <p className="text-muted">Items total <span className="ml-2 font-semibold text-ink">{money(subtotal)}</span></p>}
            </div>
          </Section>

          <Section icon={Truck} title="Delivery">
            <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
              <Field label="Address"><textarea className="input" rows={2} value={form.address} onChange={set('address')} placeholder="House, street, area" /></Field>
              <Field label="City"><input className="input" value={form.city} onChange={set('city')} placeholder="Lahore" /></Field>
            </div>
          </Section>

          <Section icon={Ruler} title="Measurements" hint="Inches · leave blank what isn't needed">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {MEASUREMENT_FIELDS.map((m) => (
                <Field key={m.key} label={m.label}>
                  <input className="input" inputMode="decimal" value={form.measurements[m.key] || ''}
                    onChange={(e) => setForm((f) => ({ ...f, measurements: { ...f.measurements, [m.key]: e.target.value } }))} />
                </Field>
              ))}
            </div>
            <Field label="Measurement notes" className="mt-4">
              <textarea className="input" rows={2} value={form.measurements.additionalNotes || ''}
                onChange={(e) => setForm((f) => ({ ...f, measurements: { ...f.measurements, additionalNotes: e.target.value } }))} />
            </Field>
          </Section>

          <Section icon={StickyNote} title="Notes">
            <Field label="Special instructions"><textarea className="input" rows={3} value={form.specialInstructions} onChange={set('specialInstructions')} /></Field>
          </Section>
        </div>

        {/* Summary */}
        <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start">
          <section className="card space-y-4 p-5">
            <h2 className="section-title">Order</h2>
            <Field label="Status">
              <select className="input" value={form.status} onChange={set('status')}>{STATUS_OPTIONS.map((s) => <option key={s.value}>{s.value}</option>)}</select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Order date"><input type="date" className="input" value={form.orderDate} onChange={set('orderDate')} /></Field>
              <Field label="Delivery date"><input type="date" className="input" value={form.deliveryDate} onChange={set('deliveryDate')} /></Field>
            </div>
            <Field label="Reference" hint="How the sale came in">
              <input className="input" list="refs" value={form.reference} onChange={set('reference')} placeholder="Walkin, Outstation…" />
              <datalist id="refs">{REFERENCES.map((r) => <option key={r} value={r} />)}</datalist>
            </Field>
            <Field label="Shopify order no."><input className="input" value={form.shopifyOrderNumber} onChange={set('shopifyOrderNumber')} placeholder="#1171" /></Field>
          </section>

          <section className="card space-y-4 p-5">
            <div className="flex items-center gap-2"><CreditCard size={16} className="text-gold-500" /><h2 className="section-title">Payment</h2></div>
            <Field label="Order total" error={errors.amount}>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-faint">PKR</span>
                <input type="number" min="0" className="input pl-11 text-base font-semibold" value={form.amountManual ? form.amount : subtotal || ''}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value, amountManual: true }))} />
              </div>
              {form.amountManual && subtotal > 0 && Number(form.amount) !== subtotal && (
                <button type="button" className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-accent" onClick={() => setForm((f) => ({ ...f, amountManual: false }))}>
                  <RotateCcw size={11} /> Use items total ({money(subtotal)})
                </button>
              )}
            </Field>
            <Field label="Advance paid">
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-faint">PKR</span>
                <input type="number" min="0" className="input pl-11" value={form.advancePaid} onChange={set('advancePaid')} placeholder="0" />
              </div>
            </Field>
            <div className="flex items-center justify-between rounded-xl bg-subtle p-3">
              <span className="text-sm text-muted">Balance due</span>
              <motion.span key={balance} initial={{ scale: 0.95, opacity: 0.6 }} animate={{ scale: 1, opacity: 1 }}
                className={`font-display text-2xl font-semibold ${balance > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'}`}>{money(balance)}</motion.span>
            </div>
            <Field label="Payment notes"><textarea className="input" rows={2} value={form.paymentNotes} onChange={set('paymentNotes')} placeholder="e.g. advance via JazzCash" /></Field>
          </section>
        </aside>
      </div>

      {/* Phone save bar */}
      <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+56px)] z-30 border-t border-line bg-surface/95 p-3 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <div className="flex-1"><p className="text-[11px] text-muted">Total · balance</p><p className="text-sm font-semibold text-ink">{money(amount)} · <span className={balance > 0 ? 'text-rose-600' : 'text-emerald-700'}>{money(balance)}</span></p></div>
          <button type="submit" className="btn-primary" disabled={saving}><Save size={15} />{saving ? 'Saving…' : isEdit ? 'Save' : 'Create'}</button>
        </div>
      </div>

      <ProductPicker open={picking} onClose={() => setPicking(false)} onPick={addProduct} />
    </form>
  )
}
