// Finance F4: bank reconciliation. A statement is read in the browser (pdf.js text, or CSV / Excel rows),
// parsed here with the same pure reader (bankParse.js), stored as lines, and matched to the entries on that
// bank account. Lines not in the books are booked from the line itself (bank charge, director funds,
// expense, staff payment, customer payment, other account) and the counterparty is remembered for next
// month. Nothing is sent outside the app.
import { neon } from '@neondatabase/serverless'
import { createHash } from 'crypto'
import { HttpError, blank } from '../db.js'
import { toPaisa as moneyPaisa, fromPaisa } from './money.js'
import { createEntry, getEntry, accountBySystemKey } from './ledger.js'
import { parseStatementText, parseStatementRows } from './bankParse.js'
import { createExpense, createSupplier, day, isDate } from './expenses.js'
import { createStaffPayment } from './payroll.js'
import { matchName } from './intake.js'
import { addPayment } from './sales.js'

let _sql
const db = () => (_sql ??= neon(process.env.DATABASE_URL))
const sql = (...args) => db()(...args)
const P = (v) => moneyPaisa(v ?? 0)
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
const addDays = (d, n) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) }
const daysBetween = (a, b) => Math.round((new Date(`${a}T00:00:00Z`) - new Date(`${b}T00:00:00Z`)) / 86400000)

async function bankAccounts() {
  return sql`SELECT id, code, name, bank_last4 FROM fin_accounts WHERE is_active AND (bank_last4 IS NOT NULL OR system_key = 'bank_baf') ORDER BY code`
}

// ── Reading and importing ──────────────────────────────────────────────
// b: { textLines } from a PDF, or { rows } from CSV / Excel, plus source
function parse(b) {
  if (Array.isArray(b.textLines) && b.textLines.length) return parseStatementText(b.textLines)
  if (Array.isArray(b.rows) && b.rows.length) return parseStatementRows(b.rows, { accountLast4: b.accountLast4 })
  throw new HttpError(400, "Nothing was read from the file. If it's a scanned PDF, download the statement as PDF or Excel from Alfa / internet banking instead.")
}
function summary(s, account) {
  return {
    bank: s.bank, accountLast4: s.accountLast4, title: s.title, from: s.from, to: s.to,
    opening: s.opening == null ? null : fromPaisa(s.opening), closing: s.closing == null ? null : fromPaisa(s.closing),
    moneyIn: fromPaisa(s.totals.in), moneyOut: fromPaisa(s.totals.out), checks: s.checks, warnings: s.warnings,
    account: account ? { id: account.id, code: account.code, name: account.name } : null,
    lines: s.lines.map((l) => ({ lineNo: l.lineNo, date: l.date, amount: fromPaisa(l.amount), balance: l.balance == null ? null : fromPaisa(l.balance),
      channel: l.channel, party: l.party, partyLast4: l.partyLast4, reference: l.reference, narration: l.narration, issue: l.issue || null })),
  }
}
async function accountFor(s, accountId) {
  const accounts = await bankAccounts()
  if (accountId) return accounts.find((a) => a.id === Number(accountId)) || null
  return accounts.find((a) => s.accountLast4 && a.bank_last4 === s.accountLast4) || (accounts.length === 1 ? accounts[0] : null)
}

export async function previewStatement(b) {
  const s = parse(b)
  return summary(s, await accountFor(s, b.accountId))
}

export async function importStatement(b, user) {
  const s = parse(b)
  const account = await accountFor(s, b.accountId)
  if (!account) throw new HttpError(400, `Which bank account is this? No account ends in ${s.accountLast4 || '(unknown)'}`)
  if (account.bank_last4 && s.accountLast4 && account.bank_last4 !== s.accountLast4) throw new HttpError(400, `This statement is for an account ending ${s.accountLast4}, not ${account.bank_last4}`)
  if (!s.lines.length) throw new HttpError(400, 'No transactions were found on the statement')
  if (!s.checks.balanceChain || s.checks.closingMatches === false || s.opening == null || s.closing == null)
    throw new HttpError(400, `The statement doesn't add up as read (${[...s.warnings, ...s.lines.filter((l) => l.issue).map((l) => `line ${l.lineNo}: ${l.issue}`)].slice(0, 3).join('; ')}). Nothing was imported.`)
  const [overlap] = await sql`SELECT period_from::text AS f, period_to::text AS t FROM fin_bank_statements
    WHERE account_id = ${account.id} AND period_from <= ${s.to}::date AND period_to >= ${s.from}::date`
  if (overlap) throw new HttpError(400, `A statement for ${overlap.f} to ${overlap.t} is already imported for this account`)
  const source = ['pdf', 'csv', 'xlsx'].includes(b.source) ? b.source : 'pdf'
  const [st] = await sql`INSERT INTO fin_bank_statements (account_id, period_from, period_to, opening, closing, source, file_id, created_by)
    VALUES (${account.id}, ${s.from}::date, ${s.to}::date, ${fromPaisa(s.opening)}::numeric, ${fromPaisa(s.closing)}::numeric, ${source},
            ${b.fileId ? Number(b.fileId) : null}, ${user?.id ?? null}) RETURNING id`
  const rows = s.lines.map((l) => ({
    statement_id: st.id, line_no: l.lineNo, txn_date: l.date, amount: fromPaisa(l.amount), balance: l.balance == null ? null : fromPaisa(l.balance),
    narration: l.narration || '(no description)', channel: l.channel, party: l.party, party_last4: l.partyLast4, reference: l.reference, bank_ref: l.bankRef,
    fingerprint: createHash('sha256').update([account.id, l.date, l.amount, l.balance, l.reference || '', l.narration].join('|')).digest('hex'),
  }))
  await sql`INSERT INTO fin_bank_lines (statement_id, line_no, txn_date, amount, balance, narration, channel, party, party_last4, reference, bank_ref, fingerprint)
    SELECT statement_id, line_no, txn_date, amount, balance, narration, channel, party, party_last4, reference, bank_ref, fingerprint
    FROM json_populate_recordset(null::fin_bank_lines, ${JSON.stringify(rows)})`
  const matched = await autoMatch(st.id)
  return { ...(await getStatement(st.id)), autoMatched: matched }
}

// ── Statements and lines ───────────────────────────────────────────────
const rowToLine = (l) => ({
  id: l.id, lineNo: l.line_no, date: day(l.txn_date), amount: fromPaisa(P(l.amount)), balance: l.balance == null ? null : fromPaisa(P(l.balance)),
  narration: l.narration, channel: l.channel, party: l.party || '', partyLast4: l.party_last4 || '', reference: l.reference || '', bankRef: l.bank_ref || '',
  status: l.status, entryId: l.entry_id, entryNo: l.entry_no || '', entryMemo: l.entry_memo || '', matchedBy: l.matched_by, note: l.note || '',
})
export async function listStatements() {
  const rows = await sql`
    SELECT s.*, a.code, a.name AS account_name,
      (SELECT count(*)::int FROM fin_bank_lines l WHERE l.statement_id = s.id) AS lines,
      (SELECT count(*)::int FROM fin_bank_lines l WHERE l.statement_id = s.id AND l.status = 'Unmatched') AS unmatched
    FROM fin_bank_statements s JOIN fin_accounts a ON a.id = s.account_id ORDER BY s.period_from DESC`
  return rows.map((s) => ({ id: s.id, account: `${s.code} ${s.account_name}`, from: day(s.period_from), to: day(s.period_to),
    opening: fromPaisa(P(s.opening)), closing: fromPaisa(P(s.closing)), lines: s.lines, unmatched: s.unmatched, status: s.status, source: s.source }))
}

export async function getStatement(id) {
  const [s] = await sql`SELECT s.*, a.code, a.name AS account_name FROM fin_bank_statements s JOIN fin_accounts a ON a.id = s.account_id WHERE s.id = ${Number(id) || 0}`
  if (!s) throw new HttpError(404, 'Statement not found')
  const lines = await sql`
    SELECT l.*, e.entry_no, e.memo AS entry_memo FROM fin_bank_lines l LEFT JOIN fin_entries e ON e.id = l.entry_id
    WHERE l.statement_id = ${s.id} ORDER BY l.line_no`
  const st = { id: s.id, accountId: s.account_id, account: `${s.code} ${s.account_name}`, from: day(s.period_from), to: day(s.period_to),
    opening: fromPaisa(P(s.opening)), closing: fromPaisa(P(s.closing)), status: s.status, source: s.source, fileId: s.file_id,
    reconciledAt: s.reconciled_at, note: s.note || '' }
  const out = lines.map(rowToLine)
  // Suggestions for what is not matched yet: entries that could be it, and what to book if none
  const open = out.filter((l) => l.status === 'Unmatched')
  if (open.length) {
    const cands = await candidates(s.account_id, addDays(st.from, -10), addDays(st.to, 10))
    const ctx = await suggestContext()
    for (const l of open) {
      l.candidates = rank(l, cands).slice(0, 4).map(({ c, score }) => ({ entryId: c.id, entryNo: c.entry_no, date: c.date, memo: c.memo, score }))
      l.suggest = suggestAction(l, ctx)
    }
  }
  return { ...st, lines: out, reconciliation: await reconciliation(st, out) }
}

// Posted entries touching the bank account in a window, not yet matched to a bank line; net = money in (+) / out (−)
async function candidates(accountId, from, to) {
  const rows = await sql`
    SELECT e.id, e.entry_no, e.entry_date::text AS date, e.memo, e.entry_type,
           sum(l.debit - l.credit) AS net, string_agg(coalesce(l.description, ''), ' ') AS descs
    FROM fin_entries e JOIN fin_lines l ON l.entry_id = e.id AND l.account_id = ${accountId}
    WHERE e.status = 'Posted' AND e.source_type IS DISTINCT FROM 'reversal' AND e.entry_type <> 'OB'
      AND e.entry_date BETWEEN ${from}::date AND ${to}::date
      AND NOT EXISTS (SELECT 1 FROM fin_bank_lines b WHERE b.entry_id = e.id)
    GROUP BY e.id HAVING sum(l.debit - l.credit) <> 0`
  return rows.map((r) => ({ ...r, net: P(r.net), text: norm(`${r.memo} ${r.descs}`) }))
}
// Same amount required; nearer date, the reference or the other party's name in the entry raise the score
function score(l, c) {
  if (P(l.amount) !== c.net) return null
  const days = Math.abs(daysBetween(l.date, c.date))
  if (days > 7) return null
  let s = 60 - 8 * days
  const refs = [l.reference, l.bankRef].filter(Boolean).map((r) => r.toLowerCase())
  if (refs.some((r) => `${c.memo} ${c.descs}`.toLowerCase().includes(r))) s += 100
  const words = norm(l.party).split(' ').filter((w) => w.length >= 3 && !['bank', 'limited', 'transaction', 'payable'].includes(w))
  s += Math.min(40, words.filter((w) => c.text.includes(w)).length * 15)
  return s
}
const rank = (l, cands) => cands.map((c) => ({ c, score: score(l, c) })).filter((x) => x.score != null).sort((a, b) => b.score - a.score)

// Matches each line to an entry when one candidate clearly fits (amount, date, name / reference)
export async function autoMatch(statementId) {
  const st = await getStatementRow(statementId)
  const lines = (await sql`SELECT * FROM fin_bank_lines WHERE statement_id = ${st.id} AND status = 'Unmatched' ORDER BY line_no`).map(rowToLine)
  const cands = await candidates(st.account_id, addDays(day(st.period_from), -10), addDays(day(st.period_to), 10))
  const pairs = []
  for (const l of lines) {
    const r = rank(l, cands)
    if (r.length && r[0].score >= 60 && (r.length === 1 || r[1].score <= r[0].score - 15)) pairs.push({ l, c: r[0].c, score: r[0].score })
  }
  pairs.sort((a, b) => b.score - a.score)
  const taken = new Set(), done = new Set()
  let n = 0
  for (const p of pairs) {
    if (taken.has(p.c.id) || done.has(p.l.id)) continue
    taken.add(p.c.id); done.add(p.l.id)
    await sql`UPDATE fin_bank_lines SET status = 'Matched', entry_id = ${p.c.id}, matched_by = 'auto', updated_at = now() WHERE id = ${p.l.id} AND status = 'Unmatched'`
    n++
  }
  return n
}
async function getStatementRow(id) {
  const [st] = await sql`SELECT * FROM fin_bank_statements WHERE id = ${Number(id) || 0}`
  if (!st) throw new HttpError(404, 'Statement not found')
  return st
}
async function lineForEdit(lineId) {
  const [l] = await sql`SELECT l.*, s.status AS statement_status, s.account_id FROM fin_bank_lines l JOIN fin_bank_statements s ON s.id = l.statement_id WHERE l.id = ${Number(lineId) || 0}`
  if (!l) throw new HttpError(404, 'Statement line not found')
  if (l.statement_status === 'Reconciled') throw new HttpError(400, 'This statement is reconciled. Reopen it to change its lines.')
  return l
}

export async function matchLine(lineId, entryId, user) {
  const l = await lineForEdit(lineId)
  if (l.status !== 'Unmatched') throw new HttpError(400, 'This line is already dealt with')
  const e = await getEntry(entryId)
  if (e.status !== 'Posted') throw new HttpError(400, `${e.entryNo} is not a posted entry`)
  const net = e.lines.filter((x) => x.accountId === l.account_id).reduce((s, x) => s + P(x.debit) - P(x.credit), 0)
  if (net !== P(l.amount)) throw new HttpError(400, `${e.entryNo} moves ${fromPaisa(net)} through the bank, not ${fromPaisa(P(l.amount))}`)
  try {
    await sql`UPDATE fin_bank_lines SET status = 'Matched', entry_id = ${e.id}, matched_by = 'manual', updated_by = ${user?.id ?? null}, updated_at = now() WHERE id = ${l.id}`
  } catch (err) { if (err.code === '23505') throw new HttpError(400, `${e.entryNo} is already matched to another statement line`); throw err }
  return getStatement(l.statement_id)
}
export async function unmatchLine(lineId, user) {
  const l = await lineForEdit(lineId)
  await sql`UPDATE fin_bank_lines SET status = 'Unmatched', entry_id = NULL, matched_by = NULL, note = NULL, updated_by = ${user?.id ?? null}, updated_at = now() WHERE id = ${l.id}`
  return getStatement(l.statement_id)
}
export async function ignoreLine(lineId, { reason } = {}, user) {
  const l = await lineForEdit(lineId)
  if (l.status === 'Matched') throw new HttpError(400, 'Unmatch the line first')
  if (!blank(reason)) throw new HttpError(400, 'Say why this line needs nothing in the books')
  await sql`UPDATE fin_bank_lines SET status = 'Ignored', note = ${blank(reason)}, updated_by = ${user?.id ?? null}, updated_at = now() WHERE id = ${l.id}`
  return getStatement(l.statement_id)
}

// ── Suggesting what a line is ──────────────────────────────────────────
async function suggestContext() {
  const [rules, staff, suppliers] = await Promise.all([
    sql`SELECT r.*, a.code, a.name AS account_name, st.name AS staff_name, su.name AS supplier_name FROM fin_bank_rules r
        LEFT JOIN fin_accounts a ON a.id = r.account_id LEFT JOIN fin_staff st ON st.id = r.staff_id LEFT JOIN fin_suppliers su ON su.id = r.supplier_id`,
    sql`SELECT id, name, aliases, is_active FROM fin_staff WHERE is_active`,
    sql`SELECT id, name, default_account_id FROM fin_suppliers WHERE is_active`,
  ])
  return { rules, staff: staff.map((s) => ({ id: s.id, name: s.name, aliases: s.aliases || [] })), suppliers }
}
export function suggestAction(l, ctx) {
  const dir = P(l.amount) > 0 ? 'in' : 'out'
  const party = norm(l.party), text = norm(l.narration)
  // Longest matching rule wins (a learned "rana zohaib" beats a general word)
  const rule = ctx.rules.filter((r) => (r.direction === 'any' || r.direction === dir) && (party.includes(r.pattern) || (!party && text.includes(r.pattern)) || (l.channel === 'charge' && text.includes(r.pattern))))
    .sort((a, b) => b.pattern.length - a.pattern.length)[0]
  if (rule) {
    const label = rule.action === 'director' ? `${dir === 'in' ? 'Funds from' : 'Paid to'} ${rule.director === 'omer' ? 'Omer' : 'Usman'}`
      : rule.action === 'bank_charge' ? 'Bank charge'
      : rule.action === 'staff' && rule.staff_name ? `Paid to ${rule.staff_name}`
      : rule.action === 'expense' ? [rule.supplier_name, rule.account_name].filter(Boolean).join(' · ') || 'Expense'
      : rule.action === 'other' && rule.account_name ? `${rule.code} ${rule.account_name}` : null
    return { action: rule.action, director: rule.director, accountId: rule.account_id, supplierId: rule.supplier_id, staffId: rule.staff_id, from: 'rule', label }
  }
  if (l.channel === 'charge') return { action: 'bank_charge', from: 'guess', label: 'Bank charge' }
  if (dir === 'out') {
    const staff = matchName(l.party, ctx.staff)
    if (staff) return { action: 'staff', staffId: staff.id, from: 'guess', label: `Paid to ${staff.name}` }
    const sup = matchName(l.party, ctx.suppliers, (x) => [x.name], { fuzzy: false })
    if (sup) return { action: 'expense', supplierId: sup.id, accountId: sup.default_account_id, from: 'guess', label: `Paid to ${sup.name}` }
    return { action: 'expense', from: 'guess', label: null }
  }
  return { action: 'customer', from: 'guess', label: null }
}

// ── Booking a line that is not in the books yet ────────────────────────
// b: { action, director, accountId, supplierId, supplierName, staffId, kind, orderId, description, remember }
export async function bookLine(lineId, b, user) {
  const l = await lineForEdit(lineId)
  if (l.status !== 'Unmatched') throw new HttpError(400, 'This line is already dealt with')
  const date = day(l.txn_date), amt = P(l.amount), abs = Math.abs(amt), dir = amt > 0 ? 'in' : 'out'
  const bank = l.account_id
  const ref = l.reference || l.bank_ref || null
  const who = l.party || l.narration.slice(0, 60)
  const memoBase = `${who}${ref ? `, ref ${ref}` : ''}`
  const source = { type: 'bank_line', id: l.id, event: 'booked' }
  const bankLine = (extra = {}) => ({ accountId: bank, debit: dir === 'in' ? fromPaisa(abs) : '0', credit: dir === 'out' ? fromPaisa(abs) : '0', description: ref ? `Ref ${ref}` : who, ...extra })
  const otherLine = (accountId, extra = {}) => ({ accountId, debit: dir === 'out' ? fromPaisa(abs) : '0', credit: dir === 'in' ? fromPaisa(abs) : '0', ...extra })
  let entryId, note
  switch (b.action) {
    case 'bank_charge': {
      const acc = b.accountId ? Number(b.accountId) : (await accountBySystemKey('bank_charges')).id
      const e = await createEntry({ date, entryType: 'BK', memo: `Bank charge: ${l.narration.slice(0, 80)}`, post: true, source, lines: [otherLine(acc, { description: l.narration.slice(0, 120) }), bankLine()] }, user)
      entryId = e.id; note = 'Bank charge'
      break
    }
    case 'director': {
      if (!['omer', 'usman'].includes(b.director)) throw new HttpError(400, 'Choose the director')
      const acc = (await accountBySystemKey(`director_${b.director}`)).id
      const name = b.director === 'omer' ? 'Omer' : 'Usman'
      const e = await createEntry({ date, entryType: 'BK', memo: `${dir === 'in' ? 'Funds added by' : 'Paid to'} ${name}: ${memoBase}`, post: true, source,
        lines: [bankLine(), otherLine(acc, { partyType: 'director', partyId: b.director, description: dir === 'in' ? `Funds added by ${name}` : `Paid to ${name}` })] }, user)
      entryId = e.id; note = dir === 'in' ? `Funds from ${name}` : `Paid to ${name}`
      break
    }
    case 'other': {
      const [a] = await sql`SELECT id, code, name, is_control, is_active, bank_last4, system_key FROM fin_accounts WHERE id = ${Number(b.accountId) || 0}`
      if (!a || !a.is_active) throw new HttpError(400, 'Choose an account')
      if (a.is_control) throw new HttpError(400, `${a.code} ${a.name} is kept by the system; use the matching option instead`)
      if (a.id === bank) throw new HttpError(400, 'Choose the other side of the transaction, not the bank account itself')
      const e = await createEntry({ date, entryType: 'BK', memo: `${blank(b.description) || memoBase}`, post: true, source,
        lines: [bankLine(), otherLine(a.id, { description: blank(b.description) || who })] }, user)
      entryId = e.id; note = `${a.code} ${a.name}`
      break
    }
    case 'expense': {
      if (dir !== 'out') throw new HttpError(400, 'Money coming in is not an expense')
      let supplierId = b.supplierId ? Number(b.supplierId) : null
      if (!supplierId && blank(b.supplierName)) {
        const [found] = await sql`SELECT id FROM fin_suppliers WHERE lower(name) = lower(${b.supplierName.trim()})`
        supplierId = found?.id || (await createSupplier({ name: b.supplierName.trim(), defaultAccountId: b.accountId || null })).id
      }
      const x = await createExpense({ date, amount: fromPaisa(abs), accountId: b.accountId, paidFrom: 'bank', supplierId, description: blank(b.description) || who, reference: ref }, user)
      entryId = x.entryId; note = `Expense: ${x.accountCode} ${x.accountName}`
      b.supplierId = supplierId
      break
    }
    case 'staff': {
      if (dir !== 'out') throw new HttpError(400, 'Money coming in is not a staff payment')
      const kind = b.kind === 'advance' ? 'advance' : 'salary'
      const p = await createStaffPayment({ staffId: b.staffId, paidOn: date, paidFrom: 'bank', amount: fromPaisa(abs), reference: ref,
        notes: 'From the bank statement', parts: [{ kind, amount: fromPaisa(abs) }] }, user)
      entryId = p.entryId; note = `${kind === 'advance' ? 'Advance' : 'Salary'} to ${p.staffName}`
      break
    }
    case 'customer': {
      if (!b.orderId) throw new HttpError(400, 'Choose the order this payment is for')
      await addPayment(b.orderId, { paidOn: date, amount: fromPaisa(amt), method: 'bank', reference: ref, notes: 'From the bank statement' }, user)
      const [p] = await sql`SELECT p.id, o.order_number FROM customer_payments p JOIN orders o ON o.id = p.order_id
        WHERE p.order_id = ${b.orderId} AND p.paid_on = ${date}::date AND p.amount = ${fromPaisa(amt)}::numeric ORDER BY p.id DESC LIMIT 1`
      const [e] = await sql`SELECT id FROM fin_entries WHERE source_type = 'customer_payment' AND source_id = ${String(p.id)} AND status = 'Posted'`
      if (!e) throw new HttpError(400, `${p.order_number}: the payment is recorded but couldn't be posted (see Finance › Sales & receipts)`)
      entryId = e.id; note = `Payment for ${p.order_number}`
      break
    }
    default: throw new HttpError(400, 'Choose what this line is')
  }
  await sql`UPDATE fin_bank_lines SET status = 'Matched', entry_id = ${entryId}, matched_by = 'created', note = ${note}, updated_by = ${user?.id ?? null}, updated_at = now() WHERE id = ${l.id}`
  if (b.remember !== false && l.party && b.action !== 'customer') await remember(l, dir, b)
  return getStatement(l.statement_id)
}

// Learns "this name is usually …" for next month's statement
async function remember(l, dir, b) {
  const pattern = norm(l.party)
  if (pattern.length < 3) return
  await sql`INSERT INTO fin_bank_rules (pattern, direction, action, director, account_id, supplier_id, staff_id)
    VALUES (${pattern}, ${dir}, ${b.action}, ${b.director || null}, ${b.accountId ? Number(b.accountId) : null}, ${b.supplierId ? Number(b.supplierId) : null}, ${b.staffId ? Number(b.staffId) : null})
    ON CONFLICT (pattern, direction) DO UPDATE SET action = EXCLUDED.action, director = EXCLUDED.director, account_id = EXCLUDED.account_id,
      supplier_id = EXCLUDED.supplier_id, staff_id = EXCLUDED.staff_id`
}
export async function listRules() {
  const rows = await sql`SELECT r.*, a.code, a.name AS account_name, s.name AS supplier_name, st.name AS staff_name FROM fin_bank_rules r
    LEFT JOIN fin_accounts a ON a.id = r.account_id LEFT JOIN fin_suppliers s ON s.id = r.supplier_id LEFT JOIN fin_staff st ON st.id = r.staff_id ORDER BY r.pattern`
  return rows.map((r) => ({ id: r.id, pattern: r.pattern, direction: r.direction, action: r.action, director: r.director, account: r.code ? `${r.code} ${r.account_name}` : '',
    supplier: r.supplier_name || '', staff: r.staff_name || '' }))
}
export async function deleteRule(id) { await sql`DELETE FROM fin_bank_rules WHERE id = ${Number(id) || 0}`; return listRules() }

// Orders a customer payment could be for (finance users can't open the CRM order list)
export async function findOrders({ q = '', amount } = {}) {
  const like = `%${String(q).trim()}%`
  const rows = await sql`
    SELECT o.id, o.order_number, o.status, o.order_date::text AS order_date, o.amount_pkr, o.advance_paid_pkr, o.balance_due_pkr, c.name
    FROM orders o JOIN customers c ON c.id = o.customer_id
    WHERE o.order_type = 'Sale' AND (${String(q).trim()} = '' OR o.order_number ILIKE ${like} OR c.name ILIKE ${like} OR o.shopify_order_number ILIKE ${like})
    ORDER BY (o.balance_due_pkr = ${amount ? Number(amount) : -1}) DESC, o.order_date DESC NULLS LAST LIMIT 20`
  return rows.map((o) => ({ id: o.id, orderNumber: o.order_number, status: o.status, orderDate: o.order_date, customer: o.name,
    amount: fromPaisa(P(o.amount_pkr)), advance: fromPaisa(P(o.advance_paid_pkr)), balance: fromPaisa(P(o.balance_due_pkr)) }))
}

// ── Reconciliation ─────────────────────────────────────────────────────
// Bank closing = book balance + money on the statement not yet in the books − book items not on any statement
async function reconciliation(st, lines) {
  const [{ book }] = await sql`SELECT coalesce(sum(l.debit - l.credit), 0) AS book FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'Draft'
    WHERE l.account_id = ${st.accountId} AND e.entry_date <= ${st.to}::date`
  const outstanding = await sql`
    SELECT e.id, e.entry_no, e.entry_date::text AS date, e.memo, sum(l.debit - l.credit) AS net
    FROM fin_entries e JOIN fin_lines l ON l.entry_id = e.id AND l.account_id = ${st.accountId}
    WHERE e.status = 'Posted' AND e.source_type IS DISTINCT FROM 'reversal' AND e.entry_type <> 'OB' AND e.entry_date <= ${st.to}::date
      AND NOT EXISTS (SELECT 1 FROM fin_bank_lines b WHERE b.entry_id = e.id)
    GROUP BY e.id HAVING sum(l.debit - l.credit) <> 0 ORDER BY e.entry_date, e.id LIMIT 300`
  const notInBooks = lines.filter((l) => l.status === 'Unmatched').reduce((s, l) => s + P(l.amount), 0)
  const notOnStatement = outstanding.reduce((s, r) => s + P(r.net), 0)
  const difference = P(st.closing) - (P(book) + notInBooks - notOnStatement)
  return {
    bankClosing: st.closing, bookBalance: fromPaisa(P(book)), notInBooks: fromPaisa(notInBooks), notOnStatement: fromPaisa(notOnStatement),
    difference: fromPaisa(difference),
    outstanding: outstanding.map((r) => ({ entryId: r.id, entryNo: r.entry_no, date: r.date, memo: r.memo || '', amount: fromPaisa(P(r.net)) })),
    counts: { matched: lines.filter((l) => l.status === 'Matched').length, unmatched: lines.filter((l) => l.status === 'Unmatched').length, ignored: lines.filter((l) => l.status === 'Ignored').length },
  }
}

export async function setReconciled(id, { reconciled, note } = {}, user) {
  const st = await getStatement(id)
  if (reconciled) {
    if (st.reconciliation.counts.unmatched) throw new HttpError(400, `${st.reconciliation.counts.unmatched} line(s) still need matching, booking or ignoring`)
    if (P(st.reconciliation.difference) !== 0 && !blank(note)) throw new HttpError(400, `There is an unexplained difference of ${st.reconciliation.difference}. Explain it in a note to reconcile anyway.`)
    if (P(st.reconciliation.difference) !== 0 && user?.role !== 'owner') throw new HttpError(403, 'Only an owner can reconcile with a difference')
    await sql`UPDATE fin_bank_statements SET status = 'Reconciled', reconciled_by = ${user?.id ?? null}, reconciled_at = now(), note = ${blank(note)} WHERE id = ${st.id}`
  } else {
    if (user?.role !== 'owner') throw new HttpError(403, 'Only an owner can reopen a reconciled statement')
    await sql`UPDATE fin_bank_statements SET status = 'Open', reconciled_by = NULL, reconciled_at = NULL WHERE id = ${st.id}`
  }
  return getStatement(st.id)
}

// Deleting an import (open statements only): the lines go; anything booked from them stays in the books
export async function deleteStatement(id) {
  const st = await getStatementRow(id)
  if (st.status === 'Reconciled') throw new HttpError(400, 'Reopen the statement before deleting it')
  await sql`DELETE FROM fin_bank_statements WHERE id = ${st.id}`
  return { ok: true }
}
export { isDate }
