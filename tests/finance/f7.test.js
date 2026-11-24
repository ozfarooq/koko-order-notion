// F7: Pakistan tax (migration 024, lib/finance/tax.js and the tax branches of the posting rules).
// Pure calculations first, then tax switched on in koko_finance_dev for this file only: the settings are
// put back afterwards, so the other test files keep running with tax off. Runs ONLY on koko_finance_dev.
// Run: npm run test:finance
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

const devUrl = process.env.FINANCE_DEV_DATABASE_URL
if (!devUrl || new URL(devUrl).pathname !== '/koko_finance_dev') throw new Error('FINANCE_DEV_DATABASE_URL must point at koko_finance_dev')
process.env.DATABASE_URL = devUrl

const { neon } = await import('@neondatabase/serverless')
const { toPaisa } = await import('../../lib/finance/money.js')
const tax = await import('../../lib/finance/tax.js')
const posting = await import('../../lib/finance/posting.js')
const sales = await import('../../lib/finance/sales.js')
const expenses = await import('../../lib/finance/expenses.js')
const db = await import('../../lib/db.js')
const sql = neon(devUrl)

const RUN = Date.now().toString(36)
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })
const MONTH = TODAY.slice(0, 7)
const FY = tax.fyOfDate(TODAY)
let owner, acct, saved, product, activeBefore
const P = (v) => toPaisa(v ?? 0)
const fails = async (p, re) => { try { await p } catch (err) { if (re) assert.match(err.message, re); return err } assert.fail('expected an error') }
const linesOf = async (entryId) => sql`SELECT a.system_key, l.debit, l.credit, l.tax_code FROM fin_lines l JOIN fin_accounts a ON a.id = l.account_id WHERE l.entry_id = ${entryId}`
const net = (ls, key) => ls.filter((l) => l.system_key === key).reduce((s, l) => s + P(l.debit) - P(l.credit), 0)

before(async () => {
  await sql`INSERT INTO users (username, name, role, password_hash) SELECT 'fin_test_owner', 'fin_test_owner', 'owner', 'x' WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(username) = 'fin_test_owner')`
  ;[owner] = await sql`SELECT id, username, name, role FROM users WHERE username = 'fin_test_owner'`
  acct = Object.fromEntries((await sql`SELECT id, system_key FROM fin_accounts WHERE system_key IS NOT NULL`).map((a) => [a.system_key, a.id]))
  activeBefore = await sql`SELECT id, is_active FROM fin_accounts WHERE system_key = ANY(${tax.TAX_ACCOUNTS})`
  ;[saved] = await sql`SELECT tax_enabled, tax_enabled_from, sales_tax_registered, strn, cod_wht_treatment FROM fin_settings`
  ;[product] = await sql`INSERT INTO products (name, price_pkr) VALUES (${`TEST F7 ${RUN}`}, 11800) RETURNING id`
})
after(async () => {
  await sql`UPDATE fin_settings SET tax_enabled = ${saved.tax_enabled}, tax_enabled_from = ${saved.tax_enabled_from}, sales_tax_registered = ${saved.sales_tax_registered},
    strn = ${saved.strn}, cod_wht_treatment = ${saved.cod_wht_treatment}`
  // The tax accounts go back to how they were (inactive while tax is off; the ledger tests rely on it)
  for (const a of activeBefore) await sql`UPDATE fin_accounts SET is_active = ${a.is_active} WHERE id = ${a.id}`
})

test('pure: sales tax inside a price, income tax with minimum tax and super tax', () => {
  assert.equal(tax.taxInside(1180000, 18), 180000)
  assert.equal(tax.taxOnTop(1000000, 18), 180000)
  const base = { addBacks: 0, deductions: 0, normalRate: 29, minimumRate: 1.25, superRate: 8, superThreshold: 50000000000 }
  const a = tax.computeIncomeTax({ ...base, profitBeforeTax: 100000000, turnover: 1000000000 })
  assert.equal(a.normal, 29000000); assert.equal(a.minimum, 12500000); assert.equal(a.minimumApplies, false); assert.equal(a.payable, 29000000)
  const b = tax.computeIncomeTax({ ...base, profitBeforeTax: 1000000, turnover: 1000000000 })
  assert.equal(b.minimumApplies, true); assert.equal(b.payable, 12500000); assert.equal(b.minimumCarryForward, 12500000 - 290000)
  const c = tax.computeIncomeTax({ ...base, profitBeforeTax: -5000000, turnover: 0 })
  assert.equal(c.payable, 0, 'a loss: no tax')
  const d = tax.computeIncomeTax({ ...base, profitBeforeTax: 60000000000, turnover: 100 })
  assert.equal(d.superTax, 4800000000, 'super tax only above the threshold')
  assert.equal(tax.taxYearOf('2027-28'), 2028)
})

test('posting rules in both modes: tax off, the whole price is revenue; tax on, output tax is taken out; exports zero-rated', () => {
  const acc = { customer_advances: 1, sales_retail: 2, sales_web: 3, sales_damaged: 4, st_output: 5, ar_resellers: 6, reseller_commission: 7, reseller_alteration: 8, sales_reseller: 9 }
  const o = { amount: 1180000, channel: 'Studio', orderId: 'x', customerId: 'c', orderNumber: 'SO-1', specialPaisa: 0 }
  const off = posting.revenueLines(o, acc)
  assert.equal(off.find((l) => l.accountId === 2).credit, 1180000); assert.ok(!off.some((l) => l.accountId === 5))
  const on = posting.revenueLines(o, acc, { rate: 18, code: 'ST' })
  assert.equal(on.find((l) => l.accountId === 2).credit, 1000000); assert.equal(on.find((l) => l.accountId === 5).credit, 180000)
  assert.equal(on.find((l) => l.accountId === 2).taxCode, 'ST')
  const split = posting.revenueLines({ ...o, specialPaisa: 590000 }, acc, { rate: 18, code: 'ST' })
  assert.equal(split.reduce((s, l) => s + l.credit, 0), 1180000); assert.equal(split.find((l) => l.accountId === 5).credit, 180000)
  const piece = { id: 'p', resellerId: 1, productId: 9, product: 'Neel', price: 60000, designerDiscount: 0, resellerDiscount: 0, alteration: 0, commissionPct: 30, currency: 'AED' }
  assert.equal(posting.resellerSaleLines(piece, 75, acc, true).lines.find((l) => l.accountId === 9).taxCode, 'ZR')
  assert.equal(posting.resellerSaleLines(piece, 75, acc, false).lines.find((l) => l.accountId === 9).taxCode, undefined)
})

test('switching tax on: profile first, then from a date in an open month; tax accounts become active', async () => {
  await fails(tax.switchTax({ enabled: true, from: TODAY }, { ...owner, role: 'finance' }), /Only the owner/)
  await tax.updateTaxProfile({ salesTaxRegistered: true, strn: '', codWhtTreatment: 'Adjustable' })
  await fails(tax.switchTax({ enabled: true, from: `${MONTH}-01` }, owner), /STRN/)
  await tax.updateTaxProfile({ strn: '32-77-8761-234-56' })
  const s = await tax.switchTax({ enabled: true, from: `${MONTH}-01` }, owner)
  assert.equal(s.taxEnabled, true)
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM fin_accounts WHERE system_key = ANY(${tax.TAX_ACCOUNTS}) AND NOT is_active`
  assert.equal(n, 0)
})

test('a paid order: sales tax taken out of the price into 2300 (code ST)', async () => {
  const o = await db.createOrder({ customer: `TEST F7 ${RUN}`, channel: 'Studio', orderDate: TODAY, items: [{ productId: product.id, size: 'M', quantity: 1, unitPrice: 11800 }], amount: 11800, advancePaid: 0 }, owner)
  await db.updateOrder(o.id, { status: 'Paid' }, owner)
  await sales.syncOrder(o.id, owner)
  const [si] = await sql`SELECT id FROM fin_entries WHERE source_type = 'order' AND source_id = ${o.id} AND source_event = 'revenue' AND status = 'Posted'`
  const ls = await linesOf(si.id)
  assert.equal(net(ls, 'sales_retail'), -1000000); assert.equal(net(ls, 'st_output'), -180000)
  assert.ok(ls.filter((l) => l.system_key !== 'customer_advances').every((l) => l.tax_code === 'ST'))
  assert.equal((await sales.syncOrder(o.id, owner)).revenue, 'same')
  const reg = await tax.salesRegister(MONTH)
  assert.ok(reg.some((r) => r.value === '10000.00' && r.tax === '1800.00' && r.code === 'ST'))
})

test('a rate change applies from its date only', async () => {
  const later = `${Number(TODAY.slice(0, 4)) + 3}-07-01`
  const rates = await tax.addTaxRate({ key: 'sales_tax', rate: 20, effectiveFrom: later, note: 'TEST' }, owner)
  assert.equal((await tax.rateAt('sales_tax', TODAY)).rate, 18)
  assert.equal((await tax.rateAt('sales_tax', later)).rate, 20)
  await fails(tax.addTaxRate({ key: 'sales_tax', rate: 19, effectiveFrom: later }, owner), /already a rate/)
  await tax.deleteTaxRate(rates.find((r) => r.key === 'sales_tax' && r.effectiveFrom === later).id)
  await fails(tax.deleteTaxRate(rates.find((r) => r.key === 'sales_tax' && r.effectiveFrom === '2025-07-01').id), /stays on record/)
})

let supplier
test('expenses: input tax to 1420; withholding deducted when paying (directly or when a bill is paid) to 2310', async () => {
  const x = await expenses.createExpense({ date: TODAY, amount: '11800', taxAmount: '1800', accountId: acct.utilities, paidFrom: 'cash', description: `TEST taxed bill ${RUN}`, reference: 'INV-1' }, owner)
  const l1 = await linesOf(x.entryId)
  assert.equal(net(l1, 'utilities'), 1000000); assert.equal(net(l1, 'st_input'), 180000); assert.equal(net(l1, 'cash_studio'), -1180000)
  ;[supplier] = await sql`INSERT INTO fin_suppliers (name, wht_category, atl_status) VALUES (${`TEST Tailoring services ${RUN}`}, 'services', true) RETURNING id`
  const sug = await tax.whtSuggestion({ supplierId: supplier.id, amount: '50000', date: TODAY })
  assert.equal(sug.code, 'W153S'); assert.equal(sug.amount, '5500.00')
  assert.equal((await tax.whtSuggestion({ supplierId: supplier.id, amount: '10000', date: TODAY })).amount, '0.00', 'below the yearly threshold')
  const y = await expenses.createExpense({ date: TODAY, amount: '50000', whtAmount: '5500', whtCode: 'W153S', accountId: acct.cogs_outsourced, supplierId: supplier.id, paidFrom: 'bank', description: 'TEST embroidery' }, owner)
  const l2 = await linesOf(y.entryId)
  assert.equal(net(l2, 'bank_baf'), -4450000); assert.equal(net(l2, 'wht_payable'), -550000); assert.equal(net(l2, 'cogs_outsourced'), 5000000)
  const z = await expenses.createExpense({ date: TODAY, amount: '40000', accountId: acct.cogs_outsourced, supplierId: supplier.id, paidFrom: 'unpaid', description: 'TEST bill' }, owner)
  const paid = await expenses.payBill(z.id, { paidOn: TODAY, paidFrom: 'bank', whtAmount: '4400', whtCode: 'W153S' }, owner)
  const l3 = await linesOf(paid.paidEntryId)
  assert.equal(net(l3, 'ap_suppliers'), 4000000); assert.equal(net(l3, 'bank_baf'), -3560000); assert.equal(net(l3, 'wht_payable'), -440000)
  const w = await tax.whtRegister(MONTH)
  assert.ok(w.rows.some((r) => r.amount === '5500.00' && r.code === 'W153S'))
  assert.ok(P(w.toDeposit) >= 990000)
})

test('tax deducted from Koko: COD withholding is a credit (1400) or, if treated as final, a cost (6420)', async () => {
  let list = await tax.addSuffered({ code: 'W6A', date: TODAY, party: 'Trax', base: '10000', amount: '200', from: 'clearing_trax', certificate: `T-${RUN}` }, owner)
  const t = list.find((x) => x.certificate === `T-${RUN}`)
  const ls = await linesOf(t.entryId)
  assert.equal(net(ls, 'tax_wht_suffered'), 20000); assert.equal(net(ls, 'clearing_trax'), -20000)
  await tax.updateTaxProfile({ codWhtTreatment: 'Final' })
  list = await tax.addSuffered({ code: 'W6A', date: TODAY, party: 'Trax', amount: '100', from: 'clearing_trax', certificate: `F-${RUN}` }, owner)
  assert.equal(net(await linesOf(list.find((x) => x.certificate === `F-${RUN}`).entryId), 'courier_deductions'), 10000)
  await tax.updateTaxProfile({ codWhtTreatment: 'Adjustable' })
  list = await tax.voidSuffered(list.find((x) => x.certificate === `F-${RUN}`).id, { reason: 'test' }, owner)
  assert.equal(list.find((x) => x.certificate === `F-${RUN}`).status, 'Void')
})

test('the month\'s sales tax return: credits offset against output tax, the rest paid with a CPR; booking again changes nothing', async () => {
  const r = await tax.salesTaxReturn(MONTH)
  assert.ok(P(r.output) >= 180000); assert.ok(P(r.input) >= 180000)
  assert.equal(P(r.net), P(r.output) - P(r.input) - P(r.withheld) - P(r.broughtForward))
  const b = await tax.bookSalesTaxReturn({ month: MONTH }, owner)
  assert.equal(b.current, true)
  const again = await tax.bookSalesTaxReturn({ month: MONTH }, owner)
  assert.equal(again.entryNo, b.entryNo)
  if (P(b.payable) > 0) {
    const pays = await tax.payTax({ kind: 'sales_tax', period: MONTH, date: TODAY, amount: b.payable, paidFrom: 'bank', cprNo: `CPR-${RUN}` }, owner)
    assert.ok(pays.some((p) => p.cprNo === `CPR-${RUN}`))
  }
})

test('withholding deposit and the tax calendar', async () => {
  const cal = await tax.generateCalendar(FY)
  const kinds = new Set(cal.map((c) => c.kind))
  for (const k of ['sales_tax_return', 'wht_deposit', 'wht_statement', 'advance_tax', 'income_tax_return']) assert.ok(kinds.has(k), k)
  assert.equal(cal.filter((c) => c.kind === 'advance_tax').length, 4)
  const w = await tax.whtRegister(MONTH)
  if (P(w.toDeposit) > 0) await tax.payTax({ kind: 'wht', period: MONTH, date: TODAY, amount: w.toDeposit, paidFrom: 'bank', cprNo: `W-${RUN}` }, owner)
  const after = await tax.listCalendar({ fy: FY })
  assert.equal(after.find((c) => c.kind === 'wht_deposit' && c.period === MONTH).status, 'Done')
  const item = after.find((c) => c.kind === 'income_tax_return')
  const moved = await tax.updateCalendar(item.id, { dueOn: `${Number(FY.slice(0, 4)) + 1}-12-30`, note: 'TEST' })
  assert.equal(moved.find((c) => c.id === item.id).dueOn, `${Number(FY.slice(0, 4)) + 1}-12-30`)
  await tax.updateCalendar(item.id, { dueOn: `${Number(FY.slice(0, 4)) + 1}-12-31`, note: '' })
})

test('income tax estimate: the higher of normal and minimum tax, credits, deferred tax; tax cannot be switched off once used', async () => {
  const e = await tax.incomeTaxEstimate(FY)
  assert.equal(P(e.payable), Math.max(P(e.normalTax), P(e.minimumTax)) + P(e.superTax))
  assert.equal(P(e.taxable), P(e.profitBeforeTax) + P(e.addBacks.total) - P(e.deductions.total))
  assert.equal(P(e.balanceDue), P(e.payable) - P(e.credits))
  assert.ok(P(e.credits) >= 20000, 'the COD withholding is a credit')
  assert.equal(e.partYear, true)
  await fails(tax.bookIncomeTax(FY, owner), /has not ended/)
  const adj = await tax.saveTaxAdjustments(FY, { addBacks: '1000', deductions: '0', note: 'TEST entertainment' })
  assert.equal(P(adj.taxable) - P(e.taxable), 100000)
  await tax.saveTaxAdjustments(FY, { addBacks: '0', deductions: '0', note: '' })
  await fails(tax.switchTax({ enabled: false }, owner), /already posted/)
})

test('booking a year\'s income tax: current tax to 2320 and deferred tax, in the adjustment period; booking again changes nothing', async () => {
  // A fiscal year of its own, before the earliest one in the database
  const [{ min }] = await sql`SELECT min(fiscal_year) AS min FROM fin_periods`
  const s = Number(min.slice(0, 4)) - 1
  const fy = `${s}-${String((s + 1) % 100).padStart(2, '0')}`
  await sql`INSERT INTO fin_periods (fiscal_year, period_no, name, starts_on, ends_on, is_adjustment)
    SELECT ${fy}, g, to_char(m, 'Mon YYYY'), m::date, (m + interval '1 month - 1 day')::date, false
    FROM generate_series(1, 12) g, LATERAL (SELECT make_date(${s}, 7, 1) + (g - 1) * interval '1 month' AS m) x`
  await sql`INSERT INTO fin_periods (fiscal_year, period_no, name, starts_on, ends_on, is_adjustment) VALUES (${fy}, 13, ${`Adjustments ${fy}`}, make_date(${s + 1}, 6, 30), make_date(${s + 1}, 6, 30), true)`
  const { createEntry } = await import('../../lib/finance/ledger.js')
  await createEntry({ date: `${s}-08-10`, post: true, memo: 'TEST year', lines: [{ accountId: acct.cash_studio, debit: '1000000' }, { accountId: acct.income_custom, credit: '1000000' }] }, owner)
  await createEntry({ date: `${s}-09-10`, post: true, memo: 'TEST year', lines: [{ accountId: acct.travel, debit: '400000' }, { accountId: acct.cash_studio, credit: '400000' }] }, owner)
  const e = await tax.incomeTaxEstimate(fy)
  assert.equal(e.profitBeforeTax, '600000.00')
  assert.equal(e.normalTax, '174000.00', '29% of 600,000')
  const b = await tax.bookIncomeTax(fy, owner)
  assert.ok(b.booked)
  const [cur] = await sql`SELECT e.id, p.is_adjustment FROM fin_entries e JOIN fin_periods p ON p.id = e.period_id WHERE e.source_type = 'income_tax' AND e.source_id = ${fy} AND e.status = 'Posted'`
  assert.equal(cur.is_adjustment, true)
  const ls = await linesOf(cur.id)
  assert.equal(net(ls, 'tax_expense'), 17400000); assert.equal(net(ls, 'income_tax_payable'), -17400000)
  const n = (await sql`SELECT count(*)::int AS n FROM fin_entries`)[0].n
  await tax.bookIncomeTax(fy, owner)
  assert.equal((await sql`SELECT count(*)::int AS n FROM fin_entries`)[0].n, n)
})
