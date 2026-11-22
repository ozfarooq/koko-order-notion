// Finance reports: general ledger, trial balance, profit or loss, financial position, cash flows
// and changes in equity. Every figure comes from posted journal lines (drafts never count;
// a reversed entry and its reversal both count, so together they net to zero). Sums are done
// in SQL on NUMERIC and handed to JavaScript as integer paisa.
import { neon } from '@neondatabase/serverless'
import { HttpError } from '../db.js'
import { toPaisa, fromPaisa } from './money.js'

let _sql
const db = () => (_sql ??= neon(process.env.DATABASE_URL))
const sql = (...args) => db()(...args)
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '')
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })
const P = (v) => toPaisa(v ?? 0)
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
// Fiscal year July to June
export const fyStart = (d) => { const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)); return `${m >= 7 ? y : y - 1}-07-01` }
const debitNatured = (a) => (['asset', 'cogs', 'expense', 'tax'].includes(a.type)) !== a.is_contra
const PL_TYPES = ['income', 'cogs', 'expense', 'tax']

function range({ from, to } = {}) {
  const t = isDate(to) ? to : today()
  const f = isDate(from) ? from : fyStart(t)
  if (f > t) throw new HttpError(400, 'The start date is after the end date')
  return { from: f, to: t }
}

// Per account: movements before `from` (opening) and within from..to, in paisa
async function movements(from, to) {
  const rows = await sql`
    SELECT a.id, a.code, a.name, a.type, a.is_contra, a.is_control, a.is_active, a.fs_line, a.is_current, a.cash_flow_class, a.system_key,
           coalesce(sum(l.debit)  FILTER (WHERE m.eff <  ${from}::date), 0) AS od,
           coalesce(sum(l.credit) FILTER (WHERE m.eff <  ${from}::date), 0) AS oc,
           coalesce(sum(l.debit)  FILTER (WHERE m.eff >= ${from}::date), 0) AS pd,
           coalesce(sum(l.credit) FILTER (WHERE m.eff >= ${from}::date), 0) AS pc,
           -- the same without year-end closing entries (CL): what profit and cash flows are built from
           coalesce(sum(l.debit)  FILTER (WHERE m.eff >= ${from}::date AND m.entry_type <> 'CL'), 0) AS xd,
           coalesce(sum(l.credit) FILTER (WHERE m.eff >= ${from}::date AND m.entry_type <> 'CL'), 0) AS xc
    FROM fin_accounts a
    LEFT JOIN (fin_lines l JOIN (SELECT *, (entry_date - CASE WHEN entry_type = 'OB' THEN 1 ELSE 0 END) AS eff FROM fin_entries) m
               ON m.id = l.entry_id AND m.status <> 'Draft' AND m.eff <= ${to}::date)
      ON l.account_id = a.id
    GROUP BY a.id ORDER BY a.code`
  return rows.map((r) => ({ ...r, od: P(r.od), oc: P(r.oc), pd: P(r.pd), pc: P(r.pc), xd: P(r.xd), xc: P(r.xc) }))
}
const plAmount = (a, d, c) => (a.type === 'income' ? c - d : d - c)        // income positive, costs positive
const out = (p) => fromPaisa(p)                                             // paisa -> '1234.50'

// ── General ledger for one account ─────────────────────────────────────
// { from, to, partyType, partyId } -> opening, lines with running balance, closing
export async function ledger(accountId, q = {}) {
  const { from, to } = range(q)
  const [a] = await sql`SELECT * FROM fin_accounts WHERE id = ${Number(accountId)}`
  if (!a) throw new HttpError(404, 'Account not found')
  const party = q.partyType ? { t: q.partyType, id: String(q.partyId || '') } : null
  const sign = debitNatured(a) ? 1 : -1
  const [[o], lines] = await Promise.all([
    sql`SELECT coalesce(sum(l.debit - l.credit), 0) AS net FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id
        WHERE l.account_id = ${a.id} AND e.status <> 'Draft' AND (e.entry_date - CASE WHEN e.entry_type = 'OB' THEN 1 ELSE 0 END) < ${from}::date
          AND (${party?.t ?? null}::text IS NULL OR (l.party_type = ${party?.t ?? null} AND l.party_id = ${party?.id ?? null}))`,
    sql`SELECT l.id, l.debit, l.credit, l.description, l.party_type, l.party_id, l.currency, l.amount_fc, l.fx_rate,
               e.id AS entry_id, e.entry_no, e.entry_type, e.entry_date::text AS entry_date, e.memo, e.status, e.source_type, e.source_id
        FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id
        WHERE l.account_id = ${a.id} AND e.status <> 'Draft' AND (e.entry_date - CASE WHEN e.entry_type = 'OB' THEN 1 ELSE 0 END) BETWEEN ${from}::date AND ${to}::date
          AND (${party?.t ?? null}::text IS NULL OR (l.party_type = ${party?.t ?? null} AND l.party_id = ${party?.id ?? null}))
        ORDER BY e.entry_date, e.id, l.line_no
        LIMIT 5001`,
  ])
  if (lines.length > 5000) throw new HttpError(400, 'More than 5,000 lines: choose a shorter date range')
  let bal = P(o.net) * sign, totD = 0, totC = 0
  const opening = bal
  const rows = lines.map((l) => {
    const d = P(l.debit), c = P(l.credit)
    totD += d; totC += c; bal += (d - c) * sign
    return {
      id: l.id, entryId: l.entry_id, entryNo: l.entry_no, entryType: l.entry_type, date: l.entry_date, memo: l.memo || '', status: l.status,
      description: l.description || '', debit: out(d), credit: out(c), balance: out(bal), party: l.party_type ? `${l.party_type}:${l.party_id}` : null,
      currency: l.currency, amountFc: l.amount_fc, fxRate: l.fx_rate,
    }
  })
  return {
    account: { id: a.id, code: a.code, name: a.name, type: a.type, debitNatured: sign === 1 }, from, to,
    opening: out(opening), debit: out(totD), credit: out(totC), closing: out(bal), lines: rows,
  }
}

// ── Trial balance ──────────────────────────────────────────────────────
// Opening (before from), period debits and credits, closing; closing debit and credit columns must agree
export async function trialBalance(q = {}) {
  const { from, to } = range(q)
  const rows = (await movements(from, to)).map((a) => {
    const opening = a.od - a.oc, closing = opening + a.pd - a.pc
    return { id: a.id, code: a.code, name: a.name, type: a.type, isActive: a.is_active, opening: out(opening), debit: out(a.pd), credit: out(a.pc),
      closingDebit: out(closing > 0 ? closing : 0), closingCredit: out(closing < 0 ? -closing : 0), _c: closing, _used: a.od || a.oc || a.pd || a.pc }
  })
  const sum = (k) => rows.reduce((s, r) => s + P(r[k]), 0)
  const totals = { debit: sum('debit'), credit: sum('credit'), closingDebit: sum('closingDebit'), closingCredit: sum('closingCredit') }
  return {
    from, to,
    accounts: rows.map(({ _c, _used, ...r }) => ({ ...r, hasActivity: !!_used })),
    totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, out(v)])),
    balanced: totals.debit === totals.credit && totals.closingDebit === totals.closingCredit,
    difference: out(totals.closingDebit - totals.closingCredit),
  }
}

// ── Profit or loss (expenses by function) ──────────────────────────────
const PL_ORDER = [
  ['Revenue', 'income'], ['Cost of sales', 'cogs'],
  ['Selling and distribution expenses', 'expense'], ['Administrative expenses', 'expense'],
  ['Other income', 'income'], ['Other expenses', 'expense'], ['Finance cost', 'expense'], ['Taxation', 'tax'],
]
const fallbackLine = (a) => ({ income: 'Other income', cogs: 'Cost of sales', expense: 'Administrative expenses', tax: 'Taxation' }[a.type])

function plFrom(accts) {
  const lines = new Map(PL_ORDER.map(([name]) => [name, { name, accounts: [], total: 0 }]))
  for (const a of accts.filter((x) => PL_TYPES.includes(x.type))) {
    const amount = plAmount(a, a.xd, a.xc)
    if (!amount && !a.xd && !a.xc) continue
    const key = lines.has(a.fs_line) ? a.fs_line : fallbackLine(a)
    const g = lines.get(key)
    g.accounts.push({ id: a.id, code: a.code, name: a.name, amount }); g.total += amount
  }
  const t = (n) => lines.get(n).total
  const revenue = t('Revenue'), cogs = t('Cost of sales'), gross = revenue - cogs
  const operating = gross - t('Selling and distribution expenses') - t('Administrative expenses')
  const beforeTax = operating + t('Other income') - t('Other expenses') - t('Finance cost')
  const profit = beforeTax - t('Taxation')
  return { lines: [...lines.values()], revenue, cogs, gross, operating, beforeTax, profit }
}
const plOut = (p) => ({
  lines: p.lines.map((l) => ({ name: l.name, total: out(l.total), accounts: l.accounts.map((a) => ({ ...a, amount: out(a.amount) })) })),
  revenue: out(p.revenue), costOfSales: out(p.cogs), grossProfit: out(p.gross), operatingProfit: out(p.operating),
  profitBeforeTax: out(p.beforeTax), profit: out(p.profit),
  grossMargin: p.revenue ? Math.round((p.gross / p.revenue) * 1000) / 10 : null,
})

// compare: 'previous' (same length just before) | 'lastyear' | none
export async function profitLoss(q = {}) {
  const { from, to } = range(q)
  const current = plFrom(await movements(from, to))
  let comparison = null
  if (q.compare === 'previous' || q.compare === 'lastyear') {
    const days = Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 864e5)
    const c = q.compare === 'previous'
      ? { from: addDays(from, -(days + 1)), to: addDays(from, -1) }
      : { from: `${Number(from.slice(0, 4)) - 1}${from.slice(4)}`, to: `${Number(to.slice(0, 4)) - 1}${to.slice(4)}` }
    comparison = { ...c, ...plOut(plFrom(await movements(c.from, c.to))) }
  }
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM fin_lines l JOIN fin_accounts a ON a.id = l.account_id WHERE a.type = 'cogs'`
  return { from, to, ...plOut(current), comparison, costingIncomplete: n === 0 }
}

// ── Financial position ─────────────────────────────────────────────────
function positionFrom(accts, asOf) {
  const bal = (a) => a.od - a.oc + a.pd - a.pc                    // debit-positive balance up to asOf
  const fy = fyStart(asOf)
  const plBefore = accts.filter((a) => PL_TYPES.includes(a.type)).reduce((s, a) => s + (a._beforeFy || 0), 0)
  const plYear = accts.filter((a) => PL_TYPES.includes(a.type)).reduce((s, a) => s + (a._inFy || 0), 0)
  const group = (filter, sign) => {
    const lines = new Map()
    for (const a of accts.filter(filter)) {
      const amount = bal(a) * sign
      if (!amount && !(a.od || a.oc || a.pd || a.pc)) continue
      const key = a.fs_line || (a.type === 'asset' ? 'Other assets' : a.type === 'liability' ? 'Other liabilities' : 'Other equity')
      if (!lines.has(key)) lines.set(key, { name: key, total: 0, accounts: [] })
      const g = lines.get(key); g.total += amount; g.accounts.push({ id: a.id, code: a.code, name: a.name, amount })
    }
    return [...lines.values()]
  }
  const nonCurrentAssets = group((a) => a.type === 'asset' && a.is_current === false, 1)
  const currentAssets = group((a) => a.type === 'asset' && a.is_current !== false, 1)
  const equity = group((a) => a.type === 'equity', -1)
  // Profit not yet closed to retained earnings: earlier years join retained earnings, this year shows on its own line
  const re = equity.find((l) => l.name === 'Retained earnings') || (() => { const l = { name: 'Retained earnings', total: 0, accounts: [] }; equity.push(l); return l })()
  if (plBefore) { re.total += -plBefore; re.accounts.push({ id: null, code: '', name: `Profit of earlier years not yet closed`, amount: -plBefore }) }
  equity.push({ name: 'Profit for the year', total: -plYear, accounts: [], profitForYear: true })
  const nonCurrentLiabilities = group((a) => a.type === 'liability' && a.is_current === false, -1)
  const currentLiabilities = group((a) => a.type === 'liability' && a.is_current !== false, -1)
  const sum = (ls) => ls.reduce((s, l) => s + l.total, 0)
  const totals = {
    nonCurrentAssets: sum(nonCurrentAssets), currentAssets: sum(currentAssets), equity: sum(equity),
    nonCurrentLiabilities: sum(nonCurrentLiabilities), currentLiabilities: sum(currentLiabilities),
  }
  totals.assets = totals.nonCurrentAssets + totals.currentAssets
  totals.liabilities = totals.nonCurrentLiabilities + totals.currentLiabilities
  totals.equityAndLiabilities = totals.equity + totals.liabilities
  const fmt = (ls) => ls.map((l) => ({ ...l, total: out(l.total), accounts: l.accounts.map((a) => ({ ...a, amount: out(a.amount) })) }))
  return {
    asOf, sections: { nonCurrentAssets: fmt(nonCurrentAssets), currentAssets: fmt(currentAssets), equity: fmt(equity), nonCurrentLiabilities: fmt(nonCurrentLiabilities), currentLiabilities: fmt(currentLiabilities) },
    totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, out(v)])),
    balanced: totals.assets === totals.equityAndLiabilities, difference: out(totals.assets - totals.equityAndLiabilities),
  }
}
async function positionAt(asOf) {
  const fy = fyStart(asOf)
  const [accts, splits] = await Promise.all([movements(fy, asOf), sql`
    SELECT l.account_id, coalesce(sum(l.debit - l.credit) FILTER (WHERE (e.entry_date - CASE WHEN e.entry_type = 'OB' THEN 1 ELSE 0 END) < ${fy}::date), 0) AS before_fy,
                         coalesce(sum(l.debit - l.credit) FILTER (WHERE (e.entry_date - CASE WHEN e.entry_type = 'OB' THEN 1 ELSE 0 END) >= ${fy}::date), 0) AS in_fy
    FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'Draft' AND (e.entry_date - CASE WHEN e.entry_type = 'OB' THEN 1 ELSE 0 END) <= ${asOf}::date
    GROUP BY l.account_id`])
  const by = new Map(splits.map((s) => [s.account_id, s]))
  for (const a of accts) { const s = by.get(a.id); a._beforeFy = s ? P(s.before_fy) : 0; a._inFy = s ? P(s.in_fy) : 0 }
  return positionFrom(accts, asOf)
}

// compare: 'yearend' (the 30 June before) | none
export async function balanceSheet(q = {}) {
  const asOf = isDate(q.asOf) ? q.asOf : today()
  const current = await positionAt(asOf)
  const comparison = q.compare === 'yearend' ? await positionAt(addDays(fyStart(asOf), -1)) : null
  return { ...current, comparison }
}

// ── Cash flows (indirect and direct) ───────────────────────────────────
// Every non-cash account's movement (credit - debit) is a cash effect; their sum is the change in cash.
export async function cashFlow(q = {}) {
  const { from, to } = range(q)
  const accts = await movements(from, to)
  const isCash = (a) => a.cash_flow_class === 'cash'
  const opening = accts.filter(isCash).reduce((s, a) => s + a.od - a.oc, 0)
  const change = accts.filter(isCash).reduce((s, a) => s + a.pd - a.pc, 0)
  const pl = accts.filter((a) => PL_TYPES.includes(a.type)).reduce((s, a) => s + a.xc - a.xd, 0)   // profit for the period
  const section = (cls) => {
    const lines = new Map()
    for (const a of accts.filter((x) => !isCash(x) && !PL_TYPES.includes(x.type) && (x.cash_flow_class || 'operating') === cls)) {
      const amount = a.xc - a.xd
      if (!amount) continue
      const key = a.fs_line || a.name
      if (!lines.has(key)) lines.set(key, { name: key, amount: 0, accounts: [] })
      const g = lines.get(key); g.amount += amount; g.accounts.push({ id: a.id, code: a.code, name: a.name, amount })
    }
    return [...lines.values()]
  }
  const operating = section('operating'), investing = section('investing'), financing = section('financing')
  const total = (ls) => ls.reduce((s, l) => s + l.amount, 0)
  const opTotal = pl + total(operating), invTotal = total(investing), finTotal = total(financing)
  // Direct method: in entries that touch cash, the other lines say where the money came from or went
  const direct = await sql`
    WITH cash_entries AS (
      SELECT DISTINCT l.entry_id FROM fin_lines l JOIN fin_accounts a ON a.id = l.account_id JOIN fin_entries e ON e.id = l.entry_id
      WHERE a.cash_flow_class = 'cash' AND e.status <> 'Draft' AND (e.entry_date - CASE WHEN e.entry_type = 'OB' THEN 1 ELSE 0 END) BETWEEN ${from}::date AND ${to}::date)
    SELECT a.id, a.code, a.name, a.type, coalesce(a.cash_flow_class, 'operating') AS cls,
           sum(l.credit - l.debit) AS amount
    FROM fin_lines l JOIN cash_entries c ON c.entry_id = l.entry_id JOIN fin_accounts a ON a.id = l.account_id
    WHERE coalesce(a.cash_flow_class, '') <> 'cash'
    GROUP BY a.id ORDER BY a.code`
  const directRows = direct.map((d) => ({ id: d.id, code: d.code, name: d.name, class: PL_TYPES.includes(d.type) ? 'operating' : d.cls, amount: P(d.amount) })).filter((d) => d.amount)
  const fmt = (ls) => ls.map((l) => ({ ...l, amount: out(l.amount), accounts: l.accounts.map((a) => ({ ...a, amount: out(a.amount) })) }))
  return {
    from, to, profit: out(pl),
    operating: fmt(operating), investing: fmt(investing), financing: fmt(financing),
    totals: { operating: out(opTotal), investing: out(invTotal), financing: out(finTotal), net: out(opTotal + invTotal + finTotal) },
    openingCash: out(opening), closingCash: out(opening + change), change: out(change),
    reconciles: opTotal + invTotal + finTotal === change,
    direct: {
      receipts: directRows.filter((d) => d.amount > 0).map((d) => ({ ...d, amount: out(d.amount) })),
      payments: directRows.filter((d) => d.amount < 0).map((d) => ({ ...d, amount: out(d.amount) })),
      net: out(directRows.reduce((s, d) => s + d.amount, 0)),
    },
  }
}

// ── Changes in equity ──────────────────────────────────────────────────
// Columns: share capital, retained earnings (including unclosed profit), total
export async function changesInEquity(q = {}) {
  const { from, to } = range(q)
  const accts = await movements(from, to)
  const isCapital = (a) => a.type === 'equity' && (a.system_key === 'share_capital' || a.fs_line === 'Share capital')
  const isRe = (a) => a.type === 'equity' && !isCapital(a)
  const credit = (list, open) => list.reduce((s, a) => s + (open ? a.oc - a.od : a.pc - a.pd), 0)
  const pl = accts.filter((a) => PL_TYPES.includes(a.type))
  const openingCapital = credit(accts.filter(isCapital), true)
  const openingRe = credit(accts.filter(isRe), true) + credit(pl, true)
  // Year-end closing entries (CL) only move profit into retained earnings, so both are measured without them
  const xcredit = (list) => list.reduce((s, a) => s + a.xc - a.xd, 0)
  const profit = xcredit(pl)
  const capitalMoves = xcredit(accts.filter(isCapital))
  const reMoves = xcredit(accts.filter(isRe))
  const rows = [
    { label: `Balance at ${from}`, capital: openingCapital, retained: openingRe },
    { label: 'Profit for the period', capital: 0, retained: profit },
    { label: 'Share capital issued / (reduced)', capital: capitalMoves, retained: 0 },
    { label: 'Other movements (prior-period adjustments, dividends)', capital: 0, retained: reMoves },
  ]
  const closing = { label: `Balance at ${to}`, capital: rows.reduce((s, r) => s + r.capital, 0), retained: rows.reduce((s, r) => s + r.retained, 0) }
  const fmt = (r) => ({ label: r.label, capital: out(r.capital), retained: out(r.retained), total: out(r.capital + r.retained) })
  return { from, to, rows: rows.map(fmt), closing: fmt(closing), profit: out(profit), changeInEquity: out(closing.capital + closing.retained - openingCapital - openingRe) }
}

// ── Party statement: what we owe a supplier or staff member (or they owe us) ──
// Lines on the party balance accounts (payables, wages, advances); positive = we owe them.
// Cash and bank lines also carry the party for tracing, but they aren't a balance with that party.
const PARTY_ACCOUNTS = ['ap_suppliers', 'ap_staff_claims', 'wages_payable', 'staff_advances']
export async function partyStatement(partyType, partyId, q = {}) {
  if (!['supplier', 'staff'].includes(partyType)) throw new HttpError(400, 'Statements are for suppliers and staff')
  const { from, to } = range(q)
  const id = String(partyId)
  const [[o], lines] = await Promise.all([
    sql`SELECT coalesce(sum(l.credit - l.debit), 0) AS net FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id
        JOIN fin_accounts a ON a.id = l.account_id AND a.system_key = ANY(${PARTY_ACCOUNTS})
        WHERE l.party_type = ${partyType} AND l.party_id = ${id} AND e.status <> 'Draft' AND e.entry_date < ${from}::date`,
    sql`SELECT l.id, l.debit, l.credit, l.description, a.code, a.name AS account_name,
               e.id AS entry_id, e.entry_no, e.entry_type, e.entry_date::text AS entry_date, e.memo
        FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id
        JOIN fin_accounts a ON a.id = l.account_id AND a.system_key = ANY(${PARTY_ACCOUNTS})
        WHERE l.party_type = ${partyType} AND l.party_id = ${id} AND e.status <> 'Draft' AND e.entry_date BETWEEN ${from}::date AND ${to}::date
        ORDER BY e.entry_date, e.id, l.line_no LIMIT 5000`,
  ])
  let bal = P(o.net)
  const rows = lines.map((l) => {
    bal += P(l.credit) - P(l.debit)
    return { id: l.id, entryId: l.entry_id, entryNo: l.entry_no, date: l.entry_date, memo: l.memo || '', description: l.description || '',
      account: `${l.code} ${l.account_name}`, debit: out(P(l.debit)), credit: out(P(l.credit)), balance: out(bal) }
  })
  return { from, to, partyType, partyId: id, opening: out(P(o.net)), closing: out(bal), lines: rows }
}

// ── Spending: by category, month, supplier, collection; the largest bills ──
// From posted lines on cost accounts (expenses, payroll, claims; reversals net out)
export async function expenseReport(q = {}) {
  const { from, to } = range(q)
  const base = sql`
    FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'Draft' AND e.entry_type NOT IN ('CL', 'OB')
    JOIN fin_accounts a ON a.id = l.account_id AND a.type IN ('expense', 'cogs')
    WHERE e.entry_date BETWEEN ${from}::date AND ${to}::date`
  const [byAccount, byMonth, bySupplier, byCollection, top] = await Promise.all([
    sql`SELECT a.id, a.code, a.name, a.type, sum(l.debit - l.credit) AS amount ${base} GROUP BY a.id HAVING sum(l.debit - l.credit) <> 0 ORDER BY a.code`,
    sql`SELECT to_char(e.entry_date, 'YYYY-MM') AS month, a.type, sum(l.debit - l.credit) AS amount ${base} GROUP BY 1, 2 ORDER BY 1`,
    sql`SELECT s.id, s.name, sum(t.amount) AS amount FROM (SELECT l.party_id, l.debit - l.credit AS amount ${base} AND l.party_type = 'supplier') t
        JOIN fin_suppliers s ON s.id::text = t.party_id GROUP BY s.id, s.name HAVING sum(t.amount) <> 0 ORDER BY 3 DESC`,
    sql`SELECT c.id, c.name, sum(t.amount) AS amount FROM (SELECT l.collection_id, l.debit - l.credit AS amount ${base} AND l.collection_id IS NOT NULL) t
        JOIN collections c ON c.id = t.collection_id GROUP BY c.id, c.name HAVING sum(t.amount) <> 0 ORDER BY 3 DESC`,
    sql`SELECT x.id, x.expense_date::text AS date, x.amount, x.description, s.name AS supplier, a.code, a.name AS account_name
        FROM fin_expenses x JOIN fin_accounts a ON a.id = x.account_id LEFT JOIN fin_suppliers s ON s.id = x.supplier_id
        WHERE x.status = 'Posted' AND x.expense_date BETWEEN ${from}::date AND ${to}::date ORDER BY x.amount DESC, x.id LIMIT 10`,
  ])
  const months = new Map()
  for (const r of byMonth) {
    const m = months.get(r.month) || { month: r.month, cogs: 0, expense: 0 }
    m[r.type] += P(r.amount); months.set(r.month, m)
  }
  const total = byAccount.reduce((s, r) => s + P(r.amount), 0)
  return {
    from, to, total: out(total),
    byAccount: byAccount.map((r) => ({ id: r.id, code: r.code, name: r.name, type: r.type, amount: out(P(r.amount)) })),
    byMonth: [...months.values()].map((m) => ({ month: m.month, cogs: out(m.cogs), expense: out(m.expense), total: out(m.cogs + m.expense) })),
    bySupplier: bySupplier.map((r) => ({ id: r.id, name: r.name, amount: out(P(r.amount)) })),
    byCollection: byCollection.map((r) => ({ id: r.id, name: r.name, amount: out(P(r.amount)) })),
    top: top.map((r) => ({ id: r.id, date: r.date, amount: out(P(r.amount)), description: r.description || '', supplier: r.supplier || '', account: `${r.code} ${r.account_name}` })),
  }
}
