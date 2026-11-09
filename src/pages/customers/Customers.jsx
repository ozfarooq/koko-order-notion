import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Contact, Search, Users, Wallet, Repeat, TrendingUp } from 'lucide-react'
import { getCustomers } from '../../data/storage'
import { PageHeader, StatCard, SkeletonCards, SkeletonRows, EmptyState, ErrorBanner, Segmented, money, fmtDate } from '../../ui/kit'
import { listParent, listItem } from '../../ui/motion'

const SORTS = [
  { value: 'recent', label: 'Recent' }, { value: 'spend', label: 'Top spend' },
  { value: 'balance', label: 'Owes most' }, { value: 'orders', label: 'Most orders' }, { value: 'name', label: 'A–Z' },
]

export function Avatar({ name, size = 'md' }) {
  const s = size === 'lg' ? 'h-16 w-16 text-3xl' : 'h-10 w-10 text-lg'
  return <div className={`flex flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-plum-600 to-plum-800 font-display text-white ${s}`}>{(name || '?').trim()[0]?.toUpperCase()}</div>
}

export default function Customers() {
  const navigate = useNavigate()
  const [customers, setCustomers] = useState(null)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('recent')

  useEffect(() => {
    const t = setTimeout(() => {
      getCustomers({ q: query, sort }).then((c) => { setCustomers(c); setError(null) }).catch((e) => setError(e.message))
    }, query ? 200 : 0)
    return () => clearTimeout(t)
  }, [query, sort])

  const stats = useMemo(() => {
    const list = customers || []
    return {
      total: list.length,
      repeat: list.filter((c) => c.orderCount > 1).length,
      owing: list.filter((c) => c.balance > 0),
      spend: list.reduce((s, c) => s + c.totalSpend, 0),
    }
  }, [customers])

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader eyebrow="Retail" title="Customers" icon={Contact} subtitle="Everyone who has ordered from Koko Atelier" />

      {!customers ? <SkeletonCards /> : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label={query ? 'Matching customers' : 'Customers'} value={stats.total} icon={Users} />
          <StatCard label="Repeat customers" value={stats.repeat} tone="plum" icon={Repeat} sub={stats.total ? `${Math.round((stats.repeat / stats.total) * 100)}% came back` : undefined} />
          <StatCard label="Owe a balance" value={stats.owing.length} tone="red" icon={Wallet} sub={money(stats.owing.reduce((s, c) => s + c.balance, 0))} />
          <StatCard label="Lifetime spend" value={stats.spend} prefix="PKR " tone="gold" icon={TrendingUp} />
        </div>
      )}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input className="input pl-9" placeholder="Search by name, phone, city or email" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"><Segmented options={SORTS} value={sort} onChange={setSort} /></div>
      </div>

      <ErrorBanner>{error}</ErrorBanner>

      {!customers ? <SkeletonRows rows={8} /> : customers.length === 0 ? (
        <EmptyState icon={Contact} title="No customers found" hint="Try a different name or phone number." />
      ) : (
        <div className="card overflow-hidden">
          <table className="hidden w-full md:table">
            <thead><tr className="bg-subtle/70">{['Customer', 'Contact', 'Orders', 'Spend', 'Balance', 'Last order'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <motion.tbody variants={listParent} initial="hidden" animate="show" className="divide-y divide-line">
              {customers.map((c) => (
                <motion.tr key={c.id} variants={listItem} onClick={() => navigate(`/customers/${c.id}`)} className="cursor-pointer transition hover:bg-plum-50/50 dark:hover:bg-plum-900/20">
                  <td className="td"><div className="flex items-center gap-3"><Avatar name={c.name} /><div className="min-w-0"><p className="truncate font-medium text-ink">{c.name}</p>{c.references.length > 0 && <p className="truncate text-[11px] text-faint">{c.references.join(', ')}</p>}</div></div></td>
                  <td className="td text-xs"><p>{c.phone || '—'}</p><p className="text-faint">{c.city}</p></td>
                  <td className="td font-semibold text-ink">{c.orderCount}</td>
                  <td className="td whitespace-nowrap font-medium text-ink">{money(c.totalSpend)}</td>
                  <td className={`td whitespace-nowrap font-semibold ${c.balance > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-faint'}`}>{c.balance > 0 ? money(c.balance) : '—'}</td>
                  <td className="td whitespace-nowrap">{fmtDate(c.lastOrder)}</td>
                </motion.tr>
              ))}
            </motion.tbody>
          </table>
          <div className="divide-y divide-line md:hidden">
            {customers.map((c) => (
              <button key={c.id} onClick={() => navigate(`/customers/${c.id}`)} className="flex w-full items-center gap-3 p-4 text-left active:bg-subtle">
                <Avatar name={c.name} />
                <div className="min-w-0 flex-1"><p className="truncate font-medium text-ink">{c.name}</p><p className="truncate text-xs text-muted">{[c.phone, c.city].filter(Boolean).join(' · ')}</p></div>
                <div className="text-right text-xs"><p className="font-semibold text-ink">{money(c.totalSpend)}</p><p className={c.balance > 0 ? 'font-semibold text-rose-600' : 'text-faint'}>{c.balance > 0 ? `owes ${money(c.balance)}` : `${c.orderCount} order${c.orderCount === 1 ? '' : 's'}`}</p></div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
