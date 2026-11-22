// F1 reports on the finance development database only. Posts a known set of transactions into the
// test fiscal year 2097-98 and checks each report moves by exactly the expected amounts (before/after,
// so re-running the tests keeps working even though posted entries are permanent).
import { test, before } from 'node:test'
import assert from 'node:assert/strict'

const devUrl = process.env.FINANCE_DEV_DATABASE_URL
if (!devUrl || new URL(devUrl).pathname !== '/koko_finance_dev') throw new Error('FINANCE_DEV_DATABASE_URL must point at koko_finance_dev')
process.env.DATABASE_URL = devUrl

const { neon } = await import('@neondatabase/serverless')
const ledger = await import('../../lib/finance/ledger.js')
const reports = await import('../../lib/finance/reports.js')
const { toPaisa } = await import('../../lib/finance/money.js')
const sql = neon(devUrl)
const P = toPaisa
const R = { from: '2097-07-01', to: '2098-06-30' }

let owner, acct, before_, after
const snapshot = async () => ({
  tb: await reports.trialBalance(R),
  pl: await reports.profitLoss(R),
  bs: await reports.balanceSheet({ asOf: R.to }),
  cf: await reports.cashFlow(R),
  eq: await reports.changesInEquity(R),
  bank: await reports.ledger(acct.bank_baf.id, R),
})
const line = (pl, name) => P(pl.lines.find((l) => l.name === name).total)
const bsTotal = (bs, k) => P(bs.totals[k])

before(async () => {
  await sql`INSERT INTO users (username, name, role, password_hash) SELECT 'fin_test_owner', 'fin_test_owner', 'owner', 'x' WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'fin_test_owner')`
  ;[owner] = await sql`SELECT id, role FROM users WHERE username = 'fin_test_owner'`
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM fin_periods WHERE fiscal_year = '2097-98'`
  if (!n) {
    await sql`INSERT INTO fin_periods (fiscal_year, period_no, name, starts_on, ends_on, is_adjustment)
              SELECT '2097-98', g, to_char(m, 'Mon YYYY'), m::date, (m + interval '1 month - 1 day')::date, false
              FROM generate_series(1, 12) g, LATERAL (SELECT date '2097-07-01' + (g - 1) * interval '1 month' AS m) x`
    await sql`INSERT INTO fin_periods (fiscal_year, period_no, name, starts_on, ends_on, is_adjustment) VALUES ('2097-98', 13, 'Adjustments 2097-98', '2098-06-30', '2098-06-30', true)`
  }
  await sql`UPDATE fin_periods SET status = 'Open' WHERE fiscal_year = '2097-98'`
  acct = Object.fromEntries((await sql`SELECT id, system_key FROM fin_accounts WHERE system_key IS NOT NULL`).map((a) => [a.system_key, a]))

  before_ = await snapshot()
  const post = (date, memo, dr, cr, amount) => ledger.createEntry({ date, memo: `TEST F1 ${memo}`, post: true,
    lines: [{ accountId: acct[dr].id, debit: amount }, { accountId: acct[cr].id, credit: amount }] }, owner)
  await post('2097-07-01', 'share capital', 'bank_baf', 'share_capital', '100000')
  await post('2097-08-10', 'sale', 'bank_baf', 'sales_retail', '50000')
  await post('2097-08-31', 'rent', 'rent', 'bank_baf', '10000')
  await post('2097-09-30', 'depreciation', 'depreciation', 'ppe_acc_depreciation', '2000')
  await post('2097-10-05', 'director loan', 'bank_baf', 'director_omer', '20000')
  await post('2097-10-20', 'machine', 'ppe_machinery', 'bank_baf', '30000')
  await post('2097-11-03', 'consumables', 'consumables', 'cash_studio', '3000')
  after = await snapshot()
})

test('trial balance: debits equal credits, before and after', () => {
  assert.ok(before_.tb.balanced, `difference ${before_.tb.difference}`)
  assert.ok(after.tb.balanced, `difference ${after.tb.difference}`)
  assert.equal(P(after.tb.totals.debit) - P(before_.tb.totals.debit), P('215000'))
})

test('profit or loss: revenue, cost of sales, gross profit and profit move as expected', () => {
  const d = (k) => P(after.pl[k]) - P(before_.pl[k])
  assert.equal(d('revenue'), P('50000'))
  assert.equal(d('costOfSales'), P('3000'))
  assert.equal(d('grossProfit'), P('47000'))
  assert.equal(line(after.pl, 'Administrative expenses') - line(before_.pl, 'Administrative expenses'), P('12000'))
  assert.equal(d('profit'), P('35000'))
})

test('financial position balances: assets = equity + liabilities', () => {
  assert.ok(after.bs.balanced, `difference ${after.bs.difference}`)
  assert.equal(bsTotal(after.bs, 'assets') - bsTotal(before_.bs, 'assets'), P('155000'))
  assert.equal(bsTotal(after.bs, 'equity') - bsTotal(before_.bs, 'equity'), P('135000'))
  assert.equal(bsTotal(after.bs, 'liabilities') - bsTotal(before_.bs, 'liabilities'), P('20000'))
})

test('profit for the period equals the change in equity, less capital movements', () => {
  const profit = P(after.eq.profit) - P(before_.eq.profit)
  const change = P(after.eq.changeInEquity) - P(before_.eq.changeInEquity)
  assert.equal(profit, P('35000'))
  assert.equal(change - profit, P('100000'), 'the rest is the share capital issued')
  assert.equal(P(after.eq.profit), P(after.pl.profit), 'equity statement and P&L agree')
})

test('cash flows: indirect = direct = actual change in cash; depreciation is added back', () => {
  assert.ok(after.cf.reconciles)
  const d = (k) => P(after.cf.totals[k]) - P(before_.cf.totals[k])
  assert.equal(P(after.cf.change) - P(before_.cf.change), P('127000'))
  assert.equal(d('operating'), P('37000'))      // profit 35,000 + depreciation 2,000
  assert.equal(d('investing'), P('-30000'))
  assert.equal(d('financing'), P('120000'))
  assert.equal(P(after.cf.direct.net), P(after.cf.change))
})

test('ledger: running balance ends at the closing balance, and matches the trial balance', () => {
  const b = after.bank
  assert.equal(b.lines.at(-1).balance, b.closing)
  assert.equal(P(b.closing) - P(b.opening), P(b.debit) - P(b.credit))
  const tbRow = after.tb.accounts.find((a) => a.id === acct.bank_baf.id)
  assert.equal(P(tbRow.closingDebit) - P(tbRow.closingCredit), P(b.closing))
  assert.equal(P(after.bank.closing) - P(before_.bank.closing), P('130000'))
})

test('reports read quickly', async () => {
  const t = Date.now()
  await Promise.all([reports.trialBalance(R), reports.profitLoss({ ...R, compare: 'previous' }), reports.balanceSheet({ asOf: R.to, compare: 'yearend' })])
  assert.ok(Date.now() - t < 6000, `${Date.now() - t} ms`)
})

test('opening balances stand for the day before go-live: in the prior year-end position and opening cash, not in the year\'s flows', async () => {
  const bs0 = await reports.balanceSheet({ asOf: '2097-06-30' }), cf0 = await reports.cashFlow(R)
  await ledger.createEntry({ date: '2097-07-01', entryType: 'OB', memo: 'TEST F1 opening', post: true,
    source: { type: 'test_opening', id: `f1-${Date.now()}`, event: 'opening' },
    lines: [{ accountId: acct.bank_baf.id, debit: '8000' }, { accountId: acct.retained_earnings.id, credit: '8000' }] }, owner)
  const bs1 = await reports.balanceSheet({ asOf: '2097-06-30' }), cf1 = await reports.cashFlow(R)
  assert.equal(P(bs1.totals.assets) - P(bs0.totals.assets), P('8000'), 'part of the 30 June position')
  assert.ok(bs1.balanced)
  assert.equal(P(cf1.openingCash) - P(cf0.openingCash), P('8000'), 'part of opening cash')
  assert.equal(P(cf1.totals.net), P(cf0.totals.net), 'not a cash flow of the year')
  assert.ok(cf1.reconciles)
})
