// F4: bank reconciliation (migration 019, lib/finance/bankParse.js + bank.js). Runs ONLY on koko_finance_dev.
// The fixture is a SYNTHETIC statement in the Bank Alfalah layout (made-up counterparties, references,
// address and amounts; only Koko's own account ending and names already in the code are real). It is moved
// to a year of its own each run (2060–2089) so reruns never overlap.
// Run: npm run test:finance
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'

const devUrl = process.env.FINANCE_DEV_DATABASE_URL
if (!devUrl || new URL(devUrl).pathname !== '/koko_finance_dev') throw new Error('FINANCE_DEV_DATABASE_URL must point at koko_finance_dev')
process.env.DATABASE_URL = devUrl

const { neon } = await import('@neondatabase/serverless')
const { parseStatementText, parseStatementRows } = await import('../../lib/finance/bankParse.js')
const bank = await import('../../lib/finance/bank.js')
const ledger = await import('../../lib/finance/ledger.js')
const db = await import('../../lib/db.js')
const sql = neon(devUrl)

const FIXTURE = fs.readFileSync(new URL('./fixtures/baf-statement-synthetic.txt', import.meta.url), 'utf8').split(/\r?\n/)
let Y, owner, acct, lines, statement
const fails = async (p, re) => { try { await p } catch (err) { if (re) assert.match(err.message, re); return err } assert.fail('expected an error') }
const inYear = (y) => FIXTURE.map((l) => l.replace(/(\d{2} [A-Z][a-z]{2}) 2026/g, `$1 ${y}`).replace(/(\d{2}\/\d{2})\/2026/g, `$1/${y}`))
const line = (n) => statement.lines.find((l) => l.lineNo === n)

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

before(async () => {
  await sql`INSERT INTO users (username, name, role, password_hash) SELECT 'fin_test_owner', 'fin_test_owner', 'owner', 'x' WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(username) = 'fin_test_owner')`
  ;[owner] = await sql`SELECT id, username, role FROM users WHERE username = 'fin_test_owner'`
  acct = Object.fromEntries((await sql`SELECT id, code, system_key FROM fin_accounts WHERE system_key IS NOT NULL`).map((a) => [a.system_key, a]))
  // A year no earlier run used
  const used = new Set((await sql`SELECT extract(year FROM period_from)::int AS y FROM fin_bank_statements`).map((r) => r.y))
  Y = Array.from({ length: 30 }, (_, i) => 2060 + i).find((y) => !used.has(y))
  await ensureFY(`${Y}-10-01`)
  lines = inYear(Y)
})

test('a Bank Alfalah statement is read in full: 26 lines, the balance chain holds, money in and out from the balance', () => {
  const s = parseStatementText(FIXTURE)
  assert.equal(s.bank, 'Bank Alfalah'); assert.equal(s.accountLast4, '2846')
  assert.equal(s.from, '2026-10-01'); assert.equal(s.to, '2026-10-31')
  assert.equal(s.opening, 2500000); assert.equal(s.closing, 13351312)
  assert.equal(s.lines.length, 26)
  assert.deepEqual(s.checks, { lines: 26, balanceChain: true, closingMatches: true })
  const byNo = (n) => s.lines[n - 1]
  assert.equal(byNo(1).amount, -504700); assert.equal(byNo(1).party, 'HAMZA TARIQ'); assert.equal(byNo(1).partyLast4, '4101')
  assert.equal(byNo(2).amount, 5423600); assert.equal(byNo(2).party, 'OMER FAROOQ'); assert.equal(byNo(2).reference, 'FT26WK1DEGZD8PCF')
  assert.equal(byNo(6).channel, 'charge'); assert.equal(byNo(6).amount, -988)
  assert.equal(byNo(12).balance, -288888, 'an overdrawn balance is read as negative')
  assert.equal(byNo(16).party, 'USMAN AHMED'); assert.equal(byNo(16).amount, 3104200)
  assert.equal(byNo(25).channel, 'transfer'); assert.equal(byNo(25).party, 'TARIQ MEHMOOD')
  assert.equal(byNo(26).party, 'MASTERCARD TRANSACTION PAYABLE'); assert.equal(byNo(26).amount, 23588800)
  for (const l of s.lines) assert.doesNotMatch(l.narration, /\d{7,}/, 'account and phone numbers are cut to the last 4')
})

test('a misread amount breaks the balance chain and the import is refused', async () => {
  const bad = lines.map((l) => l.replace('16,323.00 28,506.00', '16,823.00 28,506.00'))
  const s = parseStatementText(bad)
  assert.equal(s.checks.balanceChain, false)
  assert.ok(s.lines[3].issue)
  await fails(bank.importStatement({ textLines: bad, source: 'pdf' }, owner), /doesn't add up/)
})

test('CSV / Excel rows: debit and credit columns, opening worked out from the first balance', () => {
  const s = parseStatementRows([
    { date: '05/10/2026', description: 'Opening Balance', balance: '25,000.00' },
    { date: '05/10/2026', description: 'IBFT From KOKO ATELIER - Bank Alfalah Limited - 00000000002846 To HAMZA TARIQ - JazzCash - 03000004101', debit: '5,047.00', balance: '19,953.00' },
    { date: '05/10/2026', description: 'Raast P2P Funds Transfer from OMER FAROOQ ******7001 [Ref: X1]', credit: '54,236.00', balance: '74,189.00' },
  ])
  assert.equal(s.opening, 2500000); assert.equal(s.lines.length, 2)
  assert.deepEqual(s.lines.map((l) => l.amount), [-504700, 5423600])
  assert.equal(s.checks.balanceChain, true)
})

test('import: stored without full numbers, entries already in the books are matched automatically', async () => {
  // Omer's 54,236 is already in the books, posted a day later
  const funding = await ledger.createEntry({ date: `${Y}-10-06`, entryType: 'BK', memo: 'Funds added by Omer', post: true, source: { type: 'test', id: `${Y}-omer`, event: 'f4' },
    lines: [{ accountId: acct.bank_baf.id, debit: '54236' }, { accountId: acct.director_omer.id, credit: '54236', partyType: 'director', partyId: 'omer' }] }, owner)
  const preview = await bank.previewStatement({ textLines: lines })
  assert.equal(preview.account.id, acct.bank_baf.id, 'account found by its last 4 digits')
  statement = await bank.importStatement({ textLines: lines, source: 'pdf' }, owner)
  assert.equal(statement.lines.length, 26)
  assert.equal(statement.autoMatched, 1)
  assert.equal(line(2).status, 'Matched'); assert.equal(line(2).entryId, funding.id)
  const stored = await sql`SELECT narration FROM fin_bank_lines WHERE statement_id = ${statement.id}`
  assert.ok(stored.every((r) => !/\d{7,}/.test(r.narration)))
  await fails(bank.importStatement({ textLines: lines, source: 'pdf' }, owner), /already imported/)
})

test('suggestions: bank charges, directors, studio staff by their bank names', () => {
  assert.equal(line(6).suggest.action, 'bank_charge')
  assert.equal(line(8).suggest.action, 'director'); assert.equal(line(8).suggest.director, 'omer')
  assert.equal(line(16).suggest.director, 'usman')
  assert.equal(line(20).suggest.director, 'usman', 'money to Usman too')
  assert.equal(line(3).suggest.action, 'staff')
  assert.equal(line(17).suggest.action, 'staff', 'SARFARAZ AHMED BAIG is Master Sarfaraz')
  assert.equal(line(9).suggest.action, 'staff', 'JAHANGIR MAJEED is Jhangir')
  assert.equal(line(26).suggest.action, 'customer')
})

test('booking lines that are not in the books, and remembering who a name is', async () => {
  statement = await bank.bookLine(line(6).id, { action: 'bank_charge' }, owner)
  const charge = await ledger.getEntry(line(6).entryId)
  assert.deepEqual(charge.lines.map((l) => [l.accountId, l.debit, l.credit]), [[acct.bank_charges.id, '9.88', '0.00'], [acct.bank_baf.id, '0.00', '9.88']])
  statement = await bank.bookLine(line(8).id, { action: 'director', director: 'omer' }, owner)
  assert.equal(line(8).status, 'Matched')
  const [staff] = await sql`SELECT id FROM fin_staff WHERE name = 'Abdur Rahman'`
  statement = await bank.bookLine(line(3).id, { action: 'staff', staffId: staff.id, kind: 'salary' }, owner)
  assert.match(line(3).note, /Salary to Abdur Rahman/)
  const supplier = `TEST Zain Qureshi ${Y}`
  statement = await bank.bookLine(line(11).id, { action: 'expense', accountId: acct.cogs_materials.id, supplierName: supplier, description: 'Fabric' }, owner)
  assert.match(line(11).note, /Expense: 5100/)
  assert.ok((await bank.listRules()).some((r) => r.pattern === 'zain qureshi' && r.action === 'expense'), 'remembered for next month')
  assert.equal(line(14).suggest.action, 'expense')
  statement = await bank.bookLine(line(25).id, { action: 'other', accountId: acct.prepayments.id, description: 'Deposit' }, owner)
  await fails(bank.bookLine(line(24).id, { action: 'other', accountId: acct.ar_customers.id }, owner), /kept by the system/)
  await fails(bank.bookLine(line(15).id, { action: 'staff', staffId: staff.id }, owner), /not a staff payment/)
  // a customer payment lands on the order
  const [product] = await sql`SELECT id FROM products ORDER BY id LIMIT 1`
  const o = await db.createOrder({ customer: `TEST F4 ${Y}`, channel: 'Studio', orderDate: `${Y}-10-01`, items: [{ productId: product.id, size: 'M', quantity: 1, unitPrice: 74587 }], amount: 74587 }, owner)
  assert.ok((await bank.findOrders({ q: `TEST F4 ${Y}`, amount: '74587' })).some((x) => x.id === o.id))
  statement = await bank.bookLine(line(15).id, { action: 'customer', orderId: o.id }, owner)
  assert.equal((await db.getOrder(o.id)).advancePaid, 74587)
  assert.match(line(15).note, /Payment for SO-/)
  await fails(bank.bookLine(line(15).id, { action: 'bank_charge' }, owner), /already dealt with/)
})

test('matching by hand, unmatching, ignoring; reconciling needs every line dealt with', async () => {
  // an entry for Usman's 31,042 posted 8 days later than the bank date: not auto-matched, matched by hand
  const e = await ledger.createEntry({ date: `${Y}-10-30`, entryType: 'BK', memo: 'Usman funds', post: true, source: { type: 'test', id: `${Y}-usman`, event: 'f4' },
    lines: [{ accountId: acct.bank_baf.id, debit: '31042' }, { accountId: acct.director_usman.id, credit: '31042', partyType: 'director', partyId: 'usman' }] }, owner)
  const wrong = await ledger.createEntry({ date: `${Y}-10-30`, entryType: 'BK', memo: 'Other', post: true, source: { type: 'test', id: `${Y}-wrong`, event: 'f4' },
    lines: [{ accountId: acct.bank_baf.id, debit: '1' }, { accountId: acct.director_usman.id, credit: '1' }] }, owner)
  await fails(bank.matchLine(line(16).id, wrong.id, owner), /moves 1.00 through the bank/)
  statement = await bank.matchLine(line(16).id, e.id, owner)
  assert.equal(line(16).status, 'Matched'); assert.equal(line(16).matchedBy, 'manual')
  await fails(bank.matchLine(line(20).id, e.id, owner), /already dealt with|moves/)
  statement = await bank.unmatchLine(line(16).id, owner)
  assert.equal(line(16).status, 'Unmatched')
  await fails(bank.ignoreLine(line(7).id, {}, owner), /why/)
  statement = await bank.ignoreLine(line(7).id, { reason: 'TEST: charge refunded next month' }, owner)
  assert.equal(line(7).status, 'Ignored')
  const r = statement.reconciliation
  const unmatched = statement.lines.filter((l) => l.status === 'Unmatched')
  assert.equal(r.counts.unmatched, unmatched.length)
  assert.equal(Number(r.notInBooks), unmatched.reduce((s, l) => s + Number(l.amount), 0))
  await fails(bank.setReconciled(statement.id, { reconciled: true }, owner), /still need/)
})

test('a date column that wraps the year onto the next line is still read', () => {
  const s = parseStatementText(['Statement of Account From Date:01/10/2026 To Date:31/10/2026', 'Date Description Cheq/Inst# Debit Credit Balance', 'Opening Balance 100.00',
    '05 Oct IBFT From KOKO ATELIER - Bank Alfalah 10.00 90.00', '2026 Limited - 00000000002846 To HAMZA TARIQ - JazzCash - 03000004101', 'Closing Balance 90.00'])
  assert.equal(s.lines.length, 1); assert.equal(s.lines[0].date, '2026-10-05'); assert.equal(s.lines[0].party, 'HAMZA TARIQ')
  assert.deepEqual(s.checks, { lines: 1, balanceChain: true, closingMatches: true })
})

test('page headers between transactions never end up in a description', () => {
  const s = parseStatementText(['Statement of Account From Date:01/10/2026 To Date:31/10/2026', 'Date Description Cheq/Inst# Debit Credit Balance', 'Opening Balance 100.00',
    '05 Oct 2026 IBFT From KOKO ATELIER - Bank Alfalah 10.00 90.00', 'Bank Alfalah MONTHLY', 'Page 2 of 2 Statement of Account From Date:01/10/2026 To Date:31/10/2026',
    'Date Description Cheq/Inst# Debit Credit Balance', 'Closing Balance 90.00'])
  assert.equal(s.lines[0].description, 'IBFT From KOKO ATELIER - Bank Alfalah')
})
