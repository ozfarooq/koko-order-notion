import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  Boxes, Plus, Camera, Scissors, Store, Search, X, Shirt, Minus, Trash2, AlertTriangle, PackageCheck, Warehouse, History,
} from 'lucide-react'
import {
  getInventory, getStockPieces, addStockPieces, updateStockPiece, moveStockPieces, getStockHistory, deleteStockPiece,
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
  if (p.status === 'Sold' && p.orderId) return <Link to={`/orders/${p.orderId}`} className="hover:text-accent hover:underline" onClick={(e) => e.stopPropagation()}>{p.orderNumber}</Link>
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

// ── One piece: edit and history ─────────────────────────────────────────
function PieceModal({ piece, onClose, onSaved, canWrite }) {
  const [form, setForm] = useState(null)
  const [history, setHistory] = useState(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!piece) return
    setForm({ status: piece.status, kind: piece.kind, locationNote: piece.locationNote, notes: piece.notes, orderNumber: piece.orderNumber || '', moveNote: '' })
    setHistory(null)
    getStockHistory(piece.id).then(setHistory).catch(() => setHistory([]))
  }, [piece])
  if (!piece || !form) return null
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const locked = piece.status === 'With Reseller'
  const editable = canWrite && !locked
  const moving = form.status !== piece.status

  const save = async () => {
    if (form.status === 'Damaged' && moving && !form.moveNote.trim()) return toast.error('Say why the piece is damaged or lost')
    setSaving(true)
    try {
      await updateStockPiece(piece.id, { ...form, orderNumber: form.status === 'Sold' ? form.orderNumber : undefined })
      toast.success('Piece updated'); onSaved(); onClose()
    } catch (err) { toast.error(err.message) } finally { setSaving(false) }
  }
  const remove = async () => {
    if (!window.confirm(`Delete this ${piece.product} (${piece.size})? Only for pieces added by mistake.`)) return
    try { await deleteStockPiece(piece.id); toast.success('Piece deleted'); onSaved(); onClose() } catch (err) { toast.error(err.message) }
  }

  return (
    <Modal open={!!piece} onClose={onClose} title={piece.product} subtitle={`${piece.size} · ${piece.kind === 'Sample' ? 'Shoot sample' : 'Stock'} · ${piece.source}${piece.madeOn ? ` · made ${fmtDate(piece.madeOn, { day: 'numeric', month: 'short' })}` : ''}`}
      footer={editable ? <>
        {piece.canDelete && <button className="btn-ghost mr-auto text-rose-600" onClick={remove}><Trash2 size={15} />Delete</button>}
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </> : <button className="btn-primary" onClick={onClose}>Done</button>}>
      <div className="space-y-4 p-5">
        <div className="flex items-center gap-3">
          <Thumb src={piece.imageUrl} className="h-20 w-16" />
          <div className="space-y-1 text-sm">
            <StockPill status={piece.status} />
            {whereabouts(piece) && <p className="text-muted">{whereabouts(piece)}</p>}
          </div>
        </div>
        {locked && <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:bg-sky-950/40 dark:text-sky-200">This piece is with {piece.reseller}. Its status follows the reseller screens: sold, paid or returned there, it updates here.</p>}

        {editable && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status">
              <select className="input" value={form.status} onChange={(e) => set({ status: e.target.value })}>{MANUAL.map((s) => <option key={s}>{s}</option>)}</select>
            </Field>
            <Field label="Kind">
              <select className="input" value={form.kind} onChange={(e) => set({ kind: e.target.value })}><option value="Stock">Stock</option><option value="Sample">Shoot sample</option></select>
            </Field>
            {form.status === 'Sold' && (
              <Field label="Order number" hint="Optional: the customer order it went to">
                <input className="input" value={form.orderNumber} onChange={(e) => set({ orderNumber: e.target.value })} placeholder="SO-000123" />
              </Field>
            )}
            <Field label="Where it is" className={form.status === 'Sold' ? '' : 'sm:col-span-2'}>
              <input className="input" value={form.locationNote} onChange={(e) => set({ locationNote: e.target.value })} placeholder="e.g. With photographer Ali" />
            </Field>
            {moving && (
              <Field label={form.status === 'Damaged' ? 'Reason (required)' : 'Note for this move'} className="sm:col-span-2">
                <input className="input" value={form.moveNote} onChange={(e) => set({ moveNote: e.target.value })} placeholder={form.status === 'Damaged' ? 'e.g. Stain on the front, lost by courier' : 'Optional'} autoFocus={form.status === 'Damaged'} />
              </Field>
            )}
            <Field label="Notes" className="sm:col-span-2"><input className="input" value={form.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
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
  useEffect(() => { if (open) setReason('') }, [open])
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Mark damaged" subtitle={`${count} piece${count === 1 ? '' : 's'} will be written off`}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!reason.trim()} onClick={() => onConfirm(reason.trim())}>Mark damaged</button></>}>
      <div className="p-5"><Field label="Reason"><input autoFocus className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Stain on the front, lost by courier" /></Field></div>
    </Modal>
  )
}

// ── Overview tab ────────────────────────────────────────────────────────
function SizeStrip({ counts }) {
  return (
    <div className="grid grid-cols-5 gap-1 text-center">
      {STOCK_SIZES.map((z) => (
        <div key={z} className="w-9">
          <p className="text-[10px] font-semibold text-faint">{SHORT[z]}</p>
          <p className={`text-sm font-semibold tabular-nums ${counts[z] ? 'text-ink' : 'text-faint/50'}`}>{counts[z] || 0}</p>
        </div>
      ))}
    </div>
  )
}

function SampleBadge({ p, newest }) {
  const live = p.samples.filter((s) => !['Sold', 'Archived'].includes(s.status))
  if (live.length) return <StockPill status={live[0].status} />
  if (p.isActive && p.collectionId === newest) return <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"><AlertTriangle size={11} />No sample</span>
  return <span className="text-xs text-faint">—</span>
}

function OverviewTab({ data, onOpen }) {
  const newest = data.collections[0]?.id ?? null
  const [collection, setCollection] = useState(String(newest ?? 'all'))
  const [showAll, setShowAll] = useState(false)
  const rows = data.products.filter((p) => {
    if (collection !== 'all' && String(p.collectionId ?? 'none') !== collection) return false
    const stocked = p.inProduction || Object.values(p.atStudio).some(Boolean) || p.atResellers.length || p.samples.length
    return showAll || stocked
  })
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <select className="input w-auto" value={collection} onChange={(e) => setCollection(e.target.value)}>
          {data.collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value="none">Separates</option>
          <option value="all">All collections</option>
        </select>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
          <input type="checkbox" className="h-4 w-4 accent-[#E98074]" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />Show outfits with no stock
        </label>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={Boxes} title="No stock in this collection" hint="Turn on “Show outfits with no stock” to see every outfit, or add pieces." />
      ) : (
        <div className="card overflow-hidden">
          <div className="hidden grid-cols-[minmax(0,1fr)_90px_220px_minmax(0,160px)_120px] gap-4 border-b border-line bg-surface-accent px-4 py-2.5 font-label text-[10.5px] font-medium uppercase tracking-wider text-ink md:grid">
            <span>Outfit</span><span className="text-center">Making</span><span>At studio</span><span>At resellers</span><span>Sample</span>
          </div>
          <motion.ul variants={listParent} initial="hidden" animate="show" className="divide-y divide-line">
            {rows.map((p) => (
              <motion.li key={p.productId} variants={listItem}>
                <button type="button" onClick={() => onOpen(p)}
                  className="grid w-full grid-cols-[auto_1fr] gap-x-3 gap-y-2 px-4 py-3 text-left transition hover:bg-subtle/60 md:grid-cols-[minmax(0,1fr)_90px_220px_minmax(0,160px)_120px] md:items-center md:gap-4">
                  <div className="row-span-3 flex items-center gap-3 md:row-span-1">
                    <Thumb src={p.imageUrl} />
                    <div className="hidden min-w-0 md:block"><p className="truncate font-medium text-ink">{p.product}</p><p className="truncate text-xs text-faint">{p.collection || 'Separates'}{p.soldLast30 ? ` · ${p.soldLast30} sold in 30 days` : ''}</p></div>
                  </div>
                  <div className="min-w-0 md:hidden"><p className="truncate font-medium text-ink">{p.product}</p><p className="truncate text-xs text-faint">{p.inProduction ? `${p.inProduction} in production · ` : ''}{p.collection || 'Separates'}</p></div>
                  <p className={`hidden text-center font-semibold tabular-nums md:block ${p.inProduction ? 'text-amber-700 dark:text-amber-300' : 'text-faint/50'}`}>{p.inProduction}</p>
                  <SizeStrip counts={p.atStudio} />
                  <div className="flex flex-wrap items-center gap-1.5">
                    {p.atResellers.map((r) => <span key={r.resellerId} className="whitespace-nowrap rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700 dark:bg-sky-950/50 dark:text-sky-300">{r.name.replace(/^Fashion /, '').split(' ')[0]} {r.count}</span>)}
                    <span className="md:hidden"><SampleBadge p={p} newest={newest} /></span>
                  </div>
                  <div className="hidden md:block"><SampleBadge p={p} newest={newest} /></div>
                </button>
              </motion.li>
            ))}
          </motion.ul>
        </div>
      )}
    </div>
  )
}

// ── Pieces tab ──────────────────────────────────────────────────────────
function PiecesTab({ product, clearProduct, version, onChanged, canWrite, onOpenPiece }) {
  const [statuses, setStatuses] = useState(product ? ['In Production', 'At Studio', 'At Shoot', 'With Reseller'] : DEFAULT_FILTER)
  const [kind, setKind] = useState('')
  const [q, setQ] = useState('')
  const [pieces, setPieces] = useState(null)
  const [error, setError] = useState(null)
  const [picked, setPicked] = useState(new Set())
  const [damaging, setDamaging] = useState(false)

  const load = useCallback(() => {
    getStockPieces({ status: statuses.join(','), kind, productId: product?.productId, q: q.trim() })
      .then((r) => { setPieces(r); setError(null); setPicked((s) => new Set([...s].filter((id) => r.some((p) => p.id === id)))) })
      .catch((e) => setError(e.message))
  }, [statuses, kind, product, q])
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t) }, [load, version]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleStatus = (s) => setStatuses((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]))
  const toggle = (id) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const move = async (status, label, moveNote) => {
    try {
      const r = await moveStockPieces([...picked], status, moveNote)
      toast.success(`${r.moved} piece${r.moved === 1 ? '' : 's'} ${label}`)
      setPicked(new Set()); setDamaging(false); onChanged()
    } catch (err) { toast.error(err.message) }
  }

  return (
    <div className="space-y-3 pb-20">
      <div className="flex flex-wrap items-center gap-2">
        {STATUSES.map((s) => (
          <button key={s} type="button" onClick={() => toggleStatus(s)}
            className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold transition ${statuses.includes(s) ? 'border-brand-primary bg-brand-primary text-white' : 'border-line text-muted hover:text-ink'}`}>{s}</button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input className="input pl-9" placeholder="Search by outfit" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input w-auto" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Stock and samples</option><option value="Stock">Stock only</option><option value="Sample">Samples only</option>
        </select>
        {product && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-plum-50 py-1 pl-3 pr-1.5 text-xs font-semibold text-plum-700 dark:bg-plum-900/40 dark:text-plum-300">
            {product.product}<button type="button" className="rounded-full p-0.5 hover:bg-plum-100 dark:hover:bg-plum-800" onClick={clearProduct} aria-label="Show all outfits"><X size={12} /></button>
          </span>
        )}
      </div>
      <ErrorBanner onRetry={load}>{error}</ErrorBanner>

      {!pieces ? <SkeletonRows rows={5} /> : pieces.length === 0 ? (
        <EmptyState icon={Boxes} title="No pieces" hint={statuses.length ? 'Nothing matches these filters.' : 'Choose at least one status above.'} />
      ) : (
        <div className="card divide-y divide-line overflow-hidden">
          {pieces.map((p) => {
            const selectable = canWrite && p.status !== 'With Reseller'
            const where = whereabouts(p)
            return (
              <div key={p.id} role="button" tabIndex={0} onClick={() => onOpenPiece(p)} onKeyDown={(e) => e.key === 'Enter' && onOpenPiece(p)}
                className={`flex cursor-pointer items-center gap-3 px-3 py-2.5 transition hover:bg-subtle/60 sm:px-4 ${picked.has(p.id) ? 'bg-plum-50/50 dark:bg-plum-900/10' : ''}`}>
                <input type="checkbox" className="h-4 w-4 flex-shrink-0 accent-[#E98074] disabled:opacity-30" disabled={!selectable} checked={picked.has(p.id)}
                  onClick={(e) => e.stopPropagation()} onChange={() => toggle(p.id)} aria-label={`Select ${p.product} ${p.size}`} />
                <Thumb src={p.imageUrl} className="h-12 w-9" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{p.product} <span className="font-normal text-muted">· {SHORT[p.size] || p.size}</span>
                    {p.kind === 'Sample' && <span className="ml-1.5 rounded bg-plum-50 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wider text-plum-700 dark:bg-plum-900/40 dark:text-plum-300">Sample</span>}</p>
                  <p className="truncate text-xs text-faint">{[where && <span key="w">{where}</span>, p.madeOn && `made ${fmtDate(p.madeOn, { day: 'numeric', month: 'short' })}`].filter(Boolean).reduce((a, x, i) => (i ? [...a, ' · ', x] : [x]), [])}</p>
                </div>
                <StockPill status={p.status} />
              </div>
            )
          })}
        </div>
      )}

      <AnimatePresence>
        {picked.size > 0 && (
          <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={{ duration: 0.2, ease }}
            className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface p-2.5 shadow-lift md:bottom-6">
            <span className="px-2 text-sm font-semibold text-ink">{picked.size} selected</span>
            <button className="btn-ghost text-xs" onClick={() => setPicked(new Set())}>Clear</button>
            <div className="ml-auto flex flex-wrap gap-1.5">
              <button className="btn-primary text-xs" onClick={() => move('At Studio', 'marked ready', 'Ready')}><PackageCheck size={14} />Mark ready</button>
              <button className="btn-secondary text-xs" onClick={() => move('At Shoot', 'sent to the shoot')}><Camera size={14} />Send to shoot</button>
              <button className="btn-secondary text-xs" onClick={() => move('At Studio', 'moved to the studio')}><Warehouse size={14} />Move to studio</button>
              <button className="btn-secondary text-xs text-rose-600" onClick={() => setDamaging(true)}><AlertTriangle size={14} />Mark damaged</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <DamagedModal open={damaging} count={picked.size} onClose={() => setDamaging(false)} onConfirm={(reason) => move('Damaged', 'marked damaged', reason)} />
    </div>
  )
}

// ── Samples tab ─────────────────────────────────────────────────────────
function SamplesTab({ data, canWrite, onAdd, onOpenSample }) {
  const newest = data.collections[0]
  const outfits = data.products.filter((p) => p.collectionId === newest?.id && p.isActive)
  if (!newest) return <EmptyState icon={Camera} title="No collections yet" />
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{newest.name} · {outfits.filter((p) => p.samples.length).length} of {outfits.length} outfits have a sample</p>
      <motion.div variants={listParent} initial="hidden" animate="show" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {outfits.map((p) => (
          <motion.div key={p.productId} variants={listItem} className="card overflow-hidden">
            <div className="aspect-[3/4] bg-subtle2">{p.imageUrl ? <img src={p.imageUrl} alt={p.product} loading="lazy" className="h-full w-full object-cover" /> : null}</div>
            <div className="space-y-2 p-3">
              <p className="truncate font-medium text-ink">{p.product}</p>
              {p.samples.length ? p.samples.map((s) => (
                <button key={s.id} type="button" onClick={() => onOpenSample(p, s)} className="block w-full space-y-1 rounded-lg bg-subtle p-2 text-left transition hover:bg-subtle2">
                  <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-muted">{s.size}</span><StockPill status={s.status} /></div>
                  {s.locationNote && <p className="truncate text-xs text-faint">{s.locationNote}</p>}
                </button>
              )) : canWrite ? (
                <button type="button" className="btn-secondary w-full text-xs" onClick={() => onAdd(p)}><Plus size={14} />Add sample</button>
              ) : <p className="text-xs text-amber-700 dark:text-amber-300">No sample yet</p>}
            </div>
          </motion.div>
        ))}
      </motion.div>
    </div>
  )
}

// ── Page ────────────────────────────────────────────────────────────────
export default function Inventory() {
  const { can } = useAuth()
  const canWrite = can('inventory:write')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('overview')
  const [product, setProduct] = useState(null)     // Pieces tab filtered to one outfit
  const [adding, setAdding] = useState(null)       // { sample, preset }
  const [piece, setPiece] = useState(null)
  const [version, setVersion] = useState(0)

  const load = useCallback(() => getInventory().then((d) => { setData(d); setError(null) }).catch((e) => setError(e.message)), [])
  useEffect(() => { load() }, [load, version])
  const changed = () => setVersion((v) => v + 1)

  const openSample = async (p, s) => {
    try {
      const list = await getStockPieces({ productId: p.productId, kind: 'Sample', status: STATUSES.join(',') })
      setPiece(list.find((x) => x.id === s.id) || null)
    } catch (err) { toast.error(err.message) }
  }
  const asPicked = (p) => ({ id: p.productId, name: p.product, imageUrl: p.imageUrl, collection: p.collection })

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader eyebrow="Studio" title="Inventory" icon={Boxes} subtitle="Pieces made ahead of orders: reseller stock and shoot samples"
        actions={canWrite && <>
          <button className="btn-secondary" onClick={() => setAdding({ sample: true })}><Camera size={16} />Add sample</button>
          <button className="btn-primary" onClick={() => setAdding({ sample: false })}><Plus size={16} />Add pieces</button>
        </>} />
      <ErrorBanner onRetry={load}>{error}</ErrorBanner>

      {!data ? <SkeletonCards count={4} /> : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="At studio" value={data.stats.atStudio} icon={Warehouse} sub="Finished stock" />
          <StatCard label="In production" value={data.stats.inProduction} icon={Scissors} tone="orange" sub="Being made" />
          <StatCard label="At resellers" value={data.stats.atResellers} icon={Store} sub="At store, unsold" />
          <StatCard label="Samples out" value={data.stats.samplesOut} icon={Camera} tone="plum" sub="At the shoot or a store" />
        </div>
      )}

      <Segmented value={tab} onChange={setTab} options={[{ value: 'overview', label: 'Overview' }, { value: 'pieces', label: 'Pieces' }, { value: 'samples', label: 'Samples' }]} />

      {!data ? <SkeletonRows rows={6} /> : (
        <AnimatePresence mode="wait">
          <motion.div key={tab + (product?.productId || '')} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18, ease }}>
            {tab === 'overview' && <OverviewTab data={data} onOpen={(p) => { setProduct(p); setTab('pieces') }} />}
            {tab === 'pieces' && <PiecesTab product={product} clearProduct={() => setProduct(null)} version={version} onChanged={changed} canWrite={canWrite} onOpenPiece={setPiece} />}
            {tab === 'samples' && <SamplesTab data={data} canWrite={canWrite} onAdd={(p) => setAdding({ sample: true, preset: asPicked(p) })} onOpenSample={openSample} />}
          </motion.div>
        </AnimatePresence>
      )}

      <AddPiecesModal open={!!adding} sample={!!adding?.sample} preset={adding?.preset} overview={data} onClose={() => setAdding(null)} onSaved={changed} />
      <PieceModal piece={piece} onClose={() => setPiece(null)} onSaved={changed} canWrite={canWrite} />
    </div>
  )
}
