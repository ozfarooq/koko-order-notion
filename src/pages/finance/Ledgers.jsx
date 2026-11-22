import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Library } from 'lucide-react'
import { getAccounts, getLedger } from '../../data/finance'
import { PageHeader, SkeletonRows, EmptyState, fmtDate } from '../../ui/kit'
import { AccountSelect } from './shared'
import { PeriodPicker, presetRange, Num, ReportSheet, ExportButtons, periodLabel, n } from './reportKit'

// Quick picks: the books people open most
const QUICK = [['bank_baf', 'Bank Alfalah'], ['cash_studio', 'Petty cash'], ['director_omer', 'Director: Omer'], ['director_usman', 'Director: Usman'], ['customer_advances', 'Customer advances']]

export default function Ledgers() {
  const [params, setParams] = useSearchParams()
  const [accounts, setAccounts] = useState(null)
  const [data, setData] = useState(null)
  const accountId = params.get('account') || ''
  const hasDates = params.get('from') || params.get('to')
  const [period, setPeriod] = useState(hasDates ? { preset: 'custom', from: params.get('from'), to: params.get('to') } : { preset: 'fytd' })
  const range = presetRange(period.preset, period)
  const sheet = useRef(null)

  useEffect(() => { getAccounts().then(setAccounts).catch((e) => toast.error(e.message)) }, [])
  useEffect(() => {
    if (!accountId) { setData(null); return }
    setData(null)
    getLedger(accountId, range).then(setData).catch((e) => toast.error(e.message))
  }, [accountId, range.from, range.to]) // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (id) => setParams({ account: id })
  const byKey = (k) => accounts?.find((a) => a.systemKey === k)
  const rows = () => [['Koko Atelier (Private) Limited'], [`Ledger: ${data.account.code} ${data.account.name}`, periodLabel(range)], [],
    ['Date', 'Entry', 'Memo', 'Description', 'Debit', 'Credit', 'Balance'], ['', '', 'Opening balance', '', '', '', n(data.opening)],
    ...data.lines.map((l) => [l.date, l.entryNo, l.memo, l.description, n(l.debit), n(l.credit), n(l.balance)]),
    ['', '', 'Closing balance', '', n(data.debit), n(data.credit), n(data.closing)]]

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
      <PageHeader eyebrow="Finance" title="Ledgers" icon={Library} subtitle="Every line posted to an account, with the running balance" />
      <div className="flex flex-wrap gap-2">
        {accounts && QUICK.map(([k, label]) => byKey(k) && (
          <button key={k} type="button" onClick={() => pick(byKey(k).id)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${String(byKey(k).id) === accountId ? 'border-brand-primary bg-brand-primary text-white' : 'border-line text-muted hover:text-ink'}`}>{label}</button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[260px] flex-1">{accounts && <AccountSelect accounts={accounts} value={accountId} onChange={(v) => v && pick(v)} />}</div>
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>
      {!accountId ? <EmptyState icon={Library} title="Choose an account" hint="Pick one above, or click any figure in the reports." />
        : !data ? <SkeletonRows rows={8} /> : (
        <>
          <div className="flex justify-end"><ExportButtons sheetRef={sheet} filename={`Ledger ${data.account.code} ${range.from} to ${range.to}`} rows={rows} /></div>
          <ReportSheet ref={sheet} title={`${data.account.code} · ${data.account.name}`} period={periodLabel(range)}>
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr className="border-b border-line text-left font-label text-[10.5px] uppercase tracking-wider text-muted">
                <th className="px-3 py-2 font-medium">Date</th><th className="px-3 py-2 font-medium">Entry</th><th className="px-3 py-2 font-medium">Memo</th>
                <th className="px-3 py-2 text-right font-medium">Debit</th><th className="px-3 py-2 text-right font-medium">Credit</th><th className="px-3 py-2 text-right font-medium">Balance</th></tr></thead>
              <tbody className="divide-y divide-line">
                <tr className="bg-subtle/50"><td className="px-3 py-2 text-ink-soft">{fmtDate(range.from)}</td><td /><td className="px-3 py-2 font-medium text-ink">Opening balance</td><td /><td />
                  <td className="px-3 py-2 text-right"><Num v={data.opening} strong /></td></tr>
                {data.lines.map((l) => (
                  <tr key={l.id} className="hover:bg-subtle/50">
                    <td className="whitespace-nowrap px-3 py-1.5 text-ink-soft">{fmtDate(l.date)}</td>
                    <td className="px-3 py-1.5"><Link to={`/finance/journals/${l.entryId}`} className="font-mono text-xs font-semibold text-accent">{l.entryNo}</Link></td>
                    <td className="max-w-[320px] px-3 py-1.5"><p className="truncate text-ink">{l.memo || '—'}</p>{l.description && <p className="truncate text-xs text-muted">{l.description}</p>}</td>
                    <td className="px-3 py-1.5 text-right">{Number(l.debit) ? <Num v={l.debit} /> : ''}</td>
                    <td className="px-3 py-1.5 text-right">{Number(l.credit) ? <Num v={l.credit} /> : ''}</td>
                    <td className="px-3 py-1.5 text-right"><Num v={l.balance} /></td>
                  </tr>
                ))}
                {data.lines.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted">Nothing posted in this period.</td></tr>}
                <tr className="border-t-2 border-ink/70 font-semibold"><td className="px-3 py-2 text-ink-soft">{fmtDate(range.to)}</td><td /><td className="px-3 py-2 text-ink">Closing balance</td>
                  <td className="px-3 py-2 text-right"><Num v={data.debit} strong /></td><td className="px-3 py-2 text-right"><Num v={data.credit} strong /></td>
                  <td className="px-3 py-2 text-right"><Num v={data.closing} strong /></td></tr>
              </tbody>
            </table>
            <p className="mt-3 text-xs text-muted">Balances are shown on the account's normal side ({data.account.debitNatured ? 'debit' : 'credit'}); a bracketed figure is on the other side.</p>
          </ReportSheet>
        </>
      )}
    </div>
  )
}
