// Trax settlement import (migration 025, lib/finance/trax.js). The fixture is SYNTHETIC: made-up tracking
// numbers, people and amounts in the layout of the Trax "Payment Details / Sales Tax Invoice" page. Never
// commit a real settlement. Runs ONLY on koko_finance_dev. Run: npm run test:finance
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const devUrl = process.env.FINANCE_DEV_DATABASE_URL
if (!devUrl || new URL(devUrl).pathname !== '/koko_finance_dev') throw new Error('FINANCE_DEV_DATABASE_URL must point at koko_finance_dev')
process.env.DATABASE_URL = devUrl

const { neon } = await import('@neondatabase/serverless')
const { toPaisa } = await import('../../lib/finance/money.js')
const trax = await import('../../lib/finance/trax.js')
const sales = await import('../../lib/finance/sales.js')
const db = await import('../../lib/db.js')
const sql = neon(devUrl)

const RUN = Date.now().toString(36)
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })
const FIXTURE = fs.readFileSync(new URL('./fixtures/trax-settlement-synthetic.txt', import.meta.url), 'utf8')
let owner, acct, product, a, b, text
const P = (v) => toPaisa(v ?? 0)
const fails = async (p, re) => { try { await p } catch (err) { if (re) assert.match(err.message, re); return err } assert.fail('expected an error') }
const orderNet = async (key, orderId) => P((await sql`SELECT coalesce(sum(l.debit - l.credit), 0) AS n FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'Draft'
  WHERE l.account_id = ${acct[key]} AND l.order_id = ${orderId}`)[0].n)

before(async () => {
  await sql`INSERT INTO users (username, name, role, password_hash) SELECT 'fin_test_owner', 'fin_test_owner', 'owner', 'x' WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(username) = 'fin_test_owner')`
  ;[owner] = await sql`SELECT id, username, name, role FROM users WHERE username = 'fin_test_owner'`
  acct = Object.fromEntries((await sql`SELECT id, system_key FROM fin_accounts WHERE system_key IS NOT NULL`).map((x) => [x.system_key, x.id]))
  ;[product] = await sql`INSERT INTO products (name, price_pkr) VALUES (${`TEST Trax ${RUN}`}, 15000) RETURNING id`
  const order = (amount, advance) => db.createOrder({ customer: `TEST Trax ${RUN} ${amount}`, channel: 'Studio', orderDate: TODAY,
    items: [{ productId: product.id, size: 'M', quantity: 1, unitPrice: amount }], amount, advancePaid: advance }, owner)
  a = await order(20000, 5000)                // 15,000 still due: Trax collects it
  b = await order(5000, 0)
  await db.updateOrder(b.id, { status: 'Paid' }, owner)     // the screens recorded the 5,000 as a bank payment
  await sales.syncOrder(a.id, owner); await sales.syncOrder(b.id, owner)
  // A fresh invoice number per run
  text = FIXTURE.replaceAll('{ORDER_A}', a.orderNumber).replaceAll('{ORDER_B}', b.orderNumber).replace('9900001', `99${Date.now() % 100000000}`)
})

test('reading the invoice: rows, amounts and the payout check', () => {
  const p = trax.parseTraxText(text)
  assert.equal(p.rows.length, 4)
  assert.deepEqual(p.rows.map((r) => r.kind), ['Arrival', 'Arrival', 'Delivered', 'Delivered'])
  assert.equal(p.rows[2].collection, 1500000); assert.equal(p.rows[2].wht, 30000); assert.equal(p.rows[2].netDisbursement, 1422600)
  assert.equal(p.ibft, 10000); assert.equal(p.payable, 1796900)
  const c = trax.checkSettlement(p)
  assert.deepEqual(c.problems, []); assert.equal(c.totals.rounding, 0)
  // the payout rounded to the rupee: a small difference is rounding; a large one is refused
  assert.equal(trax.checkSettlement({ ...p, payable: 1796950 }).totals.rounding, 50)
  assert.match(trax.checkSettlement({ ...p, payable: 1806900 }).problems.join(), /pays/)
  assert.throws(() => trax.parseTraxText('nothing here'), /No shipment rows/)
})

test('preview: a COD payment is added where the balance is still due, and a bank payment of the same amount becomes Trax COD', async () => {
  const pv = await trax.previewSettlement({ text, date: TODAY })
  assert.deepEqual(pv.problems, [])
  const rows = pv.rows.filter((r) => r.kind === 'Delivered')
  assert.equal(rows.find((r) => r.orderNumber === a.orderNumber).action, 'add')
  assert.equal(rows.find((r) => r.orderNumber === b.orderNumber).action, 'switch')
})

test('import: one entry clears Trax COD per order; bank gets the payout; charges, deductions and IBFT are costs while tax is off', async () => {
  const s = await trax.importSettlement({ text, date: TODAY }, owner)
  assert.equal(s.payable, '17969.00'); assert.equal(s.lines.length, 4)
  assert.equal(await orderNet('clearing_trax', a.id), 0, 'the 15,000 collected went in and came out')
  assert.equal(await orderNet('clearing_trax', b.id), 0)
  const pays = await sales.listPayments(b.id)
  assert.ok(pays.every((p) => p.method === 'trax_cod'), 'the bank payment became Trax COD')
  assert.equal((await sales.listPayments(a.id)).filter((p) => p.method === 'trax_cod').reduce((x, p) => x + P(p.amount), 0), 1500000)
  const ls = await sql`SELECT a.system_key, l.debit, l.credit FROM fin_lines l JOIN fin_accounts a ON a.id = l.account_id WHERE l.entry_id = ${s.entryId}`
  const net = (k) => ls.filter((l) => l.system_key === k).reduce((x, l) => x + P(l.debit) - P(l.credit), 0)
  assert.equal(net('bank_baf'), 1796900)
  assert.equal(net('courier_charges'), 97500 + 15600)
  assert.equal(net('courier_deductions'), 80000, 'WHT and COD sales tax are costs while tax is off')
  assert.equal(net('bank_charges'), 10000)
  assert.equal(net('clearing_trax'), -2000000)
  assert.ok((await trax.listSettlements()).settlements.some((x) => x.id === s.id))
})

test('the same invoice or shipment can\'t be imported twice; undo reverses the entry', async () => {
  const again = await trax.previewSettlement({ text, date: TODAY })
  assert.ok(again.problems.some((p) => /already imported/.test(p)))
  await fails(trax.importSettlement({ text, date: TODAY }, owner), /already imported/)
  const other = text.replace(/Payment \/ Invoice ID\t\d+/, `Payment / Invoice ID\t98${Date.now() % 100000000}`)
  assert.ok((await trax.previewSettlement({ text: other, date: TODAY })).problems.some((p) => /was already in invoice/.test(p)))
  const s = (await trax.listSettlements()).settlements.find((x) => x.status === 'Posted' && x.invoiceNo === trax.parseTraxText(text).invoiceNo)
  await trax.voidSettlement(s.id, { reason: 'test' }, owner)
  assert.equal((await sql`SELECT status FROM fin_entries WHERE id = ${s.entryId}`)[0].status, 'Reversed')
  assert.equal(await orderNet('clearing_trax', a.id), 1500000, 'collected by Trax, waiting for a settlement again')
})

test('an old order brought in with one payment for the whole price: the part Trax collected is split off and the estimated paid date moves to the settlement', async () => {
  const c = await db.createOrder({ customer: `TEST Trax ${RUN} split`, channel: 'Studio', orderDate: '2026-07-02',
    items: [{ productId: product.id, size: 'M', quantity: 1, unitPrice: 30000 }], amount: 30000, advancePaid: 30000 }, owner)
  await db.updateOrder(c.id, { status: 'Paid' }, owner)
  await sql`UPDATE orders SET paid_on = '2026-07-02', paid_on_inferred = true WHERE id = ${c.id}`
  const d = await db.createOrder({ customer: `TEST Trax ${RUN} split2`, channel: 'Studio', orderDate: TODAY,
    items: [{ productId: product.id, size: 'M', quantity: 1, unitPrice: 5000 }], amount: 5000, advancePaid: 0 }, owner)
  const t2 = FIXTURE.replaceAll('{ORDER_A}', c.orderNumber).replaceAll('{ORDER_B}', d.orderNumber).replace('9900001', `97${Date.now() % 100000000}`)
    .replaceAll('11110000000001', `2${Date.now() % 10000000000000}`.padEnd(14, '1')).replaceAll('11110000000002', `3${Date.now() % 10000000000000}`.padEnd(14, '2'))
  const pv = await trax.previewSettlement({ text: t2, date: TODAY })
  assert.deepEqual(pv.problems, [])
  const row = pv.rows.find((r) => r.kind === 'Delivered' && r.orderNumber === c.orderNumber)
  assert.equal(row.action, 'split'); assert.equal(row.redate, true)
  await trax.importSettlement({ text: t2, date: TODAY }, owner)
  const pays = await sales.listPayments(c.id)
  assert.deepEqual(pays.map((p) => [p.method, P(p.amount)]).sort(), [['bank', 1500000], ['trax_cod', 1500000]])
  const [o] = await sql`SELECT paid_on::text AS paid_on, paid_on_inferred, advance_paid_pkr FROM orders WHERE id = ${c.id}`
  assert.equal(o.paid_on, TODAY); assert.equal(o.paid_on_inferred, false); assert.equal(P(o.advance_paid_pkr), 3000000)
  assert.equal(await orderNet('clearing_trax', c.id), 0)
})
