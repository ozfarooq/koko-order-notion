// Finance F7: Pakistan tax (spec Section 8). Dormant until the owner switches tax on with a start date.
// From that date: sales tax is taken out of the price of each sale (output tax 2300, code ST; reseller
// exports zero-rated, ZR), input tax on purchases from registered suppliers (1420), withholding deducted by
// Koko when paying suppliers (2310, s153 / s155) and tax deducted from Koko (1400 / 1410, or a cost when the
// courier's COD deduction is treated as final). Rates come from an effective-dated table: a change applies
// from its date only. The income tax estimate compares normal tax with minimum tax on turnover, adds super
// tax above its threshold, and works out deferred tax on fixed assets, the credit-loss allowance and
// provisions (IAS 12; not under AFRS for SSEs). Filing stays manual on IRIS / PRA: these are the figures.
import { neon } from '@neondatabase/serverless'
import { HttpError, blank } from '../db.js'
import { toPaisa, fromPaisa } from './money.js'
import { getSettings, accountBySystemKey, createEntry, reverseEntry, replaceEntry, entryState, listPeriods } from './ledger.js'
import { payAccount, day, isDate, today } from './expenses.js'
import { profitLoss } from './reports.js'
import { CATEGORIES, monthEnd, addMonths } from './assets.js'

let _sql
const db = () => (_sql ??= neon(process.env.DATABASE_URL))
const sql = (...args) => db()(...args)
const P = (v) => toPaisa(v ?? 0)
const money = (p) => fromPaisa(Math.round(p))
const pad = (n) => String(n).padStart(2, '0')
const isMonth = (m) => /^\d{4}-\d{2}$/.test(m || '')
export const TAX_ACCOUNTS = ['tax_wht_suffered', 'st_withheld', 'st_input', 'st_output', 'wht_payable', 'income_tax_payable', 'tax_expense', 'deferred_tax', 'deferred_tax_expense']
// Fiscal year '2027-28' is Tax Year 2028
export const taxYearOf = (fy) => Number(fy.slice(0, 4)) + 1
export const fyOfDate = (d) => { const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)); const s = m >= 7 ? y : y - 1; return `${s}-${pad((s + 1) % 100)}` }

// ── Pure calculations (unit-tested) ────────────────────────────────────
// Sales tax inside a price: price × rate / (100 + rate)
export const taxInside = (gross, rate) => Math.round((gross * rate) / (100 + rate))
export const taxOnTop = (net, rate) => Math.round((net * rate) / 100)

// Income tax for a year (paisa): normal tax on taxable income, minimum tax on turnover (s113), the higher
// is payable; super tax only above its threshold
export function computeIncomeTax({ profitBeforeTax, addBacks = 0, deductions = 0, turnover, normalRate, minimumRate, superRate = 0, superThreshold = null }) {
  const taxable = profitBeforeTax + addBacks - deductions
  const normal = Math.max(0, Math.round((taxable * normalRate) / 100))
  const minimum = Math.max(0, Math.round((turnover * minimumRate) / 100))
  const superTax = superThreshold != null && taxable > superThreshold ? Math.round((taxable * superRate) / 100) : 0
  const minimumApplies = minimum > normal
  return { taxable, normal, minimum, minimumApplies, superTax, payable: Math.max(normal, minimum) + superTax, minimumCarryForward: minimumApplies ? minimum - normal : 0 }
}

// ── Settings and rates ─────────────────────────────────────────────────
export async function taxSettings() {
  const [s] = await sql`SELECT tax_enabled, tax_enabled_from::text AS tax_enabled_from, sales_tax_registered, ntn, strn, pra_number, filer_status, small_company,
    pos_required, prices_include_tax, cod_wht_treatment, tax_addbacks, reporting_framework FROM fin_settings`
  return {
    taxEnabled: s.tax_enabled, taxEnabledFrom: s.tax_enabled_from, salesTaxRegistered: s.sales_tax_registered, ntn: s.ntn || '', strn: s.strn || '',
    praNumber: s.pra_number || '', filerStatus: s.filer_status, smallCompany: s.small_company, posRequired: s.pos_required,
    pricesIncludeTax: s.prices_include_tax, codWhtTreatment: s.cod_wht_treatment, addBacks: s.tax_addbacks || {}, framework: s.reporting_framework,
  }
}
export const taxOnAt = (s, date) => !!(s.taxEnabled && s.taxEnabledFrom && date >= s.taxEnabledFrom)

export async function rateAt(key, date) {
  const [r] = await sql`SELECT rate, threshold FROM fin_tax_rates WHERE key = ${key} AND effective_from <= ${date}::date ORDER BY effective_from DESC LIMIT 1`
  if (!r) throw new HttpError(400, `No ${key.replace(/_/g, ' ')} rate in force on ${date}: add it in Finance settings › Tax`)
  return { rate: Number(r.rate), threshold: r.threshold == null ? null : P(r.threshold) }
}
// Sales tax on a sale dated `date`: null while tax is off or Koko isn't registered
export async function salesTaxAt(date) {
  const s = await taxSettings()
  if (!taxOnAt(s, date) || !s.salesTaxRegistered) return null
  return { rate: (await rateAt('sales_tax', date)).rate, code: 'ST' }
}

export async function updateTaxProfile(b) {
  if (b.codWhtTreatment !== undefined && !['Final', 'Adjustable'].includes(b.codWhtTreatment)) throw new HttpError(400, 'COD withholding is Final or Adjustable')
  const bool = (v) => (v === undefined ? null : !!v)
  await sql`UPDATE fin_settings SET
    ntn = CASE WHEN ${b.ntn !== undefined} THEN ${blank(b.ntn)} ELSE ntn END,
    strn = CASE WHEN ${b.strn !== undefined} THEN ${blank(b.strn)} ELSE strn END,
    pra_number = CASE WHEN ${b.praNumber !== undefined} THEN ${blank(b.praNumber)} ELSE pra_number END,
    filer_status = coalesce(${bool(b.filerStatus)}, filer_status), small_company = coalesce(${bool(b.smallCompany)}, small_company),
    pos_required = coalesce(${bool(b.posRequired)}, pos_required), prices_include_tax = coalesce(${bool(b.pricesIncludeTax)}, prices_include_tax),
    sales_tax_registered = coalesce(${bool(b.salesTaxRegistered)}, sales_tax_registered),
    cod_wht_treatment = coalesce(${b.codWhtTreatment ?? null}, cod_wht_treatment), updated_at = now()`
  return taxSettings()
}

// Switching on: from a date in an open month; the tax accounts are activated. Switching off is only
// possible while nothing has been posted with a tax code.
export async function switchTax({ enabled, from }, user) {
  if (user?.role !== 'owner') throw new HttpError(403, 'Only the owner switches tax on or off')
  if (enabled) {
    if (!isDate(from)) throw new HttpError(400, 'Choose the date tax starts')
    const p = (await listPeriods()).find((x) => !x.isAdjustment && from >= x.startsOn && from <= x.endsOn)
    if (!p) throw new HttpError(400, `There is no accounting period for ${from} yet: add the fiscal year first`)
    if (p.status !== 'Open') throw new HttpError(400, `${p.name} is ${p.status.toLowerCase()}; tax can only start in an open month`)
    if ((await taxSettings()).salesTaxRegistered && !(await taxSettings()).strn) throw new HttpError(400, 'Enter the STRN first (Koko is marked as sales-tax registered)')
    await sql`UPDATE fin_accounts SET is_active = true WHERE system_key = ANY(${TAX_ACCOUNTS})`
    await sql`UPDATE fin_settings SET tax_enabled = true, tax_enabled_from = ${from}::date, updated_at = now()`
  } else {
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status = 'Posted' WHERE l.tax_code IS NOT NULL`
    if (n) throw new HttpError(400, 'Entries with tax are already posted; tax stays on (change the rates or the profile instead)')
    await sql`UPDATE fin_accounts SET is_active = false WHERE system_key = ANY(${TAX_ACCOUNTS})`
    await sql`UPDATE fin_settings SET tax_enabled = false, updated_at = now()`
  }
  return taxSettings()
}

export async function listTaxRates() {
  const rows = await sql`SELECT r.*, u.name AS by_name FROM fin_tax_rates r LEFT JOIN users u ON u.id = r.created_by ORDER BY r.key, r.effective_from DESC`
  return rows.map((r) => ({ id: r.id, key: r.key, label: r.label, rate: Number(r.rate), threshold: r.threshold == null ? null : money(P(r.threshold)),
    effectiveFrom: day(r.effective_from), note: r.note || '', by: r.by_name || '' }))
}
// A new rate from a date (the old one keeps applying before it)
export async function addTaxRate(b, user) {
  const [cur] = await sql`SELECT label FROM fin_tax_rates WHERE key = ${b.key || ''} LIMIT 1`
  if (!cur) throw new HttpError(400, 'Unknown tax')
  const rate = Number(b.rate)
  if (!(rate >= 0 && rate <= 100)) throw new HttpError(400, 'The rate is a percentage, 0 to 100')
  if (!isDate(b.effectiveFrom)) throw new HttpError(400, 'Choose the date it applies from')
  let threshold = null
  if (b.threshold !== undefined && b.threshold !== null && b.threshold !== '') { try { threshold = fromPaisa(toPaisa(b.threshold)) } catch (err) { throw new HttpError(400, `Threshold: ${err.message}`) } }
  try {
    await sql`INSERT INTO fin_tax_rates (key, label, rate, threshold, effective_from, note, created_by)
      VALUES (${b.key}, ${cur.label}, ${rate}, ${threshold}::numeric, ${b.effectiveFrom}::date, ${blank(b.note)}, ${user?.id ?? null})`
  } catch (err) { if (err.code === '23505') throw new HttpError(400, 'There is already a rate from that date'); throw err }
  return listTaxRates()
}
export async function deleteTaxRate(id) {
  const [r] = await sql`SELECT key, effective_from::text AS f FROM fin_tax_rates WHERE id = ${Number(id) || 0}`
  if (!r) throw new HttpError(404, 'Rate not found')
  if (r.f <= today()) throw new HttpError(400, 'A rate already in force stays on record; add a new rate from a later date instead')
  await sql`DELETE FROM fin_tax_rates WHERE id = ${Number(id)}`
  return listTaxRates()
}
export const listTaxCodes = async () => (await sql`SELECT * FROM fin_tax_codes ORDER BY kind, code`).map((c) => ({ code: c.code, name: c.name, kind: c.kind, rateKey: c.rate_key, description: c.description || '' }))

// ── Withholding Koko deducts (as agent) ────────────────────────────────
// The suggestion for a supplier payment: by the supplier's category (goods, services, rent) and ATL status;
// nothing below the threshold for the year
export async function whtSuggestion({ supplierId, amount, date }) {
  const s = await taxSettings()
  const on = date || today()
  if (!taxOnAt(s, on) || !supplierId) return null
  const [sup] = await sql`SELECT name, wht_category, atl_status FROM fin_suppliers WHERE id = ${Number(supplierId)}`
  const cat = (sup?.wht_category || '').toLowerCase()
  const kind = cat.startsWith('good') ? 'goods' : cat.startsWith('serv') ? 'services' : cat.startsWith('rent') ? 'rent' : null
  if (!kind) return { code: null, rate: 0, amount: '0.00', note: `${sup?.name || 'This supplier'} has no withholding category: set goods, services or rent on the supplier` }
  const key = kind === 'rent' ? 'wht_rent' : `wht_${kind}${sup.atl_status === false ? '_nonatl' : ''}`
  const r = await rateAt(key, on)
  const fy = fyOfDate(on)
  const [paid] = await sql`SELECT coalesce(sum(amount), 0) AS n FROM fin_expenses WHERE supplier_id = ${Number(supplierId)} AND status = 'Posted'
    AND expense_date BETWEEN ${`${fy.slice(0, 4)}-07-01`}::date AND ${on}::date`
  const base = P(amount)
  if (r.threshold != null && P(paid.n) + base <= r.threshold) return { code: null, rate: r.rate, amount: '0.00', note: `Below the Rs ${money(r.threshold)} yearly threshold` }
  return { code: { goods: 'W153G', services: 'W153S', rent: 'W155' }[kind], rate: r.rate, amount: money(Math.round((base * r.rate) / 100)), note: `${r.rate}% ${sup.atl_status === false ? '(not on the ATL)' : ''}`.trim() }
}

// ── Tax deducted from Koko ─────────────────────────────────────────────
const SUFFER_FROM = { clearing_trax: 'Trax COD clearing', bank_baf: 'Bank Alfalah', ar_resellers: 'Reseller receivable', clearing_gateway: 'Payment gateway', cash_studio: 'Cash' }
export async function listSuffered({ from, to } = {}) {
  const rows = await sql`SELECT t.*, c.name AS code_name, e.entry_no, r.name AS reseller FROM fin_tax_suffered t JOIN fin_tax_codes c ON c.code = t.tax_code
    LEFT JOIN fin_entries e ON e.id = t.entry_id LEFT JOIN resellers r ON r.id = t.reseller_id
    WHERE (${isDate(from) ? from : null}::date IS NULL OR t.suffered_on >= ${isDate(from) ? from : null}::date)
      AND (${isDate(to) ? to : null}::date IS NULL OR t.suffered_on <= ${isDate(to) ? to : null}::date)
    ORDER BY t.suffered_on DESC, t.id DESC`
  return rows.map((t) => ({ id: t.id, code: t.tax_code, codeName: t.code_name, date: day(t.suffered_on), party: t.party || t.reseller || '', base: t.base_amount == null ? null : money(P(t.base_amount)),
    amount: money(P(t.amount)), from: t.from_account, fromLabel: SUFFER_FROM[t.from_account] || t.from_account, certificate: t.certificate_ref || '', note: t.note || '',
    entryId: t.entry_id, entryNo: t.entry_no || '', status: t.status }))
}
// Dr 1400 (income tax credit) / 1410 (sales tax withheld) / 6420 (COD deduction treated as final),
// Cr the account the money was short from
export async function addSuffered(b, user) {
  const s = await taxSettings()
  if (!isDate(b.date)) throw new HttpError(400, 'Choose the date')
  if (!taxOnAt(s, b.date)) throw new HttpError(400, 'Tax is not switched on for that date')
  const [code] = await sql`SELECT * FROM fin_tax_codes WHERE code = ${b.code || ''} AND kind IN ('wht_suffered', 'withheld_st')`
  if (!code) throw new HttpError(400, 'Choose what kind of tax was deducted')
  if (!SUFFER_FROM[b.from]) throw new HttpError(400, 'Say where it was deducted from')
  let amount
  try { amount = toPaisa(b.amount) } catch (err) { throw new HttpError(400, `Amount: ${err.message}`) }
  if (amount <= 0) throw new HttpError(400, 'Amount must be more than zero')
  const resellerId = b.from === 'ar_resellers' ? Number(b.resellerId) || null : null
  if (b.from === 'ar_resellers' && !resellerId) throw new HttpError(400, 'Which reseller?')
  const debitKey = code.kind === 'withheld_st' ? 'st_withheld' : code.code === 'W6A' && s.codWhtTreatment === 'Final' ? 'courier_deductions' : 'tax_wht_suffered'
  const [debit, credit] = await Promise.all([accountBySystemKey(debitKey), accountBySystemKey(b.from)])
  const party = resellerId ? { partyType: 'reseller', partyId: String(resellerId) } : {}
  const text = `${code.name}${blank(b.party) ? `: ${blank(b.party)}` : ''}${blank(b.certificate) ? `, certificate ${blank(b.certificate)}` : ''}`
  const [t] = await sql`INSERT INTO fin_tax_suffered (tax_code, suffered_on, party, base_amount, amount, from_account, reseller_id, certificate_ref, note, created_by)
    VALUES (${code.code}, ${b.date}::date, ${blank(b.party)}, ${b.base ? fromPaisa(toPaisa(b.base)) : null}::numeric, ${fromPaisa(amount)}::numeric, ${b.from},
            ${resellerId}::int, ${blank(b.certificate)}, ${blank(b.note)}, ${user?.id ?? null}) RETURNING id`
  try {
    const e = await createEntry({ date: b.date, entryType: 'TX', post: true, memo: text, source: { type: 'tax_suffered', id: t.id, event: 'posted' }, lines: [
      { accountId: debit.id, debit: fromPaisa(amount), taxCode: code.code, description: text, ...party },
      { accountId: credit.id, credit: fromPaisa(amount), taxCode: code.code, description: text, ...party },
    ] }, user)
    await sql`UPDATE fin_tax_suffered SET entry_id = ${e.id} WHERE id = ${t.id}`
  } catch (err) { await sql`DELETE FROM fin_tax_suffered WHERE id = ${t.id}`; throw err }
  return listSuffered()
}
export async function voidSuffered(id, { reason } = {}, user) {
  const [t] = await sql`SELECT * FROM fin_tax_suffered WHERE id = ${Number(id) || 0}`
  if (!t || t.status !== 'Posted') throw new HttpError(404, 'Not found')
  if (!blank(reason)) throw new HttpError(400, 'Say why it is being undone')
  if (t.entry_id) await reverseEntry(t.entry_id, { reason }, user)
  await sql`UPDATE fin_tax_suffered SET status = 'Void' WHERE id = ${t.id}`
  return listSuffered()
}

// ── Paying tax (CPR) ───────────────────────────────────────────────────
const PAY_KIND = { sales_tax: ['st_output', 'Sales tax'], wht: ['wht_payable', 'Withholding tax deposited'], advance_tax: ['tax_wht_suffered', 'Advance income tax (s147)'], income_tax: ['income_tax_payable', 'Income tax'] }
export async function listTaxPayments() {
  const rows = await sql`SELECT p.*, e.entry_no FROM fin_tax_payments p LEFT JOIN fin_entries e ON e.id = p.entry_id ORDER BY p.paid_on DESC, p.id DESC`
  return rows.map((p) => ({ id: p.id, kind: p.kind, kindLabel: PAY_KIND[p.kind][1], period: p.period, date: day(p.paid_on), amount: money(P(p.amount)), paidFrom: p.paid_from,
    cprNo: p.cpr_no || '', note: p.note || '', entryId: p.entry_id, entryNo: p.entry_no || '', status: p.status }))
}
export async function payTax(b, user) {
  if (!PAY_KIND[b.kind]) throw new HttpError(400, 'Which tax?')
  if (!blank(b.period)) throw new HttpError(400, 'Which month or tax year is it for?')
  if (!isDate(b.date)) throw new HttpError(400, 'Choose the date paid')
  let amount
  try { amount = toPaisa(b.amount) } catch (err) { throw new HttpError(400, `Amount: ${err.message}`) }
  if (amount <= 0) throw new HttpError(400, 'Amount must be more than zero')
  if (b.paidFrom === 'unpaid') throw new HttpError(400, 'Say how it was paid')
  const credit = await payAccount(b.paidFrom)
  const [key, label] = PAY_KIND[b.kind]
  await sql`UPDATE fin_accounts SET is_active = true WHERE system_key = ${key}`
  const debit = await accountBySystemKey(key)
  const text = `${label} ${b.period}${blank(b.cprNo) ? `, CPR ${blank(b.cprNo)}` : ''}`
  const [t] = await sql`INSERT INTO fin_tax_payments (kind, period, paid_on, amount, paid_from, cpr_no, note, created_by)
    VALUES (${b.kind}, ${blank(b.period)}, ${b.date}::date, ${fromPaisa(amount)}::numeric, ${b.paidFrom}, ${blank(b.cprNo)}, ${blank(b.note)}, ${user?.id ?? null}) RETURNING id`
  try {
    const e = await createEntry({ date: b.date, entryType: 'TX', post: true, memo: text, source: { type: 'tax_payment', id: t.id, event: 'paid' }, lines: [
      { accountId: debit.id, debit: fromPaisa(amount), description: text }, { accountId: credit, credit: fromPaisa(amount), description: text },
    ] }, user)
    await sql`UPDATE fin_tax_payments SET entry_id = ${e.id} WHERE id = ${t.id}`
  } catch (err) { await sql`DELETE FROM fin_tax_payments WHERE id = ${t.id}`; throw err }
  await markCalendar(b.kind === 'sales_tax' ? 'sales_tax_return' : b.kind === 'wht' ? 'wht_deposit' : null, blank(b.period), blank(b.cprNo))
  return listTaxPayments()
}
export async function voidTaxPayment(id, { reason } = {}, user) {
  const [t] = await sql`SELECT * FROM fin_tax_payments WHERE id = ${Number(id) || 0}`
  if (!t || t.status !== 'Posted') throw new HttpError(404, 'Not found')
  if (!blank(reason)) throw new HttpError(400, 'Say why it is being undone')
  if (t.entry_id) await reverseEntry(t.entry_id, { reason }, user)
  await sql`UPDATE fin_tax_payments SET status = 'Void' WHERE id = ${t.id}`
  return listTaxPayments()
}

// ── Sales tax return (monthly) ─────────────────────────────────────────
const sum = (rows, f) => rows.reduce((s, r) => s + f(r), 0)
async function balanceAt(key, asOf, { withoutSource = null } = {}) {
  const [r] = await sql`SELECT coalesce(sum(l.debit - l.credit), 0) AS n FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'Draft'
    JOIN fin_accounts a ON a.id = l.account_id AND a.system_key = ${key} WHERE e.entry_date <= ${asOf}::date
      AND NOT (${withoutSource?.type ?? null}::text IS NOT NULL AND ((e.source_type = ${withoutSource?.type ?? null} AND e.source_id = ${withoutSource?.id ?? null})
        OR coalesce(e.reversal_of IN (SELECT id FROM fin_entries WHERE source_type = ${withoutSource?.type ?? null} AND source_id = ${withoutSource?.id ?? null}), false)))`
  return P(r.n)
}
export async function salesTaxReturn(month) {
  if (!isMonth(month)) throw new HttpError(400, 'Choose the month')
  const from = `${month}-01`, to = monthEnd(month)
  const src = { type: 'sales_tax_return', id: month }
  const [byCode, input, withheld] = await Promise.all([
    sql`SELECT l.tax_code, a.system_key, a.type, coalesce(sum(l.credit - l.debit), 0) AS n FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'Draft'
        JOIN fin_accounts a ON a.id = l.account_id WHERE l.tax_code IN ('ST', 'ZR', 'EX') AND e.entry_date BETWEEN ${from}::date AND ${to}::date GROUP BY 1, 2, 3`,
    sql`SELECT coalesce(sum(l.debit - l.credit), 0) AS n FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'Draft'
        JOIN fin_accounts a ON a.id = l.account_id AND a.system_key = 'st_input' WHERE e.entry_date BETWEEN ${from}::date AND ${to}::date
        AND NOT (e.source_type = 'sales_tax_return') AND coalesce(e.reversal_of NOT IN (SELECT id FROM fin_entries WHERE source_type = 'sales_tax_return'), true)`,
    sql`SELECT coalesce(sum(l.debit - l.credit), 0) AS n FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'Draft'
        JOIN fin_accounts a ON a.id = l.account_id AND a.system_key = 'st_withheld' WHERE e.entry_date BETWEEN ${from}::date AND ${to}::date
        AND NOT (e.source_type = 'sales_tax_return') AND coalesce(e.reversal_of NOT IN (SELECT id FROM fin_entries WHERE source_type = 'sales_tax_return'), true)`,
  ])
  const sales = (code) => sum(byCode.filter((r) => r.tax_code === code && r.type === 'income'), (r) => P(r.n))
  const output = sum(byCode.filter((r) => r.system_key === 'st_output'), (r) => P(r.n))
  // Credits brought forward: input and withheld tax still on 1420 / 1410 from before this month
  const prevEnd = monthEnd(addMonths(month, -1))
  const [inB, whB, outBal] = await Promise.all([balanceAt('st_input', prevEnd), balanceAt('st_withheld', prevEnd), balanceAt('st_output', to, { withoutSource: src })])
  const credits = P(input[0].n) + P(withheld[0].n) + inB + whB
  const outstanding = -outBal                                      // output tax not yet offset or paid
  const offset = Math.max(0, Math.min(credits, outstanding))
  const net = output - (P(input[0].n) + P(withheld[0].n) + inB + whB)
  // The return entry offsets the credits against output tax; what is left on 2300 is paid with a CPR
  const [stIn, stWh, stOut] = await Promise.all([accountBySystemKey('st_input'), accountBySystemKey('st_withheld'), accountBySystemKey('st_output')])
  const lines = []
  if (offset) {
    let left = offset
    const fromWh = Math.min(left, whB + P(withheld[0].n)); left -= fromWh
    const fromIn = left
    lines.push({ accountId: stOut.id, debit: fromPaisa(offset), credit: '0', description: `Sales tax return ${month}: credits offset` })
    if (fromWh) lines.push({ accountId: stWh.id, debit: '0', credit: fromPaisa(fromWh), description: `Sales tax return ${month}` })
    if (fromIn) lines.push({ accountId: stIn.id, debit: '0', credit: fromPaisa(fromIn), description: `Sales tax return ${month}` })
  }
  const state = await entryState({ ...src, event: 'closing' }, lines, to)
  const [paid] = await sql`SELECT coalesce(sum(amount), 0) AS n FROM fin_tax_payments WHERE kind = 'sales_tax' AND period = ${month} AND status = 'Posted'`
  return {
    month, from, to, taxable: money(sales('ST')), zeroRated: money(sales('ZR')), exempt: money(sales('EX')),
    output: money(output), input: money(P(input[0].n)), withheld: money(P(withheld[0].n)), broughtForward: money(inB + whB),
    net: money(net), payable: money(Math.max(0, net)), carriedForward: money(Math.max(0, -net)),
    lines, booked: state.posted, current: state.current, entryNo: state.entryNo, paid: money(P(paid.n)),
  }
}
export async function bookSalesTaxReturn({ month } = {}, user) {
  const r = await salesTaxReturn(month)
  const { entry } = await replaceEntry({ source: { type: 'sales_tax_return', id: month, event: 'closing' }, date: r.to, entryType: 'TX', memo: `Sales tax return ${month}`, lines: r.lines,
    reason: 'Return worked out again' }, user)
  return { ...(await salesTaxReturn(month)), entryNo: entry?.entryNo ?? null }
}

// Registers in the order the return annexes expect: one row per invoice (order) / bill
export async function salesRegister(month) {
  if (!isMonth(month)) throw new HttpError(400, 'Choose the month')
  const rows = await sql`
    SELECT e.id, e.entry_no, e.entry_date::text AS d, o.order_number, c.name AS buyer, r.name AS reseller, min(l.tax_code) FILTER (WHERE a.type = 'income') AS code,
      coalesce(sum(l.credit - l.debit) FILTER (WHERE a.type = 'income'), 0) AS value, coalesce(sum(l.credit - l.debit) FILTER (WHERE a.system_key = 'st_output'), 0) AS tax
    FROM fin_entries e JOIN fin_lines l ON l.entry_id = e.id JOIN fin_accounts a ON a.id = l.account_id
    LEFT JOIN orders o ON o.id = l.order_id LEFT JOIN customers c ON c.id = o.customer_id
    LEFT JOIN resellers r ON l.party_type = 'reseller' AND r.id::text = l.party_id
    WHERE e.status <> 'Draft' AND e.entry_date BETWEEN ${`${month}-01`}::date AND ${monthEnd(month)}::date AND l.tax_code IN ('ST', 'ZR', 'EX')
    GROUP BY e.id, o.order_number, c.name, r.name ORDER BY e.entry_date, e.id`
  return rows.map((x) => ({ entryId: x.id, entryNo: x.entry_no, date: x.d, invoice: x.order_number || x.entry_no, buyer: x.buyer || x.reseller || '', buyerNtn: '',
    buyerType: 'Unregistered', code: x.code, value: money(P(x.value)), tax: money(P(x.tax)), total: money(P(x.value) + P(x.tax)) }))
}
export async function purchaseRegister(month) {
  if (!isMonth(month)) throw new HttpError(400, 'Choose the month')
  const rows = await sql`SELECT x.id, x.expense_date, x.reference, x.amount, x.tax_amount, s.name, s.cnic_ntn, s.strn, e.entry_no
    FROM fin_expenses x LEFT JOIN fin_suppliers s ON s.id = x.supplier_id LEFT JOIN fin_entries e ON e.id = x.entry_id
    WHERE x.status = 'Posted' AND x.tax_amount > 0 AND x.expense_date BETWEEN ${`${month}-01`}::date AND ${monthEnd(month)}::date ORDER BY x.expense_date, x.id`
  return rows.map((x) => ({ expenseId: x.id, date: day(x.expense_date), invoice: x.reference || '', supplier: x.name || '', ntn: x.cnic_ntn || '', strn: x.strn || '',
    value: money(P(x.amount) - P(x.tax_amount)), tax: money(P(x.tax_amount)), total: money(P(x.amount)), entryNo: x.entry_no || '' }))
}
// Withholding deducted by Koko in a month (from 2310 lines) and what has been deposited
export async function whtRegister(month) {
  if (!isMonth(month)) throw new HttpError(400, 'Choose the month')
  const rows = await sql`
    SELECT e.id, e.entry_no, e.entry_date::text AS d, l.tax_code, l.credit - l.debit AS amount, s.name, s.cnic_ntn, s.atl_status, x.amount AS base, x.reference
    FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'Draft' JOIN fin_accounts a ON a.id = l.account_id AND a.system_key = 'wht_payable'
    LEFT JOIN fin_suppliers s ON l.party_type = 'supplier' AND s.id::text = l.party_id
    LEFT JOIN fin_expenses x ON e.source_type = 'expense' AND x.id::text = e.source_id
    WHERE l.tax_code LIKE 'W1%' AND e.entry_date BETWEEN ${`${month}-01`}::date AND ${monthEnd(month)}::date ORDER BY e.entry_date, e.id`
  const [deposited] = await sql`SELECT coalesce(sum(amount), 0) AS n FROM fin_tax_payments WHERE kind = 'wht' AND period = ${month} AND status = 'Posted'`
  const total = sum(rows, (r) => P(r.amount))
  return {
    month, rows: rows.map((r) => ({ entryId: r.id, entryNo: r.entry_no, date: r.d, code: r.tax_code, supplier: r.name || '', ntn: r.cnic_ntn || '', atl: r.atl_status,
      base: r.base == null ? null : money(P(r.base)), amount: money(P(r.amount)), reference: r.reference || '' })),
    total: money(total), deposited: money(P(deposited.n)), toDeposit: money(Math.max(0, total - P(deposited.n))),
  }
}

// ── Income tax (estimate) and deferred tax ─────────────────────────────
// Tax written-down value per asset class at the end of a fiscal year: initial allowance on machinery in
// the first year, then reducing balance; assets owned before go-live start at their carrying amount
export async function taxDepreciation(fy) {
  const end = `${Number(fy.slice(0, 4)) + 1}-06-30`
  const { goLiveDate } = await getSettings()
  const assets = await sql`SELECT * FROM fin_assets WHERE acquired_on <= ${end}::date AND (disposed_on IS NULL OR disposed_on > ${`${fy.slice(0, 4)}-07-01`}::date)`
  const rows = []
  for (const a of assets) {
    const cost = P(a.cost)
    let wdv = a.source === 'opening' ? cost - P(a.opening_depreciation) : cost
    let thisYear = 0
    let y = a.source === 'opening' ? fyOfDate(goLiveDate) : fyOfDate(day(a.acquired_on))
    let first = a.source !== 'opening'
    while (y <= fy) {
      const at = `${y.slice(0, 4)}-07-01`
      const rate = (await rateAt(`taxdep_${a.category}`, at < '2025-07-01' ? '2025-07-01' : at)).rate
      let dep = 0
      if (a.disposed_on && day(a.disposed_on) <= `${Number(y.slice(0, 4)) + 1}-06-30`) { dep = 0; wdv = 0 }
      else {
        if (first && a.category === 'machinery') { const ia = Math.round((wdv * (await rateAt('initial_allowance', at < '2025-07-01' ? '2025-07-01' : at)).rate) / 100); dep += ia; wdv -= ia }
        const d = Math.round((wdv * rate) / 100); dep += d; wdv -= d
      }
      if (y === fy) thisYear = dep
      first = false
      y = `${Number(y.slice(0, 4)) + 1}-${pad((Number(y.slice(0, 4)) + 2) % 100)}`
    }
    rows.push({ assetId: a.id, code: a.code, name: a.name, category: a.category, taxDepreciation: thisYear, taxWdv: wdv })
  }
  return rows
}
async function movementOf(key, from, to) {
  const [r] = await sql`SELECT coalesce(sum(l.debit - l.credit), 0) AS n FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'Draft' AND e.entry_type <> 'CL'
    JOIN fin_accounts a ON a.id = l.account_id AND a.system_key = ${key} WHERE e.entry_date BETWEEN ${from}::date AND ${to}::date`
  return P(r.n)
}
export async function incomeTaxEstimate(fy) {
  if (!/^\d{4}-\d{2}$/.test(fy || '')) throw new HttpError(400, 'Choose the fiscal year')
  const from = `${fy.slice(0, 4)}-07-01`, to = `${Number(fy.slice(0, 4)) + 1}-06-30`
  const asOf = to < today() ? to : today()
  const s = await taxSettings()
  const at = from < '2025-07-01' ? '2025-07-01' : from
  const [pl, normal, minimum, superT, accDep, ecl, prov, taxDep, credits] = await Promise.all([
    profitLoss({ from, to: asOf }), rateAt(s.smallCompany ? 'small_company' : 'corporate', at), rateAt('minimum_tax', at), rateAt('super_tax', at),
    movementOf('depreciation', from, asOf), movementOf('ecl_expense', from, asOf), movementOf('provisions', from, asOf),
    taxDepreciation(fy), balanceAt('tax_wht_suffered', asOf),
  ])
  const extra = s.addBacks?.[fy] || {}
  const otherAdd = P(extra.addBacks || 0), otherDed = P(extra.deductions || 0)
  // Not deductible until paid or written off: accounting depreciation (replaced by tax depreciation),
  // the credit-loss allowance and provisions charged
  const addBacks = accDep + ecl + Math.max(0, -prov) + otherAdd
  const deductions = taxDep.reduce((x, r) => x + r.taxDepreciation, 0) + otherDed
  const pbt = P(pl.profitBeforeTax)
  const turnover = pl.lines.filter((l) => l.name === 'Revenue').reduce((x, l) => x + P(l.total), 0)
  const c = computeIncomeTax({ profitBeforeTax: pbt, addBacks, deductions, turnover, normalRate: normal.rate, minimumRate: minimum.rate, superRate: superT.rate, superThreshold: superT.threshold })
  // Deferred tax (IAS 12): carrying amount less tax base of the fixed assets, less the allowance and
  // provisions (deductible later), at the normal rate. AFRS for SSEs does not require it.
  const nbvRows = await sql`SELECT coalesce(sum(l.debit - l.credit), 0) AS n FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'Draft'
    JOIN fin_accounts a ON a.id = l.account_id WHERE a.system_key = ANY(${[...Object.values(CATEGORIES).map((x) => x.key), 'ppe_acc_depreciation']}) AND e.entry_date <= ${asOf}::date`
  const nbv = P(nbvRows[0].n)
  const taxBase = taxDep.reduce((x, r) => x + r.taxWdv, 0)
  const [allowance, provisions] = await Promise.all([balanceAt('ecl_allowance', asOf), balanceAt('provisions', asOf)])
  const temp = nbv - taxBase + allowance + provisions          // allowance and provisions are credit (negative) balances
  const deferredRequired = s.framework !== 'AFRS_SSE'
  const deferred = deferredRequired ? Math.round((temp * normal.rate) / 100) : 0
  const [booked] = await sql`SELECT entry_no FROM fin_entries WHERE source_type = 'income_tax' AND source_id = ${fy} AND status = 'Posted'`
  const [adv] = await sql`SELECT coalesce(sum(amount), 0) AS n FROM fin_tax_payments WHERE kind = 'advance_tax' AND period = ${String(taxYearOf(fy))} AND status = 'Posted'`
  return {
    fiscalYear: fy, taxYear: taxYearOf(fy), from, to, asOf, partYear: asOf < to, smallCompany: s.smallCompany,
    rates: { normal: normal.rate, minimum: minimum.rate, super: superT.rate, superThreshold: superT.threshold == null ? null : money(superT.threshold) },
    profitBeforeTax: money(pbt), turnover: money(turnover),
    addBacks: { depreciation: money(accDep), creditLosses: money(ecl), provisions: money(Math.max(0, -prov)), other: money(otherAdd), total: money(addBacks) },
    deductions: { taxDepreciation: money(deductions - otherDed), other: money(otherDed), total: money(deductions) },
    taxable: money(c.taxable), normalTax: money(c.normal), minimumTax: money(c.minimum), minimumApplies: c.minimumApplies, superTax: money(c.superTax),
    payable: money(c.payable), minimumCarryForward: money(c.minimumCarryForward),
    credits: money(credits), advancePaid: money(P(adv.n)), balanceDue: money(c.payable - credits),
    quarterlyInstalment: money(Math.max(0, Math.round(c.payable / 4))),
    deferred: { required: deferredRequired, carryingAmount: money(nbv), taxBase: money(taxBase), allowance: money(-allowance), provisions: money(-provisions), temporaryDifference: money(temp), balance: money(deferred) },
    assets: taxDep.map((r) => ({ ...r, taxDepreciation: money(r.taxDepreciation), taxWdv: money(r.taxWdv) })),
    booked: booked?.entry_no || null, notes: extra.note || '',
  }
}
export async function saveTaxAdjustments(fy, b) {
  const v = {}
  for (const k of ['addBacks', 'deductions']) { try { v[k] = fromPaisa(toPaisa(b[k] || 0)) } catch (err) { throw new HttpError(400, `${k}: ${err.message}`) } }
  v.note = blank(b.note) || ''
  await sql`UPDATE fin_settings SET tax_addbacks = tax_addbacks || ${JSON.stringify({ [fy]: v })}::jsonb`
  return incomeTaxEstimate(fy)
}
// Year-end tax entries in the adjustment period: current tax (Dr 7100, Cr 2320) and the deferred tax
// balance (2330 moved to the computed figure against 7110)
export async function bookIncomeTax(fy, user) {
  const t = await incomeTaxEstimate(fy)
  if (t.partYear) throw new HttpError(400, `FY ${fy} has not ended; book the year's tax after 30 June`)
  await sql`UPDATE fin_accounts SET is_active = true WHERE system_key IN ('tax_expense', 'income_tax_payable', 'deferred_tax', 'deferred_tax_expense')`
  const adj = (await listPeriods()).find((p) => p.fiscalYear === fy && p.isAdjustment)
  const [exp, pay, dt, dte] = await Promise.all(['tax_expense', 'income_tax_payable', 'deferred_tax', 'deferred_tax_expense'].map(accountBySystemKey))
  const cur = P(t.payable)
  const current = cur ? [{ accountId: exp.id, debit: fromPaisa(cur), credit: '0', description: `Current tax, Tax Year ${t.taxYear}` }, { accountId: pay.id, debit: '0', credit: fromPaisa(cur), description: `Tax Year ${t.taxYear}` }] : []
  await replaceEntry({ source: { type: 'income_tax', id: fy, event: 'current' }, date: t.to, entryType: 'TX', periodId: adj.id, memo: `Income tax FY ${fy}`, lines: current, reason: 'Tax worked out again' }, user)
  const target = P(t.deferred.balance)                          // positive = liability
  const have = -(await balanceAt('deferred_tax', t.to, { withoutSource: { type: 'income_tax_deferred', id: fy } }))
  const diff = target - have
  const deferred = diff ? [
    { accountId: dte.id, debit: diff > 0 ? fromPaisa(diff) : '0', credit: diff < 0 ? fromPaisa(-diff) : '0', description: `Deferred tax, Tax Year ${t.taxYear}` },
    { accountId: dt.id, debit: diff < 0 ? fromPaisa(-diff) : '0', credit: diff > 0 ? fromPaisa(diff) : '0', description: `Deferred tax at ${t.to}` },
  ] : []
  await replaceEntry({ source: { type: 'income_tax_deferred', id: fy, event: 'closing' }, date: t.to, entryType: 'TX', periodId: adj.id, memo: `Deferred tax FY ${fy}`, lines: deferred, reason: 'Tax worked out again' }, user)
  return incomeTaxEstimate(fy)
}

// ── Tax calendar ───────────────────────────────────────────────────────
const monthsOf = (fy) => Array.from({ length: 12 }, (_, i) => addMonths(`${fy.slice(0, 4)}-07`, i))
const dueIn = (m, dayNo) => { const n = addMonths(m, 1); return `${n}-${pad(dayNo)}` }
export async function generateCalendar(fy) {
  if (!/^\d{4}-\d{2}$/.test(fy || '')) throw new HttpError(400, 'Choose the fiscal year')
  const s = await taxSettings()
  const y1 = Number(fy.slice(0, 4)), ty = taxYearOf(fy)
  const items = []
  for (const m of monthsOf(fy)) {
    const label = new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    if (s.salesTaxRegistered) items.push(['sales_tax_return', m, `Sales tax return and payment, ${label}`, dueIn(m, 18)])
    items.push(['wht_deposit', m, `Deposit withholding tax deducted in ${label}`, dueIn(m, 15)])
  }
  const q = [['Q1', `${y1}-10-20`, 'Jul–Sep'], ['Q2', `${y1 + 1}-01-20`, 'Oct–Dec'], ['Q3', `${y1 + 1}-04-20`, 'Jan–Mar'], ['Q4', `${y1 + 1}-07-20`, 'Apr–Jun']]
  for (const [k, due, span] of q) items.push(['wht_statement', `${ty}-${k}`, `Withholding statement (s165), ${span}`, due])
  for (const [k, due] of [['Q1', `${y1}-09-25`], ['Q2', `${y1}-12-25`], ['Q3', `${y1 + 1}-03-25`], ['Q4', `${y1 + 1}-06-15`]]) items.push(['advance_tax', `${ty}-${k}`, `Advance income tax (s147), ${k} of Tax Year ${ty}`, due])
  items.push(['income_tax_return', String(ty), `Income tax return, Tax Year ${ty}`, `${y1 + 1}-12-31`])
  items.push(['secp_return', String(ty), `SECP annual return (Form A, after the AGM), FY ${fy}`, `${y1 + 1}-11-30`])
  for (const [kind, period, title, due] of items) {
    await sql`INSERT INTO fin_tax_calendar (kind, period, title, due_on) VALUES (${kind}, ${period}, ${title}, ${due}::date) ON CONFLICT (kind, period) DO NOTHING`
  }
  return listCalendar({ fy })
}
export async function listCalendar({ fy, upcoming } = {}) {
  const rows = upcoming
    ? await sql`SELECT * FROM fin_tax_calendar WHERE status = 'Due' AND due_on <= (current_date + ${Number(upcoming)}::int) ORDER BY due_on`
    : await sql`SELECT * FROM fin_tax_calendar WHERE (${fy ?? null}::text IS NULL OR due_on BETWEEN ${fy ? `${fy.slice(0, 4)}-07-01` : null}::date AND ${fy ? `${Number(fy.slice(0, 4)) + 1}-12-31` : null}::date) ORDER BY due_on, id`
  return rows.map((r) => ({ id: r.id, kind: r.kind, period: r.period, title: r.title, dueOn: day(r.due_on), status: r.status, doneOn: day(r.done_on), reference: r.reference || '', note: r.note || '',
    overdue: r.status === 'Due' && day(r.due_on) < today() }))
}
export async function updateCalendar(id, b) {
  const [r] = await sql`SELECT * FROM fin_tax_calendar WHERE id = ${Number(id) || 0}`
  if (!r) throw new HttpError(404, 'Not found')
  if (b.status !== undefined && !['Due', 'Done', 'Not needed'].includes(b.status)) throw new HttpError(400, 'Due, Done or Not needed')
  if (b.dueOn !== undefined && !isDate(b.dueOn)) throw new HttpError(400, 'Due date must be a date')
  await sql`UPDATE fin_tax_calendar SET due_on = coalesce(${b.dueOn ?? null}::date, due_on), status = coalesce(${b.status ?? null}, status),
    done_on = CASE WHEN coalesce(${b.status ?? null}, status) = 'Done' THEN coalesce(done_on, current_date) ELSE NULL END,
    reference = CASE WHEN ${b.reference !== undefined} THEN ${blank(b.reference)} ELSE reference END, note = CASE WHEN ${b.note !== undefined} THEN ${blank(b.note)} ELSE note END
    WHERE id = ${r.id}`
  return listCalendar({ fy: fyOfDate(day(r.due_on)) })
}
async function markCalendar(kind, period, reference) {
  if (!kind || !period) return
  await sql`UPDATE fin_tax_calendar SET status = 'Done', done_on = current_date, reference = coalesce(${reference}, reference) WHERE kind = ${kind} AND period = ${period} AND status = 'Due'`
}
