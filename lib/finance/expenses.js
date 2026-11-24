// Finance F2a: suppliers, expenses (with receipts), recurring bills and weekly studio claims.
// Every money event posts through ledger.createEntry with a source (type, id, event), so the same
// event can't post twice; editing or voiding reverses the posting rather than changing it.
import { neon } from '@neondatabase/serverless'
import { HttpError, blank } from '../db.js'
import { toPaisa, fromPaisa, sumPaisa } from './money.js'
import { createEntry, reverseEntry, accountBySystemKey } from './ledger.js'
import { attachToEntry } from './files.js'

let _sql
const db = () => (_sql ??= neon(process.env.DATABASE_URL))
const sql = (...args) => db()(...args)
export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '')
export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })
// DATE columns arrive as local-midnight Dates: read the local parts, not UTC
const pad = (n) => String(n).padStart(2, '0')
export const day = (d) => (d == null ? null : d instanceof Date ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : String(d).slice(0, 10))
const UUID = /^[0-9a-f-]{36}$/i
const money = (v) => fromPaisa(toPaisa(v ?? 0))

// Where money came from (or went to) -> the account
export const PAID_FROM = { bank: 'bank_baf', cash: 'cash_studio', director_omer: 'director_omer', director_usman: 'director_usman', unpaid: 'ap_suppliers' }
export async function payAccount(from) {
  if (!PAID_FROM[from]) throw new HttpError(400, 'Say how it was paid: bank, petty cash, a director, or not paid yet')
  return (await accountBySystemKey(PAID_FROM[from])).id
}
export function amountPaisa(v, label = 'Amount') {
  let p
  try { p = toPaisa(v) } catch (err) { throw new HttpError(400, `${label}: ${err.message}`) }
  if (p <= 0) throw new HttpError(400, `${label} must be more than zero`)
  return p
}

// A category for spending: an expense, cost of sales or asset account, never a control, cash or bank account
const NOT_CATEGORIES = ['cash_studio', 'bank_baf', 'clearing_trax', 'clearing_gateway', 'director_omer', 'director_usman']
export async function checkCategory(accountId, line = '') {
  const [a] = await sql`SELECT id, code, name, type, is_control, is_active, system_key FROM fin_accounts WHERE id = ${Number(accountId) || 0}`
  if (!a) throw new HttpError(400, `${line}Choose a category`)
  if (!a.is_active) throw new HttpError(400, `${line}${a.code} ${a.name} is not active`)
  if (!['expense', 'cogs', 'asset'].includes(a.type) || a.is_control || NOT_CATEGORIES.includes(a.system_key)) throw new HttpError(400, `${line}${a.code} ${a.name} can't be used as an expense category`)
  return a
}

async function attachAll(table, key, id, entryId, fileIds = []) {
  for (const f of fileIds || []) {
    if (table === 'expense') await sql`INSERT INTO fin_expense_files (expense_id, file_id) VALUES (${id}, ${Number(f)}) ON CONFLICT DO NOTHING`
    if (table === 'claim') await sql`INSERT INTO fin_claim_files (claim_id, file_id) VALUES (${id}, ${Number(f)}) ON CONFLICT DO NOTHING`
    if (entryId) await attachToEntry(entryId, f)
  }
}
const entryNoOf = async (id) => (id ? (await sql`SELECT entry_no FROM fin_entries WHERE id = ${id}`)[0]?.entry_no : null)

// ── Suppliers ──────────────────────────────────────────────────────────
const rowToSupplier = (s) => ({
  id: s.id, name: s.name, phone: s.phone || '', cnicNtn: s.cnic_ntn || '', strn: s.strn || '', atlStatus: s.atl_status,
  atlCheckedOn: day(s.atl_checked_on), whtCategory: s.wht_category || '', defaultAccountId: s.default_account_id,
  isRelatedParty: s.is_related_party, notes: s.notes || '', isActive: s.is_active,
  owed: s.owed != null ? money(s.owed) : undefined, spent: s.spent != null ? money(s.spent) : undefined, bills: s.bills,
})

export async function listSuppliers() {
  const rows = await sql`
    SELECT s.*,
      (SELECT coalesce(sum(l.credit - l.debit), 0) FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'Draft'
        JOIN fin_accounts a ON a.id = l.account_id AND a.system_key = 'ap_suppliers'
        WHERE l.party_type = 'supplier' AND l.party_id = s.id::text) AS owed,
      (SELECT coalesce(sum(x.amount), 0) FROM fin_expenses x WHERE x.supplier_id = s.id AND x.status = 'Posted') AS spent,
      (SELECT count(*)::int FROM fin_expenses x WHERE x.supplier_id = s.id AND x.status = 'Posted') AS bills
    FROM fin_suppliers s ORDER BY s.is_active DESC, lower(s.name)`
  return rows.map(rowToSupplier)
}

function supplierFields(b) {
  return {
    name: blank(b.name), phone: blank(b.phone), cnicNtn: blank(b.cnicNtn), strn: blank(b.strn),
    atlStatus: b.atlStatus === '' || b.atlStatus == null ? null : !!b.atlStatus, atlCheckedOn: isDate(b.atlCheckedOn) ? b.atlCheckedOn : null,
    whtCategory: blank(b.whtCategory), defaultAccountId: b.defaultAccountId ? Number(b.defaultAccountId) : null,
    isRelatedParty: !!b.isRelatedParty, notes: blank(b.notes), isActive: b.isActive !== false,
  }
}
export async function createSupplier(b) {
  const f = supplierFields(b)
  if (!f.name) throw new HttpError(400, 'Supplier name is required')
  if (f.defaultAccountId) await checkCategory(f.defaultAccountId)
  try {
    const [s] = await sql`
      INSERT INTO fin_suppliers (name, phone, cnic_ntn, strn, atl_status, atl_checked_on, wht_category, default_account_id, is_related_party, notes, is_active)
      VALUES (${f.name}, ${f.phone}, ${f.cnicNtn}, ${f.strn}, ${f.atlStatus}, ${f.atlCheckedOn}::date, ${f.whtCategory}, ${f.defaultAccountId}::int, ${f.isRelatedParty}, ${f.notes}, ${f.isActive})
      RETURNING *`
    return rowToSupplier(s)
  } catch (err) { if (err.code === '23505') throw new HttpError(400, `There is already a supplier called ${f.name}`); throw err }
}
export async function updateSupplier(id, b) {
  const [cur] = await sql`SELECT * FROM fin_suppliers WHERE id = ${Number(id)}`
  if (!cur) throw new HttpError(404, 'Supplier not found')
  const f = supplierFields({ ...rowToSupplier(cur), ...b })
  if (!f.name) throw new HttpError(400, 'Supplier name is required')
  if (f.defaultAccountId) await checkCategory(f.defaultAccountId)
  try {
    const [s] = await sql`
      UPDATE fin_suppliers SET name = ${f.name}, phone = ${f.phone}, cnic_ntn = ${f.cnicNtn}, strn = ${f.strn}, atl_status = ${f.atlStatus},
        atl_checked_on = ${f.atlCheckedOn}::date, wht_category = ${f.whtCategory}, default_account_id = ${f.defaultAccountId}::int,
        is_related_party = ${f.isRelatedParty}, notes = ${f.notes}, is_active = ${f.isActive}
      WHERE id = ${cur.id} RETURNING *`
    return rowToSupplier(s)
  } catch (err) { if (err.code === '23505') throw new HttpError(400, `There is already a supplier called ${f.name}`); throw err }
}

// ── Expenses ───────────────────────────────────────────────────────────
const rowToExpense = (x) => ({
  id: x.id, date: day(x.expense_date), supplierId: x.supplier_id, supplierName: x.supplier_name || '',
  accountId: x.account_id, accountCode: x.account_code, accountName: x.account_name,
  amount: money(x.amount), taxAmount: money(x.tax_amount), whtAmount: money(x.wht_amount ?? 0), whtCode: x.wht_code || '', paidFrom: x.paid_from, description: x.description || '',
  reference: x.reference || '', collectionId: x.collection_id, collectionName: x.collection_name || '',
  orderId: x.order_id, orderNo: x.order_no || '', status: x.status, recurringId: x.recurring_id,
  entryId: x.entry_id, entryNo: x.entry_no || '', paidEntryId: x.paid_entry_id, paidOn: day(x.paid_on),
  files: x.files ?? 0, createdAt: x.created_at,
})
const EXPENSE_SELECT = (where) => sql`
  SELECT x.*, s.name AS supplier_name, a.code AS account_code, a.name AS account_name, c.name AS collection_name,
         o.order_number AS order_no, e.entry_no,
         (SELECT count(*)::int FROM fin_expense_files f WHERE f.expense_id = x.id) AS files
  FROM fin_expenses x
  JOIN fin_accounts a ON a.id = x.account_id
  LEFT JOIN fin_suppliers s ON s.id = x.supplier_id
  LEFT JOIN collections c ON c.id = x.collection_id
  LEFT JOIN orders o ON o.id = x.order_id
  LEFT JOIN fin_entries e ON e.id = x.entry_id
  ${where}`

export async function listExpenses({ from, to, q, accountId, supplierId, status, paidFrom, limit } = {}) {
  const like = blank(q) ? `%${q.trim()}%` : null
  const rows = await EXPENSE_SELECT(sql`
    WHERE (${isDate(from) ? from : null}::date IS NULL OR x.expense_date >= ${isDate(from) ? from : null}::date)
      AND (${isDate(to) ? to : null}::date IS NULL OR x.expense_date <= ${isDate(to) ? to : null}::date)
      AND (${accountId ? Number(accountId) : null}::int IS NULL OR x.account_id = ${accountId ? Number(accountId) : null}::int)
      AND (${supplierId ? Number(supplierId) : null}::int IS NULL OR x.supplier_id = ${supplierId ? Number(supplierId) : null}::int)
      AND (${blank(status)}::text IS NULL OR x.status = ${blank(status)}::text)
      AND (${blank(paidFrom)}::text IS NULL OR x.paid_from = ${blank(paidFrom)}::text)
      AND (${like}::text IS NULL OR x.description ILIKE ${like} OR s.name ILIKE ${like} OR x.reference ILIKE ${like} OR a.name ILIKE ${like})
    ORDER BY x.expense_date DESC, x.id DESC
    LIMIT ${Math.min(Number(limit) || 500, 2000)}`)
  return rows.map(rowToExpense)
}

export async function getExpense(id) {
  const [x] = await EXPENSE_SELECT(sql`WHERE x.id = ${Number(id) || 0}`)
  if (!x) throw new HttpError(404, 'Expense not found')
  const files = await sql`SELECT f.id, f.name, f.mime, f.size FROM fin_expense_files ef JOIN fin_files f ON f.id = ef.file_id WHERE ef.expense_id = ${x.id} ORDER BY f.id`
  return { ...rowToExpense(x), fileList: files, paidEntryNo: await entryNoOf(x.paid_entry_id) }
}

// Tax on a date (F7): sales tax and withholding only count once the owner has switched tax on
async function taxOnFor(date) {
  const [s] = await sql`SELECT tax_enabled, tax_enabled_from::text AS f FROM fin_settings`
  return !!(s?.tax_enabled && s.f && date >= s.f)
}
const WHT_CODES = ['W153G', 'W153S', 'W155']

async function expenseFields(b) {
  if (!isDate(b.date)) throw new HttpError(400, 'Expense date is required')
  const amount = amountPaisa(b.amount)
  let tax = 0, wht = 0
  try { tax = toPaisa(b.taxAmount || 0) } catch (err) { throw new HttpError(400, `Tax: ${err.message}`) }
  try { wht = toPaisa(b.whtAmount || 0) } catch (err) { throw new HttpError(400, `Withholding: ${err.message}`) }
  if (tax < 0 || tax > amount) throw new HttpError(400, 'Tax must be between zero and the amount')
  if (wht < 0 || wht > amount) throw new HttpError(400, 'Withholding must be between zero and the amount')
  const taxOn = await taxOnFor(b.date)
  if ((tax || wht) && !taxOn) throw new HttpError(400, 'Tax is not switched on for this date: leave the tax amounts empty')
  if (wht && !WHT_CODES.includes(b.whtCode)) throw new HttpError(400, 'Say which withholding it is (goods, services or rent)')
  if (wht && !b.supplierId) throw new HttpError(400, 'Withholding needs the supplier it was deducted from')
  const account = await checkCategory(b.accountId)
  if (!PAID_FROM[b.paidFrom]) throw new HttpError(400, 'Say how it was paid')
  const supplierId = b.supplierId ? Number(b.supplierId) : null
  let supplier = null
  if (supplierId) { [supplier] = await sql`SELECT id, name FROM fin_suppliers WHERE id = ${supplierId}`; if (!supplier) throw new HttpError(400, 'Unknown supplier') }
  if (b.paidFrom === 'unpaid' && !supplier) throw new HttpError(400, 'A bill that is not paid yet needs the supplier, so we know who is owed')
  if (b.orderId && !UUID.test(b.orderId)) throw new HttpError(400, 'Bad order')
  const description = blank(b.description)
  if (!description && !supplier) throw new HttpError(400, 'Say what it was for')
  return { date: b.date, amount, tax, wht, whtCode: wht ? b.whtCode : null, taxOn, account, paidFrom: b.paidFrom, supplier, description, reference: blank(b.reference),
    collectionId: b.collectionId ? Number(b.collectionId) : null, orderId: b.orderId || null }
}

// Dr the category, Cr where the money came from (a supplier balance if not paid yet). With tax on (F7):
// the sales tax on the bill is input tax (1420), and withholding deducted when paying goes to 2310 (a bill
// not paid yet has it deducted when it is paid)
async function expensePosting(id, f) {
  const credit = await payAccount(f.paidFrom)
  const party = f.supplier ? { partyType: 'supplier', partyId: String(f.supplier.id) } : {}
  const text = [f.supplier?.name, f.description].filter(Boolean).join(': ')
  const tax = f.taxOn ? f.tax : 0
  const wht = f.taxOn && f.paidFrom !== 'unpaid' ? f.wht : 0
  const lines = [{ accountId: f.account.id, debit: fromPaisa(f.amount - tax), description: f.description, collectionId: f.collectionId, orderId: f.orderId, ...party }]
  if (tax) lines.push({ accountId: (await accountBySystemKey('st_input')).id, debit: fromPaisa(tax), taxCode: 'IN', description: `Input sales tax${f.reference ? `, invoice ${f.reference}` : ''}`, ...party })
  lines.push({ accountId: credit, credit: fromPaisa(f.amount - wht), description: f.reference ? `Ref ${f.reference}` : null, ...(f.paidFrom === 'unpaid' || f.supplier ? party : {}) })
  if (wht) lines.push({ accountId: (await accountBySystemKey('wht_payable')).id, credit: fromPaisa(wht), taxCode: f.whtCode, description: `Withholding deducted: ${f.supplier?.name || ''}`, ...party })
  return { date: f.date, entryType: 'EX', memo: text, source: { type: 'expense', id, event: 'posted' }, post: true, lines }
}

export async function createExpense(b, user) {
  const f = await expenseFields(b)
  const [x] = await sql`
    INSERT INTO fin_expenses (expense_date, supplier_id, account_id, amount, tax_amount, wht_amount, wht_code, paid_from, description, reference, collection_id, order_id,
                              status, recurring_id, recurring_month, created_by)
    VALUES (${f.date}::date, ${f.supplier?.id ?? null}::int, ${f.account.id}, ${fromPaisa(f.amount)}::numeric, ${fromPaisa(f.tax)}::numeric, ${fromPaisa(f.wht)}::numeric, ${f.whtCode}, ${f.paidFrom},
            ${f.description}, ${f.reference}, ${f.collectionId}::int, ${f.orderId}::uuid, 'Draft',
            ${b.recurringId ? Number(b.recurringId) : null}::int, ${blank(b.recurringMonth)}, ${user?.id ?? null})
    RETURNING id`
  let entry
  try { entry = await createEntry(await expensePosting(x.id, f), user) } catch (err) { await sql`DELETE FROM fin_expenses WHERE id = ${x.id}`; throw err }
  await sql`UPDATE fin_expenses SET status = 'Posted', entry_id = ${entry.id} WHERE id = ${x.id}`
  await attachAll('expense', 'expense_id', x.id, entry.id, b.fileIds)
  return getExpense(x.id)
}

// Changing a posted expense: reverse its entry on the original date, post the corrected one
export async function updateExpense(id, b, user) {
  const cur = await getExpense(id)
  if (cur.status !== 'Posted') throw new HttpError(400, 'Only posted expenses can be changed')
  if (cur.paidEntryId) throw new HttpError(400, 'This bill has been paid. Undo the payment first, then change it.')
  const merged = { ...cur, ...b }
  const f = await expenseFields(merged)
  const reason = blank(b.reason) || 'Expense corrected'
  // Check the new posting before touching the old one
  const posting = await expensePosting(cur.id, f)
  await reverseEntry(cur.entryId, { date: cur.date, reason }, user)
  const entry = await createEntry(posting, user)
  await sql`
    UPDATE fin_expenses SET expense_date = ${f.date}::date, supplier_id = ${f.supplier?.id ?? null}::int, account_id = ${f.account.id},
      amount = ${fromPaisa(f.amount)}::numeric, tax_amount = ${fromPaisa(f.tax)}::numeric, wht_amount = ${fromPaisa(f.wht)}::numeric, wht_code = ${f.whtCode}, paid_from = ${f.paidFrom}, description = ${f.description},
      reference = ${f.reference}, collection_id = ${f.collectionId}::int, order_id = ${f.orderId}::uuid, entry_id = ${entry.id}
    WHERE id = ${cur.id}`
  const files = await sql`SELECT file_id FROM fin_expense_files WHERE expense_id = ${cur.id}`
  await attachAll('expense', 'expense_id', cur.id, entry.id, [...files.map((r) => r.file_id), ...(b.fileIds || [])])
  return getExpense(cur.id)
}

export async function voidExpense(id, { reason } = {}, user) {
  const cur = await getExpense(id)
  if (cur.status !== 'Posted') throw new HttpError(400, 'Only posted expenses can be voided')
  if (!blank(reason)) throw new HttpError(400, 'Say why it is being voided')
  if (cur.paidEntryId) await reverseEntry(cur.paidEntryId, { reason: `Expense voided: ${reason}` }, user)
  await reverseEntry(cur.entryId, { date: cur.date, reason: `Expense voided: ${reason}` }, user)
  await sql`UPDATE fin_expenses SET status = 'Void' WHERE id = ${cur.id}`
  return getExpense(cur.id)
}

export async function addExpenseFiles(id, fileIds) {
  const cur = await getExpense(id)
  await attachAll('expense', 'expense_id', cur.id, cur.entryId, fileIds)
  return getExpense(cur.id)
}

// Paying a bill entered as 'not paid yet': Dr supplier balance, Cr bank / cash / director
export async function payBill(id, { paidOn, paidFrom, reference, whtAmount, whtCode } = {}, user) {
  const cur = await getExpense(id)
  if (cur.status !== 'Posted' || cur.paidFrom !== 'unpaid') throw new HttpError(400, 'Only unpaid bills can be paid here')
  if (cur.paidEntryId) throw new HttpError(400, 'This bill is already paid')
  const on = paidOn || today()
  if (!isDate(on)) throw new HttpError(400, 'Payment date must be a date')
  if (paidFrom === 'unpaid') throw new HttpError(400, 'Say how it was paid')
  const credit = await payAccount(paidFrom)
  const ap = (await accountBySystemKey('ap_suppliers')).id
  const party = { partyType: 'supplier', partyId: String(cur.supplierId) }
  // Withholding is deducted when the bill is paid (F7): the supplier gets the rest
  let wht = 0
  try { wht = toPaisa(whtAmount ?? cur.whtAmount ?? 0) } catch (err) { throw new HttpError(400, `Withholding: ${err.message}`) }
  const code = whtCode || cur.whtCode
  if (wht && !(await taxOnFor(on))) throw new HttpError(400, 'Tax is not switched on for this date')
  if (wht && !WHT_CODES.includes(code)) throw new HttpError(400, 'Say which withholding it is (goods, services or rent)')
  if (wht < 0 || wht > toPaisa(cur.amount)) throw new HttpError(400, 'Withholding must be between zero and the bill')
  const lines = [{ accountId: ap, debit: cur.amount, ...party }, { accountId: credit, credit: fromPaisa(toPaisa(cur.amount) - wht), description: blank(reference) ? `Ref ${reference}` : null, ...party }]
  if (wht) lines.push({ accountId: (await accountBySystemKey('wht_payable')).id, credit: fromPaisa(wht), taxCode: code, description: `Withholding deducted: ${cur.supplierName}`, ...party })
  const entry = await createEntry({
    date: on, entryType: 'EX', memo: `Paid ${cur.supplierName}: ${cur.description || cur.accountName}`, post: true,
    source: { type: 'expense', id: cur.id, event: 'paid' }, lines,
  }, user)
  await sql`UPDATE fin_expenses SET paid_entry_id = ${entry.id}, paid_on = ${on}::date, wht_amount = ${fromPaisa(wht)}::numeric, wht_code = ${wht ? code : null} WHERE id = ${cur.id}`
  return getExpense(cur.id)
}

export async function unpayBill(id, { reason } = {}, user) {
  const cur = await getExpense(id)
  if (!cur.paidEntryId) throw new HttpError(400, 'This bill has no payment to undo')
  if (!blank(reason)) throw new HttpError(400, 'Say why the payment is being undone')
  await reverseEntry(cur.paidEntryId, { reason }, user)
  await sql`UPDATE fin_expenses SET paid_entry_id = NULL, paid_on = NULL WHERE id = ${cur.id}`
  return getExpense(cur.id)
}

// ── Recurring bills (rent, internet, software…) ────────────────────────
const rowToRecurring = (r) => ({
  id: r.id, name: r.name, accountId: r.account_id, accountCode: r.account_code, accountName: r.account_name,
  supplierId: r.supplier_id, supplierName: r.supplier_name || '', amount: money(r.amount), dayOfMonth: r.day_of_month,
  paidFrom: r.paid_from, isActive: r.is_active, lastMonth: r.last_generated_month || '',
})
export async function listRecurring() {
  const rows = await sql`
    SELECT r.*, a.code AS account_code, a.name AS account_name, s.name AS supplier_name
    FROM fin_recurring r JOIN fin_accounts a ON a.id = r.account_id LEFT JOIN fin_suppliers s ON s.id = r.supplier_id
    ORDER BY r.is_active DESC, r.day_of_month, r.name`
  return rows.map(rowToRecurring)
}
export async function saveRecurring(id, b) {
  const name = blank(b.name)
  if (!name) throw new HttpError(400, 'Give it a name, e.g. Studio rent')
  await checkCategory(b.accountId)
  const amount = amountPaisa(b.amount)
  const dom = Number(b.dayOfMonth) || 1
  if (dom < 1 || dom > 28) throw new HttpError(400, 'Day of the month is 1 to 28')
  if (!PAID_FROM[b.paidFrom || 'bank']) throw new HttpError(400, 'Say how it is paid')
  if ((b.paidFrom === 'unpaid') && !b.supplierId) throw new HttpError(400, 'A bill paid later needs the supplier')
  const supplierId = b.supplierId ? Number(b.supplierId) : null
  if (id) {
    const [r] = await sql`UPDATE fin_recurring SET name = ${name}, account_id = ${Number(b.accountId)}, supplier_id = ${supplierId}::int,
      amount = ${fromPaisa(amount)}::numeric, day_of_month = ${dom}, paid_from = ${b.paidFrom || 'bank'}, is_active = ${b.isActive !== false}
      WHERE id = ${Number(id)} RETURNING id`
    if (!r) throw new HttpError(404, 'Recurring bill not found')
  } else {
    await sql`INSERT INTO fin_recurring (name, account_id, supplier_id, amount, day_of_month, paid_from)
      VALUES (${name}, ${Number(b.accountId)}, ${supplierId}::int, ${fromPaisa(amount)}::numeric, ${dom}, ${b.paidFrom || 'bank'})`
  }
  return listRecurring()
}

// Posts each active recurring bill once for the month ('2026-11'); already-posted ones are skipped
export async function generateRecurring({ month } = {}, user) {
  const m = month || today().slice(0, 7)
  if (!/^\d{4}-\d{2}$/.test(m)) throw new HttpError(400, 'Month is YYYY-MM')
  const due = await sql`
    SELECT r.* FROM fin_recurring r
    WHERE r.is_active AND NOT EXISTS (SELECT 1 FROM fin_expenses x WHERE x.recurring_id = r.id AND x.recurring_month = ${m} AND x.status <> 'Void')`
  const created = [], failed = []
  for (const r of due) {
    try {
      created.push(await createExpense({
        date: `${m}-${String(r.day_of_month).padStart(2, '0')}`, accountId: r.account_id, supplierId: r.supplier_id, amount: r.amount,
        paidFrom: r.paid_from, description: r.name, recurringId: r.id, recurringMonth: m,
      }, user))
      await sql`UPDATE fin_recurring SET last_generated_month = ${m} WHERE id = ${r.id}`
    } catch (err) { failed.push({ name: r.name, error: err.message }) }
  }
  return { month: m, created, failed }
}

// ── Weekly studio claims (the main tailor's market spend) ──────────────
const rowToClaim = (c) => ({
  id: c.id, staffId: c.staff_id, staffName: c.staff_name, weekEnding: day(c.week_ending), status: c.status, notes: c.notes || '',
  total: money(c.total), lines: c.line_count, files: c.files ?? 0, approvedEntryId: c.approved_entry_id, entryNo: c.entry_no || '',
  approvedAt: c.approved_at, createdAt: c.created_at,
})
const CLAIM_SELECT = (where) => sql`
  SELECT c.*, st.name AS staff_name, e.entry_no,
    (SELECT coalesce(sum(amount), 0) FROM fin_claim_lines l WHERE l.claim_id = c.id) AS total,
    (SELECT count(*)::int FROM fin_claim_lines l WHERE l.claim_id = c.id) AS line_count,
    (SELECT count(*)::int FROM fin_claim_files f WHERE f.claim_id = c.id) AS files
  FROM fin_claims c JOIN fin_staff st ON st.id = c.staff_id LEFT JOIN fin_entries e ON e.id = c.approved_entry_id
  ${where}`

export async function listClaims({ status, staffId } = {}) {
  const rows = await CLAIM_SELECT(sql`
    WHERE (${blank(status)}::text IS NULL OR c.status = ${blank(status)}::text)
      AND (${staffId ? Number(staffId) : null}::int IS NULL OR c.staff_id = ${staffId ? Number(staffId) : null}::int)
    ORDER BY c.week_ending DESC, c.id DESC LIMIT 500`)
  return rows.map(rowToClaim)
}

export async function getClaim(id) {
  const [c] = await CLAIM_SELECT(sql`WHERE c.id = ${Number(id) || 0}`)
  if (!c) throw new HttpError(404, 'Claim not found')
  const lines = await sql`
    SELECT l.*, a.code, a.name AS account_name FROM fin_claim_lines l JOIN fin_accounts a ON a.id = l.account_id
    WHERE l.claim_id = ${c.id} ORDER BY l.line_no`
  const files = await sql`SELECT f.id, f.name, f.mime, f.size FROM fin_claim_files cf JOIN fin_files f ON f.id = cf.file_id WHERE cf.claim_id = ${c.id} ORDER BY f.id`
  const paid = await sql`
    SELECT p.id, p.paid_on, p.amount, e.entry_no FROM fin_staff_payment_parts pp JOIN fin_staff_payments p ON p.id = pp.payment_id AND p.status = 'Posted'
    LEFT JOIN fin_entries e ON e.id = p.entry_id WHERE pp.claim_id = ${c.id}`
  return {
    ...rowToClaim(c), fileList: files,
    lineList: lines.map((l) => ({ id: l.id, lineNo: l.line_no, accountId: l.account_id, accountCode: l.code, accountName: l.account_name, description: l.description || '', amount: money(l.amount) })),
    payments: paid.map((p) => ({ id: p.id, paidOn: day(p.paid_on), amount: money(p.amount), entryNo: p.entry_no })),
  }
}

async function claimFields(b) {
  const staffId = Number(b.staffId)
  const [st] = await sql`SELECT id, name FROM fin_staff WHERE id = ${staffId || 0}`
  if (!st) throw new HttpError(400, 'Choose who spent the money')
  if (!isDate(b.weekEnding)) throw new HttpError(400, 'Week ending date is required')
  if (!Array.isArray(b.lines) || !b.lines.length) throw new HttpError(400, 'Add at least one item')
  if (b.lines.length > 200) throw new HttpError(400, 'A claim can have up to 200 items')
  const lines = []
  for (const [i, l] of b.lines.entries()) {
    const a = await checkCategory(l.accountId, `Item ${i + 1}: `)
    lines.push({ accountId: a.id, description: blank(l.description), amount: amountPaisa(l.amount, `Item ${i + 1}`) })
  }
  return { staff: st, weekEnding: b.weekEnding, notes: blank(b.notes), lines }
}
const claimLinesInsert = (claimId, lines) => lines.map((l, i) => db()`
  INSERT INTO fin_claim_lines (claim_id, line_no, account_id, description, amount) VALUES (${claimId}, ${i + 1}, ${l.accountId}, ${l.description}, ${fromPaisa(l.amount)}::numeric)`)

export async function createClaim(b, user) {
  const f = await claimFields(b)
  const [c] = await sql`INSERT INTO fin_claims (staff_id, week_ending, notes, created_by) VALUES (${f.staff.id}, ${f.weekEnding}::date, ${f.notes}, ${user?.id ?? null}) RETURNING id`
  await db().transaction(claimLinesInsert(c.id, f.lines))
  await attachAll('claim', 'claim_id', c.id, null, b.fileIds)
  return getClaim(c.id)
}

export async function updateClaim(id, b) {
  const cur = await getClaim(id)
  if (cur.status !== 'Submitted') throw new HttpError(400, 'Only claims waiting for approval can be changed. Undo the approval first.')
  const f = await claimFields({ staffId: cur.staffId, weekEnding: cur.weekEnding, notes: cur.notes, lines: cur.lineList, ...b })
  await db().transaction([
    db()`UPDATE fin_claims SET staff_id = ${f.staff.id}, week_ending = ${f.weekEnding}::date, notes = ${f.notes} WHERE id = ${cur.id}`,
    db()`DELETE FROM fin_claim_lines WHERE claim_id = ${cur.id}`,
    ...claimLinesInsert(cur.id, f.lines),
  ])
  await attachAll('claim', 'claim_id', cur.id, null, b.fileIds)
  return getClaim(cur.id)
}

// Approving books the spend: Dr each item's category, Cr what the studio owes that person
export async function approveClaim(id, user) {
  const c = await getClaim(id)
  if (c.status !== 'Submitted') throw new HttpError(400, `This claim is ${c.status.toLowerCase()}`)
  const payable = (await accountBySystemKey('ap_staff_claims')).id
  const party = { partyType: 'staff', partyId: String(c.staffId) }
  const entry = await createEntry({
    date: c.weekEnding, entryType: 'EX', memo: `Studio claim: ${c.staffName}, week ending ${c.weekEnding}`, post: true,
    source: { type: 'claim', id: c.id, event: 'approved' },
    lines: [
      ...c.lineList.map((l) => ({ accountId: l.accountId, debit: l.amount, description: l.description, ...party })),
      { accountId: payable, credit: c.total, description: `Owed to ${c.staffName}`, ...party },
    ],
  }, user)
  for (const f of c.fileList) await attachToEntry(entry.id, f.id)
  await sql`UPDATE fin_claims SET status = 'Approved', approved_entry_id = ${entry.id}, approved_by = ${user?.id ?? null}, approved_at = now() WHERE id = ${c.id}`
  return getClaim(c.id)
}

export async function undoClaimApproval(id, { reason } = {}, user) {
  const c = await getClaim(id)
  if (c.status !== 'Approved') throw new HttpError(400, c.status === 'Paid' ? 'This claim has been paid. Void the payment first.' : 'This claim is not approved')
  if (!blank(reason)) throw new HttpError(400, 'Say why the approval is being undone')
  await reverseEntry(c.approvedEntryId, { date: c.weekEnding, reason }, user)
  await sql`UPDATE fin_claims SET status = 'Submitted', approved_entry_id = NULL, approved_by = NULL, approved_at = NULL WHERE id = ${c.id}`
  return getClaim(c.id)
}

export async function rejectClaim(id, { reason } = {}) {
  const c = await getClaim(id)
  if (c.status !== 'Submitted') throw new HttpError(400, 'Only claims waiting for approval can be rejected')
  if (!blank(reason)) throw new HttpError(400, 'Say why it is rejected')
  await sql`UPDATE fin_claims SET status = 'Rejected', notes = ${[c.notes, `Rejected: ${reason}`].filter(Boolean).join('\n')} WHERE id = ${c.id}`
  return getClaim(c.id)
}

export async function addClaimFiles(id, fileIds) {
  const c = await getClaim(id)
  await attachAll('claim', 'claim_id', c.id, c.approvedEntryId, fileIds)
  return getClaim(c.id)
}

export { sumPaisa }

// Collections for tagging costs (the Finance Manager has no catalogue access)
export const listCollectionNames = () => sql`SELECT id, name FROM collections ORDER BY created_at DESC, name`
