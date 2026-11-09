import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Search, Shirt } from 'lucide-react'
import { getProducts } from '../../data/storage'
import { Modal, Skeleton, money } from '../../ui/kit'
import { listParent, listItem } from '../../ui/motion'

// Photo grid of the Shopify catalogue, filterable by collection
export default function ProductPicker({ open, onClose, onPick }) {
  const [products, setProducts] = useState(null)
  const [query, setQuery] = useState('')
  const [collection, setCollection] = useState('all')

  useEffect(() => { if (open && !products) getProducts().then(setProducts).catch(() => setProducts([])) }, [open, products])
  useEffect(() => { if (open) setQuery('') }, [open])

  const collections = useMemo(() => [...new Set((products || []).map((p) => p.collection).filter(Boolean))].sort(), [products])
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (products || []).filter((p) =>
      (collection === 'all' || (collection === 'none' ? !p.collection : p.collection === collection)) &&
      (!q || p.name.toLowerCase().includes(q) || (p.collection || '').toLowerCase().includes(q)))
  }, [products, query, collection])

  return (
    <Modal open={open} onClose={onClose} title="Add a product" subtitle="From the Koko Atelier catalogue (Shopify)" size="xl">
      <div className="space-y-3 border-b border-line p-4">
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input autoFocus className="input h-11 pl-9" placeholder="Search products or collections" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {[{ v: 'all', l: 'All' }, ...collections.map((c) => ({ v: c, l: c })), { v: 'none', l: 'Separates' }].map((c) => (
            <button key={c.v} type="button" onClick={() => setCollection(c.v)}
              className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold transition ${collection === c.v ? 'border-brand-primary bg-brand-primary text-white' : 'border-line text-muted hover:text-ink'}`}>
              {c.l}
            </button>
          ))}
        </div>
      </div>
      <div className="p-4">
        {!products ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="aspect-[3/4]" />)}</div>
        ) : visible.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">No products match.</p>
        ) : (
          <motion.div variants={listParent} initial="hidden" animate="show" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {visible.map((p) => (
              <motion.button key={p.id} variants={listItem} type="button" onClick={() => onPick(p)}
                className="group overflow-hidden rounded-xl border border-line bg-surface text-left transition hover:-translate-y-0.5 hover:border-plum-300 hover:shadow-lift">
                <div className="aspect-[3/4] overflow-hidden bg-subtle2">
                  {p.imageUrl
                    ? <img src={p.imageUrl} alt={p.name} loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
                    : <div className="flex h-full items-center justify-center text-faint"><Shirt size={28} /></div>}
                </div>
                <div className="p-2.5">
                  <p className="truncate text-sm font-medium text-ink">{p.name}</p>
                  <p className="truncate text-[11px] text-faint">{p.collection || 'Separates'}</p>
                  <p className="mt-0.5 text-xs font-semibold text-accent">{money(p.pricePkr)}</p>
                </div>
              </motion.button>
            ))}
          </motion.div>
        )}
      </div>
    </Modal>
  )
}
