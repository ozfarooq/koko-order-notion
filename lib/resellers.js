// Reseller (B2B) operations: settings, statement entry, payments received, returns.
import { neon } from '@neondatabase/serverless'
import { HttpError, num, blank } from './db.js'

let _sql
const db = () => (_sql ??= neon(process.env.DATABASE_URL))
const sql = (...args) => db()(...args)
const UUID = /^[0-9a-f-]{36}$/i
const money = (v) => (v === '' || v == null ? 0 : Number(v))
const resellerId = (id) => { const n = Number(id); if (!Number.isInteger(n)) throw new HttpError(404, 'Reseller not found'); return n }

// ── Settings ───────────────────────────────────────────────────────────
function validate(b, partial) {
  if (!partial || b.name !== undefined) if (!blank(b.name)) throw new HttpError(400, 'Reseller name is required')
  if (b.commissionPct !== undefined) {
    const c = Number(b.commissionPct)
    if (!(c >= 0 && c < 100)) throw new HttpError(400, 'Commission must be between 0 and 99.99%')
  }
  if (b.currency !== undefined && !/^[A-Za-z]{3}$/.test(b.currency || '')) throw new HttpError(400, 'Currency must be a 3-letter code like AED')
}

export async function createReseller(b) {
  validate(b)
  const [r] = await sql`
    INSERT INTO resellers (name, address, city, country, currency, commission_pct)
    VALUES (${blank(b.name)}, ${blank(b.address)}, ${blank(b.city)}, ${blank(b.country)}, ${(b.currency || 'AED').toUpperCase()}, ${Number(b.commissionPct ?? 30)})
    RETURNING id`
  return { id: r.id }
}

// A new commission rate applies to future handovers only — existing ones keep their locked-in rate.
export async function updateReseller(id, b) {
  validate(b, true)
  const rows = await sql`
    UPDATE resellers SET
      name           = COALESCE(${blank(b.name)}, name),
      address        = CASE WHEN ${b.address !== undefined} THEN ${blank(b.address)} ELSE address END,
      city           = CASE WHEN ${b.city !== undefined} THEN ${blank(b.city)} ELSE city END,
      country        = CASE WHEN ${b.country !== undefined} THEN ${blank(b.country)} ELSE country END,
      currency       = COALESCE(${b.currency ? b.currency.toUpperCase() : null}, currency),
      commission_pct = COALESCE(${b.commissionPct === undefined || b.commissionPct === '' ? null : Number(b.commissionPct)}::numeric, commission_pct)
    WHERE id = ${resellerId(id)} RETURNING id`
  if (!rows.length) throw new HttpError(404, 'Reseller not found')
  return { id: rows[0].id }
}

// Pieces must exist, belong to this reseller and be in one of `statuses`
async function checkPieces(rid, ids, statuses, what) {
  if (!Array.isArray(ids) || !ids.length) throw new HttpError(400, `Choose at least one piece`)
  if (ids.some((x) => !UUID.test(x))) throw new HttpError(400, 'Unknown piece')
  const rows = await sql`
    SELECT ci.id, ci.status, ci.product_id, ci.price, ci.designer_discount, ci.reseller_discount, p.name
    FROM consignment_items ci JOIN consignments c ON c.id = ci.consignment_id JOIN products p ON p.id = ci.product_id
    WHERE ci.id = ANY(${ids}::uuid[]) AND c.reseller_id = ${rid}`
  if (rows.length !== new Set(ids).size) throw new HttpError(400, 'Some pieces don\'t belong to this reseller')
  const wrong = rows.filter((r) => !statuses.includes(r.status))
  if (wrong.length) throw new HttpError(400, `${wrong.map((w) => w.name).join(', ')}: ${what}`)
  return rows
}

// ── Statement entry: many sold lines at once (all or nothing) ──────────
// lines: [{ pieceId, soldOn, invoiceNo, code, designerDiscount, resellerDiscount, alterationCharge }]
export async function enterStatement(id, lines = [], user) {
  const rid = resellerId(id)
  if (!lines.length) throw new HttpError(400, 'Add at least one sale')
  const pieces = await checkPieces(rid, lines.map((l) => l.pieceId), ['At Store', 'Sold'], 'already paid or returned')
  const byId = new Map(pieces.map((p) => [p.id, p]))
  const queries = []
  for (const l of lines) {
    const p = byId.get(l.pieceId)
    const dd = money(l.designerDiscount), rd = money(l.resellerDiscount), alt = money(l.alterationCharge)
    if ([dd, rd, alt].some((v) => v < 0)) throw new HttpError(400, 'Amounts cannot be negative')
    if (p.price != null && dd + rd > Number(p.price)) throw new HttpError(400, `${p.name}: discounts cannot be more than the price`)
    if (!blank(l.soldOn)) throw new HttpError(400, `${p.name}: sale date is required`)
    queries.push(db()`
      UPDATE consignment_items SET status = 'Sold', sold_on = ${l.soldOn}::date, paid_on = NULL, returned_on = NULL,
        designer_discount = ${dd}, reseller_discount = ${rd}, alteration_charge = ${alt},
        reseller_invoice_no = ${blank(l.invoiceNo)}, updated_by = ${user?.id ?? null}
      WHERE id = ${l.pieceId}`)
    if (blank(l.code)) queries.push(db()`
      INSERT INTO reseller_products (reseller_id, product_id, reseller_code) VALUES (${rid}, ${p.product_id}, ${blank(l.code)})
      ON CONFLICT (reseller_id, product_id) DO UPDATE SET reseller_code = EXCLUDED.reseller_code`)
  }
  await db().transaction(queries)
  return { recorded: lines.length }
}

// ── Payments received ─────────────────────────────────────────────────
export async function listPayments(id) {
  const rows = await sql`
    SELECT rp.*, u.name AS created_by_name,
           count(ci.id)::int AS pieces, COALESCE(sum(d.net_to_koko), 0) AS expected
    FROM reseller_payments rp
    LEFT JOIN users u ON u.id = rp.created_by
    LEFT JOIN consignment_items ci ON ci.payment_id = rp.id
    LEFT JOIN consignment_items_detail d ON d.id = ci.id
    WHERE rp.reseller_id = ${resellerId(id)}
    GROUP BY rp.id, u.name ORDER BY rp.paid_on DESC, rp.id DESC`
  return rows.map((r) => ({
    id: r.id, paidOn: r.paid_on instanceof Date ? r.paid_on.toISOString().slice(0, 10) : String(r.paid_on).slice(0, 10),
    amount: num(r.amount), currency: r.currency, reference: r.reference || '', notes: r.notes || '',
    pieces: r.pieces, expected: num(r.expected), createdBy: r.created_by_name,
  }))
}

// One statement: insert the payment and mark its pieces Paid in a single atomic query
export async function recordPayment(id, b, user) {
  const rid = resellerId(id)
  const [reseller] = await sql`SELECT currency FROM resellers WHERE id = ${rid}`
  if (!reseller) throw new HttpError(404, 'Reseller not found')
  await checkPieces(rid, b.pieceIds, ['Sold'], 'not marked as sold yet')
  if (!blank(b.paidOn)) throw new HttpError(400, 'Payment date is required')
  if (!(money(b.amount) >= 0)) throw new HttpError(400, 'Enter the amount received')
  const rows = await sql`
    WITH pay AS (
      INSERT INTO reseller_payments (reseller_id, paid_on, amount, currency, reference, notes, created_by)
      VALUES (${rid}, ${b.paidOn}::date, ${money(b.amount)}, ${reseller.currency}, ${blank(b.reference)}, ${blank(b.notes)}, ${user?.id ?? null})
      RETURNING id
    )
    UPDATE consignment_items SET status = 'Paid', paid_on = ${b.paidOn}::date, payment_id = (SELECT id FROM pay), updated_by = ${user?.id ?? null}
    WHERE id = ANY(${b.pieceIds}::uuid[])
    RETURNING (SELECT id FROM pay) AS payment_id`
  return { paymentId: rows[0].payment_id, pieces: rows.length }
}

// Undo a payment entered by mistake: its pieces go back to Sold
export async function deletePayment(id, paymentId) {
  const rid = resellerId(id)
  const [p] = await sql`SELECT id FROM reseller_payments WHERE id = ${Number(paymentId)} AND reseller_id = ${rid}`
  if (!p) throw new HttpError(404, 'Payment not found')
  await db().transaction([
    db()`UPDATE consignment_items SET status = 'Sold', paid_on = NULL, payment_id = NULL WHERE payment_id = ${p.id}`,
    db()`DELETE FROM reseller_payments WHERE id = ${p.id}`,
  ])
}

// ── Returns ───────────────────────────────────────────────────────────
export async function recordReturns(id, b, user) {
  const rid = resellerId(id)
  await checkPieces(rid, b.pieceIds, ['At Store'], 'only pieces at the store can be returned')
  if (!blank(b.returnedOn)) throw new HttpError(400, 'Return date is required')
  const rows = await sql`
    UPDATE consignment_items SET status = 'Returned', returned_on = ${b.returnedOn}::date, return_reason = ${blank(b.reason)},
      sold_on = NULL, paid_on = NULL, updated_by = ${user?.id ?? null}
    WHERE id = ANY(${b.pieceIds}::uuid[]) RETURNING id`
  return { returned: rows.length }
}
