// F2b: receipt and screenshot intake (migration 017, lib/finance/intake.js + vision.js). Runs ONLY on
// koko_finance_dev, with a stand-in reader (no Claude API call). Postings use fiscal years 2094-95 and
// 2095-96 (created as needed); references and names carry a run stamp so reruns don't clash.
// Run: npm run test:finance
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'crypto'

const devUrl = process.env.FINANCE_DEV_DATABASE_URL
if (!devUrl || new URL(devUrl).pathname !== '/koko_finance_dev') throw new Error('FINANCE_DEV_DATABASE_URL must point at koko_finance_dev')
process.env.DATABASE_URL = devUrl

const { neon } = await import('@neondatabase/serverless')
const { toPaisa } = await import('../../lib/finance/money.js')
const ledger = await import('../../lib/finance/ledger.js')
const files = await import('../../lib/finance/files.js')
const ex = await import('../../lib/finance/expenses.js')
const pay = await import('../../lib/finance/payroll.js')
const intake = await import('../../lib/finance/intake.js')
const { sanitise } = await import('../../lib/finance/vision.js')
const sql = neon(devUrl)

const RUN = Date.now().toString(36).toUpperCase()
let owner, acct, staff, weekCursor
const readings = new Map()                       // file name -> what the stand-in reader "sees"
intake.setExtractor(async (f) => { const r = readings.get(f.name); if (!r) throw new Error('unreadable'); return r })
const fails = async (p, re) => { try { await p } catch (err) { if (re) assert.match(err.message, re); return err } assert.fail('expected an error') }
const addDays = (d, n) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) }

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
async function nextSaturday() {
  weekCursor = addDays(weekCursor, 7)
  await ensureFY(addDays(weekCursor, -6)); await ensureFY(addDays(weekCursor, 1))
  return weekCursor
}
// A new inbox file (random bytes, so it is never de-duplicated by hash) that reads as `reading`
async function inboxFile(reading) {
  const name = `test-${RUN}-${randomBytes(4).toString('hex')}.png`
  readings.set(name, reading)
  const f = await files.saveFile({ name, mime: 'image/png', data: randomBytes(64).toString('base64') }, owner, 'Inbox')
  const [item] = await intake.addFiles([f.id], owner)
  return item
}
const partyNet = async (key, partyId) => {
  const [r] = await sql`SELECT coalesce(sum(l.debit - l.credit), 0) AS n FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'Draft'
    WHERE l.account_id = ${acct[key].id} AND l.party_type = 'staff' AND l.party_id = ${String(partyId)}`
  return toPaisa(r.n)
}
const transfer = (o) => ({ doc_type: 'bank_transfer', source: 'Bank Alfalah', currency: 'PKR', confidence: 0.95, note_lines: [], ...o })

before(async () => {
  await sql`INSERT INTO users (username, name, role, password_hash) SELECT 'fin_test_owner', 'fin_test_owner', 'owner', 'x' WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(username) = 'fin_test_owner')`
  ;[owner] = await sql`SELECT id, username, role FROM users WHERE username = 'fin_test_owner'`
  acct = Object.fromEntries((await sql`SELECT id, code, system_key FROM fin_accounts WHERE system_key IS NOT NULL`).map((a) => [a.system_key, a]))
  const [{ last }] = await sql`SELECT max(week_ending)::text AS last FROM fin_payroll_runs WHERE week_ending BETWEEN '2094-07-01' AND '2096-06-01'`
  weekCursor = last || '2094-07-03'                               // a Saturday; the first test week ends 10 Jul 2094
  while (new Date(`${weekCursor}T00:00:00Z`).getUTCDay() !== 6) weekCursor = addDays(weekCursor, 1)
  await ensureFY('2094-07-10')
  staff = await pay.createStaff({ name: `TEST Kashif ${RUN}`, aliases: [`Kashif Mehmood ${RUN}`], roleTitle: 'tailor', payType: 'weekly_salary', isProduction: true,
    weeklySalary: '17500', salaryFrom: '2094-07-01' })
})
after(async () => { if (staff) await pay.updateStaff(staff.id, { isActive: false }) })

test('the current studio staff and their other spellings', async () => {
  const list = await pay.listStaff()
  const active = list.filter((s) => s.isActive).map((s) => s.name)
  for (const n of ['Abdur Rahman', 'Jhangir', 'Master Sarfaraz']) assert.ok(active.includes(n), n)
  assert.ok(!active.includes('Master Iftikhar'))
  assert.equal(intake.matchName('ABDUR REHMAN', list)?.name, 'Abdur Rahman')
  assert.equal(intake.matchName('Jahangir', list)?.name, 'Jhangir')
  assert.equal(intake.matchName('Koko Atelier Pvt Ltd', list), null)
})

test('only names and the last 4 digits are kept from a screenshot', () => {
  const s = sanitise({ doc_type: 'bank_transfer', from_name: 'Omer Farooq', from_account_last4: 'PK36ALFH0123456789012345', to_account_last4: '0001-2345-6789',
    purpose: 'CNIC 35202-1234567-1 acct 01234567890123', reference: '326622377526', amount: '31,700', date: '2026-11-22', confidence: 0.9 })
  assert.equal(s.fromLast4, '2345'); assert.equal(s.toLast4, '6789')
  assert.doesNotMatch(s.purpose, /35202|1234567890/)
  assert.equal(s.reference, '326622377526'); assert.equal(s.amount, 31700)
})

test('22 Nov example 1: "Funds added OmerF" from Omer to Koko is owner funding; the same reference twice is a duplicate', async () => {
  const ref = `T${RUN}F`
  const item = await inboxFile(transfer({ reference: ref, date: '2094-07-20', amount: 31700, from_name: 'OMER FAROOQ', to_name: 'KOKO ATELIER PVT LTD', purpose: 'Funds added OmerF' }))
  const read = await intake.readItem(item.id)
  assert.equal(read.kind, 'owner_funding'); assert.equal(read.status, 'Ready'); assert.equal(read.proposal.director, 'omer')
  const again = await inboxFile(transfer({ reference: ref, date: '2094-07-20', amount: 31700, from_name: 'OMER FAROOQ', to_name: 'KOKO ATELIER PVT LTD' }))
  assert.equal((await intake.readItem(again.id)).status, 'Duplicate')
  const posted = await intake.approveItem(item.id, {}, owner)
  assert.equal(posted.status, 'Posted')
  const e = await ledger.getEntry(posted.entryId)
  assert.deepEqual(e.lines.map((l) => [l.accountId, l.debit, l.credit]), [[acct.bank_baf.id, '31700.00', '0.00'], [acct.director_omer.id, '0.00', '31700.00']])
  const [f] = await sql`SELECT name, folder FROM fin_files WHERE id = ${posted.fileId}`
  assert.equal(f.name, `2094-07-20_BK_${ref}_31700.png`); assert.equal(f.folder, 'Payments/2094-07')
  await fails(intake.approveItem(item.id, {}, owner), /posted/i)
})

test('22 Nov example 2: Tailor Salary 17,500 + Market 5,700 = 23,200 settles the posted week and books the market spend as a claim', async () => {
  const we = await nextSaturday()
  const run = await pay.createRun({ weekEnding: we }, owner)
  const mine = run.lines.find((l) => l.staffId === staff.id)
  await pay.saveRun(run.id, { lines: [mine] })
  await pay.postRun(run.id, owner)
  const ref = `T${RUN}S`
  const item = await inboxFile(transfer({ reference: ref, date: addDays(we, 1), amount: 23200, from_name: 'KOKO ATELIER PVT LTD', to_name: `KASHIF MEHMOOD ${RUN}`,
    note_lines: [{ text: 'Nov 26 Week 3', amount: null }, { text: 'Tailor Salary', amount: 17500 }, { text: 'Market', amount: 5700 }, { text: 'Final Payment', amount: 23200 }] }))
  const read = await intake.readItem(item.id)
  assert.equal(read.kind, 'staff_payment'); assert.equal(read.proposal.staffId, staff.id)
  assert.deepEqual(read.issues, []); assert.equal(read.status, 'Ready')
  const [salary, market] = read.proposal.parts
  assert.equal(salary.kind, 'salary'); assert.equal(salary.weekEnding, we, 'linked to the posted week')
  assert.equal(market.kind, 'claim'); assert.equal(market.lines[0].accountId, acct.consumables.id)
  assert.equal(await partyNet('wages_payable', staff.id), -1750000)
  const posted = await intake.approveItem(item.id, {}, owner)
  assert.equal(posted.resultType, 'staff_payment')
  assert.equal(await partyNet('wages_payable', staff.id), 0)
  assert.equal(await partyNet('ap_staff_claims', staff.id), 0)
  const [claim] = await ex.listClaims({ staffId: staff.id })
  assert.equal(claim.status, 'Paid'); assert.equal(claim.total, '5700.00'); assert.equal(claim.weekEnding, we)
  const bank = (await ledger.getEntry(posted.entryId)).lines.find((l) => l.accountId === acct.bank_baf.id)
  assert.equal(bank.credit, '23200.00')
  // a second screenshot of the same transfer is caught
  const dup = await inboxFile(transfer({ reference: ref, date: addDays(we, 1), amount: 23200, from_name: 'KOKO ATELIER', to_name: `KASHIF MEHMOOD ${RUN}` }))
  const d = await intake.readItem(dup.id)
  assert.equal(d.status, 'Duplicate'); assert.match(d.issues[0], /inbox item|staff payment/)
})

test('a note that does not add up needs attention and cannot be approved until fixed', async () => {
  const item = await inboxFile(transfer({ reference: `T${RUN}N`, date: '2094-08-03', amount: 20000, from_name: 'Koko Atelier', to_name: `Kashif Mehmood ${RUN}`,
    note_lines: [{ text: 'Salary', amount: 17500 }, { text: 'Market', amount: 2000 }] }))
  const read = await intake.readItem(item.id)
  assert.equal(read.status, 'Needs attention')
  assert.ok(read.issues.some((x) => /add up to 19500.00/.test(x)))
  await fails(intake.approveItem(item.id, {}, owner), /add up/)
  // fixed in review: it was an advance of 500 as well
  const parts = [...read.proposal.parts, { kind: 'advance', amount: '500' }]
  const fixed = await intake.saveItem(item.id, { kind: 'staff_payment', proposal: { ...read.proposal, parts } })
  assert.equal(fixed.status, 'Ready')
  await intake.setItemStatus(item.id, 'Rejected', { reason: 'TEST tidy' }, owner)
})

test('a failed approval leaves nothing half-done', async () => {
  const before = await sql`SELECT count(*)::int AS n FROM fin_claims WHERE staff_id = ${staff.id} AND status IN ('Submitted', 'Approved', 'Paid')`
  const item = await inboxFile(transfer({ reference: `T${RUN}X`, date: '2094-08-04', amount: 6000, from_name: 'Koko Atelier', to_name: `Kashif Mehmood ${RUN}`,
    note_lines: [{ text: 'Market', amount: 5000 }, { text: 'Salary', amount: 1000 }] }))
  const read = await intake.readItem(item.id)
  // point the salary at a draft (unposted) week: the payment is refused
  const draft = await pay.createRun({ weekEnding: await nextSaturday() }, owner)
  const line = draft.lines.find((l) => l.staffId === staff.id)
  const parts = read.proposal.parts.map((x) => (x.kind === 'salary' ? { ...x, payrollLineId: line.id } : x))
  await fails(intake.approveItem(item.id, { kind: 'staff_payment', proposal: { ...read.proposal, parts } }, owner), /post that payroll week/)
  const after = await sql`SELECT count(*)::int AS n FROM fin_claims WHERE staff_id = ${staff.id} AND status IN ('Submitted', 'Approved', 'Paid')`
  assert.equal(after[0].n, before[0].n, 'the claim made for it was taken back')
  assert.equal(await partyNet('ap_staff_claims', staff.id), 0)
  assert.notEqual((await intake.getItem(item.id)).status, 'Posted')
  await pay.deleteRun(draft.id)
  await intake.setItemStatus(item.id, 'Parked', { reason: 'TEST' }, owner)
  assert.equal((await intake.reopenItem(item.id)).status !== 'Parked', true)
  await intake.setItemStatus(item.id, 'Rejected', { reason: 'TEST tidy' }, owner)
})

test('a shop receipt becomes a cash expense; sticker words pick the category; a new supplier is added on approval', async () => {
  const shop = `TEST Rehmat Cloth House ${RUN}`
  const item = await inboxFile({ doc_type: 'receipt', shop, date: '2094-08-05', amount: 4800, confidence: 0.9,
    items: [{ description: 'Lawn fabric 4m', amount: 3200 }, { description: 'Lining', amount: 1600 }], total: 4800 })
  const read = await intake.readItem(item.id)
  assert.equal(read.kind, 'expense'); assert.equal(read.proposal.paidFrom, 'cash')
  assert.equal(read.proposal.accountId, acct.cogs_materials.id, '"fabric" is a sticker word for materials')
  const posted = await intake.approveItem(item.id, {}, owner)
  const x = await ex.getExpense(posted.resultId)
  assert.equal(x.supplierName, shop); assert.equal(x.amount, '4800.00'); assert.equal(x.fileList.length, 1)
  await ex.voidExpense(x.id, { reason: 'TEST tidy' }, owner)
})

test('typed in by hand when there is no reader; money coming in waits for F3', async () => {
  const item = await inboxFile({ doc_type: 'other', confidence: 0 })
  const typed = await intake.saveItem(item.id, { extracted: { doc_type: 'bank_transfer', reference: `T${RUN}C`, date: '2094-08-06', amount: 9500, from_name: 'Ayesha Khan', to_name: 'Koko Atelier' } })
  assert.equal(typed.readBy, 'hand'); assert.equal(typed.kind, 'customer_receipt'); assert.equal(typed.status, 'Needs attention')
  await fails(intake.approveItem(item.id, {}, owner), /F3/)
  assert.equal((await intake.setItemStatus(item.id, 'Parked', {}, owner)).status, 'Parked')
})
