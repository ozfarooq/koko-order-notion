// Reseller (B2B) operations: settings, statement entry, payments received, returns.
import { neon } from '@neondatabase/serverless'
import { HttpError, num, blank } from './db.js'
import { syncStockFromConsignment } from './inventory.js'

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
  if (b.codePrefix !== undefined && codePrefix(b.codePrefix) && !/^[A-Z0-9][A-Z0-9-]{0,19}$/.test(codePrefix(b.codePrefix)))
    throw new HttpError(400, 'Code prefix can use letters, numbers and dashes, e.g. KOATLR')
  if (b.nextCode !== undefined && b.nextCode !== '' && !(Number.isInteger(Number(b.nextCode)) && Number(b.nextCode) >= 1 && Number(b.nextCode) <= 99999))
    throw new HttpError(400, 'Next code number must be a whole number from 1 to 99999')
}
// "koatlr-" → "KOATLR"; empty → null (no automatic codes)
const codePrefix = (v) => (blank(v) ? String(v).trim().toUpperCase().replace(/-+$/, '') || null : null)

export async function createReseller(b) {
  validate(b)
  const [r] = await sql`
    INSERT INTO resellers (name, address, city, country, currency, commission_pct, code_prefix, next_code)
    VALUES (${blank(b.name)}, ${blank(b.address)}, ${blank(b.city)}, ${blank(b.country)}, ${(b.currency || 'AED').toUpperCase()}, ${Number(b.commissionPct ?? 30)},
            ${codePrefix(b.codePrefix)}, ${b.nextCode ? Number(b.nextCode) : 1})
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
      commission_pct = COALESCE(${b.commissionPct === undefined || b.commissionPct === '' ? null : Number(b.commissionPct)}::numeric, commission_pct),
      code_prefix    = CASE WHEN ${b.codePrefix !== undefined} THEN ${codePrefix(b.codePrefix)} ELSE code_prefix END,
      next_code      = COALESCE(${b.nextCode === undefined || b.nextCode === '' ? null : Number(b.nextCode)}::int, next_code)
    WHERE id = ${resellerId(id)} RETURNING id`
  if (!rows.length) throw new HttpError(404, 'Reseller not found')
  return { id: rows[0].id }
}

// ── Automatic codes: prefix + running number per reseller (KOATLR-041) ──
// Outfits at this reseller (not only returned) that have no code yet, numbered in name order
// from the next free number: the setting, or past the highest code already using the prefix.
const codesPlan = (rid, ids) => sql`
  WITH r AS (SELECT code_prefix AS prefix, next_code FROM resellers WHERE id = ${rid} AND code_prefix IS NOT NULL),
  need AS (
    SELECT p.id, p.name, row_number() OVER (ORDER BY p.name, p.id) AS rn
    FROM products p
    WHERE p.id IN (SELECT ci.product_id FROM consignment_items ci JOIN consignments c ON c.id = ci.consignment_id
                   WHERE c.reseller_id = ${rid} AND ci.status <> 'Returned')
      AND (${ids}::int[] IS NULL OR p.id = ANY(${ids}::int[]))
      AND NOT EXISTS (SELECT 1 FROM reseller_products rp WHERE rp.reseller_id = ${rid} AND rp.product_id = p.id)
  ),
  start AS (
    SELECT r.prefix, GREATEST(r.next_code, COALESCE((
      SELECT max(substring(rp.reseller_code FROM '^' || r.prefix || '-([0-9]+)$')::int)
      FROM reseller_products rp WHERE rp.reseller_id = ${rid}), 0) + 1) AS n
    FROM r
  )
  SELECT need.id AS product_id, need.name, start.n + need.rn - 1 AS number,
         start.prefix || '-' || lpad((start.n + need.rn - 1)::text, GREATEST(3, length((start.n + need.rn - 1)::text)), '0') AS code
  FROM need, start ORDER BY need.rn`

// After a handover: its outfits that will need a code. Nothing is assigned yet; the reseller only
// codes a design once it approves the shipment, so codes are given from Settings after that.
export async function codesNeededForHandover(consignmentId) {
  const [c] = await sql`SELECT reseller_id, array_agg(DISTINCT ci.product_id) AS ids FROM consignments c
                        JOIN consignment_items ci ON ci.consignment_id = c.id WHERE c.id = ${Number(consignmentId)} GROUP BY c.reseller_id`
  if (!c) return []
  return (await codesPlan(c.reseller_id, c.ids)).map((r) => ({ productId: r.product_id, product: r.name, code: r.code }))
}

// Every design at this reseller (at the store, sold or awaiting payment) with its code, if it has one.
// A design without a code is "reserved": shipped, waiting for the reseller to confirm its number.
export async function listDesignCodes(id) {
  const rid = resellerId(id)
  const [rows, [next]] = await Promise.all([
    sql`
      SELECT p.id, p.name, p.image_url, min(c.handover_date)::text AS first_handover, count(*)::int AS pieces, rp.reseller_code
      FROM consignment_items ci JOIN consignments c ON c.id = ci.consignment_id JOIN products p ON p.id = ci.product_id
      LEFT JOIN reseller_products rp ON rp.reseller_id = c.reseller_id AND rp.product_id = p.id
      WHERE c.reseller_id = ${rid} AND ci.status <> 'Returned'
      GROUP BY p.id, p.name, p.image_url, rp.reseller_code
      ORDER BY rp.reseller_code NULLS LAST, min(c.handover_date), p.name`,
    sql`
      SELECT r.code_prefix AS prefix, GREATEST(r.next_code, COALESCE((
        SELECT max(substring(rp.reseller_code FROM '^' || r.code_prefix || '-([0-9]+)$')::int)
        FROM reseller_products rp WHERE rp.reseller_id = r.id), 0) + 1) AS n
      FROM resellers r WHERE r.id = ${rid}`,
  ])
  const nextCode = next?.prefix ? `${next.prefix}-${String(next.n).padStart(3, '0')}` : null
  return {
    nextCode,
    designs: rows.map((r) => ({ productId: r.id, product: r.name, imageUrl: r.image_url, firstHandover: r.first_handover, pieces: r.pieces, code: r.reseller_code || '' })),
  }
}

// Type in the code the reseller confirmed (or clear it). Moves the running number past it if it uses the prefix.
export async function setDesignCode(id, productId, rawCode) {
  const rid = resellerId(id), pid = Number(productId)
  const code = blank(rawCode) ? String(rawCode).trim().toUpperCase() : null
  if (code && !/^[A-Z0-9][A-Z0-9-]{0,29}$/.test(code)) throw new HttpError(400, 'Codes use letters, numbers and dashes, e.g. KOATLR-001')
  const [owned] = await sql`SELECT 1 FROM consignment_items ci JOIN consignments c ON c.id = ci.consignment_id WHERE c.reseller_id = ${rid} AND ci.product_id = ${pid} LIMIT 1`
  if (!owned) throw new HttpError(404, 'That design was never handed over to this reseller')
  if (!code) { await sql`DELETE FROM reseller_products WHERE reseller_id = ${rid} AND product_id = ${pid}`; return { productId: pid, code: '' } }
  const [taken] = await sql`SELECT p.name FROM reseller_products rp JOIN products p ON p.id = rp.product_id WHERE rp.reseller_id = ${rid} AND rp.reseller_code = ${code} AND rp.product_id <> ${pid}`
  if (taken) throw new HttpError(400, `${code} is already used by ${taken.name}`)
  await db().transaction([
    db()`INSERT INTO reseller_products (reseller_id, product_id, reseller_code) VALUES (${rid}, ${pid}, ${code})
         ON CONFLICT (reseller_id, product_id) DO UPDATE SET reseller_code = EXCLUDED.reseller_code`,
    db()`UPDATE resellers SET next_code = GREATEST(next_code, COALESCE(substring(${code} FROM '^' || code_prefix || '-([0-9]+)$')::int + 1, next_code))
         WHERE id = ${rid} AND code_prefix IS NOT NULL`,
  ])
  return { productId: pid, code }
}

// Gives codes to outfits without one (all of them, or just productIds) and moves the running number on.
// Both writes run in one transaction; a code someone took meanwhile makes it fail rather than duplicate.
export async function assignCodes(id, productIds = null) {
  const rid = resellerId(id)
  const ids = Array.isArray(productIds) ? productIds.map(Number).filter(Number.isInteger) : null
  const plan = await codesPlan(rid, ids)
  if (!plan.length) return []
  const last = Math.max(...plan.map((p) => Number(p.number)))
  await db().transaction([
    ...plan.map((p) => db()`INSERT INTO reseller_products (reseller_id, product_id, reseller_code) VALUES (${rid}, ${p.product_id}, ${p.code})`),
    db()`UPDATE resellers SET next_code = GREATEST(next_code, ${last + 1}) WHERE id = ${rid}`,
  ])
  return plan.map((p) => ({ productId: p.product_id, product: p.name, code: p.code }))
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
  const codes = lines.filter((l) => blank(l.code)).map((l) => ({ code: blank(l.code), productId: byId.get(l.pieceId)?.product_id }))
  if (codes.length) {
    const clash = await sql`SELECT rp.reseller_code, p.name FROM reseller_products rp JOIN products p ON p.id = rp.product_id
      WHERE rp.reseller_id = ${rid} AND rp.reseller_code = ANY(${codes.map((c) => c.code)}::text[])`
    for (const c of codes) {
      const other = clash.find((x) => x.reseller_code === c.code && !pieces.some((p) => p.product_id === c.productId && p.name === x.name))
      if (other) throw new HttpError(400, `Code ${c.code} already belongs to ${other.name}`)
    }
  }
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
  await syncStockFromConsignment(lines.map((l) => l.pieceId), user)
  return { recorded: lines.length }
}

// ── Payments received ─────────────────────────────────────────────────
export async function listPayments(id, user = null) {
  const rid = resellerId(id)
  const [rows, files] = await Promise.all([
    sql`
      SELECT rp.id, rp.paid_on::text AS paid_on, rp.period::text AS period, rp.amount, rp.amount_pkr, rp.currency,
             rp.reference, rp.notes, rp.difference_reason, u.name AS created_by_name,
             count(ci.id)::int AS pieces, COALESCE(sum(d.net_to_koko), 0) AS expected
      FROM reseller_payments rp
      LEFT JOIN users u ON u.id = rp.created_by
      LEFT JOIN consignment_items ci ON ci.payment_id = rp.id
      LEFT JOIN consignment_items_detail d ON d.id = ci.id
      WHERE rp.reseller_id = ${rid}
      GROUP BY rp.id, u.name ORDER BY rp.paid_on DESC, rp.id DESC`,
    sql`SELECT f.id, f.payment_id, f.name, f.mime, f.size FROM reseller_payment_files f
        JOIN reseller_payments rp ON rp.id = f.payment_id WHERE rp.reseller_id = ${rid} ORDER BY f.id`,
  ])
  const internal = user?.role !== 'reseller'
  return rows.map((r) => ({
    id: r.id, paidOn: r.paid_on, period: r.period ? r.period.slice(0, 7) : null,
    // A reseller sees only what they paid and for which sales: never Koko's bank details, PKR, notes or proof
    amount: num(r.amount), currency: r.currency,
    reference: internal ? r.reference || '' : '', notes: internal ? r.notes || '' : '',
    amountPkr: internal ? num(r.amount_pkr) : null,
    rate: internal && r.amount_pkr != null && Number(r.amount) > 0 ? Math.round((Number(r.amount_pkr) / Number(r.amount)) * 100) / 100 : null,
    differenceReason: internal ? r.difference_reason || '' : '',
    pieces: r.pieces, expected: num(r.expected), createdBy: internal ? r.created_by_name : null,
    files: internal ? files.filter((f) => f.payment_id === r.id).map((f) => ({ id: f.id, name: f.name, mime: f.mime, size: f.size })) : [],
  }))
}

// Fields shared by a new payment and an edit
function paymentFields(b, expected) {
  const period = blank(b.period)
  if (period && !/^\d{4}-\d{2}$/.test(period)) throw new HttpError(400, 'Statement month must look like 2026-09')
  const pkr = b.amountPkr === '' || b.amountPkr == null ? null : Number(b.amountPkr)
  if (pkr != null && !(pkr >= 0)) throw new HttpError(400, 'PKR received must be a number')
  const amount = money(b.amount)
  // Whatever doesn't match the statement needs a reason, so the books explain themselves later
  if (expected != null && Math.abs(amount - expected) >= 1 && !blank(b.differenceReason))
    throw new HttpError(400, `Received ${amount.toFixed(2)} but the statement says ${expected.toFixed(2)}. Add a reason for the difference (e.g. bank charges).`)
  return { period: period ? `${period}-01` : null, pkr, reason: blank(b.differenceReason) }
}

// One statement: insert the payment and mark its pieces Paid in a single atomic query
export async function recordPayment(id, b, user) {
  const rid = resellerId(id)
  const [reseller] = await sql`SELECT currency FROM resellers WHERE id = ${rid}`
  if (!reseller) throw new HttpError(404, 'Reseller not found')
  await checkPieces(rid, b.pieceIds, ['Sold'], 'not marked as sold yet')
  if (!blank(b.paidOn)) throw new HttpError(400, 'Payment date is required')
  if (!(money(b.amount) >= 0)) throw new HttpError(400, 'Enter the amount received')
  const [{ expected }] = await sql`SELECT COALESCE(sum(net_to_koko), 0) AS expected FROM consignment_items_detail WHERE id = ANY(${b.pieceIds}::uuid[])`
  const f = paymentFields(b, Math.round(Number(expected) * 100) / 100)
  const rows = await sql`
    WITH pay AS (
      INSERT INTO reseller_payments (reseller_id, paid_on, amount, currency, reference, notes, period, amount_pkr, difference_reason, created_by)
      VALUES (${rid}, ${b.paidOn}::date, ${money(b.amount)}, ${reseller.currency}, ${blank(b.reference)}, ${blank(b.notes)},
              ${f.period}::date, ${f.pkr}, ${f.reason}, ${user?.id ?? null})
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

// Fill in details later, e.g. the PKR amount once the bank credit shows up
export async function updatePayment(id, paymentId, b) {
  const rid = resellerId(id)
  const [p] = await sql`
    SELECT rp.id, rp.amount, rp.difference_reason, COALESCE(sum(d.net_to_koko), 0) AS expected, count(ci.id)::int AS pieces
    FROM reseller_payments rp LEFT JOIN consignment_items ci ON ci.payment_id = rp.id LEFT JOIN consignment_items_detail d ON d.id = ci.id
    WHERE rp.id = ${Number(paymentId)} AND rp.reseller_id = ${rid} GROUP BY rp.id`
  if (!p) throw new HttpError(404, 'Payment not found')
  // Fields not sent keep their saved values, so adding the PKR later doesn't re-ask for the reason
  const merged = { amount: b.amount ?? p.amount, period: b.period, amountPkr: b.amountPkr, differenceReason: b.differenceReason ?? p.difference_reason }
  const f = paymentFields(merged, p.pieces ? Math.round(Number(p.expected) * 100) / 100 : null)
  await sql`
    UPDATE reseller_payments SET
      paid_on           = COALESCE(${blank(b.paidOn)}::date, paid_on),
      amount            = ${money(merged.amount)},
      reference         = CASE WHEN ${b.reference !== undefined} THEN ${blank(b.reference)} ELSE reference END,
      notes             = CASE WHEN ${b.notes !== undefined} THEN ${blank(b.notes)} ELSE notes END,
      period            = CASE WHEN ${b.period !== undefined} THEN ${f.period}::date ELSE period END,
      amount_pkr        = CASE WHEN ${b.amountPkr !== undefined} THEN ${f.pkr}::numeric ELSE amount_pkr END,
      difference_reason = CASE WHEN ${b.differenceReason !== undefined} THEN ${f.reason} ELSE difference_reason END
    WHERE id = ${p.id}`
  return { id: p.id }
}

// ── Payment proof: the reseller's statement and the payment email ──────
const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
async function ownPayment(rid, paymentId) {
  const [p] = await sql`SELECT id FROM reseller_payments WHERE id = ${Number(paymentId)} AND reseller_id = ${rid}`
  if (!p) throw new HttpError(404, 'Payment not found')
  return p.id
}

// { name, mime, data: base64 }
export async function addPaymentFile(id, paymentId, b, user) {
  const pid = await ownPayment(resellerId(id), paymentId)
  if (!FILE_TYPES.includes(b.mime)) throw new HttpError(400, 'Attach a photo (JPG, PNG, WebP) or a PDF')
  const bytes = Buffer.from(String(b.data || ''), 'base64')
  if (!bytes.length) throw new HttpError(400, 'The file is empty')
  if (bytes.length > 2621440) throw new HttpError(400, 'Files can be up to 2.5 MB. Try a smaller photo or PDF.')
  const name = (blank(b.name) || 'attachment').slice(0, 120)
  const [r] = await sql`
    INSERT INTO reseller_payment_files (payment_id, name, mime, size, data, created_by)
    VALUES (${pid}, ${name}, ${b.mime}, ${bytes.length}, ${'\\x' + bytes.toString('hex')}::bytea, ${user?.id ?? null})
    RETURNING id, name, mime, size`
  return r
}

export async function getPaymentFile(id, paymentId, fileId) {
  const pid = await ownPayment(resellerId(id), paymentId)
  const [f] = await sql`SELECT name, mime, encode(data, 'base64') AS data FROM reseller_payment_files WHERE id = ${Number(fileId)} AND payment_id = ${pid}`
  if (!f) throw new HttpError(404, 'File not found')
  return { name: f.name, mime: f.mime, data: f.data.replace(/\s/g, '') }
}

export async function deletePaymentFile(id, paymentId, fileId) {
  const pid = await ownPayment(resellerId(id), paymentId)
  const rows = await sql`DELETE FROM reseller_payment_files WHERE id = ${Number(fileId)} AND payment_id = ${pid} RETURNING name`
  if (!rows.length) throw new HttpError(404, 'File not found')
  return rows[0]
}

// ── Returns ───────────────────────────────────────────────────────────
// Back to the studio: pieces at the store are marked Returned; pieces returned before studio stock
// existed are simply added to it. Either way they arrive At Studio, optionally labelled damaged.
// b: { pieceIds, returnedOn, reason, damaged: { [pieceId]: { note, askingPricePkr } } }
export async function recordReturns(id, b, user) {
  const rid = resellerId(id)
  const pieces = await checkPieces(rid, b.pieceIds, ['At Store', 'Returned'], 'only pieces at the store or already returned can come back to the studio')
  const atStore = pieces.filter((p) => p.status === 'At Store').map((p) => p.id)
  const earlier = pieces.filter((p) => p.status === 'Returned').map((p) => p.id)
  if (earlier.length) {
    const there = await sql`SELECT p.name FROM stock_pieces s JOIN products p ON p.id = s.product_id WHERE s.consignment_item_id = ANY(${earlier}::uuid[])`
    if (there.length) throw new HttpError(400, `${there.map((t) => t.name).join(', ')}: already in studio stock`)
  }
  if (atStore.length && !blank(b.returnedOn)) throw new HttpError(400, 'Return date is required')
  const damaged = Object.entries(b.damaged || {}).filter(([pid]) => b.pieceIds.includes(pid))
  for (const [, d] of damaged) {
    if (!blank(d?.note)) throw new HttpError(400, "Say what's wrong with each damaged piece")
    if (d.askingPricePkr !== '' && d.askingPricePkr != null && !(Number(d.askingPricePkr) >= 0)) throw new HttpError(400, 'Asking price must be a number')
  }
  if (atStore.length) await sql`
    UPDATE consignment_items SET status = 'Returned', returned_on = ${b.returnedOn}::date, return_reason = ${blank(b.reason)},
      sold_on = NULL, paid_on = NULL, updated_by = ${user?.id ?? null}
    WHERE id = ANY(${atStore}::uuid[])`
  await syncStockFromConsignment([...atStore, ...earlier], user)
  if (damaged.length) await db().transaction(damaged.map(([pid, d]) => db()`
    UPDATE stock_pieces SET damaged = true, damage_note = ${blank(d.note)},
      asking_price_pkr = ${d.askingPricePkr === '' || d.askingPricePkr == null ? null : Number(d.askingPricePkr)}
    WHERE consignment_item_id = ${pid}`))
  return { returned: atStore.length, toStudio: atStore.length + earlier.length, damaged: damaged.length }
}
