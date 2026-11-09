import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Search, UserPlus, X, Phone, CheckCircle2 } from 'lucide-react'
import { searchCustomers } from '../../data/storage'
import { money, fmtDate } from '../../ui/kit'
import { ease } from '../../ui/motion'

// Find an existing customer by name or phone, or start a new one.
// value: { customerId, customer, phone, email, address, city }
export default function CustomerPicker({ value, onChange, error }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState(null)   // the picked customer record (for its summary)
  const box = useRef(null)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setResults([]); return }
    const t = setTimeout(() => searchCustomers(q).then(setResults).catch(() => setResults([])), 200)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    const onDown = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const pick = (c) => {
    setSelected(c)
    setOpen(false)
    setQuery('')
    onChange({ customerId: c.id, customer: c.name, phone: c.phone || '', email: c.email || '', address: c.address || '', city: c.city || '' })
  }
  const startNew = () => {
    setSelected(null)
    setOpen(false)
    onChange({ customerId: null, customer: query.trim(), phone: /^[+\d\s-]{6,}$/.test(query.trim()) ? query.trim() : '', email: '', address: '', city: '' })
    setQuery('')
  }
  const clear = () => { setSelected(null); onChange({ customerId: null, customer: '', phone: '', email: '', address: '', city: '' }) }

  const linked = !!value.customerId
  return (
    <div ref={box} className="space-y-3">
      {!linked && !value.customer ? (
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            className={`input h-11 pl-9 ${error ? 'border-rose-400' : ''}`}
            placeholder="Search customers by name or phone…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
          />
          <AnimatePresence>
            {open && query.trim().length >= 2 && (
              <motion.div
                initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18, ease }}
                className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-line bg-surface shadow-lift"
              >
                <ul className="max-h-72 overflow-y-auto py-1">
                  {results.map((c) => (
                    <li key={c.id}>
                      <button type="button" onClick={() => pick(c)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-subtle">
                        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-plum-50 font-display text-lg text-plum-600 dark:bg-plum-900/40 dark:text-plum-300">{c.name[0]}</div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-ink">{c.name}</p>
                          <p className="truncate text-xs text-muted">{[c.phone, c.city].filter(Boolean).join(' · ')}</p>
                        </div>
                        <div className="text-right text-[11px] text-faint">
                          <p>{c.orderCount} order{c.orderCount === 1 ? '' : 's'}</p>
                          {c.balance > 0 && <p className="font-semibold text-rose-600">owes {money(c.balance)}</p>}
                        </div>
                      </button>
                    </li>
                  ))}
                  {results.length === 0 && <li className="px-3 py-3 text-sm text-muted">No existing customer matches.</li>}
                </ul>
                <button type="button" onClick={startNew} className="flex w-full items-center gap-2 border-t border-line px-3 py-2.5 text-sm font-semibold text-accent hover:bg-subtle">
                  <UserPlus size={15} /> New customer “{query.trim()}”
                </button>
              </motion.div>
            )}
          </AnimatePresence>
          {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
        </div>
      ) : (
        <motion.div layout initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="flex items-start gap-3 rounded-xl border border-line bg-subtle/60 p-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-plum-700 font-display text-xl text-white">{(value.customer || '?')[0]}</div>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 font-medium text-ink">
              {value.customer || 'New customer'}
              {linked && <CheckCircle2 size={14} className="text-emerald-600" />}
            </p>
            <p className="text-xs text-muted">
              {linked
                ? selected
                  ? `${selected.orderCount} previous order${selected.orderCount === 1 ? '' : 's'}${selected.lastOrder ? ` · last ${fmtDate(selected.lastOrder)}` : ''}${selected.balance > 0 ? ` · owes ${money(selected.balance)}` : ''}`
                  : 'Existing customer'
                : 'Will be added as a new customer'}
            </p>
            {value.phone && <p className="mt-0.5 flex items-center gap-1 text-xs text-muted"><Phone size={11} />{value.phone}</p>}
          </div>
          <button type="button" className="btn-icon" onClick={clear} title="Choose a different customer"><X size={15} /></button>
        </motion.div>
      )}
    </div>
  )
}
