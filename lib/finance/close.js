// Finance F6: month-end and year-end close.
//   * recurring and accrual journals (an accrual reverses itself on the 1st of the next month);
//   * exchange revaluation (IAS 21): foreign-currency reseller balances at the closing rate, the
//     difference unrealised (4920 / 6991) and reversed on the 1st, so the payment books the real one;
//   * expected credit losses (IFRS 9 simplified approach): receivables aged first-in first-out from the
//     ledger, a loss rate per age bucket, and 1250 moved to that allowance against 6960;
//   * provisions and contingencies (IAS 37);
//   * the month-end checklist (spec 6.7 and 9.5), closing a month, and the year-end close: income and
//     cost accounts zeroed into retained earnings (CL entry, 30 June, adjustment period).
// Every month-end job works out the entry it wants and replaces the posted one only if it differs.
import { neon } from '@neondatabase/serverless'
import { HttpError, blank } from '../db.js'
import { toPaisa, fromPaisa } from './money.js'
import {
  accountBySystemKey, getSettings, updateSettings, replaceEntry, entryState, createEntry, reverseEntry, getEntry,
  listPeriods, setPeriodStatus, addFiscalYear,
} from './ledger.js'
import { payAccount, day, isDate, today, amountPaisa, generateRecurring } from './expenses.js'
import { rateOn, listExceptions } from './sales.js'
import { isMonth, monthEnd, addMonths, ym, depreciationState, postDepreciation, assetSuggestions, listAssets, CATEGORIES } from './assets.js'
import { valuationState, postValuation } from './stock.js'

let _sql
const db = () => (_sql ??= neon(process.env.DATABASE_URL))
const sql = (...args) => db()(...args)
const P = (v) => toPaisa(v ?? 0)
const money = (p) => fromPaisa(Math.round(p))
const amt = (p) => fromPaisa(Math.abs(p))
const signed = (accountId, p, extra = {}) => ({ accountId, debit: p > 0 ? amt(p) : '0', credit: p < 0 ? amt(p) : '0', ...extra })
const monthName = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
function checkMonthForJob(month, goLiveDate) {
  if (!isMonth(month)) throw new HttpError(400, 'Choose the month')
  if (monthEnd(month) < goLiveDate) throw new HttpError(400, `${month} is before go-live`)
  if (`${month}-01` > today()) throw new HttpError(400, 'That month has not started yet')
}

// ── Recurring and accrual journals ─────────────────────────────────────
const rowToRecurring = (r) => ({
  id: r.id, name: r.name, memo: r.memo || '', lines: r.lines, autoReverse: r.auto_reverse, startsMonth: r.starts_month, endsMonth: r.ends_month || '',
  isActive: r.is_active, lastMonth: r.last_month || '', total: money(r.lines.reduce((s, l) => s + P(l.debit || 0), 0)),
})
export async function listRecurringJournals() {
  const rows = await sql`SELECT r.*, (SELECT max(e.source_id) FROM fin_entries e WHERE e.source_type = 'recurring_journal' AND e.source_event = r.id::text AND e.status = 'Posted') AS last_month
    FROM fin_recurring_journals r ORDER BY r.is_active DESC, r.name`
  return rows.map(rowToRecurring)
}
export async function saveRecurringJournal(id, b, user) {
  const name = blank(b.name)
  if (!name) throw new HttpError(400, 'Name the journal')
  if (!isMonth(b.startsMonth)) throw new HttpError(400, 'Choose the first month')
  if (b.endsMonth && (!isMonth(b.endsMonth) || b.endsMonth < b.startsMonth)) throw new HttpError(400, 'The last month is before the first')
  const lines = (b.lines || []).filter((l) => l.accountId && (P(l.debit || 0) || P(l.credit || 0))).map((l, i) => {
    let d, c
    try { d = toPaisa(l.debit || 0); c = toPaisa(l.credit || 0) } catch (err) { throw new HttpError(400, `Line ${i + 1}: ${err.message}`) }
    if (d < 0 || c < 0 || (d > 0) === (c > 0)) throw new HttpError(400, `Line ${i + 1}: enter either a debit or a credit`)
    return { accountId: Number(l.accountId), debit: fromPaisa(d), credit: fromPaisa(c), description: blank(l.description) }
  })
  if (lines.length < 2) throw new HttpError(400, 'A journal needs at least two lines')
  const d = lines.reduce((s, l) => s + P(l.debit), 0), c = lines.reduce((s, l) => s + P(l.credit), 0)
  if (d !== c) throw new HttpError(400, `Debits (${money(d)}) and credits (${money(c)}) must be equal`)
  const accts = await sql`SELECT id, code, name, is_control, is_active FROM fin_accounts WHERE id = ANY(${lines.map((l) => l.accountId)}::int[])`
  for (const l of lines) {
    const a = accts.find((x) => x.id === l.accountId)
    if (!a) throw new HttpError(400, 'Unknown account')
    if (a.is_control) throw new HttpError(400, `${a.code} ${a.name} is kept by the system and can't be used in a journal`)
    if (!a.is_active) throw new HttpError(400, `${a.code} ${a.name} is not active`)
  }
  const v = { name, memo: blank(b.memo), lines: JSON.stringify(lines), auto: !!b.autoReverse, s: b.startsMonth, e: blank(b.endsMonth), active: b.isActive !== false }
  if (id) {
    const [r] = await sql`UPDATE fin_recurring_journals SET name = ${v.name}, memo = ${v.memo}, lines = ${v.lines}::jsonb, auto_reverse = ${v.auto},
      starts_month = ${v.s}, ends_month = ${v.e}, is_active = ${v.active} WHERE id = ${Number(id)} RETURNING id`
    if (!r) throw new HttpError(404, 'Journal not found')
  } else {
    await sql`INSERT INTO fin_recurring_journals (name, memo, lines, auto_reverse, starts_month, ends_month, is_active, created_by)
      VALUES (${v.name}, ${v.memo}, ${v.lines}::jsonb, ${v.auto}, ${v.s}, ${v.e}, ${v.active}, ${user?.id ?? null})`
  }
  return listRecurringJournals()
}
const dueJournals = (month) => sql`SELECT * FROM fin_recurring_journals WHERE is_active AND starts_month <= ${month} AND (ends_month IS NULL OR ends_month >= ${month}) ORDER BY id`
// Source: ('recurring_journal', month, id) and its reversal ('recurring_journal', month, 'id:reverse')
export async function generateJournals({ month } = {}, user) {
  checkMonthForJob(month, (await getSettings()).goLiveDate)
  const posted = [], failed = []
  for (const r of await dueJournals(month)) {
    try {
      const memo = `${r.name} ${monthName(month)}${r.memo ? `: ${r.memo}` : ''}`
      const { entry } = await replaceEntry({ source: { type: 'recurring_journal', id: month, event: String(r.id) }, date: monthEnd(month), memo, lines: r.lines,
        reason: 'Journal changed' }, user)
      if (r.auto_reverse) {
        const back = r.lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }))
        await replaceEntry({ source: { type: 'recurring_journal', id: month, event: `${r.id}:reverse` }, date: `${addMonths(month, 1)}-01`,
          memo: `Reversal of ${entry.entryNo}: ${r.name} ${monthName(month)}`, lines: back, reason: 'Journal changed' }, user)
      }
      posted.push({ id: r.id, name: r.name, entryNo: entry.entryNo })
    } catch (err) { failed.push({ id: r.id, name: r.name, error: err.message }) }
  }
  return { month, posted, failed }
}
async function journalsState(month) {
  const due = await dueJournals(month)
  const missing = []
  for (const r of due) {
    const s = await entryState({ type: 'recurring_journal', id: month, event: String(r.id) }, r.lines, monthEnd(month))
    if (!s.current) missing.push(r.name)
  }
  return { due: due.length, missing }
}

// ── Exchange revaluation (IAS 21) ──────────────────────────────────────
// Per reseller in a foreign currency: what they owe in that currency × the closing rate, against what
// the receivable stands at in rupees (leaving out this month's own revaluation)
export async function revaluationFor(month) {
  if (!isMonth(month)) throw new HttpError(400, 'Choose the month')
  const asOf = monthEnd(month)
  const [ar, gain, loss] = await Promise.all([accountBySystemKey('ar_resellers'), accountBySystemKey('fx_gain_unrealised'), accountBySystemKey('fx_loss_unrealised')])
  const rows = await sql`
    SELECT r.id, r.name, r.currency,
      coalesce(sum(CASE WHEN l.currency = r.currency THEN sign(l.debit - l.credit) * l.amount_fc END), 0) AS fc,
      coalesce(sum(l.debit - l.credit), 0) AS pkr
    FROM resellers r JOIN fin_lines l ON l.party_type = 'reseller' AND l.party_id = r.id::text AND l.account_id = ${ar.id}
    JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'Draft' AND e.entry_date <= ${asOf}::date
    WHERE r.currency <> 'PKR'
      AND NOT (e.source_type = 'fx_reval' AND e.source_id = ${month})
      AND (e.reversal_of IS NULL OR e.reversal_of NOT IN (SELECT id FROM fin_entries WHERE source_type = 'fx_reval' AND source_id = ${month}))
    GROUP BY r.id ORDER BY r.name`
  const items = [], lines = [], missingRates = []
  for (const r of rows) {
    let rate
    try { rate = await rateOn(r.currency, asOf) } catch { missingRates.push(r.currency); continue }
    const target = Math.round(Number(r.fc) * 100 * rate)
    const diff = target - P(r.pkr)
    items.push({ resellerId: r.id, name: r.name, currency: r.currency, owedFc: Number(r.fc).toFixed(2), rate, booked: money(P(r.pkr)), atClosingRate: money(target), difference: money(diff) })
    if (!diff) continue
    const tag = { partyType: 'reseller', partyId: String(r.id), description: `${r.name}: ${Number(r.fc).toFixed(2)} ${r.currency} at ${rate}` }
    lines.push(signed(ar.id, diff, tag), signed(diff > 0 ? gain.id : loss.id, -diff, tag))
  }
  return { month, asOf, items, lines, missingRates: [...new Set(missingRates)], net: money(items.reduce((s, i) => s + P(i.difference), 0)) }
}
export async function postRevaluation({ month } = {}, user) {
  checkMonthForJob(month, (await getSettings()).goLiveDate)
  // Balances in a currency with no rate yet are left out (the checklist keeps the item open)
  const r = await revaluationFor(month)
  const { entry } = await replaceEntry({ source: { type: 'fx_reval', id: month, event: 'closing' }, date: r.asOf, memo: `Exchange revaluation ${monthName(month)}`, lines: r.lines, reason: 'Revalued again' }, user)
  const back = r.lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }))
  await replaceEntry({ source: { type: 'fx_reval', id: month, event: 'reverse' }, date: `${addMonths(month, 1)}-01`,
    memo: `Reversal of the ${monthName(month)} exchange revaluation`, lines: back, reason: 'Revalued again' }, user)
  return { ...r, entryId: entry?.id ?? null, entryNo: entry?.entryNo ?? null }
}

// ── Expected credit losses (IFRS 9) ────────────────────────────────────
const BUCKETS = [['b30', '0-30 days', 0, 30], ['b60', '31-60 days', 31, 60], ['b90', '61-90 days', 61, 90], ['b90p', 'Over 90 days', 91, Infinity]]
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000)
// What each customer and reseller owes at a date, by age: payments clear the oldest amounts first
export async function ageingAt(asOf) {
  const [cu, re] = await Promise.all([accountBySystemKey('ar_customers'), accountBySystemKey('ar_resellers')])
  const rows = await sql`
    SELECT l.party_type, l.party_id, e.entry_date::text AS d, l.debit, l.credit,
      coalesce(c.name, r.name, l.party_id) AS name
    FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'Draft' AND e.entry_date <= ${asOf}::date
    LEFT JOIN customers c ON l.party_type = 'customer' AND c.id::text = l.party_id
    LEFT JOIN resellers r ON l.party_type = 'reseller' AND r.id::text = l.party_id
    WHERE l.account_id IN (${cu.id}, ${re.id}) AND l.party_id IS NOT NULL
    ORDER BY e.entry_date, l.id`
  const parties = new Map()
  for (const l of rows) {
    const k = `${l.party_type}:${l.party_id}`
    if (!parties.has(k)) parties.set(k, { partyType: l.party_type, partyId: l.party_id, name: l.name, debits: [], credit: 0 })
    const p = parties.get(k)
    if (P(l.debit)) p.debits.push({ d: l.d, a: P(l.debit) })
    p.credit += P(l.credit)
  }
  const out = []
  for (const p of parties.values()) {
    let credit = p.credit
    const b = { b30: 0, b60: 0, b90: 0, b90p: 0 }
    for (const x of p.debits) {
      const used = Math.min(credit, x.a); credit -= used
      const left = x.a - used
      if (!left) continue
      const age = daysBetween(x.d, asOf)
      b[BUCKETS.find(([, , lo, hi]) => age >= lo && age <= hi)[0]] += left
    }
    const total = b.b30 + b.b60 + b.b90 + b.b90p
    if (total > 0) out.push({ ...p, buckets: b, total })
  }
  return out.sort((a, b) => b.total - a.total)
}
export async function allowanceFor(month) {
  if (!isMonth(month)) throw new HttpError(400, 'Choose the month')
  const asOf = monthEnd(month)
  const [{ eclRates }, ageing, allowance, expense] = await Promise.all([getSettings(), ageingAt(asOf), accountBySystemKey('ecl_allowance'), accountBySystemKey('ecl_expense')])
  const totals = { b30: 0, b60: 0, b90: 0, b90p: 0 }
  for (const p of ageing) for (const k of Object.keys(totals)) totals[k] += p.buckets[k]
  const target = Object.keys(totals).reduce((s, k) => s + Math.round((totals[k] * Number(eclRates[k] || 0)) / 100), 0)
  const [cur] = await sql`
    SELECT coalesce(sum(l.credit - l.debit), 0) AS n FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'Draft'
    WHERE l.account_id = ${allowance.id} AND e.entry_date <= ${asOf}::date
      AND NOT (e.source_type = 'ecl' AND e.source_id = ${month})
      AND (e.reversal_of IS NULL OR e.reversal_of NOT IN (SELECT id FROM fin_entries WHERE source_type = 'ecl' AND source_id = ${month}))`
  const diff = target - P(cur.n)
  const lines = diff ? [signed(expense.id, diff, { description: 'Expected credit losses' }), signed(allowance.id, -diff, { description: `Allowance at ${asOf}: ${money(target)}` })] : []
  return {
    month, asOf, rates: eclRates, lines, target: money(target), booked: money(P(cur.n)), change: money(diff),
    buckets: BUCKETS.map(([k, label]) => ({ key: k, label, owed: money(totals[k]), rate: Number(eclRates[k] || 0), allowance: money(Math.round((totals[k] * Number(eclRates[k] || 0)) / 100)) })),
    parties: ageing.map((p) => ({ partyType: p.partyType, partyId: p.partyId, name: p.name, total: money(p.total), ...Object.fromEntries(Object.entries(p.buckets).map(([k, v]) => [k, money(v)])) })),
  }
}
export async function postAllowance({ month } = {}, user) {
  checkMonthForJob(month, (await getSettings()).goLiveDate)
  const a = await allowanceFor(month)
  const { entry } = await replaceEntry({ source: { type: 'ecl', id: month, event: 'closing' }, date: a.asOf, memo: `Expected credit losses ${monthName(month)}`, lines: a.lines, reason: 'Allowance worked out again' }, user)
  return { ...a, entryId: entry?.id ?? null, entryNo: entry?.entryNo ?? null }
}
export const setLossRates = (rates) => updateSettings({ eclRates: rates })

// ── Provisions (IAS 37) ────────────────────────────────────────────────
export async function listProvisions() {
  const [provs, moves] = await Promise.all([
    sql`SELECT p.*, a.code, a.name AS account_name FROM fin_provisions p LEFT JOIN fin_accounts a ON a.id = p.expense_account_id ORDER BY p.status, p.created_at DESC`,
    sql`SELECT m.*, e.entry_no FROM fin_provision_moves m LEFT JOIN fin_entries e ON e.id = m.entry_id ORDER BY m.moved_on, m.id`,
  ])
  return provs.map((p) => {
    const ms = moves.filter((m) => m.provision_id === p.id)
    const balance = ms.filter((m) => m.status === 'Posted').reduce((s, m) => s + (m.kind === 'recognise' ? P(m.amount) : -P(m.amount)), 0)
    return { id: p.id, name: p.name, kind: p.kind, expenseAccountId: p.expense_account_id, account: p.code ? `${p.code} ${p.account_name}` : '', disclosure: p.disclosure || '',
      status: p.status, balance: money(balance),
      moves: ms.map((m) => ({ id: m.id, kind: m.kind, date: day(m.moved_on), amount: money(P(m.amount)), paidFrom: m.paid_from, note: m.note || '', entryId: m.entry_id, entryNo: m.entry_no || '', status: m.status })) }
  })
}
export async function saveProvision(id, b) {
  const name = blank(b.name)
  if (!name) throw new HttpError(400, 'Name the provision')
  if (!['provision', 'contingency'].includes(b.kind)) throw new HttpError(400, 'Provision (booked) or contingency (disclosed only)?')
  let acc = null
  if (b.kind === 'provision') {
    const [a] = await sql`SELECT id, type, is_control FROM fin_accounts WHERE id = ${Number(b.expenseAccountId) || 0}`
    if (!a || !['expense', 'cogs'].includes(a.type) || a.is_control) throw new HttpError(400, 'Choose the expense it is charged to')
    acc = a.id
  }
  if (id) {
    const [p] = await sql`UPDATE fin_provisions SET name = ${name}, disclosure = ${blank(b.disclosure)}, status = ${b.status === 'Settled' ? 'Settled' : 'Open'},
      expense_account_id = coalesce(${acc}::int, expense_account_id) WHERE id = ${Number(id)} RETURNING id`
    if (!p) throw new HttpError(404, 'Provision not found')
  } else {
    await sql`INSERT INTO fin_provisions (name, kind, expense_account_id, disclosure) VALUES (${name}, ${b.kind}, ${acc}::int, ${blank(b.disclosure)})`
  }
  return listProvisions()
}
// recognise: Dr expense Cr 2700 · use: Dr 2700 Cr bank / cash · release: Dr 2700 Cr expense
export async function addProvisionMove(provisionId, b, user) {
  const [p] = await sql`SELECT * FROM fin_provisions WHERE id = ${Number(provisionId) || 0}`
  if (!p) throw new HttpError(404, 'Provision not found')
  if (p.kind !== 'provision') throw new HttpError(400, 'A contingency is only disclosed; nothing is booked')
  if (!['recognise', 'use', 'release'].includes(b.kind)) throw new HttpError(400, 'Book, use or release?')
  if (!isDate(b.date)) throw new HttpError(400, 'Choose the date')
  const amount = amountPaisa(b.amount)
  const balance = P((await listProvisions()).find((x) => x.id === p.id).balance)
  if (b.kind !== 'recognise' && amount > balance) throw new HttpError(400, `Only ${money(balance)} is held in this provision`)
  const prov = (await accountBySystemKey('provisions')).id
  const other = b.kind === 'use' ? await payAccount(b.paidFrom) : p.expense_account_id
  if (b.kind === 'use' && b.paidFrom === 'unpaid') throw new HttpError(400, 'Say how it was paid')
  const [m] = await sql`INSERT INTO fin_provision_moves (provision_id, kind, moved_on, amount, paid_from, note, created_by)
    VALUES (${p.id}, ${b.kind}, ${b.date}::date, ${fromPaisa(amount)}::numeric, ${b.kind === 'use' ? b.paidFrom : null}, ${blank(b.note)}, ${user?.id ?? null}) RETURNING id`
  const text = `${p.name}${blank(b.note) ? `: ${blank(b.note)}` : ''}`
  const lines = b.kind === 'recognise'
    ? [{ accountId: other, debit: fromPaisa(amount), description: text }, { accountId: prov, credit: fromPaisa(amount), description: text }]
    : [{ accountId: prov, debit: fromPaisa(amount), description: text }, { accountId: other, credit: fromPaisa(amount), description: text }]
  try {
    const e = await createEntry({ date: b.date, entryType: 'JV', post: true, memo: `Provision ${b.kind === 'recognise' ? 'booked' : b.kind === 'use' ? 'used' : 'released'}: ${text}`,
      source: { type: 'provision_move', id: m.id, event: b.kind }, lines }, user)
    await sql`UPDATE fin_provision_moves SET entry_id = ${e.id} WHERE id = ${m.id}`
  } catch (err) { await sql`DELETE FROM fin_provision_moves WHERE id = ${m.id}`; throw err }
  return listProvisions()
}
export async function voidProvisionMove(id, { reason } = {}, user) {
  const [m] = await sql`SELECT * FROM fin_provision_moves WHERE id = ${Number(id) || 0}`
  if (!m || m.status !== 'Posted') throw new HttpError(404, 'Movement not found')
  if (!blank(reason)) throw new HttpError(400, 'Say why it is being undone')
  if (m.entry_id) await reverseEntry(m.entry_id, { reason }, user)
  await sql`UPDATE fin_provision_moves SET status = 'Void' WHERE id = ${m.id}`
  return listProvisions()
}

// ── Month-end checklist ────────────────────────────────────────────────
// Each item: { key, group, label, status: done | todo | warn | na, detail, link, job, manual, blocking }
const MANUAL = {
  cash: 'Petty cash counted and agrees to 1100',
  trax: 'Trax COD and settlements checked against the courier\'s invoices',
  resellers: 'Reseller statements for the month entered (sold pieces)',
  provisions: 'Provisions and contingencies reviewed',
}
async function periodOf(month) {
  const p = (await listPeriods()).find((x) => !x.isAdjustment && x.startsOn === `${month}-01`)
  if (!p) throw new HttpError(400, `There is no accounting period for ${month}`)
  return p
}
const rec = async (periodId) => (await sql`SELECT * FROM fin_close_checklists WHERE period_id = ${periodId}`)[0] || null

export async function checklist(month) {
  const p = await periodOf(month)
  const from = `${month}-01`, asOf = monthEnd(month)
  const r = await rec(p.id)
  const ticks = r?.ticks || {}
  const settings = await getSettings()
  const items = []
  const add = (key, group, label, status, detail = '', extra = {}) => items.push({ key, group, label, status, detail, blocking: true, ...extra })
  const safe = async (fn) => { try { return await fn() } catch (err) { return { error: err.message } } }

  // Books complete
  const exc = await listExceptions()
  add('exceptions', 'Books complete', 'Sales and receipts posted (no posting problems)', exc.length ? 'todo' : 'done',
    exc.length ? `${exc.length} order or reseller posting${exc.length === 1 ? '' : 's'} failed` : '', { link: '/finance/sales' })
  const [drafts] = await sql`SELECT count(*)::int AS n FROM fin_entries WHERE status = 'Draft' AND entry_date BETWEEN ${from}::date AND ${asOf}::date`
  add('drafts', 'Books complete', 'No draft journals left in the month', drafts.n ? 'warn' : 'done', drafts.n ? `${drafts.n} draft${drafts.n === 1 ? '' : 's'}` : '', { link: '/finance/journals', blocking: false })
  const [inbox] = await sql`SELECT count(*)::int AS n FROM fin_intake_items WHERE status IN ('New', 'Ready', 'Needs attention')`
  add('inbox', 'Books complete', 'Inbox cleared (receipts and screenshots)', inbox.n ? 'warn' : 'done', inbox.n ? `${inbox.n} waiting` : '', { link: '/finance/inbox', blocking: false })
  const bills = await sql`SELECT r.name FROM fin_recurring r WHERE r.is_active
    AND NOT EXISTS (SELECT 1 FROM fin_expenses x WHERE x.recurring_id = r.id AND x.recurring_month = ${month} AND x.status <> 'Void')`
  add('bills', 'Books complete', 'Recurring bills booked', bills.length ? 'todo' : 'done', bills.map((b) => b.name).join(', '), { link: '/finance/expenses', job: 'bills' })
  const claims = await sql`SELECT count(*)::int AS n FROM fin_claims WHERE status = 'Submitted' AND week_ending <= ${asOf}::date`
  add('claims', 'Books complete', 'Studio claims for the month approved', claims[0].n ? 'todo' : 'done', claims[0].n ? `${claims[0].n} waiting for approval` : '', { link: '/finance/claims' })
  // Payroll: every week ending (Saturday) in the month posted; a week running over the month end is a warning
  const sats = []
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= asOf; d.setUTCDate(d.getUTCDate() + 1)) if (d.getUTCDay() === 6) sats.push(d.toISOString().slice(0, 10))
  const runs = await sql`SELECT week_ending::text AS w, status FROM fin_payroll_runs WHERE week_ending BETWEEN ${from}::date AND (${asOf}::date + 6)`
  const posted = new Set(runs.filter((x) => x.status === 'Posted').map((x) => x.w))
  const [{ staff }] = await sql`SELECT count(*)::int AS staff FROM fin_staff WHERE is_active`
  const missingWeeks = staff ? sats.filter((s) => !posted.has(s)) : []
  add('payroll', 'Books complete', 'Payroll posted for every week ending in the month', missingWeeks.length ? 'todo' : 'done',
    missingWeeks.length ? `Not posted: weeks ending ${missingWeeks.join(', ')}` : '', { link: '/finance/payroll' })
  const lastSat = sats[sats.length - 1]
  if (staff && lastSat && lastSat < asOf) {
    const next = new Date(`${lastSat}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 7)
    const w = next.toISOString().slice(0, 10)
    add('payroll_cross', 'Books complete', 'Wages for the last days of the month (IAS 19)', posted.has(w) ? 'done' : 'warn',
      posted.has(w) ? '' : `The week ending ${w} runs over the month end; until it is posted, its days in ${monthName(month)} are not in the books`, { link: '/finance/payroll', blocking: false })
  }
  add('resellers', 'Books complete', MANUAL.resellers, ticks.resellers ? 'done' : 'todo', '', { manual: true })

  // Cash and bank
  const stmts = await sql`SELECT s.id, s.status, s.period_from::text AS f, s.period_to::text AS t, a.code FROM fin_bank_statements s JOIN fin_accounts a ON a.id = s.account_id
    WHERE s.period_from <= ${asOf}::date AND s.period_to >= ${asOf}::date`
  const stmt = stmts[0]
  add('bank', 'Cash and bank', 'Bank reconciled to the month-end statement', stmt?.status === 'Reconciled' ? 'done' : 'todo',
    !stmt ? `No statement imported covering ${asOf}` : stmt.status !== 'Reconciled' ? `Statement ${stmt.f} to ${stmt.t} not marked reconciled` : '', { link: stmt ? `/finance/bank/${stmt.id}` : '/finance/bank' })
  add('cash', 'Cash and bank', MANUAL.cash, ticks.cash ? 'done' : 'todo', '', { manual: true })
  add('trax', 'Cash and bank', MANUAL.trax, ticks.trax ? 'done' : 'todo', 'Trax settlement import is not built yet', { manual: true })

  // Month-end entries
  const state = (s, okText) => (s.error ? ['todo', s.error] : s.current ? ['done', okText] : ['todo', s.posted ? 'Posted, but the figures have changed since: run it again' : 'Not posted yet'])
  const jr = await journalsState(month)
  add('journals', 'Month-end entries', 'Recurring and accrual journals', jr.missing.length ? 'todo' : jr.due ? 'done' : 'na', jr.missing.length ? `Not posted: ${jr.missing.join(', ')}` : jr.due ? '' : 'None set up', { job: 'journals', tab: 'journals' })
  const dep = await safe(() => depreciationState(month))
  const [ds, dd] = state(dep, dep.total && P(dep.total) ? `Rs ${dep.total}` : '')
  add('depreciation', 'Month-end entries', 'Depreciation of fixed assets', !dep.error && !dep.items?.length && !dep.posted ? 'na' : ds, !dep.error && !dep.items?.length && !dep.posted ? 'Nothing to depreciate' : dd, { job: 'depreciation', tab: 'assets' })
  const fx = await safe(() => revaluationFor(month))
  if (fx.error || fx.missingRates?.length) add('fx', 'Month-end entries', 'Exchange revaluation of reseller balances', 'todo', fx.error || `Add the ${fx.missingRates.join(', ')} rate on or before ${asOf}`, { link: '/finance/sales', job: 'fx' })
  else {
    const s = await entryState({ type: 'fx_reval', id: month, event: 'closing' }, fx.lines, asOf)
    const [fs, fd] = state(s, fx.items.length ? `Net ${fx.net}` : '')
    add('fx', 'Month-end entries', 'Exchange revaluation of reseller balances', !fx.items.length && !s.posted ? 'na' : fs, !fx.items.length && !s.posted ? 'No foreign-currency balances' : fd, { job: 'fx' })
  }
  const ecl = await safe(() => allowanceFor(month))
  if (ecl.error) add('ecl', 'Month-end entries', 'Allowance for expected credit losses', 'todo', ecl.error, { job: 'ecl' })
  else {
    const s = await entryState({ type: 'ecl', id: month, event: 'closing' }, ecl.lines, asOf)
    add('ecl', 'Month-end entries', 'Allowance for expected credit losses', s.current ? 'done' : 'todo', s.current ? `Allowance Rs ${ecl.target}` : `Should be Rs ${ecl.target}; booked Rs ${ecl.booked}`, { job: 'ecl' })
  }
  const st = await safe(() => valuationState(month))
  const [ss, sd] = state(st, st.total ? `Rs ${st.total}` : '')
  add('stock', 'Month-end entries', 'Stock valued and posted', ss, [sd, st.missing?.length ? `${st.missing.length} design${st.missing.length === 1 ? '' : 's'} without a cost card count at zero` : ''].filter(Boolean).join(' · '), { job: 'stock', link: '/finance/costing' })

  // Review
  const sug = await assetSuggestions()
  const inMonth = sug.filter((x) => x.date <= asOf)
  add('assets', 'Review', 'Equipment bought is on the fixed asset register', inMonth.some((x) => x.onAssetAccount) ? 'todo' : inMonth.length ? 'warn' : 'done',
    inMonth.length ? `${inMonth.filter((x) => x.onAssetAccount).length} on an asset account but not registered; ${inMonth.filter((x) => !x.onAssetAccount).length} large expense${inMonth.length === 1 ? '' : 's'} to review` : '',
    { tab: 'assets', blocking: inMonth.some((x) => x.onAssetAccount) })
  const reg = await listAssets({ asOf })
  const ppeKeys = [...Object.values(CATEGORIES).map((c) => c.key), 'ppe_acc_depreciation']
  const [led] = await sql`SELECT coalesce(sum(l.debit - l.credit), 0) AS n FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'Draft'
    JOIN fin_accounts a ON a.id = l.account_id WHERE a.system_key = ANY(${ppeKeys}) AND e.entry_date <= ${asOf}::date`
  const regDiff = P(reg.totals.carrying) - P(led.n)
  add('register', 'Review', 'Fixed asset register agrees to the ledger (1500 to 1590)', regDiff ? 'warn' : 'done',
    regDiff ? `Register Rs ${reg.totals.carrying}, ledger Rs ${money(P(led.n))}: difference Rs ${money(regDiff)} (opening balances or an expense edited after registering)` : '', { tab: 'assets', blocking: false })
  add('provisions', 'Review', MANUAL.provisions, ticks.provisions ? 'done' : 'todo', '', { manual: true, tab: 'provisions', blocking: false })
  add('tax', 'Review', 'Tax summary reviewed (sales tax, withholding)', settings.taxEnabled ? 'todo' : 'na', settings.taxEnabled ? '' : 'Tax is switched off (Phase F7)', { blocking: false })

  const open = items.filter((i) => i.blocking && i.status === 'todo')
  return {
    month, period: p, asOf, items, ended: asOf < today(), openItems: open.length,
    closed: r?.closed_at ? { at: r.closed_at, overrideReason: r.override_reason || '', results: r.results } : null,
  }
}

export async function tick(month, { key, done }, user) {
  if (!MANUAL[key]) throw new HttpError(400, 'That item is checked by the system')
  const p = await periodOf(month)
  await sql`INSERT INTO fin_close_checklists (period_id, ticks) VALUES (${p.id}, ${JSON.stringify({ [key]: done ? { by: user?.name || '', at: new Date().toISOString() } : null })}::jsonb)
    ON CONFLICT (period_id) DO UPDATE SET ticks = fin_close_checklists.ticks || EXCLUDED.ticks, updated_at = now()`
  return checklist(month)
}

// Runs every month-end job in order; each reports its own result or error
export async function runMonthEnd({ month, jobs } = {}, user) {
  checkMonthForJob(month, (await getSettings()).goLiveDate)
  const all = { bills: () => generateRecurring({ month }, user), journals: () => generateJournals({ month }, user), depreciation: () => postDepreciation({ month }, user),
    fx: () => postRevaluation({ month }, user), ecl: () => postAllowance({ month }, user), stock: () => postValuation({ month }, user) }
  const run = (jobs?.length ? jobs : Object.keys(all)).filter((k) => all[k])
  const results = []
  for (const k of run) {
    try {
      const r = await all[k]()
      results.push({ job: k, ok: !(r.failed?.length), detail: r.failed?.length ? r.failed.map((f) => `${f.name}: ${f.error}`).join('; ') : r.entryNo || '' })
    } catch (err) { results.push({ job: k, ok: false, detail: err.message }) }
  }
  return { results, checklist: await checklist(month) }
}

// Closing a month: it must have ended; open items need the owner's reason. The checklist is kept.
export async function closeMonth(month, { reason } = {}, user) {
  const c = await checklist(month)
  if (c.period.status !== 'Open') throw new HttpError(400, `${c.period.name} is already ${c.period.status.toLowerCase()}`)
  if (!c.ended) throw new HttpError(400, `${c.period.name} has not ended yet`)
  if (c.openItems && !blank(reason)) throw new HttpError(400, `${c.openItems} item${c.openItems === 1 ? ' is' : 's are'} still open: give a reason to close anyway`)
  if (c.openItems && user?.role !== 'owner') throw new HttpError(403, 'Only the owner can close a month with items open')
  await setPeriodStatus(c.period.id, { status: 'Closed' }, user)
  await sql`INSERT INTO fin_close_checklists (period_id, results, override_reason, closed_by, closed_at)
    VALUES (${c.period.id}, ${JSON.stringify(c.items)}::jsonb, ${c.openItems ? blank(reason) : null}, ${user?.id ?? null}, now())
    ON CONFLICT (period_id) DO UPDATE SET results = EXCLUDED.results, override_reason = EXCLUDED.override_reason, closed_by = EXCLUDED.closed_by,
      closed_at = EXCLUDED.closed_at, updated_at = now()`
  return checklist(month)
}

// Months of a year with their close state (the Close page's month strip)
export async function closeOverview() {
  const periods = (await listPeriods()).filter((p) => !p.isAdjustment)
  const recs = await sql`SELECT period_id, closed_at, override_reason FROM fin_close_checklists`
  const by = new Map(recs.map((r) => [r.period_id, r]))
  return periods.map((p) => ({ ...p, month: p.startsOn.slice(0, 7), closedWithOpenItems: !!by.get(p.id)?.override_reason }))
}

// ── Year-end close ─────────────────────────────────────────────────────
// CL entry on 30 June in the adjustment period: every income, cost and tax account's balance for the year
// (excluding closing entries) is reversed into 3200 Retained earnings. Re-running replaces it.
async function yearFigures(fy) {
  const periods = (await listPeriods()).filter((p) => p.fiscalYear === fy)
  if (!periods.length) throw new HttpError(404, `There is no FY ${fy}`)
  const adj = periods.find((p) => p.isAdjustment)
  const months = periods.filter((p) => !p.isAdjustment)
  const from = months[0].startsOn, to = adj.endsOn
  const rows = await sql`
    SELECT a.id, a.code, a.name, a.type, coalesce(sum(l.debit - l.credit), 0) AS net
    FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'Draft' AND e.entry_type <> 'CL'
      AND (e.entry_date - CASE WHEN e.entry_type = 'OB' THEN 1 ELSE 0 END) BETWEEN ${from}::date AND ${to}::date
    JOIN fin_accounts a ON a.id = l.account_id AND a.type IN ('income', 'cogs', 'expense', 'tax')
    GROUP BY a.id ORDER BY a.code`
  const re = await accountBySystemKey('retained_earnings')
  const lines = [], accounts = []
  let profit = 0
  for (const r of rows) {
    const net = P(r.net)
    if (!net) continue
    profit -= net
    accounts.push({ id: r.id, code: r.code, name: r.name, type: r.type, balance: money(net) })
    lines.push(signed(r.id, -net, { description: `Closed to retained earnings` }))
  }
  if (lines.length) lines.push(signed(re.id, -profit, { description: `Profit for FY ${fy}` }))
  return { fy, periods, adj, months, from, to, lines, accounts, profit: money(profit) }
}
export async function yearState(fy) {
  const y = await yearFigures(fy)
  const s = await entryState({ type: 'year_close', id: fy, event: 'closing' }, y.lines, y.to)
  const notClosed = y.months.filter((p) => p.status === 'Open').map((p) => p.name)
  return { fiscalYear: fy, from: y.from, to: y.to, profit: y.profit, accounts: y.accounts, notClosed, adjustmentStatus: y.adj.status,
    ended: y.to < today(), closed: s.posted, current: s.current, entryId: s.entryId, entryNo: s.entryNo }
}
export async function closeYear(fy, user) {
  const y = await yearFigures(fy)
  const open = y.months.filter((p) => p.status === 'Open')
  if (open.length) throw new HttpError(400, `Close every month first: ${open.map((p) => p.name).join(', ')} ${open.length === 1 ? 'is' : 'are'} still open`)
  if (y.adj.status === 'Locked') throw new HttpError(400, `${y.adj.name} is locked`)
  // Into the adjustment period, so June's own figures stay as they were
  const { entry } = await replaceEntry({ source: { type: 'year_close', id: fy, event: 'closing' }, date: y.to, entryType: 'CL', periodId: y.adj.id,
    memo: `Year-end close FY ${fy}`, lines: y.lines, reason: 'Year closed again after adjustments' }, user)
  return { ...(await yearState(fy)), entryNo: entry?.entryNo ?? null, nextYear: await ensureNextYear(fy) }
}
async function ensureNextYear(fy) {
  const s = Number(fy.slice(0, 4)) + 1
  const next = `${s}-${String((s + 1) % 100).padStart(2, '0')}`
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM fin_periods WHERE fiscal_year = ${next}`
  const [{ max }] = await sql`SELECT max(fiscal_year) AS max FROM fin_periods`
  if (!n && max === fy) await addFiscalYear()
  return next
}
export async function reopenYear(fy, { reason } = {}, user) {
  if (!blank(reason)) throw new HttpError(400, 'Say why the year is being reopened')
  const [e] = await sql`SELECT id FROM fin_entries WHERE source_type = 'year_close' AND source_id = ${fy} AND status = 'Posted'`
  if (!e) throw new HttpError(400, `FY ${fy} has not been closed`)
  const entry = await getEntry(e.id)
  await reverseEntry(e.id, { date: entry.date, reason }, user)
  return yearState(fy)
}
