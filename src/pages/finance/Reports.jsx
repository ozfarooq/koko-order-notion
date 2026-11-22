import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { BarChart3, CheckCircle2, AlertTriangle, ChevronDown, Info } from 'lucide-react'
import { getReport, TYPE_LABELS } from '../../data/finance'
import { PageHeader, Segmented, SkeletonRows, fmtDate } from '../../ui/kit'
import { PeriodPicker, presetRange, Num, AccountLink, ReportSheet, ExportButtons, periodLabel, amt, isZero, n, fyStartOf } from './reportKit'

const TABS = [['tb', 'Trial balance'], ['pl', 'Profit or loss'], ['bs', 'Financial position'], ['cf', 'Cash flows'], ['eq', 'Changes in equity']]
const Banner = ({ ok, good, bad }) => (
  <p className={`mb-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm print:hidden ${ok ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'}`}>
    {ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}{ok ? good : bad}
  </p>
)
const th = 'px-3 py-2 text-right font-label text-[10.5px] font-medium uppercase tracking-wider text-muted'

// A statement line that opens to show its accounts
function Group({ name, value, compare, accounts, compareAccounts, range, indent }) {
  const [open, setOpen] = useState(false)
  const cmp = (id) => compareAccounts?.find((a) => a.id === id)?.amount
  return (
    <>
      <tr className="cursor-pointer hover:bg-subtle/50" onClick={() => setOpen((o) => !o)}>
        <td className={`py-1.5 pr-3 text-ink ${indent ? 'pl-6' : 'pl-3'}`}>{accounts?.length > 0 && <ChevronDown data-pdf-hide size={13} className={`mr-1 inline transition ${open ? '' : '-rotate-90'} text-faint`} />}{name}</td>
        <td className="px-3 py-1.5 text-right"><Num v={value} /></td>
        {compare !== undefined && <td className="px-3 py-1.5 text-right"><Num v={compare} /></td>}
      </tr>
      {open && accounts.map((a) => (
        <tr key={a.id ?? a.name} className="text-xs">
          <td className={`py-1 pr-3 ${indent ? 'pl-12' : 'pl-9'}`}><AccountLink a={a} range={range} /></td>
          <td className="px-3 py-1 text-right"><Num v={a.amount} /></td>
          {compare !== undefined && <td className="px-3 py-1 text-right"><Num v={cmp(a.id) ?? '0'} /></td>}
        </tr>
      ))}
    </>
  )
}
const Total = ({ label, value, compare, double }) => (
  <tr className={`font-semibold ${double ? 'border-y-2 border-ink/70' : 'border-t border-line'}`}>
    <td className="py-2 pl-3 pr-3 text-ink">{label}</td>
    <td className="px-3 py-2 text-right"><Num v={value} strong /></td>
    {compare !== undefined && <td className="px-3 py-2 text-right"><Num v={compare} strong /></td>}
  </tr>
)

// ── Trial balance ──────────────────────────────────────────────────────
function TrialBalance({ d, range, sheet }) {
  const [hideZero, setHideZero] = useState(true)
  const shown = d.accounts.filter((a) => !hideZero || a.hasActivity)
  const rows = () => [['Koko Atelier (Private) Limited'], ['Trial balance', periodLabel(range)], [],
    ['Code', 'Account', 'Opening', 'Debit', 'Credit', 'Closing debit', 'Closing credit'],
    ...shown.map((a) => [a.code, a.name, n(a.opening), n(a.debit), n(a.credit), n(a.closingDebit), n(a.closingCredit)]),
    ['', 'Total', '', n(d.totals.debit), n(d.totals.credit), n(d.totals.closingDebit), n(d.totals.closingCredit)]]
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted"><input type="checkbox" className="h-4 w-4 accent-[#7B2D45]" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} />Hide accounts with no activity</label>
        <ExportButtons sheetRef={sheet} filename={`Trial balance ${range.to}`} rows={rows} />
      </div>
      <ReportSheet ref={sheet} title="Trial balance" period={periodLabel(range)}>
        <Banner ok={d.balanced} good="Balanced: debits equal credits" bad={`Not balanced: difference ${amt(d.difference)}`} />
        <table className="w-full min-w-[760px] text-sm">
          <thead><tr className="border-b border-line"><th className={`${th} text-left`}>Account</th><th className={th}>Opening</th><th className={th}>Debit</th><th className={th}>Credit</th><th className={th}>Closing Dr</th><th className={th}>Closing Cr</th></tr></thead>
          <tbody>
            {Object.entries(TYPE_LABELS).map(([type, label]) => {
              const list = shown.filter((a) => a.type === type)
              if (!list.length) return null
              return [
                <tr key={type}><td colSpan={6} className="pb-1 pl-3 pt-3 font-label text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</td></tr>,
                ...list.map((a) => (
                  <tr key={a.id} className="hover:bg-subtle/50">
                    <td className="py-1.5 pl-3 pr-3"><AccountLink a={a} range={range} /></td>
                    <td className="px-3 py-1.5 text-right">{!isZero(a.opening) && <Num v={a.opening} />}</td>
                    <td className="px-3 py-1.5 text-right">{!isZero(a.debit) && <Num v={a.debit} />}</td>
                    <td className="px-3 py-1.5 text-right">{!isZero(a.credit) && <Num v={a.credit} />}</td>
                    <td className="px-3 py-1.5 text-right">{!isZero(a.closingDebit) && <Num v={a.closingDebit} strong />}</td>
                    <td className="px-3 py-1.5 text-right">{!isZero(a.closingCredit) && <Num v={a.closingCredit} strong />}</td>
                  </tr>
                )),
              ]
            })}
            <tr className="border-y-2 border-ink/70 font-semibold"><td className="py-2 pl-3 text-ink">Total</td><td />
              <td className="px-3 py-2 text-right"><Num v={d.totals.debit} strong /></td><td className="px-3 py-2 text-right"><Num v={d.totals.credit} strong /></td>
              <td className="px-3 py-2 text-right"><Num v={d.totals.closingDebit} strong /></td><td className="px-3 py-2 text-right"><Num v={d.totals.closingCredit} strong /></td></tr>
          </tbody>
        </table>
      </ReportSheet>
    </>
  )
}

// ── Profit or loss ─────────────────────────────────────────────────────
function ProfitLoss({ d, range, sheet }) {
  const c = d.comparison
  const L = (name) => d.lines.find((l) => l.name === name)
  const CL = (name) => c?.lines.find((l) => l.name === name)
  const g = (name, indent = true) => { const l = L(name); return l && (!isZero(l.total) || (c && !isZero(CL(name).total))) ? <Group key={name} name={name} value={l.total} compare={c ? CL(name).total : undefined} accounts={l.accounts} compareAccounts={CL(name)?.accounts} range={range} indent={indent} /> : null }
  const rows = () => {
    const r = [['Koko Atelier (Private) Limited'], ['Statement of profit or loss', periodLabel(range)], [], ['', 'Current', ...(c ? ['Comparative'] : [])]]
    const add = (label, v, cv) => r.push([label, n(v), ...(c ? [n(cv)] : [])])
    for (const l of d.lines) { add(l.name, l.total, CL(l.name)?.total); for (const a of l.accounts) r.push([`   ${a.code} ${a.name}`, n(a.amount)]) }
    add('Gross profit', d.grossProfit, c?.grossProfit); add('Operating profit', d.operatingProfit, c?.operatingProfit)
    add('Profit before tax', d.profitBeforeTax, c?.profitBeforeTax); add('Profit for the period', d.profit, c?.profit)
    return r
  }
  return (
    <>
      <div className="flex justify-end"><ExportButtons sheetRef={sheet} filename={`Profit or loss ${range.from} to ${range.to}`} rows={rows} /></div>
      <ReportSheet ref={sheet} title="Statement of profit or loss" period={periodLabel(range)}>
        {d.costingIncomplete && <p className="mb-4 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"><Info size={15} />Cost of sales is incomplete until costing is enabled (Phase F5).</p>}
        <table className="w-full min-w-[520px] text-sm">
          <thead><tr className="border-b border-line"><th className={`${th} text-left`} /><th className={th}>{fmtDate(range.from)} – {fmtDate(range.to)}</th>{c && <th className={th}>{fmtDate(c.from)} – {fmtDate(c.to)}</th>}</tr></thead>
          <tbody>
            {g('Revenue', false)}
            {g('Cost of sales', false)}
            <Total label={`Gross profit${d.grossMargin != null ? ` (${d.grossMargin}%)` : ''}`} value={d.grossProfit} compare={c?.grossProfit} />
            {g('Selling and distribution expenses')}{g('Administrative expenses')}
            <Total label="Operating profit" value={d.operatingProfit} compare={c?.operatingProfit} />
            {g('Other income')}{g('Other expenses')}{g('Finance cost')}
            <Total label="Profit before tax" value={d.profitBeforeTax} compare={c?.profitBeforeTax} />
            {g('Taxation')}
            <Total label="Profit for the period" value={d.profit} compare={c?.profit} double />
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted">Expenses are shown by function. Click a line to see its accounts, and an account to open its ledger.</p>
      </ReportSheet>
    </>
  )
}

// ── Financial position ─────────────────────────────────────────────────
function Position({ d, range, sheet }) {
  const c = d.comparison
  const sec = (key, title, totalKey) => {
    const list = d.sections[key]
    const cl = c?.sections[key] || []
    if (!list.length && !cl.length) return null
    return [
      <tr key={key}><td colSpan={3} className="pb-1 pl-3 pt-3 font-label text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</td></tr>,
      ...list.map((l) => <Group key={key + l.name} name={l.name} value={l.total} compare={c ? (cl.find((x) => x.name === l.name)?.total ?? '0') : undefined} accounts={l.accounts} compareAccounts={cl.find((x) => x.name === l.name)?.accounts} range={range} indent />),
      <Total key={key + 't'} label={`Total ${title.toLowerCase()}`} value={d.totals[totalKey]} compare={c?.totals[totalKey]} />,
    ]
  }
  const rows = () => {
    const r = [['Koko Atelier (Private) Limited'], ['Statement of financial position', periodLabel(range)], [], ['', 'Current', ...(c ? ['Prior year-end'] : [])]]
    for (const [k, t] of [['nonCurrentAssets', 'Non-current assets'], ['currentAssets', 'Current assets'], ['equity', 'Equity'], ['nonCurrentLiabilities', 'Non-current liabilities'], ['currentLiabilities', 'Current liabilities']]) {
      r.push([t]); for (const l of d.sections[k]) r.push([`  ${l.name}`, n(l.total), ...(c ? [n(c.sections[k].find((x) => x.name === l.name)?.total ?? 0)] : [])])
    }
    r.push(['Total assets', n(d.totals.assets), ...(c ? [n(c.totals.assets)] : [])], ['Total equity and liabilities', n(d.totals.equityAndLiabilities), ...(c ? [n(c.totals.equityAndLiabilities)] : [])])
    return r
  }
  return (
    <>
      <div className="flex justify-end"><ExportButtons sheetRef={sheet} filename={`Financial position ${range.asOf}`} rows={rows} /></div>
      <ReportSheet ref={sheet} title="Statement of financial position" period={periodLabel(range)}>
        <Banner ok={d.balanced} good="Balanced: assets equal equity and liabilities" bad={`Not balanced: difference ${amt(d.difference)}. Check the trial balance.`} />
        <table className="w-full min-w-[520px] text-sm">
          <thead><tr className="border-b border-line"><th className={`${th} text-left`} /><th className={th}>{fmtDate(range.asOf)}</th>{c && <th className={th}>{fmtDate(c.asOf)}</th>}</tr></thead>
          <tbody>
            {sec('nonCurrentAssets', 'Non-current assets', 'nonCurrentAssets')}
            {sec('currentAssets', 'Current assets', 'currentAssets')}
            <Total label="Total assets" value={d.totals.assets} compare={c?.totals.assets} double />
            {sec('equity', 'Equity', 'equity')}
            {sec('nonCurrentLiabilities', 'Non-current liabilities', 'nonCurrentLiabilities')}
            {sec('currentLiabilities', 'Current liabilities', 'currentLiabilities')}
            <Total label="Total equity and liabilities" value={d.totals.equityAndLiabilities} compare={c?.totals.equityAndLiabilities} double />
          </tbody>
        </table>
      </ReportSheet>
    </>
  )
}

// ── Cash flows ─────────────────────────────────────────────────────────
function CashFlows({ d, range, sheet }) {
  const [view, setView] = useState('indirect')
  const sec = (title, list, total, lead) => [
    <tr key={title}><td colSpan={2} className="pb-1 pl-3 pt-3 font-label text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</td></tr>,
    ...(lead ? [lead] : []),
    ...list.map((l) => <Group key={title + l.name} name={l.name} value={l.amount} accounts={l.accounts} range={range} indent />),
    <Total key={title + 't'} label={`Net cash from ${title.toLowerCase().replace('cash flows from ', '')}`} value={total} />,
  ]
  const rows = () => view === 'indirect'
    ? [['Koko Atelier (Private) Limited'], ['Statement of cash flows (indirect)', periodLabel(range)], [], ['Profit for the period', n(d.profit)],
      ...d.operating.map((l) => [l.name, n(l.amount)]), ['Net cash from operating activities', n(d.totals.operating)],
      ...d.investing.map((l) => [l.name, n(l.amount)]), ['Net cash from investing activities', n(d.totals.investing)],
      ...d.financing.map((l) => [l.name, n(l.amount)]), ['Net cash from financing activities', n(d.totals.financing)],
      ['Net change in cash', n(d.totals.net)], ['Cash at the start', n(d.openingCash)], ['Cash at the end', n(d.closingCash)]]
    : [['Koko Atelier (Private) Limited'], ['Cash receipts and payments (direct)', periodLabel(range)], [], ['Receipts'], ...d.direct.receipts.map((x) => [`${x.code} ${x.name}`, n(x.amount)]),
      ['Payments'], ...d.direct.payments.map((x) => [`${x.code} ${x.name}`, n(x.amount)]), ['Net change in cash', n(d.direct.net)]]
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented value={view} onChange={setView} options={[{ value: 'indirect', label: 'Indirect method' }, { value: 'direct', label: 'Receipts and payments' }]} />
        <ExportButtons sheetRef={sheet} filename={`Cash flows ${range.from} to ${range.to}`} rows={rows} />
      </div>
      <ReportSheet ref={sheet} title={view === 'indirect' ? 'Statement of cash flows' : 'Cash receipts and payments'} period={periodLabel(range)}>
        <Banner ok={d.reconciles} good="Reconciles to the change in cash and bank" bad="Doesn't reconcile to the change in cash: check account cash-flow classes" />
        <table className="w-full min-w-[480px] text-sm"><tbody>
          {view === 'indirect' ? <>
            {sec('Cash flows from operating activities', d.operating, d.totals.operating,
              <tr key="p"><td className="py-1.5 pl-6 text-ink">Profit for the period</td><td className="px-3 py-1.5 text-right"><Num v={d.profit} /></td></tr>)}
            {sec('Cash flows from investing activities', d.investing, d.totals.investing)}
            {sec('Cash flows from financing activities', d.financing, d.totals.financing)}
          </> : <>
            <tr><td colSpan={2} className="pb-1 pl-3 pt-3 font-label text-[11px] font-semibold uppercase tracking-wider text-muted">Receipts</td></tr>
            {d.direct.receipts.map((x) => <tr key={x.id}><td className="py-1.5 pl-6"><AccountLink a={x} range={range} /></td><td className="px-3 py-1.5 text-right"><Num v={x.amount} /></td></tr>)}
            <tr><td colSpan={2} className="pb-1 pl-3 pt-3 font-label text-[11px] font-semibold uppercase tracking-wider text-muted">Payments</td></tr>
            {d.direct.payments.map((x) => <tr key={x.id}><td className="py-1.5 pl-6"><AccountLink a={x} range={range} /></td><td className="px-3 py-1.5 text-right"><Num v={x.amount} /></td></tr>)}
          </>}
          <Total label="Net change in cash and bank" value={view === 'indirect' ? d.totals.net : d.direct.net} double />
          <tr><td className="py-1.5 pl-3 text-ink-soft">Cash and bank at {fmtDate(range.from)}</td><td className="px-3 py-1.5 text-right"><Num v={d.openingCash} /></td></tr>
          <tr className="font-semibold"><td className="py-1.5 pl-3 text-ink">Cash and bank at {fmtDate(range.to)}</td><td className="px-3 py-1.5 text-right"><Num v={d.closingCash} strong /></td></tr>
        </tbody></table>
      </ReportSheet>
    </>
  )
}

// ── Changes in equity ──────────────────────────────────────────────────
function Equity({ d, range, sheet }) {
  const rows = () => [['Koko Atelier (Private) Limited'], ['Statement of changes in equity', periodLabel(range)], [], ['', 'Share capital', 'Retained earnings', 'Total'],
    ...[...d.rows, d.closing].map((r) => [r.label, n(r.capital), n(r.retained), n(r.total)])]
  return (
    <>
      <div className="flex justify-end"><ExportButtons sheetRef={sheet} filename={`Changes in equity ${range.from} to ${range.to}`} rows={rows} /></div>
      <ReportSheet ref={sheet} title="Statement of changes in equity" period={periodLabel(range)}>
        <table className="w-full min-w-[620px] text-sm">
          <thead><tr className="border-b border-line"><th className={`${th} text-left`} /><th className={th}>Share capital</th><th className={th}>Retained earnings</th><th className={th}>Total</th></tr></thead>
          <tbody>
            {d.rows.map((r, i) => (
              <tr key={i} className={i === 0 ? 'font-semibold' : ''}>
                <td className="py-1.5 pl-3 text-ink">{r.label.replace(/\d{4}-\d{2}-\d{2}/, (x) => fmtDate(x))}</td>
                <td className="px-3 py-1.5 text-right"><Num v={r.capital} /></td><td className="px-3 py-1.5 text-right"><Num v={r.retained} /></td><td className="px-3 py-1.5 text-right"><Num v={r.total} /></td>
              </tr>
            ))}
            <tr className="border-y-2 border-ink/70 font-semibold"><td className="py-2 pl-3 text-ink">{d.closing.label.replace(/\d{4}-\d{2}-\d{2}/, (x) => fmtDate(x))}</td>
              <td className="px-3 py-2 text-right"><Num v={d.closing.capital} strong /></td><td className="px-3 py-2 text-right"><Num v={d.closing.retained} strong /></td><td className="px-3 py-2 text-right"><Num v={d.closing.total} strong /></td></tr>
          </tbody>
        </table>
      </ReportSheet>
    </>
  )
}

const API = { tb: 'trial-balance', pl: 'profit-loss', bs: 'balance-sheet', cf: 'cash-flow', eq: 'equity' }

export default function Reports() {
  const [params, setParams] = useSearchParams()
  const tab = TABS.some(([k]) => k === params.get('r')) ? params.get('r') : 'pl'
  const [period, setPeriod] = useState({ preset: 'fytd' })
  const [asOf, setAsOf] = useState(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }))
  const [compare, setCompare] = useState('')
  const [data, setData] = useState(null)
  const sheet = useRef(null)
  const range = tab === 'bs' ? { asOf, from: fyStartOf(asOf), to: asOf } : presetRange(period.preset, period)

  useEffect(() => {
    setData(null)
    const q = tab === 'bs' ? { asOf, compare: compare === 'yearend' ? 'yearend' : '' } : { from: range.from, to: range.to, compare: tab === 'pl' ? compare : '' }
    getReport(API[tab], q).then((d) => setData({ tab, d })).catch((e) => toast.error(e.message))
  }, [tab, range.from, range.to, asOf, compare]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
      <PageHeader eyebrow="Finance" title="Reports" icon={BarChart3} subtitle="Financial statements from posted entries. Click any figure to see what's behind it." />
      <Segmented value={tab} onChange={(v) => { setParams({ r: v }); setCompare('') }} options={TABS.map(([value, label]) => ({ value, label }))} />
      <div className="flex flex-wrap items-center gap-2">
        {tab === 'bs'
          ? <><span className="text-sm text-muted">As at</span><input type="date" className="input w-auto" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></>
          : <PeriodPicker value={period} onChange={setPeriod} />}
        {tab === 'pl' && <select className="input w-auto" value={compare} onChange={(e) => setCompare(e.target.value)}>
          <option value="">No comparison</option><option value="previous">Compare: previous period</option><option value="lastyear">Compare: same period last year</option></select>}
        {tab === 'bs' && <select className="input w-auto" value={compare} onChange={(e) => setCompare(e.target.value)}>
          <option value="">No comparison</option><option value="yearend">Compare: prior year-end</option></select>}
      </div>
      {data?.tab !== tab ? <SkeletonRows rows={8} /> : (
        tab === 'tb' ? <TrialBalance d={data.d} range={range} sheet={sheet} />
          : tab === 'pl' ? <ProfitLoss d={data.d} range={range} sheet={sheet} />
          : tab === 'bs' ? <Position d={data.d} range={range} sheet={sheet} />
          : tab === 'cf' ? <CashFlows d={data.d} range={range} sheet={sheet} />
          : <Equity d={data.d} range={range} sheet={sheet} />
      )}
    </div>
  )
}
