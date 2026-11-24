// Finance F5b: actual cost. Fabric, wages, outsourced work and consumables reach cost of sales when they
// are paid (periodic method), so at each month end the stock still held is valued and one entry moves the
// stock accounts to that value against 5050 Change in inventories (IAS 2):
//   1300 Raw materials   fabric left in each lot × the lot's average purchase rate
//   1310 WIP             orders started and not yet sold (paid) at that date
//   1320 FG at studio    finished pieces at the studio or a shoot (damaged ones at the lower of cost and
//                        asking price: net realisable value)
//   1330 FG at resellers pieces at the reseller's store
// Pieces are costed from their design's cost card (fabric scaled by size). Re-running a month replaces
// its entry, so the books always show the latest count.
// Standard vs actual compares a month's production at cost-card rates with what was actually spent, with
// labour split by the hours logged per job in payroll.
import { neon } from '@neondatabase/serverless'
import { HttpError } from '../db.js'
import { toPaisa, fromPaisa } from './money.js'
import { createEntry, reverseEntry, getEntry, accountBySystemKey, getSettings, entryState } from './ledger.js'
import { activeCards, listPolicies, listLots, piecesMade, pieceCost } from './costing.js'
import { day, isDate, today } from './expenses.js'

let _sql
const db = () => (_sql ??= neon(process.env.DATABASE_URL))
const sql = (...args) => db()(...args)
const P = (v) => toPaisa(v ?? 0)
const money = (p) => fromPaisa(Math.round(p))
export const BUCKETS = { materials: 'inv_materials', wip: 'inv_wip', studio: 'inv_fg_studio', reseller: 'inv_fg_consigned' }
const monthEnd = (m) => { const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)); return d.toISOString().slice(0, 10) }
const monthStart = (m) => `${m}-01`

// What is in stock on a date, and what it is worth
export async function stockAt(asOf) {
  if (!isDate(asOf)) throw new HttpError(400, 'Choose the date to value stock at')
  const [cards, policies, products, lots, wipRows, studioRows, resellerRows] = await Promise.all([
    activeCards(), listPolicies(),
    sql`SELECT p.id, p.name, p.collection_id, c.name AS collection FROM products p LEFT JOIN collections c ON c.id = p.collection_id`,
    listLots({ asOf }),
    // Orders started (order date on or before) and not yet sold (paid) at that date; lines filled from a
    // studio piece are not stitched, so they are not WIP
    sql`SELECT oi.product_id, oi.size, o.order_number, greatest(oi.quantity - coalesce(sp.n, 0), 0)::int AS n
        FROM order_items oi JOIN orders o ON o.id = oi.order_id
        LEFT JOIN LATERAL (SELECT count(*)::int AS n FROM stock_pieces s WHERE s.order_id = o.id AND s.product_id = oi.product_id) sp ON true
        WHERE oi.product_id IS NOT NULL AND o.status NOT IN ('New', 'Cancelled', 'Returned') AND o.order_date <= ${asOf}::date
          AND (o.paid_on IS NULL OR o.paid_on > ${asOf}::date)`,
    sql`SELECT s.id, s.product_id, s.size, s.status, s.kind, s.damaged, s.asking_price_pkr
        FROM stock_pieces s WHERE s.status IN ('In Production', 'At Studio', 'At Shoot')
          AND coalesce(s.made_on, (s.created_at AT TIME ZONE 'Asia/Karachi')::date) <= ${asOf}::date`,
    // At the reseller's store on that date (sold or returned later still counts)
    sql`SELECT ci.id, ci.product_id, ci.size, r.name AS reseller FROM consignment_items ci JOIN consignments c ON c.id = ci.consignment_id JOIN resellers r ON r.id = c.reseller_id
        WHERE c.handover_date <= ${asOf}::date AND (ci.status = 'At Store' OR (ci.status IN ('Sold', 'Paid') AND ci.sold_on > ${asOf}::date)
          OR (ci.status = 'Returned' AND ci.returned_on > ${asOf}::date))`,
  ])
  const prod = new Map(products.map((p) => [p.id, p]))
  const pol = (cid) => policies.find((x) => x.collectionId === cid) || policies.find((x) => x.isDefault)
  const costOf = (pid, size) => {
    const c = cards.get(pid)
    return c ? pieceCost(c.lines.map((l) => ({ kind: l.kind, amount: l.amount })), pol(prod.get(pid)?.collection_id).sizeFactors, size) : null
  }
  const missing = new Map()
  const buckets = { materials: { value: 0, rows: [] }, wip: { value: 0, rows: [] }, studio: { value: 0, rows: [] }, reseller: { value: 0, rows: [] } }
  const add = (bucket, pid, size, n, note, valueOverride) => {
    if (n <= 0) return
    const unit = costOf(pid, size)
    const p = prod.get(pid) || { name: 'Unknown' }
    if (unit == null) { const m = missing.get(pid) || { productId: pid, name: p.name, collection: p.collection || '', pieces: 0 }; m.pieces += n; missing.set(pid, m) }
    const value = valueOverride != null && unit != null ? Math.min(valueOverride, unit) * n : (unit || 0) * n
    buckets[bucket].rows.push({ productId: pid, name: p.name, collection: p.collection || '', size: size || '', pieces: n, unitCost: unit == null ? null : money(unit), value: money(value), note: note || '' })
    buckets[bucket].value += value
  }
  for (const r of wipRows) add('wip', r.product_id, r.size, r.n, r.order_number)
  for (const r of studioRows) {
    const nrv = r.damaged && r.asking_price_pkr != null ? P(r.asking_price_pkr) : null      // damaged: lower of cost and asking price
    add(r.status === 'In Production' ? 'wip' : 'studio', r.product_id, r.size, 1, [r.kind === 'Sample' ? 'Sample' : 'Stock', r.status, r.damaged ? 'damaged' : ''].filter(Boolean).join(' · '), nrv)
  }
  for (const r of resellerRows) add('reseller', r.product_id, r.size, 1, r.reseller)
  for (const l of lots) {
    const left = Math.max(0, l.left)
    if (!left || !l.purchased) continue                          // only fabric that was bought (and costed) is stock
    const value = left * l.avgPaisa
    buckets.materials.rows.push({ lotId: l.id, name: l.name, collection: l.collection, quantity: left, unit: l.unit, rate: l.averageRate, value: money(value) })
    buckets.materials.value += value
  }
  // Group pieces by design and size for reading
  for (const k of ['wip', 'studio', 'reseller']) {
    const g = new Map()
    for (const r of buckets[k].rows) {
      const key = `${r.productId}|${r.size}`
      const x = g.get(key) || { ...r, pieces: 0, value: 0, notes: new Set() }
      x.pieces += r.pieces; x.value += P(r.value); if (r.note) x.notes.add(r.note)
      g.set(key, x)
    }
    buckets[k].rows = [...g.values()].map(({ notes, ...x }) => ({ ...x, value: money(x.value), note: [...notes].slice(0, 6).join(', ') })).sort((a, b) => P(b.value) - P(a.value))
  }
  const total = Object.values(buckets).reduce((s, b) => s + b.value, 0)
  return {
    asOf, total: money(total), pieces: ['wip', 'studio', 'reseller'].reduce((s, k) => s + buckets[k].rows.reduce((t, r) => t + r.pieces, 0), 0),
    buckets: Object.fromEntries(Object.entries(buckets).map(([k, b]) => [k, { value: money(b.value), rows: b.rows }])),
    missing: [...missing.values()],
  }
}

// Ledger balance of an account on a date, leaving out this month's own valuation (and its reversals)
async function balanceWithout(accountId, asOf, month) {
  const [r] = await sql`
    SELECT coalesce(sum(l.debit - l.credit), 0) AS net FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id
    WHERE l.account_id = ${accountId} AND e.status <> 'Draft' AND e.entry_date <= ${asOf}::date
      AND NOT (e.source_type = 'stock_valuation' AND e.source_id = ${month})
      AND (e.reversal_of IS NULL OR e.reversal_of NOT IN (SELECT id FROM fin_entries WHERE source_type = 'stock_valuation' AND source_id = ${month}))`
  return P(r.net)
}

// The month's valuation lines (nothing posted)
async function valuationFor(month) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) throw new HttpError(400, 'Choose the month')
  const asOf = monthEnd(month)
  const st = await stockAt(asOf)
  const acc = Object.fromEntries(await Promise.all(Object.entries(BUCKETS).map(async ([k, key]) => [k, (await accountBySystemKey(key)).id])))
  const change = (await accountBySystemKey('inv_change')).id
  const lines = []
  let net = 0
  for (const [k, id] of Object.entries(acc)) {
    const diff = P(st.buckets[k].value) - await balanceWithout(id, asOf, month)
    if (!diff) continue
    net += diff
    lines.push({ accountId: id, debit: diff > 0 ? fromPaisa(diff) : '0', credit: diff < 0 ? fromPaisa(-diff) : '0', description: `Stock at ${asOf}: ${k === 'materials' ? 'fabric left' : k === 'wip' ? 'orders being stitched' : k === 'studio' ? 'finished pieces at the studio' : 'pieces at resellers'}` })
  }
  if (net) lines.push({ accountId: change, debit: net < 0 ? fromPaisa(-net) : '0', credit: net > 0 ? fromPaisa(net) : '0', description: net > 0 ? 'Stock went up: less cost of sales' : 'Stock went down: more cost of sales' })
  return { asOf, st, lines }
}
// Is the posted valuation still what the stock is worth? (month-end checklist)
export async function valuationState(month) {
  const { asOf, st, lines } = await valuationFor(month)
  return { asOf, total: st.total, missing: st.missing, ...(await entryState({ type: 'stock_valuation', id: month, event: 'closing' }, lines, asOf)) }
}

// Values stock at the month end and posts (or replaces) that month's entry
export async function postValuation({ month } = {}, user) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) throw new HttpError(400, 'Choose the month')
  const { goLiveDate } = await getSettings()
  if (monthEnd(month) < goLiveDate) throw new HttpError(400, `${month} is before go-live; stock at that date belongs in the opening balances`)
  if (monthStart(month) > today()) throw new HttpError(400, 'That month has not started yet')
  const { asOf, st, lines } = await valuationFor(month)

  const [active] = await sql`SELECT id FROM fin_entries WHERE source_type = 'stock_valuation' AND source_id = ${month} AND source_event = 'closing' AND status = 'Posted'`
  let entryId = null
  if (active) {
    const e = await getEntry(active.id)
    const sig = (ls) => ls.map((l) => `${l.accountId}|${fromPaisa(P(l.debit))}|${fromPaisa(P(l.credit))}`).sort().join(',')
    if (lines.length && sig(e.lines) === sig(lines)) entryId = e.id
    else await reverseEntry(e.id, { date: asOf, reason: 'Stock valued again' }, user)
  }
  if (!entryId && lines.length) {
    const e = await createEntry({ date: asOf, entryType: 'IN', memo: `Stock valuation ${month}: ${money(P(st.total))} in stock`, post: true,
      source: { type: 'stock_valuation', id: month, event: 'closing' }, lines }, user)
    entryId = e.id
  }
  await sql`INSERT INTO fin_stock_valuations (month, as_of, totals, missing, pieces, entry_id, created_by, updated_at)
    VALUES (${month}, ${asOf}::date, ${JSON.stringify(Object.fromEntries(Object.entries(st.buckets).map(([k, b]) => [k, b.value])))}::jsonb, ${JSON.stringify(st.missing)}::jsonb,
            ${st.pieces}, ${entryId}::bigint, ${user?.id ?? null}, now())
    ON CONFLICT (month) DO UPDATE SET as_of = EXCLUDED.as_of, totals = EXCLUDED.totals, missing = EXCLUDED.missing, pieces = EXCLUDED.pieces,
      entry_id = EXCLUDED.entry_id, created_by = EXCLUDED.created_by, updated_at = now()`
  return { ...st, month, entryId, entryNo: entryId ? (await getEntry(entryId)).entryNo : null }
}

export async function listValuations() {
  const rows = await sql`SELECT v.*, e.entry_no, u.name AS by_name FROM fin_stock_valuations v LEFT JOIN fin_entries e ON e.id = v.entry_id LEFT JOIN users u ON u.id = v.created_by ORDER BY v.month DESC`
  return rows.map((v) => ({ month: v.month, asOf: day(v.as_of), totals: v.totals, total: money(Object.values(v.totals).reduce((s, x) => s + P(x), 0)), pieces: v.pieces,
    missing: v.missing, entryId: v.entry_id, entryNo: v.entry_no || '', by: v.by_name || '', updatedAt: v.updated_at }))
}

// ── Standard vs actual ─────────────────────────────────────────────────
// A month's production at cost-card rates against what was actually spent, by element
const ELEMENT = { fabric: 'materials', extra: 'materials', stitching: 'labour', outsourced: 'outsourced', consumables: 'consumables', overhead: 'consumables' }
const ACTUAL_KEYS = { materials: 'cogs_materials', labour: 'cogs_labour', outsourced: 'cogs_outsourced', consumables: 'consumables' }
export async function standardVsActual({ month } = {}) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) throw new HttpError(400, 'Choose the month')
  const from = monthStart(month), to = monthEnd(month)
  const [cards, policies, products, actualRows, hours] = await Promise.all([
    activeCards(), listPolicies(), sql`SELECT id, name, collection_id FROM products`,
    sql`SELECT a.system_key, sum(l.debit - l.credit) AS amount FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'Draft' AND e.entry_type NOT IN ('CL', 'OB')
        JOIN fin_accounts a ON a.id = l.account_id AND a.system_key = ANY(${Object.values(ACTUAL_KEYS)})
        WHERE e.entry_date BETWEEN ${from}::date AND ${to}::date GROUP BY 1`,
    sql`SELECT h.job_type, h.order_id, o.order_number, h.hours FROM fin_payroll_hours h JOIN fin_payroll_lines pl ON pl.id = h.line_id
        JOIN fin_payroll_runs r ON r.id = pl.run_id AND r.status = 'Posted' AND r.week_ending BETWEEN ${from}::date AND ${to}::date
        LEFT JOIN orders o ON o.id = h.order_id`,
  ])
  // Production in the month = made up to the month end minus made up to the day before it starts
  const [upto, before] = await Promise.all([piecesMade(to), piecesMade(new Date(new Date(`${from}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10))])
  const count = (x) => { const m = new Map(); for (const r of [...x.made, ...x.ordered]) { const k = `${r.product_id}|${r.size || ''}`; m.set(k, (m.get(k) || 0) + r.n) } return m }
  const a = count(upto), b = count(before)
  const prodCol = new Map(products.map((p) => [p.id, p.collection_id]))
  const pol = (pid) => policies.find((x) => x.collectionId === prodCol.get(pid)) || policies.find((x) => x.isDefault)
  const standard = { materials: 0, labour: 0, outsourced: 0, consumables: 0 }
  let pieces = 0, uncosted = 0
  for (const [k, n0] of a) {
    const n = n0 - (b.get(k) || 0)
    if (n <= 0) continue
    const [pidS, size] = k.split('|'); const pid = Number(pidS)
    const card = cards.get(pid)
    if (!card) { uncosted += n; continue }
    pieces += n
    for (const l of card.lines) {
      const amt = l.kind === 'fabric' ? Math.round(P(l.amount) * (Number(pol(pid).sizeFactors?.[{ xs: 'X-Small', s: 'Small', m: 'Medium', l: 'Large', xl: 'X-Large' }[String(size).toLowerCase()] || size] ?? 1) || 1)) : P(l.amount)
      standard[ELEMENT[l.kind]] += amt * n
    }
  }
  const actual = Object.fromEntries(Object.entries(ACTUAL_KEYS).map(([k, key]) => [k, P(actualRows.find((r) => r.system_key === key)?.amount)]))
  // Labour: wages spread over the hours logged; idle hours are capacity not used
  const totalHours = hours.reduce((s, h) => s + Number(h.hours), 0)
  const idle = hours.filter((h) => h.job_type === 'idle').reduce((s, h) => s + Number(h.hours), 0)
  const rate = totalHours ? actual.labour / totalHours : null
  const byOrder = new Map()
  for (const h of hours.filter((x) => x.order_id)) { const o = byOrder.get(h.order_id) || { orderNumber: h.order_number, hours: 0 }; o.hours += Number(h.hours); byOrder.set(h.order_id, o) }
  return {
    month, from, to, pieces, uncosted,
    rows: Object.keys(ACTUAL_KEYS).map((k) => ({ element: k, standard: money(standard[k]), actual: money(actual[k]), variance: money(actual[k] - standard[k]) })),
    total: { standard: money(Object.values(standard).reduce((s, x) => s + x, 0)), actual: money(Object.values(actual).reduce((s, x) => s + x, 0)) },
    labour: { hours: totalHours, idle, rate: rate == null ? null : money(rate), idleCost: rate == null ? null : money(rate * idle),
      orders: [...byOrder.values()].map((o) => ({ ...o, cost: rate == null ? null : money(rate * o.hours) })).sort((x, y) => y.hours - x.hours) },
  }
}
