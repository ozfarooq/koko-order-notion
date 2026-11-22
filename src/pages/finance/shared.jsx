// Shared bits for the finance screens: amounts, status badges and the account picker.
import { toPaisa, formatRs } from '../../../lib/finance/money.js'
import { Paperclip } from 'lucide-react'
import { TYPE_LABELS } from '../../data/finance'

export { toPaisa, formatRs }
export const fmtRs = (v, opts) => formatRs(toPaisa(v ?? 0), opts)
export const safePaisa = (v) => { try { return toPaisa(v) } catch { return NaN } }

// Debit-natured accounts show debit balances as positive; credit-natured the other way round
export const debitNatured = (a) => (['asset', 'cogs', 'expense', 'tax'].includes(a.type)) !== !!a.isContra
export function balanceOf(a) {
  const net = toPaisa(a.debit) - toPaisa(a.credit)
  return { paisa: Math.abs(net), side: net === 0 ? '' : net > 0 ? 'Dr' : 'Cr', unusual: net !== 0 && (net > 0) !== debitNatured(a) }
}

const STATUS = {
  Draft: 'bg-subtle2 text-ink-soft ring-line',
  Posted: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300',
  Reversed: 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-950/40 dark:text-rose-300',
  Open: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300',
  Closed: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300',
  Locked: 'bg-subtle2 text-ink ring-line',
  Submitted: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300',
  Approved: 'bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-950/40 dark:text-sky-300',
  Paid: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300',
  Rejected: 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-950/40 dark:text-rose-300',
  Void: 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-950/40 dark:text-rose-300',
  Unpaid: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300',
  New: 'bg-subtle2 text-ink-soft ring-line',
  Ready: 'bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-950/40 dark:text-sky-300',
  'Needs attention': 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300',
  Parked: 'bg-subtle2 text-ink-soft ring-line',
  Duplicate: 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-950/40 dark:text-rose-300',
}
export function FinBadge({ status }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${STATUS[status] || STATUS.Draft}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{status}</span>
}

// Accounts grouped by type. Manual journals can't use control accounts, so those are disabled there.
export function AccountSelect({ accounts, value, onChange, manual = false, className = 'input', ...rest }) {
  const groups = Object.entries(TYPE_LABELS).map(([type, label]) => [label, accounts.filter((a) => a.type === type && (a.isActive || String(a.id) === String(value)))])
  return (
    <select className={className} value={value || ''} onChange={(e) => onChange(e.target.value)} {...rest}>
      <option value="">Choose an account…</option>
      {groups.filter(([, list]) => list.length).map(([label, list]) => (
        <optgroup key={label} label={label}>
          {list.map((a) => <option key={a.id} value={a.id} disabled={manual && a.isControl}>{a.code} · {a.name}{manual && a.isControl ? ' (system only)' : ''}</option>)}
        </optgroup>
      ))}
    </select>
  )
}

export const todayPk = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })
export const periodFor = (periods, date) => periods.find((p) => !p.isAdjustment && date >= p.startsOn && date <= p.endsOn)

// Spending categories: cost of sales, expenses, and the asset accounts a purchase can go to
const NOT_CATEGORIES = ['cash_studio', 'bank_baf', 'clearing_trax', 'clearing_gateway', 'director_omer', 'director_usman']
export const isCategory = (a) => a.isActive && !a.isControl && ['expense', 'cogs', 'asset'].includes(a.type) && !NOT_CATEGORIES.includes(a.systemKey)
export function CategorySelect({ accounts, value, onChange, className = 'input', ...rest }) {
  const groups = [['Expenses', 'expense'], ['Cost of sales (production)', 'cogs'], ['Assets (equipment, prepayments)', 'asset']]
    .map(([label, type]) => [label, accounts.filter((a) => a.type === type && (isCategory(a) || String(a.id) === String(value)))])
  return (
    <select className={className} value={value || ''} onChange={(e) => onChange(e.target.value)} {...rest}>
      <option value="">Choose a category…</option>
      {groups.filter(([, l]) => l.length).map(([label, list]) => (
        <optgroup key={label} label={label}>{list.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</optgroup>
      ))}
    </select>
  )
}

// Receipt / screenshot picker (camera on phones)
export function FilePick({ files, onChange, label = 'Attach the receipt (photo or PDF)' }) {
  return (
    <label className="flex w-full cursor-pointer items-center gap-2 rounded-xl border border-dashed border-line px-3 py-2.5 text-sm text-muted hover:text-accent">
      <Paperclip size={14} className="shrink-0" /><span className="truncate">{files.length ? files.map((f) => f.name).join(', ') : label}</span>
      <input type="file" multiple accept="image/*,application/pdf" className="sr-only" onChange={(e) => onChange([...e.target.files])} />
    </label>
  )
}

// Asks for a reason (void, undo, reject); resolves null if cancelled
export const askReason = (what) => { const r = window.prompt(`${what}\n\nReason (kept on the record):`); return r && r.trim() ? r.trim() : null }
