// F2a: expenses, bills, studio claims, payroll and staff payments (migration 015,
// lib/finance/expenses.js and payroll.js). Runs ONLY on koko_finance_dev. Test postings use
// fiscal years from 2096-97 on (created as needed); names carry a run stamp so reruns don't clash.
// Run: npm run test:finance
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

const devUrl = process.env.FINANCE_DEV_DATABASE_URL
if (!devUrl || new URL(devUrl).pathname !== '/koko_finance_dev') throw new Error('FINANCE_DEV_DATABASE_URL must point at koko_finance_dev')
process.env.DATABASE_URL = devUrl

const { neon } = await import('@neondatabase/serverless')
const { toPaisa } = await import('../../lib/finance/money.js')
const ledger = await import('../../lib/finance/ledger.js')
const reports = await import('../../lib/finance/reports.js')
const ex = await import('../../lib/finance/expenses.js')
const pay = await import('../../lib/finance/payroll.js')
const sql = neon(devUrl)

const RUN = Date.now().toString(36)
let owner, acct, staff, supplier, weekCursor
const fails = async (p, re) => { try { await p } catch (err) { if (re) assert.match(err.message, re); return err } assert.fail('expected an error') }
const addDays = (d, n) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) }
const dow = (d) => new Date(`${d}T00:00:00Z`).getUTCDay()

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
// The next unused Saturday (optionally one whose week runs over a month end)
async function nextWeek({ crossMonth = false } = {}) {
  let d = weekCursor
  for (;;) {
    d = addDays(d, 7)
    if (!crossMonth || pay.weekParts(d).length > 1) break      // working days in both months
  }
  weekCursor = d
  await ensureFY(addDays(d, -6)); await ensureFY(d)
  return d
}
// Balance of one account for one party (debit minus credit), in paisa
async function partyNet(key, partyType, partyId) {
  const [r] = await sql`SELECT coalesce(sum(l.debit - l.credit), 0) AS n FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'Draft'
    WHERE l.account_id = ${acct[key].id} AND l.party_type = ${partyType} AND l.party_id = ${String(partyId)}`
  return toPaisa(r.n)
}
const entryLines = async (id) => (await ledger.getEntry(id)).lines

before(async () => {
  await sql`INSERT INTO users (username, name, role, password_hash) SELECT 'fin_test_owner', 'fin_test_owner', 'owner', 'x' WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(username) = 'fin_test_owner')`
  ;[owner] = await sql`SELECT id, username, role FROM users WHERE username = 'fin_test_owner'`
  acct = Object.fromEntries((await sql`SELECT id, code, system_key FROM fin_accounts WHERE system_key IS NOT NULL`).map((a) => [a.system_key, a]))
  const [{ last }] = await sql`SELECT max(week_ending)::text AS last FROM fin_payroll_runs WHERE week_ending >= '2096-07-01'`
  weekCursor = last || '2096-07-01'           // first test week ends 7 Jul 2096, after the test salary starts
  while (dow(weekCursor) !== 6) weekCursor = addDays(weekCursor, 1)
  if (!last) weekCursor = addDays(weekCursor, -7)
  await ensureFY('2096-08-01')
  staff = await pay.createStaff({ name: `TEST tailor ${RUN}`, roleTitle: 'tailor', payType: 'weekly_salary', isProduction: true, hoursPerDay: 10, weeklySalary: '17500', salaryFrom: '2096-07-01' })
  supplier = await ex.createSupplier({ name: `TEST fabric house ${RUN}`, phone: '0300' })
})

// The test person leaves the studio afterwards, so they don't fill later payroll weeks
after(async () => { if (staff) await pay.updateStaff(staff.id, { isActive: false }) })

test('the seeded studio staff and the staff advances account exist', async () => {
  const names = (await pay.listStaff()).map((s) => s.name)
  for (const n of ['Abdur Rehman', 'Jahangir', 'Master Iftikhar', 'Manaf']) assert.ok(names.includes(n), n)
  assert.ok(acct.staff_advances, '1460 Advances to staff')
  const s = await ledger.getSettings()
  assert.equal(s.capitalisationThreshold, '25000.00'); assert.equal(s.workingDaysPerWeek, 6)
})

test('week parts: Sunday off, a week over a month end is split by working days', () => {
  assert.deepEqual(pay.weekParts('2096-08-04'), [{ month: '2096-07', days: 2, date: '2096-07-31' }, { month: '2096-08', days: 4, date: '2096-08-04' }])
  const one = pay.weekParts('2096-08-18')
  assert.equal(one.length, 1); assert.equal(one[0].days, 6)
  assert.deepEqual(pay.splitPaisa(1750000, [3, 3]), [875000, 875000])
  const odd = pay.splitPaisa(1000001, [2, 4])
  assert.equal(odd[0] + odd[1], 1000001)
})

test('an expense paid by bank: Dr the category, Cr bank; editing reverses and reposts; voiding reverses', async () => {
  const x = await ex.createExpense({ date: '2096-08-10', accountId: acct.utilities.id, amount: '4,250', paidFrom: 'bank', description: 'TEST internet', supplierId: supplier.id }, owner)
  assert.equal(x.status, 'Posted'); assert.match(x.entryNo, /^EX-/)
  const lines = await entryLines(x.entryId)
  assert.deepEqual(lines.map((l) => [l.accountId, l.debit, l.credit]), [[acct.utilities.id, '4250.00', '0.00'], [acct.bank_baf.id, '0.00', '4250.00']])
  // the same event can't post twice
  await fails(ledger.createEntry({ date: '2096-08-10', entryType: 'EX', post: true, source: { type: 'expense', id: x.id, event: 'posted' },
    lines: [{ accountId: acct.utilities.id, debit: '1' }, { accountId: acct.bank_baf.id, credit: '1' }] }, owner), /already been posted/)
  const y = await ex.updateExpense(x.id, { amount: '4500', reason: 'TEST correct amount' }, owner)
  assert.notEqual(y.entryId, x.entryId)
  assert.equal((await ledger.getEntry(x.entryId)).status, 'Reversed')
  assert.equal(y.amount, '4500.00')
  const v = await ex.voidExpense(x.id, { reason: 'TEST void' }, owner)
  assert.equal(v.status, 'Void')
  assert.equal((await ledger.getEntry(y.entryId)).status, 'Reversed')
  await fails(ex.voidExpense(x.id, { reason: 'again' }, owner), /Only posted/)
})

test('expense rules: a category must be a cost or asset account; an unpaid bill needs a supplier', async () => {
  await fails(ex.createExpense({ date: '2096-08-10', accountId: acct.bank_baf.id, amount: '10', paidFrom: 'cash', description: 'x' }, owner), /can't be used/)
  await fails(ex.createExpense({ date: '2096-08-10', accountId: acct.ap_suppliers.id, amount: '10', paidFrom: 'cash', description: 'x' }, owner), /can't be used/)
  await fails(ex.createExpense({ date: '2096-08-10', accountId: acct.repairs.id, amount: '10', paidFrom: 'unpaid', description: 'x' }, owner), /supplier/)
  await fails(ex.createExpense({ date: '2096-08-10', accountId: acct.repairs.id, amount: '0', paidFrom: 'cash', description: 'x' }, owner), /more than zero/)
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM fin_expenses WHERE status = 'Draft'`
  assert.equal(n, 0, 'a failed expense leaves nothing behind')
})

test('an unpaid bill is owed to the supplier until paid; paying clears it', async () => {
  const before = await partyNet('ap_suppliers', 'supplier', supplier.id)
  const x = await ex.createExpense({ date: '2096-08-12', accountId: acct.packaging.id, amount: '12000', paidFrom: 'unpaid', supplierId: supplier.id, description: 'TEST boxes' }, owner)
  assert.equal(await partyNet('ap_suppliers', 'supplier', supplier.id) - before, -1200000)
  const owed = (await ex.listSuppliers()).find((s) => s.id === supplier.id).owed
  assert.equal(toPaisa(owed), -before + 1200000)
  await fails(ex.payBill(x.id, { paidFrom: 'unpaid' }, owner), /how it was paid/)
  const paid = await ex.payBill(x.id, { paidOn: '2096-08-20', paidFrom: 'bank', reference: 'TEST-REF' }, owner)
  assert.ok(paid.paidEntryId); assert.equal(paid.paidOn, '2096-08-20')
  assert.equal(await partyNet('ap_suppliers', 'supplier', supplier.id), before)
  await fails(ex.updateExpense(x.id, { amount: '5' }, owner), /paid/)
  const st = await reports.partyStatement('supplier', supplier.id, { from: '2096-07-01', to: '2096-12-31' })
  assert.equal(st.closing, (-before / 100).toFixed(2))
})

test('22 Nov example: approved claim 5,700 + salary 17,500 paid in one 23,200 transfer', async () => {
  const claim = await ex.createClaim({ staffId: staff.id, weekEnding: await nextWeek(), lines: [
    { accountId: acct.consumables.id, description: 'TEST thread and needles', amount: '3200' },
    { accountId: acct.travel.id, description: 'TEST rickshaw to market', amount: '2500' }] }, owner)
  assert.equal(claim.status, 'Submitted'); assert.equal(claim.total, '5700.00')
  const approved = await ex.approveClaim(claim.id, owner)
  assert.equal(approved.status, 'Approved')
  assert.equal(await partyNet('ap_staff_claims', 'staff', staff.id), -570000)

  const run = await pay.createRun({ weekEnding: claim.weekEnding }, owner)
  const mine = run.lines.find((l) => l.staffId === staff.id)
  assert.equal(mine.grossPay, '17500.00'); assert.equal(mine.daysPresent, 6)
  const others = run.lines.filter((l) => l.staffId !== staff.id)
  await pay.saveRun(run.id, { lines: [{ ...mine, hours: [{ jobType: 'order', hours: 40 }, { jobType: 'idle', hours: 20 }] }] })
  const posted = await pay.postRun(run.id, owner)
  assert.equal(posted.status, 'Posted')
  assert.equal(posted.lines.length, 1, 'only the people kept in the week are paid')
  assert.ok(others.length >= 0)
  assert.equal(await partyNet('wages_payable', 'staff', staff.id), -1750000)
  const wageLine = (await entryLines(posted.entries[0].id)).find((l) => l.accountId === acct.cogs_labour.id)
  assert.equal(wageLine.debit, '17500.00')

  const owed = await pay.staffOwed(staff.id)
  assert.equal(owed.claims.length, 1); assert.equal(owed.weeks.length, 1)
  await fails(pay.createStaffPayment({ staffId: staff.id, paidOn: claim.weekEnding, paidFrom: 'bank', amount: '23200',
    parts: [{ kind: 'salary', amount: '17500' }, { kind: 'claim', claimId: claim.id, amount: '5000' }] }, owner), /paid in full/)
  await fails(pay.createStaffPayment({ staffId: staff.id, paidOn: claim.weekEnding, paidFrom: 'bank', amount: '23000',
    parts: [{ kind: 'salary', amount: '17500' }, { kind: 'claim', claimId: claim.id, amount: '5700' }] }, owner), /add up/)
  const ref = `TEST${RUN}`
  const p = await pay.createStaffPayment({ staffId: staff.id, paidOn: claim.weekEnding, paidFrom: 'bank', amount: '23,200', reference: ref,
    parts: [{ kind: 'salary', payrollLineId: owed.weeks[0].payrollLineId, amount: '17500' }, { kind: 'claim', claimId: claim.id, amount: '5700' }] }, owner)
  assert.equal(p.amount, '23200.00')
  const pl = await entryLines(p.entryId)
  assert.equal(pl.find((l) => l.accountId === acct.bank_baf.id).credit, '23200.00')
  assert.equal(await partyNet('wages_payable', 'staff', staff.id), 0)
  assert.equal(await partyNet('ap_staff_claims', 'staff', staff.id), 0)
  assert.equal((await ex.getClaim(claim.id)).status, 'Paid')
  await fails(pay.createStaffPayment({ staffId: staff.id, paidFrom: 'bank', amount: '5700', parts: [{ kind: 'claim', claimId: claim.id, amount: '5700' }] }, owner), /must be approved/)
  await fails(pay.createStaffPayment({ staffId: staff.id, paidFrom: 'bank', amount: '1', reference: ref, parts: [{ kind: 'advance', amount: '1' }] }, owner), /already recorded/)
  await fails(pay.unpostRun(run.id, { reason: 'TEST' }, owner), /paid against/)
  await fails(ex.undoClaimApproval(claim.id, { reason: 'TEST' }, owner), /Void the payment/)

  // voiding the payment puts the balances back
  await pay.voidStaffPayment(p.id, { reason: 'TEST void' }, owner)
  assert.equal(await partyNet('wages_payable', 'staff', staff.id), -1750000)
  assert.equal((await ex.getClaim(claim.id)).status, 'Approved')
  const un = await pay.unpostRun(run.id, { reason: 'TEST undo week' }, owner)
  assert.equal(un.status, 'Draft')
  assert.equal(await partyNet('wages_payable', 'staff', staff.id), 0)
  // and the same week can be posted again
  assert.equal((await pay.postRun(run.id, owner)).status, 'Posted')
  await pay.unpostRun(run.id, { reason: 'TEST tidy' }, owner)
  await ex.undoClaimApproval(claim.id, { reason: 'TEST tidy' }, owner)
  assert.equal(await partyNet('ap_staff_claims', 'staff', staff.id), 0)
})

test('a week over a month end books wages into both months; absence pro-rates; advances are recovered', async () => {
  const we = await nextWeek({ crossMonth: true })
  const run = await pay.createRun({ weekEnding: we }, owner)
  const mine = run.lines.find((l) => l.staffId === staff.id)
  // an advance given earlier
  await pay.createStaffPayment({ staffId: staff.id, paidOn: addDays(we, -10), paidFrom: 'cash', amount: '2000', parts: [{ kind: 'advance', amount: '2000' }] }, owner)
  const adv0 = await partyNet('staff_advances', 'staff', staff.id)
  const saved = await pay.saveRun(run.id, { lines: [{ staffId: staff.id, weeklySalary: mine.weeklySalary, daysPresent: 5, grossPay: '', advanceRecovered: '2000' }],
    income: [{ kind: 'commission', staffId: staff.id, pieces: 4, amount: '1600', receivedInto: 'cash', description: 'TEST per-piece' }] })
  assert.equal(saved.lines[0].grossPay, '14583.33')
  assert.equal(saved.lines[0].net, '12583.33')
  const posted = await pay.postRun(run.id, owner)
  const wageEntries = posted.entries.filter((e) => e.event.startsWith('wages-'))
  assert.equal(wageEntries.length, 2)
  assert.deepEqual(wageEntries.map((e) => e.date), posted.parts.map((p) => p.date))
  assert.ok(wageEntries[0].date < wageEntries[1].date && wageEntries[0].date.slice(0, 7) !== wageEntries[1].date.slice(0, 7))
  let total = 0
  for (const e of wageEntries) total += toPaisa((await entryLines(e.id)).find((l) => l.accountId === acct.cogs_labour.id).debit)
  assert.equal(total, 1458333)
  assert.equal(await partyNet('staff_advances', 'staff', staff.id), adv0 - 200000)
  assert.equal(await partyNet('wages_payable', 'staff', staff.id), -1258333)
  const income = posted.entries.find((e) => e.event === 'income')
  assert.equal((await entryLines(income.id)).find((l) => l.accountId === acct.income_commission.id).credit, '1600.00')
  await fails(pay.saveRun(run.id, { lines: [] }), /posted/)
  await fails(pay.createRun({ weekEnding: we }, owner), /already a payroll/)
  await pay.unpostRun(run.id, { reason: 'TEST tidy' }, owner)
  assert.equal(await partyNet('wages_payable', 'staff', staff.id), 0)
})

test('payroll checks: hours by job cannot exceed hours worked; advance recovery cannot exceed pay', async () => {
  const run = await pay.createRun({ weekEnding: await nextWeek() }, owner)
  const mine = run.lines.find((l) => l.staffId === staff.id)
  await fails(pay.saveRun(run.id, { lines: [{ ...mine, hoursWorked: 10, hours: [{ jobType: 'order', hours: 12 }] }] }), /more than the hours/)
  await fails(pay.saveRun(run.id, { lines: [{ ...mine, advanceRecovered: '99999' }] }), /more than the pay/)
  await pay.deleteRun(run.id)
})

test('recurring bills post once per month', async () => {
  const list = await ex.saveRecurring(null, { name: `TEST rent ${RUN}`, accountId: acct.rent.id, amount: '60000', dayOfMonth: 5, paidFrom: 'bank' })
  const r = list.find((x) => x.name === `TEST rent ${RUN}`)
  await ensureFY('2096-09-05')
  const first = await ex.generateRecurring({ month: '2096-09' }, owner)
  const mine = first.created.filter((x) => x.recurringId === r.id)
  assert.equal(mine.length, 1); assert.equal(mine[0].date, '2096-09-05'); assert.equal(mine[0].amount, '60000.00')
  const again = await ex.generateRecurring({ month: '2096-09' }, owner)
  assert.equal(again.created.filter((x) => x.recurringId === r.id).length, 0)
  await ex.saveRecurring(r.id, { ...r, isActive: false })
})

test('the spending report groups posted costs by category, month and supplier', async () => {
  const x = await ex.createExpense({ date: '2096-10-03', accountId: acct.photoshoots.id, amount: '30000', paidFrom: 'director_omer', description: 'TEST shoot', supplierId: supplier.id }, owner)
  await ensureFY('2096-10-03')
  const rep = await reports.expenseReport({ from: '2096-10-01', to: '2096-10-31' })
  const cat = rep.byAccount.find((a) => a.id === acct.photoshoots.id)
  assert.ok(toPaisa(cat.amount) >= 3000000)
  assert.ok(rep.bySupplier.find((s) => s.id === supplier.id))
  assert.ok(rep.byMonth.find((m) => m.month === '2096-10'))
  assert.ok(rep.top.find((t) => t.id === x.id))
  assert.equal((await entryLines(x.entryId)).find((l) => l.accountId === acct.director_omer.id).credit, '30000.00')
  await ex.voidExpense(x.id, { reason: 'TEST tidy' }, owner)
})
