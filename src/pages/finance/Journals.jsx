import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BookOpen, Plus, Search } from 'lucide-react'
import { getEntries, ENTRY_LABELS } from '../../data/finance'
import { PageHeader, EmptyState, ErrorBanner, SkeletonRows, fmtDate } from '../../ui/kit'
import { FinBadge, fmtRs } from './shared'

// Every journal entry, newest first: manual journals now, system postings from later phases
export default function Journals() {
  const navigate = useNavigate()
  const [entries, setEntries] = useState(null)
  const [error, setError] = useState(null)
  const [f, setF] = useState({ q: '', from: '', to: '', type: '', status: '' })
  const set = (patch) => setF((x) => ({ ...x, ...patch }))

  const load = useCallback(() => {
    getEntries(f).then((r) => { setEntries(r); setError(null) }).catch((e) => setError(e.message))
  }, [f])
  useEffect(() => { const t = setTimeout(load, f.q ? 250 : 0); return () => clearTimeout(t) }, [load]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader eyebrow="Finance" title="Journals" icon={BookOpen} subtitle="Every entry in the books. Posted entries never change; corrections are reversals."
        actions={<button className="btn-primary" onClick={() => navigate('/finance/journals/new')}><Plus size={16} />New journal</button>} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input className="input pl-9" value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder="Entry number, memo, account code or name" />
        </div>
        <input type="date" className="input w-auto" value={f.from} onChange={(e) => set({ from: e.target.value })} aria-label="From" />
        <input type="date" className="input w-auto" value={f.to} onChange={(e) => set({ to: e.target.value })} aria-label="To" />
        <select className="input w-auto" value={f.type} onChange={(e) => set({ type: e.target.value })}>
          <option value="">All types</option>
          {Object.entries(ENTRY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="input w-auto" value={f.status} onChange={(e) => set({ status: e.target.value })}>
          <option value="">Any status</option><option>Draft</option><option>Posted</option><option>Reversed</option>
        </select>
      </div>
      <ErrorBanner onRetry={load}>{error}</ErrorBanner>
      {!entries ? <SkeletonRows rows={6} /> : entries.length === 0 ? (
        <EmptyState icon={BookOpen} title="No entries yet" hint="Post the opening balances from Finance › Settings, or add a journal." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-surface-accent text-left font-label text-[10.5px] uppercase tracking-wider text-ink">
              <tr><th className="px-4 py-2.5 font-medium">Date</th><th className="px-3 py-2.5 font-medium">Entry</th><th className="px-3 py-2.5 font-medium">Type</th>
                <th className="px-3 py-2.5 font-medium">Memo</th><th className="px-3 py-2.5 text-right font-medium">Amount</th><th className="px-4 py-2.5 font-medium">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {entries.map((e) => (
                <tr key={e.id} className="cursor-pointer transition hover:bg-subtle/60" onClick={() => navigate(`/finance/journals/${e.id}`)}>
                  <td className="whitespace-nowrap px-4 py-2.5 text-ink-soft">{fmtDate(e.date)}</td>
                  <td className="px-3 py-2.5"><Link to={`/finance/journals/${e.id}`} className="font-mono text-xs font-semibold text-accent" onClick={(x) => x.stopPropagation()}>{e.entryNo || 'Draft'}</Link></td>
                  <td className="px-3 py-2.5 text-xs text-muted">{ENTRY_LABELS[e.entryType] || e.entryType}</td>
                  <td className="max-w-[340px] truncate px-3 py-2.5 text-ink">{e.memo || <span className="text-faint">—</span>}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums font-semibold text-ink">{fmtRs(e.total)}</td>
                  <td className="px-4 py-2.5"><FinBadge status={e.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
