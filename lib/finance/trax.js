// Trax settlements ("Payment Details / Sales Tax Invoice"). The owner copies the invoice page from the Trax
// portal (select all, copy) and pastes it, or uploads it as a spreadsheet; this reads it here, never sent
// anywhere else. Each row is a shipment: Arrival rows carry the booking charges, Delivered rows the cash
// collected on delivery (COD) less cash handling, GST, the withholding Trax deducts (WHT s6A) and the COD
// sales tax. One entry per settlement:
//   Dr Bank (what Trax paid out), Courier charges 6400 (charges + GST, per order), Courier deductions 6420
//      (WHT and COD sales tax while tax is off; from the tax start date 1400 / 1410 tax credits, or 6420
//      when COD withholding is treated as final), Bank charges 6600 (IBFT)
//   Cr Trax COD clearing 1150 (the cash collected, per order)
// The order's COD payment (Dr 1150) must be on the order: the import adds it, or switches a payment of the
// same amount recorded as another method, so the clearing account empties as each order is settled.
import { neon } from '@neondatabase/serverless'
import { HttpError, blank } from '../db.js'
import { toPaisa, fromPaisa } from './money.js'
import { createEntry, reverseEntry, accountBySystemKey } from './ledger.js'
import { day, isDate, today } from './expenses.js'
import { addPayment, updatePayment, afterOrderChange } from './sales.js'
import { taxSettings, taxOnAt } from './tax.js'

let _sql
const db = () => (_sql ??= neon(process.env.DATABASE_URL))
const sql = (...args) => db()(...args)
const P = (v) => toPaisa(v ?? 0)
const money = (p) => fromPaisa(Math.round(p))
const num = (s) => { const t = String(s).replace(/,/g, '').trim(); return /^-?\d+(\.\d+)?$/.test(t) ? Math.round(Number(t) * 100) : null }

// ── Reading the invoice (pure) ─────────────────────────────────────────
// The 15 money columns at the end of every row, in the portal's order
export const ROW_COLUMNS = ['collection', 'weight', 'faf', 'finova', 'cashHandling', 'osa', 'adjustments', 'fintech', 'totalCharges', 'gst', 'wht', 'codSst', 'sms', 'netRetained', 'netDisbursement']
const field = (text, re) => { const m = text.match(re); return m ? m[1].trim() : null }

export function parseTraxText(text) {
  if (!blank(text)) throw new Error('Paste the Trax invoice page or upload it')
  const t = String(text).replace(/\r/g, '')
  const head = {
    invoiceNo: field(t, /Payment\s*\/\s*Invoice ID\s*[\t:]\s*([^\t\n]+)/i),
    printedOn: field(t, /Printed at\s*(\d{4}-\d{2}-\d{2})/i),
    collection: num(field(t, /Total Collection Amount(?:\s*\(PKR\))?\s*[\t:]\s*([-\d,.]+)/i) ?? ''),
    wht: num(field(t, /Total WHT Amount(?:\s*\(PKR\))?\s*[\t:]\s*([-\d,.]+)/i) ?? ''),
    sst: num(field(t, /Total SST Amount(?:\s*\(PKR\))?\s*[\t:]\s*([-\d,.]+)/i) ?? ''),
    payable: num(field(t, /Total Payable(?:\s*\(PKR\))?\s*[\t:]\s*([-\d,.]+)/i) ?? ''),
    ibft: num(field(t, /IBFT Charges\s*[\t:]\s*([-\d,.]+)/i) ?? ''),
  }
  // Rows: a serial number, then a long tracking number, then the type; a row runs until the next one or
  // the Total line. Cells may wrap onto several lines, so the row is read as tokens.
  const tokens = t.split(/[\t\n]+/).map((x) => x.trim()).filter(Boolean)
  const starts = []
  for (let i = 1; i < tokens.length - 1; i++) {
    if (/^\d{10,20}$/.test(tokens[i]) && /^\d{1,4}$/.test(tokens[i - 1]) && /^[A-Za-z][A-Za-z ]+$/.test(tokens[i + 1])) starts.push(i - 1)
  }
  const rows = []
  starts.forEach((s, k) => {
    let end = k + 1 < starts.length ? starts[k + 1] : tokens.length
    const totalAt = tokens.slice(s, end).findIndex((x) => /^Total$/i.test(x))
    if (totalAt > 0) end = s + totalAt
    const cells = tokens.slice(s, end)
    const nums = []
    for (let j = cells.length - 1; j >= 0 && nums.length < ROW_COLUMNS.length; j--) { const v = num(cells[j]); if (v === null) break; nums.unshift(v) }
    if (nums.length < ROW_COLUMNS.length) throw new Error(`Row ${cells[0]} (${cells[1]}): couldn't read its ${ROW_COLUMNS.length} amounts`)
    const r = Object.fromEntries(ROW_COLUMNS.map((c, j) => [c, nums[j]]))
    const order = cells.find((x) => /^SO-?\s*\d+$/i.test(x))
    rows.push({ serial: Number(cells[0]), trackingNo: cells[1], kind: cells[2], orderNumber: order ? `SO-${order.replace(/\D/g, '').padStart(6, '0')}` : null, ...r })
  })
  if (!rows.length) throw new Error('No shipment rows found: copy the whole invoice page, including the table')
  return { ...head, rows }
}

// Totals and checks: every row adds up, the rows add up to the invoice, and what is paid out is the rows
// less the IBFT fee (Trax rounds the payout to the rupee)
export function checkSettlement(p) {
  const problems = []
  const sum = (k) => p.rows.reduce((s, r) => s + r[k], 0)
  for (const r of p.rows) {
    if (r.totalCharges + r.gst + r.wht + r.codSst + r.sms !== r.netRetained) problems.push(`Row ${r.serial}: charges, GST and deductions don't add up to what Trax kept`)
    if (r.collection - r.netRetained !== r.netDisbursement) problems.push(`Row ${r.serial}: collected less kept isn't the amount paid out`)
  }
  const totals = { collection: sum('collection'), charges: sum('totalCharges'), gst: sum('gst'), wht: sum('wht'), sst: sum('codSst'), other: sum('sms'), net: sum('netDisbursement') }
  if (p.collection != null && p.collection !== totals.collection) problems.push(`The rows collect ${money(totals.collection)} but the invoice says ${money(p.collection)}`)
  if (p.wht != null && p.wht !== totals.wht) problems.push(`The rows' WHT is ${money(totals.wht)} but the invoice says ${money(p.wht)}`)
  if (p.sst != null && p.sst !== totals.sst) problems.push(`The rows' COD sales tax is ${money(totals.sst)} but the invoice says ${money(p.sst)}`)
  const ibft = p.ibft ?? 0
  const computed = totals.net - ibft
  const payable = p.payable ?? computed
  const rounding = payable - computed
  if (Math.abs(rounding) >= 100) problems.push(`The rows less IBFT come to ${money(computed)} but the invoice pays ${money(payable)}`)
  return { totals: { ...totals, ibft, payable, rounding }, problems }
}

// ── Preview and import ─────────────────────────────────────────────────
async function readInput(b) {
  let p
  try { p = parseTraxText(b.text) } catch (err) { throw new HttpError(400, err.message) }
  // Typed fields win over what was read (a partial copy may miss the header)
  const opt = (v) => (v === undefined || v === null || v === '' ? null : P(v))
  if (blank(b.invoiceNo)) p.invoiceNo = blank(b.invoiceNo)
  if (opt(b.ibft) != null) p.ibft = opt(b.ibft)
  if (opt(b.payable) != null) p.payable = opt(b.payable)
  return p
}
export async function previewSettlement(b) {
  const p = await readInput(b)
  const chk = checkSettlement(p)
  const problems = [...chk.problems]
  if (!p.invoiceNo) problems.push('Enter the invoice number (Payment / Invoice ID)')
  const date = isDate(b.date) ? b.date : p.printedOn || today()
  if (p.invoiceNo) {
    const [dup] = await sql`SELECT id, settled_on FROM fin_courier_settlements WHERE courier = 'Trax' AND invoice_no = ${p.invoiceNo} AND status = 'Posted'`
    if (dup) problems.push(`Invoice ${p.invoiceNo} is already imported (${day(dup.settled_on)})`)
  }
  const numbers = [...new Set(p.rows.map((r) => r.orderNumber).filter(Boolean))]
  const orders = await sql`SELECT o.id, o.order_number, o.status, o.amount_pkr, o.balance_due_pkr, o.paid_on::text AS paid_on, o.paid_on_inferred, c.name FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.order_number = ANY(${numbers})`
  const pays = await sql`SELECT id, order_id, amount, method, paid_on::text AS paid_on FROM customer_payments WHERE order_id = ANY(${orders.map((o) => o.id)}::uuid[]) ORDER BY paid_on, id`
  const seen = await sql`SELECT l.tracking_no, l.kind, s.invoice_no FROM fin_courier_settlement_lines l JOIN fin_courier_settlements s ON s.id = l.settlement_id AND s.status = 'Posted'
    WHERE l.tracking_no = ANY(${p.rows.map((r) => r.trackingNo)})`
  const used = new Set()
  const rows = p.rows.map((r) => {
    const o = orders.find((x) => x.order_number === r.orderNumber)
    const out = { ...Object.fromEntries(ROW_COLUMNS.map((c) => [c, money(r[c])])), serial: r.serial, trackingNo: r.trackingNo, kind: r.kind, orderNumber: r.orderNumber,
      orderId: o?.id ?? null, customer: o?.name || '', action: null, note: '' }
    const again = seen.find((x) => x.tracking_no === r.trackingNo && x.kind === r.kind)
    if (again) problems.push(`Row ${r.serial} (${r.trackingNo} ${r.kind}) was already in invoice ${again.invoice_no}`)
    if (r.collection <= 0) return out
    if (!o) { problems.push(`Row ${r.serial}: order ${r.orderNumber || '(none)'} isn't in the CRM`); return out }
    // The cash Trax collected must be a Trax COD payment on the order
    const mine = pays.filter((x) => x.order_id === o.id && !used.has(x.id))
    const cod = mine.filter((x) => x.method === 'trax_cod').reduce((s, x) => s + P(x.amount), 0)
    if (cod >= r.collection) { out.action = 'ok'; out.note = 'Trax COD payment already on the order'; return out }
    const same = mine.find((x) => x.method !== 'trax_cod' && P(x.amount) === r.collection)
    if (same) { used.add(same.id); out.action = 'switch'; out.paymentId = same.id; out.note = `Its ${money(r.collection)} payment of ${same.paid_on} becomes Trax COD (was ${same.method})`; return out }
    // An order paid date that was only estimated (old orders) becomes the settlement date: the sale happened then
    const redate = o.status === 'Paid' && o.paid_on_inferred && o.paid_on && o.paid_on < date
    if (redate) out.redate = true
    const later = redate ? ` The order's paid date (${o.paid_on}, estimated) becomes ${date}.` : ''
    if (P(o.balance_due_pkr) >= r.collection) { out.action = 'add'; out.note = `Adds a Trax COD payment of ${money(r.collection)} to the order.${later}`; return out }
    // Old orders were brought in with one payment for the whole price: the part Trax collected is split off
    const bigger = mine.filter((x) => x.method !== 'trax_cod' && P(x.amount) > r.collection).sort((x, y) => (x.paid_on < y.paid_on ? 1 : -1))[0]
    if (bigger) {
      used.add(bigger.id); out.action = 'split'; out.paymentId = bigger.id
      out.note = `Its ${money(P(bigger.amount))} ${bigger.method} payment of ${bigger.paid_on} is split: ${money(P(bigger.amount) - r.collection)} stays, ${money(r.collection)} becomes Trax COD on ${date}.${later}`
      return out
    }
    problems.push(`Row ${r.serial}: ${o.order_number} has no payment of ${money(r.collection)} to mark as Trax COD and only ${money(P(o.balance_due_pkr))} still due: check the order's payments`)
    return out
  })
  const t = chk.totals
  return {
    invoiceNo: p.invoiceNo, date, printedOn: p.printedOn, rows, problems,
    totals: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, money(v)])),
  }
}

export async function importSettlement(b, user) {
  const pv = await previewSettlement(b)
  if (pv.problems.length) throw new HttpError(400, pv.problems.join('; '))
  if (!isDate(pv.date)) throw new HttpError(400, 'Choose the date the payout reached the bank')
  const t = Object.fromEntries(Object.entries(pv.totals).map(([k, v]) => [k, P(v)]))
  // Payments first, so each order's COD sits in the clearing account before the settlement clears it
  for (const r of pv.rows) {
    if (r.action === 'switch') await updatePayment(r.paymentId, { method: 'trax_cod', notes: `Trax invoice ${pv.invoiceNo}` }, user)
    if (r.action === 'split') {
      const [pay] = await sql`SELECT amount FROM customer_payments WHERE id = ${r.paymentId}`
      await updatePayment(r.paymentId, { amount: fromPaisa(P(pay.amount) - P(r.collection)) }, user)
    }
    if (r.action === 'add' || r.action === 'split') await addPayment(r.orderId, { paidOn: pv.date, amount: r.collection, method: 'trax_cod', reference: r.trackingNo, notes: `Trax invoice ${pv.invoiceNo}` }, user)
    if (r.redate) { await sql`UPDATE orders SET paid_on = ${pv.date}::date, paid_on_inferred = false WHERE id = ${r.orderId}`; await afterOrderChange(r.orderId, user) }
  }
  const s = await taxSettings()
  const taxOn = taxOnAt(s, pv.date)
  const keys = ['bank_baf', 'courier_charges', 'courier_deductions', 'bank_charges', 'clearing_trax', 'tax_wht_suffered', 'st_withheld']
  const acc = Object.fromEntries(await Promise.all(keys.map(async (k) => [k, (await accountBySystemKey(k)).id])))
  const whtAcc = taxOn && s.codWhtTreatment === 'Adjustable' ? acc.tax_wht_suffered : acc.courier_deductions
  const sstAcc = taxOn ? acc.st_withheld : acc.courier_deductions
  const text = `Trax invoice ${pv.invoiceNo}`
  const L = (accountId, p, extra = {}) => ({ accountId, debit: p > 0 ? fromPaisa(p) : '0', credit: p < 0 ? fromPaisa(-p) : '0', ...extra })
  const lines = []
  if (t.payable) lines.push(L(acc.bank_baf, t.payable, { description: `${text}: paid out` }))
  for (const r of pv.rows) {
    const tag = { orderId: r.orderId || null, description: `${text}: ${r.trackingNo} ${r.kind}${r.orderNumber ? ` ${r.orderNumber}` : ''}` }
    const cost = P(r.totalCharges) + P(r.gst) + P(r.sms)
    if (cost) lines.push(L(acc.courier_charges, cost, tag))
    if (P(r.wht)) lines.push(L(whtAcc, P(r.wht), { ...tag, ...(taxOn ? { taxCode: 'W6A' } : {}) }))
    if (P(r.codSst)) lines.push(L(sstAcc, P(r.codSst), { ...tag, ...(taxOn ? { taxCode: 'STW' } : {}) }))
    if (P(r.collection)) lines.push(L(acc.clearing_trax, -P(r.collection), tag))
  }
  if (t.ibft) lines.push(L(acc.bank_charges, t.ibft, { description: `${text}: IBFT` }))
  if (t.rounding) lines.push(L(acc.courier_charges, -t.rounding, { description: `${text}: payout rounded to the rupee` }))
  const [st] = await sql`INSERT INTO fin_courier_settlements (invoice_no, settled_on, collection, charges, gst, wht, sst, other, ibft, rounding, payable, created_by)
    VALUES (${pv.invoiceNo}, ${pv.date}::date, ${fromPaisa(t.collection)}::numeric, ${fromPaisa(t.charges)}::numeric, ${fromPaisa(t.gst)}::numeric, ${fromPaisa(t.wht)}::numeric,
            ${fromPaisa(t.sst)}::numeric, ${fromPaisa(t.other)}::numeric, ${fromPaisa(t.ibft)}::numeric, ${fromPaisa(t.rounding)}::numeric, ${fromPaisa(t.payable)}::numeric, ${user?.id ?? null})
    RETURNING id`
  try {
    for (const [i, r] of pv.rows.entries()) {
      await sql`INSERT INTO fin_courier_settlement_lines (settlement_id, line_no, tracking_no, kind, order_number, order_id, collection, charges, gst, wht, sst, other, net, payment_action)
        VALUES (${st.id}, ${i + 1}, ${r.trackingNo}, ${r.kind}, ${r.orderNumber}, ${r.orderId}::uuid, ${r.collection}::numeric, ${r.totalCharges}::numeric, ${r.gst}::numeric,
                ${r.wht}::numeric, ${r.codSst}::numeric, ${r.sms}::numeric, ${r.netDisbursement}::numeric, ${r.action})`
    }
    const e = await createEntry({ date: pv.date, entryType: 'BK', post: true, memo: `${text}: ${pv.rows.length} shipment${pv.rows.length === 1 ? '' : 's'}`,
      source: { type: 'courier_settlement', id: st.id, event: 'posted' }, lines }, user)
    await sql`UPDATE fin_courier_settlements SET entry_id = ${e.id} WHERE id = ${st.id}`
    // Tax deducted from Koko, for the register (once tax is on)
    if (taxOn && t.wht) await sql`INSERT INTO fin_tax_suffered (tax_code, suffered_on, party, base_amount, amount, from_account, certificate_ref, entry_id, created_by)
      VALUES ('W6A', ${pv.date}::date, 'Trax', ${fromPaisa(t.collection)}::numeric, ${fromPaisa(t.wht)}::numeric, 'clearing_trax', ${pv.invoiceNo}, ${e.id}, ${user?.id ?? null})`
    if (taxOn && t.sst) await sql`INSERT INTO fin_tax_suffered (tax_code, suffered_on, party, base_amount, amount, from_account, certificate_ref, entry_id, created_by)
      VALUES ('STW', ${pv.date}::date, 'Trax', ${fromPaisa(t.collection)}::numeric, ${fromPaisa(t.sst)}::numeric, 'clearing_trax', ${pv.invoiceNo}, ${e.id}, ${user?.id ?? null})`
  } catch (err) {
    await sql`DELETE FROM fin_courier_settlement_lines WHERE settlement_id = ${st.id}`
    await sql`DELETE FROM fin_courier_settlements WHERE id = ${st.id}`
    throw err
  }
  return getSettlement(st.id)
}

// ── Lists ──────────────────────────────────────────────────────────────
const rowToSettlement = (s) => ({
  id: s.id, invoiceNo: s.invoice_no, date: day(s.settled_on), collection: money(P(s.collection)), charges: money(P(s.charges) + P(s.gst) + P(s.other)),
  deductions: money(P(s.wht) + P(s.sst)), ibft: money(P(s.ibft)), payable: money(P(s.payable)), status: s.status, entryId: s.entry_id, entryNo: s.entry_no || '',
  shipments: s.shipments ?? null, note: s.note || '',
})
export async function listSettlements() {
  const [rows, clearing] = await Promise.all([
    sql`SELECT s.*, e.entry_no, (SELECT count(*)::int FROM fin_courier_settlement_lines l WHERE l.settlement_id = s.id) AS shipments
        FROM fin_courier_settlements s LEFT JOIN fin_entries e ON e.id = s.entry_id ORDER BY s.settled_on DESC, s.id DESC`,
    // Cash collected by Trax and not yet paid out: Trax COD clearing per order
    sql`SELECT o.id, o.order_number, c.name, sum(l.debit - l.credit) AS n, min(e.entry_date)::text AS since
        FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'Draft' JOIN fin_accounts a ON a.id = l.account_id AND a.system_key = 'clearing_trax'
        LEFT JOIN orders o ON o.id = l.order_id LEFT JOIN customers c ON c.id = o.customer_id
        GROUP BY o.id, o.order_number, c.name HAVING sum(l.debit - l.credit) <> 0 ORDER BY min(e.entry_date)`,
  ])
  return {
    settlements: rows.map(rowToSettlement),
    awaiting: clearing.map((x) => ({ orderId: x.id, orderNumber: x.order_number || '(no order)', customer: x.name || '', amount: money(P(x.n)), since: x.since })),
    awaitingTotal: money(clearing.reduce((s, x) => s + P(x.n), 0)),
  }
}
export async function getSettlement(id) {
  const [s] = await sql`SELECT s.*, e.entry_no FROM fin_courier_settlements s LEFT JOIN fin_entries e ON e.id = s.entry_id WHERE s.id = ${Number(id) || 0}`
  if (!s) throw new HttpError(404, 'Settlement not found')
  const lines = await sql`SELECT * FROM fin_courier_settlement_lines WHERE settlement_id = ${s.id} ORDER BY line_no`
  return { ...rowToSettlement(s), lines: lines.map((l) => ({ trackingNo: l.tracking_no, kind: l.kind, orderNumber: l.order_number || '', orderId: l.order_id,
    collection: money(P(l.collection)), charges: money(P(l.charges) + P(l.gst) + P(l.other)), deductions: money(P(l.wht) + P(l.sst)), net: money(P(l.net)), action: l.payment_action || '' })) }
}
// Undo: the entry is reversed (COD payments added or switched on orders stay as they are)
export async function voidSettlement(id, { reason } = {}, user) {
  const [s] = await sql`SELECT * FROM fin_courier_settlements WHERE id = ${Number(id) || 0}`
  if (!s || s.status !== 'Posted') throw new HttpError(404, 'Settlement not found')
  if (!blank(reason)) throw new HttpError(400, 'Say why it is being undone')
  if (s.entry_id) await reverseEntry(s.entry_id, { reason: `Trax invoice ${s.invoice_no} undone: ${reason}` }, user)
  await sql`UPDATE fin_tax_suffered SET status = 'Void' WHERE entry_id = ${s.entry_id}`
  await sql`UPDATE fin_courier_settlements SET status = 'Void', note = ${blank(reason)} WHERE id = ${s.id}`
  return listSettlements()
}
