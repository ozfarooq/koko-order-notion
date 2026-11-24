import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { LayoutDashboard, AlertTriangle, CalendarCheck, ArrowRight } from 'lucide-react'
import { getFinanceOverview } from '../../data/finance'
import { PageHeader, SkeletonCards, StatCard, fmtDate } from '../../ui/kit'
import { fmtRs, safePaisa } from './shared'

const rs = (v) => safePaisa(v) / 100
const monthLabel = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

// One screen for the owner: money, what is owed either way, profit, and what needs doing
export default function Overview() {
  const [d, setD] = useState(null)
  useEffect(() => { getFinanceOverview().then(setD).catch((e) => toast.error(e.message)) }, [])
  const todo = d ? [
    d.attention.postingProblems && { to: '/finance/sales', text: `${d.attention.postingProblems} order or reseller posting${d.attention.postingProblems === 1 ? '' : 's'} failed` },
    d.attention.inbox && { to: '/finance/inbox', text: `${d.attention.inbox} receipt${d.attention.inbox === 1 ? '' : 's'} waiting in the inbox` },
    d.attention.claimsWaiting && { to: '/finance/claims', text: `${d.attention.claimsWaiting} studio claim${d.attention.claimsWaiting === 1 ? '' : 's'} to approve` },
    d.attention.bankUnmatched && { to: '/finance/bank', text: `${d.attention.bankUnmatched} bank line${d.attention.bankUnmatched === 1 ? '' : 's'} not matched` },
    ...(d.attention.taxDue || []).map((t) => ({ to: '/finance/tax?tab=calendar', text: `${t.title}: ${t.overdue ? 'overdue since' : 'due'} ${fmtDate(t.dueOn)}` })),
    ...d.attention.monthsToClose.map((m) => ({ to: '/finance/close', text: `${m.name} has ended and is not closed yet` })),
  ].filter(Boolean) : []
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader eyebrow="Finance" title="Overview" icon={LayoutDashboard} subtitle={d ? `As at ${fmtDate(d.asOf)}` : ''} />
      {!d ? <SkeletonCards count={8} /> : <>
        <section className="space-y-2">
          <h2 className="section-title">Money</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Bank and cash" value={rs(d.cashTotal)} prefix="Rs " sub={d.cash.filter((c) => c.code !== '1150').map((c) => `${c.code} ${fmtRs(c.balance, { decimals: false })}`).join(' · ')} />
            <StatCard label="Owed to Koko" value={rs(d.receivables.net)} prefix="Rs " sub={`resellers ${fmtRs(d.receivables.resellers, { decimals: false })} · less allowance ${fmtRs(d.receivables.allowance, { decimals: false })}`} />
            <StatCard label="Koko owes" value={rs(d.payables.total)} prefix="Rs " sub={`suppliers ${fmtRs(d.payables.suppliers, { decimals: false })} · claims ${fmtRs(d.payables.claims, { decimals: false })} · wages ${fmtRs(d.payables.wages, { decimals: false })}`} />
            <StatCard label="Customer advances held" value={rs(d.advances)} prefix="Rs " sub={safePaisa(d.refunds) ? `refunds due ${fmtRs(d.refunds, { decimals: false })}` : 'paid before the order is ready'} />
          </div>
        </section>
        <section className="space-y-2">
          <h2 className="section-title">Profit</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[['This month', d.thisMonth, monthLabel(d.thisMonth.month)], ['Last month', d.lastMonth, monthLabel(d.lastMonth.month)], ['Fiscal year to date', d.yearToDate, `from ${fmtDate(d.yearToDate.from)}`]].map(([label, p, sub]) => (
              <StatCard key={label} label={`${label}: profit`} value={rs(p.profit)} prefix="Rs " tone={safePaisa(p.profit) < 0 ? 'red' : 'default'}
                sub={`${sub} · sales ${fmtRs(p.revenue, { decimals: false })}${p.grossMargin != null ? ` · gross margin ${p.grossMargin}%` : ''}`} />
            ))}
            <StatCard label="Stock (last valuation)" value={rs(d.stock)} prefix="Rs " sub={`directors: Omer ${fmtRs(d.directors.omer, { decimals: false })} · Usman ${fmtRs(d.directors.usman, { decimals: false })}`} />
          </div>
          <p className="text-[11px] text-muted">Profit for a month is complete once that month's entries are run (stock value, depreciation, allowance). Director balances: positive = Koko owes the director.</p>
        </section>
        <section className="space-y-2">
          <h2 className="section-title">Needs attention</h2>
          {todo.length === 0 ? <p className="card px-4 py-3 text-sm text-muted">Nothing waiting.</p> : (
            <div className="card divide-y divide-line">
              {todo.map((t) => (
                <Link key={t.text} to={t.to} className="flex items-center gap-3 px-4 py-2.5 text-sm text-ink hover:bg-subtle2">
                  <AlertTriangle size={15} className="text-amber-600" /><span className="flex-1">{t.text}</span><ArrowRight size={14} className="text-faint" />
                </Link>
              ))}
            </div>
          )}
        </section>
        {d.months.length > 0 && (
          <section className="space-y-2">
            <h2 className="section-title">Months</h2>
            <div className="flex flex-wrap gap-1.5">
              {d.months.map((m) => (
                <Link key={m.month} to="/finance/close" title={m.closedWithOpenItems ? 'Closed with items open' : m.status}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${m.status === 'Open' ? 'text-ink-soft ring-line' : 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300'}`}>
                  {m.name}{m.status !== 'Open' && ` · ${m.status.toLowerCase()}`}
                </Link>
              ))}
              <Link to="/finance/close" className="inline-flex items-center gap-1 px-2 text-xs text-accent"><CalendarCheck size={13} />Month-end close</Link>
            </div>
          </section>
        )}
      </>}
    </div>
  )
}
