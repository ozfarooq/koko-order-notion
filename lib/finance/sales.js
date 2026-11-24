// Finance F3: keeps the books in step with orders, customer payments and reseller statements.
// For each order / reseller piece / reseller payment it works out what the books should show (posting.js)
// and compares it with what is posted: nothing to do, post it, or reverse and post the corrected entry.
// Running it again changes nothing, so the backfill and every hook can call it freely. Events before the
// go-live date are in the opening balances and are left alone. Failures go to fin_post_exceptions.
import { neon } from '@neondatabase/serverless'
import { HttpError, blank } from '../db.js'
import { toPaisa, fromPaisa } from './money.js'
import { createEntry, reverseEntry, getEntry, getSettings, listPeriods } from './ledger.js'
import { paymentLines, revenueLines, forfeitLines, resellerSaleLines, resellerPaymentLines, PAY_KEYS } from './posting.js'
import { day, isDate, today } from './expenses.js'
import { salesTaxAt, taxSettings, taxOnAt } from './tax.js'

let _sql
const db = () => (_sql ??= neon(process.env.DATABASE_URL))
const sql = (...args) => db()(...args)
const UUID = /^[0-9a-f-]{36}$/i
const P = (v) => toPaisa(v ?? 0)

let accCache = null
async function accounts() {
  accCache ??= Object.fromEntries((await sql`SELECT id, system_key FROM fin_accounts WHERE system_key IS NOT NULL`).map((a) => [a.system_key, a.id]))
  return accCache
}
let liveCache = { at: 0, v: null }
const goLive = async () => {
  if (Date.now() - liveCache.at > 30000) liveCache = { at: Date.now(), v: (await getSettings()).goLiveDate }
  return liveCache.v
}

// ── Comparing and correcting ───────────────────────────────────────────
const toEntryLines = (lines) => lines.map((l) => ({ ...l, debit: fromPaisa(l.debit), credit: fromPaisa(l.credit) }))
const sig = (lines) => lines.map((l) => [l.accountId, fromPaisa(P(l.debit)), fromPaisa(P(l.credit)), l.partyType || '', l.partyId || '', l.currency || 'PKR',
  l.amountFc ? Number(l.amountFc).toFixed(2) : '', l.taxCode || ''].join('|')).sort().join('\n')

async function activeEntry(type, id, event) {
  const [e] = await sql`SELECT id FROM fin_entries WHERE source_type = ${type} AND source_id = ${String(id)} AND source_event = ${event} AND status = 'Posted'`
  return e ? getEntry(e.id) : null
}
async function reverseQuietly(entry, on, reason, user) {
  // On the given date; if that month is closed, today
  try { return await reverseEntry(entry.id, { date: on, reason }, user) } catch (err) {
    if (!/closed|locked|period/i.test(err.message) || on === today()) throw err
    return reverseEntry(entry.id, { date: today(), reason }, user)
  }
}
// desired: { date, entryType, memo, lines (paisa) } or null. Returns 'same' | 'posted' | 'reversed' | 'none'
// known: the active entry id when already looked up (null = none), undefined = look it up
async function reconcile(source, desired, { reverseOn, reason, known }, user) {
  const active = known === undefined ? await activeEntry(source.type, source.id, source.event) : known ? await getEntry(known) : null
  if (!desired && !active) return 'none'
  if (!desired) {
    await reverseQuietly(active, reverseOn && reverseOn > active.date ? reverseOn : active.date, reason, user)
    return 'reversed'
  }
  const lines = toEntryLines(desired.lines)
  if (active && active.date === desired.date && sig(active.lines) === sig(lines) && (active.memo || '') === (desired.memo || '')) return 'same'
  if (active) await reverseQuietly(active, active.date, `Corrected: ${reason}`, user)
  await createEntry({ date: desired.date, entryType: desired.entryType, memo: desired.memo, post: true, source, lines }, user)
  return 'posted'
}

// ── Exceptions ─────────────────────────────────────────────────────────
async function noteException(type, id, label, err) {
  await sql`INSERT INTO fin_post_exceptions (source_type, source_id, label, error) VALUES (${type}, ${String(id)}, ${label}, ${err.message})
    ON CONFLICT (source_type, source_id) DO UPDATE SET error = EXCLUDED.error, label = EXCLUDED.label, attempts = fin_post_exceptions.attempts + 1, last_at = now()`
}
const clearException = (type, id) => sql`DELETE FROM fin_post_exceptions WHERE source_type = ${type} AND source_id = ${String(id)}`
export async function listExceptions() {
  const rows = await sql`SELECT * FROM fin_post_exceptions ORDER BY last_at DESC`
  return rows.map((r) => ({ sourceType: r.source_type, sourceId: r.source_id, label: r.label, error: r.error, attempts: r.attempts, firstAt: r.first_at, lastAt: r.last_at }))
}

// For hooks: never throws; a failure is kept for a retry
export async function afterOrderChange(orderId, user) {
  try { return await syncOrder(orderId, user) } catch (err) { await noteException('order', orderId, null, err).catch(() => {}); return { error: err.message } }
}
export async function afterResellerChange(resellerId, user) {
  try { return await syncReseller(resellerId, user) } catch (err) { await noteException('reseller', resellerId, null, err).catch(() => {}); return { error: err.message } }
}

// ── Orders and customer payments ───────────────────────────────────────
// Damaged studio pieces and shoot samples the order was filled from: their line prices go to 4500
async function specialPaisa(orderId) {
  const rows = await sql`
    SELECT s.product_id, s.size, (SELECT oi.unit_price_pkr FROM order_items oi WHERE oi.order_id = s.order_id AND oi.product_id = s.product_id
             ORDER BY (oi.size IS NOT DISTINCT FROM s.size) DESC, oi.id LIMIT 1) AS price
    FROM stock_pieces s WHERE s.order_id = ${orderId} AND (s.damaged OR s.kind = 'Sample')`
  return rows.reduce((t, r) => t + P(r.price), 0)
}

export async function syncOrder(orderId, user) {
  if (!UUID.test(orderId || '')) throw new HttpError(400, 'Unknown order')
  const [o] = await sql`
    SELECT o.id, o.order_number, o.order_type, o.status, o.channel, o.amount_pkr, o.customer_id, o.paid_on::text AS paid_on,
           o.status_changed_on::text AS status_changed_on, c.name AS customer
    FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ${orderId}`
  if (!o) return { order: null }
  const acc = await accounts(), live = await goLive()
  const label = `${o.order_number} · ${o.customer}`
  const result = { order: o.order_number, payments: [], revenue: null }

  // Payments (each its own receipt entry); payments deleted since are reversed
  const pays = await sql`SELECT id, paid_on::text AS paid_on, amount, method, reference FROM customer_payments WHERE order_id = ${o.id} ORDER BY paid_on, id`
  const payIds = pays.map((p) => String(p.id))
  const activeRows = await sql`
    SELECT e.id, e.source_type, e.source_id, e.source_event FROM fin_entries e WHERE e.status = 'Posted' AND (
      (e.source_type = 'order' AND e.source_id = ${o.id}) OR (e.source_type = 'customer_payment' AND e.source_id = ANY(${payIds}::text[]))
      OR (e.source_type = 'customer_payment' AND EXISTS (SELECT 1 FROM fin_lines l WHERE l.entry_id = e.id AND l.order_id = ${o.id})))`
  const known = (type, id, event) => activeRows.find((e) => e.source_type === type && e.source_id === String(id) && e.source_event === event)?.id ?? null
  for (const p of pays) {
    const desired = o.order_type === 'Sale' && p.paid_on >= live ? {
      date: p.paid_on, entryType: 'RC', memo: `${P(p.amount) > 0 ? 'Payment' : 'Refund'}: ${label}`,
      lines: paymentLines({ amount: P(p.amount), method: p.method, orderId: o.id, customerId: o.customer_id, orderNumber: o.order_number, reference: p.reference }, acc),
    } : null
    result.payments.push(await reconcile({ type: 'customer_payment', id: p.id, event: 'received' }, desired,
      { reason: `${o.order_number} payment changed`, known: known('customer_payment', p.id, 'received') }, user))
  }
  // Payments deleted since they were posted
  for (const g of activeRows.filter((e) => e.source_type === 'customer_payment' && !payIds.includes(e.source_id)))
    await reverseQuietly(await getEntry(g.id), today(), `${o.order_number}: payment removed`, user)

  // Revenue once Paid (and not returned or cancelled)
  const earned = o.order_type === 'Sale' && o.paid_on && o.paid_on >= live && (o.status === 'Paid' || o.status === 'Out for Delivery')
  const revenue = earned ? revenueLines({ amount: P(o.amount_pkr), channel: o.channel, orderId: o.id, customerId: o.customer_id, orderNumber: o.order_number, specialPaisa: await specialPaisa(o.id) }, acc, await salesTaxAt(o.paid_on)) : null
  result.revenue = await reconcile({ type: 'order', id: o.id, event: 'revenue' },
    revenue ? { date: o.paid_on, entryType: 'SI', memo: `Sale: ${label}`, lines: revenue } : null,
    { reverseOn: o.status_changed_on, reason: earned ? `${o.order_number} changed` : `${o.order_number} is ${o.status.toLowerCase()}`, known: known('order', o.id, 'revenue') }, user)
  await clearException('order', o.id)
  return result
}

// Keeping the advance of a cancelled order instead of refunding it (owner, with a reason)
export async function keepAdvance(orderId, { reason, date } = {}, user) {
  if (user?.role !== 'owner') throw new HttpError(403, 'Only an owner can keep an advance')
  if (!blank(reason)) throw new HttpError(400, 'Say why the advance is kept')
  const [o] = await sql`SELECT o.id, o.order_number, o.status, o.customer_id, o.advance_paid_pkr, c.name FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ${orderId}`
  if (!o) throw new HttpError(404, 'Order not found')
  if (o.status !== 'Cancelled') throw new HttpError(400, 'Only a cancelled order\'s advance can be kept')
  if (P(o.advance_paid_pkr) <= 0) throw new HttpError(400, 'There is no advance on this order')
  const on = date || today()
  await createEntry({ date: on, entryType: 'JV', memo: `Advance kept: ${o.order_number} · ${o.name}: ${reason}`, post: true,
    source: { type: 'order', id: o.id, event: 'forfeit' }, lines: toEntryLines(forfeitLines({ amount: P(o.advance_paid_pkr), orderId: o.id, customerId: o.customer_id, orderNumber: o.order_number }, await accounts())) }, user)
  return orderFinance(o.id)
}

// Customer payments: the order's Payments card
const rowToPayment = (p) => ({ id: p.id, orderId: p.order_id, paidOn: day(p.paid_on), amount: fromPaisa(P(p.amount)), method: p.method, methodConfirmed: p.method_confirmed,
  reference: p.reference || '', notes: p.notes || '', source: p.source, createdBy: p.created_by_name || '', entryNo: p.entry_no || '', entryId: p.entry_id || null })
export async function listPayments(orderId) {
  const rows = await sql`
    SELECT p.*, u.name AS created_by_name, e.id AS entry_id, e.entry_no
    FROM customer_payments p LEFT JOIN users u ON u.id = p.created_by
    LEFT JOIN fin_entries e ON e.source_type = 'customer_payment' AND e.source_id = p.id::text AND e.status = 'Posted'
    WHERE p.order_id = ${orderId} ORDER BY p.paid_on, p.id`
  return rows.map(rowToPayment)
}
function paymentFields(b) {
  if (!isDate(b.paidOn)) throw new HttpError(400, 'Payment date is required')
  if (!PAY_KEYS[b.method]) throw new HttpError(400, 'Say how it was paid')
  let amount
  try { amount = toPaisa(b.amount) } catch (err) { throw new HttpError(400, `Amount: ${err.message}`) }
  if (!amount) throw new HttpError(400, 'Enter the amount (a refund is a negative amount)')
  return { paidOn: b.paidOn, method: b.method, amount: fromPaisa(amount), reference: blank(b.reference), notes: blank(b.notes) }
}
async function payableOrder(orderId) {
  const [o] = await sql`SELECT id, order_type FROM orders WHERE id = ${orderId}`
  if (!o) throw new HttpError(404, 'Order not found')
  if (o.order_type === 'PR') throw new HttpError(400, 'PR / gift orders have no payments')
  return o
}
export async function addPayment(orderId, b, user) {
  if (!UUID.test(orderId || '')) throw new HttpError(400, 'Unknown order')
  await payableOrder(orderId)
  const f = paymentFields(b)
  await sql`INSERT INTO customer_payments (order_id, paid_on, amount, method, reference, notes, created_by)
    VALUES (${orderId}, ${f.paidOn}::date, ${f.amount}::numeric, ${f.method}, ${f.reference}, ${f.notes}, ${user?.id ?? null})`
  await afterOrderChange(orderId, user)
  return listPayments(orderId)
}
export async function updatePayment(id, b, user) {
  const [cur] = await sql`SELECT * FROM customer_payments WHERE id = ${Number(id) || 0}`
  if (!cur) throw new HttpError(404, 'Payment not found')
  const f = paymentFields({ paidOn: day(cur.paid_on), method: cur.method, amount: cur.amount, reference: cur.reference, notes: cur.notes, ...b })
  await sql`UPDATE customer_payments SET paid_on = ${f.paidOn}::date, amount = ${f.amount}::numeric, method = ${f.method}, method_confirmed = true,
    reference = ${f.reference}, notes = ${f.notes} WHERE id = ${cur.id}`
  await afterOrderChange(cur.order_id, user)
  return listPayments(cur.order_id)
}
export async function deletePayment(id, user) {
  const [cur] = await sql`DELETE FROM customer_payments WHERE id = ${Number(id) || 0} RETURNING order_id`
  if (!cur) throw new HttpError(404, 'Payment not found')
  await afterOrderChange(cur.order_id, user)
  return listPayments(cur.order_id)
}

// What finance knows about one order (Order detail; entry numbers only for finance users)
export async function orderFinance(orderId, { withEntries = false } = {}) {
  if (!UUID.test(orderId || '')) throw new HttpError(400, 'Unknown order')
  const [payments, [exc], entries] = await Promise.all([
    listPayments(orderId),
    sql`SELECT error FROM fin_post_exceptions WHERE source_type = 'order' AND source_id = ${orderId}`,
    withEntries ? sql`SELECT e.id, e.entry_no, e.entry_type, e.entry_date::text AS date, e.status, e.memo FROM fin_entries e
      WHERE e.status <> 'Draft' AND EXISTS (SELECT 1 FROM fin_lines l WHERE l.entry_id = e.id AND l.order_id = ${orderId}) ORDER BY e.entry_date, e.id` : [],
  ])
  return {
    payments: withEntries ? payments : payments.map(({ entryNo, entryId, ...p }) => p),
    postingError: exc?.error || null,
    entries: entries.map((e) => ({ id: e.id, entryNo: e.entry_no, type: e.entry_type, date: e.date, status: e.status, memo: e.memo })),
  }
}

// ── Resellers ──────────────────────────────────────────────────────────
// The rate for a currency on a date: the latest entered on or before it
export async function rateOn(currency, date) {
  if (currency === 'PKR') return 1
  const [r] = await sql`SELECT rate_to_pkr FROM fin_fx_rates WHERE currency = ${currency} AND rate_date <= ${date}::date ORDER BY rate_date DESC LIMIT 1`
  if (!r) throw new HttpError(400, `No ${currency} rate on or before ${date}: add it in Finance › Sales & receipts › Exchange rates`)
  return Number(r.rate_to_pkr)
}
// A sale whose month is closed goes into the next open month, with the sale month in the memo (C5d)
async function openDateFor(date) {
  const periods = (await listPeriods()).filter((p) => !p.isAdjustment)
  const p = periods.find((x) => date >= x.startsOn && date <= x.endsOn)
  if (!p || p.status === 'Open') return date
  const next = periods.filter((x) => x.status === 'Open' && x.startsOn > date).sort((a, b) => (a.startsOn < b.startsOn ? -1 : 1))[0]
  if (!next) throw new HttpError(400, `${p.name} is ${p.status.toLowerCase()} and there is no open month after it`)
  return next.startsOn
}
const monthName = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

export async function syncReseller(resellerId, user) {
  const rid = Number(resellerId)
  const [r] = await sql`SELECT id, name, currency FROM resellers WHERE id = ${rid || 0}`
  if (!r) throw new HttpError(404, 'Reseller not found')
  const acc = await accounts(), live = await goLive()
  const problems = []
  const result = { reseller: r.name, sales: {}, payments: {} }
  const tally = (o, k) => { o[k] = (o[k] || 0) + 1 }

  // Pieces sold
  const items = await sql`
    SELECT d.id, d.product_id, d.product_name, d.size, d.reseller_code, d.status, d.sold_on::text AS sold_on, d.returned_on::text AS returned_on,
           d.price, d.designer_discount, d.reseller_discount, d.alteration_charge, d.commission_pct, d.currency
    FROM consignment_items_detail d WHERE d.reseller_id = ${rid}`
  const pays = await sql`SELECT id, paid_on::text AS paid_on, amount, currency, amount_pkr, reference, difference_reason, period::text AS period FROM reseller_payments WHERE reseller_id = ${rid}`
  const activeRows = await sql`SELECT id, source_type, source_id FROM fin_entries WHERE status = 'Posted' AND (
    (source_type = 'reseller_item' AND source_id = ANY(${items.map((i) => String(i.id))}::text[])) OR (source_type = 'reseller_payment' AND source_id = ANY(${pays.map((p) => String(p.id))}::text[])))`
  const known = (type, id) => activeRows.find((e) => e.source_type === type && e.source_id === String(id))?.id ?? null
  for (const i of items) {
    try {
      const sold = ['Sold', 'Paid'].includes(i.status) && i.sold_on && i.sold_on >= live
      let desired = null
      if (sold) {
        const rate = await rateOn(i.currency, i.sold_on)
        const built = resellerSaleLines({ id: i.id, resellerId: rid, productId: i.product_id, product: i.product_name, size: i.size, code: i.reseller_code,
          price: P(i.price), designerDiscount: P(i.designer_discount), resellerDiscount: P(i.reseller_discount), alteration: P(i.alteration_charge),
          commissionPct: Number(i.commission_pct), currency: i.currency }, rate, acc, taxOnAt(await taxSettings(), i.sold_on))
        if (built) {
          const date = await openDateFor(i.sold_on)
          desired = { date, entryType: 'SI', lines: built.lines,
            memo: `${r.name} sale: ${i.product_name}${i.size ? ` (${i.size})` : ''}${date !== i.sold_on ? `, sold ${monthName(i.sold_on)}` : ''}` }
        }
      }
      tally(result.sales, await reconcile({ type: 'reseller_item', id: i.id, event: 'sold' }, desired,
        { reverseOn: i.returned_on || today(), reason: `${i.product_name} is ${i.status.toLowerCase()}`, known: known('reseller_item', i.id) }, user))
    } catch (err) { problems.push(`${i.product_name}${i.size ? ` (${i.size})` : ''}: ${err.message}`) }
  }
  const ids = items.map((i) => String(i.id))
  const goneItems = await sql`
    SELECT DISTINCT e.id FROM fin_entries e JOIN fin_lines l ON l.entry_id = e.id
    WHERE e.source_type = 'reseller_item' AND e.status = 'Posted' AND l.party_type = 'reseller' AND l.party_id = ${String(rid)} AND NOT (e.source_id = ANY(${ids}::text[]))`
  for (const g of goneItems) await reverseQuietly(await getEntry(g.id), today(), 'Piece removed from the reseller', user)

  // Payments received: clear what those pieces were booked at; the rest is an exchange difference
  for (const p of pays) {
    try {
      let desired = null
      if (p.paid_on >= live) {
        const amountPkr = p.amount_pkr != null ? P(p.amount_pkr) : Math.round(P(p.amount) * (await rateOn(p.currency, p.paid_on)))
        const linked = await sql`SELECT d.id, d.sold_on::text AS sold_on, d.net_to_koko, d.product_name FROM consignment_items_detail d
          JOIN consignment_items ci ON ci.id = d.id WHERE ci.payment_id = ${p.id}`
        let booked = 0
        for (const x of linked) {
          if (x.sold_on && x.sold_on >= live) {
            const sale = await activeEntry('reseller_item', x.id, 'sold')
            if (!sale) throw new Error(`${x.product_name}: its sale isn't posted yet`)
            booked += sale.lines.filter((l) => l.accountId === acc.ar_resellers).reduce((s, l) => s + P(l.debit) - P(l.credit), 0)
          } else {
            // Sold before go-live: in the opening receivable; cleared at this payment's own rate (no difference)
            booked += Math.round(P(x.net_to_koko) * (amountPkr / P(p.amount)))
          }
        }
        if (!linked.length) booked = amountPkr
        desired = { date: await openDateFor(p.paid_on), entryType: 'RC',
          memo: `${r.name} payment${p.period ? ` for ${monthName(p.period)}` : ''}${p.difference_reason ? `: ${p.difference_reason}` : ''}`,
          lines: resellerPaymentLines({ resellerId: rid, resellerName: r.name, reference: p.reference, amountPkr, amountFils: P(p.amount), currency: p.currency, differenceReason: p.difference_reason }, booked, acc) }
      }
      tally(result.payments, await reconcile({ type: 'reseller_payment', id: p.id, event: 'received' }, desired, { reason: 'Reseller payment changed', known: known('reseller_payment', p.id) }, user))
    } catch (err) { problems.push(`Payment of ${p.paid_on}: ${err.message}`) }
  }
  const goneP = await sql`SELECT id FROM fin_entries WHERE source_type = 'reseller_payment' AND status = 'Posted'
    AND NOT (source_id = ANY(${pays.map((p) => String(p.id))}::text[])) AND id IN (SELECT entry_id FROM fin_lines WHERE party_type = 'reseller' AND party_id = ${String(rid)})`
  for (const g of goneP) await reverseQuietly(await getEntry(g.id), today(), 'Reseller payment removed', user)

  if (problems.length) {
    const err = new Error(problems.join('; '))
    await noteException('reseller', rid, r.name, err)
    throw err
  }
  await clearException('reseller', rid)
  return result
}

// ── Everything (backfill, "sync now") ──────────────────────────────────
// In batches so a request stays short: orders after `after` (by id), then resellers
export async function syncBatch({ after = '', limit = 25 } = {}, user) {
  const orders = await sql`SELECT id, order_number FROM orders WHERE id::text > ${after} ORDER BY id::text LIMIT ${Math.min(Number(limit) || 25, 100)}`
  const out = { done: 0, failed: [], next: null }
  const one = async (o) => {
    try { await syncOrder(o.id, user); out.done++ } catch (err) { out.failed.push({ label: o.order_number, error: err.message }); await noteException('order', o.id, o.order_number, err) }
  }
  for (let i = 0; i < orders.length; i += 6) await Promise.all(orders.slice(i, i + 6).map(one))   // six at a time
  if (orders.length === Math.min(Number(limit) || 25, 100)) { out.next = String(orders[orders.length - 1].id); return out }
  for (const r of await sql`SELECT id, name FROM resellers ORDER BY id`) {
    try { await syncReseller(r.id, user); out.done++ } catch (err) { out.failed.push({ label: r.name, error: err.message }) }
  }
  return out
}
export async function retryException(type, id, user) {
  if (type === 'order') return syncOrder(id, user)
  if (type === 'reseller') return syncReseller(id, user)
  throw new HttpError(400, 'Unknown item')
}

// ── Exchange rates ─────────────────────────────────────────────────────
export async function listRates() {
  const rows = await sql`SELECT rate_date::text AS date, currency, rate_to_pkr FROM fin_fx_rates ORDER BY rate_date DESC, currency LIMIT 400`
  // Reseller sale / payment dates since go-live with no rate on or before them
  const live = await goLive()
  const missing = await sql`
    SELECT DISTINCT d::text AS date, cur FROM (
      SELECT ci.sold_on AS d, r.currency AS cur FROM consignment_items ci JOIN consignments c ON c.id = ci.consignment_id JOIN resellers r ON r.id = c.reseller_id
      WHERE ci.sold_on >= ${live}::date AND ci.status IN ('Sold', 'Paid') AND r.currency <> 'PKR'
      UNION SELECT paid_on, currency FROM reseller_payments WHERE paid_on >= ${live}::date AND amount_pkr IS NULL AND currency <> 'PKR'
    ) x WHERE NOT EXISTS (SELECT 1 FROM fin_fx_rates f WHERE f.currency = x.cur AND f.rate_date <= x.d) ORDER BY 1`
  const hints = await sql`SELECT paid_on::text AS date, currency, round(amount_pkr / amount, 4) AS rate FROM reseller_payments WHERE amount_pkr IS NOT NULL AND amount > 0 ORDER BY paid_on DESC LIMIT 12`
  return {
    rates: rows.map((r) => ({ date: r.date, currency: r.currency, rate: Number(r.rate_to_pkr) })),
    missing: missing.map((m) => ({ date: m.date, currency: m.cur })),
    paymentRates: hints.map((h) => ({ date: h.date, currency: h.currency, rate: Number(h.rate) })),
  }
}
export async function setRate({ date, currency, rate }) {
  if (!isDate(date)) throw new HttpError(400, 'Rate date is required')
  const cur = String(currency || '').toUpperCase()
  if (!/^[A-Z]{3}$/.test(cur) || cur === 'PKR') throw new HttpError(400, 'Currency is a 3-letter code other than PKR')
  if (!(Number(rate) > 0)) throw new HttpError(400, 'Rate must be more than zero')
  await sql`INSERT INTO fin_fx_rates (rate_date, currency, rate_to_pkr) VALUES (${date}::date, ${cur}, ${Number(rate)})
    ON CONFLICT (rate_date, currency) DO UPDATE SET rate_to_pkr = EXCLUDED.rate_to_pkr`
  return listRates()
}
export async function deleteRate({ date, currency }) {
  await sql`DELETE FROM fin_fx_rates WHERE rate_date = ${date}::date AND currency = ${String(currency).toUpperCase()}`
  return listRates()
}

// ── Receivables: what customers and resellers owe, and advances held ──
export async function receivables() {
  const acc = await accounts()
  const [ageing, resellerLedger, open, advancesLedger, cancelled] = await Promise.all([
    sql`
      SELECT r.id, r.name, r.currency,
        sum(d.net_to_koko) FILTER (WHERE current_date - d.sold_on <= 30) AS b30,
        sum(d.net_to_koko) FILTER (WHERE current_date - d.sold_on BETWEEN 31 AND 60) AS b60,
        sum(d.net_to_koko) FILTER (WHERE current_date - d.sold_on BETWEEN 61 AND 90) AS b90,
        sum(d.net_to_koko) FILTER (WHERE current_date - d.sold_on > 90 OR d.sold_on IS NULL) AS b90p,
        sum(d.net_to_koko) AS total, count(*)::int AS pieces
      FROM consignment_items_detail d JOIN resellers r ON r.id = d.reseller_id
      WHERE d.status = 'Sold' GROUP BY r.id, r.name, r.currency ORDER BY r.name`,
    sql`SELECT l.party_id, sum(l.debit - l.credit) AS net FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'Draft'
        WHERE l.account_id = ${acc.ar_resellers} GROUP BY l.party_id`,
    sql`SELECT o.id, o.order_number, o.status, o.order_date::text AS order_date, o.amount_pkr, o.advance_paid_pkr, o.balance_due_pkr, c.id AS customer_id, c.name
        FROM orders o JOIN customers c ON c.id = o.customer_id
        WHERE o.order_type = 'Sale' AND o.status NOT IN ('Paid', 'Cancelled', 'Returned') ORDER BY o.order_date`,
    sql`SELECT coalesce(sum(l.credit - l.debit), 0) AS net FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'Draft' WHERE l.account_id = ${acc.customer_advances}`,
    sql`SELECT o.id, o.order_number, o.status, o.advance_paid_pkr, c.name,
          EXISTS (SELECT 1 FROM fin_entries e WHERE e.source_type = 'order' AND e.source_id = o.id::text AND e.source_event = 'forfeit' AND e.status = 'Posted') AS kept
        FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.status IN ('Cancelled', 'Returned') AND o.advance_paid_pkr > 0`,
  ])
  const ledger = Object.fromEntries(resellerLedger.map((x) => [x.party_id, fromPaisa(P(x.net))]))
  const m = (v) => fromPaisa(P(v))
  return {
    resellers: ageing.map((a) => ({ id: a.id, name: a.name, currency: a.currency, pieces: a.pieces, b30: m(a.b30), b60: m(a.b60), b90: m(a.b90), b90p: m(a.b90p), total: m(a.total), ledgerPkr: ledger[String(a.id)] || '0.00' })),
    openOrders: open.map((o) => ({ id: o.id, orderNumber: o.order_number, status: o.status, orderDate: o.order_date, customerId: o.customer_id, customer: o.name,
      amount: m(o.amount_pkr), advance: m(o.advance_paid_pkr), balance: m(o.balance_due_pkr) })),
    advancesHeldCrm: fromPaisa(open.reduce((s, o) => s + P(o.advance_paid_pkr), 0) + cancelled.filter((c) => !c.kept).reduce((s, c) => s + P(c.advance_paid_pkr), 0)),
    advancesLedger: m(advancesLedger[0].net),
    refundsDue: cancelled.filter((c) => !c.kept).map((c) => ({ id: c.id, orderNumber: c.order_number, status: c.status, customer: c.name, advance: m(c.advance_paid_pkr) })),
  }
}

// A reseller piece edited on its own (price, discounts, status)
export async function afterPieceChange(itemId, user) {
  const [r] = await sql`SELECT c.reseller_id FROM consignment_items ci JOIN consignments c ON c.id = ci.consignment_id WHERE ci.id = ${itemId}`.catch(() => [])
  if (r) return afterResellerChange(r.reseller_id, user)
}
// A new rate may unblock reseller sales that were waiting for it
export async function afterRatesChange(user) {
  for (const x of await sql`SELECT source_id FROM fin_post_exceptions WHERE source_type = 'reseller'`) await afterResellerChange(x.source_id, user)
}
