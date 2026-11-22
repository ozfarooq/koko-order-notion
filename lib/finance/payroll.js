// Finance F2a: studio staff, weekly payroll and payments to staff.
// Wages are booked when the week's payroll is posted (Dr direct labour or admin salaries, Cr wages
// payable); a week that runs over a month end is split by working days so each month carries its own
// cost (IAS 19). Paying someone is a separate event: one transfer can settle salary, an approved
// studio claim and/or give an advance, e.g. 17,500 salary + 5,700 market spend = 23,200.
import { neon } from '@neondatabase/serverless'
import { HttpError, blank } from '../db.js'
import { toPaisa, fromPaisa, sumPaisa } from './money.js'
import { createEntry, reverseEntry, accountBySystemKey, getSettings } from './ledger.js'
import { attachToEntry } from './files.js'
import { isDate, today, day, payAccount, amountPaisa } from './expenses.js'

let _sql
const db = () => (_sql ??= neon(process.env.DATABASE_URL))
const sql = (...args) => db()(...args)
const money = (v) => fromPaisa(toPaisa(v ?? 0))
const UUID = /^[0-9a-f-]{36}$/i
const addDays = (d, n) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) }
const monthEnd = (d) => { const t = new Date(`${d.slice(0, 7)}-01T00:00:00Z`); t.setUTCMonth(t.getUTCMonth() + 1, 0); return t.toISOString().slice(0, 10) }

// The working days (Sunday off) of the week ending on weekEnding, grouped by month:
// [{ date: last working day's posting date, days }]. Earlier months post on their month end.
export function weekParts(weekEnding) {
  const parts = new Map()
  for (let i = 6; i >= 0; i--) {
    const d = addDays(weekEnding, -i)
    if (new Date(`${d}T00:00:00Z`).getUTCDay() === 0) continue
    const m = d.slice(0, 7)
    parts.set(m, (parts.get(m) || 0) + 1)
  }
  return [...parts].map(([m, days]) => ({ month: m, days, date: m === weekEnding.slice(0, 7) ? weekEnding : monthEnd(`${m}-01`) }))
}
// Splits paisa by weights; rounding goes to the last part so the parts add up exactly
export function splitPaisa(total, weights) {
  const sum = weights.reduce((s, w) => s + w, 0)
  const out = weights.map((w) => Math.floor((total * w) / sum))
  out[out.length - 1] += total - sumPaisa(out)
  return out
}

// ── Staff ──────────────────────────────────────────────────────────────
const maskCnic = (c) => (c ? `•••••-•••••••-${String(c).replace(/\D/g, '').slice(-1)}` : '')
const rowToStaff = (s, { full = false } = {}) => ({
  id: s.id, name: s.name, roleTitle: s.role_title, payType: s.pay_type, isProduction: s.is_production,
  hoursPerDay: s.hours_per_day == null ? null : Number(s.hours_per_day), cnic: full ? s.cnic || '' : maskCnic(s.cnic),
  paymentMethod: s.payment_method || '', isActive: s.is_active, notes: s.notes || '', aliases: s.aliases || [],
  weeklySalary: s.weekly_salary == null ? null : money(s.weekly_salary), salaryFrom: day(s.salary_from),
  owedWages: money(s.owed_wages), owedClaims: money(s.owed_claims), advances: money(s.advances),
})
// Balances per person from the ledger: wages payable, claims payable (credit), advances (debit)
const STAFF_SELECT = (where) => sql`
  SELECT s.*, cur.weekly_salary, cur.effective_from AS salary_from,
    coalesce(bal.owed_wages, 0) AS owed_wages, coalesce(bal.owed_claims, 0) AS owed_claims, coalesce(bal.advances, 0) AS advances
  FROM fin_staff s
  LEFT JOIN LATERAL (SELECT weekly_salary, effective_from FROM fin_staff_salary h WHERE h.staff_id = s.id AND h.effective_from <= ${today()}::date
                     ORDER BY effective_from DESC LIMIT 1) cur ON true
  LEFT JOIN LATERAL (
    SELECT sum(CASE WHEN a.system_key = 'wages_payable' THEN l.credit - l.debit END) AS owed_wages,
           sum(CASE WHEN a.system_key = 'ap_staff_claims' THEN l.credit - l.debit END) AS owed_claims,
           sum(CASE WHEN a.system_key = 'staff_advances' THEN l.debit - l.credit END) AS advances
    FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'Draft' JOIN fin_accounts a ON a.id = l.account_id
    WHERE l.party_type = 'staff' AND l.party_id = s.id::text) bal ON true
  ${where}`

export async function listStaff() {
  return (await STAFF_SELECT(sql`ORDER BY s.is_active DESC, s.id`)).map((s) => rowToStaff(s))
}
export async function getStaff(id) {
  const [s] = await STAFF_SELECT(sql`WHERE s.id = ${Number(id) || 0}`)
  if (!s) throw new HttpError(404, 'Staff member not found')
  const history = await sql`SELECT weekly_salary, effective_from FROM fin_staff_salary WHERE staff_id = ${s.id} ORDER BY effective_from DESC`
  return { ...rowToStaff(s, { full: true }), salaryHistory: history.map((h) => ({ weeklySalary: money(h.weekly_salary), effectiveFrom: day(h.effective_from) })) }
}

function staffFields(b) {
  const f = {
    name: blank(b.name), roleTitle: blank(b.roleTitle) || 'tailor', payType: b.payType || 'weekly_salary', isProduction: b.isProduction !== false,
    hoursPerDay: b.hoursPerDay === '' || b.hoursPerDay == null ? null : Number(b.hoursPerDay), cnic: blank(b.cnic),
    paymentMethod: blank(b.paymentMethod), isActive: b.isActive !== false, notes: blank(b.notes),
    aliases: [...new Set((Array.isArray(b.aliases) ? b.aliases : String(b.aliases || '').split(',')).map((x) => String(x).trim()).filter(Boolean))],
  }
  if (!f.name) throw new HttpError(400, 'Name is required')
  if (!['weekly_salary', 'per_piece_external'].includes(f.payType)) throw new HttpError(400, 'Pay type is weekly salary or per piece (external)')
  if (f.hoursPerDay != null && !(f.hoursPerDay > 0 && f.hoursPerDay <= 16)) throw new HttpError(400, 'Hours per day is between 0 and 16')
  return f
}
export async function createStaff(b) {
  const f = staffFields(b)
  try {
    const [s] = await sql`
      INSERT INTO fin_staff (name, role_title, pay_type, is_production, hours_per_day, cnic, payment_method, is_active, notes, aliases)
      VALUES (${f.name}, ${f.roleTitle}, ${f.payType}, ${f.isProduction}, ${f.hoursPerDay}, ${f.cnic}, ${f.paymentMethod}, ${f.isActive}, ${f.notes}, ${f.aliases}::text[]) RETURNING id`
    if (f.payType === 'weekly_salary' && b.weeklySalary) await setSalary(s.id, { weeklySalary: b.weeklySalary, effectiveFrom: b.salaryFrom || today() })
    return getStaff(s.id)
  } catch (err) { if (err.code === '23505') throw new HttpError(400, `${f.name} is already on the staff list`); throw err }
}
export async function updateStaff(id, b) {
  const cur = await getStaff(id)
  // A masked CNIC coming back from a list is not a change
  const f = staffFields({ ...cur, ...b, cnic: b.cnic !== undefined && !String(b.cnic).includes('•') ? b.cnic : cur.cnic })
  try {
    await sql`UPDATE fin_staff SET name = ${f.name}, role_title = ${f.roleTitle}, pay_type = ${f.payType}, is_production = ${f.isProduction},
      hours_per_day = ${f.hoursPerDay}, cnic = ${f.cnic}, payment_method = ${f.paymentMethod}, is_active = ${f.isActive}, notes = ${f.notes},
      aliases = ${f.aliases}::text[]
      WHERE id = ${cur.id}`
  } catch (err) { if (err.code === '23505') throw new HttpError(400, `${f.name} is already on the staff list`); throw err }
  return getStaff(cur.id)
}
// Salary changes keep their history; payroll uses the salary in force on the week ending date
export async function setSalary(id, { weeklySalary, effectiveFrom }) {
  const p = toPaisa(weeklySalary)
  if (p < 0) throw new HttpError(400, 'Salary cannot be negative')
  if (!isDate(effectiveFrom)) throw new HttpError(400, 'Say from when the salary applies')
  await sql`INSERT INTO fin_staff_salary (staff_id, weekly_salary, effective_from) VALUES (${Number(id)}, ${fromPaisa(p)}::numeric, ${effectiveFrom}::date)
    ON CONFLICT (staff_id, effective_from) DO UPDATE SET weekly_salary = EXCLUDED.weekly_salary`
  return getStaff(id)
}
async function salaryOn(staffId, date) {
  const [h] = await sql`SELECT weekly_salary FROM fin_staff_salary WHERE staff_id = ${staffId} AND effective_from <= ${date}::date ORDER BY effective_from DESC LIMIT 1`
  return h ? toPaisa(h.weekly_salary) : 0
}

// What's owed to one person right now, for the payment screen
export async function staffOwed(id) {
  const s = await getStaff(id)
  const claims = await sql`
    SELECT c.id, c.week_ending, (SELECT sum(amount) FROM fin_claim_lines l WHERE l.claim_id = c.id) AS total
    FROM fin_claims c WHERE c.staff_id = ${s.id} AND c.status = 'Approved' ORDER BY c.week_ending`
  const weeks = await sql`
    SELECT pl.id, r.week_ending, pl.gross_pay - pl.advance_recovered AS net,
      coalesce((SELECT sum(pp.amount) FROM fin_staff_payment_parts pp JOIN fin_staff_payments p ON p.id = pp.payment_id AND p.status = 'Posted'
                WHERE pp.payroll_line_id = pl.id), 0) AS paid
    FROM fin_payroll_lines pl JOIN fin_payroll_runs r ON r.id = pl.run_id AND r.status = 'Posted'
    WHERE pl.staff_id = ${s.id} ORDER BY r.week_ending`
  return {
    staff: { id: s.id, name: s.name }, owedWages: s.owedWages, owedClaims: s.owedClaims, advances: s.advances,
    claims: claims.map((c) => ({ id: c.id, weekEnding: day(c.week_ending), total: money(c.total) })),
    weeks: weeks.filter((w) => toPaisa(w.net) > toPaisa(w.paid)).map((w) => ({ payrollLineId: w.id, weekEnding: day(w.week_ending), net: money(w.net), paid: money(w.paid), due: fromPaisa(toPaisa(w.net) - toPaisa(w.paid)) })),
  }
}

// ── Payroll runs ───────────────────────────────────────────────────────
const rowToRun = (r) => ({
  id: r.id, weekEnding: day(r.week_ending), status: r.status, notes: r.notes || '', postedAt: r.posted_at,
  staff: r.staff_count ?? undefined, gross: r.gross != null ? money(r.gross) : undefined, income: r.income != null ? money(r.income) : undefined,
})
export async function listRuns() {
  const rows = await sql`
    SELECT r.*, (SELECT count(*)::int FROM fin_payroll_lines l WHERE l.run_id = r.id) AS staff_count,
      (SELECT coalesce(sum(gross_pay), 0) FROM fin_payroll_lines l WHERE l.run_id = r.id) AS gross,
      (SELECT coalesce(sum(amount), 0) FROM fin_payroll_income i WHERE i.run_id = r.id) AS income
    FROM fin_payroll_runs r ORDER BY r.week_ending DESC LIMIT 200`
  return rows.map(rowToRun)
}

export async function getRun(id) {
  const [r] = await sql`SELECT * FROM fin_payroll_runs WHERE id = ${Number(id) || 0}`
  if (!r) throw new HttpError(404, 'Payroll week not found')
  const lines = await sql`
    SELECT l.*, s.name, s.role_title, s.is_production, s.hours_per_day,
      coalesce((SELECT sum(pp.amount) FROM fin_staff_payment_parts pp JOIN fin_staff_payments p ON p.id = pp.payment_id AND p.status = 'Posted'
                WHERE pp.payroll_line_id = l.id), 0) AS paid
    FROM fin_payroll_lines l JOIN fin_staff s ON s.id = l.staff_id WHERE l.run_id = ${r.id} ORDER BY s.id`
  const hours = await sql`
    SELECT h.*, o.order_number, c.name AS collection_name FROM fin_payroll_hours h
    LEFT JOIN orders o ON o.id = h.order_id LEFT JOIN collections c ON c.id = h.collection_id
    WHERE h.line_id IN (SELECT id FROM fin_payroll_lines WHERE run_id = ${r.id}) ORDER BY h.id`
  const income = await sql`SELECT i.*, s.name FROM fin_payroll_income i JOIN fin_staff s ON s.id = i.staff_id WHERE i.run_id = ${r.id} ORDER BY i.id`
  const entries = await sql`SELECT id, entry_no, entry_date, status, source_event FROM fin_entries
    WHERE source_type = 'payroll' AND source_id = ${String(r.id)} ORDER BY id`
  const settings = await getSettings()
  return {
    ...rowToRun(r), workingDays: settings.workingDaysPerWeek, parts: weekParts(day(r.week_ending)),
    lines: lines.map((l) => ({
      id: l.id, staffId: l.staff_id, name: l.name, roleTitle: l.role_title, isProduction: l.is_production,
      hoursPerDay: l.hours_per_day == null ? null : Number(l.hours_per_day),
      weeklySalary: money(l.weekly_salary), daysPresent: Number(l.days_present), hoursWorked: l.hours_worked == null ? '' : Number(l.hours_worked),
      grossPay: money(l.gross_pay), advanceRecovered: money(l.advance_recovered), net: fromPaisa(toPaisa(l.gross_pay) - toPaisa(l.advance_recovered)),
      paid: money(l.paid), notes: l.notes || '',
      hours: hours.filter((h) => h.line_id === l.id).map((h) => ({ id: h.id, jobType: h.job_type, orderId: h.order_id, orderNumber: h.order_number || '',
        collectionId: h.collection_id, collectionName: h.collection_name || '', description: h.description || '', hours: Number(h.hours) })),
    })),
    income: income.map((i) => ({ id: i.id, staffId: i.staff_id, name: i.name, kind: i.kind, description: i.description || '', pieces: i.pieces, amount: money(i.amount), receivedInto: i.received_into })),
    entries: entries.map((e) => ({ id: e.id, entryNo: e.entry_no, date: day(e.entry_date), status: e.status, event: e.source_event })),
  }
}

// A new week, filled with everyone on a weekly salary at full attendance
export async function createRun({ weekEnding } = {}, user) {
  if (!isDate(weekEnding)) throw new HttpError(400, 'Week ending date is required')
  const [dup] = await sql`SELECT id FROM fin_payroll_runs WHERE week_ending = ${weekEnding}::date`
  if (dup) throw new HttpError(400, `There is already a payroll for the week ending ${weekEnding}`)
  const { workingDaysPerWeek: wd } = await getSettings()
  const staff = await sql`SELECT id, hours_per_day FROM fin_staff WHERE is_active AND pay_type = 'weekly_salary' ORDER BY id`
  const [r] = await sql`INSERT INTO fin_payroll_runs (week_ending, created_by) VALUES (${weekEnding}::date, ${user?.id ?? null}) RETURNING id`
  for (const s of staff) {
    const salary = await salaryOn(s.id, weekEnding)
    await sql`INSERT INTO fin_payroll_lines (run_id, staff_id, weekly_salary, days_present, hours_worked, gross_pay)
      VALUES (${r.id}, ${s.id}, ${fromPaisa(salary)}::numeric, ${wd}, ${s.hours_per_day == null ? null : Number(s.hours_per_day) * wd}, ${fromPaisa(salary)}::numeric)`
  }
  return getRun(r.id)
}

const JOB_TYPES = ['order', 'batch', 'sample', 'other', 'idle']
// Saves the week (draft only): attendance, pay, advance recovery, hours per job, custom work and commission
export async function saveRun(id, b) {
  const run = await getRun(id)
  if (run.status !== 'Draft') throw new HttpError(400, 'This week is posted. Undo it first to change it.')
  const wd = run.workingDays
  const queries = [db()`UPDATE fin_payroll_runs SET notes = ${blank(b.notes)} WHERE id = ${run.id}`]
  const keep = []
  for (const [i, l] of (b.lines || []).entries()) {
    const label = `Line ${i + 1}: `
    const staffId = Number(l.staffId)
    const [st] = await sql`SELECT id, name, pay_type FROM fin_staff WHERE id = ${staffId || 0}`
    if (!st) throw new HttpError(400, `${label}unknown staff member`)
    const days = Number(l.daysPresent ?? wd)
    if (!(days >= 0 && days <= 7)) throw new HttpError(400, `${st.name}: days present is 0 to 7`)
    let salary, gross, adv
    try { salary = toPaisa(l.weeklySalary ?? 0); adv = toPaisa(l.advanceRecovered || 0) } catch (err) { throw new HttpError(400, `${st.name}: ${err.message}`) }
    // Pay for the days worked unless a different amount is entered
    try { gross = l.grossPay === '' || l.grossPay == null ? Math.round((salary * days) / wd) : toPaisa(l.grossPay) } catch (err) { throw new HttpError(400, `${st.name}: ${err.message}`) }
    if (salary < 0 || gross < 0 || adv < 0) throw new HttpError(400, `${st.name}: amounts can't be negative`)
    if (adv > gross) throw new HttpError(400, `${st.name}: advance recovered can't be more than the pay`)
    const hoursWorked = l.hoursWorked === '' || l.hoursWorked == null ? null : Number(l.hoursWorked)
    if (hoursWorked != null && !(hoursWorked >= 0 && hoursWorked <= 112)) throw new HttpError(400, `${st.name}: hours worked looks wrong`)
    const jobs = (l.hours || []).filter((h) => Number(h.hours) > 0)
    for (const h of jobs) {
      if (!JOB_TYPES.includes(h.jobType)) throw new HttpError(400, `${st.name}: unknown job type`)
      if (h.orderId && !UUID.test(h.orderId)) throw new HttpError(400, `${st.name}: bad order`)
    }
    if (hoursWorked != null && jobs.reduce((s, h) => s + Number(h.hours), 0) > hoursWorked + 0.01) throw new HttpError(400, `${st.name}: hours by job add up to more than the hours worked`)
    keep.push(staffId)
    queries.push(db()`
      INSERT INTO fin_payroll_lines (run_id, staff_id, weekly_salary, days_present, hours_worked, gross_pay, advance_recovered, notes)
      VALUES (${run.id}, ${staffId}, ${fromPaisa(salary)}::numeric, ${days}, ${hoursWorked}, ${fromPaisa(gross)}::numeric, ${fromPaisa(adv)}::numeric, ${blank(l.notes)})
      ON CONFLICT (run_id, staff_id) DO UPDATE SET weekly_salary = EXCLUDED.weekly_salary, days_present = EXCLUDED.days_present,
        hours_worked = EXCLUDED.hours_worked, gross_pay = EXCLUDED.gross_pay, advance_recovered = EXCLUDED.advance_recovered, notes = EXCLUDED.notes`)
    queries.push(db()`DELETE FROM fin_payroll_hours WHERE line_id = (SELECT id FROM fin_payroll_lines WHERE run_id = ${run.id} AND staff_id = ${staffId})`)
    for (const h of jobs) queries.push(db()`
      INSERT INTO fin_payroll_hours (line_id, job_type, order_id, collection_id, description, hours)
      SELECT id, ${h.jobType}, ${h.orderId || null}::uuid, ${h.collectionId ? Number(h.collectionId) : null}::int, ${blank(h.description)}, ${Number(h.hours)}
      FROM fin_payroll_lines WHERE run_id = ${run.id} AND staff_id = ${staffId}`)
  }
  if (new Set(keep).size !== keep.length) throw new HttpError(400, 'Each person appears once in a week')
  queries.push(db()`DELETE FROM fin_payroll_lines WHERE run_id = ${run.id} AND NOT (staff_id = ANY(${keep}::int[]))`)
  queries.push(db()`DELETE FROM fin_payroll_income WHERE run_id = ${run.id}`)
  for (const [i, x] of (b.income || []).entries()) {
    if (!['custom_work', 'commission'].includes(x.kind)) throw new HttpError(400, `Income ${i + 1}: custom work or commission`)
    if (!['bank', 'cash', 'director_omer', 'director_usman'].includes(x.receivedInto || 'cash')) throw new HttpError(400, `Income ${i + 1}: where was it received?`)
    const amount = amountPaisa(x.amount, `Income ${i + 1}`)
    if (!Number(x.staffId)) throw new HttpError(400, `Income ${i + 1}: whose work was it?`)
    queries.push(db()`INSERT INTO fin_payroll_income (run_id, staff_id, kind, description, pieces, amount, received_into)
      VALUES (${run.id}, ${Number(x.staffId)}, ${x.kind}, ${blank(x.description)}, ${x.pieces ? Number(x.pieces) : null}, ${fromPaisa(amount)}::numeric, ${x.receivedInto || 'cash'})`)
  }
  await db().transaction(queries)
  return getRun(run.id)
}

// Posting the week: wages per month part, advance recovery, and the studio's other income
export async function postRun(id, user) {
  const run = await getRun(id)
  if (run.status !== 'Draft') throw new HttpError(400, 'This week is already posted')
  if (!run.lines.length && !run.income.length) throw new HttpError(400, 'Nothing to post: add staff or income first')
  const [labour, admin, wages, advances, custom, commission] = await Promise.all(
    ['cogs_labour', 'salaries_admin', 'wages_payable', 'staff_advances', 'income_custom', 'income_commission'].map(async (k) => (await accountBySystemKey(k)).id))
  const parts = run.parts
  const posted = []
  try {
    for (const [pi, part] of parts.entries()) {
      const lines = []
      for (const l of run.lines) {
        const share = splitPaisa(toPaisa(l.grossPay), parts.map((p) => p.days))[pi]
        if (!share) continue
        const party = { partyType: 'staff', partyId: String(l.staffId) }
        const text = `${l.name}: wages, week ending ${run.weekEnding}${parts.length > 1 ? ` (${part.days} of ${parts.reduce((s, p) => s + p.days, 0)} days in ${part.month})` : ''}`
        lines.push({ accountId: l.isProduction ? labour : admin, debit: fromPaisa(share), description: text, ...party })
        lines.push({ accountId: wages, credit: fromPaisa(share), description: text, ...party })
      }
      if (lines.length) posted.push(await createEntry({
        date: part.date, entryType: 'PY', memo: `Payroll: week ending ${run.weekEnding}${parts.length > 1 ? `, ${part.month} part` : ''}`, post: true,
        source: { type: 'payroll', id: run.id, event: `wages-${part.month}` }, lines,
      }, user))
    }
    const recover = run.lines.filter((l) => toPaisa(l.advanceRecovered) > 0)
    if (recover.length) posted.push(await createEntry({
      date: run.weekEnding, entryType: 'PY', memo: `Payroll: advances recovered, week ending ${run.weekEnding}`, post: true,
      source: { type: 'payroll', id: run.id, event: 'advances' },
      lines: recover.flatMap((l) => {
        const party = { partyType: 'staff', partyId: String(l.staffId) }
        return [{ accountId: wages, debit: l.advanceRecovered, description: `${l.name}: advance recovered from pay`, ...party },
          { accountId: advances, credit: l.advanceRecovered, description: `${l.name}: advance recovered from pay`, ...party }]
      }),
    }, user))
    if (run.income.length) {
      const lines = []
      for (const x of run.income) {
        const text = `${x.name}: ${x.kind === 'custom_work' ? 'custom work' : 'commission'}${x.pieces ? `, ${x.pieces} pieces` : ''}${x.description ? `, ${x.description}` : ''}`
        lines.push({ accountId: await payAccount(x.receivedInto), debit: x.amount, description: text })
        lines.push({ accountId: x.kind === 'custom_work' ? custom : commission, credit: x.amount, description: text, partyType: 'staff', partyId: String(x.staffId) })
      }
      posted.push(await createEntry({
        date: run.weekEnding, entryType: 'RC', memo: `Studio income: week ending ${run.weekEnding}`, post: true,
        source: { type: 'payroll', id: run.id, event: 'income' }, lines,
      }, user))
    }
  } catch (err) {
    // All or nothing: take back anything this attempt posted
    for (const e of posted.reverse()) await reverseEntry(e.id, { date: e.date, reason: 'Payroll posting did not complete' }, user).catch(() => {})
    throw err
  }
  await sql`UPDATE fin_payroll_runs SET status = 'Posted', posted_by = ${user?.id ?? null}, posted_at = now() WHERE id = ${run.id}`
  return getRun(run.id)
}

// Undoing a posted week reverses its entries (on their own dates) and makes it a draft again
export async function unpostRun(id, { reason } = {}, user) {
  const run = await getRun(id)
  if (run.status !== 'Posted') throw new HttpError(400, 'This week is not posted')
  if (!blank(reason)) throw new HttpError(400, 'Say why the week is being undone')
  if (run.lines.some((l) => toPaisa(l.paid) > 0)) throw new HttpError(400, 'Someone has been paid against this week. Void those payments first.')
  for (const e of run.entries.filter((x) => x.status === 'Posted')) await reverseEntry(e.id, { date: e.date, reason }, user)
  await sql`UPDATE fin_payroll_runs SET status = 'Draft', posted_by = NULL, posted_at = NULL WHERE id = ${run.id}`
  return getRun(run.id)
}

export async function deleteRun(id) {
  const run = await getRun(id)
  if (run.status !== 'Draft') throw new HttpError(400, 'Only a draft week can be deleted')
  if (run.entries.length) throw new HttpError(400, 'This week has been posted before, so it stays on record. Edit and post it again.')
  await sql`DELETE FROM fin_payroll_runs WHERE id = ${run.id}`
}

// ── Payments to staff ──────────────────────────────────────────────────
const rowToPayment = (p) => ({
  id: p.id, staffId: p.staff_id, staffName: p.staff_name, paidOn: day(p.paid_on), paidFrom: p.paid_from, amount: money(p.amount),
  reference: p.reference || '', notes: p.notes || '', status: p.status, entryId: p.entry_id, entryNo: p.entry_no || '',
  parts: (p.parts || []).map((x) => ({ kind: x.kind, claimId: x.claim_id, payrollLineId: x.payroll_line_id, weekEnding: x.week_ending ? day(x.week_ending) : null, amount: money(x.amount) })),
  files: p.files ?? 0,
})
export async function listStaffPayments({ staffId } = {}) {
  const rows = await sql`
    SELECT p.*, s.name AS staff_name, e.entry_no,
      (SELECT json_agg(json_build_object('kind', pp.kind, 'claim_id', pp.claim_id, 'payroll_line_id', pp.payroll_line_id, 'amount', pp.amount,
              'week_ending', coalesce(r.week_ending, c.week_ending)) ORDER BY pp.id)
       FROM fin_staff_payment_parts pp LEFT JOIN fin_payroll_lines pl ON pl.id = pp.payroll_line_id LEFT JOIN fin_payroll_runs r ON r.id = pl.run_id
       LEFT JOIN fin_claims c ON c.id = pp.claim_id WHERE pp.payment_id = p.id) AS parts,
      (SELECT count(*)::int FROM fin_staff_payment_files f WHERE f.payment_id = p.id) AS files
    FROM fin_staff_payments p JOIN fin_staff s ON s.id = p.staff_id LEFT JOIN fin_entries e ON e.id = p.entry_id
    WHERE (${staffId ? Number(staffId) : null}::int IS NULL OR p.staff_id = ${staffId ? Number(staffId) : null}::int)
    ORDER BY p.paid_on DESC, p.id DESC LIMIT 500`
  return rows.map(rowToPayment)
}
async function getPayment(id) {
  const [p] = (await listStaffPayments()).filter((x) => x.id === Number(id))
  if (!p) throw new HttpError(404, 'Payment not found')
  return p
}

// b: { staffId, paidOn, paidFrom, amount, reference, notes, parts: [{ kind: salary|claim|advance, claimId?, payrollLineId?, amount }], fileIds }
export async function createStaffPayment(b, user) {
  const [st] = await sql`SELECT id, name FROM fin_staff WHERE id = ${Number(b.staffId) || 0}`
  if (!st) throw new HttpError(400, 'Choose who was paid')
  const on = b.paidOn || today()
  if (!isDate(on)) throw new HttpError(400, 'Payment date must be a date')
  if (!['bank', 'cash', 'director_omer', 'director_usman'].includes(b.paidFrom)) throw new HttpError(400, 'Say how it was paid')
  const amount = amountPaisa(b.amount)
  if (!Array.isArray(b.parts) || !b.parts.length) throw new HttpError(400, 'Say what the payment is for: salary, a claim or an advance')
  const parts = []
  for (const [i, x] of b.parts.entries()) {
    if (!['salary', 'claim', 'advance'].includes(x.kind)) throw new HttpError(400, `Part ${i + 1}: salary, claim or advance`)
    const p = amountPaisa(x.amount, `Part ${i + 1}`)
    if (x.kind === 'claim') {
      const [c] = await sql`SELECT c.id, c.status, c.staff_id, (SELECT sum(amount) FROM fin_claim_lines l WHERE l.claim_id = c.id) AS total FROM fin_claims c WHERE c.id = ${Number(x.claimId) || 0}`
      if (!c || c.staff_id !== st.id) throw new HttpError(400, `Part ${i + 1}: that claim isn't ${st.name}'s`)
      if (c.status !== 'Approved') throw new HttpError(400, `Part ${i + 1}: the claim must be approved (it is ${c.status.toLowerCase()})`)
      if (p !== toPaisa(c.total)) throw new HttpError(400, `Part ${i + 1}: a claim is paid in full (${money(c.total)})`)
    }
    if (x.payrollLineId) {
      const [pl] = await sql`SELECT l.staff_id, r.status FROM fin_payroll_lines l JOIN fin_payroll_runs r ON r.id = l.run_id WHERE l.id = ${Number(x.payrollLineId)}`
      if (!pl || pl.staff_id !== st.id || x.kind !== 'salary') throw new HttpError(400, `Part ${i + 1}: that payroll week isn't ${st.name}'s`)
      if (pl.status !== 'Posted') throw new HttpError(400, `Part ${i + 1}: post that payroll week before paying it`)
    }
    parts.push({ kind: x.kind, claimId: x.kind === 'claim' ? Number(x.claimId) : null, payrollLineId: x.payrollLineId ? Number(x.payrollLineId) : null, amount: p })
  }
  if (sumPaisa(parts.map((x) => x.amount)) !== amount) throw new HttpError(400, `The parts add up to ${fromPaisa(sumPaisa(parts.map((x) => x.amount)))}, not ${fromPaisa(amount)}`)
  if (new Set(parts.filter((x) => x.claimId).map((x) => x.claimId)).size !== parts.filter((x) => x.claimId).length) throw new HttpError(400, 'A claim appears twice')

  const ref = blank(b.reference)
  let pay
  try {
    [pay] = await sql`INSERT INTO fin_staff_payments (staff_id, paid_on, paid_from, amount, reference, notes, created_by)
      VALUES (${st.id}, ${on}::date, ${b.paidFrom}, ${fromPaisa(amount)}::numeric, ${ref}, ${blank(b.notes)}, ${user?.id ?? null}) RETURNING id`
  } catch (err) { if (err.code === '23505') throw new HttpError(400, `A payment with reference ${ref} is already recorded`); throw err }
  const [wages, claims, advances] = await Promise.all(['wages_payable', 'ap_staff_claims', 'staff_advances'].map(async (k) => (await accountBySystemKey(k)).id))
  const party = { partyType: 'staff', partyId: String(st.id) }
  const label = { salary: 'salary', claim: 'studio claim', advance: 'advance' }
  let entry
  try {
    entry = await createEntry({
      date: on, entryType: 'PY', post: true, source: { type: 'staff_payment', id: pay.id, event: 'paid' },
      memo: `Paid ${st.name}: ${parts.map((x) => label[x.kind]).filter((v, i, a) => a.indexOf(v) === i).join(' + ')}${ref ? ` (ref ${ref})` : ''}`,
      lines: [
        ...parts.map((x) => ({ accountId: x.kind === 'salary' ? wages : x.kind === 'claim' ? claims : advances, debit: fromPaisa(x.amount),
          description: `${st.name}: ${label[x.kind]}`, ...party })),
        { accountId: await payAccount(b.paidFrom), credit: fromPaisa(amount), description: ref ? `Ref ${ref}` : `Paid to ${st.name}`, ...party },
      ],
    }, user)
  } catch (err) { await sql`DELETE FROM fin_staff_payments WHERE id = ${pay.id}`; throw err }
  await db().transaction([
    db()`UPDATE fin_staff_payments SET entry_id = ${entry.id} WHERE id = ${pay.id}`,
    ...parts.map((x) => db()`INSERT INTO fin_staff_payment_parts (payment_id, kind, payroll_line_id, claim_id, amount)
      VALUES (${pay.id}, ${x.kind}, ${x.payrollLineId}::int, ${x.claimId}::int, ${fromPaisa(x.amount)}::numeric)`),
    ...parts.filter((x) => x.claimId).map((x) => db()`UPDATE fin_claims SET status = 'Paid' WHERE id = ${x.claimId}`),
  ])
  for (const f of b.fileIds || []) {
    await sql`INSERT INTO fin_staff_payment_files (payment_id, file_id) VALUES (${pay.id}, ${Number(f)}) ON CONFLICT DO NOTHING`
    await attachToEntry(entry.id, f)
  }
  return getPayment(pay.id)
}

export async function voidStaffPayment(id, { reason } = {}, user) {
  const p = await getPayment(id)
  if (p.status !== 'Posted') throw new HttpError(400, 'This payment is already void')
  if (!blank(reason)) throw new HttpError(400, 'Say why it is being voided')
  await reverseEntry(p.entryId, { date: p.paidOn, reason }, user)
  await db().transaction([
    db()`UPDATE fin_staff_payments SET status = 'Void' WHERE id = ${p.id}`,
    db()`UPDATE fin_claims SET status = 'Approved' WHERE id IN (SELECT claim_id FROM fin_staff_payment_parts WHERE payment_id = ${p.id} AND claim_id IS NOT NULL)`,
  ])
  return getPayment(p.id)
}
