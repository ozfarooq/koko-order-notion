import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { Shirt, Search, Upload, ArrowLeft, FileSpreadsheet } from 'lucide-react'
import { getCollections, getProducts, importCatalogue } from '../../data/storage'
import { PageHeader, Skeleton, EmptyState, Modal, money } from '../../ui/kit'
import { listParent, listItem } from '../../ui/motion'
import { useAuth } from '../../auth/AuthContext'

const range = (a, b) => (a == null ? '' : a === b ? money(a) : `${money(a)} – ${Number(b).toLocaleString()}`)

export function ProductCard({ p }) {
  return (
    <motion.div variants={listItem}>
      <Link to={`/catalogue/products/${p.id}`} className="group block overflow-hidden rounded-xl border border-line bg-surface transition hover:-translate-y-0.5 hover:shadow-lift">
        <div className="relative aspect-[3/4] overflow-hidden bg-subtle2">
          {p.imageUrl ? <img src={p.imageUrl} alt={p.name} loading="lazy" className="h-full w-full object-cover transition duration-700 group-hover:scale-105" />
            : <div className="flex h-full items-center justify-center text-faint"><Shirt size={32} /></div>}
          {!p.isActive && <span className="absolute left-2 top-2 rounded-full bg-plum-950/80 px-2 py-0.5 text-[10px] font-semibold text-white">Hidden on Shopify</span>}
        </div>
        <div className="p-3">
          <p className="truncate font-display text-lg font-semibold text-ink">{p.name}</p>
          <p className="text-xs font-semibold text-accent">{money(p.pricePkr)}</p>
        </div>
      </Link>
    </motion.div>
  )
}

// Shopify "Products → Export → CSV" → one entry per handle
async function parseShopifyCsv(file) {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(await file.text(), { type: 'string' })
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
  if (!rows.length || !('Handle' in rows[0])) throw new Error("This doesn't look like a Shopify products export (no Handle column)")
  const byHandle = new Map()
  for (const r of rows) {
    if (!r.Handle) continue
    const p = byHandle.get(r.Handle) || { handle: r.Handle }
    if (r.Title) Object.assign(p, { title: r.Title, tags: r.Tags, status: r.Status || 'active' })
    if (p.pricePkr == null && r['Variant Price'] !== '') Object.assign(p, { pricePkr: Number(r['Variant Price']) || null, compareAtPkr: Number(r['Variant Compare At Price']) || null })
    if (!p.imageUrl && r['Image Src'] && (r['Image Position'] === 1 || r['Image Position'] === '1' || !p.imageUrl)) p.imageUrl = r['Image Src']
    byHandle.set(r.Handle, p)
  }
  return [...byHandle.values()].filter((p) => p.title)
}

function ImportModal({ open, onClose, onDone }) {
  const [parsed, setParsed] = useState(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  useEffect(() => { if (open) { setParsed(null); setResult(null) } }, [open])
  const choose = async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    try { setParsed(await parseShopifyCsv(f)) } catch (err) { toast.error(err.message) }
  }
  const run = async () => {
    setBusy(true)
    try {
      const r = await importCatalogue(parsed)
      setResult(r)
      toast.success(`Catalogue updated · ${r.updated} updated, ${r.added.length} added`)
      onDone()
    } catch (err) { toast.error(err.message) } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title="Refresh from Shopify" subtitle="Shopify Admin → Products → Export → All products (CSV)" size="md"
      footer={result ? <button className="btn-primary" onClick={onClose}>Done</button>
        : <><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={run} disabled={!parsed || busy}><Upload size={15} />{busy ? 'Importing…' : 'Import'}</button></>}>
      <div className="space-y-4 p-5">
        {!result && (
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-line px-4 py-8 text-sm text-muted transition hover:border-plum-300 hover:text-accent">
            <FileSpreadsheet size={26} />
            {parsed ? <span className="font-semibold text-ink">{parsed.length} products ready to import</span> : 'Choose the products_export.csv file'}
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={choose} />
          </label>
        )}
        {parsed && !result && <p className="text-xs text-muted">Existing products (same Shopify handle) get their name, price, photo and visibility refreshed. New products are added; a matching tag puts them in a collection, otherwise you can set it on the product page.</p>}
        {result && (
          <div className="space-y-2 text-sm">
            <p className="text-ink">{result.updated} products updated · {result.added.length} added</p>
            {result.added.length > 0 && <p className="text-muted">New: {result.added.join(', ')}</p>}
            {result.skipped.length > 0 && <p className="text-rose-600">Skipped: {result.skipped.join('; ')}</p>}
          </div>
        )}
      </div>
    </Modal>
  )
}

export default function Catalogue() {
  const { collectionId } = useParams()
  const navigate = useNavigate()
  const { can } = useAuth()
  const [collections, setCollections] = useState(null)
  const [products, setProducts] = useState(null)
  const [query, setQuery] = useState('')
  const [importing, setImporting] = useState(false)

  const load = () => {
    getCollections().then(setCollections).catch(() => setCollections([]))
    getProducts().then(setProducts).catch(() => setProducts([]))
  }
  useEffect(load, [])

  const current = collectionId ? collections?.find((c) => String(c.id) === collectionId) : null
  const shown = useMemo(() => {
    if (!products) return null
    const q = query.trim().toLowerCase()
    return products.filter((p) =>
      (!collectionId || (collectionId === 'none' ? !p.collection : p.collection === current?.name)) &&
      (!q || p.name.toLowerCase().includes(q) || (p.collection || '').toLowerCase().includes(q)))
  }, [products, query, collectionId, current])

  const showGrid = collectionId || query.trim()

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        eyebrow={collectionId ? 'Collection' : 'Retail'}
        title={collectionId ? current?.name || '…' : 'Catalogue'}
        subtitle={collectionId ? (current ? `${current.products} pieces · ${range(current.minPrice, current.maxPrice)}` : '') : `${products?.length ?? '…'} products in ${collections ? collections.length : '…'} collections · from Shopify`}
        icon={Shirt}
        actions={<>
          {collectionId && <button className="btn-secondary" onClick={() => navigate('/catalogue')}><ArrowLeft size={14} />All collections</button>}
          {can('catalog:write') && !collectionId && <button className="btn-secondary" onClick={() => setImporting(true)}><Upload size={14} />Refresh from Shopify</button>}
        </>}
      />

      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input className="input h-11 pl-9" placeholder={collectionId ? `Search in ${current?.name || 'collection'}` : 'Search all products'} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {!showGrid ? (
        !collections ? <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="aspect-[4/5]" />)}</div> : (
          <motion.div variants={listParent} initial="hidden" animate="show" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {collections.map((c) => (
              <motion.div key={c.id} variants={listItem}>
                <Link to={`/catalogue/collections/${c.id}`} className="group relative block aspect-[4/5] overflow-hidden rounded-2xl bg-plum-950 shadow-soft">
                  {c.cover && <img src={c.cover} alt="" loading="lazy" className="h-full w-full object-cover opacity-90 transition duration-700 group-hover:scale-105 group-hover:opacity-100" />}
                  <div className="absolute inset-0 bg-gradient-to-t from-plum-950/90 via-plum-950/20 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 p-4">
                    <div className="mb-2 h-px w-10 bg-gold-400" />
                    <p className="font-display text-2xl font-semibold leading-tight text-white">{c.name}</p>
                    <p className="text-xs text-white/70">{c.products} pieces · {range(c.minPrice, c.maxPrice)}</p>
                  </div>
                </Link>
              </motion.div>
            ))}
          </motion.div>
        )
      ) : !shown ? <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">{Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="aspect-[3/4]" />)}</div>
        : shown.length === 0 ? <EmptyState icon={Shirt} title="No products found" hint="Try another name." />
        : (
          <motion.div key={`${collectionId}-${query}`} variants={listParent} initial="hidden" animate="show" className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {shown.map((p) => <ProductCard key={p.id} p={p} />)}
          </motion.div>
        )}

      <ImportModal open={importing} onClose={() => setImporting(false)} onDone={load} />
    </div>
  )
}
