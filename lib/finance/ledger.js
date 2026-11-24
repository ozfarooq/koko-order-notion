// Finance ledger: settings, chart of accounts, periods, journal entries and opening balances.
// The database enforces the rules (balance, immutability, period status, control accounts; see
// migration 013). These functions check the same things first so people get clear messages,
// then write each entry in one transaction that also tells the database who is acting.
import { neon } from '@neondatabase/serverless'
import { HttpError, blank } from '../db.js'
import { toPaisa, fromPaisa, sumPaisa } from './money.js'
import { attachToEntry } from './files.js'

let _sql
const db = () => (_sql ??= neon(process.env.DATABASE_URL))
const sql = (...args) => db()(...args)
const UUID = /^[0-9a-f-]{36}$/i
const TYPES = ['asset', 'liability', 'equity', 'income', 'cogs', 'expense', 'tax']
const CASH_FLOW = ['operating', 'investing', 'financing', 'cash']
const ENTRY_TYPES = ['JV', 'OB', 'SI', 'RC', 'EX', 'PY', 'PU', 'IN', 'BK', 'TX', 'CL']
const PARTIES = ['customer', 'reseller', 'supplier', 'staff', 'director', 'courier']
// DATE columns arrive as local-midnight Dates: read the local parts, not UTC
const pad = (n) => String(n).padStart(2, '0')
const day = (d) => (d == null ? null : d instanceof Date ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : String(d).slice(0, 10))
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '')

// Rule errors raised by the database (P0001) become plain 400 messages
async function run(queries) {
  try { return await db().transaction(queries) } catch (err) {
    if (err.code === 'P0001' || err.code === '23514' || err.code === '23505') throw new HttpError(400, friendly(err))
    throw err
  }
}
function friendly(err) {
  if (err.code === '23505' && /fin_entries_source_key/.test(err.message)) return 'This has already been posted. Reverse the existing entry first.'
  if (err.code === '23505') return 'That already exists.'
  if (err.code === '23514') return `That doesn't pass a check: ${err.constraint || err.message}`
  return err.message
}
// First statement of every finance transaction: who is acting (read by the period rule)
const asUser = (user) => db()`SELECT set_config('koko.role', ${user?.role || ''}, true), set_config('koko.user_id', ${user?.id ? String(user.id) : ''}, true)`

// ── Settings ───────────────────────────────────────────────────────────
export async function getSettings() {
  const [s] = await sql`SELECT company_name, base_currency, go_live_date::text AS go_live_date, revenue_event, reporting_framework,
    accounting_policies, tax_enabled, tax_enabled_from::text AS tax_enabled_from, capitalisation_threshold, working_days_per_week, ecl_rates, updated_at FROM fin_settings`
  if (!s) throw new HttpError(500, 'Finance is not set up: migration 013 has not run on this database')
  return {
    companyName: s.company_name, baseCurrency: s.base_currency, goLiveDate: s.go_live_date, revenueEvent: s.revenue_event,
    reportingFramework: s.reporting_framework, accountingPolicies: s.accounting_policies || '',
    taxEnabled: s.tax_enabled, taxEnabledFrom: s.tax_enabled_from, updatedAt: s.updated_at,
    capitalisationThreshold: fromPaisa(toPaisa(s.capitalisation_threshold ?? 25000)), workingDaysPerWeek: s.working_days_per_week ?? 6,
    eclRates: s.ecl_rates ?? { b30: 0, b60: 1, b90: 5, b90p: 20 },
  }
}

// Tax switches are F7 and are not editable here
export async function updateSettings(b) {
  if (b.reportingFramework !== undefined && !['AFRS_SSE', 'IFRS_SMES', 'IFRS'].includes(b.reportingFramework)) throw new HttpError(400, 'Unknown reporting framework')
  if (b.goLiveDate !== undefined && b.goLiveDate !== (await getSettings()).goLiveDate) {
    if (!isDate(b.goLiveDate)) throw new HttpError(400, 'Go-live date must be a date')
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM fin_entries WHERE status <> 'Draft'`
    if (n) throw new HttpError(400, 'The go-live date cannot change once entries are posted')
  }
  let threshold = null
  if (b.capitalisationThreshold !== undefined) {
    try { threshold = toPaisa(b.capitalisationThreshold) } catch (err) { throw new HttpError(400, `Capitalisation threshold: ${err.message}`) }
    if (threshold < 0) throw new HttpError(400, 'Capitalisation threshold cannot be negative')
  }
  const wd = b.workingDaysPerWeek !== undefined ? Number(b.workingDaysPerWeek) : null
  if (wd !== null && !(Number.isInteger(wd) && wd >= 1 && wd <= 7)) throw new HttpError(400, 'Working days per week is 1 to 7')
  let ecl = null
  if (b.eclRates !== undefined) {
    ecl = {}
    for (const k of ['b30', 'b60', 'b90', 'b90p']) {
      const v = Number(b.eclRates?.[k] ?? 0)
      if (!(v >= 0 && v <= 100)) throw new HttpError(400, 'Loss rates are 0 to 100%')
      ecl[k] = Math.round(v * 100) / 100
    }
  }
  await sql`
    UPDATE fin_settings SET
      company_name        = COALESCE(${blank(b.companyName)}, company_name),
      reporting_framework = COALESCE(${b.reportingFramework ?? null}, reporting_framework),
      accounting_policies = CASE WHEN ${b.accountingPolicies !== undefined} THEN ${blank(b.accountingPolicies)} ELSE accounting_policies END,
      go_live_date        = COALESCE(${b.goLiveDate ?? null}::date, go_live_date),
      capitalisation_threshold = COALESCE(${threshold === null ? null : fromPaisa(threshold)}::numeric, capitalisation_threshold),
      working_days_per_week    = COALESCE(${wd}::int, working_days_per_week),
      ecl_rates                = COALESCE(${ecl ? JSON.stringify(ecl) : null}::jsonb, ecl_rates),
      updated_at          = now()`
  return getSettings()
}

// ── Chart of accounts ──────────────────────────────────────────────────
const rowToAccount = (r) => ({
  id: r.id, code: r.code, name: r.name, type: r.type, parentId: r.parent_id, systemKey: r.system_key,
  isControl: r.is_control, isContra: r.is_contra, isTax: r.is_tax, currency: r.currency, isActive: r.is_active,
  fsLine: r.fs_line || '', isCurrent: r.is_current, cashFlowClass: r.cash_flow_class, description: r.description || '',
  debit: r.debit != null ? fromPaisa(toPaisa(r.debit)) : '0.00', credit: r.credit != null ? fromPaisa(toPaisa(r.credit)) : '0.00',
  postings: r.postings ?? 0,
})

// With posted totals (posted and reversed entries both count; a reversal cancels its original)
export async function listAccounts() {
  const rows = await sql`
    SELECT a.*, coalesce(sum(l.debit), 0) AS debit, coalesce(sum(l.credit), 0) AS credit, count(l.id)::int AS postings
    FROM fin_accounts a
    LEFT JOIN fin_lines l ON l.account_id = a.id AND EXISTS (SELECT 1 FROM fin_entries e WHERE e.id = l.entry_id AND e.status <> 'Draft')
    GROUP BY a.id ORDER BY a.code`
  return rows.map(rowToAccount)
}

let keyCache = null
export async function accountBySystemKey(key) {
  const load = async () => new Map((await sql`SELECT id, code, name, system_key, is_active FROM fin_accounts WHERE system_key IS NOT NULL`).map((a) => [a.system_key, a]))
  keyCache ??= await load()
  if (!keyCache.has(key)) keyCache = await load()          // an account added by a migration since the cache was filled
  const a = keyCache.get(key)
  if (!a) throw new HttpError(500, `No account has the system key ${key}`)
  return a
}

function accountFields(b, partial) {
  if (!partial || b.code !== undefined) if (!/^[0-9]{4}(-[0-9]{2})?$/.test(b.code || '')) throw new HttpError(400, 'Account code is 4 digits, e.g. 6120, or a sub-account like 4200-01')
  if (!partial || b.name !== undefined) if (!blank(b.name)) throw new HttpError(400, 'Account name is required')
  if (!partial || b.type !== undefined) if (!TYPES.includes(b.type)) throw new HttpError(400, `Type must be one of: ${TYPES.join(', ')}`)
  if (b.cashFlowClass != null && b.cashFlowClass !== '' && !CASH_FLOW.includes(b.cashFlowClass)) throw new HttpError(400, 'Unknown cash-flow class')
}

export async function createAccount(b) {
  accountFields(b)
  const parent = b.parentId ? Number(b.parentId) : null
  try {
    const [r] = await sql`
      INSERT INTO fin_accounts (code, name, type, parent_id, is_contra, fs_line, is_current, cash_flow_class, description)
      VALUES (${b.code}, ${blank(b.name)}, ${b.type}, ${parent}, ${!!b.isContra}, ${blank(b.fsLine)}, ${b.isCurrent ?? null},
              ${blank(b.cashFlowClass)}, ${blank(b.description)})
      RETURNING *`
    keyCache = null
    return rowToAccount(r)
  } catch (err) { if (err.code === '23505') throw new HttpError(400, `Account code ${b.code} already exists`); throw err }
}

export async function updateAccount(id, b) {
  accountFields(b, true)
  const [a] = await sql`SELECT * FROM fin_accounts WHERE id = ${Number(id)}`
  if (!a) throw new HttpError(404, 'Account not found')
  if (b.isActive === true && a.is_tax) {
    const [s] = await sql`SELECT tax_enabled FROM fin_settings`
    if (!s.tax_enabled) throw new HttpError(400, 'Tax accounts switch on with tax (Phase F7)')
  }
  if (b.isActive === false) {
    const [{ bal }] = await sql`SELECT coalesce(sum(l.debit - l.credit), 0) AS bal FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id
                                 WHERE l.account_id = ${a.id} AND e.status <> 'Draft'`
    if (Number(bal) !== 0) throw new HttpError(400, `Account ${a.code} still has a balance; it can be made inactive once it is zero`)
    if (a.system_key && !a.is_tax) throw new HttpError(400, `Account ${a.code} is used by the system and stays active`)
  }
  try {
    const [r] = await run([sql`
      UPDATE fin_accounts SET
        code            = COALESCE(${b.code ?? null}, code),
        name            = COALESCE(${blank(b.name)}, name),
        type            = COALESCE(${b.type ?? null}, type),
        is_active       = COALESCE(${b.isActive ?? null}::boolean, is_active),
        fs_line         = CASE WHEN ${b.fsLine !== undefined} THEN ${blank(b.fsLine)} ELSE fs_line END,
        is_current      = CASE WHEN ${b.isCurrent !== undefined} THEN ${b.isCurrent ?? null}::boolean ELSE is_current END,
        cash_flow_class = CASE WHEN ${b.cashFlowClass !== undefined} THEN ${blank(b.cashFlowClass)} ELSE cash_flow_class END,
        description     = CASE WHEN ${b.description !== undefined} THEN ${blank(b.description)} ELSE description END
      WHERE id = ${a.id} RETURNING *`])
    keyCache = null
    return rowToAccount(r[0])
  } catch (err) { if (err.status === 400 && /already exists/.test(err.message)) throw new HttpError(400, `Account code ${b.code} already exists`); throw err }
}

// ── Periods ────────────────────────────────────────────────────────────
const rowToPeriod = (r) => ({
  id: r.id, fiscalYear: r.fiscal_year, periodNo: r.period_no, name: r.name, startsOn: day(r.starts_on), endsOn: day(r.ends_on),
  isAdjustment: r.is_adjustment, status: r.status, closedBy: r.closed_by_name || null, closedAt: r.closed_at, entries: r.entries ?? 0,
})

export async function listPeriods() {
  const rows = await sql`
    SELECT p.id, p.fiscal_year, p.period_no, p.name, p.starts_on::text, p.ends_on::text, p.is_adjustment, p.status, p.closed_at,
           u.name AS closed_by_name, (SELECT count(*)::int FROM fin_entries e WHERE e.period_id = p.id AND e.status <> 'Draft') AS entries
    FROM fin_periods p LEFT JOIN users u ON u.id = p.closed_by
    ORDER BY p.fiscal_year DESC, p.period_no`
  return rows.map(rowToPeriod)
}

// Open -> Closed -> Locked; reopening a closed period or unlocking needs a reason
export async function setPeriodStatus(id, { status, reason }, user) {
  if (!['Open', 'Closed', 'Locked'].includes(status)) throw new HttpError(400, 'Status must be Open, Closed or Locked')
  const [p] = await sql`SELECT * FROM fin_periods WHERE id = ${Number(id)}`
  if (!p) throw new HttpError(404, 'Period not found')
  if (p.status === status) return rowToPeriod(p)
  const allowed = { Open: ['Closed', 'Locked'], Closed: ['Open', 'Locked'], Locked: ['Closed'] }[p.status]
  if (!allowed.includes(status)) throw new HttpError(400, `A ${p.status.toLowerCase()} period can't go straight to ${status.toLowerCase()}`)
  const backwards = (p.status === 'Closed' && status === 'Open') || (p.status === 'Locked' && status === 'Closed')
  if (backwards && !blank(reason)) throw new HttpError(400, `Say why ${p.name} is being ${p.status === 'Locked' ? 'unlocked' : 'reopened'}`)
  const [r] = await sql`
    UPDATE fin_periods SET status = ${status},
      closed_by = CASE WHEN ${status} = 'Open' THEN NULL ELSE ${user?.id ?? null}::integer END,
      closed_at = CASE WHEN ${status} = 'Open' THEN NULL ELSE now() END
    WHERE id = ${p.id} RETURNING *`
  return rowToPeriod(r)
}

// Adds the next fiscal year after the latest one: 12 months July to June + the adjustment period
export async function addFiscalYear() {
  const [last] = await sql`SELECT max(fiscal_year) AS fy FROM fin_periods`
  const start = last.fy ? Number(last.fy.slice(0, 4)) + 1 : 2026
  const fy = `${start}-${String((start + 1) % 100).padStart(2, '0')}`
  await sql`
    INSERT INTO fin_periods (fiscal_year, period_no, name, starts_on, ends_on, is_adjustment)
    SELECT ${fy}, g, to_char(m, 'Mon YYYY'), m::date, (m + interval '1 month - 1 day')::date, false
    FROM generate_series(1, 12) g, LATERAL (SELECT make_date(${start}, 7, 1) + (g - 1) * interval '1 month' AS m) x`
  await sql`INSERT INTO fin_periods (fiscal_year, period_no, name, starts_on, ends_on, is_adjustment)
            VALUES (${fy}, 13, ${`Adjustments ${fy}`}, make_date(${start + 1}, 6, 30), make_date(${start + 1}, 6, 30), true)`
  return { fiscalYear: fy }
}

// ── Journal entries ────────────────────────────────────────────────────
// lines: [{ accountId, debit, credit, description, partyType, partyId, currency, amountFc, fxRate,
//           orderId, productId, collectionId, consignmentItemId }]
// Drafts may be incomplete (unbalanced, one line); posting checks everything
async function checkLines(lines, { manual, draft = false }) {
  if (!Array.isArray(lines) || lines.length < (draft ? 1 : 2)) throw new HttpError(400, draft ? 'Add at least one line' : 'An entry needs at least two lines')
  if (lines.length > 500) throw new HttpError(400, 'An entry can have up to 500 lines')
  const out = lines.map((l, i) => {
    let debit, credit
    try { debit = toPaisa(l.debit); credit = toPaisa(l.credit) } catch (err) { throw new HttpError(400, `Line ${i + 1}: ${err.message}`) }
    if (debit < 0 || credit < 0) throw new HttpError(400, `Line ${i + 1}: amounts can't be negative; use the other column`)
    if ((debit > 0) === (credit > 0)) throw new HttpError(400, `Line ${i + 1}: enter either a debit or a credit`)
    const currency = (blank(l.currency) || 'PKR').toUpperCase()
    if (!/^[A-Z]{3}$/.test(currency)) throw new HttpError(400, `Line ${i + 1}: currency is a 3-letter code`)
    if (currency !== 'PKR' && (!(Number(l.amountFc) > 0) || !(Number(l.fxRate) > 0))) throw new HttpError(400, `Line ${i + 1}: a ${currency} line needs the ${currency} amount and the rate`)
    if (l.partyType && !PARTIES.includes(l.partyType)) throw new HttpError(400, `Line ${i + 1}: unknown party type`)
    for (const k of ['orderId', 'consignmentItemId']) if (l[k] && !UUID.test(l[k])) throw new HttpError(400, `Line ${i + 1}: bad ${k}`)
    return {
      lineNo: i + 1, accountId: Number(l.accountId), debit, credit, description: blank(l.description),
      partyType: l.partyType || null, partyId: l.partyType ? blank(l.partyId) : null,
      currency, amountFc: currency === 'PKR' ? null : String(l.amountFc), fxRate: currency === 'PKR' ? null : String(l.fxRate),
      orderId: l.orderId || null, productId: l.productId ? Number(l.productId) : null,
      collectionId: l.collectionId ? Number(l.collectionId) : null, consignmentItemId: l.consignmentItemId || null, taxCode: blank(l.taxCode),
      assetId: l.assetId ? Number(l.assetId) : null,
    }
  })
  const d = sumPaisa(out.map((l) => l.debit)), c = sumPaisa(out.map((l) => l.credit))
  if (!draft && d !== c) throw new HttpError(400, `Debits (${fromPaisa(d)}) and credits (${fromPaisa(c)}) must be equal; the difference is ${fromPaisa(Math.abs(d - c))}`)
  const ids = [...new Set(out.map((l) => l.accountId))]
  if (ids.some((x) => !Number.isInteger(x))) throw new HttpError(400, 'Every line needs an account')
  const accounts = await sql`SELECT id, code, name, is_active, is_control FROM fin_accounts WHERE id = ANY(${ids}::int[])`
  for (const l of out) {
    const a = accounts.find((x) => x.id === l.accountId)
    if (!a) throw new HttpError(400, `Line ${l.lineNo}: unknown account`)
    if (!a.is_active) throw new HttpError(400, `Line ${l.lineNo}: account ${a.code} ${a.name} is not active`)
    if (manual && a.is_control) throw new HttpError(400, `Line ${l.lineNo}: ${a.code} ${a.name} is kept by the system and can't be used in a manual journal`)
  }
  return out
}

const lineInsert = (entryId, l) => db()`
  INSERT INTO fin_lines (entry_id, line_no, account_id, debit, credit, currency, amount_fc, fx_rate, party_type, party_id,
                         order_id, product_id, collection_id, consignment_item_id, tax_code, description, asset_id)
  VALUES (${entryId}, ${l.lineNo}, ${l.accountId}, ${fromPaisa(l.debit)}::numeric, ${fromPaisa(l.credit)}::numeric, ${l.currency},
          ${l.amountFc}::numeric, ${l.fxRate}::numeric, ${l.partyType}, ${l.partyId}, ${l.orderId}::uuid, ${l.productId}::int,
          ${l.collectionId}::int, ${l.consignmentItemId}::uuid, ${l.taxCode}, ${l.description}, ${l.assetId ?? null}::int)`

async function nextEntryId() {
  const [r] = await sql`SELECT nextval(pg_get_serial_sequence('fin_entries', 'id'))::bigint AS id`
  return r.id
}

function header(b) {
  const date = b.date || today()
  if (!isDate(date)) throw new HttpError(400, 'Entry date must be a date')
  const entryType = b.entryType || 'JV'
  if (!ENTRY_TYPES.includes(entryType)) throw new HttpError(400, 'Unknown entry type')
  const source = b.source || null
  if (source && (!blank(source.type) || !blank(String(source.id ?? '')))) throw new HttpError(400, 'A source needs a type and an id')
  return { date, entryType, memo: blank(b.memo), source, periodId: b.periodId ? Number(b.periodId) : null }
}

// Creates an entry, posted straight away (post: true) or saved as a draft. Returns the entry.
// b: { date, memo, entryType, source: { type, id, event }, lines, post, periodId, overrideReason, fileIds }
export async function createEntry(b, user) {
  const h = header(b)
  const manual = h.entryType === 'JV' && !h.source
  const lines = await checkLines(b.lines, { manual, draft: !b.post })
  const id = await nextEntryId()
  await run([
    asUser(user),
    db()`INSERT INTO fin_entries (id, entry_type, entry_date, period_id, memo, source_type, source_id, source_event, created_by)
         VALUES (${id}, ${h.entryType}, ${h.date}::date, ${h.periodId}::int, ${h.memo}, ${h.source?.type ?? null}, ${h.source ? String(h.source.id) : null},
                 ${h.source?.event ?? null}, ${user?.id ?? null})`,
    ...lines.map((l) => lineInsert(id, l)),
    ...(b.post ? [db()`UPDATE fin_entries SET status = 'Posted', override_reason = ${blank(b.overrideReason)} WHERE id = ${id}`] : []),
  ])
  for (const f of b.fileIds || []) await attachToEntry(id, f)
  return getEntry(id)
}

// Drafts can be edited and deleted; posted entries never
export async function updateDraft(id, b, user) {
  const [e] = await sql`SELECT id, status, entry_type, source_type FROM fin_entries WHERE id = ${Number(id)}`
  if (!e) throw new HttpError(404, 'Entry not found')
  if (e.status !== 'Draft') throw new HttpError(400, 'Only drafts can be edited. Reverse a posted entry instead.')
  const h = header({ ...b, entryType: e.entry_type })
  const lines = await checkLines(b.lines, { manual: e.entry_type === 'JV' && !e.source_type, draft: !b.post })
  await run([
    asUser(user),
    db()`DELETE FROM fin_lines WHERE entry_id = ${e.id}`,
    db()`UPDATE fin_entries SET entry_date = ${h.date}::date, period_id = ${h.periodId}::int, memo = ${h.memo} WHERE id = ${e.id}`,
    ...lines.map((l) => lineInsert(e.id, l)),
    ...(b.post ? [db()`UPDATE fin_entries SET status = 'Posted', override_reason = ${blank(b.overrideReason)} WHERE id = ${e.id}`] : []),
  ])
  return getEntry(e.id)
}

export async function postDraft(id, { overrideReason } = {}, user) {
  const entry = await getEntry(id)
  if (entry.status !== 'Draft') throw new HttpError(400, 'This entry is already posted')
  await checkLines(entry.lines.map((l) => ({ ...l, accountId: l.accountId })), { manual: entry.entryType === 'JV' && !entry.sourceType })
  await run([asUser(user), db()`UPDATE fin_entries SET status = 'Posted', override_reason = ${blank(overrideReason)} WHERE id = ${entry.id}`])
  return getEntry(entry.id)
}

export async function deleteDraft(id) {
  const [e] = await sql`SELECT status FROM fin_entries WHERE id = ${Number(id)}`
  if (!e) throw new HttpError(404, 'Entry not found')
  if (e.status !== 'Draft') throw new HttpError(400, 'Posted entries are never deleted. Reverse it instead.')
  await run([db()`DELETE FROM fin_entries WHERE id = ${Number(id)}`])
}

// A mirror entry (debits and credits swapped) and the original marked Reversed, in one transaction
export async function reverseEntry(id, { date, reason, overrideReason } = {}, user) {
  const e = await getEntry(id)
  if (e.status === 'Reversed') throw new HttpError(400, `${e.entryNo} has already been reversed`)
  if (e.status !== 'Posted') throw new HttpError(400, 'Only posted entries can be reversed; delete a draft instead')
  if (!blank(reason)) throw new HttpError(400, 'Say why the entry is being reversed')
  const on = date || today()
  if (!isDate(on)) throw new HttpError(400, 'Reversal date must be a date')
  const rid = await nextEntryId()
  const lines = e.lines.map((l, i) => ({
    lineNo: i + 1, accountId: l.accountId, debit: toPaisa(l.credit), credit: toPaisa(l.debit), currency: l.currency,
    amountFc: l.amountFc, fxRate: l.fxRate, partyType: l.partyType, partyId: l.partyId, orderId: l.orderId,
    productId: l.productId, collectionId: l.collectionId, consignmentItemId: l.consignmentItemId, taxCode: l.taxCode,
    description: l.description, assetId: l.assetId,
  }))
  await run([
    asUser(user),
    // Same date: same period (an adjustment-period entry is reversed there, not in June)
    db()`INSERT INTO fin_entries (id, entry_type, entry_date, period_id, memo, source_type, source_id, source_event, reversal_of, created_by)
         VALUES (${rid}, ${e.entryType}, ${on}::date, ${on === e.date ? e.periodId : null}::int, ${`Reversal of ${e.entryNo}: ${blank(reason)}`}, 'reversal', ${String(e.id)}, 'reversed', ${e.id}, ${user?.id ?? null})`,
    ...lines.map((l) => lineInsert(rid, l)),
    db()`UPDATE fin_entries SET status = 'Posted', override_reason = ${blank(overrideReason)} WHERE id = ${rid}`,
    db()`UPDATE fin_entries SET status = 'Reversed', reversed_by = ${rid} WHERE id = ${e.id}`,
  ])
  return getEntry(rid)
}

const rowToLine = (l) => ({
  id: l.id, lineNo: l.line_no, accountId: l.account_id, accountCode: l.code, accountName: l.account_name,
  debit: fromPaisa(toPaisa(l.debit)), credit: fromPaisa(toPaisa(l.credit)), currency: l.currency,
  amountFc: l.amount_fc, fxRate: l.fx_rate, partyType: l.party_type, partyId: l.party_id, orderId: l.order_id,
  productId: l.product_id, collectionId: l.collection_id, consignmentItemId: l.consignment_item_id, taxCode: l.tax_code,
  description: l.description || '', assetId: l.asset_id ?? null,
})

export async function getEntry(id) {
  const [e] = await sql`
    SELECT e.*, e.entry_date::text AS entry_date, p.name AS period_name, p.status AS period_status, cu.name AS created_by_name, pu.name AS posted_by_name,
           ro.entry_no AS reversal_of_no, rb.entry_no AS reversed_by_no
    FROM fin_entries e JOIN fin_periods p ON p.id = e.period_id
    LEFT JOIN users cu ON cu.id = e.created_by LEFT JOIN users pu ON pu.id = e.posted_by
    LEFT JOIN fin_entries ro ON ro.id = e.reversal_of LEFT JOIN fin_entries rb ON rb.id = e.reversed_by
    WHERE e.id = ${Number(id)}`
  if (!e) throw new HttpError(404, 'Entry not found')
  const [lines, files] = await Promise.all([
    sql`SELECT l.*, a.code, a.name AS account_name FROM fin_lines l JOIN fin_accounts a ON a.id = l.account_id WHERE l.entry_id = ${e.id} ORDER BY l.line_no`,
    sql`SELECT f.id, f.name, f.mime, f.size FROM fin_entry_files x JOIN fin_files f ON f.id = x.file_id WHERE x.entry_id = ${e.id} ORDER BY f.id`,
  ])
  const ls = lines.map(rowToLine)
  return {
    id: e.id, entryNo: e.entry_no, entryType: e.entry_type, date: e.entry_date, periodId: e.period_id, periodName: e.period_name,
    periodStatus: e.period_status, memo: e.memo || '', sourceType: e.source_type, sourceId: e.source_id, sourceEvent: e.source_event,
    status: e.status, reversalOf: e.reversal_of ? { id: e.reversal_of, entryNo: e.reversal_of_no } : null,
    reversedBy: e.reversed_by ? { id: e.reversed_by, entryNo: e.reversed_by_no } : null, overrideReason: e.override_reason || '',
    createdBy: e.created_by_name, postedBy: e.posted_by_name, postedAt: e.posted_at, createdAt: e.created_at,
    total: fromPaisa(sumPaisa(ls.map((l) => toPaisa(l.debit)))), lines: ls, files,
  }
}

// { from, to, q (number, memo or account), type, status, limit }
export async function listEntries({ from, to, q, type, status, limit } = {}) {
  const rows = await sql`
    SELECT e.id, e.entry_no, e.entry_type, e.entry_date::text AS entry_date, e.memo, e.status, e.source_type, e.created_at,
           coalesce(sum(l.debit), 0) AS total, count(l.id)::int AS lines
    FROM fin_entries e LEFT JOIN fin_lines l ON l.entry_id = e.id
    WHERE (${isDate(from) ? from : null}::date IS NULL OR e.entry_date >= ${isDate(from) ? from : null}::date)
      AND (${isDate(to) ? to : null}::date IS NULL OR e.entry_date <= ${isDate(to) ? to : null}::date)
      AND (${ENTRY_TYPES.includes(type) ? type : null}::text IS NULL OR e.entry_type = ${ENTRY_TYPES.includes(type) ? type : null})
      AND (${['Draft', 'Posted', 'Reversed'].includes(status) ? status : null}::text IS NULL OR e.status = ${['Draft', 'Posted', 'Reversed'].includes(status) ? status : null})
      AND (${blank(q)}::text IS NULL OR e.entry_no ILIKE '%' || ${blank(q)} || '%' OR e.memo ILIKE '%' || ${blank(q)} || '%'
           OR EXISTS (SELECT 1 FROM fin_lines x JOIN fin_accounts a ON a.id = x.account_id WHERE x.entry_id = e.id
                      AND (a.code LIKE ${blank(q)} || '%' OR a.name ILIKE '%' || ${blank(q)} || '%' OR x.description ILIKE '%' || ${blank(q)} || '%')))
    GROUP BY e.id ORDER BY e.entry_date DESC, e.id DESC
    LIMIT ${Math.min(Number(limit) || 200, 1000)}`
  return rows.map((r) => ({
    id: r.id, entryNo: r.entry_no, entryType: r.entry_type, date: r.entry_date, memo: r.memo || '', status: r.status,
    sourceType: r.source_type, total: fromPaisa(toPaisa(r.total)), lines: r.lines, createdAt: r.created_at,
  }))
}

// ── Opening balances (one OB entry dated the go-live date) ──────────────
const fiscalYearOf = (date) => { const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7)); const s = m >= 7 ? y : y - 1; return `${s}-${String((s + 1) % 100).padStart(2, '0')}` }

export async function getOpening() {
  const s = await getSettings()
  const fy = fiscalYearOf(s.goLiveDate)
  const [e] = await sql`SELECT id FROM fin_entries WHERE source_type = 'opening' AND source_id = ${fy} AND status = 'Posted'`
  return { goLiveDate: s.goLiveDate, fiscalYear: fy, entry: e ? await getEntry(e.id) : null }
}

// lines: [{ accountId, debit, credit }]; zero lines are dropped. Must balance.
export async function postOpening({ lines, fileId, memo }, user) {
  const s = await getSettings()
  const fy = fiscalYearOf(s.goLiveDate)
  const kept = (lines || []).filter((l) => toPaisa(l.debit) || toPaisa(l.credit))
  const asOf = new Date(`${s.goLiveDate}T00:00:00Z`); asOf.setUTCDate(asOf.getUTCDate() - 1)
  return createEntry({
    date: s.goLiveDate, entryType: 'OB', post: true, lines: kept, fileIds: fileId ? [fileId] : [],
    memo: blank(memo) || `Opening balances at ${asOf.toISOString().slice(0, 10)}`,
    source: { type: 'opening', id: fy, event: 'opening' },
  }, user)
}

// ── Month-end jobs ─────────────────────────────────────────────────────
// A job (depreciation, revaluation, allowance ...) works out the entry it wants for a source. If the
// posted one already has those lines it stays; otherwise it is reversed on its own date and the new one
// posted. No lines: the posted one is just reversed.
const lineSig = (ls) => ls.map((l) => [l.accountId, fromPaisa(toPaisa(l.debit || 0)), fromPaisa(toPaisa(l.credit || 0)), l.partyId || '', l.assetId || ''].join('|')).sort().join(',')
async function activeFor(source) {
  const [r] = await sql`SELECT id FROM fin_entries WHERE source_type = ${source.type} AND source_id = ${String(source.id)}
    AND source_event = ${source.event} AND status = 'Posted'`
  return r ? getEntry(r.id) : null
}
// { posted, current, entryId, entryNo }: is the posted entry the one the job would post now?
export async function entryState(source, lines, date) {
  const e = await activeFor(source)
  return { posted: !!e, current: e ? lineSig(e.lines) === lineSig(lines) && (!date || e.date === date) : !lines.length, entryId: e?.id ?? null, entryNo: e?.entryNo ?? null }
}
export async function replaceEntry({ source, date, entryType = 'JV', memo, lines, periodId = null, reason = 'Worked out again' }, user) {
  const e = await activeFor(source)
  if (e && lines.length && lineSig(e.lines) === lineSig(lines) && e.date === date && (!periodId || e.periodId === periodId)) return { entry: e, changed: false }
  if (e) await reverseEntry(e.id, { date: e.date, reason }, user)
  if (!lines.length) return { entry: null, changed: !!e }
  return { entry: await createEntry({ date, entryType, memo, post: true, source, lines, periodId }, user), changed: true }
}
