// Sales grouped by the month they sold in, with what was paid for each month.
// Shared by the statement, the sales list and the reseller dashboard.
import { pieceMoney } from '../../data/storage'

export const monthKey = (d) => (d || '').slice(0, 7)
export const monthLabel = (k) => (k ? new Date(`${k}-01T00:00:00`).toLocaleDateString('en-PK', { month: 'long', year: 'numeric' }) : '')
export const monthShort = (k) => (k ? new Date(`${k}-01T00:00:00`).toLocaleDateString('en-PK', { month: 'short', year: 'numeric' }) : '')

// The month a payment settles: its statement month, else the month most of its pieces sold in, else when it arrived
export function paymentMonth(payment, pieces) {
  if (payment.period) return payment.period
  const counts = {}
  pieces.forEach((p) => { if (p.paymentId === payment.id && p.soldOn) counts[monthKey(p.soldOn)] = (counts[monthKey(p.soldOn)] || 0) + 1 })
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || monthKey(payment.paidOn)
}

// [{ month, pieces, gross, discounts, net, commission, alteration, payable, paidPayable, duePayable,
//    received, receivedPkr, payments, status: 'Paid' | 'Part paid' | 'Due' }], newest first
export function monthlySummary(pieces, payments = []) {
  const map = new Map()
  const row = (month) => {
    if (!map.has(month)) map.set(month, { month, items: [], pieces: 0, gross: 0, discounts: 0, net: 0, commission: 0, alteration: 0, payable: 0, paidPayable: 0, received: 0, receivedPkr: null, payments: [] })
    return map.get(month)
  }
  pieces.filter((p) => ['FC - Sold', 'FC - Paid'].includes(p.status) && p.soldOn).forEach((p) => {
    const r = row(monthKey(p.soldOn)), m = pieceMoney(p)
    r.items.push(p); r.pieces++
    r.gross += Number(p.aedPrice) || 0
    r.discounts += (p.designerDiscount || 0) + (p.resellerDiscount || 0)
    r.net += m.netPrice; r.commission += m.commission; r.alteration += p.alterationCharge || 0
    r.payable += m.netPayable
    if (p.status === 'FC - Paid') r.paidPayable += m.netPayable
  })
  payments.forEach((pay) => {
    const r = row(paymentMonth(pay, pieces))
    r.payments.push(pay); r.received += pay.amount || 0
    if (pay.amountPkr != null) r.receivedPkr = (r.receivedPkr || 0) + pay.amountPkr
  })
  return [...map.values()].map((r) => {
    const duePayable = Math.round((r.payable - r.paidPayable) * 100) / 100
    const status = !r.pieces ? (r.received ? 'Paid' : 'Due') : duePayable < 0.5 ? 'Paid' : r.paidPayable > 0 ? 'Part paid' : 'Due'
    r.items.sort((a, b) => (a.soldOn || '').localeCompare(b.soldOn || ''))
    r.payments.sort((a, b) => (a.paidOn || '').localeCompare(b.paidOn || ''))
    return { ...r, duePayable, status }
  }).sort((a, b) => b.month.localeCompare(a.month))
}

const BADGE = {
  Paid: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300',
  'Part paid': 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300',
  Due: 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-950/40 dark:text-rose-300',
}
export function PayBadge({ status }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${BADGE[status]}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{status}</span>
}
