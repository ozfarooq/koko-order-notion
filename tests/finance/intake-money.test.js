// Inbox round 2 (migration 027): folder fingerprints, money coming in onto orders, wages paid straight
// from a transfer (week from the note, days off), salary words beating category words, collection tags.
// Modelled on the studio's real slips with made-up names and references. Runs ONLY on koko_finance_dev
// with a stand-in reader. Run: npm run test:finance
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, createHash } from 'crypto'

const devUrl = process.env.FINANCE_DEV_DATABASE_URL
if (!devUrl || new URL(devUrl).pathname !== '/koko_finance_dev') throw new Error('FINANCE_DEV_DATABASE_URL must point at koko_finance_dev')
process.env.DATABASE_URL = devUrl

const { neon } = await import('@neondatabase/serverless')
const { toPaisa } = await import('../../lib/finance/money.js')
const ledger = await import('../../lib/finance/ledger.js')
const files = await import('../../lib/finance/files.js')
const pay = await import('../../lib/finance/payroll.js')
const intake = await import('../../lib/finance/intake.js')
const db = await import('../../lib/db.js')
const sql = neon(devUrl)

const RUN = Date.now().toString(36).toUpperCase()
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })
// A far-off year of our own, so the weeks never clash with another run's payroll
const YEAR = 2101 + (Math.floor(Date.now() / 1000) % 97)
let owner, acct, staff, product
const readings = new Map()
intake.setExtractor(async (f) => { const r = readings.get(f.name); if (!r) throw new Error('unreadable'); return r })
const fails = async (p, re) => { try { await p } catch (err) { if (re) assert.match(err.message, re); return err } assert.fail('expected an error') }
const transfer = (o) => ({ doc_type: 'bank_transfer', source: 'Bank Alfalah', currency: 'PKR', confidence: 0.95, note_lines: [], ...o })
const line = (text, amount = null) => ({ text, amount })

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
async function inboxFile(reading) {
  const name = `test-${RUN}-${randomBytes(4).toString('hex')}.png`
  readings.set(name, reading)
  const f = await files.saveFile({ name, mime: 'image/png', data: randomBytes(64).toString('base64') }, owner, 'Inbox')
  const [item] = await intake.addFiles([f.id], owner)
  return item
}
const newOrder = async (customer, amount, advancePaid = 0) =>
  db.createOrder({ customer, channel: 'Studio', orderDate: TODAY, items: [{ productId: product.id, size: 'M', quantity: 1, unitPrice: amount }], amount, advancePaid }, owner)
const entryLines = async (id) => (await ledger.getEntry(id)).lines.map((l) => [l.accountId, l.debit, l.credit])

before(async () => {
  await sql`INSERT INTO users (username, name, role, password_hash) SELECT 'fin_test_owner', 'fin_test_owner', 'owner', 'x' WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(username) = 'fin_test_owner')`
  ;[owner] = await sql`SELECT id, username, name, role FROM users WHERE username = 'fin_test_owner'`
  acct = Object.fromEntries((await sql`SELECT id, code, system_key FROM fin_accounts WHERE system_key IS NOT NULL`).map((a) => [a.system_key, a]))
  await ensureFY(`${YEAR}-09-01`)
  staff = await pay.createStaff({ name: `TEST Rehan ${RUN}`, aliases: [`Rehan Saleem ${RUN}`], roleTitle: 'tailor', payType: 'weekly_salary', isProduction: true,
    weeklySalary: '15000', salaryFrom: `${YEAR - 1}-01-01` })
  ;[product] = await sql`INSERT INTO products (name, price_pkr) VALUES (${`TEST Inbox ${RUN}`}, 9000) RETURNING id`
})
after(async () => { if (staff) await pay.updateStaff(staff.id, { isActive: false }) })

test('the note tells the week, the days off, the order and the collection', () => {
  assert.equal(intake.weekFromNote('Nov 26 Week 1 Tailor Salary', '2026-11-07'), '2026-11-07')   // 1st Saturday of Nov 2026
  assert.equal(intake.weekFromNote('Nov 26 Week 3', '2026-11-22'), '2026-11-21')
  assert.equal(intake.weekFromNote('Week 3', '2026-11-22'), null)
  assert.equal(intake.daysOffIn('Embroidery Salary 12500/- 1Day Off'), 1)
  assert.deepEqual(intake.orderNumbersIn('So-000231 Nida, also SO 228'), ['SO-000231', 'SO-000228'])
  assert.equal(intake.collectionIn('C14 shoot Videographer'), 14)
})

test('a salary with no payroll week books the wage from the transfer: salary + market + fabric = the whole transfer', async () => {
  const week = intake.weekFromNote(`Sep ${YEAR} Week 1`)
  const item = await inboxFile(transfer({ reference: `T${RUN}A`, date: week, amount: 32110, from_name: 'KOKO ATELIER', to_name: `REHAN SALEEM ${RUN}`,
    note_lines: [line(`Sep ${YEAR}`), line('Week 1'), line('Tailor Salary', 15000), line('Market', 3810), line('Dubai Outfits Fabric Maroon', 13300), line('Final Payment', 32110)] }))
  const read = await intake.readItem(item.id)
  assert.equal(read.kind, 'staff_payment'); assert.deepEqual(read.issues, []); assert.equal(read.status, 'Ready')
  const [salary, market, fabric] = read.proposal.parts
  assert.equal(salary.kind, 'salary'); assert.equal(salary.direct, true); assert.equal(salary.weekEnding, week)
  assert.equal(market.lines[0].accountId, acct.consumables.id)
  assert.equal(fabric.kind, 'claim'); assert.equal(fabric.lines[0].accountId, acct.cogs_materials.id)
  const posted = await intake.approveItem(item.id, {}, owner)
  const lines = await entryLines(posted.entryId)
  assert.ok(lines.some(([a, d]) => a === acct.cogs_labour.id && d === '15000.00'), 'the wage is a production cost, not a payable')
  assert.ok(lines.some(([a, , c]) => a === acct.bank_baf.id && c === '32110.00'))
  // the week's payroll leaves out who was already paid from a transfer, and the same week can't be paid twice
  const run = await pay.createRun({ weekEnding: week }, owner)
  assert.ok(!run.lines.some((l) => l.staffId === staff.id))
  await fails(pay.saveRun(run.id, { lines: [{ staffId: staff.id, weeklySalary: '15000' }] }), /already booked/)
  await pay.deleteRun(run.id)
  const again = await inboxFile(transfer({ reference: `T${RUN}A2`, date: week, amount: 15000, from_name: 'KOKO ATELIER', to_name: `REHAN SALEEM ${RUN}`,
    note_lines: [line(`Sep ${YEAR} Week 1`), line('Tailor Salary', 15000)] }))
  await intake.readItem(again.id)
  await fails(intake.approveItem(again.id, {}, owner), /already paid/)
})

test('"Embroidery Salary 12500 1 Day Off" is salary less a day, not embroidery work; a wrong amount is flagged', async () => {
  const week = intake.weekFromNote(`Sep ${YEAR} Week 3`)
  const item = await inboxFile(transfer({ reference: `T${RUN}B`, date: week, amount: 12500, from_name: 'KOKO ATELIER', to_name: `REHAN SALEEM ${RUN}`,
    note_lines: [line(`Sep ${YEAR}`), line('Week 3'), line('Embroidery Salary 1Day Off', 12500)] }))
  const read = await intake.readItem(item.id)
  const [salary] = read.proposal.parts
  assert.equal(salary.kind, 'salary'); assert.equal(salary.daysOff, 1); assert.equal(salary.expected, '12500.00')
  assert.equal(read.status, 'Ready')
  const off = await inboxFile(transfer({ reference: `T${RUN}B2`, date: week, amount: 13000, from_name: 'KOKO ATELIER', to_name: `REHAN SALEEM ${RUN}`,
    note_lines: [line(`Sep ${YEAR} Week 4`), line('Salary 1 day off', 13000)] }))
  const r2 = await intake.readItem(off.id)
  assert.equal(r2.status, 'Needs attention'); assert.match(r2.issues.join(' '), /would be 12500/)
})

test('studio cleaning paid to a staff member is a claim; "overtime" on the note asks for a look', async () => {
  const item = await inboxFile(transfer({ reference: `T${RUN}C`, date: `${YEAR}-09-28`, amount: 5320, from_name: 'KOKO ATELIER', to_name: `REHAN SALEEM ${RUN}`,
    note_lines: [line('Studio Cleaning Labor', 5320), line('Saman/Labor/Overtime/Lunch')] }))
  const read = await intake.readItem(item.id)
  assert.equal(read.proposal.parts[0].kind, 'claim'); assert.equal(read.proposal.parts[0].lines[0].accountId, acct.repairs.id)
  assert.equal(read.status, 'Needs attention'); assert.match(read.issues.join(' '), /overtime/)
})

test('a videographer paid for "C<n> shoot" is a photoshoot expense costed to that collection', async () => {
  const [c] = await sql`SELECT id, name FROM collections ORDER BY id LIMIT 1`
  const item = await inboxFile(transfer({ reference: `T${RUN}D`, date: TODAY, amount: 25000, from_name: 'KOKO ATELIER', to_name: `ASIM VIDEO ${RUN}`,
    note_lines: [line(`C${c.id} shoot`), line('Videographer'), line('Final payment', 25000)] }))
  const read = await intake.readItem(item.id)
  assert.equal(read.kind, 'expense'); assert.equal(read.proposal.accountId, acct.photoshoots.id)
  assert.equal(read.proposal.collectionId, c.id); assert.equal(read.status, 'Ready')
  const posted = await intake.approveItem(item.id, {}, owner)
  const [x] = await sql`SELECT collection_id, account_id FROM fin_expenses WHERE id = ${posted.resultId}`
  assert.equal(x.collection_id, c.id)
})

test('money in with the order number on the note: the sender\'s fee is taken off and the payment lands on the order', async () => {
  const o = await newOrder(`TEST Baig ${RUN}`, 13500)
  const ref = `T${RUN}E`
  const item = await inboxFile(transfer({ reference: ref, date: TODAY, amount: 13515.66, fee: 15.66, from_name: `TEST BAIG ${RUN}`, to_name: 'KOKO ATELIER',
    note_lines: [line(`${o.orderNumber} RM`), line('DUNE VÉLORA Size Medium Qty 1 PKR', 13500)] }))
  const read = await intake.readItem(item.id)
  assert.equal(read.kind, 'customer_receipt'); assert.equal(read.proposal.amount, '13500.00')
  assert.equal(read.proposal.orderId, o.id); assert.equal(read.status, 'Ready'); assert.equal(read.proposal.attachTo, null)
  const posted = await intake.approveItem(item.id, {}, owner)
  assert.equal(posted.resultType, 'customer_payment')
  const [p] = await sql`SELECT amount, reference, method FROM customer_payments WHERE id = ${posted.resultId}`
  assert.equal(p.amount, '13500.00'); assert.equal(p.reference, ref)
  const [f] = await sql`SELECT 1 FROM customer_payment_files WHERE payment_id = ${posted.resultId} AND file_id = ${posted.fileId}`
  assert.ok(f, 'the receipt is on the payment')
  const [{ balance_due_pkr: due }] = await sql`SELECT balance_due_pkr FROM orders WHERE id = ${o.id}`
  assert.equal(due, '0.00')
  // the same slip again is a duplicate
  const dup = await inboxFile(transfer({ reference: ref, date: TODAY, amount: 13515.66, fee: 15.66, from_name: 'X', to_name: 'KOKO ATELIER', note_lines: [line(o.orderNumber)] }))
  assert.equal((await intake.readItem(dup.id)).status, 'Duplicate')
})

test('a director paying in for a customer: the order number wins over "funds added"; a payment already recorded just gets the receipt', async () => {
  const o = await newOrder(`TEST Nida ${RUN}`, 7500, 7500)          // the order screen recorded the 7,500 already
  const item = await inboxFile(transfer({ reference: `T${RUN}F`, date: TODAY, amount: 7500, from_name: 'OMER FAROOQ', to_name: 'KOKO ATELIER',
    note_lines: [line(`So-${o.orderNumber.slice(3)}`), line(`Nida ${RUN}`), line('Damaged article Mehfil Medium', 7500)] }))
  const read = await intake.readItem(item.id)
  assert.equal(read.kind, 'customer_receipt'); assert.equal(read.proposal.via, 'omer')
  assert.ok(read.proposal.attachTo, 'matched to the recorded payment'); assert.equal(read.status, 'Ready')
  const [{ n: before }] = await sql`SELECT count(*)::int AS n FROM customer_payments WHERE order_id = ${o.id}`
  const posted = await intake.approveItem(item.id, {}, owner)
  const [{ n: afterN }] = await sql`SELECT count(*)::int AS n FROM customer_payments WHERE order_id = ${o.id}`
  assert.equal(afterN, before, 'no second payment')
  const [p] = await sql`SELECT reference, method_confirmed FROM customer_payments WHERE id = ${posted.resultId}`
  assert.equal(p.reference, `T${RUN}F`); assert.equal(p.method_confirmed, true)
})

test('money in with no order number is matched by balance and the payer\'s name', async () => {
  const amount = 4000 + (Date.now() % 900)
  const o = await newOrder(`TEST Payer ${RUN}`, amount)
  const item = await inboxFile(transfer({ reference: `T${RUN}G`, date: TODAY, amount, from_name: `TEST PAYER ${RUN}`, to_name: 'KOKO ATELIER' }))
  const read = await intake.readItem(item.id)
  assert.equal(read.proposal.orderId, o.id); assert.equal(read.status, 'Ready')
  const stranger = await inboxFile(transfer({ reference: `T${RUN}H`, date: TODAY, amount: 1234567, from_name: 'Nobody Known', to_name: 'KOKO ATELIER' }))
  const r2 = await intake.readItem(stranger.id)
  assert.equal(r2.status, 'Needs attention'); assert.match(r2.issues.join(' '), /order/)
  await fails(intake.approveItem(stranger.id, {}, owner), /Choose the order/)
})

test('a folder scan sends each file once: the original\'s fingerprint is remembered', async () => {
  const hash = createHash('sha256').update(`${RUN}-photo`).digest('hex')
  const f1 = await files.saveFile({ name: `a-${RUN}.png`, mime: 'image/png', data: randomBytes(32).toString('base64') }, owner, 'Inbox')
  const [first] = await intake.addFiles([{ fileId: f1.id, sourceHash: hash, sourcePath: `Nov/slip-${RUN}.jpg` }], owner)
  assert.equal(first.alreadyIn, false); assert.equal(first.sourcePath, `Nov/slip-${RUN}.jpg`)
  assert.deepEqual((await intake.knownHashes([hash, 'f'.repeat(64)])).known, [hash])
  const f2 = await files.saveFile({ name: `b-${RUN}.png`, mime: 'image/png', data: randomBytes(32).toString('base64') }, owner, 'Inbox')
  const again = await intake.addFiles([{ fileId: f2.id, sourceHash: hash, sourcePath: 'copy.jpg' }], owner)
  assert.ok(again.every((i) => i.alreadyIn)); assert.ok(!again.some((i) => i.fileId === f2.id))
})

test('a Collage transfer waits for the reseller page', async () => {
  const item = await inboxFile(transfer({ reference: `T${RUN}K`, date: TODAY, amount: 90000, from_name: 'FASHION COLLAGE LLC', to_name: 'KOKO ATELIER' }))
  const read = await intake.readItem(item.id)
  assert.equal(read.kind, 'reseller_payment')
  await fails(intake.approveItem(item.id, {}, owner), /reseller/i)
  assert.equal(toPaisa(read.amount), 9000000)
})
