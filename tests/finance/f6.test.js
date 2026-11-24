// F6: close. Fixed assets and depreciation, disposals, recurring / accrual journals, exchange
// revaluation, expected credit losses, provisions, the month-end checklist and the year-end close
// (migration 023, lib/finance/assets.js, close.js, notes.js). Runs ONLY on koko_finance_dev.
// Month-end jobs run on the current month across the whole dev database, so tests look at their own
// run-stamped assets, resellers and journals. The year-end test builds its own fiscal year before the
// earliest one in the database, so closing and locking it never touches anything else.
// Run: npm run test:finance
import { test, before } from 'node:test'
import assert from 'node:assert/strict'

const devUrl = process.env.FINANCE_DEV_DATABASE_URL
if (!devUrl || new URL(devUrl).pathname !== '/koko_finance_dev') throw new Error('FINANCE_DEV_DATABASE_URL must point at koko_finance_dev')
process.env.DATABASE_URL = devUrl

const { neon } = await import('@neondatabase/serverless')
const { toPaisa } = await import('../../lib/finance/money.js')
const ledger = await import('../../lib/finance/ledger.js')
const assets = await import('../../lib/finance/assets.js')
const close = await import('../../lib/finance/close.js')
const notes = await import('../../lib/finance/notes.js')
const expenses = await import('../../lib/finance/expenses.js')
const sales = await import('../../lib/finance/sales.js')
const sql = neon(devUrl)

const RUN = Date.now().toString(36)
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })
const MONTH = TODAY.slice(0, 7)
const END = assets.monthEnd(MONTH)
let owner, acct
const P = (v) => toPaisa(v ?? 0)
const fails = async (p, re) => { try { await p } catch (err) { if (re) assert.match(err.message, re); return err } assert.fail('expected an error') }
const linesOf = async (entryId) => sql`SELECT a.system_key, l.debit, l.credit, l.asset_id, l.party_id FROM fin_lines l JOIN fin_accounts a ON a.id = l.account_id WHERE l.entry_id = ${entryId}`
const sumFor = (ls, key, pick = (l) => P(l.debit) - P(l.credit)) => ls.filter((l) => l.system_key === key).reduce((s, l) => s + pick(l), 0)

before(async () => {
  await sql`INSERT INTO users (username, name, role, password_hash) SELECT 'fin_test_owner', 'fin_test_owner', 'owner', 'x' WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(username) = 'fin_test_owner')`
  ;[owner] = await sql`SELECT id, username, name, role FROM users WHERE username = 'fin_test_owner'`
  acct = Object.fromEntries((await sql`SELECT id, system_key FROM fin_accounts WHERE system_key IS NOT NULL`).map((a) => [a.system_key, a.id]))
})

test('straight-line schedule: mid-month convention, end of life, assets owned before go-live', () => {
  const a = { cost: 12000000, residual: 0, lifeMonths: 12, availableOn: '2026-07-10', source: 'purchase' }
  assert.equal(assets.accumulatedTo(a, '2026-06', '2026-07'), 0)
  assert.equal(assets.accumulatedTo(a, '2026-07', '2026-07'), 1000000, 'in use by the 15th: July is charged')
  assert.equal(assets.accumulatedTo({ ...a, availableOn: '2026-07-20' }, '2026-07', '2026-07'), 0, 'after the 15th: from August')
  assert.equal(assets.accumulatedTo(a, '2027-06', '2026-07'), 12000000)
  assert.equal(assets.accumulatedTo(a, '2030-01', '2026-07'), 12000000, 'never more than cost less residual')
  // 1/3 of the cost over 7 months: 1,000,000 / 7 rounds to 142,857; the last month takes the remainder
  const odd = { cost: 100000000, residual: 0, lifeMonths: 7, availableOn: '2026-07-01', source: 'purchase' }
  assert.equal(assets.accumulatedTo(odd, '2026-07', '2026-07'), 14285714)
  assert.equal(assets.accumulatedTo(odd, '2027-01', '2026-07'), 100000000)
  // Owned before go-live: 24 of 60 months gone, 40% booked; the rest over the 36 months left
  const old = { cost: 6000000, residual: 0, lifeMonths: 60, availableOn: '2024-07-01', source: 'opening', openingDepreciation: 2400000 }
  assert.equal(assets.accumulatedTo(old, '2026-06', '2026-07'), 2400000)
  assert.equal(assets.accumulatedTo(old, '2026-07', '2026-07'), 2500000)
  assert.equal(assets.accumulatedTo(old, '2029-06', '2026-07'), 6000000)
  // Disposed on the 10th: its month is not charged
  assert.equal(assets.accumulatedTo({ ...a, disposedOn: '2026-09-10' }, '2027-01', '2026-07'), 2000000)
})

let machine
test('a machine bought through the register: the expense goes to 1500, depreciation is posted monthly and replaced when it changes', async () => {
  machine = await assets.createAsset({ source: 'purchase', name: `TEST Juki ${RUN}`, category: 'machinery', cost: '240000', paidFrom: 'cash', acquiredOn: `${MONTH}-01`, lifeMonths: 24 }, owner)
  assert.match(machine.code, /^FA-\d{4}$/)
  const x = await expenses.getExpense(machine.expenseId)
  assert.equal(x.accountId, acct.ppe_machinery); assert.equal(x.amount, '240000.00')
  await fails(assets.createAsset({ source: 'purchase', name: 'x', category: 'machinery', cost: '1000', paidFrom: 'cash', acquiredOn: '2026-01-05' }, owner), /before/)

  const d1 = await assets.postDepreciation({ month: MONTH }, owner)
  assert.equal(d1.items.find((i) => i.assetId === machine.id).charge, '10000.00', '240,000 over 24 months')
  const ls = (await linesOf(d1.entryId)).filter((l) => l.asset_id === machine.id)
  assert.equal(sumFor(ls, 'depreciation'), 1000000); assert.equal(sumFor(ls, 'ppe_acc_depreciation'), -1000000)
  const d2 = await assets.postDepreciation({ month: MONTH }, owner)
  assert.equal(d2.entryId, d1.entryId, 'nothing changed: the same entry stays')
  assert.equal((await assets.depreciationState(MONTH)).current, true)

  await assets.updateAsset(machine.id, { name: machine.name, lifeMonths: 12 })
  assert.equal((await assets.depreciationState(MONTH)).current, false, 'the life changed: the posted entry is out of date')
  const d3 = await assets.postDepreciation({ month: MONTH }, owner)
  assert.notEqual(d3.entryId, d1.entryId)
  assert.equal(d3.items.find((i) => i.assetId === machine.id).charge, '20000.00')
  const reg = (await assets.listAssets({ asOf: END })).assets.find((a) => a.id === machine.id)
  assert.equal(reg.accumulated, '20000.00'); assert.equal(reg.carrying, '220000.00')
  await fails(assets.deleteAsset(machine.id, { reason: 'test' }, owner), /Depreciation has been booked/)
})

test('a large expense is suggested as a fixed asset; registering it moves it from the expense account', async () => {
  const x = await expenses.createExpense({ date: `${MONTH}-02`, amount: '90000', accountId: acct.repairs, paidFrom: 'cash', description: `TEST cutting table ${RUN}` }, owner)
  assert.ok((await assets.assetSuggestions()).some((s) => s.expenseId === x.id && !s.onAssetAccount))
  const a = await assets.createAsset({ source: 'expense', expenseId: x.id, name: `TEST Cutting table ${RUN}`, category: 'furniture' }, owner)
  assert.equal(a.cost, '90000.00'); assert.ok(a.entryNo)
  const ls = await linesOf(a.entryId)
  assert.equal(sumFor(ls, 'ppe_furniture'), 9000000); assert.equal(sumFor(ls, 'repairs'), -9000000)
  assert.ok(!(await assets.assetSuggestions()).some((s) => s.expenseId === x.id))
  await fails(assets.createAsset({ source: 'expense', expenseId: x.id, name: 'again', category: 'furniture' }, owner), /already/)
  // Kept as an expense: no longer suggested
  const y = await expenses.createExpense({ date: `${MONTH}-02`, amount: '80000', accountId: acct.repairs, paidFrom: 'cash', description: `TEST big repair ${RUN}` }, owner)
  assert.ok(!(await assets.dismissSuggestion(y.id)).some((s) => s.expenseId === y.id))
  // Removed again (no depreciation yet): the move is reversed
  await assets.deleteAsset(a.id, { reason: 'test' }, owner)
  assert.equal((await sql`SELECT status FROM fin_entries WHERE id = ${a.entryId}`)[0].status, 'Reversed')
})

test('disposal: depreciation to the date, cost and depreciation removed, gain or loss; the month is worked out again without it', async () => {
  const before = (await assets.listAssets({ asOf: END })).assets.find((a) => a.id === machine.id)
  const r = await assets.disposeAsset(machine.id, { date: TODAY, proceeds: '200000', paidTo: 'cash', note: 'TEST' }, owner)
  assert.equal(r.status, 'Disposed')
  const ls = await linesOf(r.disposalEntryId)
  const dep = Number(TODAY.slice(8, 10)) > 15 ? 2000000 : 0     // this month is charged only when sold after the 15th
  assert.equal(sumFor(ls, 'ppe_machinery'), -24000000)
  assert.equal(sumFor(ls, 'cash_studio'), 20000000)
  const carrying = 24000000 - dep
  const gl = 20000000 - carrying
  assert.equal(gl > 0 ? -sumFor(ls, 'disposal_gain') : sumFor(ls, 'disposal_loss'), Math.abs(gl))
  assert.equal(sumFor(ls, 'ppe_acc_depreciation'), 0, 'what was charged to the date is removed in the same entry')
  // The month's depreciation no longer charges it, so 1590 holds nothing for this asset
  const d = await assets.depreciationState(MONTH)
  assert.equal(d.current, true); assert.ok(!d.items.some((i) => i.assetId === machine.id))
  const [{ n }] = await sql`SELECT coalesce(sum(l.credit - l.debit), 0) AS n FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'Draft'
    WHERE l.asset_id = ${machine.id} AND l.account_id = ${acct.ppe_acc_depreciation}`
  assert.equal(P(n), 0)
  assert.equal(before.status, 'In use')
  const u = await assets.undoDisposal(machine.id, { reason: 'test' }, owner)
  assert.equal(u.status, 'In use')
  await assets.disposeAsset(machine.id, { date: TODAY, proceeds: '0', note: 'TEST scrapped' }, owner)
})

test('an accrual journal posts at the month end and reverses itself on the 1st', async () => {
  const list = await close.saveRecurringJournal(null, { name: `TEST electricity accrual ${RUN}`, autoReverse: true, startsMonth: MONTH, endsMonth: MONTH,
    lines: [{ accountId: acct.utilities, debit: '3000' }, { accountId: acct.accrued_expenses, credit: '3000' }] }, owner)
  const j = list.find((x) => x.name === `TEST electricity accrual ${RUN}`)
  await fails(close.saveRecurringJournal(null, { name: 'x', startsMonth: MONTH, lines: [{ accountId: acct.utilities, debit: '1' }, { accountId: acct.ap_suppliers, credit: '1' }] }, owner), /kept by the system/)
  const r = await close.generateJournals({ month: MONTH }, owner)
  assert.ok(r.posted.some((p) => p.id === j.id))
  const es = await sql`SELECT source_event, entry_date::text AS d FROM fin_entries WHERE source_type = 'recurring_journal' AND source_id = ${MONTH} AND status = 'Posted'
    AND source_event IN (${String(j.id)}, ${`${j.id}:reverse`}) ORDER BY source_event`
  assert.deepEqual(es.map((e) => e.d), [END, `${assets.addMonths(MONTH, 1)}-01`])
  const n = (await sql`SELECT count(*)::int AS n FROM fin_entries`)[0].n
  await close.generateJournals({ month: MONTH }, owner)
  assert.equal((await sql`SELECT count(*)::int AS n FROM fin_entries`)[0].n, n, 'generating again adds nothing')
  await close.saveRecurringJournal(j.id, { ...j, isActive: false }, owner)
})

test('exchange revaluation: a foreign-currency reseller balance at the closing rate, reversed on the 1st', async () => {
  const CUR = `Q${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${String.fromCharCode(65 + Math.floor(Math.random() * 26))}`
  const [r] = await sql`INSERT INTO resellers (name, currency, commission_pct) VALUES (${`TEST Reval ${RUN}`}, ${CUR}, 20) RETURNING id`
  await ledger.createEntry({ date: `${MONTH}-03`, post: true, memo: 'TEST reseller sale', source: { type: 'test', id: `reval-${RUN}`, event: 'sale' }, lines: [
    { accountId: acct.ar_resellers, debit: '7500', partyType: 'reseller', partyId: String(r.id), currency: CUR, amountFc: '100', fxRate: '75' },
    { accountId: acct.sales_reseller, credit: '7500', partyType: 'reseller', partyId: String(r.id) },
  ] }, owner)
  const missing = await close.revaluationFor(MONTH)
  assert.ok(missing.missingRates.includes(CUR), 'no rate yet')
  await sales.setRate({ date: `${MONTH}-01`, currency: CUR, rate: '80' })
  const v = await close.postRevaluation({ month: MONTH }, owner)
  const item = v.items.find((i) => i.resellerId === r.id)
  assert.equal(item.atClosingRate, '8000.00'); assert.equal(item.difference, '500.00')
  const ls = (await linesOf(v.entryId)).filter((l) => l.party_id === String(r.id))
  assert.equal(sumFor(ls, 'ar_resellers'), 50000); assert.equal(sumFor(ls, 'fx_gain_unrealised'), -50000)
  const [back] = await sql`SELECT id, entry_date::text AS d FROM fin_entries WHERE source_type = 'fx_reval' AND source_id = ${MONTH} AND source_event = 'reverse' AND status = 'Posted'`
  assert.equal(back.d, `${assets.addMonths(MONTH, 1)}-01`)
  assert.equal(sumFor((await linesOf(back.id)).filter((l) => l.party_id === String(r.id)), 'ar_resellers'), -50000)
  // Revalued again with nothing changed: the same entries
  assert.equal((await close.postRevaluation({ month: MONTH }, owner)).entryId, v.entryId)
})

test('expected credit losses: receivables aged first-in first-out, the loss rate per bucket, 1250 moved to the allowance', async () => {
  const [r] = await sql`INSERT INTO resellers (name, currency, commission_pct) VALUES (${`TEST ECL ${RUN}`}, 'PKR', 20) RETURNING id`
  const old = new Date(`${END}T00:00:00Z`); old.setUTCDate(old.getUTCDate() - 100)
  const oldDate = old.toISOString().slice(0, 10) < '2026-07-01' ? '2026-07-01' : old.toISOString().slice(0, 10)
  const tag = { partyType: 'reseller', partyId: String(r.id) }
  const post = (date, lines, ev) => ledger.createEntry({ date, post: true, memo: 'TEST', source: { type: 'test', id: `ecl-${RUN}`, event: ev }, lines }, owner)
  await post(oldDate, [{ accountId: acct.ar_resellers, debit: '10000', ...tag }, { accountId: acct.sales_reseller, credit: '10000', ...tag }], 'old')
  await post(`${MONTH}-02`, [{ accountId: acct.ar_resellers, debit: '6000', ...tag }, { accountId: acct.sales_reseller, credit: '6000', ...tag }], 'new')
  await post(`${MONTH}-03`, [{ accountId: acct.bank_baf, debit: '4000', ...tag }, { accountId: acct.ar_resellers, credit: '4000', ...tag }], 'paid')
  const a = await close.allowanceFor(MONTH)
  const p = a.parties.find((x) => x.partyId === String(r.id))
  assert.equal(p.total, '12000.00')
  assert.equal(P(p.b30), 600000, 'the new sale is untouched: the payment cleared the oldest first')
  assert.equal(P(p.b90) + P(p.b90p), 600000)
  const v = await close.postAllowance({ month: MONTH }, owner)
  const [{ n }] = await sql`SELECT coalesce(sum(l.credit - l.debit), 0) AS n FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'Draft'
    WHERE l.account_id = ${acct.ecl_allowance} AND e.entry_date <= ${END}::date`
  assert.equal(P(n), P(v.target), 'the allowance account equals the matrix')
  assert.equal((await close.postAllowance({ month: MONTH }, owner)).entryId, v.entryId)
})

test('provisions: booked, used and released through 2700; never more than is held; a contingency books nothing', async () => {
  let list = await close.saveProvision(null, { name: `TEST claim by landlord ${RUN}`, kind: 'provision', expenseAccountId: acct.rent, disclosure: 'Dispute over the deposit' })
  const pr = list.find((x) => x.name === `TEST claim by landlord ${RUN}`)
  await close.addProvisionMove(pr.id, { kind: 'recognise', date: TODAY, amount: '5000' }, owner)
  await close.addProvisionMove(pr.id, { kind: 'use', date: TODAY, amount: '2000', paidFrom: 'cash' }, owner)
  list = await close.addProvisionMove(pr.id, { kind: 'release', date: TODAY, amount: '1000' }, owner)
  const p = list.find((x) => x.id === pr.id)
  assert.equal(p.balance, '2000.00')
  await fails(close.addProvisionMove(pr.id, { kind: 'use', date: TODAY, amount: '2500', paidFrom: 'cash' }, owner), /Only 2000.00/)
  const moved = (await sql`SELECT coalesce(sum(l.credit - l.debit), 0) AS n FROM fin_lines l WHERE l.account_id = ${acct.provisions}
    AND l.entry_id = ANY(${p.moves.map((m) => m.entryId)}::bigint[])`)[0].n
  assert.equal(P(moved), 200000)
  list = await close.voidProvisionMove(p.moves[2].id, { reason: 'test' }, owner)
  assert.equal(list.find((x) => x.id === pr.id).balance, '3000.00')
  const c = (await close.saveProvision(null, { name: `TEST guarantee ${RUN}`, kind: 'contingency', disclosure: 'Guarantee for a supplier' })).find((x) => x.name === `TEST guarantee ${RUN}`)
  await fails(close.addProvisionMove(c.id, { kind: 'recognise', date: TODAY, amount: '1' }, owner), /only disclosed/)
})

test('the month-end checklist: every item reports, manual items can be ticked, a month that has not ended cannot close', async () => {
  const c = await close.checklist(MONTH)
  const keys = c.items.map((i) => i.key)
  for (const k of ['exceptions', 'bank', 'payroll', 'claims', 'depreciation', 'fx', 'ecl', 'stock', 'assets', 'cash', 'tax']) assert.ok(keys.includes(k), k)
  assert.ok(['done', 'na'].includes(c.items.find((i) => i.key === 'depreciation').status), 'posted and current, or nothing to depreciate')
  assert.equal(c.items.find((i) => i.key === 'tax').status, 'na')
  const t = await close.tick(MONTH, { key: 'cash', done: true }, owner)
  assert.equal(t.items.find((i) => i.key === 'cash').status, 'done')
  await close.tick(MONTH, { key: 'cash', done: false }, owner)
  await fails(close.tick(MONTH, { key: 'bank', done: true }, owner), /checked by the system/)
  await fails(close.closeMonth(MONTH, { reason: 'x' }, owner), /has not ended/)
  const o = await notes.overview()
  assert.ok(o.cash.length && o.thisMonth.month === MONTH)
})

test('year-end close: income and costs into retained earnings in the adjustment period; adjustments re-close it; reopen reverses', async () => {
  // A fiscal year of its own, before the earliest one in the database
  const [{ min }] = await sql`SELECT min(fiscal_year) AS min FROM fin_periods`
  const s = Number(min.slice(0, 4)) - 1
  const fy = `${s}-${String((s + 1) % 100).padStart(2, '0')}`
  await sql`INSERT INTO fin_periods (fiscal_year, period_no, name, starts_on, ends_on, is_adjustment)
    SELECT ${fy}, g, to_char(m, 'Mon YYYY'), m::date, (m + interval '1 month - 1 day')::date, false
    FROM generate_series(1, 12) g, LATERAL (SELECT make_date(${s}, 7, 1) + (g - 1) * interval '1 month' AS m) x`
  await sql`INSERT INTO fin_periods (fiscal_year, period_no, name, starts_on, ends_on, is_adjustment) VALUES (${fy}, 13, ${`Adjustments ${fy}`}, make_date(${s + 1}, 6, 30), make_date(${s + 1}, 6, 30), true)`
  const jv = (date, lines, periodId) => ledger.createEntry({ date, post: true, memo: 'TEST year', lines, periodId }, owner)
  await jv(`${s}-08-10`, [{ accountId: acct.cash_studio, debit: '10000' }, { accountId: acct.income_custom, credit: '10000' }])
  await jv(`${s}-09-10`, [{ accountId: acct.travel, debit: '3000' }, { accountId: acct.cash_studio, credit: '3000' }])
  await fails(close.closeYear(fy, owner), /Close every month first/)
  const periods = (await ledger.listPeriods()).filter((p) => p.fiscalYear === fy)
  for (const p of periods.filter((x) => !x.isAdjustment)) await ledger.setPeriodStatus(p.id, { status: 'Closed' }, owner)
  const y = await close.closeYear(fy, owner)
  assert.equal(y.profit, '7000.00'); assert.equal(y.closed, true); assert.equal(y.current, true)
  const adj = periods.find((p) => p.isAdjustment)
  const [cl] = await sql`SELECT id, period_id, entry_type FROM fin_entries WHERE source_type = 'year_close' AND source_id = ${fy} AND status = 'Posted'`
  assert.equal(cl.period_id, adj.id); assert.equal(cl.entry_type, 'CL')
  const re = async () => P((await sql`SELECT coalesce(sum(l.credit - l.debit), 0) AS n FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'Draft'
    WHERE l.account_id = ${acct.retained_earnings} AND e.entry_date BETWEEN ${`${s}-07-01`}::date AND ${`${s + 1}-06-30`}::date`)[0].n)
  assert.equal(await re(), 700000)
  // The profit report still shows the year's profit (closing entries are left out of it)
  const { profitLoss, balanceSheet } = await import('../../lib/finance/reports.js')
  assert.equal((await profitLoss({ from: `${s}-07-01`, to: `${s + 1}-06-30` })).profit, '7000.00')
  assert.equal((await balanceSheet({ asOf: `${s + 1}-06-30` })).balanced, true)
  // An audit adjustment in the adjustment period: the close is out of date until run again
  await jv(`${s + 1}-06-30`, [{ accountId: acct.travel, debit: '500' }, { accountId: acct.cash_studio, credit: '500' }], adj.id)
  assert.equal((await close.yearState(fy)).current, false)
  const y2 = await close.closeYear(fy, owner)
  assert.equal(y2.profit, '6500.00'); assert.equal(await re(), 650000)
  const r = await close.reopenYear(fy, { reason: 'test' }, owner)
  assert.equal(r.closed, false); assert.equal(await re(), 0)
  // The notes pack builds for a year
  const n = await notes.notesPack({ fy })
  assert.equal(n.fiscalYear, fy); assert.ok(n.policies.length > 50); assert.equal(n.ppe.length, 3)
  assert.equal(n.adjustmentJournals.length >= 1, true)
})
