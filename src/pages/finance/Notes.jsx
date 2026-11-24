import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { FileText, FileDown, Pencil } from 'lucide-react'
import { getNotesPack, getPeriods } from '../../data/finance'
import { PageHeader, SkeletonRows, fmtDate } from '../../ui/kit'
import { ReportSheet, Num } from './reportKit'
import { downloadElementPdf } from '../../utils/statementPdf'

// The notes that go with the year's statements (for the accountant and auditor)
export default function Notes() {
  const [params, setParams] = useSearchParams()
  const [years, setYears] = useState([])
  const [d, setD] = useState(null)
  const sheet = useRef(null)
  const fy = params.get('fy') || ''
  useEffect(() => { getPeriods().then((ps) => setYears([...new Set(ps.map((p) => p.fiscalYear))].filter((y) => y !== '2098-99'))).catch(() => {}) }, [])
  useEffect(() => { setD(null); getNotesPack(fy ? { fy } : {}).then(setD).catch((e) => toast.error(e.message)) }, [fy])
  const pdf = async () => { try { await downloadElementPdf(sheet.current, `Koko notes FY ${d.fiscalYear}.pdf`) } catch (err) { toast.error(err.message) } }
  let n = 0
  const H = (title) => <h3 className="mt-6 font-display text-lg font-semibold text-ink">{++n}. {title}</h3>   // called, not rendered, so numbering runs once per render
  const T = ({ head, rows, foot }) => (
    <table className="mt-2 w-full text-sm">
      <thead className="text-left text-[11px] uppercase tracking-wider text-muted"><tr>{head.map((h, i) => <th key={i} className={`py-1.5 ${i ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
      <tbody className="divide-y divide-line">{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={`py-1.5 ${j ? 'text-right' : 'text-ink'}`}>{j && typeof c === 'string' && /^-?\d+\.\d{2}$/.test(c) ? <Num v={c} /> : c}</td>)}</tr>)}</tbody>
      {foot && <tfoot><tr className="border-t border-ink/30 font-semibold">{foot.map((c, j) => <td key={j} className={`py-1.5 ${j ? 'text-right' : ''}`}>{j && typeof c === 'string' ? <Num v={c} strong /> : c}</td>)}</tr></tfoot>}
    </table>
  )
  const sum = (rows, k) => (rows.reduce((s, r) => s + Math.round(Number(r[k]) * 100), 0) / 100).toFixed(2)
  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6 lg:p-8">
      <PageHeader eyebrow="Finance" title="Notes pack" icon={FileText} subtitle="Notes to the financial statements, for the accountant and the auditor" />
      <div className="flex flex-wrap items-center gap-2">
        <select className="input w-auto" value={fy || d?.fiscalYear || ''} onChange={(e) => setParams({ fy: e.target.value })} aria-label="Fiscal year">{years.map((y) => <option key={y} value={y}>FY {y}</option>)}</select>
        <div className="flex-1" />
        <Link className="btn-secondary" to="/finance/settings"><Pencil size={15} />Edit policies</Link>
        <button className="btn-secondary" onClick={pdf} disabled={!d}><FileDown size={15} />PDF</button>
      </div>
      {!d ? <SkeletonRows rows={12} /> : (
        <ReportSheet ref={sheet} title={`Notes to the financial statements, FY ${d.fiscalYear}`} period={`${fmtDate(d.from)} to ${fmtDate(d.to)}${d.to < `${Number(d.fiscalYear.slice(0, 4)) + 1}-06-30` ? ' (year not yet ended)' : ''}`}>
          {H('Accounting policies')}
          {d.policiesAreDefault && <p className="text-[11px] text-faint">Standard wording from the settings; edit it in Finance settings.</p>}
          {d.policies.split(/\n\n+/).map((p, i) => <p key={i} className="mt-2 text-sm leading-relaxed text-ink-soft">{p}</p>)}

          {H('Property, plant and equipment')}
          <T head={['', ...d.ppe.map((p) => p.label), 'Total']} rows={[
            ['Cost at the start', ...d.ppe.map((p) => p.costOpen), sum(d.ppe, 'costOpen')], ['Additions', ...d.ppe.map((p) => p.additions), sum(d.ppe, 'additions')],
            ['Disposals', ...d.ppe.map((p) => p.costDisposals), sum(d.ppe, 'costDisposals')], ['Cost at the end', ...d.ppe.map((p) => p.costClose), sum(d.ppe, 'costClose')],
            ['Depreciation at the start', ...d.ppe.map((p) => p.depOpen), sum(d.ppe, 'depOpen')], ['Charge for the year', ...d.ppe.map((p) => p.charge), sum(d.ppe, 'charge')],
            ['On disposals', ...d.ppe.map((p) => p.depDisposals), sum(d.ppe, 'depDisposals')], ['Depreciation at the end', ...d.ppe.map((p) => p.depClose), sum(d.ppe, 'depClose')],
          ]} foot={['Carrying amount at the end', ...d.ppe.map((p) => p.carryingClose), sum(d.ppe, 'carryingClose')]} />

          {H('Inventories')}
          <T head={['', 'Start', 'End']} rows={d.inventories.map((r) => [`${r.code} ${r.name}`, r.opening, r.closing])} foot={['Total', sum(d.inventories, 'opening'), sum(d.inventories, 'closing')]} />
          <p className="mt-1 text-[11px] text-faint">At cost from the cost cards, damaged pieces at the lower of cost and expected selling price; valued at each month end.</p>

          {H('Trade receivables and credit losses')}
          {d.receivables ? <>
            <T head={['Age', 'Owed', 'Loss rate', 'Allowance']} rows={d.receivables.buckets.map((b) => [b.label, b.owed, `${b.rate}%`, b.allowance])}
              foot={['Total', sum(d.receivables.buckets, 'owed'), '', d.receivables.target]} />
            <p className="mt-1 text-[11px] text-faint">Aged at {fmtDate(d.receivables.asOf)}. Allowance booked {d.receivables.allowance}.</p>
          </> : <p className="text-sm text-muted">No receivables.</p>}

          {H('Trade and other payables')}
          <T head={['', 'Start', 'End']} rows={d.payables.map((r) => [`${r.code} ${r.name}`, r.opening, r.closing])} foot={['Total', sum(d.payables, 'opening'), sum(d.payables, 'closing')]} />

          {H('Contract liabilities (customer advances)')}
          <T head={['', 'Start', 'Received', 'Recognised / refunded', 'End']} rows={d.contractLiabilities.map((r) => [`${r.code} ${r.name}`, r.opening, r.increase, r.decrease, r.closing])} />

          {H('Provisions and contingencies')}
          {d.provisions.length === 0 ? <p className="text-sm text-muted">None.</p> : d.provisions.map((p) => (
            <div key={p.name} className="mt-2 text-sm"><p className="font-medium text-ink">{p.name}{p.kind === 'provision' ? `: ${p.balance}` : ' (contingent liability, not recognised)'}</p>{p.disclosure && <p className="text-ink-soft">{p.disclosure}</p>}</div>
          ))}

          {H('Related parties')}
          <p className="text-sm text-ink-soft">The directors, Omer Farooq and Usman, are related parties. Their current accounts (positive: owed by Koko to the director):</p>
          <T head={['', 'Start', 'Paid in / owed', 'Repaid / drawn', 'End']} rows={d.relatedParties.directors.map((r) => [r.name, r.opening, r.increase, r.decrease, r.closing])} />
          {d.relatedParties.suppliers.length > 0 && <T head={['Related supplier', 'Bills', 'Spent']} rows={d.relatedParties.suppliers.map((s) => [s.name, String(s.bills), s.spent])} />}

          {H('Revenue')}
          <div className="grid gap-6 sm:grid-cols-2">
            <T head={['By channel', 'Amount']} rows={d.revenueByChannel.map((r) => [`${r.code} ${r.name}`, r.amount])} foot={['Total', sum(d.revenueByChannel, 'amount')]} />
            <T head={['By country', 'Amount']} rows={d.revenueByCountry.map((r) => [r.country, r.amount])} foot={['Total', sum(d.revenueByCountry, 'amount')]} />
          </div>

          {H('Journals in the adjustment period')}
          {d.adjustmentJournals.length === 0 ? <p className="text-sm text-muted">None.</p>
            : <T head={['Entry', 'Date', 'Memo', 'Amount']} rows={d.adjustmentJournals.map((e) => [<Link key={e.id} className="font-mono text-xs text-accent" to={`/finance/journals/${e.id}`}>{e.entryNo}</Link>, fmtDate(e.date), e.memo, e.total])} />}
          {d.balanced === false && <p className="mt-6 text-sm font-semibold text-rose-700">The statement of financial position does not balance at {fmtDate(d.to)}: check the trial balance.</p>}
        </ReportSheet>
      )}
    </div>
  )
}
