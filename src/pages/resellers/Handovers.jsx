import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import { Truck, Plus, ChevronDown, Trash2, Minus, Shirt, PackagePlus } from 'lucide-react'
import { getConsignments, addConsignment, refreshResellers } from '../../data/storage'
import { useAuth } from '../../auth/AuthContext'
import { PageHeader, Modal, Field, SkeletonRows, EmptyState, ErrorBanner, fmtDate } from '../../ui/kit'
import { ease } from '../../ui/motion'
import { SIZE_OPTIONS } from '../../data/measurements'
import ProductPicker from '../orders/ProductPicker'
import { StatusPill } from './ResellerStock'

const fmt = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })
let seq = 0

function HandoverForm({ open, onClose, reseller, lastPrice, onSaved }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState([])
  const [picking, setPicking] = useState(false)
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (open) { setLines([]); setNotes(''); setDate(new Date().toISOString().slice(0, 10)) } }, [open])

  const add = (p) => {
    setPicking(false)
    setLines((l) => [...l, { key: ++seq, productId: p.id, product: p.name, imageUrl: p.imageUrl, size: 'Medium', quantity: 1, price: lastPrice(p.id) ?? '' }])
  }
  const set = (key, patch) => setLines((l) => l.map((x) => (x.key === key ? { ...x, ...patch } : x)))
  const pieces = lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0)
  const value = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.price) || 0), 0)

  const save = async () => {
    if (!lines.length) return toast.error('Add at least one piece')
    if (lines.some((l) => l.price === '' || Number(l.price) <= 0)) return toast.error(`Set the ${reseller.currency} price for every line`)
    setSaving(true)
    try {
      const r = await addConsignment({ resellerId: reseller.id, handoverDate: date, notes, items: lines.map((l) => ({ productId: l.productId, size: l.size, quantity: Number(l.quantity), price: Number(l.price) })) })
      toast.success(`Handover recorded · ${r.pieces} pieces`)
      refreshResellers()
      onSaved()
      onClose()
    } catch (err) { toast.error(err.message) } finally { setSaving(false) }
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title="Record a handover" subtitle={`Stock going to ${reseller?.name} · prices in ${reseller?.currency} · ${reseller?.commissionPct}% commission locked in`} size="lg"
        footer={<>
          <p className="mr-auto self-center text-sm text-muted">{pieces} piece{pieces === 1 ? '' : 's'} · {reseller?.currency} {fmt(value)}</p>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving || !lines.length}><PackagePlus size={15} />{saving ? 'Saving…' : 'Record handover'}</button>
        </>}>
        <div className="space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
            <Field label="Handover date"><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Notes"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Eid batch, sent with courier" /></Field>
          </div>
          <ul className="space-y-2">
            <AnimatePresence initial={false}>
              {lines.map((l) => (
                <motion.li key={l.key} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.2, ease }}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-2.5">
                  <div className="h-12 w-9 overflow-hidden rounded bg-subtle2">{l.imageUrl && <img src={l.imageUrl} alt="" className="h-full w-full object-cover" />}</div>
                  <p className="min-w-[120px] flex-1 truncate font-medium text-ink">{l.product}</p>
                  <select className="input w-28" value={l.size} onChange={(e) => set(l.key, { size: e.target.value })}>{SIZE_OPTIONS.map((s) => <option key={s}>{s}</option>)}</select>
                  <div className="flex items-center rounded-lg border border-line">
                    <button className="px-2 py-2 text-muted" onClick={() => set(l.key, { quantity: Math.max(1, l.quantity - 1) })} aria-label="Less"><Minus size={13} /></button>
                    <span className="w-6 text-center text-sm font-semibold">{l.quantity}</span>
                    <button className="px-2 py-2 text-muted" onClick={() => set(l.key, { quantity: l.quantity + 1 })} aria-label="More"><Plus size={13} /></button>
                  </div>
                  <div className="relative w-28">
                    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-faint">{reseller?.currency}</span>
                    <input type="number" min="0" className="input pl-10" value={l.price} onChange={(e) => set(l.key, { price: e.target.value })} placeholder="Price" />
                  </div>
                  <button className="btn-icon hover:text-rose-600" onClick={() => setLines((x) => x.filter((y) => y.key !== l.key))} aria-label="Remove"><Trash2 size={15} /></button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
          <button className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line py-4 text-sm text-muted transition hover:border-plum-300 hover:text-accent" onClick={() => setPicking(true)}>
            <Shirt size={18} />Add a product
          </button>
          <p className="text-xs text-faint">Each unit becomes its own piece, so it can sell or come back on its own. Add the same product again for a second size.</p>
        </div>
      </Modal>
      <ProductPicker open={picking} onClose={() => setPicking(false)} onPick={add} />
    </>
  )
}

export default function Handovers() {
  const { resellerId } = useParams()
  const { can } = useAuth()
  const showMoney = can('fc:money')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [open, setOpen] = useState(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(() => getConsignments(resellerId).then((d) => { setData(d); setError(null) }).catch((e) => setError(e.message)), [resellerId])
  useEffect(() => { setData(null); load() }, [load])

  const reseller = data?.resellers.find((r) => String(r.id) === String(resellerId))
  const cur = reseller?.currency || 'AED'
  const lastPrice = useMemo(() => {
    const m = new Map()
    ;(data?.items || []).slice().sort((a, b) => (a.handoverDate || '').localeCompare(b.handoverDate || '')).forEach((p) => { if (p.aedPrice) m.set(p.productId, p.aedPrice) })
    return (pid) => m.get(pid)
  }, [data])

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader eyebrow={reseller?.name || 'Reseller'} title="Handovers" icon={Truck}
        subtitle="Stock sent to the reseller in advance, batch by batch"
        actions={can('fc:write') && reseller && <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} />Record handover</button>} />
      <ErrorBanner onRetry={load}>{error}</ErrorBanner>

      {!data ? <SkeletonRows rows={4} /> : data.consignments.length === 0 ? (
        <EmptyState icon={Truck} title="No handovers yet" hint="Record the first batch of stock you send." />
      ) : (
        <div className="space-y-3">
          {data.consignments.map((c) => {
            const items = data.items.filter((p) => p.consignmentId === c.id)
            const count = (s) => items.filter((p) => p.status === `FC - ${s}`).length
            const sold = count('Sold') + count('Paid')
            const value = items.reduce((s, p) => s + (Number(p.aedPrice) || 0), 0)
            const isOpen = open === c.id
            return (
              <motion.div layout key={c.id} className="card overflow-hidden">
                <button className="flex w-full flex-wrap items-center gap-4 p-4 text-left transition hover:bg-subtle/50" onClick={() => setOpen(isOpen ? null : c.id)}>
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gold-50 text-gold-600 dark:bg-gold-700/20 dark:text-gold-300"><Truck size={18} /></div>
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-[17px] font-semibold text-ink">{fmtDate(c.handoverDate, { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                    <p className="text-xs text-muted">{items.length} pieces{showMoney ? ` · ${cur} ${fmt(value)} · ${c.commissionPct}% commission` : ''}{c.notes ? ` · ${c.notes}` : ''}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold">
                    <span className="rounded-full bg-sky-50 px-2 py-0.5 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300">{count('At Store')} at store</span>
                    <span className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">{count('Sold')} sold</span>
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">{count('Paid')} paid</span>
                    <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">{count('Returned')} returned</span>
                  </div>
                  <div className="hidden w-28 sm:block"><div className="h-1.5 overflow-hidden rounded-full bg-subtle2"><div className="h-full rounded-full bg-gold-400" style={{ width: `${items.length ? (sold / items.length) * 100 : 0}%` }} /></div><p className="mt-1 text-right text-[10px] text-faint">{items.length ? Math.round((sold / items.length) * 100) : 0}% sold</p></div>
                  <ChevronDown size={16} className={`text-faint transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} transition={{ duration: 0.25, ease }} className="overflow-hidden border-t border-line">
                      <ul className="divide-y divide-line">
                        {items.map((p) => (
                          <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                            {p.imageUrl && <img src={p.imageUrl} alt="" className="h-9 w-9 rounded object-cover" loading="lazy" />}
                            <p className="flex-1 truncate text-sm text-ink">{p.product} <span className="text-faint">· {p.size}</span></p>
                            {showMoney && <span className="text-sm text-ink-soft">{cur} {fmt(p.aedPrice)}</span>}
                            <StatusPill status={p.status} />
                          </li>
                        ))}
                      </ul>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )
          })}
        </div>
      )}

      {reseller && <HandoverForm open={creating} onClose={() => setCreating(false)} reseller={reseller} lastPrice={lastPrice} onSaved={load} />}
    </div>
  )
}
