// F5b: actual cost — month-end stock valuation, fabric bought with its payment, standard vs actual,
// repricing at current fabric prices (migration 022, lib/finance/stock.js). Runs ONLY on koko_finance_dev.
// Stock is valued across the whole business, so tests compare values before and after their own
// test pieces (run-stamped collection and products) rather than fixed totals.
// Run: npm run test:finance
import { test, before } from 'node:test'
import assert from 'node:assert/strict'

const devUrl = process.env.FINANCE_DEV_DATABASE_URL
if (!devUrl || new URL(devUrl).pathname !== '/koko_finance_dev') throw new Error('FINANCE_DEV_DATABASE_URL must point at koko_finance_dev')
process.env.DATABASE_URL = devUrl

const { neon } = await import('@neondatabase/serverless')
const { toPaisa } = await import('../../lib/finance/money.js')
const costing = await import('../../lib/finance/costing.js')
const stock = await import('../../lib/finance/stock.js')
const db = await import('../../lib/db.js')
const sql = neon(devUrl)

const RUN = Date.now().toString(36)
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })
const MONTH = TODAY.slice(0, 7)
let owner, coll, prod, lot, acct
const P = (v) => toPaisa(v ?? 0)
const value = (s, bucket) => P(s.buckets[bucket].value)
const fails = async (p, re) => { try { await p } catch (err) { if (re) assert.match(err.message, re); return err } assert.fail('expected an error') }
const balance = async (key) => P((await sql`SELECT coalesce(sum(l.debit - l.credit), 0) AS n FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'Draft'
  JOIN fin_accounts a ON a.id = l.account_id AND a.system_key = ${key}`)[0].n)

before(async () => {
  await sql`INSERT INTO users (username, name, role, password_hash) SELECT 'fin_test_owner', 'fin_test_owner', 'owner', 'x' WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(username) = 'fin_test_owner')`
  ;[owner] = await sql`SELECT id, username, role FROM users WHERE username = 'fin_test_owner'`
  acct = Object.fromEntries((await sql`SELECT id, system_key FROM fin_accounts WHERE system_key IS NOT NULL`).map((a) => [a.system_key, a.id]))
  ;[coll] = await sql`INSERT INTO collections (name) VALUES (${`TEST F5b ${RUN}`}) RETURNING id`
  ;[prod] = await sql`INSERT INTO products (collection_id, name, price_pkr) VALUES (${coll.id}, ${`TEST Velvet ${RUN}`}, 12000) RETURNING id`
  const lots = await costing.saveLot(null, { collectionId: coll.id, name: `Velvet ${RUN}`, rate: '450' })
  lot = lots.find((l) => l.name === `Velvet ${RUN}`)
  await costing.saveCard(prod.id, { lines: [
    { kind: 'fabric', description: 'Fabric', lotId: lot.id, quantity: 4, rate: '450' },      // 1,800
    { kind: 'stitching', description: 'Stitching', amount: '3000' },
    { kind: 'outsourced', description: 'Dye', amount: '500' },
  ] }, owner)                                                                                    // production cost 5,300
})

test('fabric bought with its payment: an expense to materials consumed, tagged to the collection; the lot follows', async () => {
  const lots = await costing.addFabricMove(lot.id, { kind: 'purchase', quantity: 20, rate: '500', date: TODAY, paidFrom: 'cash', note: 'TEST' }, owner)
  const l = lots.find((x) => x.id === lot.id)
  assert.equal(l.bought, 20); assert.equal(l.averageRate, '500.00')
  const [move] = await costing.lotMoves(lot.id)
  assert.ok(move.expenseId); assert.match(move.entryNo, /^EX-/)
  const [x] = await sql`SELECT amount, account_id, collection_id, paid_from FROM fin_expenses WHERE id = ${move.expenseId}`
  assert.equal(x.amount, '10000.00'); assert.equal(x.account_id, acct.cogs_materials); assert.equal(x.collection_id, coll.id); assert.equal(x.paid_from, 'cash')
})

test('repricing: at the current fabric price the design costs more, and a target it no longer meets is flagged', async () => {
  const row = (await costing.listDesigns({ collectionId: coll.id })).find((d) => d.productId === prod.id)
  assert.equal(row.productionCost, '5300.00')
  assert.equal(row.reprice.productionCost, '5500.00', '4 yards at the 500 average instead of 450')
  await costing.savePolicy({ collectionId: coll.id, allowance: '3000', profitPct: 50, courierPct: 2, method: 'koko', roundTo: 500 })   // 3,260 on 8,500 is 38%: below 50
  const r2 = (await costing.listDesigns({ collectionId: coll.id })).find((d) => d.productId === prod.id)
  assert.equal(r2.reprice.belowTarget, true)
  assert.ok(P(r2.reprice.suggestedPrice) > P(r2.websitePrice))
  await costing.deletePolicy(coll.id)
})

test('stock at a date: studio pieces at cost, damaged ones at the lower of cost and asking price, reseller stock, WIP, fabric', async () => {
  const before = await stock.stockAt(TODAY)
  await sql`INSERT INTO stock_pieces (product_id, size, kind, status, source) VALUES (${prod.id}, 'Medium', 'Stock', 'At Studio', 'Made')`
  await sql`INSERT INTO stock_pieces (product_id, size, kind, status, source, damaged, asking_price_pkr) VALUES (${prod.id}, 'Medium', 'Stock', 'At Studio', 'Made', true, 2000)`
  const [r] = await sql`INSERT INTO resellers (name, currency, commission_pct) VALUES (${`TEST F5b Reseller ${RUN}`}, 'AED', 30) RETURNING id`
  const [c] = await sql`INSERT INTO consignments (reseller_id, handover_date, commission_pct) VALUES (${r.id}, ${TODAY}, 30) RETURNING id`
  await sql`INSERT INTO consignment_items (consignment_id, product_id, size, price, status) VALUES (${c.id}, ${prod.id}, 'Large', 300, 'At Store')`
  const o = await db.createOrder({ customer: `TEST F5b ${RUN}`, channel: 'Studio', orderDate: TODAY, items: [{ productId: prod.id, size: 'M', quantity: 1, unitPrice: 12000 }], amount: 12000 }, owner)
  await db.updateOrder(o.id, { status: 'In Tailoring' }, owner)
  const after = await stock.stockAt(TODAY)
  assert.equal(value(after, 'studio') - value(before, 'studio'), 530000 + 200000, 'one at cost, the damaged one at its 2,000 asking price')
  assert.equal(value(after, 'reseller') - value(before, 'reseller'), Math.round(180000 * 1.05) + 350000, 'Large uses 5% more fabric')
  assert.equal(value(after, 'wip') - value(before, 'wip'), 530000)
  const fab = after.buckets.materials.rows.find((x) => x.lotId === lot.id)
  // 20 bought − 4 × (1 + 1 + 1 made/handed over/ordered … 1.05 for Large) at 500
  assert.equal(fab.quantity, 20 - 4 - 4 - 4 * 1.05 - 4)
  assert.equal(P(fab.value), Math.round((20 - 4 - 4 - 4.2 - 4) * 50000))
  // once the order is paid it is sold: no longer stock
  await db.updateOrder(o.id, { status: 'Paid' }, owner)
  assert.equal(value(await stock.stockAt(TODAY), 'wip'), value(before, 'wip'))
})

test('the month-end entry moves the stock accounts to the count; running it again changes nothing; a change replaces it', async () => {
  await fails(stock.postValuation({ month: '2026-05' }, owner), /before go-live/)
  await fails(stock.postValuation({ month: '2099-01' }, owner), /not started/)
  const v1 = await stock.postValuation({ month: MONTH }, owner)
  const fg = await balance('inv_fg_studio')
  assert.equal(fg, P(v1.buckets.studio.value), 'the studio stock account equals the count')
  assert.equal(await balance('inv_fg_consigned'), P(v1.buckets.reseller.value))
  const n = (await sql`SELECT count(*)::int AS n FROM fin_entries`)[0].n
  const v2 = await stock.postValuation({ month: MONTH }, owner)
  assert.equal(v2.entryId, v1.entryId); assert.equal((await sql`SELECT count(*)::int AS n FROM fin_entries`)[0].n, n)
  // one more studio piece: the month's entry is replaced (old one reversed), the account follows the count
  await sql`INSERT INTO stock_pieces (product_id, size, kind, status, source) VALUES (${prod.id}, 'Small', 'Sample', 'At Shoot', 'Made')`
  const v3 = await stock.postValuation({ month: MONTH }, owner)
  assert.notEqual(v3.entryId, v1.entryId)
  assert.equal((await sql`SELECT status FROM fin_entries WHERE id = ${v1.entryId}`)[0].status, 'Reversed')
  assert.equal(await balance('inv_fg_studio'), P(v3.buckets.studio.value))
  const e = await sql`SELECT a.system_key, l.debit, l.credit FROM fin_lines l JOIN fin_accounts a ON a.id = l.account_id WHERE l.entry_id = ${v3.entryId}`
  assert.ok(e.some((l) => l.system_key === 'inv_change'), 'against 5050 Change in inventories')
  assert.ok((await stock.listValuations()).some((v) => v.month === MONTH && v.entryId === v3.entryId))
})

test('standard vs actual: the month\'s production at cost-card rates against what was spent', async () => {
  const r = await stock.standardVsActual({ month: MONTH })
  assert.deepEqual(r.rows.map((x) => x.element), ['materials', 'labour', 'outsourced', 'consumables'])
  assert.ok(r.pieces >= 4, 'the test pieces made this month count')
  assert.ok(P(r.rows.find((x) => x.element === 'materials').actual) >= 1000000, 'the fabric bought this month is actual materials')
  assert.ok(P(r.rows.find((x) => x.element === 'labour').standard) >= 4 * 300000)
  assert.equal(r.rows.reduce((s, x) => s + P(x.standard), 0), P(r.total.standard))
})
