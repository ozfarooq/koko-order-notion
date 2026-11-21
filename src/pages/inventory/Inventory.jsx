import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  Boxes, Plus, Camera, Scissors, Store, Search, X, Shirt, Minus, Trash2, AlertTriangle, PackageCheck, Warehouse, History,
  ShoppingBag, LayoutGrid, Undo2, ChevronDown,
} from 'lucide-react'
import {
  getInventory, getStockPieces, addStockPieces, updateStockPiece, moveStockPieces, getStockHistory, deleteStockPiece,
  addStockPiecesBulk, markStockDamaged,
  STOCK_SIZES, STOCK_STATUS_OPTIONS,
} from '../../data/storage'
import { useAuth } from '../../auth/AuthContext'
import { PageHeader, StatCard, Modal, Field, Segmented, EmptyState, SkeletonRows, SkeletonCards, ErrorBanner, fmtDate } from '../../ui/kit'
import { ease, listParent, listItem } from '../../ui/motion'
import ProductPicker from '../orders/ProductPicker'

const SHORT = { 'X-Small': 'XS', Small: 'S', Medium: 'M', Large: 'L', 'X-Large': 'XL', Custom: 'Custom' }
const STATUSES = STOCK_STATUS_OPTIONS.map((s) => s.value)
const MANUAL = STATUSES.filter((s) => s !== 'With Reseller')
const DEFAULT_FILTER = ['In Production', 'At Studio']
const today = () => new Date().toISOString().slice(0, 10)

export function StockPill({ status }) {
  const meta = STOCK_STATUS_OPTIONS.find((s) => s.value === status)
  if (!meta) return null
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${meta.color}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />{status}
    </span>
  )
}

// A damaged piece that can still be sold, with its asking price
export function DamagedLabel({ piece, full }) {
  if (!piece?.damaged) return null
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-600/20 dark:bg-rose-950/40 dark:text-rose-300" title={piece.damageNote}>
      <AlertTriangle size={11} />Damaged{piece.askingPricePkr != null ? ` · PKR ${Math.round(piece.askingPricePkr).toLocaleString()}` : ''}{full && piece.damageNote ? ` · ${piece.damageNote}` : ''}
    </span>
  )
}

function Thumb({ src, className = 'h-14 w-11' }) {
  return (
    <div className={`flex-shrink-0 overflow-hidden rounded-lg bg-subtle2 ${className}`}>
      {src ? <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-faint"><Shirt size={16} /></div>}
    </div>
  )
}

// Where a piece is, in a few words: the reseller, the order it went to, or the location note
function whereabouts(p) {
  if (p.status === 'With Reseller' && p.reseller) return <Link to={`/resellers/${p.resellerId}/stock`} className="hover:text-accent hover:underline" onClick={(e) => e.stopPropagation()}>{p.reseller}</Link>
  if (p.status === 'At Studio' && p.orderId) return <Link to={`/orders/${p.orderId}`} className="hover:text-accent hover:underline" onClick={(e) => e.stopPropagation()}>Reserved for {p.orderNumber}</Link>
  if ((p.status === 'Sold' || p.status === 'Gifted') && p.orderId) return <Link to={`/orders/${p.orderId}`} className="hover:text-accent hover:underline" onClick={(e) => e.stopPropagation()}>{p.orderNumber}</Link>
  if (p.status === 'Sold' && p.reseller) return `Sold by ${p.reseller}`
  if (p.source === 'Reseller return' || (p.status === 'At Studio' && p.reseller)) return `Returned by ${p.reseller}`
  return p.locationNote || null
}

// ── Add pieces / Add sample ─────────────────────────────────────────────
function AddPiecesModal({ open, onClose, sample, preset, overview, onSaved }) {
  const [product, setProduct] = useState(null)
  const [picking, setPicking] = useState(false)
  const [qty, setQty] = useState({})
  const [size, setSize] = useState('Medium')
  const [status, setStatus] = useState('In Production')
  const [source, setSource] = useState('Made')
  const [madeOn, setMadeOn] = useState(today())
  const [locationNote, setLocationNote] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!open) return
    setProduct(preset || null); setQty({}); setSize('Medium'); setStatus(sample ? 'At Studio' : 'In Production')
    setSource('Made'); setMadeOn(today()); setLocationNote(''); setNotes('')
  }, [open, sample, preset])

  const total = sample ? 1 : STOCK_SIZES.reduce((s, z) => s + (qty[z] || 0), 0)
  const existingSamples = product ? overview?.products.find((p) => p.productId === product.id)?.samples || [] : []
  const step = (z, d) => setQty((q) => ({ ...q, [z]: Math.min(50, Math.max(0, (q[z] || 0) + d)) }))

  const save = async () => {
    if (!product) return toast.error('Choose an outfit')
    if (!total) return toast.error('Add at least one piece')
    setSaving(true)
    try {
      const r = await addStockPieces({
        productId: product.id, kind: sample ? 'Sample' : 'Stock', status, source, madeOn, notes,
        locationNote: sample ? locationNote : undefined,
        sizes: sample ? { [size]: 1 } : Object.fromEntries(Object.entries(qty).filter(([, n]) => n > 0)),
      })
      toast.success(sample ? `Sample added · ${r.product}` : `${r.created} piece${r.created === 1 ? '' : 's'} added · ${r.product}`)
      onSaved(); onClose()
    } catch (err) { toast.error(err.message) } finally { setSaving(false) }
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title={sample ? 'Add a sample' : 'Add pieces'}
        subtitle={sample ? 'The photoshoot piece for an outfit' : 'A production batch, or pieces already at the studio'}
        footer={<>
          {!sample && <p className="mr-auto self-center text-sm text-muted">{total} piece{total === 1 ? '' : 's'}</p>}
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving || !product || !total}><Plus size={15} />{saving ? 'Saving…' : sample ? 'Add sample' : 'Add pieces'}</button>
        </>}>
        <div className="space-y-4 p-5">
          <button type="button" onClick={() => setPicking(true)}
            className="flex w-full items-center gap-3 rounded-xl border border-dashed border-line p-3 text-left transition hover:border-plum-300">
            {product ? <>
              <Thumb src={product.imageUrl} />
              <div className="min-w-0 flex-1"><p className="truncate font-medium text-ink">{product.name}</p><p className="text-xs text-faint">{product.collection || 'Separates'}</p></div>
              <span className="text-xs font-semibold text-accent">Change</span>
            </> : <span className="flex w-full items-center justify-center gap-2 py-3 text-sm text-muted"><Shirt size={18} />Choose an outfit</span>}
          </button>

          {sample && existingSamples.length > 0 && (
            <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />This outfit already has {existingSamples.length === 1 ? 'a sample' : `${existingSamples.length} samples`} ({existingSamples.map((s) => `${SHORT[s.size]}, ${s.status.toLowerCase()}`).join('; ')}). Add another only if you made a second one.
            </p>
          )}

          {sample ? (
            <Field label="Size">
              <select className="input" value={size} onChange={(e) => setSize(e.target.value)}>{STOCK_SIZES.map((s) => <option key={s}>{s}</option>)}</select>
            </Field>
          ) : (
            <div>
              <label className="label">Quantity per size</label>
              <div className="grid grid-cols-5 gap-2">
                {STOCK_SIZES.map((z) => (
                  <div key={z} className={`rounded-xl border p-2 text-center transition ${qty[z] ? 'border-brand-primary/60 bg-plum-50/40 dark:bg-plum-900/10' : 'border-line'}`}>
                    <p className="text-xs font-semibold text-muted">{SHORT[z]}</p>
                    <p className="my-1 font-display text-2xl font-semibold tabular-nums text-ink">{qty[z] || 0}</p>
                    <div className="flex justify-center gap-1">
                      <button type="button" className="btn-icon h-7 w-7" onClick={() => step(z, -1)} aria-label={`Fewer ${z}`}><Minus size={13} /></button>
                      <button type="button" className="btn-icon h-7 w-7" onClick={() => step(z, 1)} aria-label={`More ${z}`}><Plus size={13} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status">
              <Segmented value={status} onChange={setStatus} options={[{ value: 'In Production', label: 'In production' }, { value: 'At Studio', label: 'Finished, at studio' }]} />
            </Field>
            <Field label="Source">
              <select className="input" value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="Made">Made</option>
                <option value="Opening count">Opening count (already at the studio)</option>
                <option value="Customer return">Customer return</option>
              </select>
            </Field>
            <Field label="Made on"><input type="date" className="input" value={madeOn} onChange={(e) => setMadeOn(e.target.value)} /></Field>
            {sample && <Field label="Where it is"><input className="input" value={locationNote} onChange={(e) => setLocationNote(e.target.value)} placeholder="e.g. Studio rail" /></Field>}
            <Field label="Notes" className={sample ? 'sm:col-span-2' : ''}><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={sample ? 'Optional' : 'e.g. tailor, batch for Collage'} /></Field>
          </div>
        </div>
      </Modal>
      <ProductPicker open={picking} onClose={() => setPicking(false)} onPick={(p) => { setProduct(p); setPicking(false) }} />
    </>
  )
}

// ── Bulk add: quantities for many outfits in one go ────────────────────
function BulkAddModal({ open, onClose, overview, onSaved, startKind = 'Stock', startStatus, startSource = 'Made' }) {
  const newest = overview?.collections[0]?.id ?? null
  const [kind, setKind] = useState(startKind)
  const [collection, setCollection] = useState('all')
  const [q, setQ] = useState('')
  const [qty, setQty] = useState({})            // stock: { [productId]: { Small: 2 } }
  const [sampleSize, setSampleSize] = useState({})  // samples: { [productId]: 'Medium' }
  const [locationNote, setLocationNote] = useState('')
  const [status, setStatus] = useState('In Production')
  const [source, setSource] = useState('Made')
  const [madeOn, setMadeOn] = useState(today())
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!open) return
    setKind(startKind); setCollection(String(newest ?? 'all')); setQ(''); setQty({}); setSampleSize({}); setLocationNote('')
    setStatus(startStatus || (startKind === 'Sample' ? 'At Studio' : 'In Production')); setSource(startSource); setMadeOn(today()); setNotes('')
  }, [open, newest, startKind, startStatus, startSource])
  const isSample = kind === 'Sample'
  const switchKind = (k) => { setKind(k); setStatus(k === 'Sample' ? 'At Studio' : 'In Production') }

  const term = q.trim().toLowerCase()
  const rows = (overview?.products || []).filter((p) => (term ? `${p.product} ${p.collection || ''}`.toLowerCase().includes(term)
    : collection === 'all' || String(p.collectionId ?? 'none') === collection) && (p.isActive || term))
  const stockTotal = Object.values(qty).reduce((s, z) => s + Object.values(z).reduce((a, n) => a + (Number(n) || 0), 0), 0)
  const samplesChosen = Object.values(sampleSize).filter(Boolean).length
  const total = isSample ? samplesChosen : stockTotal
  const outfits = isSample ? samplesChosen : Object.values(qty).filter((z) => Object.values(z).some((n) => Number(n) > 0)).length
  const setCell = (pid, size, v) => {
    const n = v === '' ? '' : Math.min(50, Math.max(0, Math.floor(Number(v) || 0)))
    setQty((x) => ({ ...x, [pid]: { ...(x[pid] || {}), [size]: n } }))
  }

  const save = async () => {
    const items = isSample
      ? Object.entries(sampleSize).filter(([, z]) => z).map(([pid, z]) => ({ productId: Number(pid), sizes: { [z]: 1 } }))
      : Object.entries(qty).map(([pid, z]) => ({ productId: Number(pid), sizes: Object.fromEntries(Object.entries(z).filter(([, n]) => Number(n) > 0)) }))
        .filter((it) => Object.keys(it.sizes).length)
    if (!items.length) return toast.error(isSample ? 'Choose a size for at least one outfit' : 'Enter a quantity for at least one outfit')
    setSaving(true)
    try {
      const r = await addStockPiecesBulk({ items, kind, status, source, madeOn, notes, locationNote: isSample ? locationNote : undefined })
      toast.success(isSample ? `${r.created} shoot sample${r.created === 1 ? '' : 's'} added` : `${r.created} piece${r.created === 1 ? '' : 's'} added across ${r.outfits} outfit${r.outfits === 1 ? '' : 's'}`)
      onSaved(); onClose()
    } catch (err) { toast.error(err.message) } finally { setSaving(false) }
  }

  return (
    <Modal open={open} onClose={onClose} size="xl" title="Bulk add" subtitle={isSample ? 'Shoot samples for as many outfits as you like, saved together' : 'Quantities for as many outfits as you like, saved together'}
      footer={<>
        <p className="mr-auto self-center text-sm text-muted">{isSample ? `${total} sample${total === 1 ? '' : 's'}` : `${total} piece${total === 1 ? '' : 's'} · ${outfits} outfit${outfits === 1 ? '' : 's'}`}</p>
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={saving || !total}><Plus size={15} />{saving ? 'Saving…' : isSample ? `Add ${total || ''} sample${total === 1 ? '' : 's'}` : `Add ${total || ''} piece${total === 1 ? '' : 's'}`}</button>
      </>}>
      <div className="space-y-4 p-5">
        <Segmented value={kind} onChange={switchKind} options={[{ value: 'Stock', label: 'Stock pieces' }, { value: 'Sample', label: 'Shoot samples' }]} />
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Status" className="sm:col-span-2">
            <Segmented value={status} onChange={setStatus} options={[{ value: 'In Production', label: 'In production' }, { value: 'At Studio', label: 'Finished, at studio' }]} />
          </Field>
          <Field label="Source">
            <select className="input" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="Made">Made</option><option value="Opening count">Spare, already at the studio</option><option value="Customer return">Customer return</option>
            </select>
          </Field>
          <Field label="Made on"><input type="date" className="input" value={madeOn} onChange={(e) => setMadeOn(e.target.value)} /></Field>
          {isSample && <Field label="Where they are" className="sm:col-span-2"><input className="input" value={locationNote} onChange={(e) => setLocationNote(e.target.value)} placeholder="e.g. Studio rail, with photographer Ali" /></Field>}
          <Field label={isSample ? 'Notes (all samples)' : 'Notes (all pieces)'} className={isSample ? 'sm:col-span-2' : 'sm:col-span-4'}><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={isSample ? 'e.g. Eid shoot, Dec 2026' : 'e.g. tailor, batch for Collage'} /></Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <select className="input w-auto" value={collection} onChange={(e) => setCollection(e.target.value)} disabled={!!term}>
            {(overview?.collections || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value="none">Separates</option><option value="all">All collections</option>
          </select>
          <div className="relative min-w-[200px] flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input className="input pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search any outfit" />
          </div>
        </div>
        <div className="max-h-[48vh] overflow-auto rounded-xl border border-line">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="sticky top-0 z-10 bg-surface-accent">
              {isSample ? (
              <tr>
                <th className="px-3 py-2 text-left font-label text-[10.5px] font-medium uppercase tracking-wider text-ink">Outfit</th>
                <th className="px-3 py-2 text-left font-label text-[10.5px] font-medium uppercase tracking-wider text-ink">Sample already</th>
                <th className="w-44 px-3 py-2 text-left font-label text-[10.5px] font-medium uppercase tracking-wider text-ink">Sample size</th>
              </tr>
              ) : (
              <tr>
                <th className="px-3 py-2 text-left font-label text-[10.5px] font-medium uppercase tracking-wider text-ink">Outfit</th>
                {STOCK_SIZES.map((z) => <th key={z} className="w-16 px-1 py-2 text-center font-label text-[10.5px] font-medium uppercase tracking-wider text-ink">{SHORT[z]}</th>)}
                <th className="w-12 px-2 py-2 text-right font-label text-[10.5px] font-medium uppercase tracking-wider text-ink">Total</th>
              </tr>
              )}
            </thead>
            <tbody className="divide-y divide-line">
              {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted">No outfits match.</td></tr>}
              {isSample && rows.map((p) => {
                const live = p.samples.filter((s) => !['Sold', 'Archived', 'Damaged'].includes(s.status))
                const chosen = sampleSize[p.productId] || ''
                return (
                  <tr key={p.productId} className={chosen ? 'bg-plum-50/40 dark:bg-plum-900/10' : ''}>
                    <td className="px-3 py-1.5"><div className="flex items-center gap-2.5"><Thumb src={p.imageUrl} className="h-10 w-8" /><div className="min-w-0"><p className="truncate font-medium text-ink">{p.product}</p><p className="truncate text-[11px] text-faint">{p.collection || 'Separates'}</p></div></div></td>
                    <td className="px-3 py-1.5 text-xs">{live.length
                      ? <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300"><AlertTriangle size={11} />{live.map((s) => `${SHORT[s.size]}, ${s.status.toLowerCase()}`).join('; ')}</span>
                      : <span className="text-faint">None</span>}</td>
                    <td className="px-3 py-1.5">
                      <select className="input py-1.5 text-sm" value={chosen} onChange={(e) => setSampleSize((x) => ({ ...x, [p.productId]: e.target.value }))} aria-label={`${p.product} sample size`}>
                        <option value="">No sample</option>
                        {STOCK_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                  </tr>
                )
              })}
              {!isSample && rows.map((p) => {
                const z = qty[p.productId] || {}
                const sum = Object.values(z).reduce((a, n) => a + (Number(n) || 0), 0)
                return (
                  <tr key={p.productId} className={sum ? 'bg-plum-50/40 dark:bg-plum-900/10' : ''}>
                    <td className="px-3 py-1.5"><div className="flex items-center gap-2.5"><Thumb src={p.imageUrl} className="h-10 w-8" /><div className="min-w-0"><p className="truncate font-medium text-ink">{p.product}</p><p className="truncate text-[11px] text-faint">{p.collection || 'Separates'}</p></div></div></td>
                    {STOCK_SIZES.map((size) => (
                      <td key={size} className="px-1 py-1.5">
                        <input type="number" min="0" max="50" inputMode="numeric" aria-label={`${p.product} ${size}`}
                          className="w-full rounded-md border border-line bg-surface px-1 py-1.5 text-center tabular-nums text-ink focus:border-plum-400 focus:outline-none"
                          value={z[size] ?? ''} placeholder="0" onFocus={(e) => e.target.select()} onChange={(e) => setCell(p.productId, size, e.target.value)} />
                      </td>
                    ))}
                    <td className={`px-2 py-1.5 text-right font-semibold tabular-nums ${sum ? 'text-ink' : 'text-faint/50'}`}>{sum}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">{isSample ? 'One sample per outfit; outfits that already have one are flagged. ' : ''}{isSample ? 'Choices' : 'Quantities'} stay when you switch collection or search, so you can fill several collections before saving.</p>
      </div>
    </Modal>
  )
}

// ── One piece: edit and history ─────────────────────────────────────────
function PieceModal({ piece, onClose, onSaved, canWrite, canSell }) {
  const navigate = useNavigate()
  const [form, setForm] = useState(null)
  const [history, setHistory] = useState(null)
  const [saving, setSaving] = useState(false)
  const [byHand, setByHand] = useState(false)
  useEffect(() => {
    if (!piece) return
    setByHand(false)
    setForm({ status: piece.status, kind: piece.kind, locationNote: piece.locationNote, notes: piece.notes, orderNumber: piece.orderNumber || '', moveNote: '',
      damaged: piece.damaged, damageNote: piece.damageNote, askingPricePkr: piece.askingPricePkr ?? '' })
    setHistory(null)
    getStockHistory(piece.id).then(setHistory).catch(() => setHistory([]))
  }, [piece])
  if (!piece || !form) return null
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const locked = piece.status === 'With Reseller'
  const editable = canWrite && !locked
  const moving = form.status !== piece.status
  const labelable = ['At Studio', 'At Shoot', 'In Production'].includes(form.status)
  const sellable = canSell && piece.status === 'At Studio' && !piece.orderId

  const save = async () => {
    if (form.status === 'Damaged' && moving && !form.moveNote.trim()) return toast.error('Say why the piece is damaged or lost')
    if (form.status === 'Gifted' && moving && !form.moveNote.trim()) return toast.error('Say who the piece was given to')
    setSaving(true)
    try {
      if (form.damaged && labelable && !String(form.damageNote || '').trim()) { setSaving(false); return toast.error("Say what's wrong with the piece") }
      await updateStockPiece(piece.id, {
        ...form, orderNumber: ['Sold', 'Gifted'].includes(form.status) ? form.orderNumber : undefined,
        ...(labelable ? {} : { damaged: undefined, damageNote: undefined, askingPricePkr: undefined }),
      })
      toast.success('Piece updated'); onSaved(); onClose()
    } catch (err) { toast.error(err.message) } finally { setSaving(false) }
  }
  const quick = async (status, note, done) => {
    try { await moveStockPieces([piece.id], status, note); toast.success(`${piece.product} (${piece.size}) ${done}`); onSaved(); onClose() }
    catch (err) { toast.error(err.message) }
  }
  const actions = !editable ? [] : [
    piece.status === 'In Production' && { label: 'Mark ready', icon: PackageCheck, run: () => quick('At Studio', 'Ready', 'is ready') },
    piece.kind === 'Sample' && piece.status === 'At Studio' && { label: 'Send to shoot', icon: Camera, run: () => quick('At Shoot', null, 'sent to the shoot') },
    piece.status === 'At Shoot' && { label: 'Back at studio', icon: Undo2, run: () => quick('At Studio', 'Back from the shoot', 'back at the studio') },
  ].filter(Boolean)
  const remove = async () => {
    if (!window.confirm(`Delete this ${piece.product} (${piece.size})? Only for pieces added by mistake.`)) return
    try { await deleteStockPiece(piece.id); toast.success('Piece deleted'); onSaved(); onClose() } catch (err) { toast.error(err.message) }
  }

  return (
    <Modal open={!!piece} onClose={onClose} title={piece.product} subtitle={`${piece.size} · ${piece.kind === 'Sample' ? 'Shoot sample' : 'Stock'} · ${piece.source}${piece.madeOn ? ` · made ${fmtDate(piece.madeOn, { day: 'numeric', month: 'short' })}` : ''}`}
      footer={editable ? <>
        {piece.canDelete && <button className="btn-ghost mr-auto text-rose-600" onClick={remove}><Trash2 size={15} />Delete</button>}
        {sellable && <button className={`btn-secondary ${piece.canDelete ? '' : 'mr-auto'}`} onClick={() => navigate('/orders/new', { state: { stockPiece: piece } })}><ShoppingBag size={15} />Sell this piece</button>}
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </> : <button className="btn-primary" onClick={onClose}>Done</button>}>
      <div className="space-y-4 p-5">
        <div className="flex items-center gap-3">
          <Thumb src={piece.imageUrl} className="h-20 w-16" />
          <div className="space-y-1 text-sm">
            <div className="flex flex-wrap items-center gap-1.5"><StockPill status={piece.status} /><DamagedLabel piece={piece} /></div>
            {whereabouts(piece) && <p className="text-muted">{whereabouts(piece)}</p>}
            {piece.damaged && piece.damageNote && <p className="text-xs text-rose-700 dark:text-rose-300">{piece.damageNote}</p>}
          </div>
        </div>
        {locked && <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:bg-sky-950/40 dark:text-sky-200">This piece is with {piece.reseller}. Its status follows the reseller screens: sold, paid or returned there, it updates here.</p>}
        {actions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {actions.map((a) => <button key={a.label} type="button" className="btn-secondary" onClick={a.run}><a.icon size={15} />{a.label}</button>)}
          </div>
        )}

        {editable && (
          <div className="grid gap-4 sm:grid-cols-2">
            {byHand ? <>
              <Field label="Status">
                <select className="input" value={form.status} onChange={(e) => set({ status: e.target.value })}>{MANUAL.map((s) => <option key={s}>{s}</option>)}</select>
              </Field>
              <Field label="Kind">
                <select className="input" value={form.kind} onChange={(e) => set({ kind: e.target.value })}><option value="Stock">Stock</option><option value="Sample">Shoot sample</option></select>
              </Field>
            </> : (
              <button type="button" className="text-left text-xs font-semibold text-accent hover:underline sm:col-span-2" onClick={() => setByHand(true)}>Change status by hand (written off, archived, sold elsewhere…)</button>
            )}
            {['Sold', 'Gifted'].includes(form.status) && (
              <Field label="Order number" hint={form.status === 'Gifted' ? 'Optional: the PR order it went out with' : 'Optional: the customer order it went to'}>
                <input className="input" value={form.orderNumber} onChange={(e) => set({ orderNumber: e.target.value })} placeholder="SO-000123" />
              </Field>
            )}
            <Field label="Where it is" className={['Sold', 'Gifted'].includes(form.status) ? '' : 'sm:col-span-2'}>
              <input className="input" value={form.locationNote} onChange={(e) => set({ locationNote: e.target.value })} placeholder="e.g. With photographer Ali" />
            </Field>
            {moving && (
              <Field label={form.status === 'Damaged' ? 'Reason (required)' : form.status === 'Gifted' ? 'Given to (required)' : 'Note for this move'} className="sm:col-span-2">
                <input className="input" value={form.moveNote} onChange={(e) => set({ moveNote: e.target.value })} placeholder={form.status === 'Damaged' ? 'e.g. Stain on the front, lost by courier' : form.status === 'Gifted' ? 'e.g. PR to @zainaarshad' : 'Optional'} autoFocus={['Damaged', 'Gifted'].includes(form.status)} />
              </Field>
            )}
            <Field label="Notes" className="sm:col-span-2"><input className="input" value={form.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
            {labelable && (
              <div className="space-y-3 rounded-xl border border-line p-3 sm:col-span-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink">
                  <input type="checkbox" className="h-4 w-4 accent-[#7B2D45]" checked={!!form.damaged} onChange={(e) => set({ damaged: e.target.checked })} />
                  Damaged, but can still be sold at a lower price
                </label>
                {form.damaged && (
                  <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
                    <Field label="What's wrong"><input className="input" value={form.damageNote} onChange={(e) => set({ damageNote: e.target.value })} placeholder="e.g. Small stain on the dupatta" /></Field>
                    <Field label="Asking price"><div className="relative"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-faint">PKR</span>
                      <input type="number" min="0" className="input pl-11" value={form.askingPricePkr} onChange={(e) => set({ askingPricePkr: e.target.value })} /></div></Field>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div>
          <p className="label flex items-center gap-1"><History size={11} />History</p>
          {!history ? <p className="text-sm text-faint">Loading…</p> : (
            <ol className="space-y-2 border-l border-line pl-4">
              {history.map((h) => (
                <li key={h.id} className="relative text-sm">
                  <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-gold-400" />
                  <p className="text-ink">{h.from ? <>{h.from} → <span className="font-semibold">{h.to}</span></> : <>Added as <span className="font-semibold">{h.to}</span></>}</p>
                  <p className="text-xs text-faint">{fmtDate(h.at, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}{h.user ? ` · ${h.user}` : ''}</p>
                  {h.note && <p className="text-xs text-muted">{h.note}</p>}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </Modal>
  )
}

function DamagedModal({ open, count, onClose, onConfirm }) {
  const [reason, setReason] = useState('')
  const [forSale, setForSale] = useState(true)
  const [price, setPrice] = useState('')
  useEffect(() => { if (open) { setReason(''); setForSale(true); setPrice('') } }, [open])
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Mark damaged" subtitle={`${count} piece${count === 1 ? '' : 's'}`}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!reason.trim()} onClick={() => onConfirm({ forSale, reason: reason.trim(), price })}>{forSale ? 'Label damaged' : 'Write off'}</button></>}>
      <div className="space-y-4 p-5">
        <Segmented value={forSale ? 'sale' : 'off'} onChange={(v) => setForSale(v === 'sale')} options={[{ value: 'sale', label: 'Can still be sold' }, { value: 'off', label: "Can't be sold" }]} />
        <p className="text-xs text-muted">{forSale ? 'The piece stays where it is with a Damaged label, ready to sell at a lower price.' : 'The piece is written off and leaves stock.'}</p>
        <Field label={forSale ? "What's wrong" : 'Reason'}><input autoFocus className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Stain on the front, lost by courier" /></Field>
        {forSale && <Field label="Asking price (optional)"><div className="relative"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-faint">PKR</span>
          <input type="number" min="0" className="input pl-11" value={price} onChange={(e) => setPrice(e.target.value)} /></div></Field>}
      </div>
    </Modal>
  )
}

// ── Lists of pieces with tick boxes and a bar of bulk actions ──────────
function PieceRows({ pieces, canWrite, canSell, onOpen, actions, empty }) {
  const navigate = useNavigate()
  const [picked, setPicked] = useState(new Set())
  useEffect(() => { setPicked((x) => new Set([...x].filter((id) => pieces.some((p) => p.id === id)))) }, [pieces])
  const toggle = (id) => setPicked((x) => { const n = new Set(x); n.has(id) ? n.delete(id) : n.add(id); return n })
  if (!pieces.length) return <p className="card p-6 text-center text-sm text-muted">{empty}</p>
  return (
    <>
      <div className="card divide-y divide-line overflow-hidden">
        {pieces.map((p) => {
          const where = whereabouts(p)
          const selectable = canWrite && ['At Studio', 'In Production', 'At Shoot'].includes(p.status)
          return (
            <div key={p.id} role="button" tabIndex={0} onClick={() => onOpen(p)} onKeyDown={(e) => e.key === 'Enter' && onOpen(p)}
              className={`flex cursor-pointer flex-wrap items-center gap-3 px-3 py-2.5 transition hover:bg-subtle/60 sm:flex-nowrap sm:px-4 ${picked.has(p.id) ? 'bg-plum-50/50 dark:bg-plum-900/10' : ''}`}>
              {canWrite && <input type="checkbox" className="h-4 w-4 flex-shrink-0 accent-[#7B2D45] disabled:opacity-30" disabled={!selectable} checked={picked.has(p.id)}
                onClick={(e) => e.stopPropagation()} onChange={() => toggle(p.id)} aria-label={`Select ${p.product} ${p.size}`} />}
              <Thumb src={p.imageUrl} className="h-12 w-9" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{p.product} <span className="font-normal text-muted">· {p.size}</span></p>
                <p className="truncate text-xs text-faint">{[where && <span key="w">{where}</span>, p.collection, p.madeOn && `made ${fmtDate(p.madeOn, { day: 'numeric', month: 'short' })}`].filter(Boolean).reduce((a, x, i) => (i ? [...a, ' · ', x] : [x]), [])}</p>
              </div>
              <DamagedLabel piece={p} />
              {!['At Studio', 'In Production'].includes(p.status) && <StockPill status={p.status} />}
              {canSell && p.status === 'At Studio' && !p.orderId && (
                <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={(e) => { e.stopPropagation(); navigate('/orders/new', { state: { stockPiece: p } }) }}><ShoppingBag size={13} />Sell</button>
              )}
            </div>
          )
        })}
      </div>
      <AnimatePresence>
        {picked.size > 0 && (
          <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={{ duration: 0.2, ease }}
            className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface p-2.5 shadow-lift md:bottom-6">
            <span className="px-2 text-sm font-semibold text-ink">{picked.size} selected</span>
            <button className="btn-ghost text-xs" onClick={() => setPicked(new Set())}>Clear</button>
            <div className="ml-auto flex flex-wrap gap-1.5">
              {actions.map((a) => <button key={a.label} className={`${a.primary ? 'btn-primary' : 'btn-secondary'} text-xs ${a.danger ? 'text-rose-600' : ''}`} onClick={() => a.run([...picked], () => setPicked(new Set()))}><a.icon size={14} />{a.label}</button>)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

// ── Samples: one per design, any collection ────────────────────────────
function SamplesTab({ data, canWrite, onOpenSample, onAddOne }) {
  const [collection, setCollection] = useState(String(data.collections[0]?.id ?? 'all'))
  const [q, setQ] = useState('')
  const [missingOnly, setMissingOnly] = useState(false)
  const [showSold, setShowSold] = useState(false)
  const live = (p) => p.samples.filter((x) => !['Sold', 'Archived', 'Gifted'].includes(x.status))
  const term = q.trim().toLowerCase()
  const outfits = data.products.filter((p) => (term ? p.product.toLowerCase().includes(term) : collection === 'all' || String(p.collectionId ?? 'none') === collection)
    && (p.isActive || p.samples.length))
  const shown = outfits.filter((p) => !missingOnly || !live(p).length)
  const have = outfits.filter((p) => live(p).length).length
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className="input w-auto" value={collection} onChange={(e) => setCollection(e.target.value)} disabled={!!term}>
          {data.collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value="none">Separates</option><option value="all">All collections</option>
        </select>
        <div className="relative min-w-[180px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input className="input pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search any design" />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted"><input type="checkbox" className="h-4 w-4 accent-[#7B2D45]" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} />Missing a sample</label>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted"><input type="checkbox" className="h-4 w-4 accent-[#7B2D45]" checked={showSold} onChange={(e) => setShowSold(e.target.checked)} />Show sold</label>
      </div>
      <p className="text-sm text-muted"><span className="font-semibold text-ink">{have} of {outfits.length}</span> designs have a sample{have < outfits.length ? <> · <span className="text-amber-700 dark:text-amber-300">{outfits.length - have} missing</span></> : ''}</p>
      {shown.length === 0 ? <EmptyState icon={Camera} title={missingOnly ? 'Every design has a sample' : 'No designs here'} /> : (
        <motion.div variants={listParent} initial="hidden" animate="show" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {shown.map((p) => {
            const samples = p.samples.filter((x) => showSold || !['Sold', 'Archived', 'Gifted'].includes(x.status))
            return (
              <motion.div key={p.productId} variants={listItem} className="card overflow-hidden">
                <div className="aspect-[3/4] bg-subtle2">{p.imageUrl ? <img src={p.imageUrl} alt={p.product} loading="lazy" className="h-full w-full object-cover object-top" /> : null}</div>
                <div className="space-y-2 p-2.5">
                  <div><p className="truncate text-sm font-medium text-ink">{p.product}</p>{(collection === 'all' || term) && <p className="truncate text-[11px] text-faint">{p.collection || 'Separates'}</p>}</div>
                  {samples.map((x) => (
                    <button key={x.id} type="button" onClick={() => onOpenSample(p, x)} className="flex w-full items-center justify-between gap-2 rounded-lg bg-subtle px-2 py-1.5 text-left transition hover:bg-subtle2">
                      <span className="text-xs font-semibold text-ink">{SHORT[x.size] || x.size}</span><StockPill status={x.status} />
                    </button>
                  ))}
                  {!live(p).length && (canWrite
                    ? <button type="button" className="btn-secondary w-full px-2 py-1.5 text-xs" onClick={() => onAddOne(p)}><Plus size={13} />Add sample</button>
                    : <p className="text-xs text-amber-700 dark:text-amber-300">No sample</p>)}
                </div>
              </motion.div>
            )
          })}
        </motion.div>
      )}
    </div>
  )
}

// ── Studio stock: what's physically here, apart from samples ───────────
function StudioStockTab({ version, canWrite, canSell, onOpen, onChanged }) {
  const [pieces, setPieces] = useState(null)
  const [gone, setGone] = useState(null)
  const [showGone, setShowGone] = useState(false)
  const [q, setQ] = useState('')
  const [damaging, setDamaging] = useState(null)
  useEffect(() => { getStockPieces({ status: 'At Studio', kind: 'Stock' }).then(setPieces).catch((e) => toast.error(e.message)) }, [version])
  useEffect(() => { if (showGone) getStockPieces({ status: 'Sold,Gifted,Damaged,Archived', kind: 'Stock' }).then(setGone).catch(() => setGone([])) }, [showGone, version])
  const term = q.trim().toLowerCase()
  const match = (p) => !term || `${p.product} ${p.collection || ''}`.toLowerCase().includes(term)
  if (!pieces) return <SkeletonRows rows={5} />
  const ready = pieces.filter((p) => p.source === 'Made' && match(p))
  const forSale = pieces.filter((p) => p.source !== 'Made' && match(p))
  const damage = async ({ forSale: sellable, reason, price }) => {
    try {
      if (sellable) await markStockDamaged({ pieceIds: damaging.ids, damaged: true, damageNote: reason, askingPricePkr: price })
      else await moveStockPieces(damaging.ids, 'Damaged', reason)
      toast.success(sellable ? 'Labelled damaged' : 'Written off'); damaging.done(); setDamaging(null); onChanged()
    } catch (err) { toast.error(err.message) }
  }
  const actions = [{ label: 'Mark damaged', icon: AlertTriangle, danger: true, run: (ids, done) => setDamaging({ ids, done }) }]
  return (
    <div className="space-y-5 pb-20">
      <div className="relative max-w-sm">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input className="input pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by design" />
      </div>
      <section className="space-y-2">
        <h2 className="section-title">Returns and spares, for sale <span className="font-normal text-muted">· {forSale.length}</span></h2>
        <p className="text-xs text-muted">Back from a reseller or a customer, or spare. Sell one with <b>Sell</b>; damaged pieces show their asking price.</p>
        <PieceRows pieces={forSale} canWrite={canWrite} canSell={canSell} onOpen={onOpen} actions={actions} empty="Nothing back from resellers or customers right now." />
      </section>
      <section className="space-y-2">
        <h2 className="section-title">Ready for a shipment <span className="font-normal text-muted">· {ready.length}</span></h2>
        <p className="text-xs text-muted">Finished pieces waiting to go to a reseller. The next handover uses them first.</p>
        <PieceRows pieces={ready} canWrite={canWrite} canSell={canSell} onOpen={onOpen} actions={actions} empty="Nothing waiting for a shipment." />
      </section>
      <button type="button" className="inline-flex items-center gap-1 text-sm font-semibold text-accent" onClick={() => setShowGone((x) => !x)}>
        <ChevronDown size={15} className={`transition ${showGone ? 'rotate-180' : ''}`} />{showGone ? 'Hide' : 'Show'} sold and written off
      </button>
      {showGone && (gone ? <PieceRows pieces={gone.filter(match)} canWrite={false} canSell={false} onOpen={onOpen} actions={[]} empty="Nothing sold or written off yet." /> : <SkeletonRows rows={3} />)}
      <DamagedModal open={!!damaging} count={damaging?.ids.length || 0} onClose={() => setDamaging(null)} onConfirm={damage} />
    </div>
  )
}

// ── Being made: pieces stitched for the next shipment ──────────────────
function MakingTab({ version, canWrite, onOpen, onChanged }) {
  const [pieces, setPieces] = useState(null)
  useEffect(() => { getStockPieces({ status: 'In Production' }).then(setPieces).catch((e) => toast.error(e.message)) }, [version])
  if (!pieces) return <SkeletonRows rows={4} />
  const ready = async (ids, done) => {
    try { const r = await moveStockPieces(ids, 'At Studio', 'Ready'); toast.success(`${r.moved} piece${r.moved === 1 ? '' : 's'} ready`); done(); onChanged() }
    catch (err) { toast.error(err.message) }
  }
  return (
    <div className="space-y-2 pb-20">
      <p className="text-xs text-muted">Tick the pieces that are finished and click <b>Mark ready</b>; they move to Studio stock, ready for the shipment.</p>
      <PieceRows pieces={pieces} canWrite={canWrite} canSell={false} onOpen={onOpen} empty="Nothing being made right now."
        actions={[{ label: 'Mark ready', icon: PackageCheck, primary: true, run: ready }]} />
    </div>
  )
}

// ── Page ────────────────────────────────────────────────────────────────
export default function Inventory() {
  const { can } = useAuth()
  const canWrite = can('inventory:write')
  const canSell = can('orders:write')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('samples')
  const [adding, setAdding] = useState(null)       // single sample for one design
  const [bulk, setBulk] = useState(null)           // { kind, status, source }
  const [piece, setPiece] = useState(null)
  const [version, setVersion] = useState(0)

  const load = useCallback(() => getInventory().then((d) => { setData(d); setError(null) }).catch((e) => setError(e.message)), [])
  useEffect(() => { load() }, [load, version])
  const changed = () => setVersion((v) => v + 1)

  const openSample = async (p, x) => {
    try {
      const list = await getStockPieces({ productId: p.productId, kind: 'Sample', status: STATUSES.join(',') })
      setPiece(list.find((y) => y.id === x.id) || null)
    } catch (err) { toast.error(err.message) }
  }
  const asPicked = (p) => ({ id: p.productId, name: p.product, imageUrl: p.imageUrl, collection: p.collection })
  const samples = data ? data.products.flatMap((p) => p.samples).filter((x) => ['At Studio', 'At Shoot'].includes(x.status)) : []
  const atShoot = samples.filter((x) => x.status === 'At Shoot').length
  const addFor = {
    samples: { label: 'Add samples', icon: Camera, open: () => setBulk({ kind: 'Sample', status: 'At Studio', source: 'Made' }) },
    stock: { label: 'Add pieces', icon: Plus, open: () => setBulk({ kind: 'Stock', status: 'At Studio', source: 'Opening count' }) },
    making: { label: 'Add a batch', icon: Scissors, open: () => setBulk({ kind: 'Stock', status: 'In Production', source: 'Made' }) },
  }[tab]
  const Card = ({ to, children }) => <button type="button" onClick={() => setTab(to)} className={`rounded-2xl text-left transition ${tab === to ? 'ring-2 ring-brand-primary/50' : 'hover:-translate-y-0.5'}`}>{children}</button>

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader eyebrow="Studio" title="Inventory" icon={Boxes} subtitle="What's physically at the studio: shoot samples, pieces for sale, and pieces being made for a shipment"
        actions={canWrite && addFor && <button className="btn-primary" onClick={addFor.open}><addFor.icon size={16} />{addFor.label}</button>} />
      <ErrorBanner onRetry={load}>{error}</ErrorBanner>

      {!data ? <SkeletonCards count={4} /> : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Card to="samples"><StatCard label="Shoot samples" value={samples.length} icon={Camera} tone="plum" sub={atShoot ? `${atShoot} at the shoot` : 'At the studio'} /></Card>
          <Card to="stock"><StatCard label="Studio stock" value={data.stats.atStudio} icon={Warehouse} sub={data.stats.damagedForSale ? `${data.stats.damagedForSale} damaged, for sale` : 'Returns, spares, ready pieces'} /></Card>
          <Card to="making"><StatCard label="Being made" value={data.stats.inProduction} icon={Scissors} tone="orange" sub="For the next shipment" /></Card>
          <StatCard label="At resellers" value={data.stats.atResellers} icon={Store} sub="On each reseller's Stock page" />
        </div>
      )}

      <Segmented value={tab} onChange={setTab} options={[{ value: 'samples', label: 'Samples' }, { value: 'stock', label: 'Studio stock' }, { value: 'making', label: 'Being made' }]} />

      {!data ? <SkeletonRows rows={6} /> : (
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18, ease }}>
            {tab === 'samples' && <SamplesTab data={data} canWrite={canWrite} onOpenSample={openSample} onAddOne={(p) => setAdding({ sample: true, preset: asPicked(p) })} />}
            {tab === 'stock' && <StudioStockTab version={version} canWrite={canWrite} canSell={canSell} onOpen={setPiece} onChanged={changed} />}
            {tab === 'making' && <MakingTab version={version} canWrite={canWrite} onOpen={setPiece} onChanged={changed} />}
          </motion.div>
        </AnimatePresence>
      )}

      <AddPiecesModal open={!!adding} sample={!!adding?.sample} preset={adding?.preset} overview={data} onClose={() => setAdding(null)} onSaved={changed} />
      <PieceModal piece={piece} onClose={() => setPiece(null)} onSaved={changed} canWrite={canWrite} canSell={canSell} />
      <BulkAddModal open={!!bulk} startKind={bulk?.kind} startStatus={bulk?.status} startSource={bulk?.source} onClose={() => setBulk(null)} overview={data} onSaved={changed} />
    </div>
  )
}
