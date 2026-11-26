// Finance F2b: receipt and screenshot intake (spec 7.6). Files are added to an inbox, read (Claude
// vision, or typed in by hand), classified by rules into a proposed posting, reviewed, then approved:
// approval creates the real expense, staff payment (with its claim) or owner-funding entry through the
// F2a functions, attaches the file and files it away under a dated name. The bank reference keeps the
// same transfer from being entered twice. Money coming in goes onto the order named on the note
// (SO-000228), or found by amount and name; a payment the order screen already recorded just gets the
// receipt. Files can come from a folder: each is known by its fingerprint, so a rescan adds only new ones.
import { neon } from '@neondatabase/serverless'
import { HttpError, blank } from '../db.js'
import { toPaisa, fromPaisa, sumPaisa } from './money.js'
import { createEntry, accountBySystemKey, getSettings } from './ledger.js'
import { getFile, attachToEntry } from './files.js'
import { extractDocument, sanitise, visionConfigured } from './vision.js'
import { createExpense, createSupplier, createClaim, approveClaim, rejectClaim, undoClaimApproval, day, isDate } from './expenses.js'
import { createStaffPayment, staffOwed, salaryOn } from './payroll.js'
import { addPayment, updatePayment } from './sales.js'

let _sql
const db = () => (_sql ??= neon(process.env.DATABASE_URL))
const sql = (...args) => db()(...args)
const money = (v) => (v == null ? null : fromPaisa(toPaisa(v)))

let extractor = extractDocument
export const setExtractor = (fn) => { extractor = fn }          // tests use a stand-in reader
export const intakeStatus = () => ({ visionConfigured: visionConfigured() })

export const KINDS = ['owner_funding', 'staff_payment', 'expense', 'customer_receipt', 'reseller_payment', 'other']
export const POSTABLE = ['owner_funding', 'staff_payment', 'expense', 'customer_receipt']
const OPEN = ['New', 'Ready', 'Needs attention', 'Parked']

// ── Rows ───────────────────────────────────────────────────────────────
const rowToItem = (r) => ({
  id: r.id, fileId: r.file_id, fileName: r.file_name, mime: r.mime, size: r.size, status: r.status,
  extracted: r.extracted, kind: r.kind, proposal: r.proposal, confidence: r.confidence == null ? null : Number(r.confidence),
  issues: r.issues || [], bankRef: r.bank_ref, date: day(r.txn_date), amount: money(r.amount), duplicateOf: r.duplicate_of,
  readBy: r.read_by, readError: r.read_error, resultType: r.result_type, resultId: r.result_id, entryId: r.entry_id,
  entryNo: r.entry_no || '', note: r.note || '', createdAt: r.created_at, reviewedAt: r.reviewed_at, sourcePath: r.source_path || '',
})
const ITEM_SELECT = (where) => sql`
  SELECT i.*, f.name AS file_name, f.mime, f.size, e.entry_no
  FROM fin_intake_items i JOIN fin_files f ON f.id = i.file_id LEFT JOIN fin_entries e ON e.id = i.entry_id
  ${where}`

const GROUPS = { review: ['New', 'Ready', 'Needs attention'], posted: ['Posted'], parked: ['Parked'], closed: ['Rejected', 'Duplicate'] }
export async function listItems({ group = 'review' } = {}) {
  const statuses = GROUPS[group] || GROUPS.review
  const rows = await ITEM_SELECT(sql`WHERE i.status = ANY(${statuses}) ORDER BY coalesce(i.txn_date, i.created_at::date), i.id LIMIT 1000`)
  const [counts] = await sql`SELECT
    count(*) FILTER (WHERE status IN ('New', 'Ready', 'Needs attention'))::int AS review,
    count(*) FILTER (WHERE status = 'New')::int AS new, count(*) FILTER (WHERE status = 'Ready')::int AS ready,
    count(*) FILTER (WHERE status = 'Ready' AND confidence >= 0.85 AND kind = ANY(${POSTABLE}))::int AS bulk,
    count(*) FILTER (WHERE status = 'Posted')::int AS posted, count(*) FILTER (WHERE status = 'Parked')::int AS parked,
    count(*) FILTER (WHERE status IN ('Rejected', 'Duplicate'))::int AS closed
    FROM fin_intake_items`
  return { items: rows.map(rowToItem), counts, ...intakeStatus() }
}
export async function getItem(id) {
  const [r] = await ITEM_SELECT(sql`WHERE i.id = ${Number(id) || 0}`)
  if (!r) throw new HttpError(404, 'Inbox item not found')
  return rowToItem(r)
}

// Files already uploaded (fin_files) -> inbox items; a file already in the inbox is returned as it is.
// Each entry is a file id, or { fileId, sourceHash, sourcePath } for a file picked up from a folder.
const HASH = /^[0-9a-f]{64}$/
export async function addFiles(list = [], user) {
  const rows = list.map((x) => (typeof x === 'object' && x ? x : { fileId: x }))
    .map((x) => ({ fileId: Number(x.fileId), hash: HASH.test(x.sourceHash || '') ? x.sourceHash : null, path: blank(x.sourcePath)?.slice(0, 300) || null }))
    .filter((x) => x.fileId)
  const ids = [...new Set(rows.map((x) => x.fileId))]
  if (!ids.length) throw new HttpError(400, 'Choose the files to add')
  if (ids.length > 200) throw new HttpError(400, 'Add up to 200 files at a time')
  const hashes = rows.map((x) => x.hash).filter(Boolean)
  const existing = new Set((await sql`SELECT file_id FROM fin_intake_items WHERE file_id = ANY(${ids}::bigint[])`).map((r) => Number(r.file_id)))
  const seen = new Set((await sql`SELECT source_hash FROM fin_intake_items WHERE source_hash = ANY(${hashes}::text[])`).map((r) => r.source_hash))
  const fresh = rows.filter((x) => !existing.has(x.fileId) && !(x.hash && seen.has(x.hash)))
  if (fresh.length) await sql`INSERT INTO fin_intake_items (file_id, source_hash, source_path, created_by)
    SELECT f, h, pth, ${user?.id ?? null}::int FROM unnest(${fresh.map((x) => x.fileId)}::bigint[], ${fresh.map((x) => x.hash)}::text[], ${fresh.map((x) => x.path)}::text[]) AS t(f, h, pth)
    ON CONFLICT DO NOTHING`
  return (await ITEM_SELECT(sql`WHERE i.file_id = ANY(${ids}::bigint[]) OR i.source_hash = ANY(${hashes}::text[]) ORDER BY i.id`))
    .map((r) => ({ ...rowToItem(r), alreadyIn: existing.has(Number(r.file_id)) || seen.has(r.source_hash) }))
}
// Which of these file fingerprints (sha256 of the original) are in the inbox already
export async function knownHashes(hashes = []) {
  const list = [...new Set((Array.isArray(hashes) ? hashes : []).filter((h) => HASH.test(h || '')))]
  if (list.length > 5000) throw new HttpError(400, 'Check up to 5,000 files at a time')
  if (!list.length) return { known: [] }
  return { known: (await sql`SELECT source_hash FROM fin_intake_items WHERE source_hash = ANY(${list}::text[])`).map((r) => r.source_hash) }
}

// ── Matching people and words ──────────────────────────────────────────
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '')
function lev(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t }
  }
  return d[b.length]
}
// "ABDUR REHMAN S/O …" matches Abdur Rahman (alias or a near spelling); short names must match exactly.
// Near spellings are for people only: two shops a letter apart are usually different shops.
export function matchName(name, list, names = (x) => [x.name, ...(x.aliases || [])], { fuzzy = true } = {}) {
  const n = norm(name)
  if (n.length < 3) return null
  let best = null
  for (const x of list) {
    for (const cand of names(x)) {
      const c = norm(cand)
      if (c.length < 3) continue
      const score = n === c ? 0 : n.startsWith(c) || c.startsWith(n) ? 0.5 : fuzzy && c.length >= 6 && lev(n.slice(0, c.length + 1), c) <= 2 ? 1 + lev(n.slice(0, c.length + 1), c) : null
      if (score != null && (!best || score < best.score)) best = { x, score }
    }
  }
  return best?.x || null
}
export const director = (name) => (/\bomer\b|omerf/i.test(name || '') ? 'omer' : /\busman\b/i.test(name || '') ? 'usman' : null)
const isKoko = (name) => /koko/i.test(name || '')
// The longest sticker word found in a line wins ("Tailor Salary" -> Salary)
export function labelOf(text, labels) {
  const t = String(text || '').toLowerCase()
  return labels.filter((l) => l.isActive !== false && t.includes(l.label.toLowerCase())).sort((a, b) => b.label.length - a.label.length)[0] || null
}
// The studio week ends on Saturday: "Nov 26 Week 3" is the 3rd Saturday of November 2026
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
export function weekFromNote(text, date) {
  const m = String(text || '').match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(?:'?(\d{2}|\d{4})\b)?[\s,]*week\s*(\d)\b/i)
  if (!m) return null
  const month = MONTHS.indexOf(m[1].toLowerCase())
  const year = m[2] ? Number(m[2].length === 2 ? `20${m[2]}` : m[2]) : Number(String(date || '').slice(0, 4))
  const n = Number(m[3])
  if (!year || n < 1 || n > 5) return null
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay()
  const t = new Date(Date.UTC(year, month, 1 + ((6 - first + 7) % 7) + (n - 1) * 7))
  return t.getUTCMonth() === month ? t.toISOString().slice(0, 10) : null
}
export const daysOffIn = (text) => { const m = String(text || '').match(/(\d+(?:\.5)?)\s*-?\s*days?\s*off/i); return m ? Number(m[1]) : 0 }
export const orderNumbersIn = (text) => [...new Set([...String(text || '').matchAll(/\bSO[-\s]?(\d{3,6})\b/gi)].map((m) => `SO-${m[1].padStart(6, '0')}`))]
export const collectionIn = (text) => { const m = String(text || '').match(/\bC-?(\d{1,2})\b/i); return m ? Number(m[1]) : null }
// On a staff line "Embroidery Salary 12500" is salary, not embroidery work
const staffLabel = (text, labels) => labelOf(text, labels.filter((l) => ['salary', 'advance'].includes(l.kind))) || labelOf(text, labels)
const round2 = (v) => Math.round(Number(v) * 100) / 100

// A note's heading line such as "Nov 26 Week 3" is the period, not a payment part
const PERIOD = /\bweek\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i
const saturdayOnOrBefore = (d) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 1) % 7)); return t.toISOString().slice(0, 10) }
const P = (v) => (v == null || v === '' ? 0 : toPaisa(Number(v).toFixed(2)))

// ── Classification (pure: rules first, the model's reading as input) ───
// ctx: { staff, suppliers, labels } -> { kind, proposal, confidence, issues }
export function classify(e, ctx) {
  const issues = []
  const amount = e.amount ?? e.total
  if (!amount) issues.push('The amount was not read')
  if (!e.date) issues.push('The date was not read')
  const base = { date: e.date, amount: amount == null ? '' : Number(amount).toFixed(2), reference: e.reference || '' }
  const noteText = [e.purpose, ...(e.noteLines || []).map((l) => l.text)].filter(Boolean).join(' ')
  const out = (kind, proposal) => ({ kind, proposal, issues, confidence: Math.round((e.confidence ?? 0.5) * (issues.length ? 0.6 : 1) * 100) / 100 })
  const categoryFrom = (texts, supplier) => {
    // only category words count here ("Final payment" is longer than "Videographer" but names no category)
    const cats = ctx.labels.filter((l) => l.accountId && ['expense', 'claim'].includes(l.kind))
    for (const t of texts) { const l = labelOf(t, cats); if (l) return l.accountId }
    return supplier?.defaultAccountId || null
  }

  if (e.docType === 'bank_transfer') {
    const fromDirector = director(e.fromName), toKoko = isKoko(e.toName), fromKoko = isKoko(e.fromName)
    const funding = labelOf(noteText, ctx.labels)?.kind === 'owner_funding'
    const orders = orderNumbersIn(`${noteText} ${e.purpose || ''}`)
    // Money in: a sender's fee shown on the slip is not Koko's money ("Rs 13,515.66 incl. fee 15.66" -> 13,500)
    let received = amount == null ? null : round2(amount)
    if (toKoko && e.fee > 0 && amount) {
      received = round2(amount - e.fee)
      if (!(e.noteLines || []).some((l) => l.amount != null && P(l.amount) === P(received)))
        issues.push(`Rs ${e.fee} fee on the slip: taken as the sender's, so Koko received ${received}. Check against the statement`)
    }
    const inBase = { ...base, amount: received == null ? '' : received.toFixed(2), fromName: e.fromName || '' }
    // An order number on the note wins, even when a director paid it in for the customer
    if (toKoko && orders.length) {
      if (orders.length > 1) issues.push(`More than one order on the note (${orders.join(', ')}): enter the others by hand`)
      return out('customer_receipt', { ...inBase, orderNumber: orders[0], via: fromDirector || '' })
    }
    if (toKoko && (fromDirector || funding)) {
      if (!fromDirector) issues.push('Say which director added the funds')
      return out('owner_funding', { ...base, director: fromDirector || '', into: 'bank' })
    }
    if (toKoko && /collage/i.test(`${e.fromName} ${noteText}`)) {
      issues.push('A reseller payment is recorded on Resellers › Fashion Collage › Payments, against its statement: attach this file there')
      return out('reseller_payment', inBase)
    }
    if (toKoko) return out('customer_receipt', inBase)
    const paidFrom = fromKoko || !fromDirector ? 'bank' : `director_${fromDirector}`
    if (!fromKoko && !fromDirector) issues.push(`Check who paid: "${e.fromName || 'unknown'}" is neither Koko nor a director`)
    const staff = matchName(e.toName, ctx.staff.filter((s) => s.isActive !== false))
    if (staff) {
      const parts = []
      const week = weekFromNote(noteText, e.date)
      for (const l of e.noteLines || []) {
        if (l.amount == null) continue
        const lab = staffLabel(l.text, ctx.labels)
        if (!lab || lab.kind === 'ignore') { if (!lab && !PERIOD.test(l.text)) issues.push(`Note line "${l.text}" not understood`); continue }
        if (lab.kind === 'salary') parts.push({ kind: 'salary', amount: Number(l.amount).toFixed(2), weekEnding: week, daysOff: daysOffIn(l.text) || daysOffIn(noteText) })
        else if (lab.kind === 'advance') parts.push({ kind: 'advance', amount: Number(l.amount).toFixed(2) })
        else if (lab.kind === 'claim' || lab.kind === 'expense') parts.push({ kind: 'claim', amount: Number(l.amount).toFixed(2), lines: [{ accountId: lab.accountId || '', description: l.text, amount: Number(l.amount).toFixed(2) }] })
      }
      if (!parts.length && amount) { parts.push({ kind: 'salary', amount: Number(amount).toFixed(2), weekEnding: week, daysOff: daysOffIn(noteText) }); issues.push('No note on the transfer: taken as salary') }
      if (/overtime/i.test(noteText)) issues.push('The note mentions overtime: check whether part of it is wages')
      return out('staff_payment', { ...base, staffId: staff.id, staffName: staff.name, paidFrom, parts })
    }
    const supplier = matchName(e.toName, ctx.suppliers.filter((s) => s.isActive !== false), (x) => [x.name], { fuzzy: false })
    const accountId = categoryFrom([noteText, e.suggestedCategory], supplier)
    if (!accountId) issues.push('Choose a category')
    return out('expense', { ...base, paidFrom, supplierId: supplier?.id || '', supplierName: supplier ? supplier.name : e.toName || '', accountId: accountId || '',
      description: noteText || e.purpose || '', collectionNo: collectionIn(noteText) })
  }
  if (e.docType === 'receipt' || e.docType === 'bill') {
    const supplier = matchName(e.shop, ctx.suppliers.filter((s) => s.isActive !== false), (x) => [x.name], { fuzzy: false })
    const accountId = categoryFrom([...(e.items || []).map((i) => i.description), e.suggestedCategory, e.shop], supplier)
    if (!accountId) issues.push('Choose a category')
    const items = (e.items || []).map((i) => i.description).filter(Boolean)
    return out('expense', { ...base, paidFrom: 'cash', supplierId: supplier?.id || '', supplierName: supplier ? supplier.name : e.shop || '', accountId: accountId || '',
      description: items.length ? items.slice(0, 6).join(', ') + (items.length > 6 ? '…' : '') : e.suggestedCategory || '' })
  }
  issues.push('Not recognised as a transfer, receipt or bill')
  return out('other', base)
}

async function context() {
  const [staff, suppliers, labels] = await Promise.all([
    sql`SELECT id, name, aliases, is_active FROM fin_staff`,
    sql`SELECT id, name, default_account_id, is_active FROM fin_suppliers`,
    sql`SELECT label, kind, account_id, is_active FROM fin_intake_labels`,
  ])
  return {
    staff: staff.map((s) => ({ id: s.id, name: s.name, aliases: s.aliases || [], isActive: s.is_active })),
    suppliers: suppliers.map((s) => ({ id: s.id, name: s.name, defaultAccountId: s.default_account_id, isActive: s.is_active })),
    labels: labels.map((l) => ({ label: l.label, kind: l.kind, accountId: l.account_id, isActive: l.is_active })),
  }
}

// Fills in what the rules can't know from the picture alone; returns the proposal and what to check.
// Staff: links each salary to the posted payroll week it pays, or books that week's wage directly when
// no week is posted (checked against the salary less days off). Money in: finds the order, and a payment
// the order screen already recorded (the receipt is then attached to it, not added again).
async function enrich(kind, p0) {
  let p = { ...p0 }
  const warnings = []
  const { goLiveDate, workingDaysPerWeek: wd } = await getSettings()
  if (POSTABLE.includes(kind) && kind !== 'customer_receipt' && isDate(p.date) && goLiveDate && p.date < goLiveDate)
    warnings.push(`Dated before the books start (${goLiveDate}): keep it as evidence for the opening balances rather than posting it`)

  if (kind === 'staff_payment' && p.staffId) {
    const owed = await staffOwed(p.staffId)
    const usedWeeks = new Set(), usedClaims = new Set()
    const parts = []
    for (const x of p.parts || []) {
      if (x.kind === 'salary' && !x.payrollLineId) {
        const due = owed.weeks.filter((w) => !usedWeeks.has(w.payrollLineId) && P(w.due) === P(x.amount))
        const w = due.find((d) => d.weekEnding === x.weekEnding) || due[0]
        if (w) { usedWeeks.add(w.payrollLineId); parts.push({ ...x, payrollLineId: w.payrollLineId, weekEnding: w.weekEnding, direct: false }); continue }
        const we = isDate(x.weekEnding) ? x.weekEnding : isDate(p.date) ? saturdayOnOrBefore(p.date) : null
        if (!we) { parts.push(x); continue }
        const [posted] = await sql`SELECT 1 FROM fin_payroll_lines l JOIN fin_payroll_runs r ON r.id = l.run_id AND r.status = 'Posted'
          WHERE l.staff_id = ${Number(p.staffId)} AND r.week_ending = ${we}::date`
        if (posted) { warnings.push(`The payroll week ending ${we} is posted: link the salary to it`); parts.push({ ...x, weekEnding: we, direct: false }); continue }
        const full = await salaryOn(Number(p.staffId), we), off = Number(x.daysOff) || 0
        const expected = full ? Math.round((full * Math.max(0, wd - off)) / wd) : 0
        if (!full) warnings.push(`${p.staffName || 'This person'} has no weekly salary set for the week ending ${we}`)
        else if (Math.abs(expected - P(x.amount)) >= 100)
          warnings.push(`Salary for the week ending ${we} would be ${fromPaisa(expected)}${off ? ` (${off} of ${wd} days off)` : ''}, not ${fromPaisa(P(x.amount))}`)
        parts.push({ ...x, weekEnding: we, direct: true, expected: full ? fromPaisa(expected) : null })
        continue
      }
      if (x.kind === 'claim' && !x.claimId) {
        const c = owed.claims.find((c) => !usedClaims.has(c.id) && P(c.total) === P(x.amount))
        if (c) { usedClaims.add(c.id); parts.push({ ...x, claimId: c.id, claimWeekEnding: c.weekEnding }); continue }
      }
      parts.push(x)
    }
    p = { ...p, parts }
  }

  if (kind === 'customer_receipt') {
    let o = null
    p.candidates = []
    if (blank(p.orderNumber)) {
      const no = orderNumbersIn(p.orderNumber)[0] || p.orderNumber.trim()
      ;[o] = await sql`SELECT o.id, o.order_number, o.order_type, o.balance_due_pkr, c.name FROM orders o JOIN customers c ON c.id = o.customer_id
        WHERE upper(o.order_number) = upper(${no})`
      if (!o) warnings.push(`There is no order ${no}`)
    } else if (P(p.amount) > 0) {
      // No order number: open orders with exactly this balance, the payer's name deciding between them
      const rows = await sql`SELECT o.id, o.order_number, o.order_type, o.balance_due_pkr, c.name FROM orders o JOIN customers c ON c.id = o.customer_id
        WHERE o.order_type = 'Sale' AND o.status NOT IN ('Cancelled', 'Returned') AND o.balance_due_pkr = ${fromPaisa(P(p.amount))}::numeric
        ORDER BY o.order_date DESC NULLS LAST LIMIT 10`
      const named = blank(p.fromName) ? rows.filter((r) => matchName(p.fromName, [{ name: r.name }])) : []
      if (named.length === 1) o = named[0]
      else {
        p.candidates = (named.length ? named : rows).slice(0, 6).map((r) => ({ orderNumber: r.order_number, customer: r.name, balance: fromPaisa(P(r.balance_due_pkr)) }))
        warnings.push(rows.length ? `Choose the order: ${rows.length} open order${rows.length === 1 ? ' has' : 's have'} a balance of ${fromPaisa(P(p.amount))}` : 'No open order has this balance: type the order number')
      }
    }
    p = { ...p, orderId: o?.id || '', orderNumber: o?.order_number || p.orderNumber || '', customer: o?.name || '', balance: o ? fromPaisa(P(o.balance_due_pkr)) : '', attachTo: null, attachInfo: '' }
    if (o) {
      if (o.order_type === 'PR') warnings.push(`${o.order_number} is a PR / gift order: it takes no payments`)
      // Already recorded (the order screen adds a payment when an order is paid)? Then the receipt goes onto it
      // (dated the day it was entered, so up to 45 days off when its method was never confirmed)
      const [same] = isDate(p.date) && P(p.amount) > 0 ? await sql`SELECT id, paid_on::text AS paid_on FROM customer_payments cp
        WHERE cp.order_id = ${o.id} AND cp.amount = ${fromPaisa(P(p.amount))}::numeric
          AND abs(cp.paid_on - ${p.date}::date) <= CASE WHEN cp.method_confirmed THEN 7 ELSE 45 END
          AND NOT EXISTS (SELECT 1 FROM customer_payment_files f WHERE f.payment_id = cp.id)
        ORDER BY abs(cp.paid_on - ${p.date}::date), cp.id LIMIT 1` : []
      if (same) p = { ...p, attachTo: same.id, attachInfo: `Already recorded on ${o.order_number} (${same.paid_on}): the receipt is attached to that payment${same.paid_on !== p.date ? `, which is redated to ${p.date}` : ''}` }
      else if (P(p.amount) > P(o.balance_due_pkr) + 100) warnings.push(`More than the balance due on ${o.order_number} (${fromPaisa(P(o.balance_due_pkr))}): check it isn't paid already`)
    }
  }

  if (kind === 'expense' && p.collectionNo && !p.collectionId) {
    const [c] = await sql`SELECT id, name FROM collections WHERE id = ${Number(p.collectionNo)}`
    if (c) p = { ...p, collectionId: c.id, collectionName: c.name }
  }
  return { proposal: p, warnings }
}

// What must be true before approval; returns the issues (empty = ready)
export function checkProposal(kind, p = {}) {
  const issues = []
  if (!POSTABLE.includes(kind)) return [kind === 'reseller_payment' ? "Record it on the reseller's Payments page" : 'Choose what this is']
  if (!isDate(p.date)) issues.push('Enter the date')
  let amount = 0
  try { amount = toPaisa(p.amount) } catch { issues.push('The amount is not a number') }
  if (amount <= 0) issues.push('Enter the amount')
  if (kind === 'owner_funding' && !['omer', 'usman'].includes(p.director)) issues.push('Choose the director')
  if (kind === 'customer_receipt' && !p.orderId) issues.push('Choose the order')
  if (kind === 'expense') {
    if (!p.accountId) issues.push('Choose a category')
    if (!p.paidFrom) issues.push('Say how it was paid')
    if (p.paidFrom === 'unpaid' && !p.supplierId && !blank(p.supplierName)) issues.push('A bill not yet paid needs the supplier')
  }
  if (kind === 'staff_payment') {
    if (!p.staffId) issues.push('Choose who was paid')
    const parts = p.parts || []
    if (!parts.length) issues.push('Say what the payment was for')
    let sum = 0
    for (const [i, x] of parts.entries()) {
      let a = 0; try { a = toPaisa(x.amount) } catch { issues.push(`Part ${i + 1}: amount is not a number`) }
      sum += a
      if (x.kind === 'claim' && !x.claimId) {
        const lines = x.lines || []
        if (!lines.length || lines.some((l) => !l.accountId)) issues.push(`Part ${i + 1}: choose a category for each claim line`)
        let ls = 0; for (const l of lines) { try { ls += toPaisa(l.amount) } catch { ls = NaN } }
        if (ls !== a) issues.push(`Part ${i + 1}: the claim lines add up to ${Number.isNaN(ls) ? '?' : fromPaisa(ls)}, not ${fromPaisa(a)}`)
      }
    }
    if (amount && sum !== amount) issues.push(`The parts add up to ${fromPaisa(sum)}, not ${fromPaisa(amount)}`)
  }
  return issues
}

// The same transfer already recorded? (another inbox item, a staff payment, an expense or a journal)
async function findDuplicate(ref, selfId) {
  if (!ref) return null
  const [i] = await sql`SELECT id FROM fin_intake_items WHERE bank_ref = ${ref} AND id <> ${selfId} AND status NOT IN ('Rejected', 'Duplicate') LIMIT 1`
  if (i) return { intakeId: i.id, text: `Same bank reference as inbox item #${i.id}` }
  const [p] = await sql`SELECT p.id, e.entry_no FROM fin_staff_payments p LEFT JOIN fin_entries e ON e.id = p.entry_id WHERE p.reference = ${ref} AND p.status = 'Posted' LIMIT 1`
  if (p) return { text: `Already recorded as a staff payment (${p.entry_no})` }
  const [x] = await sql`SELECT x.id, e.entry_no FROM fin_expenses x LEFT JOIN fin_entries e ON e.id = x.entry_id WHERE x.reference = ${ref} AND x.status = 'Posted' LIMIT 1`
  if (x) return { text: `Already recorded as an expense (${x.entry_no})` }
  const [cp] = await sql`SELECT o.order_number FROM customer_payments p JOIN orders o ON o.id = p.order_id WHERE p.reference = ${ref} LIMIT 1`
  if (cp) return { text: `Already recorded as a payment on ${cp.order_number}` }
  const [j] = await sql`SELECT entry_no FROM fin_entries WHERE status = 'Posted' AND memo ILIKE ${`%${ref}%`} LIMIT 1`
  if (j) return { text: `Already in the books (${j.entry_no})` }
  return null
}

// warnings: what the reader noticed (kept until the item is next edited); checkProposal adds what blocks approval
async function store(item, { extracted, kind, proposal, readBy, confidence, warnings = [] }) {
  const issues = [...new Set([...warnings, ...checkProposal(kind, proposal)])]
  const dup = await findDuplicate(proposal?.reference || null, item.id)
  const status = dup ? 'Duplicate' : issues.length ? 'Needs attention' : 'Ready'
  const date = isDate(proposal?.date) ? proposal.date : null
  let amount = null; try { amount = proposal?.amount ? fromPaisa(toPaisa(proposal.amount)) : null } catch { amount = null }
  await sql`
    UPDATE fin_intake_items SET
      extracted = coalesce(${extracted ? JSON.stringify(extracted) : null}::jsonb, extracted), kind = ${kind}, proposal = ${JSON.stringify(proposal || {})}::jsonb,
      confidence = coalesce(${confidence ?? null}::numeric, confidence), issues = ${dup ? [dup.text] : issues}::text[],
      bank_ref = ${dup ? null : blank(proposal?.reference)}, txn_date = ${date}::date, amount = ${amount}::numeric, duplicate_of = ${dup?.intakeId ?? null}::int,
      read_by = coalesce(${readBy ?? null}, read_by), read_error = NULL, read_at = CASE WHEN ${!!readBy} THEN now() ELSE read_at END, status = ${status}
    WHERE id = ${item.id}`
  return getItem(item.id)
}

// Reads the file (vision), classifies it and proposes the posting
export async function readItem(id) {
  const item = await getItem(id)
  if (!['New', 'Ready', 'Needs attention', 'Parked'].includes(item.status)) throw new HttpError(400, `This item is ${item.status.toLowerCase()}`)
  let extracted
  try { extracted = sanitise(await extractor(await getFile(item.fileId))) } catch (err) {
    await sql`UPDATE fin_intake_items SET read_error = ${err.message}, read_at = now() WHERE id = ${item.id}`
    throw err
  }
  const c = classify(extracted, await context())
  const r = await enrich(c.kind, c.proposal)
  return store(item, { extracted, kind: c.kind, proposal: r.proposal, readBy: 'vision', confidence: c.confidence, warnings: [...c.issues, ...r.warnings] })
}

// Saves edits from review: either typed-in fields (classified again) or a changed kind / proposal
export async function saveItem(id, { extracted, kind, proposal } = {}) {
  const item = await getItem(id)
  if (!OPEN.includes(item.status) && item.status !== 'Duplicate') throw new HttpError(400, `This item is ${item.status.toLowerCase()}`)
  if (extracted) {
    const e = sanitise({ ...extracted, confidence: 1 })
    const c = classify(e, await context())
    const r = await enrich(c.kind, c.proposal)
    return store(item, { extracted: e, kind: c.kind, proposal: r.proposal, readBy: 'hand', confidence: 1, warnings: [...c.issues, ...r.warnings] })
  }
  if (kind && !KINDS.includes(kind)) throw new HttpError(400, 'Unknown kind')
  const k = kind || item.kind || 'other'
  // A changed order number or collection is looked up again
  if (['customer_receipt', 'expense'].includes(k)) { const r = await enrich(k, proposal || item.proposal || {}); return store(item, { kind: k, proposal: r.proposal, warnings: r.warnings }) }
  return store(item, { kind: k, proposal: proposal || item.proposal || {} })
}

export async function setItemStatus(id, status, { reason } = {}, user) {
  const item = await getItem(id)
  if (!OPEN.includes(item.status) && item.status !== 'Duplicate') throw new HttpError(400, `This item is ${item.status.toLowerCase()}`)
  if (status === 'Rejected' && !blank(reason)) throw new HttpError(400, 'Say why it is rejected')
  await sql`UPDATE fin_intake_items SET status = ${status}, note = ${blank(reason)}, bank_ref = CASE WHEN ${status} = 'Rejected' THEN NULL ELSE bank_ref END,
    reviewed_by = ${user?.id ?? null}, reviewed_at = now() WHERE id = ${item.id}`
  return getItem(item.id)
}
// Parked or rejected items come back to the queue
export async function reopenItem(id) {
  const item = await getItem(id)
  if (!['Parked', 'Rejected', 'Duplicate'].includes(item.status)) throw new HttpError(400, 'Only parked, rejected or duplicate items can be reopened')
  await sql`UPDATE fin_intake_items SET status = 'New', note = NULL, duplicate_of = NULL WHERE id = ${item.id}`
  return item.proposal ? store(await getItem(item.id), { kind: item.kind || 'other', proposal: item.proposal }) : getItem(item.id)
}

// ── Approval: create the real records, then file the document away ─────
const TYPE_CODE = { owner_funding: 'BK', staff_payment: 'PY', expense: 'EX', customer_receipt: 'RC' }
async function fileAway(item, kind, p) {
  const ext = (item.fileName.match(/\.(\w{2,5})$/) || [, item.mime === 'application/pdf' ? 'pdf' : 'jpg'])[1].toLowerCase()
  const name = `${p.date}_${TYPE_CODE[kind]}_${(p.reference || 'noref').replace(/[^\w-]/g, '')}_${Math.round(toPaisa(p.amount) / 100)}.${ext}`
  const folder = `${kind === 'expense' ? 'Receipts' : kind === 'staff_payment' ? 'Payroll' : kind === 'customer_receipt' ? 'Customer payments' : 'Payments'}/${p.date.slice(0, 7)}`
  await sql`UPDATE fin_files SET name = ${name}, folder = ${folder} WHERE id = ${item.fileId}`
}

export async function approveItem(id, b = {}, user) {
  const item = await getItem(id)
  if (!['Ready', 'Needs attention', 'Parked', 'New'].includes(item.status)) throw new HttpError(400, `This item is ${item.status.toLowerCase()}`)
  const kind = b.kind || item.kind
  const p = b.proposal || item.proposal || {}
  const issues = checkProposal(kind, p)
  if (issues.length) { await store(item, { kind, proposal: p }); throw new HttpError(400, issues.join('; ')) }
  const dup = await findDuplicate(blank(p.reference), item.id)
  if (dup) { await store(item, { kind, proposal: p }); throw new HttpError(400, dup.text) }
  const ref = blank(p.reference)
  const files = [item.fileId]
  let result

  if (kind === 'owner_funding') {
    const into = (await accountBySystemKey(p.into === 'cash' ? 'cash_studio' : 'bank_baf')).id
    const dir = (await accountBySystemKey(`director_${p.director}`)).id
    const who = p.director === 'omer' ? 'Omer' : 'Usman'
    const e = await createEntry({
      date: p.date, entryType: 'BK', memo: `Funds added by ${who}${ref ? `, ref ${ref}` : ''}`, post: true, fileIds: files,
      source: { type: 'intake', id: item.id, event: 'posted' },
      lines: [{ accountId: into, debit: p.amount, description: ref ? `Ref ${ref}` : null }, { accountId: dir, credit: p.amount, description: `Funds added by ${who}`, partyType: 'director', partyId: p.director }],
    }, user)
    result = { type: 'entry', id: e.id, entryId: e.id }
  }

  if (kind === 'expense') {
    let supplierId = p.supplierId || null
    if (!supplierId && blank(p.supplierName)) {
      const [found] = await sql`SELECT id FROM fin_suppliers WHERE lower(name) = lower(${p.supplierName.trim()})`
      supplierId = found?.id || (await createSupplier({ name: p.supplierName, defaultAccountId: p.accountId })).id
    }
    const x = await createExpense({ date: p.date, amount: p.amount, accountId: p.accountId, paidFrom: p.paidFrom, supplierId, description: p.description,
      reference: ref, collectionId: p.collectionId || null, fileIds: files }, user)
    result = { type: 'expense', id: x.id, entryId: x.entryId }
  }

  if (kind === 'customer_receipt') {
    let payId
    if (p.attachTo) {
      // The order screen recorded this payment already: the receipt confirms it and carries the reference
      const [cp] = await sql`SELECT id, reference FROM customer_payments WHERE id = ${Number(p.attachTo)} AND order_id = ${p.orderId}`
      if (!cp) throw new HttpError(400, 'That payment is no longer on the order: read the file again')
      // ...and its true date: the order screen dates a payment the day it was entered
      await updatePayment(cp.id, { reference: cp.reference || ref, paidOn: p.date, method: 'bank' }, user)
      payId = cp.id
    } else {
      const via = p.via === 'omer' ? 'Omer' : p.via === 'usman' ? 'Usman' : ''
      await addPayment(p.orderId, { paidOn: p.date, amount: p.amount, method: 'bank', reference: ref,
        notes: [via && `Paid in by ${via} for the customer`, 'From the inbox'].filter(Boolean).join('; ') }, user)
      ;[{ id: payId }] = await sql`SELECT id FROM customer_payments WHERE order_id = ${p.orderId} ORDER BY id DESC LIMIT 1`
    }
    await sql`INSERT INTO customer_payment_files (payment_id, file_id, created_by) VALUES (${payId}, ${item.fileId}, ${user?.id ?? null}) ON CONFLICT DO NOTHING`
    const [e] = await sql`SELECT id FROM fin_entries WHERE source_type = 'customer_payment' AND source_id = ${String(payId)} AND status = 'Posted' ORDER BY id DESC LIMIT 1`
    if (e) await attachToEntry(e.id, item.fileId)
    result = { type: 'customer_payment', id: payId, entryId: e?.id ?? null }
  }

  if (kind === 'staff_payment') {
    // Claim parts not yet in the books become a claim (dated the week the money was spent), approved here
    const made = []
    try {
      const parts = []
      for (const x of p.parts) {
        if (x.kind === 'claim' && !x.claimId) {
          const c = await createClaim({ staffId: p.staffId, weekEnding: saturdayOnOrBefore(p.date), notes: `From the transfer${ref ? ` ref ${ref}` : ''}`, fileIds: files,
            lines: x.lines.map((l) => ({ accountId: l.accountId, description: l.description, amount: l.amount })) }, user)
          made.push(c.id)
          await approveClaim(c.id, user)
          parts.push({ kind: 'claim', claimId: c.id, amount: x.amount })
        } else parts.push({ kind: x.kind, amount: x.amount, claimId: x.claimId || null, payrollLineId: x.payrollLineId || null,
          direct: x.kind === 'salary' && !x.payrollLineId && !!x.direct, weekEnding: x.weekEnding || null, daysOff: x.daysOff || null })
      }
      const pay = await createStaffPayment({ staffId: p.staffId, paidOn: p.date, paidFrom: p.paidFrom || 'bank', amount: p.amount, reference: ref, parts, fileIds: files, notes: 'From the inbox' }, user)
      result = { type: 'staff_payment', id: pay.id, entryId: pay.entryId }
    } catch (err) {
      for (const c of made) {
        await undoClaimApproval(c, { reason: 'Inbox approval did not complete' }, user).catch(() => {})
        await rejectClaim(c, { reason: 'Inbox approval did not complete' }).catch(() => {})
      }
      throw err
    }
  }

  await fileAway(item, kind, p)
  await sql`UPDATE fin_intake_items SET status = 'Posted', kind = ${kind}, proposal = ${JSON.stringify(p)}::jsonb, issues = '{}', bank_ref = ${ref},
    txn_date = ${p.date}::date, amount = ${fromPaisa(toPaisa(p.amount))}::numeric, result_type = ${result.type}, result_id = ${result.id}, entry_id = ${result.entryId},
    reviewed_by = ${user?.id ?? null}, reviewed_at = now() WHERE id = ${item.id}`
  return getItem(item.id)
}

// Approves every ready item the reader was sure about
export async function approveReady({ minConfidence = 0.85 } = {}, user) {
  const rows = await sql`SELECT id FROM fin_intake_items WHERE status = 'Ready' AND confidence >= ${minConfidence} AND kind = ANY(${POSTABLE}) ORDER BY txn_date, id`
  const posted = [], failed = []
  for (const r of rows) {
    try { posted.push(await approveItem(r.id, {}, user)) } catch (err) { failed.push({ id: r.id, error: err.message }) }
  }
  return { posted: posted.length, failed }
}

// ── Sticker-note words ─────────────────────────────────────────────────
export async function listLabels() {
  const rows = await sql`SELECT l.*, a.code, a.name AS account_name FROM fin_intake_labels l LEFT JOIN fin_accounts a ON a.id = l.account_id ORDER BY l.kind, lower(l.label)`
  return rows.map((l) => ({ id: l.id, label: l.label, kind: l.kind, accountId: l.account_id, accountCode: l.code || '', accountName: l.account_name || '', isActive: l.is_active }))
}
export async function saveLabel(id, b) {
  const label = blank(b.label)
  if (!label) throw new HttpError(400, 'Type the word as it is written on the note')
  if (!['salary', 'claim', 'advance', 'expense', 'owner_funding', 'ignore'].includes(b.kind)) throw new HttpError(400, 'Choose what the word means')
  if (['claim', 'expense'].includes(b.kind) && !b.accountId) throw new HttpError(400, 'Choose the category for this word')
  const accountId = ['claim', 'expense'].includes(b.kind) ? Number(b.accountId) : null
  try {
    if (id) await sql`UPDATE fin_intake_labels SET label = ${label}, kind = ${b.kind}, account_id = ${accountId}, is_active = ${b.isActive !== false} WHERE id = ${Number(id)}`
    else await sql`INSERT INTO fin_intake_labels (label, kind, account_id) VALUES (${label}, ${b.kind}, ${accountId})`
  } catch (err) { if (err.code === '23505') throw new HttpError(400, `"${label}" is already on the list`); throw err }
  return listLabels()
}
