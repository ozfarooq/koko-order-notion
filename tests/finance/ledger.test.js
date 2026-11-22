// Ledger rules (migration 013 + lib/finance/ledger.js). Runs ONLY on the finance development
// database: posted journals are permanent, so these tests must never touch the live books.
// Test entries live in fiscal year 2098-99 so they stay out of the real periods.
// Run: npm run test:finance
import { test, before } from 'node:test'
import assert from 'node:assert/strict'

const devUrl = process.env.FINANCE_DEV_DATABASE_URL
if (!devUrl || new URL(devUrl).pathname !== '/koko_finance_dev') throw new Error('FINANCE_DEV_DATABASE_URL must point at koko_finance_dev')
process.env.DATABASE_URL = devUrl                 // every lib module reads this on first use

const { neon } = await import('@neondatabase/serverless')
const money = await import('../../lib/finance/money.js')
const ledger = await import('../../lib/finance/ledger.js')
const files = await import('../../lib/finance/files.js')
const sql = neon(devUrl)

let owner, manager, acct, periods
const D = (m, d = 15) => `2098-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`   // July..Dec 2098
const pair = (amount, a = 'bank_baf', b = 'director_omer') => [
  { accountId: acct[a].id, debit: amount, credit: '' }, { accountId: acct[b].id, debit: '', credit: amount }]
const fails = async (p, re) => { try { await p } catch (err) { if (re) assert.match(err.message, re); return err } assert.fail('expected an error') }

before(async () => {
  // Test users (the dev database has no live users)
  for (const [username, role] of [['fin_test_owner', 'owner'], ['fin_test_manager', 'manager']])
    await sql`INSERT INTO users (username, name, role, password_hash) SELECT ${username}, ${username}, ${role}, 'x' WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(username) = lower(${username}))`
  const users = await sql`SELECT id, username, role FROM users WHERE username IN ('fin_test_owner', 'fin_test_manager')`
  owner = users.find((u) => u.role === 'owner'); manager = users.find((u) => u.role === 'manager')
  // The 2098-99 test year
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM fin_periods WHERE fiscal_year = '2098-99'`
  if (!n) {
    await sql`INSERT INTO fin_periods (fiscal_year, period_no, name, starts_on, ends_on, is_adjustment)
              SELECT '2098-99', g, to_char(m, 'Mon YYYY'), m::date, (m + interval '1 month - 1 day')::date, false
              FROM generate_series(1, 12) g, LATERAL (SELECT date '2098-07-01' + (g - 1) * interval '1 month' AS m) x`
    await sql`INSERT INTO fin_periods (fiscal_year, period_no, name, starts_on, ends_on, is_adjustment) VALUES ('2098-99', 13, 'Adjustments 2098-99', '2099-06-30', '2099-06-30', true)`
  }
  await sql`UPDATE fin_periods SET status = 'Open', closed_by = NULL, closed_at = NULL WHERE fiscal_year = '2098-99'`
  periods = Object.fromEntries((await sql`SELECT id, period_no FROM fin_periods WHERE fiscal_year = '2098-99'`).map((p) => [p.period_no, p.id]))
  acct = Object.fromEntries((await sql`SELECT id, code, system_key, is_control, is_active FROM fin_accounts WHERE system_key IS NOT NULL`).map((a) => [a.system_key, a]))
})

test('money: paisa conversions never use floating point sums', () => {
  assert.equal(money.toPaisa('1,234.5'), 123450)
  assert.equal(money.toPaisa(0.1) + money.toPaisa(0.2), money.toPaisa(0.3))
  assert.equal(money.fromPaisa(123405), '1234.05')
  assert.equal(money.fromPaisa(-5), '-0.05')
  assert.equal(money.formatRs(3170000), 'Rs 31,700.00')
  assert.throws(() => money.toPaisa('1.234'), /up to 2 decimals/)
  assert.throws(() => money.toPaisa('abc'))
})

test('a balanced manual journal posts with a JV number for its fiscal year', async () => {
  const e = await ledger.createEntry({ date: D(7), memo: 'TEST funds added', lines: pair('31700'), post: true }, owner)
  assert.equal(e.status, 'Posted')
  assert.match(e.entryNo, /^JV-9899-\d{6}$/)
  assert.equal(e.total, '31700.00')
  assert.equal(e.lines.length, 2)
})

test('an unbalanced journal is refused by the app', async () => {
  await fails(ledger.createEntry({ date: D(7), memo: 'TEST', post: true,
    lines: [{ accountId: acct.bank_baf.id, debit: '100' }, { accountId: acct.director_omer.id, credit: '99.99' }] }, owner), /must be equal/)
})

test('an unbalanced entry is refused by the database itself, even by raw SQL', async () => {
  const [{ id }] = await sql`SELECT nextval(pg_get_serial_sequence('fin_entries', 'id'))::bigint AS id`
  const err = await fails(sql.transaction([
    sql`INSERT INTO fin_entries (id, entry_date, memo) VALUES (${id}, ${D(7)}, 'TEST raw unbalanced')`,
    sql`INSERT INTO fin_lines (entry_id, line_no, account_id, debit) VALUES (${id}, 1, ${acct.bank_baf.id}, 100)`,
    sql`INSERT INTO fin_lines (entry_id, line_no, account_id, credit) VALUES (${id}, 2, ${acct.director_omer.id}, 50)`,
    sql`UPDATE fin_entries SET status = 'Posted' WHERE id = ${id}`,
  ]), /does not balance/)
  assert.ok(err)
  assert.equal((await sql`SELECT count(*)::int AS n FROM fin_entries WHERE id = ${id}`)[0].n, 0, 'nothing was saved')
  // An entry inserted straight as Posted with no lines fails at commit too
  await fails(sql`INSERT INTO fin_entries (entry_date, memo, status) VALUES (${D(7)}, 'TEST raw posted', 'Posted')`, /does not balance/)
})

test('a posted entry and its lines can never be changed or deleted', async () => {
  const e = await ledger.createEntry({ date: D(8), memo: 'TEST immutable', lines: pair('500'), post: true }, owner)
  await fails(sql`UPDATE fin_entries SET memo = 'changed' WHERE id = ${e.id}`, /cannot be changed/)
  await fails(sql`UPDATE fin_entries SET entry_date = ${D(8, 20)} WHERE id = ${e.id}`, /cannot be changed/)
  await fails(sql`DELETE FROM fin_entries WHERE id = ${e.id}`, /cannot be deleted/)
  await fails(sql`UPDATE fin_lines SET debit = 600 WHERE entry_id = ${e.id} AND debit > 0`, /cannot be changed/)
  await fails(sql`DELETE FROM fin_lines WHERE entry_id = ${e.id}`, /cannot be changed/)
  await fails(sql`INSERT INTO fin_lines (entry_id, line_no, account_id, debit) VALUES (${e.id}, 9, ${acct.bank_baf.id}, 1)`, /cannot be changed/)
  await fails(sql`UPDATE fin_entries SET status = 'Reversed' WHERE id = ${e.id}`, /cannot be changed/)   // only through a real reversal
  await fails(ledger.deleteDraft(e.id), /never deleted/)
})

test('reverse: a mirror entry, the original marked Reversed, and no second reversal', async () => {
  const e = await ledger.createEntry({ date: D(8), memo: 'TEST to reverse', lines: pair('1250.50'), post: true }, owner)
  await fails(ledger.reverseEntry(e.id, { date: D(8, 20) }, owner), /Say why/)
  const r = await ledger.reverseEntry(e.id, { date: D(8, 20), reason: 'entered twice' }, owner)
  assert.equal(r.status, 'Posted')
  assert.equal(r.reversalOf.entryNo, e.entryNo)
  assert.equal(r.lines[0].credit, e.lines[0].debit)
  assert.equal(r.lines[1].debit, e.lines[1].credit)
  const original = await ledger.getEntry(e.id)
  assert.equal(original.status, 'Reversed')
  assert.equal(original.reversedBy.entryNo, r.entryNo)
  await fails(ledger.reverseEntry(e.id, { date: D(8, 21), reason: 'again' }, owner), /already been reversed/)
  const [{ net }] = await sql`SELECT sum(debit - credit) AS net FROM fin_lines WHERE entry_id IN (${e.id}, ${r.id}) AND account_id = ${acct.bank_baf.id}`
  assert.equal(Number(net), 0, 'together they cancel out')
})

test('closed period: refused without the owner and a reason; locked: refused for everyone', async () => {
  await ledger.setPeriodStatus(periods[3], { status: 'Closed' }, owner)                 // Sep 2098
  await fails(ledger.createEntry({ date: D(9), memo: 'TEST closed', lines: pair('10'), post: true }, owner), /closed/)
  await fails(ledger.createEntry({ date: D(9), memo: 'TEST closed', lines: pair('10'), post: true, overrideReason: 'late bill' }, manager), /closed/)
  const ok = await ledger.createEntry({ date: D(9), memo: 'TEST closed', lines: pair('10'), post: true, overrideReason: 'late bill' }, owner)
  assert.equal(ok.overrideReason, 'late bill')
  await fails(ledger.setPeriodStatus(periods[3], { status: 'Open' }, owner), /Say why/)
  await ledger.setPeriodStatus(periods[3], { status: 'Locked' }, owner)
  await fails(ledger.createEntry({ date: D(9), memo: 'TEST locked', lines: pair('10'), post: true, overrideReason: 'x' }, owner), /locked/)
  await fails(ledger.setPeriodStatus(periods[3], { status: 'Open' }, owner), /can't go straight/)
  await ledger.setPeriodStatus(periods[3], { status: 'Closed', reason: 'test' }, owner)
  await ledger.setPeriodStatus(periods[3], { status: 'Open', reason: 'test' }, owner)
})

test('control accounts: refused in manual journals (app and database), allowed for opening balances', async () => {
  await fails(ledger.createEntry({ date: D(10), memo: 'TEST', lines: pair('100', 'ar_customers', 'bank_baf'), post: true }, owner), /kept by the system/)
  const [{ id }] = await sql`SELECT nextval(pg_get_serial_sequence('fin_entries', 'id'))::bigint AS id`
  await fails(sql.transaction([
    sql`INSERT INTO fin_entries (id, entry_date, memo) VALUES (${id}, ${D(10)}, 'TEST raw control')`,
    sql`INSERT INTO fin_lines (entry_id, line_no, account_id, debit) VALUES (${id}, 1, ${acct.ar_customers.id}, 100)`,
  ]), /kept by the system/)
  const ob = await ledger.createEntry({ date: D(10), entryType: 'OB', memo: 'TEST opening', source: { type: 'test_opening', id: `t${Date.now()}`, event: 'opening' },
    lines: pair('100', 'ar_customers', 'retained_earnings'), post: true }, owner)
  assert.match(ob.entryNo, /^OB-9899-/)
})

test('the same source cannot post twice; after reversing it can be posted again', async () => {
  const source = { type: 'test_order', id: `o${Date.now()}`, event: 'paid' }
  const first = await ledger.createEntry({ date: D(11), entryType: 'SI', memo: 'TEST source', source, lines: pair('200'), post: true }, owner)
  await fails(ledger.createEntry({ date: D(11), entryType: 'SI', memo: 'TEST source again', source, lines: pair('200'), post: true }, owner), /already been posted/)
  await ledger.reverseEntry(first.id, { date: D(11, 20), reason: 'test' }, owner)
  const again = await ledger.createEntry({ date: D(11, 21), entryType: 'SI', memo: 'TEST reposted', source, lines: pair('200'), post: true }, owner)
  assert.equal(again.status, 'Posted')
})

test('inactive (tax) accounts take no postings and cannot be switched on while tax is off', async () => {
  await fails(ledger.createEntry({ date: D(12), memo: 'TEST', lines: pair('50', 'st_input', 'bank_baf'), post: true }, owner), /not active/)
  await fails(ledger.updateAccount(acct.st_input.id, { isActive: true }), /switch on with tax/)
})

test('accounts with postings keep their code and type and are never deleted', async () => {
  await fails(sql`DELETE FROM fin_accounts WHERE id = ${acct.bank_baf.id}`, /cannot be deleted/)
  await fails(sql`UPDATE fin_accounts SET code = '1111' WHERE id = ${acct.bank_baf.id}`, /cannot change/)
  await fails(ledger.updateAccount(acct.bank_baf.id, { isActive: false }), /still has a balance|stays active/)
})

test('drafts: saved without a number, edited, then posted; dates outside every period are refused', async () => {
  const d = await ledger.createEntry({ date: D(12), memo: 'TEST draft', lines: pair('75') }, owner)
  assert.equal(d.status, 'Draft'); assert.equal(d.entryNo, null)
  const edited = await ledger.updateDraft(d.id, { date: D(12, 20), memo: 'TEST draft edited', lines: pair('80') }, owner)
  assert.equal(edited.total, '80.00'); assert.equal(edited.date, D(12, 20))
  const posted = await ledger.postDraft(d.id, {}, owner)
  assert.match(posted.entryNo, /^JV-9899-/)
  await fails(ledger.createEntry({ date: '2150-01-01', memo: 'TEST', lines: pair('1'), post: true }, owner), /no accounting period/)
})

test('files: stored once by content, read back byte for byte', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const a = await files.saveFile({ name: 'receipt.png', mime: 'image/png', data: png }, owner)
  const b = await files.saveFile({ name: 'same-again.png', mime: 'image/png', data: png }, owner)
  assert.equal(a.id, b.id)
  assert.equal((await files.getFile(a.id)).data, png)
  await fails(files.saveFile({ name: 'x.exe', mime: 'application/x-msdownload', data: 'AAAA' }, owner), /Attach a photo/)
})
