// Receipts on order payments (migration 026). Without BLOB_READ_WRITE_TOKEN files are kept in the
// database, so this runs the same code path the app uses locally; on Vercel the bytes go to Blob.
// Runs ONLY on koko_finance_dev. Run: npm run test:finance
import { test, before } from 'node:test'
import assert from 'node:assert/strict'

const devUrl = process.env.FINANCE_DEV_DATABASE_URL
if (!devUrl || new URL(devUrl).pathname !== '/koko_finance_dev') throw new Error('FINANCE_DEV_DATABASE_URL must point at koko_finance_dev')
process.env.DATABASE_URL = devUrl
delete process.env.BLOB_READ_WRITE_TOKEN

const { neon } = await import('@neondatabase/serverless')
const sales = await import('../../lib/finance/sales.js')
const db = await import('../../lib/db.js')
const sql = neon(devUrl)

const RUN = Date.now().toString(36)
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })
let owner, order
const png = (n) => Buffer.from(`TEST receipt ${RUN} ${n}`).toString('base64')

before(async () => {
  await sql`INSERT INTO users (username, name, role, password_hash) SELECT 'fin_test_owner', 'fin_test_owner', 'owner', 'x' WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(username) = 'fin_test_owner')`
  ;[owner] = await sql`SELECT id, username, name, role FROM users WHERE username = 'fin_test_owner'`
  const [p] = await sql`INSERT INTO products (name, price_pkr) VALUES (${`TEST Files ${RUN}`}, 9000) RETURNING id`
  order = await db.createOrder({ customer: `TEST Files ${RUN}`, channel: 'Studio', orderDate: TODAY, items: [{ productId: p.id, size: 'M', quantity: 1, unitPrice: 9000 }], amount: 9000, advancePaid: 0 }, owner)
})

test('a receipt attached to an order payment is listed with it, read back, and can be removed', async () => {
  const list = await sales.addPayment(order.id, { paidOn: TODAY, amount: '4000', method: 'bank', reference: 'TEST' }, owner)
  const pay = list[0]
  assert.deepEqual(pay.files, [])
  const withFile = await sales.addPaymentFile(pay.id, { name: 'slip.pdf', mime: 'application/pdf', data: png(1) }, owner)
  const f = withFile.find((x) => x.id === pay.id).files[0]
  assert.equal(f.name, 'slip.pdf')
  const back = await sales.getPaymentFile(pay.id, f.id)
  assert.equal(back.data, png(1)); assert.equal(back.mime, 'application/pdf')
  await assert.rejects(sales.getPaymentFile(pay.id, f.id + 999999), /not found/i, 'only files on that payment')
  await assert.rejects(sales.addPaymentFile(pay.id, { name: 'x.exe', mime: 'application/x-msdownload', data: png(2) }, owner), /Attach a photo/)
  const after = await sales.removePaymentFile(pay.id, f.id)
  assert.deepEqual(after.find((x) => x.id === pay.id).files, [])
})
