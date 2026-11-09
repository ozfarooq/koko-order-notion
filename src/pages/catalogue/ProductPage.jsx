import { useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { ArrowLeft, ExternalLink, Shirt, Store, ShoppingBag, Tag } from 'lucide-react'
import { getProduct, updateProduct, getCollections } from '../../data/storage'
import StatusBadge from '../../components/StatusBadge'
import { Skeleton, money, fmtDate } from '../../ui/kit'
import { listParent, listItem, ease } from '../../ui/motion'
import { useAuth } from '../../auth/AuthContext'

const SIZE_ORDER = ['X-Small', 'Small', 'Medium', 'Large', 'X-Large', 'Custom', '—']

export default function ProductPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { can } = useAuth()
  const [p, setP] = useState(null)
  const [collections, setCollections] = useState([])

  useEffect(() => {
    setP(null)
    getProduct(id).then(setP).catch(() => { toast.error('Product not found'); navigate('/catalogue') })
    if (can('catalog:write')) getCollections().then(setCollections).catch(() => {})
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (patch, msg) => {
    try { setP(await updateProduct(p.id, patch)); toast.success(msg) } catch (err) { toast.error(err.message) }
  }

  if (!p) return <div className="mx-auto grid max-w-6xl gap-6 p-4 sm:p-6 lg:grid-cols-[360px_1fr] lg:p-8"><Skeleton className="aspect-[3/4]" /><div className="space-y-4"><Skeleton className="h-12 w-72" /><Skeleton className="h-40" /><Skeleton className="h-40" /></div></div>

  const sizes = [...p.sales.bySize].sort((a, b) => SIZE_ORDER.indexOf(a.size) - SIZE_ORDER.indexOf(b.size))
  const maxQty = Math.max(1, ...sizes.map((s) => s.quantity))

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <button className="btn-ghost -ml-2" onClick={() => navigate(-1)}><ArrowLeft size={15} />Back</button>
      <div className="grid gap-8 lg:grid-cols-[380px_1fr]">
        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4, ease }}
          className="overflow-hidden rounded-2xl bg-subtle2 shadow-soft lg:sticky lg:top-6 lg:self-start">
          {p.imageUrl ? <img src={p.imageUrl} alt={p.name} className="aspect-[3/4] w-full object-cover" /> : <div className="flex aspect-[3/4] items-center justify-center text-faint"><Shirt size={48} /></div>}
        </motion.div>

        <motion.div variants={listParent} initial="hidden" animate="show" className="space-y-5">
          <motion.div variants={listItem}>
            {p.collection
              ? <Link to={`/catalogue/collections/${p.collectionId}`} className="eyebrow hover:underline">{p.collection}</Link>
              : <p className="eyebrow">Separates</p>}
            <h1 className="mt-1 text-4xl text-ink sm:text-5xl">{p.name}</h1>
            <div className="mt-3 flex flex-wrap items-baseline gap-3">
              <span className="font-display text-3xl font-semibold text-accent">{money(p.pricePkr)}</span>
              {p.compareAtPkr > p.pricePkr && <span className="text-sm text-faint line-through">{money(p.compareAtPkr)}</span>}
              {!p.isActive && <span className="rounded-full bg-subtle2 px-2 py-0.5 text-xs font-semibold text-muted">Hidden on Shopify</span>}
            </div>
            {p.shopifyUrl && <a href={p.shopifyUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-accent">View on kokoatelier.com <ExternalLink size={12} /></a>}
          </motion.div>

          {can('catalog:write') && (
            <motion.section variants={listItem} className="card flex flex-wrap items-end gap-4 p-4">
              <div className="flex-1">
                <label className="label flex items-center gap-1"><Tag size={11} />Collection</label>
                <select className="input" value={p.collectionId ?? 'none'} onChange={(e) => save({ collectionId: e.target.value }, 'Collection updated')}>
                  <option value="none">Separates (no collection)</option>
                  {collections.filter((c) => c.id !== 'none').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </motion.section>
          )}

          {can('orders:read') && (
            <motion.section variants={listItem} className="card p-5">
              <div className="mb-4 flex items-center gap-2"><ShoppingBag size={15} className="text-gold-500" /><h2 className="section-title flex-1">Retail sales</h2><span className="font-display text-2xl font-semibold text-ink">{p.sales.totalQuantity}</span><span className="text-xs text-muted">pieces</span></div>
              {sizes.length === 0 ? <p className="text-sm text-muted">Not ordered yet.</p> : (
                <div className="space-y-2">
                  {sizes.map((s) => (
                    <div key={s.size} className="flex items-center gap-3 text-sm">
                      <span className="w-20 text-muted">{s.size}</span>
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-subtle2">
                        <motion.div className="h-full rounded-full bg-gradient-to-r from-plum-500 to-gold-400" initial={{ width: 0 }} animate={{ width: `${(s.quantity / maxQty) * 100}%` }} transition={{ duration: 0.7, ease }} />
                      </div>
                      <span className="w-6 text-right font-semibold text-ink">{s.quantity}</span>
                    </div>
                  ))}
                </div>
              )}
              {p.sales.recent.length > 0 && (
                <ul className="mt-5 divide-y divide-line border-t border-line">
                  {p.sales.recent.map((r) => (
                    <li key={r.orderId + r.size}>
                      <Link to={`/orders/${r.orderId}`} className="flex items-center gap-3 py-2.5 text-sm hover:text-accent">
                        <span className="font-mono text-xs font-semibold text-accent">{r.orderNumber}</span>
                        <span className="flex-1 truncate text-ink-soft">{r.customer}</span>
                        <span className="text-xs text-faint">{r.size} · {fmtDate(r.orderDate, { day: 'numeric', month: 'short' })}</span>
                        <StatusBadge status={r.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </motion.section>
          )}

          {can('fc:read') && (
            <motion.section variants={listItem} className="card p-5">
              <div className="mb-3 flex items-center gap-2"><Store size={15} className="text-gold-500" /><h2 className="section-title">At resellers</h2></div>
              {p.resellers.length === 0 ? <p className="text-sm text-muted">Not consigned to any reseller.</p> : (
                <ul className="space-y-3">
                  {p.resellers.map((r) => (
                    <li key={r.id} className="rounded-xl bg-subtle p-3">
                      <div className="flex items-center justify-between">
                        <Link to={`/resellers/${r.id}/stock`} className="font-medium text-ink hover:text-accent">{r.name}</Link>
                        {r.price != null && <span className="text-sm font-semibold text-ink">{r.currency} {r.price.toLocaleString()}</span>}
                      </div>
                      <p className="mt-1 text-xs text-muted">{Object.entries(r.byStatus).map(([s, n]) => `${n} ${s.toLowerCase()}`).join(' · ')}</p>
                      {r.atStoreSizes.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{r.atStoreSizes.map((s, i) => <span key={i} className="rounded bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-ink-soft">{s}</span>)}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </motion.section>
          )}
        </motion.div>
      </div>
    </div>
  )
}
