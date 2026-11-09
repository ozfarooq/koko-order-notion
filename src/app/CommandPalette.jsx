import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Command } from 'cmdk'
import { AnimatePresence, motion } from 'framer-motion'
import { Search, ClipboardList, User, Shirt, CornerDownLeft } from 'lucide-react'
import { search as apiSearch } from '../data/storage'
import { ease } from '../ui/motion'

// Ctrl/⌘+K: jump to any screen, order, customer or product
export default function CommandPalette({ open, setOpen, destinations }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState({ orders: [], customers: [], products: [] })

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOpen])

  // Debounced server search
  useEffect(() => {
    if (query.trim().length < 2) { setResults({ orders: [], customers: [], products: [] }); return }
    const t = setTimeout(() => { apiSearch(query).then(setResults).catch(() => {}) }, 180)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => { if (!open) setQuery('') }, [open])

  const go = (to) => { setOpen(false); navigate(to) }
  const itemCls = 'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-ink-soft aria-selected:bg-plum-50 aria-selected:text-ink dark:aria-selected:bg-plum-900/40'
  const group = '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-faint'

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-start justify-center bg-plum-950/40 p-4 pt-[12vh] backdrop-blur-[2px]"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onMouseDown={() => setOpen(false)}
        >
          <motion.div
            className="w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-surface shadow-lift"
            initial={{ y: -12, scale: 0.98, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }} exit={{ y: -12, scale: 0.98, opacity: 0 }}
            transition={{ duration: 0.22, ease }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <Command shouldFilter={false} label="Search" loop>
              <div className="flex items-center gap-3 border-b border-line px-4">
                <Search size={18} className="text-faint" />
                <Command.Input
                  autoFocus value={query} onValueChange={setQuery}
                  placeholder="Search orders, customers, products or screens…"
                  className="h-14 flex-1 bg-transparent text-[15px] text-ink placeholder:text-faint focus:outline-none"
                />
                <kbd className="hidden rounded border border-line px-1.5 py-0.5 text-[10px] text-faint sm:block">ESC</kbd>
              </div>
              <Command.List className="max-h-[55vh] overflow-y-auto p-2">
                <Command.Empty className="px-3 py-8 text-center text-sm text-muted">No results for “{query}”.</Command.Empty>

                {results.orders.length > 0 && (
                  <Command.Group heading="Orders" className={group}>
                    {results.orders.map((o) => (
                      <Command.Item key={o.id} value={`order-${o.id}`} onSelect={() => go(`/orders/${o.id}`)} className={itemCls}>
                        <ClipboardList size={16} className="text-faint" />
                        <span className="font-mono text-xs font-semibold text-accent">{o.orderNumber}</span>
                        <span className="flex-1 truncate">{o.customer}</span>
                        <span className="text-xs text-faint">{o.status}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
                {results.customers.length > 0 && (
                  <Command.Group heading="Customers" className={group}>
                    {results.customers.map((c) => (
                      <Command.Item key={c.id} value={`cust-${c.id}`} onSelect={() => go(`/customers/${c.id}`)} className={itemCls}>
                        <User size={16} className="text-faint" />
                        <span className="flex-1 truncate">{c.name}</span>
                        <span className="text-xs text-faint">{c.phone}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
                {results.products.length > 0 && (
                  <Command.Group heading="Products" className={group}>
                    {results.products.map((p) => (
                      <Command.Item key={p.id} value={`prod-${p.id}`} onSelect={() => go(`/catalogue/products/${p.id}`)} className={itemCls}>
                        {p.imageUrl ? <img src={p.imageUrl} alt="" className="h-7 w-7 rounded object-cover" /> : <Shirt size={16} className="text-faint" />}
                        <span className="flex-1 truncate">{p.name}</span>
                        <span className="text-xs text-faint">{p.collection}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                <Command.Group heading="Go to" className={group}>
                  {destinations
                    .filter((d) => !query || d.label.toLowerCase().includes(query.toLowerCase()))
                    .map((d) => (
                      <Command.Item key={d.to} value={`nav-${d.to}`} onSelect={() => go(d.to)} className={itemCls}>
                        <d.icon size={16} className="text-faint" />
                        <span className="flex-1">{d.label}</span>
                        <CornerDownLeft size={13} className="text-faint" />
                      </Command.Item>
                    ))}
                </Command.Group>
              </Command.List>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
