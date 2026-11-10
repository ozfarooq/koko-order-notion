import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { ArrowLeft, Phone, Mail, MapPin, MessageCircle, Pencil, Merge, PlusCircle, ClipboardList, Ruler, Heart, Search, Wallet, TrendingUp, ShoppingBag } from 'lucide-react'
import { getCustomer, updateCustomer, mergeCustomer, searchCustomers } from '../../data/storage'
import { MEASUREMENT_FIELDS } from '../../data/measurements'
import StatusBadge from '../../components/StatusBadge'
import { Modal, Field, Skeleton, StatCard, money, fmtDate } from '../../ui/kit'
import { listParent, listItem } from '../../ui/motion'
import { useAuth } from '../../auth/AuthContext'
import { Avatar } from './Customers'

const waLink = (phone) => {
  const d = (phone || '').replace(/\D/g, '')
  return d ? `https://wa.me/${d.startsWith('0') ? '92' + d.slice(1) : d}` : null
}

function EditModal({ customer, open, onClose, onSaved }) {
  const [form, setForm] = useState(customer)
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (open) setForm(customer) }, [open, customer])
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const save = async () => {
    setSaving(true)
    try {
      onSaved(await updateCustomer(customer.id, { name: form.name, phone: form.phone, email: form.email, address: form.address, city: form.city }))
      toast.success('Customer saved')
      onClose()
    } catch (err) { toast.error(err.message) } finally { setSaving(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title="Edit customer" size="md"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={saving || !form.name?.trim()}>{saving ? 'Saving…' : 'Save'}</button></>}>
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2"><input className="input" value={form.name} onChange={set('name')} /></Field>
        <Field label="Phone"><input className="input" value={form.phone} onChange={set('phone')} /></Field>
        <Field label="Email"><input className="input" value={form.email} onChange={set('email')} /></Field>
        <Field label="Address" className="sm:col-span-2"><textarea className="input" rows={2} value={form.address} onChange={set('address')} /></Field>
        <Field label="City"><input className="input" value={form.city} onChange={set('city')} /></Field>
      </div>
    </Modal>
  )
}

// Merge a duplicate record INTO this customer
function MergeModal({ customer, open, onClose, onMerged }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [pick, setPick] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) { setQ(''); setPick(null); setResults([]) } }, [open])
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return }
    const t = setTimeout(() => searchCustomers(q).then((r) => setResults(r.filter((c) => c.id !== customer.id))).catch(() => {}), 200)
    return () => clearTimeout(t)
  }, [q, customer.id])
  const merge = async () => {
    setBusy(true)
    try {
      const r = await mergeCustomer(pick.id, customer.id)
      toast.success(`Merged ${r.merged} into ${r.into} · ${r.ordersMoved} order${r.ordersMoved === 1 ? '' : 's'} moved`)
      onMerged(r.customer)
      onClose()
    } catch (err) { toast.error(err.message) } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title="Merge a duplicate" subtitle={`Their orders move to ${customer.name}; the duplicate record is removed`} size="md"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={merge} disabled={!pick || busy}><Merge size={15} />{busy ? 'Merging…' : 'Merge'}</button></>}>
      <div className="space-y-3 p-5">
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input autoFocus className="input pl-9" placeholder="Find the duplicate by name or phone" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {results.map((c) => (
            <li key={c.id}>
              <button onClick={() => setPick(c)} className={`flex w-full items-center gap-3 rounded-lg border p-2.5 text-left transition ${pick?.id === c.id ? 'border-plum-400 bg-plum-50 dark:bg-plum-900/30' : 'border-transparent hover:bg-subtle'}`}>
                <Avatar name={c.name} />
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-ink">{c.name}</p><p className="truncate text-xs text-muted">{[c.phone, c.city].filter(Boolean).join(' · ')}</p></div>
                <span className="text-xs text-faint">{c.orderCount} order{c.orderCount === 1 ? '' : 's'}</span>
              </button>
            </li>
          ))}
        </ul>
        {pick && <p className="rounded-lg bg-gold-50 p-3 text-xs text-gold-700 dark:bg-gold-700/15 dark:text-gold-200">{pick.name}'s {pick.orderCount} order{pick.orderCount === 1 ? '' : 's'} will move to {customer.name}. Missing phone, email or address are copied over. This can't be undone.</p>}
      </div>
    </Modal>
  )
}

export default function CustomerProfile() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { can } = useAuth()
  const [c, setC] = useState(null)
  const [editing, setEditing] = useState(false)
  const [merging, setMerging] = useState(false)

  const load = useCallback(() => getCustomer(id).then(setC).catch(() => { toast.error('Customer not found'); navigate('/customers') }), [id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setC(null); load() }, [load])

  if (!c) return <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6 lg:p-8"><Skeleton className="h-20 w-96" /><Skeleton className="h-28" /><Skeleton className="h-72" /></div>

  const wa = waLink(c.phone)
  const m = c.latestMeasurements
  const mFields = m ? MEASUREMENT_FIELDS.filter((f) => m[f.key]) : []
  const avg = c.orderCount ? c.totalSpend / Math.max(1, c.orders.filter((o) => !['Cancelled', 'Returned'].includes(o.status)).length) : 0

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <button className="btn-icon w-fit border border-line bg-surface" onClick={() => navigate('/customers')} aria-label="Back"><ArrowLeft size={16} /></button>
        <Avatar name={c.name} size="lg" />
        <div className="flex-1">
          <p className="eyebrow">Customer{c.references.length ? ` · ${c.references.join(', ')}` : ''}</p>
          <h1 className="text-2xl text-ink sm:text-[1.9rem]">{c.name}</h1>
          <p className="text-sm text-muted">Customer since {fmtDate(c.firstOrder || c.createdAt, { month: 'long', year: 'numeric' })}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {wa && <a href={wa} target="_blank" rel="noreferrer" className="btn-secondary"><MessageCircle size={15} className="text-emerald-600" />WhatsApp</a>}
          {can('customers:write') && <button className="btn-secondary" onClick={() => setEditing(true)}><Pencil size={15} />Edit</button>}
          {can('customers:merge') && <button className="btn-secondary" onClick={() => setMerging(true)}><Merge size={15} />Merge</button>}
          {can('orders:write') && <button className="btn-primary" onClick={() => navigate('/orders/new', { state: { customerId: c.id } })}><PlusCircle size={15} />New order</button>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Orders" value={c.orderCount} icon={ShoppingBag} sub={c.lastOrder ? `last ${fmtDate(c.lastOrder)}` : undefined} />
        <StatCard label="Total spend" value={c.totalSpend} prefix="PKR " tone="gold" icon={TrendingUp} />
        <StatCard label="Average order" value={avg} prefix="PKR " icon={ClipboardList} />
        <StatCard label="Balance owed" value={c.balance} prefix="PKR " tone={c.balance > 0 ? 'red' : 'green'} icon={Wallet} />
      </div>

      <motion.div variants={listParent} initial="hidden" animate="show" className="grid gap-5 lg:grid-cols-3">
        <motion.section variants={listItem} className="card overflow-hidden lg:col-span-2">
          <div className="border-b border-line px-5 py-3"><h2 className="section-title">Orders</h2></div>
          {c.orders.length === 0 ? <p className="p-5 text-sm text-muted">No orders yet.</p> : (
            <ul className="divide-y divide-line">
              {c.orders.map((o) => (
                <li key={o.id}>
                  <Link to={`/orders/${o.id}`} className="flex items-center gap-4 px-5 py-3 transition hover:bg-subtle/60">
                    <div className="h-14 w-11 flex-shrink-0 overflow-hidden rounded-md bg-subtle2">{o.items[0]?.imageUrl && <img src={o.items[0].imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />}</div>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm"><span className="tabular-nums font-medium font-semibold text-accent">{o.orderNumber}</span><span className="text-faint">{fmtDate(o.orderDate)}</span></p>
                      <p className="truncate text-sm text-ink-soft">{o.items.map((i) => i.product).join(', ')}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-ink">{money(o.amount)}</p>
                      {o.balanceDue > 0 ? <p className="text-[11px] font-semibold text-rose-600">due {money(o.balanceDue)}</p> : <StatusBadge status={o.status} />}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </motion.section>

        <div className="space-y-5">
          <motion.section variants={listItem} className="card space-y-2 p-5 text-sm">
            <h2 className="section-title mb-2">Contact</h2>
            {c.phone ? <a href={`tel:${c.phone}`} className="flex items-center gap-2 text-ink-soft hover:text-accent"><Phone size={14} className="text-faint" />{c.phone}</a> : <p className="text-faint">No phone</p>}
            {c.email && <a href={`mailto:${c.email}`} className="flex items-center gap-2 truncate text-ink-soft hover:text-accent"><Mail size={14} className="text-faint" />{c.email}</a>}
            {(c.address || c.city) && <p className="flex gap-2 text-ink-soft"><MapPin size={14} className="mt-0.5 flex-shrink-0 text-faint" /><span className="whitespace-pre-wrap">{[c.address, c.city].filter(Boolean).join('\n')}</span></p>}
          </motion.section>

          {c.favourites.length > 0 && (
            <motion.section variants={listItem} className="card p-5">
              <h2 className="section-title mb-3 flex items-center gap-2"><Heart size={13} />Favourites</h2>
              <ul className="space-y-2">
                {c.favourites.map((f) => (
                  <li key={f.product} className="flex items-center gap-3">
                    {f.imageUrl && <img src={f.imageUrl} alt="" className="h-9 w-9 rounded-md object-cover" loading="lazy" />}
                    <p className="flex-1 truncate text-sm text-ink">{f.product}</p>
                    <span className="text-xs text-faint">{f.quantity}× {f.sizes.join(', ')}</span>
                  </li>
                ))}
              </ul>
            </motion.section>
          )}

          <motion.section variants={listItem} className="card p-5">
            <h2 className="section-title mb-3 flex items-center gap-2"><Ruler size={13} />Latest measurements</h2>
            {!m ? <p className="text-sm text-muted">None recorded yet.</p> : (
              <>
                {mFields.length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    {mFields.map((f) => <div key={f.key} className="rounded-lg bg-subtle p-2"><p className="text-[10px] uppercase tracking-wider text-faint">{f.label}</p><p className="font-display text-lg font-semibold text-ink">{m[f.key]}″</p></div>)}
                  </div>
                )}
                {m.additionalNotes && <p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">{m.additionalNotes}</p>}
                <Link to={`/orders/${m.orderId}`} className="mt-2 inline-block text-xs font-semibold text-accent">From {m.orderNumber}</Link>
              </>
            )}
          </motion.section>
        </div>
      </motion.div>

      <EditModal customer={c} open={editing} onClose={() => setEditing(false)} onSaved={setC} />
      <MergeModal customer={c} open={merging} onClose={() => setMerging(false)} onMerged={setC} />
    </div>
  )
}
