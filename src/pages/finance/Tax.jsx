import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Scale, Plus, Ban, FileSpreadsheet, BookCheck, CheckCircle2, Circle, AlertTriangle, CalendarPlus } from 'lucide-react'
import {
  getTaxSettings, getSalesTaxReturn, bookSalesTaxReturn, getSalesRegister, getPurchaseRegister, getWhtRegister, getTaxSuffered, addTaxSuffered, voidTaxSuffered,
  getTaxPayments, payTax, voidTaxPayment, getIncomeTax, saveTaxAdjustments, bookIncomeTax, getTaxCalendar, generateTaxCalendar, updateTaxCalendar, PAID_FROM,
} from '../../data/finance'
import { getResellers } from '../../data/storage'
import { PageHeader, Modal, Field, Segmented, SkeletonRows, EmptyState, StatCard, fmtDate } from '../../ui/kit'
import { FinBadge, fmtRs, safePaisa, todayPk, askReason } from './shared'
import { Num, fyStartOf } from './reportKit'

const TABS = [{ value: 'sales', label: 'Sales tax' }, { value: 'wht', label: 'Withholding' }, { value: 'suffered', label: 'Deducted from Koko' },
  { value: 'income', label: 'Income tax' }, { value: 'calendar', label: 'Calendar' }, { value: 'payments', label: 'Payments' }]
const lastMonth = () => { const d = new Date(`${todayPk().slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7) }
const fyOf = (d) => { const s = fyStartOf(d).slice(0, 4); return `${s}-${String((Number(s) + 1) % 100).padStart(2, '0')}` }
const fyList = () => { const now = Number(fyOf(todayPk()).slice(0, 4)); return [now + 1, now, now - 1].map((s) => `${s}-${String((s + 1) % 100).padStart(2, '0')}`) }
async function toExcel(rows, name) {
  try { const XLSX = await import('xlsx'); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Register'); XLSX.writeFile(wb, `${name}.xlsx`) }
  catch (err) { toast.error(err.message) }
}

// Pakistan tax (F7): figures and registers for the advisor; filing stays on IRIS / PRA
export default function Tax() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'sales'
  const [s, setS] = useState(null)
  useEffect(() => { getTaxSettings().then(setS).catch((e) => toast.error(e.message)) }, [])
  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
      <PageHeader eyebrow="Finance" title="Tax" icon={Scale} subtitle="Sales tax, withholding, income tax and the tax calendar. Figures for your tax advisor; returns are filed on IRIS / PRA." />
      {s && !s.taxEnabled && (
        <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          Tax is switched off: sales carry no sales tax and nothing is withheld. Switch it on from the start date (planned 1 July 2027) in <Link className="underline" to="/finance/settings?tab=tax">Finance settings › Tax</Link>. The income tax estimate and the calendar work already.
        </div>
      )}
      {s?.taxEnabled && <p className="text-xs text-muted">Tax on from {fmtDate(s.taxEnabledFrom)}{s.salesTaxRegistered ? ` · sales tax registered (STRN ${s.strn})` : ' · not sales-tax registered'} · COD withholding treated as {s.codWhtTreatment.toLowerCase()}.</p>}
      <div className="overflow-x-auto"><Segmented value={tab} onChange={(v) => setParams({ tab: v })} options={TABS} /></div>
      {tab === 'sales' && <SalesTax />}
      {tab === 'wht' && <Withholding />}
      {tab === 'suffered' && <Suffered settings={s} />}
      {tab === 'income' && <IncomeTax />}
      {tab === 'calendar' && <Calendar />}
      {tab === 'payments' && <Payments />}
    </div>
  )
}

function PayModal({ init, onClose, onDone }) {
  const [p, setP] = useState({ date: todayPk(), paidFrom: 'bank', cprNo: '', note: '', ...init })
  const save = async () => { try { await payTax(p); toast.success('Payment booked'); onDone() } catch (err) { toast.error(err.message) } }
  return (
    <Modal open onClose={onClose} size="sm" title={{ sales_tax: 'Pay sales tax', wht: 'Deposit withholding tax', advance_tax: 'Pay advance income tax', income_tax: 'Pay income tax' }[p.kind]}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save}>Book payment</button></>}>
      <div className="grid grid-cols-2 gap-3 p-5">
        <Field label={p.kind === 'advance_tax' || p.kind === 'income_tax' ? 'Tax year' : 'Month'}><input className="input" value={p.period} onChange={(e) => setP({ ...p, period: e.target.value })} /></Field>
        <Field label="Paid on"><input type="date" className="input" value={p.date} onChange={(e) => setP({ ...p, date: e.target.value })} /></Field>
        <Field label="Amount"><input className="input" inputMode="decimal" value={p.amount} onChange={(e) => setP({ ...p, amount: e.target.value })} /></Field>
        <Field label="Paid from"><select className="input" value={p.paidFrom} onChange={(e) => setP({ ...p, paidFrom: e.target.value })}>{Object.entries(PAID_FROM).filter(([k]) => k !== 'unpaid').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="CPR number" className="col-span-2"><input className="input" value={p.cprNo} onChange={(e) => setP({ ...p, cprNo: e.target.value })} /></Field>
      </div>
    </Modal>
  )
}

// ── Sales tax ──────────────────────────────────────────────────────────
function SalesTax() {
  const [month, setMonth] = useState(lastMonth())
  const [r, setR] = useState(null)
  const [sales, setSales] = useState([])
  const [buys, setBuys] = useState([])
  const [pay, setPay] = useState(null)
  const load = useCallback(() => {
    setR(null)
    getSalesTaxReturn(month).then(setR).catch((e) => toast.error(e.message))
    getSalesRegister(month).then(setSales).catch(() => setSales([])); getPurchaseRegister(month).then(setBuys).catch(() => setBuys([]))
  }, [month])
  useEffect(() => { load() }, [load])
  const book = async () => { try { setR(await bookSalesTaxReturn(month)); toast.success('Return booked') } catch (err) { toast.error(err.message) } }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input type="month" className="input w-auto" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" />
        <div className="flex-1" />
        {r && <button className="btn-secondary" onClick={book} disabled={r.booked && r.current}><BookCheck size={15} />{r.booked ? (r.current ? `Booked ${r.entryNo}` : 'Book again (figures changed)') : 'Book the return'}</button>}
        {r && safePaisa(r.payable) > 0 && <button className="btn-primary" onClick={() => setPay({ kind: 'sales_tax', period: month, amount: r.payable })}>Pay {fmtRs(r.payable, { decimals: false })}</button>}
      </div>
      {!r ? <SkeletonRows rows={4} /> : <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Taxable sales" value={safePaisa(r.taxable) / 100} prefix="Rs " sub={`zero-rated exports ${fmtRs(r.zeroRated, { decimals: false })}`} />
          <StatCard label="Output tax" value={safePaisa(r.output) / 100} prefix="Rs " />
          <StatCard label="Input and withheld tax" value={(safePaisa(r.input) + safePaisa(r.withheld) + safePaisa(r.broughtForward)) / 100} prefix="Rs " sub={`input ${fmtRs(r.input, { decimals: false })} · withheld ${fmtRs(r.withheld, { decimals: false })} · brought forward ${fmtRs(r.broughtForward, { decimals: false })}`} />
          <StatCard label={safePaisa(r.net) >= 0 ? 'Payable' : 'Carried forward'} value={Math.abs(safePaisa(r.net)) / 100} prefix="Rs " sub={safePaisa(r.paid) ? `paid ${fmtRs(r.paid, { decimals: false })}` : ''} />
        </div>
        <p className="text-xs text-muted">Booking the return offsets input and withheld tax against output tax; what is left on 2300 is paid with a CPR by the 18th. More input than output is carried forward to the next month.</p>
      </>}
      <Register title="Sales register" rows={sales} empty="No taxed sales this month."
        head={['Date', 'Invoice', 'Buyer', 'Code', 'Value', 'Sales tax', 'Total']} row={(x) => [fmtDate(x.date), x.invoice, x.buyer, x.code, x.value, x.tax, x.total]}
        excel={() => toExcel([['Date', 'Invoice no', 'Buyer name', 'Buyer NTN/CNIC', 'Buyer type', 'Tax code', 'Value excl. tax', 'Sales tax', 'Value incl. tax'],
          ...sales.map((x) => [x.date, x.invoice, x.buyer, x.buyerNtn, x.buyerType, x.code, Number(x.value), Number(x.tax), Number(x.total)])], `Sales register ${month}`)} />
      <Register title="Purchase register" rows={buys} empty="No bills with sales tax this month."
        head={['Date', 'Invoice', 'Supplier', 'STRN', 'Value', 'Sales tax', 'Total']} row={(x) => [fmtDate(x.date), x.invoice, x.supplier, x.strn, x.value, x.tax, x.total]}
        excel={() => toExcel([['Date', 'Invoice no', 'Supplier', 'NTN/CNIC', 'STRN', 'Value excl. tax', 'Sales tax', 'Value incl. tax'],
          ...buys.map((x) => [x.date, x.invoice, x.supplier, x.ntn, x.strn, Number(x.value), Number(x.tax), Number(x.total)])], `Purchase register ${month}`)} />
      {pay && <PayModal init={pay} onClose={() => setPay(null)} onDone={() => { setPay(null); load() }} />}
    </div>
  )
}
function Register({ title, rows, head, row, excel, empty }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2"><h2 className="section-title flex-1">{title}</h2>{rows.length > 0 && <button className="btn-secondary px-2.5 py-1 text-xs" onClick={excel}><FileSpreadsheet size={13} />Excel</button>}</div>
      {rows.length === 0 ? <p className="card px-4 py-3 text-sm text-muted">{empty}</p> : (
        <div className="card overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wider text-muted"><tr>{head.map((h, i) => <th key={h} className={`px-3 py-2 ${i >= head.length - 3 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">{rows.map((x, i) => <tr key={i}>{row(x).map((c, j) => <td key={j} className={`px-3 py-1.5 ${j >= head.length - 3 ? 'text-right' : 'text-ink-soft'}`}>{j >= head.length - 3 ? <Num v={c} /> : c}</td>)}</tr>)}</tbody>
        </table></div>
      )}
    </section>
  )
}

// ── Withholding deducted by Koko ───────────────────────────────────────
function Withholding() {
  const [month, setMonth] = useState(lastMonth())
  const [w, setW] = useState(null)
  const [pay, setPay] = useState(null)
  const load = useCallback(() => { setW(null); getWhtRegister(month).then(setW).catch((e) => toast.error(e.message)) }, [month])
  useEffect(() => { load() }, [load])
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input type="month" className="input w-auto" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" />
        <div className="flex-1" />
        {w && safePaisa(w.toDeposit) > 0 && <button className="btn-primary" onClick={() => setPay({ kind: 'wht', period: month, amount: w.toDeposit })}>Deposit {fmtRs(w.toDeposit, { decimals: false })}</button>}
      </div>
      <p className="text-xs text-muted">Tax Koko kept back when paying suppliers (s153 goods and services, s155 rent), to deposit with FBR by the 15th of the next month and report in the quarterly statement. Rates are suggested from the supplier's category and ATL status (Staff & suppliers).</p>
      {!w ? <SkeletonRows rows={4} /> : <>
        <div className="grid grid-cols-3 gap-3"><StatCard label="Deducted" value={safePaisa(w.total) / 100} prefix="Rs " /><StatCard label="Deposited" value={safePaisa(w.deposited) / 100} prefix="Rs " /><StatCard label="To deposit" value={safePaisa(w.toDeposit) / 100} prefix="Rs " /></div>
        <Register title="Deduction register" rows={w.rows} empty="Nothing withheld this month."
          head={['Date', 'Supplier', 'NTN / CNIC', 'Section', 'Paid', 'Withheld', 'Rate']} row={(x) => [fmtDate(x.date), x.supplier, x.ntn, x.code, x.base || '', x.amount, x.base ? `${(safePaisa(x.amount) / safePaisa(x.base) * 100).toFixed(1)}%` : '']}
          excel={() => toExcel([['Date', 'Supplier', 'NTN/CNIC', 'On ATL', 'Section', 'Amount paid', 'Tax withheld', 'Entry'], ...w.rows.map((x) => [x.date, x.supplier, x.ntn, x.atl == null ? '' : x.atl ? 'Yes' : 'No', x.code, x.base == null ? '' : Number(x.base), Number(x.amount), x.entryNo])], `Withholding ${month}`)} />
      </>}
      {pay && <PayModal init={pay} onClose={() => setPay(null)} onDone={() => { setPay(null); load() }} />}
    </div>
  )
}

// ── Tax deducted from Koko ─────────────────────────────────────────────
const SUFFER_CODES = { W6A: 'Courier COD withholding (s6A)', W6AD: 'Digital payments (s6A)', W154: 'Export proceeds (s154)', WBANK: 'Bank / other', STW: 'Sales tax withheld' }
const SUFFER_FROM = { clearing_trax: 'Trax COD clearing', bank_baf: 'Bank Alfalah', ar_resellers: 'A reseller\'s payment', clearing_gateway: 'Payment gateway', cash_studio: 'Cash' }
function Suffered({ settings }) {
  const [list, setList] = useState(null)
  const [add, setAdd] = useState(null)
  const [resellers, setResellers] = useState([])
  const load = useCallback(() => getTaxSuffered().then(setList).catch((e) => toast.error(e.message)), [])
  useEffect(() => { load(); getResellers().then(setResellers).catch(() => {}) }, [load])
  const save = async () => { try { setList(await addTaxSuffered(add)); setAdd(null); toast.success('Booked') } catch (err) { toast.error(err.message) } }
  const undo = async (t) => { const r = askReason('Undo this deduction?'); if (!r) return; try { setList(await voidTaxSuffered(t.id, r)) } catch (err) { toast.error(err.message) } }
  if (!list) return <SkeletonRows rows={4} />
  const total = list.filter((t) => t.status === 'Posted').reduce((s, t) => s + safePaisa(t.amount), 0)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-xs text-muted">Tax taken from Koko's money by others: Trax on COD, banks on export proceeds, payment companies. Income tax deducted is a credit against Koko's tax (1400) unless COD withholding is treated as final, when it is a cost. Keep the certificate reference.</p>
        <button className="btn-primary" onClick={() => setAdd({ code: 'W6A', date: todayPk(), party: 'Trax', base: '', amount: '', from: 'clearing_trax', certificate: '', resellerId: '' })} disabled={!settings?.taxEnabled}><Plus size={15} />Add</button>
      </div>
      {list.length === 0 ? <EmptyState icon={Scale} title="Nothing recorded" hint="Add each deduction from the courier's settlement or the bank's advice." /> : <>
        <div className="card overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><tbody className="divide-y divide-line">
          {list.map((t) => (
            <tr key={t.id} className={t.status === 'Void' ? 'opacity-50 line-through' : ''}>
              <td className="px-4 py-2 text-xs text-muted">{fmtDate(t.date)}</td>
              <td className="px-2 py-2"><p className="text-ink">{t.codeName}</p><p className="text-xs text-muted">{[t.party, t.fromLabel, t.certificate && `certificate ${t.certificate}`].filter(Boolean).join(' · ')}</p></td>
              <td className="px-2 py-2 text-right text-xs text-muted">{t.base ? `on ${fmtRs(t.base, { decimals: false })}` : ''}</td>
              <td className="px-2 py-2 text-right"><Num v={t.amount} strong /></td>
              <td className="px-4 py-2 text-right">{t.entryNo && <Link to={`/finance/journals/${t.entryId}`} className="font-mono text-xs text-accent">{t.entryNo}</Link>}{t.status === 'Posted' && <button className="ml-2 text-faint hover:text-rose-600" onClick={() => undo(t)} aria-label="Undo"><Ban size={13} /></button>}</td>
            </tr>
          ))}
        </tbody></table></div>
        <p className="text-right text-sm text-ink">Total {fmtRs(String(total / 100))}</p>
      </>}
      <Modal open={!!add} onClose={() => setAdd(null)} size="sm" title="Tax deducted from Koko"
        footer={<><button className="btn-secondary" onClick={() => setAdd(null)}>Cancel</button><button className="btn-primary" onClick={save}>Book</button></>}>
        {add && <div className="grid grid-cols-2 gap-3 p-5">
          <Field label="What" className="col-span-2"><select className="input" value={add.code} onChange={(e) => setAdd({ ...add, code: e.target.value })}>{Object.entries(SUFFER_CODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Date"><input type="date" className="input" value={add.date} onChange={(e) => setAdd({ ...add, date: e.target.value })} /></Field>
          <Field label="By whom"><input className="input" value={add.party} onChange={(e) => setAdd({ ...add, party: e.target.value })} /></Field>
          <Field label="Deducted from"><input className="input" inputMode="decimal" value={add.base} onChange={(e) => setAdd({ ...add, base: e.target.value })} placeholder="e.g. COD collected" /></Field>
          <Field label="Tax deducted"><input className="input" inputMode="decimal" value={add.amount} onChange={(e) => setAdd({ ...add, amount: e.target.value })} /></Field>
          <Field label="Money short from" className="col-span-2"><select className="input" value={add.from} onChange={(e) => setAdd({ ...add, from: e.target.value })}>{Object.entries(SUFFER_FROM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          {add.from === 'ar_resellers' && <Field label="Reseller" className="col-span-2"><select className="input" value={add.resellerId} onChange={(e) => setAdd({ ...add, resellerId: e.target.value })}><option value="">Choose…</option>{resellers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>}
          <Field label="Certificate reference" className="col-span-2"><input className="input" value={add.certificate} onChange={(e) => setAdd({ ...add, certificate: e.target.value })} /></Field>
        </div>}
      </Modal>
    </div>
  )
}

// ── Income tax ─────────────────────────────────────────────────────────
function IncomeTax() {
  const [fy, setFy] = useState(fyOf(todayPk()))
  const [t, setT] = useState(null)
  const [adj, setAdj] = useState(null)
  const [pay, setPay] = useState(null)
  const load = useCallback(() => { setT(null); getIncomeTax(fy).then((x) => { setT(x); setAdj({ addBacks: x.addBacks.other, deductions: x.deductions.other, note: x.notes }) }).catch((e) => toast.error(e.message)) }, [fy])
  useEffect(() => { load() }, [load])
  const saveAdj = async () => { try { setT(await saveTaxAdjustments(fy, adj)); toast.success('Saved') } catch (err) { toast.error(err.message) } }
  const book = async () => { if (!window.confirm(`Book FY ${fy}'s current and deferred tax in the adjustment period?`)) return; try { setT(await bookIncomeTax(fy)); toast.success('Tax booked') } catch (err) { toast.error(err.message) } }
  const R = ({ label, v, strong, sub }) => <div className="flex items-baseline gap-3 px-4 py-1.5 text-sm"><span className={`flex-1 ${strong ? 'font-semibold text-ink' : 'text-ink-soft'}`}>{label}{sub && <span className="ml-2 text-[11px] text-faint">{sub}</span>}</span><Num v={v} strong={strong} /></div>
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select className="input w-auto" value={fy} onChange={(e) => setFy(e.target.value)} aria-label="Fiscal year">{fyList().map((x) => <option key={x} value={x}>FY {x} · Tax Year {Number(x.slice(0, 4)) + 1}</option>)}</select>
        <div className="flex-1" />
        {t && <button className="btn-secondary" onClick={() => setPay({ kind: 'advance_tax', period: String(t.taxYear), amount: t.quarterlyInstalment })}>Pay advance tax</button>}
        {t && <button className="btn-primary" onClick={book} disabled={t.partYear}><BookCheck size={15} />{t.booked ? `Booked (${t.booked}): book again` : 'Book the year\'s tax'}</button>}
      </div>
      {!t ? <SkeletonRows rows={10} /> : <>
        <p className="text-xs text-muted">{t.partYear ? `Year to date (${fmtDate(t.asOf)}): an estimate that firms up at 30 June.` : 'Full year.'} Rates: {t.smallCompany ? 'small company' : 'company'} {t.rates.normal}%, minimum tax {t.rates.minimum}% of turnover, super tax {t.rates.super}% above {fmtRs(t.rates.superThreshold || '0', { decimals: false })}. Seed rates: confirm with the advisor.</p>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card divide-y divide-line py-1">
            <R label="Profit before tax" v={t.profitBeforeTax} strong />
            <R label="Add: accounting depreciation" v={t.addBacks.depreciation} /><R label="Add: credit-loss allowance charged" v={t.addBacks.creditLosses} /><R label="Add: provisions charged" v={t.addBacks.provisions} /><R label="Add: other" v={t.addBacks.other} />
            <R label="Less: tax depreciation" v={`-${t.deductions.taxDepreciation}`} /><R label="Less: other" v={`-${t.deductions.other}`} />
            <R label="Taxable income" v={t.taxable} strong />
            <R label="Normal tax" v={t.normalTax} /><R label="Minimum tax on turnover" v={t.minimumTax} sub={`turnover ${fmtRs(t.turnover, { decimals: false })}`} /><R label="Super tax" v={t.superTax} />
            <R label={`Tax for the year${t.minimumApplies ? ' (minimum tax applies)' : ''}`} v={t.payable} strong />
            <R label="Less: tax already deducted and advance tax paid (1400)" v={`-${t.credits}`} />
            <R label={safePaisa(t.balanceDue) >= 0 ? 'Balance to pay with the return' : 'Refundable'} v={t.balanceDue} strong />
            {t.minimumApplies && <p className="px-4 py-2 text-[11px] text-muted">Minimum tax above normal tax ({fmtRs(t.minimumCarryForward, { decimals: false })}) can be carried forward against later years' normal tax.</p>}
          </div>
          <div className="space-y-4">
            <div className="card divide-y divide-line py-1">
              <p className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted">Deferred tax (IAS 12){!t.deferred.required && ': not required under AFRS for SSEs'}</p>
              <R label="Fixed assets: carrying amount" v={t.deferred.carryingAmount} /><R label="Fixed assets: tax written-down value" v={`-${t.deferred.taxBase}`} />
              <R label="Credit-loss allowance (deductible later)" v={`-${t.deferred.allowance}`} /><R label="Provisions (deductible when paid)" v={`-${t.deferred.provisions}`} />
              <R label="Temporary differences" v={t.deferred.temporaryDifference} strong />
              <R label={safePaisa(t.deferred.balance) >= 0 ? 'Deferred tax liability' : 'Deferred tax asset'} v={t.deferred.balance.replace('-', '')} strong />
            </div>
            {adj && <div className="card space-y-3 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">Other adjustments for this year</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Other add-backs" hint="e.g. entertainment, penalties"><input className="input" inputMode="decimal" value={adj.addBacks} onChange={(e) => setAdj({ ...adj, addBacks: e.target.value })} /></Field>
                <Field label="Other deductions"><input className="input" inputMode="decimal" value={adj.deductions} onChange={(e) => setAdj({ ...adj, deductions: e.target.value })} /></Field>
              </div>
              <Field label="Note"><input className="input" value={adj.note} onChange={(e) => setAdj({ ...adj, note: e.target.value })} /></Field>
              <div className="flex justify-end"><button className="btn-secondary" onClick={saveAdj}>Save</button></div>
            </div>}
            <p className="text-xs text-muted">Advance tax (s147): about {fmtRs(t.quarterlyInstalment, { decimals: false })} a quarter on this estimate; paid so far {fmtRs(t.advancePaid, { decimals: false })}.</p>
          </div>
        </div>
        {t.assets.length > 0 && (
          <section className="space-y-2">
            <h2 className="section-title">Tax depreciation</h2>
            <div className="card overflow-x-auto"><table className="w-full min-w-[480px] text-sm"><tbody className="divide-y divide-line">
              {t.assets.map((a) => <tr key={a.assetId}><td className="px-4 py-1.5 text-ink">{a.code} · {a.name}</td><td className="px-2 py-1.5 text-right"><Num v={a.taxDepreciation} /></td><td className="px-4 py-1.5 text-right text-xs text-muted">WDV {fmtRs(a.taxWdv, { decimals: false })}</td></tr>)}
            </tbody></table></div>
          </section>
        )}
      </>}
      {pay && <PayModal init={pay} onClose={() => setPay(null)} onDone={() => { setPay(null); load() }} />}
    </div>
  )
}

// ── Calendar ───────────────────────────────────────────────────────────
function Calendar() {
  const [fy, setFy] = useState(fyOf(todayPk()))
  const [list, setList] = useState(null)
  const load = useCallback(() => { setList(null); getTaxCalendar(fy).then(setList).catch((e) => toast.error(e.message)) }, [fy])
  useEffect(() => { load() }, [load])
  const gen = async () => { try { setList(await generateTaxCalendar(fy)); toast.success('Calendar ready') } catch (err) { toast.error(err.message) } }
  const upd = async (c, b) => { try { setList(await updateTaxCalendar(c.id, b)) } catch (err) { toast.error(err.message) } }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select className="input w-auto" value={fy} onChange={(e) => setFy(e.target.value)} aria-label="Fiscal year">{fyList().map((x) => <option key={x} value={x}>FY {x} · Tax Year {Number(x.slice(0, 4)) + 1}</option>)}</select>
        <div className="flex-1" />
        <button className="btn-secondary" onClick={gen}><CalendarPlus size={15} />{list?.length ? 'Add missing dates' : 'Set up the calendar'}</button>
      </div>
      <p className="text-xs text-muted">Due dates are the usual ones; change any that moves. Items due within 7 days show on the finance overview. Paying sales tax or withholding for a month ticks its item.</p>
      {!list ? <SkeletonRows rows={8} /> : list.length === 0 ? <EmptyState icon={CalendarPlus} title="No dates yet" hint="Set up the calendar for this year." /> : (
        <div className="card divide-y divide-line text-sm">
          {list.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
              {c.status === 'Done' ? <CheckCircle2 size={16} className="text-emerald-600" /> : c.overdue ? <AlertTriangle size={16} className="text-rose-600" /> : <Circle size={16} className={c.status === 'Not needed' ? 'text-faint' : 'text-amber-600'} />}
              <span className={`min-w-0 flex-1 ${c.status === 'Not needed' ? 'text-faint line-through' : 'text-ink'}`}>{c.title}{c.reference && <span className="ml-2 text-xs text-muted">{c.reference}</span>}</span>
              <input type="date" className="input w-auto py-1 text-xs" value={c.dueOn} onChange={(e) => e.target.value && upd(c, { dueOn: e.target.value })} aria-label="Due date" />
              <select className="input w-auto py-1 text-xs" value={c.status} onChange={(e) => upd(c, { status: e.target.value })} aria-label="Status"><option>Due</option><option>Done</option><option>Not needed</option></select>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Payments ───────────────────────────────────────────────────────────
function Payments() {
  const [list, setList] = useState(null)
  const [pay, setPay] = useState(null)
  const load = useCallback(() => getTaxPayments().then(setList).catch((e) => toast.error(e.message)), [])
  useEffect(() => { load() }, [load])
  const undo = async (p) => { const r = askReason('Undo this payment?'); if (!r) return; try { setList(await voidTaxPayment(p.id, r)) } catch (err) { toast.error(err.message) } }
  if (!list) return <SkeletonRows rows={4} />
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button className="btn-primary" onClick={() => setPay({ kind: 'income_tax', period: String(Number(fyOf(todayPk()).slice(0, 4))), amount: '' })}><Plus size={15} />Income tax paid with the return</button></div>
      {list.length === 0 ? <EmptyState icon={Scale} title="No tax payments yet" hint="Payments made from the sales tax, withholding and income tax tabs appear here with their CPR numbers." /> : (
        <div className="card divide-y divide-line text-sm">
          {list.map((p) => (
            <div key={p.id} className={`flex flex-wrap items-center gap-3 px-4 py-2 ${p.status === 'Void' ? 'opacity-50 line-through' : ''}`}>
              <span className="w-24 text-xs text-muted">{fmtDate(p.date)}</span><span className="flex-1 text-ink">{p.kindLabel} · {p.period}{p.cprNo && <span className="ml-2 text-xs text-muted">CPR {p.cprNo}</span>}</span>
              {p.entryNo && <Link to={`/finance/journals/${p.entryId}`} className="font-mono text-xs text-accent">{p.entryNo}</Link>}
              <span className="tabular-nums text-ink">{fmtRs(p.amount)}</span>
              {p.status === 'Posted' ? <button className="text-faint hover:text-rose-600" onClick={() => undo(p)} aria-label="Undo"><Ban size={13} /></button> : <FinBadge status="Void" />}
            </div>
          ))}
        </div>
      )}
      {pay && <PayModal init={pay} onClose={() => setPay(null)} onDone={() => { setPay(null); load() }} />}
    </div>
  )
}
