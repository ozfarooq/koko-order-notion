// F5a: costing and pricing (migration 020, lib/finance/costing.js). Runs ONLY on koko_finance_dev.
// The VÉLORA seed is only read; anything written uses a test collection and products with a run stamp.
// Run: npm run test:finance
import { test, before } from 'node:test'
import assert from 'node:assert/strict'

const devUrl = process.env.FINANCE_DEV_DATABASE_URL
if (!devUrl || new URL(devUrl).pathname !== '/koko_finance_dev') throw new Error('FINANCE_DEV_DATABASE_URL must point at koko_finance_dev')
process.env.DATABASE_URL = devUrl

const { neon } = await import('@neondatabase/serverless')
const costing = await import('../../lib/finance/costing.js')
const sales = await import('../../lib/finance/sales.js')
const db = await import('../../lib/db.js')
const sql = neon(devUrl)

const RUN = Date.now().toString(36)
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })
let owner, coll, prodA, prodB
const fails = async (p, re) => { try { await p } catch (err) { if (re) assert.match(err.message, re); return err } assert.fail('expected an error') }
const rs = (p) => p / 100

before(async () => {
  await sql`INSERT INTO users (username, name, role, password_hash) SELECT 'fin_test_owner', 'fin_test_owner', 'owner', 'x' WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(username) = 'fin_test_owner')`
  ;[owner] = await sql`SELECT id, username, role FROM users WHERE username = 'fin_test_owner'`
  ;[coll] = await sql`INSERT INTO collections (name) VALUES (${`TEST F5 ${RUN}`}) RETURNING id, name`
  ;[prodA] = await sql`INSERT INTO products (collection_id, name, price_pkr) VALUES (${coll.id}, ${`TEST Moka ${RUN}`}, 10500) RETURNING id, name`
  ;[prodB] = await sql`INSERT INTO products (collection_id, name, price_pkr) VALUES (${coll.id}, ${`TEST Plain ${RUN}`}, 9000) RETURNING id, name`
})

test('pricing reproduces the VÉLORA worked check to the rupee (spec 7.4.4)', () => {
  const table = [
    ['MOKA', 525000, 1050000, 8250, 10065, 210, 2040, '24.7', '19.4', 10102],
    ['ONDINE', 1000000, 1600000, 13000, 15860, 320, 2680, '20.6', '16.8', 15918],
    ['VELOURS', 680000, 1200000, 9800, 11956, 240, 1960, '20.0', '16.3', 12000],
    ['OPHÉRA', 779000, 1450000, 10790, 13164, 290, 3420, '31.7', '23.6', 13212],
    ['MINUIT', 597500, 1200000, 8975, 10950, 240, 2785, '31.0', '23.2', 10990],
    ['DUNE', 750000, 1350000, 10500, 12810, 270, 2730, '26.0', '20.2', 12857],
  ]
  for (const [name, cost, final, unit, sheet, courier, margin, onCost, ofPrice, gross] of table) {
    const p = costing.priceFor({ productionCost: cost, allowance: 300000, profitPct: 20, courierPct: 2 })
    const c = costing.checkPrice(final, p.unitCost, 2)
    assert.deepEqual([rs(p.unitCost), rs(p.koko), rs(c.courier), rs(c.margin), c.onCost.toFixed(1), c.ofPrice.toFixed(1), rs(p.grossup)],
      [unit, sheet, courier, margin, onCost, ofPrice, gross], name)
  }
  assert.equal(rs(costing.priceFor({ productionCost: 525000, allowance: 300000, profitPct: 20, courierPct: 2 }).suggested), 10500, 'rounded up to the next 500')
  assert.equal(rs(costing.priceFor({ productionCost: 525000, allowance: 300000, profitPct: 20, courierPct: 2, method: 'grossup' }).computed), 10102)
})

test('the VÉLORA cost cards match the shoot cost sheet, with the launch prices on record', async () => {
  const designs = (await costing.listDesigns({})).filter((d) => d.collection === 'VÉLORA' && d.hasCard)
  const got = Object.fromEntries(designs.map((d) => [d.name, [d.productionCost, d.unitCost, d.computedPrice, d.finalPrice]]))
  assert.deepEqual(got.MOKA, ['5250.00', '8250.00', '10065.00', '10500.00'])
  assert.deepEqual(got.ONDINE, ['10000.00', '13000.00', '15860.00', '16000.00'])
  assert.deepEqual(got.VELOURS, ['6800.00', '9800.00', '11956.00', '12000.00'])
  assert.deepEqual(got['OPHÉRA'], ['7790.00', '10790.00', '13164.00', '14500.00'])
  assert.deepEqual(got.MINUIT, ['5975.00', '8975.00', '10950.00', '12000.00'])
  assert.deepEqual(got.DUNE, ['7500.00', '10500.00', '12810.00', '13500.00'])
  assert.ok(designs.every((d) => !d.belowTarget), 'all six reach 20% on cost after the courier')
  const ophera = await costing.getDesign(designs.find((d) => d.name === 'OPHÉRA').productId)
  assert.equal(ophera.active.lines.length, 5)
  assert.equal(ophera.active.lines[0].lotName, 'Black velvet')
})

test('cost cards are versioned; the active one prices the design; size factors scale fabric', async () => {
  const lots = await costing.saveLot(null, { collectionId: coll.id, name: `Brown ${RUN}`, rate: '450' })
  const lot = lots.find((l) => l.name === `Brown ${RUN}`)
  let d = await costing.saveCard(prodA.id, { source: 'TEST sheet', lines: [
    { kind: 'fabric', description: 'Fabric (Brown)', lotId: lot.id, quantity: 5, rate: '450' },
    { kind: 'stitching', description: 'Stitching', amount: '3000' },
  ] }, owner)
  assert.equal(d.active.version, 1); assert.equal(d.active.productionCost, '5250.00')
  assert.equal(d.pricing.unitCost, '8250.00', 'default policy: 3,000 allowance')
  assert.equal(d.sizes.find((s) => s.size === 'X-Large').cost, String((2250 * 1.15 + 3000).toFixed(2)))
  d = await costing.saveCard(prodA.id, { lines: [{ kind: 'fabric', description: 'Fabric (Brown)', lotId: lot.id, quantity: 5, rate: '500' }, { kind: 'stitching', description: 'Stitching', amount: '3000' }] }, owner)
  assert.equal(d.active.version, 2); assert.equal(d.active.productionCost, '5500.00')
  assert.equal(d.versions.find((v) => v.version === 1).status, 'Superseded')
  await fails(costing.saveCard(prodA.id, { lines: [{ kind: 'stitching', description: 'x', lotId: lot.id, amount: '1' }] }, owner), /only fabric/)
  await fails(costing.saveCard(prodA.id, { lines: [] }, owner), /at least one/)
  d = await costing.activateCard(d.versions.find((v) => v.version === 1).id, owner)
  assert.equal(d.active.version, 1)
})

test('a collection policy changes the price; confirming a price keeps the cost behind it', async () => {
  await costing.savePolicy({ collectionId: coll.id, allowance: '2000', profitPct: 30, courierPct: 2, method: 'grossup', roundTo: 500 })
  let d = await costing.getDesign(prodA.id)
  assert.equal(d.pricing.unitCost, '7250.00')
  assert.equal(d.pricing.computed, String((Math.round(725000 * 1.3 / 0.98 / 100)).toFixed(2)))
  await fails(costing.confirmPrice(prodB.id, { finalPrice: '9000' }, owner), /cost card first/)
  d = await costing.confirmPrice(prodA.id, { finalPrice: '10,500', note: 'TEST' }, owner)
  assert.equal(d.history[0].finalPrice, '10500.00'); assert.equal(d.history[0].unitCost, '7250.00'); assert.equal(d.history[0].method, 'grossup')
  const row = (await costing.listDesigns({ collectionId: coll.id })).find((x) => x.productId === prodA.id)
  assert.equal(row.finalPrice, '10500.00'); assert.equal(row.priceDiffers, false)
  assert.equal(row.belowTarget, false)
  await costing.savePolicy({ collectionId: coll.id, allowance: '2000', profitPct: 60, courierPct: 2, method: 'koko', roundTo: 500 })
  assert.equal((await costing.listDesigns({ collectionId: coll.id })).find((x) => x.productId === prodA.id).belowTarget, true, 'below a 60% target')
  await costing.deletePolicy(coll.id)
})

test('fabric lots: purchases set the average, outfits made and orders in production use yards, leftover covers outfits', async () => {
  let lot = (await costing.listLots({ collectionId: coll.id }))[0]
  await costing.addFabricMove(lot.id, { kind: 'purchase', quantity: 40, rate: '450', date: TODAY }, owner)
  let lots = await costing.addFabricMove(lot.id, { kind: 'purchase', quantity: 10, rate: '500', date: TODAY }, owner)
  lot = lots.find((l) => l.id === lot.id)
  assert.equal(lot.bought, 50); assert.equal(lot.averageRate, '460.00')
  await fails(costing.addFabricMove(lot.id, { kind: 'adjust', quantity: -1 }, owner), /why/)
  // a shoot sample (made) and an order in tailoring in Large
  await sql`INSERT INTO stock_pieces (product_id, size, kind, status, source) VALUES (${prodA.id}, 'Medium', 'Sample', 'At Shoot', 'Made')`
  const o = await db.createOrder({ customer: `TEST F5 ${RUN}`, channel: 'Studio', orderDate: TODAY, items: [{ productId: prodA.id, size: 'L', quantity: 2, unitPrice: 10500 }], amount: 21000 }, owner)
  lot = (await costing.listLots({ collectionId: coll.id })).find((l) => l.id === lot.id)
  assert.equal(lot.usedOrders, 0, 'a New order has not used fabric yet')
  await db.updateOrder(o.id, { status: 'In Tailoring' }, owner)
  lot = (await costing.listLots({ collectionId: coll.id })).find((l) => l.id === lot.id)
  assert.equal(lot.usedMade, 5); assert.equal(lot.usedOrders, 10.5, '2 × 5 yards × 1.05 for Large')
  assert.equal(lot.left, 34.5)
  assert.equal(lot.designs.find((x) => x.productId === prodA.id).outfitsLeft, 6)
  lots = await costing.addFabricMove(lot.id, { kind: 'adjust', quantity: -0.5, note: 'TEST remnant' }, owner)
  assert.equal(lots.find((l) => l.id === lot.id).left, 34)
  assert.equal((await costing.lotMoves(lot.id)).length, 3)
})

test('profit: revenue from the books, cost from the cost card, designs without a card counted apart', async () => {
  const o = await db.createOrder({ customer: `TEST F5 profit ${RUN}`, channel: 'Instagram', orderDate: TODAY,
    items: [{ productId: prodA.id, size: 'M', quantity: 1, unitPrice: 10500 }, { productId: prodB.id, size: 'M', quantity: 1, unitPrice: 9000 }], amount: 19500 }, owner)
  await db.updateOrder(o.id, { status: 'Paid' }, owner)
  await sales.syncOrder(o.id, owner)
  const r = await costing.profitReport({ from: TODAY, to: TODAY })
  const ord = r.orders.find((x) => x.orderId === o.id)
  assert.equal(ord.revenue, '19500.00'); assert.equal(ord.cost, '5250.00'); assert.equal(ord.missingCost, 1)
  assert.equal(ord.contribution, '14250.00')
  const a = r.designs.find((x) => x.productId === prodA.id)
  assert.ok(Number(a.cost) >= 5250)
  const c = r.collections.find((x) => x.collectionId === coll.id)
  assert.ok(c && Number(c.revenue) >= 19500)
  assert.ok(r.channels.some((x) => x.channel === 'Instagram'))
})
