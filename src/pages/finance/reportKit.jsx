// Shared pieces for finance reports: period picker, accounting amounts, the printable sheet, exports.
import { forwardRef } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { FileSpreadsheet, FileDown } from 'lucide-react'
import { toPaisa, formatRs } from '../../../lib/finance/money.js'
import { downloadElementPdf } from '../../utils/statementPdf'
import { fmtDate } from '../../ui/kit'

const pk = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })
const ymd = (d) => d.toISOString().slice(0, 10)
const monthStart = (y, m) => ymd(new Date(Date.UTC(y, m, 1)))
const monthEnd = (y, m) => ymd(new Date(Date.UTC(y, m + 1, 0)))
export const fyStartOf = (d) => { const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)); return `${m >= 7 ? y : y - 1}-07-01` }

// Preset periods (Pakistan dates; fiscal year July to June)
export function presetRange(key, custom = {}) {
  const t = pk(), y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7)) - 1
  if (key === 'month') return { from: monthStart(y, m), to: t }
  if (key === 'lastmonth') return { from: monthStart(y, m - 1), to: monthEnd(y, m - 1) }
  if (key === 'lastfy') { const s = Number(fyStartOf(t).slice(0, 4)) - 1; return { from: `${s}-07-01`, to: `${s + 1}-06-30` } }
  if (key === 'custom') return { from: custom.from || fyStartOf(t), to: custom.to || t }
  return { from: fyStartOf(t), to: t }      // fiscal year to date
}
export const PRESETS = [['fytd', 'Fiscal year to date'], ['month', 'This month'], ['lastmonth', 'Last month'], ['lastfy', 'Last fiscal year'], ['custom', 'Custom']]

export function PeriodPicker({ value, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className="input w-auto" value={value.preset} onChange={(e) => onChange({ ...value, preset: e.target.value })}>
        {PRESETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      {value.preset === 'custom' && <>
        <input type="date" className="input w-auto" value={value.from || ''} onChange={(e) => onChange({ ...value, from: e.target.value })} aria-label="From" />
        <span className="text-sm text-muted">to</span>
        <input type="date" className="input w-auto" value={value.to || ''} onChange={(e) => onChange({ ...value, to: e.target.value })} aria-label="To" />
      </>}
    </div>
  )
}

// '1234.50' -> '1,234.50'; negatives in brackets, as accounts show them
export const amt = (v) => { if (v == null || v === '') return ''; const p = toPaisa(v); return p < 0 ? `(${formatRs(-p, { symbol: '' })})` : formatRs(p, { symbol: '' }) }
export const isZero = (v) => !toPaisa(v || 0)
export const Num = ({ v, strong, className = '' }) => <span className={`tabular-nums ${strong ? 'font-semibold text-ink' : 'text-ink-soft'} ${toPaisa(v || 0) < 0 ? 'text-rose-700 dark:text-rose-300' : ''} ${className}`}>{amt(v)}</span>
export const ledgerLink = (accountId, range) => `/finance/ledgers?account=${accountId}&from=${range.from || ''}&to=${range.to || range.asOf || ''}`
export const AccountLink = ({ a, range }) => a.id
  ? <Link to={ledgerLink(a.id, range)} className="hover:text-accent hover:underline"><span className="mr-1.5 font-mono text-[11px] text-muted">{a.code}</span>{a.name}</Link>
  : <span className="italic text-muted">{a.name}</span>

// The printable sheet: company header, title, period
export const ReportSheet = forwardRef(function ReportSheet({ title, period, children }, ref) {
  return (
    <div ref={ref} data-pdf-root className="card overflow-x-auto p-5 sm:p-7">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
        <div>
          <p className="font-label text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">Koko Atelier (Private) Limited</p>
          <h2 className="mt-1 font-display text-2xl font-semibold text-ink">{title}</h2>
          <p className="text-sm text-muted">{period}</p>
        </div>
        <img src="/brand/wordmark.png" alt="Koko Atelier" className="h-10 w-auto dark:invert" />
      </div>
      {children}
    </div>
  )
})
export const periodLabel = (r) => (r.asOf ? `As at ${fmtDate(r.asOf)}` : `${fmtDate(r.from)} to ${fmtDate(r.to)}`)

export function ExportButtons({ sheetRef, filename, rows }) {
  const xlsx = async () => {
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows()), 'Report')
      XLSX.writeFile(wb, `${filename}.xlsx`)
    } catch (err) { toast.error(err.message) }
  }
  const pdf = async () => { try { await downloadElementPdf(sheetRef.current, `${filename}.pdf`) } catch (err) { toast.error(`Couldn't make the PDF: ${err.message}`) } }
  return (
    <div className="flex gap-2">
      <button className="btn-secondary" onClick={xlsx}><FileSpreadsheet size={15} />Excel</button>
      <button className="btn-secondary" onClick={pdf}><FileDown size={15} />PDF</button>
    </div>
  )
}
// Numbers for spreadsheets
export const n = (v) => (v == null || v === '' ? '' : toPaisa(v) / 100)
