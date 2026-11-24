// Finance F6: fixed asset register (IAS 16). Assets are carried at cost and depreciated straight line
// over their useful life down to the residual value. Depreciation is posted once a month for all assets
// (Dr 6950 Depreciation, Cr 1590 Accumulated depreciation), each line tagged with its asset; a month that
// is worked out again catches up any change (cost, life, residual) instead of re-charging the whole life.
// Mid-month convention: an asset available for use on or before the 15th is charged from that month,
// otherwise from the next; one disposed of after the 15th is charged for its last month.
// Assets come in three ways: bought through the register (an expense to the asset account), an expense
// already booked and moved to the asset account, or owned before go-live (in the opening balances).
import { neon } from '@neondatabase/serverless'
import { HttpError, blank } from '../db.js'
import { toPaisa, fromPaisa } from './money.js'
import { accountBySystemKey, getSettings, replaceEntry, entryState, createEntry, reverseEntry, listPeriods } from './ledger.js'
import { createExpense, getExpense, voidExpense, payAccount, day, isDate, today, amountPaisa } from './expenses.js'

let _sql
const db = () => (_sql ??= neon(process.env.DATABASE_URL))
const sql = (...args) => db()(...args)
const P = (v) => toPaisa(v ?? 0)
const money = (p) => fromPaisa(Math.round(p))
const pad = (n) => String(n).padStart(2, '0')

export const CATEGORIES = {
  machinery: { key: 'ppe_machinery', label: 'Machinery and equipment', life: 120 },
  furniture: { key: 'ppe_furniture', label: 'Furniture and fixtures', life: 120 },
  computers: { key: 'ppe_computers', label: 'Computers and phones', life: 36 },
}
export const REMOVED = 'Accumulated depreciation removed on disposal'

// ── Months ─────────────────────────────────────────────────────────────
export const ym = (d) => d.slice(0, 7)
export const isMonth = (m) => /^\d{4}-\d{2}$/.test(m || '')
export const monthEnd = (m) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10)
export const addMonths = (m, n) => { const t = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + n; return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}` }
const monthsBetween = (a, b) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7))
const firstMonth = (d) => (Number(d.slice(8, 10)) <= 15 ? ym(d) : addMonths(ym(d), 1))
const lastMonth = (d) => (Number(d.slice(8, 10)) > 15 ? ym(d) : addMonths(ym(d), -1))

// Depreciation accumulated by the end of month m, in paisa (pure). a: { cost, residual, lifeMonths,
// availableOn, source, openingDepreciation, disposedOn } in paisa / dates. An asset owned before go-live
// spreads what is left over the life left at go-live.
export function accumulatedTo(a, m, goLiveMonth) {
  const dep = a.cost - a.residual
  let base = 0, start = firstMonth(a.availableOn), life = a.lifeMonths
  if (a.source === 'opening') {
    base = Math.min(a.openingDepreciation || 0, dep)
    const elapsed = Math.max(0, monthsBetween(start, goLiveMonth))
    if (elapsed > 0) { start = goLiveMonth; life = Math.max(1, life - elapsed) }
  }
  if (a.disposedOn && m > lastMonth(a.disposedOn)) m = lastMonth(a.disposedOn)
  if (m < start) return base
  const k = monthsBetween(start, m) + 1
  if (k >= life) return dep
  return base + Math.min(dep - base, k * Math.round((dep - base) / life))
}

// ── Register ───────────────────────────────────────────────────────────
const toCalc = (r) => ({
  cost: P(r.cost), residual: P(r.residual), lifeMonths: r.life_months, availableOn: day(r.available_on), source: r.source,
  openingDepreciation: P(r.opening_depreciation), disposedOn: day(r.disposed_on),
})
// Depreciation booked on 1590 per asset (credits less debits), up to a date, leaving out one month's job
// (withoutMonth) or the jobs of a month and every month after it (withoutFrom)
async function bookedDepreciation({ asOf = null, withoutMonth = null, withoutFrom = null } = {}) {
  const accDep = (await accountBySystemKey('ppe_acc_depreciation')).id
  const rows = await sql`
    SELECT l.asset_id, coalesce(sum(l.credit - l.debit), 0) AS dep FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'Draft'
    WHERE l.asset_id IS NOT NULL AND l.account_id = ${accDep}
      AND (${asOf}::date IS NULL OR e.entry_date <= ${asOf}::date)
      AND NOT (${withoutMonth}::text IS NOT NULL AND (
        (e.source_type = 'depreciation' AND e.source_id = ${withoutMonth})
        OR coalesce(e.reversal_of IN (SELECT id FROM fin_entries WHERE source_type = 'depreciation' AND source_id = ${withoutMonth}), false)))
      AND NOT (${withoutFrom}::text IS NOT NULL AND (
        (e.source_type = 'depreciation' AND e.source_id >= ${withoutFrom})
        OR coalesce(e.reversal_of IN (SELECT id FROM fin_entries WHERE source_type = 'depreciation' AND source_id >= ${withoutFrom}), false)))
    GROUP BY l.asset_id`
  return new Map(rows.map((r) => [r.asset_id, P(r.dep)]))
}

const goLiveMonthOf = async () => ym((await getSettings()).goLiveDate)

function rowToAsset(r, booked, goLiveMonth, asOfMonth) {
  const c = toCalc(r)
  const base = r.source === 'opening' ? Math.min(c.openingDepreciation, c.cost - c.residual) : 0
  const accumulated = r.status === 'Disposed' ? 0 : base + (booked.get(r.id) || 0)
  const due = r.status === 'Disposed' ? accumulated : accumulatedTo(c, asOfMonth, goLiveMonth)
  return {
    id: r.id, code: r.code, name: r.name, category: r.category, categoryLabel: CATEGORIES[r.category].label,
    acquiredOn: day(r.acquired_on), availableOn: day(r.available_on), cost: money(c.cost), residual: money(c.residual), lifeMonths: r.life_months,
    monthly: money(Math.round((c.cost - c.residual) / r.life_months)), source: r.source, openingDepreciation: money(c.openingDepreciation),
    expenseId: r.expense_id, expenseEntryNo: r.expense_entry_no || '', entryId: r.entry_id, entryNo: r.entry_no || '',
    supplierId: r.supplier_id, supplierName: r.supplier_name || '', serialNo: r.serial_no || '', location: r.location || '', notes: r.notes || '',
    status: r.status, disposedOn: day(r.disposed_on), disposalProceeds: r.disposal_proceeds == null ? null : money(P(r.disposal_proceeds)),
    disposalEntryId: r.disposal_entry_id, disposalEntryNo: r.disposal_entry_no || '', disposalNote: r.disposal_note || '',
    accumulated: money(accumulated), carrying: money(r.status === 'Disposed' ? 0 : c.cost - accumulated),
    notYetBooked: money(Math.max(0, due - accumulated)), fullyDepreciated: r.status !== 'Disposed' && accumulated >= c.cost - c.residual,
  }
}
const ASSET_SELECT = (where) => sql`
  SELECT f.*, s.name AS supplier_name, xe.entry_no AS expense_entry_no, ce.entry_no, de.entry_no AS disposal_entry_no
  FROM fin_assets f LEFT JOIN fin_suppliers s ON s.id = f.supplier_id
  LEFT JOIN fin_expenses x ON x.id = f.expense_id LEFT JOIN fin_entries xe ON xe.id = x.entry_id
  LEFT JOIN fin_entries ce ON ce.id = f.entry_id LEFT JOIN fin_entries de ON de.id = f.disposal_entry_id
  ${where}`

// asOf: carrying amounts at that date ("not yet booked" = depreciation due by the month before it)
export async function listAssets({ asOf } = {}) {
  const at = isDate(asOf) ? asOf : today()
  const [rows, booked, goLive] = await Promise.all([ASSET_SELECT(sql`ORDER BY f.code`), bookedDepreciation({ asOf: at }), goLiveMonthOf()])
  const assets = rows.map((r) => rowToAsset(r, booked, goLive, at === monthEnd(ym(at)) ? ym(at) : addMonths(ym(at), -1)))
  const inUse = assets.filter((a) => a.status === 'In use')
  const sum = (k) => money(inUse.reduce((s, a) => s + P(a[k]), 0))
  return { asOf: at, assets, totals: { cost: sum('cost'), accumulated: sum('accumulated'), carrying: sum('carrying'), notYetBooked: sum('notYetBooked') } }
}
export async function getAsset(id) {
  const [r] = await ASSET_SELECT(sql`WHERE f.id = ${Number(id) || 0}`)
  if (!r) throw new HttpError(404, 'Asset not found')
  const accDep = (await accountBySystemKey('ppe_acc_depreciation')).id
  const [booked, goLive, entries] = await Promise.all([bookedDepreciation(), goLiveMonthOf(), sql`
    SELECT e.id, e.entry_no, e.entry_date::text AS entry_date, e.memo, e.status, coalesce(sum(l.credit - l.debit) FILTER (WHERE l.account_id = ${accDep}), 0) AS dep
    FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'Draft' WHERE l.asset_id = ${r.id}
    GROUP BY e.id ORDER BY e.entry_date, e.id`])
  return { ...rowToAsset(r, booked, goLive, ym(today())), entries: entries.map((e) => ({ id: e.id, entryNo: e.entry_no, date: e.entry_date, memo: e.memo || '', status: e.status, depreciation: money(P(e.dep)) })) }
}

function assetFields(b, { opening = false } = {}) {
  const name = blank(b.name)
  if (!name) throw new HttpError(400, 'Name the asset')
  if (!CATEGORIES[b.category]) throw new HttpError(400, 'Choose the kind of asset')
  const life = b.lifeMonths === undefined || b.lifeMonths === '' ? CATEGORIES[b.category].life : Number(b.lifeMonths)
  if (!(Number.isInteger(life) && life >= 1 && life <= 600)) throw new HttpError(400, 'Useful life is 1 to 600 months')
  let residual = 0
  try { residual = toPaisa(b.residual || 0) } catch (err) { throw new HttpError(400, `Residual value: ${err.message}`) }
  if (residual < 0) throw new HttpError(400, 'Residual value cannot be negative')
  let openingDep = 0
  if (opening) { try { openingDep = toPaisa(b.openingDepreciation || 0) } catch (err) { throw new HttpError(400, `Depreciation so far: ${err.message}`) } }
  return { name, category: b.category, life, residual, openingDep, serialNo: blank(b.serialNo), location: blank(b.location), notes: blank(b.notes),
    supplierId: b.supplierId ? Number(b.supplierId) : null }
}
const nextCode = async () => {
  const [r] = await sql`SELECT coalesce(max(substring(code FROM 4)::int), 0) + 1 AS n FROM fin_assets WHERE code ~ '^FA-[0-9]+$'`
  return `FA-${String(r.n).padStart(4, '0')}`
}
function checkValues(cost, f, availableOn, acquiredOn) {
  if (f.residual >= cost) throw new HttpError(400, 'The residual value must be less than the cost')
  if (f.openingDep > cost - f.residual) throw new HttpError(400, 'Depreciation so far cannot be more than cost less residual value')
  if (availableOn < acquiredOn) throw new HttpError(400, 'It cannot be in use before it was bought')
}

// b.source: 'purchase' { cost, paidFrom, acquiredOn, reference, fileIds } | 'expense' { expenseId } |
//           'opening' { cost, acquiredOn, openingDepreciation }
export async function createAsset(b, user) {
  const source = b.source
  if (!['purchase', 'expense', 'opening'].includes(source)) throw new HttpError(400, 'Say how the asset came in')
  const f = assetFields(b, { opening: source === 'opening' })
  const ppe = await accountBySystemKey(CATEGORIES[f.category].key)
  const { goLiveDate } = await getSettings()
  let cost, acquiredOn, expense = null
  if (source === 'expense') {
    expense = await getExpense(b.expenseId)
    if (expense.status !== 'Posted') throw new HttpError(400, 'Only a posted expense can become a fixed asset')
    const [linked] = await sql`SELECT code FROM fin_assets WHERE expense_id = ${expense.id}`
    if (linked) throw new HttpError(400, `That expense is already ${linked.code}`)
    cost = P(expense.amount); acquiredOn = expense.date
  } else {
    cost = amountPaisa(b.cost, 'Cost')
    acquiredOn = b.acquiredOn
    if (!isDate(acquiredOn)) throw new HttpError(400, 'When was it bought?')
    if (acquiredOn > today()) throw new HttpError(400, 'The purchase date is in the future')
  }
  if (source === 'opening' && acquiredOn >= goLiveDate) throw new HttpError(400, `Assets bought from ${goLiveDate} on are purchases, not opening balances`)
  if (source !== 'opening' && acquiredOn < goLiveDate) throw new HttpError(400, `Bought before ${goLiveDate}: add it as an asset owned before go-live`)
  const availableOn = isDate(b.availableOn) ? b.availableOn : acquiredOn
  checkValues(cost, f, availableOn, acquiredOn)

  if (source === 'purchase') {
    expense = await createExpense({ date: acquiredOn, amount: fromPaisa(cost), accountId: ppe.id, paidFrom: b.paidFrom, supplierId: f.supplierId,
      description: `Fixed asset: ${f.name}`, reference: b.reference, fileIds: b.fileIds }, user)
  }
  const [a] = await sql`
    INSERT INTO fin_assets (code, name, category, acquired_on, available_on, cost, residual, life_months, source, opening_depreciation, expense_id,
                            supplier_id, serial_no, location, notes, created_by)
    VALUES (${await nextCode()}, ${f.name}, ${f.category}, ${acquiredOn}::date, ${availableOn}::date, ${fromPaisa(cost)}::numeric, ${fromPaisa(f.residual)}::numeric,
            ${f.life}, ${source}, ${fromPaisa(f.openingDep)}::numeric, ${expense?.id ?? null}::int, ${f.supplierId ?? expense?.supplierId ?? null}::int,
            ${f.serialNo}, ${f.location}, ${f.notes}, ${user?.id ?? null})
    RETURNING id, code`
  // An expense booked to another account moves to the asset account
  if (source === 'expense' && expense.accountId !== ppe.id) {
    try {
      const e = await createEntry({ date: expense.date, entryType: 'JV', post: true, memo: `${a.code} ${f.name}: expense ${expense.entryNo} moved to fixed assets`,
        source: { type: 'asset', id: a.id, event: 'capitalise' }, lines: [
          { accountId: ppe.id, debit: fromPaisa(cost), assetId: a.id, description: `${a.code} ${f.name}` },
          { accountId: expense.accountId, credit: fromPaisa(cost), assetId: a.id, description: `Moved to fixed assets: ${a.code}` },
        ] }, user)
      await sql`UPDATE fin_assets SET entry_id = ${e.id} WHERE id = ${a.id}`
    } catch (err) { await sql`DELETE FROM fin_assets WHERE id = ${a.id}`; throw err }
  }
  return getAsset(a.id)
}

export async function updateAsset(id, b) {
  const [cur] = await sql`SELECT * FROM fin_assets WHERE id = ${Number(id) || 0}`
  if (!cur) throw new HttpError(404, 'Asset not found')
  if (cur.status === 'Disposed') {
    await sql`UPDATE fin_assets SET notes = ${blank(b.notes)}, location = ${blank(b.location)}, serial_no = ${blank(b.serialNo)} WHERE id = ${cur.id}`
    return getAsset(cur.id)
  }
  const f = assetFields({ category: cur.category, ...b }, { opening: cur.source === 'opening' })
  if (f.category !== cur.category && cur.source !== 'opening') throw new HttpError(400, 'The kind of asset decides its account; remove it and add it again to change it')
  let cost = P(cur.cost)
  if (cur.source === 'opening' && b.cost !== undefined) cost = amountPaisa(b.cost, 'Cost')
  if (cur.source !== 'opening') f.openingDep = 0
  const availableOn = isDate(b.availableOn) ? b.availableOn : day(cur.available_on)
  checkValues(cost, f, availableOn, day(cur.acquired_on))
  await sql`UPDATE fin_assets SET name = ${f.name}, category = ${f.category}, available_on = ${availableOn}::date, cost = ${fromPaisa(cost)}::numeric,
    residual = ${fromPaisa(f.residual)}::numeric, life_months = ${f.life}, opening_depreciation = ${fromPaisa(f.openingDep)}::numeric,
    supplier_id = ${f.supplierId ?? cur.supplier_id}::int, serial_no = ${f.serialNo}, location = ${f.location}, notes = ${f.notes} WHERE id = ${cur.id}`
  return getAsset(cur.id)
}

// Only an asset with no depreciation booked; its capitalisation is reversed and a purchase voided
export async function deleteAsset(id, { reason } = {}, user) {
  const [cur] = await sql`SELECT * FROM fin_assets WHERE id = ${Number(id) || 0}`
  if (!cur) throw new HttpError(404, 'Asset not found')
  if (!blank(reason)) throw new HttpError(400, 'Say why the asset is being removed')
  if (cur.status === 'Disposed') throw new HttpError(400, 'A disposed asset stays on the register')
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status = 'Posted'
    WHERE l.asset_id = ${cur.id} AND e.source_type = 'depreciation'`
  if (n) throw new HttpError(400, 'Depreciation has been booked on this asset; dispose of it instead (or re-run those months after correcting it)')
  if (cur.entry_id) await reverseEntry(cur.entry_id, { reason: `Fixed asset ${cur.code} removed: ${reason}` }, user)
  if (cur.source === 'purchase' && cur.expense_id) await voidExpense(cur.expense_id, { reason: `Fixed asset ${cur.code} removed: ${reason}` }, user)
  await sql`UPDATE fin_lines SET asset_id = NULL WHERE asset_id = ${cur.id} AND entry_id IN (SELECT id FROM fin_entries WHERE status = 'Draft')`
  // Posted lines keep pointing at the asset (they can't change), so the record stays, emptied of its link to the expense
  const [{ used }] = await sql`SELECT count(*)::int AS used FROM fin_lines WHERE asset_id = ${cur.id}`
  if (used) {
    await sql`UPDATE fin_assets SET status = 'Disposed', disposed_on = ${today()}::date, disposal_proceeds = 0, expense_id = NULL,
      disposal_note = ${`Removed: ${blank(reason)}`} WHERE id = ${cur.id}`
  } else {
    await sql`DELETE FROM fin_assets WHERE id = ${cur.id}`
  }
  return { id: cur.id, removed: true }
}

// ── Depreciation ───────────────────────────────────────────────────────
// The month's entry: for each asset, the depreciation due by the month end less what is already booked
// (outside this month's own entry). Disposed assets are left out once disposed.
export async function depreciationFor(month) {
  if (!isMonth(month)) throw new HttpError(400, 'Choose the month')
  const asOf = monthEnd(month)
  const [rows, booked, goLive, expAcc, accDep] = await Promise.all([
    sql`SELECT * FROM fin_assets WHERE available_on <= ${asOf}::date AND (status = 'In use' OR disposed_on > ${asOf}::date) ORDER BY code`,
    bookedDepreciation({ asOf, withoutMonth: month }), goLiveMonthOf(),
    accountBySystemKey('depreciation'), accountBySystemKey('ppe_acc_depreciation'),
  ])
  const lines = [], items = []
  for (const r of rows) {
    const c = toCalc(r)
    if (c.disposedOn) c.disposedOn = null           // disposed later: a full charge this month
    const base = r.source === 'opening' ? Math.min(c.openingDepreciation, c.cost - c.residual) : 0
    const charge = accumulatedTo(c, month, goLive) - base - (booked.get(r.id) || 0)
    if (!charge) continue
    const text = `${r.code} ${r.name}`
    const amt = fromPaisa(Math.abs(charge))
    lines.push({ accountId: expAcc.id, debit: charge > 0 ? amt : '0', credit: charge < 0 ? amt : '0', assetId: r.id, description: text })
    lines.push({ accountId: accDep.id, debit: charge < 0 ? amt : '0', credit: charge > 0 ? amt : '0', assetId: r.id, description: text })
    items.push({ assetId: r.id, code: r.code, name: r.name, charge: money(charge) })
  }
  return { month, asOf, lines, items, total: money(items.reduce((s, i) => s + P(i.charge), 0)) }
}
export async function depreciationState(month) {
  const d = await depreciationFor(month)
  return { ...d, ...(await entryState({ type: 'depreciation', id: month, event: 'monthly' }, d.lines, d.asOf)) }
}
export async function postDepreciation({ month } = {}, user) {
  const d = await depreciationFor(month)
  const { goLiveDate } = await getSettings()
  if (d.asOf < goLiveDate) throw new HttpError(400, `${month} is before go-live`)
  if (`${month}-01` > today()) throw new HttpError(400, 'That month has not started yet')
  const { entry } = await replaceEntry({ source: { type: 'depreciation', id: month, event: 'monthly' }, date: d.asOf, memo: `Depreciation ${month}`, lines: d.lines,
    reason: 'Depreciation worked out again' }, user)
  return { ...d, entryId: entry?.id ?? null, entryNo: entry?.entryNo ?? null }
}

// ── Disposal ───────────────────────────────────────────────────────────
// One entry: depreciation up to the disposal, accumulated depreciation and cost removed, the money
// received, and the gain (4910) or loss (6980) against the carrying amount
export async function disposeAsset(id, b, user) {
  const [r] = await sql`SELECT * FROM fin_assets WHERE id = ${Number(id) || 0}`
  if (!r) throw new HttpError(404, 'Asset not found')
  if (r.status === 'Disposed') throw new HttpError(400, `${r.code} is already disposed of`)
  const date = b.date
  if (!isDate(date)) throw new HttpError(400, 'When was it sold or scrapped?')
  if (date < day(r.acquired_on)) throw new HttpError(400, 'That is before it was bought')
  if (date > today()) throw new HttpError(400, 'The date is in the future')
  let proceeds = 0
  try { proceeds = toPaisa(b.proceeds || 0) } catch (err) { throw new HttpError(400, `Sale price: ${err.message}`) }
  if (proceeds < 0) throw new HttpError(400, 'The sale price cannot be negative')
  const into = proceeds ? await payAccount(b.paidTo) : null
  if (proceeds && b.paidTo === 'unpaid') throw new HttpError(400, 'Say where the money went')

  // Monthly depreciation already posted for the disposal month or later is worked out again afterwards
  // (without this asset: the disposal entry charges it up to the date), so those months must be open
  const later = (await sql`SELECT DISTINCT e.source_id FROM fin_entries e JOIN fin_lines l ON l.entry_id = e.id AND l.asset_id = ${r.id}
    WHERE e.source_type = 'depreciation' AND e.status = 'Posted' AND e.source_id >= ${ym(date)}`).map((x) => x.source_id).sort()
  const periods = await listPeriods()
  for (const m of later) {
    const p = periods.find((x) => !x.isAdjustment && x.startsOn === `${m}-01`)
    if (p && p.status !== 'Open') throw new HttpError(400, `Depreciation for ${p.name} already charges ${r.code} and that month is ${p.status.toLowerCase()}`)
  }

  const c = { ...toCalc(r), disposedOn: date }
  const goLive = await goLiveMonthOf()
  const base = r.source === 'opening' ? Math.min(c.openingDepreciation, c.cost - c.residual) : 0
  const bookedToDate = (await bookedDepreciation({ withoutFrom: ym(date) })).get(r.id) || 0
  const catchUp = accumulatedTo(c, ym(date), goLive) - base - bookedToDate
  const accumulated = base + bookedToDate + catchUp
  const carrying = c.cost - accumulated
  const gain = proceeds - carrying
  const [ppe, expAcc, accDep, gainAcc, lossAcc] = await Promise.all([accountBySystemKey(CATEGORIES[r.category].key), accountBySystemKey('depreciation'),
    accountBySystemKey('ppe_acc_depreciation'), accountBySystemKey('disposal_gain'), accountBySystemKey('disposal_loss')])
  const text = `${r.code} ${r.name}`
  const L = (accountId, d, cr, description) => ({ accountId, debit: fromPaisa(Math.max(d, 0)), credit: fromPaisa(Math.max(cr, 0)), assetId: r.id, description })
  const lines = []
  if (catchUp > 0) lines.push(L(expAcc.id, catchUp, 0, `${text}: depreciation to disposal`), L(accDep.id, 0, catchUp, `${text}: depreciation to disposal`))
  if (catchUp < 0) lines.push(L(expAcc.id, 0, -catchUp, `${text}: depreciation to disposal`), L(accDep.id, -catchUp, 0, `${text}: depreciation to disposal`))
  if (accumulated) lines.push(L(accDep.id, accumulated, 0, REMOVED))
  if (proceeds) lines.push({ ...L(into, proceeds, 0, `${text}: sold`), assetId: r.id })
  lines.push(L(ppe.id, 0, c.cost, `${text}: cost removed`))
  if (gain > 0) lines.push(L(gainAcc.id, 0, gain, `${text}: gain on disposal`))
  if (gain < 0) lines.push(L(lossAcc.id, -gain, 0, `${text}: loss on disposal`))
  const e = await createEntry({ date, entryType: 'JV', post: true, memo: `${text} ${proceeds ? `sold for ${money(proceeds)}` : 'scrapped'}${blank(b.note) ? `: ${blank(b.note)}` : ''}`,
    source: { type: 'asset', id: r.id, event: 'disposal' }, lines }, user)
  await sql`UPDATE fin_assets SET status = 'Disposed', disposed_on = ${date}::date, disposal_proceeds = ${fromPaisa(proceeds)}::numeric,
    disposal_entry_id = ${e.id}, disposal_note = ${blank(b.note)} WHERE id = ${r.id}`
  for (const m of later) await postDepreciation({ month: m }, user)
  return getAsset(r.id)
}
export async function undoDisposal(id, { reason } = {}, user) {
  const [r] = await sql`SELECT * FROM fin_assets WHERE id = ${Number(id) || 0}`
  if (!r) throw new HttpError(404, 'Asset not found')
  if (r.status !== 'Disposed' || !r.disposal_entry_id) throw new HttpError(400, `${r.code} has not been disposed of`)
  if (!blank(reason)) throw new HttpError(400, 'Say why the disposal is being undone')
  await reverseEntry(r.disposal_entry_id, { reason: `Disposal of ${r.code} undone: ${reason}` }, user)
  await sql`UPDATE fin_assets SET status = 'In use', disposed_on = NULL, disposal_proceeds = NULL, disposal_entry_id = NULL, disposal_note = NULL WHERE id = ${r.id}`
  return getAsset(r.id)
}

// ── Expenses that may be fixed assets ──────────────────────────────────
// Anything booked to an asset account but not on the register, and large expenses (at or above the
// capitalisation threshold) on accounts where equipment could hide, not yet reviewed
const NEVER_ASSETS = ['rent', 'utilities', 'salaries_admin', 'marketing_ads', 'pr_cost', 'photoshoots', 'events', 'courier_charges', 'courier_deductions',
  'reseller_commission', 'reseller_alteration', 'bank_charges', 'gateway_fees', 'professional_fees', 'depreciation', 'ecl_expense', 'fx_loss',
  'fx_loss_unrealised', 'disposal_loss', 'lease_interest', 'packaging']
export async function assetSuggestions() {
  const { capitalisationThreshold } = await getSettings()
  const ppeKeys = Object.values(CATEGORIES).map((c) => c.key)
  const rows = await sql`
    SELECT x.id, x.expense_date, x.amount, x.description, a.code, a.name AS account_name, a.system_key, s.name AS supplier_name, e.entry_no,
           (a.system_key = ANY(${ppeKeys})) AS on_asset_account
    FROM fin_expenses x JOIN fin_accounts a ON a.id = x.account_id LEFT JOIN fin_suppliers s ON s.id = x.supplier_id LEFT JOIN fin_entries e ON e.id = x.entry_id
    WHERE x.status = 'Posted' AND NOT EXISTS (SELECT 1 FROM fin_assets f WHERE f.expense_id = x.id)
      AND (a.system_key = ANY(${ppeKeys})
           OR (NOT x.not_an_asset AND a.type = 'expense' AND x.amount >= ${capitalisationThreshold}::numeric AND NOT (coalesce(a.system_key, '') = ANY(${NEVER_ASSETS}))))
    ORDER BY x.expense_date DESC`
  return rows.map((x) => ({ expenseId: x.id, date: day(x.expense_date), amount: money(P(x.amount)), description: x.description || '', supplier: x.supplier_name || '',
    account: `${x.code} ${x.account_name}`, entryNo: x.entry_no || '', onAssetAccount: x.on_asset_account,
    category: Object.entries(CATEGORIES).find(([, c]) => c.key === x.system_key)?.[0] || null }))
}
export async function dismissSuggestion(expenseId) {
  const [x] = await sql`UPDATE fin_expenses SET not_an_asset = true WHERE id = ${Number(expenseId) || 0} RETURNING id`
  if (!x) throw new HttpError(404, 'Expense not found')
  return assetSuggestions()
}

// ── Movement schedule (notes to the accounts) ──────────────────────────
// Per kind of asset: cost and accumulated depreciation at the start, additions / charge, disposals, at the end
export async function assetSchedule({ from, to }) {
  const [rows, accDep] = await Promise.all([sql`SELECT * FROM fin_assets`, accountBySystemKey('ppe_acc_depreciation')])
  const lines = await sql`
    SELECT l.asset_id, l.debit, l.credit, l.description, (e.entry_date < ${from}::date) AS before
    FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'Draft'
    WHERE l.asset_id IS NOT NULL AND l.account_id = ${accDep.id} AND e.entry_date <= ${to}::date`
  const out = Object.fromEntries(Object.keys(CATEGORIES).map((k) => [k, { costOpen: 0, additions: 0, costDisposals: 0, depOpen: 0, charge: 0, depDisposals: 0 }]))
  for (const r of rows) {
    const g = out[r.category], c = toCalc(r)
    const acq = day(r.acquired_on), disp = day(r.disposed_on)
    if (acq > to) continue
    const base = r.source === 'opening' ? Math.min(c.openingDepreciation, c.cost - c.residual) : 0
    if (acq < from || r.source === 'opening') g.costOpen += c.cost; else g.additions += c.cost
    g.depOpen += base
    if (disp && disp >= from && disp <= to) g.costDisposals += c.cost
    if (disp && disp < from) { g.costOpen -= c.cost; g.depOpen -= base }
  }
  const cat = new Map(rows.map((r) => [r.id, r.category]))
  for (const l of lines) {
    const g = out[cat.get(l.asset_id)]
    const amt = P(l.credit) - P(l.debit)
    const removal = l.description === REMOVED
    if (l.before) g.depOpen += amt
    else if (removal) g.depDisposals += -amt
    else g.charge += amt
  }
  return Object.entries(out).map(([k, g]) => {
    const costClose = g.costOpen + g.additions - g.costDisposals, depClose = g.depOpen + g.charge - g.depDisposals
    return { category: k, label: CATEGORIES[k].label, costOpen: money(g.costOpen), additions: money(g.additions), costDisposals: money(g.costDisposals), costClose: money(costClose),
      depOpen: money(g.depOpen), charge: money(g.charge), depDisposals: money(g.depDisposals), depClose: money(depClose),
      carryingOpen: money(g.costOpen - g.depOpen), carryingClose: money(costClose - depClose) }
  })
}
