// Shared bits for the finance screens: amounts, status badges and the account picker.
import { toPaisa, formatRs } from '../../../lib/finance/money.js'
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
