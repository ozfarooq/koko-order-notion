// Finance F6: the finance overview (one screen for the owner) and the notes pack that goes with the
// year's statements (IFRS for SMEs disclosures, spec 9.3): accounting policies, fixed assets,
// inventories, receivables and credit losses, payables, contract liabilities, provisions, related
// parties, revenue by channel and by country, and the journals of the adjustment period.
import { neon } from '@neondatabase/serverless'
import { HttpError } from '../db.js'
import { toPaisa, fromPaisa } from './money.js'
import { getSettings, listPeriods } from './ledger.js'
import { profitLoss, balanceSheet, fyStart } from './reports.js'
import { assetSchedule, CATEGORIES, monthEnd, ym, addMonths } from './assets.js'
import { allowanceFor, listProvisions, closeOverview } from './close.js'
import { listExceptions } from './sales.js'
import { today, isDate } from './expenses.js'

let _sql
const db = () => (_sql ??= neon(process.env.DATABASE_URL))
const sql = (...args) => db()(...args)
const P = (v) => toPaisa(v ?? 0)
const money = (p) => fromPaisa(Math.round(p))

// Balances (debit positive) of accounts by system key at a date
async function balances(keys, asOf) {
  const rows = await sql`SELECT a.system_key, a.code, a.name, coalesce(sum(l.debit - l.credit), 0) AS n
    FROM fin_accounts a LEFT JOIN (fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'Draft'
      AND (e.entry_date - CASE WHEN e.entry_type = 'OB' THEN 1 ELSE 0 END) <= ${asOf}::date) ON l.account_id = a.id
    WHERE a.system_key = ANY(${keys}) GROUP BY a.id ORDER BY a.code`
  return Object.fromEntries(rows.map((r) => [r.system_key, { code: r.code, name: r.name, balance: P(r.n) }]))
}
// Opening, debits, credits, closing of accounts over a range
async function movement(keys, from, to) {
  const rows = await sql`SELECT a.system_key, a.code, a.name,
      coalesce(sum(l.debit - l.credit) FILTER (WHERE m.eff < ${from}::date), 0) AS open,
      coalesce(sum(l.debit) FILTER (WHERE m.eff >= ${from}::date), 0) AS d,
      coalesce(sum(l.credit) FILTER (WHERE m.eff >= ${from}::date), 0) AS c
    FROM fin_accounts a LEFT JOIN (fin_lines l JOIN (SELECT *, entry_date - CASE WHEN entry_type = 'OB' THEN 1 ELSE 0 END AS eff FROM fin_entries) m
      ON m.id = l.entry_id AND m.status <> 'Draft' AND m.eff <= ${to}::date) ON l.account_id = a.id
    WHERE a.system_key = ANY(${keys}) GROUP BY a.id ORDER BY a.code`
  return rows.map((r) => ({ key: r.system_key, code: r.code, name: r.name, opening: P(r.open), debits: P(r.d), credits: P(r.c), closing: P(r.open) + P(r.d) - P(r.c) }))
}

// ── Overview ───────────────────────────────────────────────────────────
export async function overview() {
  const t = today()
  const month = t.slice(0, 7), last = addMonths(month, -1)
  const [b, thisMonth, lastMonth, year, exc, inbox, bank, months, claims] = await Promise.all([
    balances(['cash_studio', 'bank_baf', 'clearing_trax', 'ar_customers', 'ar_resellers', 'ecl_allowance', 'ap_suppliers', 'ap_staff_claims', 'wages_payable',
      'customer_advances', 'refund_liability', 'director_omer', 'director_usman', 'inv_materials', 'inv_wip', 'inv_fg_studio', 'inv_fg_consigned', 'provisions'], t),
    profitLoss({ from: `${month}-01`, to: t }), profitLoss({ from: `${last}-01`, to: monthEnd(last) }), profitLoss({ from: fyStart(t), to: t }),
    listExceptions(),
    sql`SELECT count(*)::int AS n FROM fin_intake_items WHERE status IN ('New', 'Ready', 'Needs attention')`,
    sql`SELECT count(*)::int AS n FROM fin_bank_lines WHERE status = 'Unmatched'`,
    closeOverview(),
    sql`SELECT count(*)::int AS n FROM fin_claims WHERE status = 'Submitted'`,
  ])
  const v = (k) => b[k]?.balance || 0
  const pl = (p) => ({ revenue: p.revenue, grossProfit: p.grossProfit, profit: p.profit, grossMargin: p.grossMargin })
  const ended = months.filter((m) => m.endsOn < t)
  const toClose = ended.filter((m) => m.status === 'Open' && m.startsOn >= (ended[0]?.startsOn || ''))
  const { goLiveDate } = await getSettings()
  return {
    asOf: t,
    cash: [b.bank_baf, b.cash_studio, b.clearing_trax].filter(Boolean).map((a) => ({ code: a.code, name: a.name, balance: money(a.balance) })),
    cashTotal: money(v('bank_baf') + v('cash_studio')),
    receivables: { customers: money(v('ar_customers')), resellers: money(v('ar_resellers')), allowance: money(-v('ecl_allowance')), net: money(v('ar_customers') + v('ar_resellers') + v('ecl_allowance')) },
    payables: { suppliers: money(-v('ap_suppliers')), claims: money(-v('ap_staff_claims')), wages: money(-v('wages_payable')), total: money(-(v('ap_suppliers') + v('ap_staff_claims') + v('wages_payable'))) },
    advances: money(-v('customer_advances')), refunds: money(-v('refund_liability')), provisions: money(-v('provisions')),
    directors: { omer: money(-v('director_omer')), usman: money(-v('director_usman')) },
    stock: money(v('inv_materials') + v('inv_wip') + v('inv_fg_studio') + v('inv_fg_consigned')),
    thisMonth: { month, ...pl(thisMonth) }, lastMonth: { month: last, ...pl(lastMonth) }, yearToDate: { from: fyStart(t), ...pl(year) },
    attention: { postingProblems: exc.length, inbox: inbox[0].n, bankUnmatched: bank[0].n, claimsWaiting: claims[0].n,
      monthsToClose: toClose.filter((m) => m.endsOn >= goLiveDate).map((m) => ({ month: m.month, name: m.name })) },
    months: months.filter((m) => m.fiscalYear === months.find((x) => t >= x.startsOn && t <= x.endsOn)?.fiscalYear)
      .map((m) => ({ month: m.month, name: m.name, status: m.status, closedWithOpenItems: m.closedWithOpenItems })),
  }
}

// ── Notes pack ─────────────────────────────────────────────────────────
const DEFAULT_POLICIES = (s) => [
  `Basis of preparation. The financial statements are prepared under ${({ IFRS_SMES: 'IFRS for SMEs', AFRS_SSE: 'the Accounting and Financial Reporting Standard for Small-Sized Entities', IFRS: 'International Financial Reporting Standards' })[s.reportingFramework]} as applicable in Pakistan, on the historical cost basis, in Pakistani rupees.`,
  'Revenue. Revenue from retail orders is recognised when the order is fully paid, which for Koko is normally the day the outfit is handed over or delivered. Advances received before then are contract liabilities. Outfits placed with resellers remain inventory until the reseller sells them; Koko acts as principal and recognises the sale at the price to the end customer, with the reseller\'s commission and alteration charges as selling expenses.',
  'Inventories. Inventories are stated at the lower of cost and net realisable value. Cost is the design\'s cost card (fabric at weighted average purchase cost, stitching, outsourced work and consumables), with fabric scaled by size. Purchases are expensed when incurred and the stock held is valued at each month end (periodic method). Damaged pieces are carried at the lower of cost and expected selling price.',
  `Property, plant and equipment. Fixed assets are carried at cost less accumulated depreciation. Depreciation is charged straight line over the useful life to the residual value: machinery and equipment ${CATEGORIES.machinery.life / 12} years, furniture and fixtures ${CATEGORIES.furniture.life / 12} years, computers and phones ${CATEGORIES.computers.life / 12} years, unless a different life is set for an asset. An asset available for use on or before the 15th of a month is depreciated from that month. Items below Rs ${Number(s.capitalisationThreshold).toLocaleString('en-PK')} are expensed.`,
  'Foreign currencies. Transactions in foreign currencies are recorded at the rate on the transaction date. Receivables in foreign currencies are retranslated at the month-end rate; differences are recognised in profit or loss.',
  'Trade receivables. Receivables are carried at amortised cost less an allowance for expected credit losses, measured with a provision matrix of loss rates by age.',
  'Provisions. A provision is recognised when there is a present obligation from a past event, an outflow is probable and the amount can be estimated reliably. Contingent liabilities are disclosed and not recognised.',
].join('\n\n')

export async function notesPack(q = {}) {
  const fy = /^\d{4}-\d{2}$/.test(q.fy || '') ? q.fy : null
  const periods = await listPeriods()
  const year = periods.filter((p) => p.fiscalYear === (fy || periods.find((p) => !p.isAdjustment && today() >= p.startsOn && today() <= p.endsOn)?.fiscalYear))
  if (!year.length) throw new HttpError(404, 'There is no such fiscal year')
  const fiscalYear = year[0].fiscalYear
  const from = year.find((p) => p.periodNo === 1).startsOn
  const yearEnd = year.find((p) => p.isAdjustment).endsOn
  const to = isDate(q.to) && q.to >= from && q.to <= yearEnd ? q.to : (today() < yearEnd ? today() : yearEnd)
  const settings = await getSettings()
  const [ppe, stock, ecl, pay, adv, provs, dirs, related, channel, geo, adjEntries, bs] = await Promise.all([
    assetSchedule({ from, to }),
    movement(['inv_materials', 'inv_wip', 'inv_fg_studio', 'inv_fg_consigned', 'inv_nrv_allowance'], from, to),
    allowanceFor(to === monthEnd(ym(to)) ? ym(to) : addMonths(ym(to), -1)).catch(() => null),
    movement(['ap_suppliers', 'ap_staff_claims', 'wages_payable', 'employee_benefits_accrued', 'accrued_expenses'], from, to),
    movement(['customer_advances', 'refund_liability'], from, to),
    listProvisions(),
    movement(['director_omer', 'director_usman'], from, to),
    sql`SELECT s.name, coalesce(sum(x.amount), 0) AS spent, count(*)::int AS n FROM fin_expenses x JOIN fin_suppliers s ON s.id = x.supplier_id AND s.is_related_party
        WHERE x.status = 'Posted' AND x.expense_date BETWEEN ${from}::date AND ${to}::date GROUP BY s.name ORDER BY s.name`,
    sql`SELECT a.code, a.name, coalesce(sum(l.credit - l.debit), 0) AS n FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'Draft' AND e.entry_type <> 'CL'
        AND e.entry_date BETWEEN ${from}::date AND ${to}::date JOIN fin_accounts a ON a.id = l.account_id AND a.type = 'income' AND a.fs_line = 'Revenue'
        GROUP BY a.id ORDER BY a.code`,
    // Country: reseller sales by the reseller's currency (AED = UAE); orders by delivery country
    sql`SELECT CASE WHEN l.party_type = 'reseller' THEN CASE r.currency WHEN 'AED' THEN 'United Arab Emirates' WHEN 'PKR' THEN 'Pakistan' ELSE r.currency END
                    ELSE coalesce(nullif(o.delivery_country, ''), 'Pakistan') END AS country,
          coalesce(sum(l.credit - l.debit), 0) AS n
        FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'Draft' AND e.entry_type <> 'CL' AND e.entry_date BETWEEN ${from}::date AND ${to}::date
        JOIN fin_accounts a ON a.id = l.account_id AND a.type = 'income' AND a.fs_line = 'Revenue'
        LEFT JOIN resellers r ON l.party_type = 'reseller' AND r.id::text = l.party_id LEFT JOIN orders o ON o.id = l.order_id
        GROUP BY 1 ORDER BY 2 DESC`,
    sql`SELECT e.id, e.entry_no, e.entry_type, e.entry_date::text AS d, e.memo, e.status, coalesce(sum(l.debit), 0) AS total
        FROM fin_entries e JOIN fin_periods p ON p.id = e.period_id AND p.is_adjustment AND p.fiscal_year = ${fiscalYear}
        LEFT JOIN fin_lines l ON l.entry_id = e.id WHERE e.status <> 'Draft' GROUP BY e.id ORDER BY e.id`,
    balanceSheet({ asOf: to }),
  ])
  const mv = (r) => ({ code: r.code, name: r.name, opening: money(r.opening), debits: money(r.debits), credits: money(r.credits), closing: money(r.closing) })
  const credit = (r) => ({ code: r.code, name: r.name, opening: money(-r.opening), increase: money(r.credits), decrease: money(r.debits), closing: money(-r.closing) })
  return {
    company: settings.companyName, fiscalYear, from, to, framework: settings.reportingFramework,
    policies: settings.accountingPolicies || DEFAULT_POLICIES(settings), policiesAreDefault: !settings.accountingPolicies,
    ppe,
    inventories: stock.map(mv),
    receivables: ecl ? { asOf: ecl.asOf, buckets: ecl.buckets, allowance: ecl.booked, target: ecl.target, parties: ecl.parties.slice(0, 20) } : null,
    payables: pay.map(credit),
    contractLiabilities: adv.map(credit),
    provisions: provs.map((p) => ({ name: p.name, kind: p.kind, disclosure: p.disclosure, balance: p.balance, status: p.status,
      moves: p.moves.filter((m) => m.status === 'Posted' && m.date >= from && m.date <= to) })),
    relatedParties: { directors: dirs.map(credit), suppliers: related.map((r) => ({ name: r.name, spent: money(P(r.spent)), bills: r.n })) },
    revenueByChannel: channel.map((r) => ({ code: r.code, name: r.name, amount: money(P(r.n)) })),
    revenueByCountry: geo.map((r) => ({ country: r.country, amount: money(P(r.n)) })),
    adjustmentJournals: adjEntries.map((e) => ({ id: e.id, entryNo: e.entry_no, type: e.entry_type, date: e.d, memo: e.memo || '', status: e.status, total: money(P(e.total)) })),
    balanced: bs.balanced ?? null,
  }
}
