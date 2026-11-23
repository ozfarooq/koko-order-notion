// F3: sales, customer payments and reseller posting (migration 018, lib/finance/posting.js + sales.js).
// Runs ONLY on koko_finance_dev. Orders use today's date (an open month of the current year in dev);
// the reseller tests use fiscal year 2093-94 (created as needed). Names carry a run stamp.
// Run: npm run test:finance
import { test, before } from 'node:test'
import assert from 'node:assert/strict'

const devUrl = process.env.FINANCE_DEV_DATABASE_URL
if (!devUrl || new URL(devUrl).pathname !== '/koko_finance_dev') throw new Error('FINANCE_DEV_DATABASE_URL must point at koko_finance_dev')
process.env.DATABASE_URL = devUrl

const { neon } = await import('@neondatabase/serverless')
const { toPaisa } = await import('../../lib/finance/money.js')
const ledger = await import('../../lib/finance/ledger.js')
const posting = await import('../../lib/finance/posting.js')
const sales = await import('../../lib/finance/sales.js')
const db = await import('../../lib/db.js')
const sql = neon(devUrl)

const RUN = Date.now().toString(36)
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })
let owner, acct, product
const fails = async (p, re) => { try { await p } catch (err) { if (re) assert.match(err.message, re); return err } assert.fail('expected an error') }
const ACC = new Proxy({}, { get: (_, k) => acct[k]?.id })

async function ensureFY(date) {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7)), s = m >= 7 ? y : y - 1
  const fy = `${s}-${String((s + 1) % 100).padStart(2, '0')}`
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM fin_periods WHERE fiscal_year = ${fy}`
  if (!n) {
    await sql`INSERT INTO fin_periods (fiscal_year, period_no, name, starts_on, ends_on, is_adjustment)
              SELECT ${fy}, g, to_char(m, 'Mon YYYY'), m::date, (m + interval '1 month - 1 day')::date, false
              FROM generate_series(1, 12) g, LATERAL (SELECT ${`${s}-07-01`}::date + (g - 1) * interval '1 month' AS m) x`
    await sql`INSERT INTO fin_periods (fiscal_year, period_no, name, starts_on, ends_on, is_adjustment) VALUES (${fy}, 13, ${`Adjustments ${fy}`}, ${`${s + 1}-06-30`}::date, ${`${s + 1}-06-30`}::date, true)`
  }
  await sql`UPDATE fin_periods SET status = 'Open' WHERE fiscal_year = ${fy}`
}
// The order's balance on an account (debit minus credit), paisa
const orderNet = async (key, orderId) => toPaisa((await sql`SELECT coalesce(sum(l.debit - l.credit), 0) AS n FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'Draft'
  WHERE l.account_id = ${ACC[key]} AND l.order_id = ${orderId}`)[0].n)
const activeFor = async (type, id, event) => (await sql`SELECT id FROM fin_entries WHERE source_type = ${type} AND source_id = ${String(id)} AND source_event = ${event} AND status = 'Posted'`)[0]?.id
const newOrder = (o = {}) => db.createOrder({ customer: `TEST F3 ${RUN} ${Math.random().toString(36).slice(2, 6)}`, channel: 'Studio', orderDate: TODAY,
  items: [{ productId: product.id, size: 'M', quantity: 1, unitPrice: o.amount ?? 12000 }], amount: o.amount ?? 12000, advancePaid: 0, ...o }, owner)

before(async () => {
  await sql`INSERT INTO users (username, name, role, password_hash) SELECT 'fin_test_owner', 'fin_test_owner', 'owner', 'x' WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(username) = 'fin_test_owner')`
  ;[owner] = await sql`SELECT id, username, role FROM users WHERE username = 'fin_test_owner'`
  acct = Object.fromEntries((await sql`SELECT id, code, system_key FROM fin_accounts WHERE system_key IS NOT NULL`).map((a) => [a.system_key, a]))
  ;[product] = await sql`SELECT id, name FROM products ORDER BY id LIMIT 1`
  await ensureFY(TODAY); await ensureFY('2093-08-01')
})

// ── Rules ──────────────────────────────────────────────────────────────
test('rules: revenue by channel with damaged / sample pieces apart; refunds reverse a receipt', () => {
  const acc = { customer_advances: 1, sales_retail: 2, sales_web: 3, sales_damaged: 4, bank_baf: 5, cash_studio: 6, clearing_trax: 7 }
  const web = posting.revenueLines({ amount: 2000000, channel: 'Shopify', specialPaisa: 500000, orderId: 'o', customerId: 'c', orderNumber: 'SO-1' }, acc)
  assert.deepEqual(web.map((l) => [l.accountId, l.debit, l.credit]), [[1, 2000000, 0], [3, 0, 1500000], [4, 0, 500000]])
  assert.equal(posting.revenueLines({ amount: 0 }, acc), null)
  const refund = posting.paymentLines({ amount: -300000, method: 'cash', orderId: 'o', customerId: 'c', orderNumber: 'SO-1' }, acc)
  assert.deepEqual(refund.map((l) => [l.accountId, l.debit, l.credit]), [[1, 300000, 0], [6, 0, 300000]])
})

test('rules: a reseller sale matches the reseller view figures and balances; the payment shows the exchange difference', () => {
  const acc = { ar_resellers: 1, reseller_commission: 2, reseller_alteration: 3, sales_reseller: 4, bank_baf: 5, fx_gain: 6, fx_loss: 7 }
  // AED 600, discounts 50 + 25, commission 30%, alteration 20
  const piece = { id: 'p', resellerId: 1, productId: 9, product: 'Neel', price: 60000, designerDiscount: 5000, resellerDiscount: 2500, alteration: 2000, commissionPct: 30, currency: 'AED' }
  const f = posting.pieceFigures(piece)
  assert.deepEqual(f, { net: 52500, commission: 15750, alteration: 2000, toKoko: 34750 })
  const { lines, receivable } = posting.resellerSaleLines(piece, 75.5, acc)
  const dr = lines.reduce((s, l) => s + l.debit, 0), cr = lines.reduce((s, l) => s + l.credit, 0)
  assert.equal(dr, cr); assert.equal(cr, Math.round(52500 * 75.5))
  assert.equal(lines.find((l) => l.accountId === 1).amountFc, '347.50')
  const pay = posting.resellerPaymentLines({ resellerId: 1, resellerName: 'X', amountPkr: 2600000, amountFils: 34750, currency: 'AED' }, receivable, acc)
  assert.equal(pay.reduce((s, l) => s + l.debit, 0), pay.reduce((s, l) => s + l.credit, 0))
  assert.ok(pay.some((l) => l.accountId === 7), 'received less in rupees than booked: exchange loss')
})

// ── Payments and the order screens ─────────────────────────────────────
test('the order screens still work: changes to the advance become payment rows, and the advance is their sum', async () => {
  const o = await newOrder({ advancePaid: 4000 })
  let rows = await sql`SELECT amount, source, method_confirmed FROM customer_payments WHERE order_id = ${o.id}`
  assert.equal(rows.length, 1); assert.equal(rows[0].amount, '4000.00'); assert.equal(rows[0].source, 'order_screen'); assert.equal(rows[0].method_confirmed, false)
  await db.updateOrder(o.id, { advancePaid: 6500 }, owner)
  rows = await sql`SELECT amount FROM customer_payments WHERE order_id = ${o.id} ORDER BY id`
  assert.deepEqual(rows.map((r) => r.amount), ['4000.00', '2500.00'])
  await sales.addPayment(o.id, { paidOn: TODAY, amount: '500', method: 'cash', reference: 'T1' }, owner)
  assert.equal((await db.getOrder(o.id)).advancePaid, 7000)
  const pays = await sales.listPayments(o.id)
  await sales.deletePayment(pays[0].id, owner)
  assert.equal((await db.getOrder(o.id)).advancePaid, 3000)
  await fails(sales.addPayment(o.id, { paidOn: TODAY, amount: '0', method: 'bank' }, owner), /amount/)
})

test('an order: advances post to 2200, Paid posts the sale and clears them; a second sync changes nothing', async () => {
  const o = await newOrder({ advancePaid: 5000 })
  await sales.syncOrder(o.id, owner)
  assert.equal(await orderNet('customer_advances', o.id), -500000)
  assert.equal(await orderNet('bank_baf', o.id), 500000)
  await db.updateOrder(o.id, { status: 'Paid' }, owner)            // the screens settle the balance: a 7,000 payment row
  await sales.syncOrder(o.id, owner)
  const got = await db.getOrder(o.id)
  assert.equal(got.paidOn, TODAY); assert.equal(got.advancePaid, 12000)
  assert.equal(await orderNet('customer_advances', o.id), 0)
  assert.equal(await orderNet('sales_retail', o.id), -1200000)
  const n = (await sql`SELECT count(*)::int AS n FROM fin_entries`)[0].n
  const again = await sales.syncOrder(o.id, owner)
  assert.deepEqual(again.payments, ['same', 'same']); assert.equal(again.revenue, 'same')
  assert.equal((await sql`SELECT count(*)::int AS n FROM fin_entries`)[0].n, n)
  // a correction after Paid: the sale is reversed and posted again at the new amount
  const first = await activeFor('order', o.id, 'revenue')
  await db.updateOrder(o.id, { amount: 13000 }, owner)
  await sales.syncOrder(o.id, owner)
  assert.equal((await ledger.getEntry(first)).status, 'Reversed')
  assert.equal(await orderNet('sales_retail', o.id), -1300000)
  assert.equal(await orderNet('customer_advances', o.id), 100000, 'the customer still owes 1,000')
  // returned: the sale comes off; the refund is a negative payment
  await db.updateOrder(o.id, { status: 'Returned' }, owner)
  await sales.syncOrder(o.id, owner)
  assert.equal(await orderNet('sales_retail', o.id), 0)
  await sales.addPayment(o.id, { paidOn: TODAY, amount: '-12000', method: 'bank', reference: 'REFUND' }, owner)
  assert.equal(await orderNet('customer_advances', o.id), 0)
  assert.equal(await orderNet('bank_baf', o.id), 0)
  await fails(db.deleteOrder(o.id), /in the accounts/)
  // what the order page shows: every payment, and (for finance users) the entries
  const fin = await sales.orderFinance(o.id, { withEntries: true })
  assert.equal(fin.payments.length, 3); assert.ok(fin.payments.every((p) => p.entryNo))
  assert.ok(fin.entries.some((e) => e.status === 'Reversed') && fin.entries.length >= 6)
  assert.ok((await sales.orderFinance(o.id)).payments.every((p) => p.entryNo === undefined), 'no entry numbers without finance access')
})

test('payment method corrections repost; website orders go to 4110; damaged and sample pieces to 4500', async () => {
  const o = await newOrder({ channel: 'Shopify', shopifyOrderNumber: `#9${Date.now().toString().slice(-6)}`, advancePaid: 3000 })
  await sales.syncOrder(o.id, owner)
  const [p] = await sales.listPayments(o.id)
  await sales.updatePayment(p.id, { method: 'trax_cod' }, owner)
  assert.equal(await orderNet('bank_baf', o.id), 0); assert.equal(await orderNet('clearing_trax', o.id), 300000)
  assert.equal((await sales.listPayments(o.id))[0].methodConfirmed, true)
  await sql`INSERT INTO stock_pieces (product_id, size, kind, status, source, order_id, damaged) VALUES (${product.id}, 'Medium', 'Sample', 'Sold', 'Made', ${o.id}, false)`
  await db.updateOrder(o.id, { status: 'Paid' }, owner)
  await sales.syncOrder(o.id, owner)
  assert.equal(await orderNet('sales_damaged', o.id), -1200000)
  assert.equal(await orderNet('sales_web', o.id), 0)
})

test('a cancelled order\'s advance: refunded, or kept by an owner with a reason', async () => {
  const o = await newOrder({ advancePaid: 2000 })
  await db.updateOrder(o.id, { status: 'Cancelled' }, owner)
  await sales.syncOrder(o.id, owner)
  const r = await sales.receivables()
  assert.ok(r.refundsDue.some((x) => x.id === o.id))
  await fails(sales.keepAdvance(o.id, { reason: 'no' }, { ...owner, role: 'manager' }), /owner/)
  await fails(sales.keepAdvance(o.id, {}, owner), /why/)
  await sales.keepAdvance(o.id, { reason: 'TEST customer cancelled late' }, owner)
  assert.equal(await orderNet('customer_advances', o.id), 0)
  assert.equal(await orderNet('fx_gain', o.id), -200000)
  assert.ok(!(await sales.receivables()).refundsDue.some((x) => x.id === o.id))
})

test('PR orders take no payments; a payment the hook cannot post waits in the exceptions queue', async () => {
  const pr = await db.createOrder({ customer: `TEST F3 PR ${RUN}`, channel: 'Instagram', orderType: 'PR', prHandle: '@test', orderDate: TODAY,
    items: [{ productId: product.id, size: 'S', quantity: 1, unitPrice: 9000 }] }, owner)
  await fails(sales.addPayment(pr.id, { paidOn: TODAY, amount: '100', method: 'bank' }, owner), /PR/)
  // a payment into a locked month
  const o = await newOrder({})
  await sql`INSERT INTO customer_payments (order_id, paid_on, amount, method) VALUES (${o.id}, '2093-10-05', 100, 'bank')`
  await sql`UPDATE fin_periods SET status = 'Locked' WHERE starts_on = '2093-10-01'`
  const r = await sales.afterOrderChange(o.id, owner)
  assert.ok(r.error)
  assert.ok((await sales.listExceptions()).some((x) => x.sourceId === o.id))
  await sql`UPDATE fin_periods SET status = 'Open' WHERE starts_on = '2093-10-01'`
  await sales.retryException('order', o.id, owner)
  assert.ok(!(await sales.listExceptions()).some((x) => x.sourceId === o.id))
})

// ── Resellers ──────────────────────────────────────────────────────────
test('reseller: sales at the sale-date rate, a closed month moves to the next open one, payment and return', async () => {
  await sales.setRate({ date: '2093-07-01', currency: 'AED', rate: '80' })
  await sales.setRate({ date: '2093-09-01', currency: 'AED', rate: '82' })
  const [r] = await sql`INSERT INTO resellers (name, currency, commission_pct) VALUES (${`TEST Reseller ${RUN}`}, 'AED', 30) RETURNING id`
  const [c] = await sql`INSERT INTO consignments (reseller_id, handover_date, commission_pct) VALUES (${r.id}, '2093-07-05', 30) RETURNING id`
  const add = async (o) => (await sql`INSERT INTO consignment_items (consignment_id, product_id, size, price, status, sold_on, designer_discount, reseller_discount, alteration_charge)
    VALUES (${c.id}, ${product.id}, 'M', ${o.price}, ${o.status}, ${o.soldOn ?? null}, ${o.dd ?? 0}, ${o.rd ?? 0}, ${o.alt ?? 0}) RETURNING id`)[0].id
  const a = await add({ price: 600, status: 'Sold', soldOn: '2093-07-20', dd: 50, rd: 25, alt: 20 })
  const b = await add({ price: 500, status: 'Sold', soldOn: '2093-08-14' })
  await add({ price: 400, status: 'At Store' })
  await sql`UPDATE fin_periods SET status = 'Closed' WHERE starts_on = '2093-08-01'`
  const res = await sales.syncReseller(r.id, owner)
  assert.equal(res.sales.posted, 2)
  const ea = await ledger.getEntry(await activeFor('reseller_item', a, 'sold'))
  assert.equal(ea.date, '2093-07-20')
  assert.equal(ea.lines.find((l) => l.accountId === ACC.sales_reseller).credit, '42000.00')     // 525 × 80
  assert.equal(ea.lines.find((l) => l.accountId === ACC.ar_resellers).debit, '27800.00')        // 347.50 × 80
  const eb = await ledger.getEntry(await activeFor('reseller_item', b, 'sold'))
  assert.equal(eb.date, '2093-09-01', 'August is closed: posted into September'); assert.match(eb.memo, /sold August 2093/)
  // Collage pays for piece a at 79 (received less in rupees): exchange loss
  const [pay] = await sql`INSERT INTO reseller_payments (reseller_id, paid_on, amount, currency, amount_pkr, period, reference) VALUES (${r.id}, '2093-09-10', 347.50, 'AED', 27452.50, '2093-07-01', 'TEST') RETURNING id`
  await sql`UPDATE consignment_items SET status = 'Paid', paid_on = '2093-09-10', payment_id = ${pay.id} WHERE id = ${a}`
  await sales.syncReseller(r.id, owner)
  const ep = await ledger.getEntry(await activeFor('reseller_payment', pay.id, 'received'))
  assert.equal(ep.lines.find((l) => l.accountId === ACC.ar_resellers).credit, '27800.00')
  assert.equal(ep.lines.find((l) => l.accountId === ACC.fx_loss).debit, '347.50')
  // piece b comes back: its sale is reversed
  await sql`UPDATE consignment_items SET status = 'Returned', returned_on = '2093-09-20', sold_on = NULL WHERE id = ${b}`
  await sales.syncReseller(r.id, owner)
  assert.equal((await ledger.getEntry(eb.id)).status, 'Reversed')
  const net = toPaisa((await sql`SELECT coalesce(sum(debit - credit), 0) AS n FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id WHERE l.account_id = ${ACC.ar_resellers} AND l.party_id = ${String(r.id)}`)[0].n)
  assert.equal(net, 0, 'nothing left owed')
  const n = (await sql`SELECT count(*)::int AS n FROM fin_entries`)[0].n
  await sales.syncReseller(r.id, owner)
  assert.equal((await sql`SELECT count(*)::int AS n FROM fin_entries`)[0].n, n, 'a second sync changes nothing')
  const st = await (await import('../../lib/finance/reports.js')).partyStatement('reseller', r.id, { from: '2093-07-01', to: '2093-12-31' })
  assert.equal(st.closing, '0.00')
  await sql`UPDATE fin_periods SET status = 'Open' WHERE starts_on = '2093-08-01'`
})

test('a missing exchange rate holds the reseller in the exceptions queue until the rate is added', async () => {
  // A made-up currency code per run, so an earlier run's rate can't stand in for it
  const CUR = `X${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${String.fromCharCode(65 + Math.floor(Math.random() * 26))}`
  const [r] = await sql`INSERT INTO resellers (name, currency, commission_pct) VALUES (${`TEST Reseller ${CUR} ${RUN}`}, ${CUR}, 20) RETURNING id`
  const [c] = await sql`INSERT INTO consignments (reseller_id, handover_date, commission_pct) VALUES (${r.id}, '2093-07-05', 20) RETURNING id`
  await sql`INSERT INTO consignment_items (consignment_id, product_id, size, price, status, sold_on) VALUES (${c.id}, ${product.id}, 'L', 100, 'Sold', '2093-07-25')`
  const res = await sales.afterResellerChange(r.id, owner)
  assert.match(res.error, new RegExp(`No ${CUR} rate`))
  assert.ok((await sales.listRates()).missing.some((m) => m.currency === CUR))
  await sales.setRate({ date: '2093-07-01', currency: CUR, rate: '350' })
  await sales.afterRatesChange(owner)
  assert.ok(!(await sales.listExceptions()).some((x) => x.sourceType === 'reseller' && x.sourceId === String(r.id)))
})
