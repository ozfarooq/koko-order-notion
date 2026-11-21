// Studio inventory: one row per physical piece made ahead of an order (reseller stock, shoot
// samples, pieces returned by a reseller). Customer orders are stitch-to-order and never take
// a piece from here. Every status change is logged to stock_movements by a database trigger.
import { neon } from '@neondatabase/serverless'
import { HttpError, blank } from './db.js'

let _sql
const db = () => (_sql ??= neon(process.env.DATABASE_URL))
const sql = (...args) => db()(...args)

export const STOCK_SIZES = ['X-Small', 'Small', 'Medium', 'Large', 'X-Large']
export const STOCK_STATUSES = ['In Production', 'At Studio', 'At Shoot', 'With Reseller', 'Sold', 'Gifted', 'Archived', 'Damaged']
const MANUAL_STATUSES = STOCK_STATUSES.filter((s) => s !== 'With Reseller')   // only a handover sets With Reseller
const KINDS = ['Stock', 'Sample']
const SOURCES = ['Made', 'Opening count', 'Customer return']                    // 'Reseller return' comes from returns only
const UUID = /^[0-9a-f-]{36}$/i
const day = (d) => (d == null ? null : d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10))
const longDate = (d) => new Date(`${day(d)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

function checkStatus(status, moveNote) {
  if (status === 'With Reseller') throw new HttpError(400, 'Pieces go to a reseller through a handover, not by hand')
  if (!MANUAL_STATUSES.includes(status)) throw new HttpError(400, `Status must be one of: ${MANUAL_STATUSES.join(', ')}`)
  if (status === 'Damaged' && !blank(moveNote)) throw new HttpError(400, 'Say why the piece is damaged or lost')
  if (status === 'Gifted' && !blank(moveNote)) throw new HttpError(400, 'Say who the piece was given to, e.g. PR to @handle')
}

// ── Overview: one row per product ──────────────────────────────────────
export async function overview() {
  const [products, studio, resellers, samples, sold, stats] = await Promise.all([
    sql`SELECT p.id, p.name, p.image_url, p.is_active, p.collection_id, c.name AS collection,
               count(s.id) FILTER (WHERE s.status = 'In Production')::int AS in_production
        FROM products p LEFT JOIN collections c ON c.id = p.collection_id
        LEFT JOIN stock_pieces s ON s.product_id = p.id
        GROUP BY p.id, c.name ORDER BY p.collection_id DESC NULLS LAST, p.name`,
    sql`SELECT product_id, size, count(*)::int AS n FROM stock_pieces
        WHERE kind = 'Stock' AND status = 'At Studio' AND order_id IS NULL GROUP BY 1, 2`,
    sql`SELECT ci.product_id, r.id AS reseller_id, r.name, count(*)::int AS n
        FROM consignment_items ci JOIN consignments c ON c.id = ci.consignment_id JOIN resellers r ON r.id = c.reseller_id
        WHERE ci.status = 'At Store' GROUP BY 1, 2, 3 ORDER BY r.name`,
    sql`SELECT id, product_id, size, status, location_note FROM stock_pieces
        WHERE kind = 'Sample' AND status <> 'Damaged' ORDER BY created_at`,
    // Sold in the last 30 days: reseller sales plus studio pieces sold directly
    sql`SELECT product_id, count(*)::int AS n FROM (
          SELECT product_id FROM consignment_items WHERE sold_on >= CURRENT_DATE - 30
          UNION ALL
          SELECT s.product_id FROM stock_movements m JOIN stock_pieces s ON s.id = m.piece_id
          WHERE m.to_status = 'Sold' AND m.at >= now() - interval '30 days' AND s.consignment_item_id IS NULL
        ) x GROUP BY 1`,
    sql`SELECT
          (SELECT count(*) FROM stock_pieces WHERE kind = 'Stock' AND status = 'At Studio' AND order_id IS NULL)::int AS at_studio,
          (SELECT count(*) FROM stock_pieces WHERE status = 'In Production')::int AS in_production,
          (SELECT count(*) FROM consignment_items WHERE status = 'At Store')::int AS at_resellers,
          (SELECT count(*) FROM stock_pieces WHERE kind = 'Sample' AND status IN ('At Shoot', 'With Reseller'))::int AS samples_out,
          (SELECT count(*) FROM stock_pieces WHERE damaged AND status = 'At Studio' AND order_id IS NULL)::int AS damaged_for_sale`,
  ])
  const by = (rows) => rows.reduce((m, r) => m.set(r.product_id, [...(m.get(r.product_id) || []), r]), new Map())
  const studioBy = by(studio), resellerBy = by(resellers), sampleBy = by(samples)
  const soldBy = new Map(sold.map((r) => [r.product_id, r.n]))
  const collections = []
  for (const p of products) if (p.collection_id && !collections.some((c) => c.id === p.collection_id)) collections.push({ id: p.collection_id, name: p.collection })
  return {
    stats: { atStudio: stats[0].at_studio, inProduction: stats[0].in_production, atResellers: stats[0].at_resellers, samplesOut: stats[0].samples_out, damagedForSale: stats[0].damaged_for_sale },
    collections,   // newest first
    products: products.map((p) => ({
      productId: p.id, product: p.name, collectionId: p.collection_id, collection: p.collection, imageUrl: p.image_url, isActive: p.is_active,
      inProduction: p.in_production,
      atStudio: Object.fromEntries(STOCK_SIZES.map((s) => [s, (studioBy.get(p.id) || []).find((r) => r.size === s)?.n || 0])),
      atResellers: (resellerBy.get(p.id) || []).map((r) => ({ resellerId: r.reseller_id, name: r.name, count: r.n })),
      samples: (sampleBy.get(p.id) || []).map((s) => ({ id: s.id, size: s.size, status: s.status, locationNote: s.location_note || '' })),
      soldLast30: soldBy.get(p.id) || 0,
    })),
  }
}

// ── Pieces ─────────────────────────────────────────────────────────────
const PIECE_SELECT = `
  SELECT s.id, s.product_id, p.name AS product, p.image_url, c.name AS collection, s.size, s.kind, s.status, s.source,
         s.location_note, s.notes, s.made_on::text AS made_on, s.created_at, s.updated_at, s.consignment_item_id,
         s.damaged, s.damage_note, s.asking_price_pkr,
         r.id AS reseller_id, r.name AS reseller, ci.status AS reseller_status, o.id AS order_id, o.order_number
  FROM stock_pieces s
  JOIN products p ON p.id = s.product_id
  LEFT JOIN collections c ON c.id = p.collection_id
  LEFT JOIN consignment_items ci ON ci.id = s.consignment_item_id
  LEFT JOIN consignments cn ON cn.id = ci.consignment_id
  LEFT JOIN resellers r ON r.id = cn.reseller_id
  LEFT JOIN orders o ON o.id = s.order_id`

const rowToPiece = (r) => ({
  id: r.id, productId: r.product_id, product: r.product, imageUrl: r.image_url, collection: r.collection,
  size: r.size, kind: r.kind, status: r.status, source: r.source,
  locationNote: r.location_note || '', notes: r.notes || '', madeOn: day(r.made_on), createdAt: r.created_at, updatedAt: r.updated_at,
  consignmentItemId: r.consignment_item_id, resellerId: r.reseller_id ?? null, reseller: r.reseller || null, resellerStatus: r.reseller_status || null,
  orderId: r.order_id || null, orderNumber: r.order_number || null,
  damaged: !!r.damaged, damageNote: r.damage_note || '', askingPricePkr: r.asking_price_pkr == null ? null : Number(r.asking_price_pkr),
  // Mistakes can be deleted for a week; anything older is moved to Damaged or Archived so history stays
  canDelete: !r.consignment_item_id && !r.order_id && Date.now() - new Date(r.created_at).getTime() < 7 * 86400_000,
})

// status: comma-separated list; q: outfit name; damaged: '1' for pieces labelled damaged
export async function listPieces({ status, kind, productId, q, damaged } = {}) {
  const statuses = String(status || '').split(',').map((s) => s.trim()).filter((s) => STOCK_STATUSES.includes(s))
  const rows = await db().query(`${PIECE_SELECT}
    WHERE ($1::text[] IS NULL OR s.status = ANY($1))
      AND ($2::text IS NULL OR s.kind = $2)
      AND ($3::int IS NULL OR s.product_id = $3)
      AND ($4::text IS NULL OR p.name ILIKE '%' || $4 || '%')
      AND (NOT $6::boolean OR s.damaged)
    ORDER BY p.name, array_position($5::text[], s.size), s.made_on NULLS LAST, s.created_at
    LIMIT 1000`,
  [statuses.length ? statuses : null, KINDS.includes(kind) ? kind : null, Number.isInteger(Number(productId)) && productId ? Number(productId) : null, blank(q), [...STOCK_SIZES, 'Custom'], String(damaged) === '1'])
  return rows.map(rowToPiece)
}

async function getPiece(id) {
  if (!UUID.test(id || '')) throw new HttpError(404, 'Piece not found')
  const rows = await db().query(`${PIECE_SELECT} WHERE s.id = $1`, [id])
  if (!rows.length) throw new HttpError(404, 'Piece not found')
  return rowToPiece(rows[0])
}

// { productId, sizes: { Small: 1, Medium: 2 }, kind, status, source, madeOn, locationNote, notes }
export async function addPieces(b, user) {
  const productId = Number(b.productId)
  const [product] = Number.isInteger(productId) ? await sql`SELECT id, name FROM products WHERE id = ${productId}` : []
  if (!product) throw new HttpError(400, 'Choose an outfit')
  const kind = b.kind ?? 'Stock', status = b.status ?? 'At Studio', source = b.source ?? 'Made'
  if (!KINDS.includes(kind)) throw new HttpError(400, 'Kind must be Stock or Sample')
  if (!['In Production', 'At Studio'].includes(status)) throw new HttpError(400, 'New pieces are In Production or At Studio')
  if (!SOURCES.includes(source)) throw new HttpError(400, `Source must be one of: ${SOURCES.join(', ')}`)
  const sizes = []
  for (const [size, qty] of Object.entries(b.sizes || {})) {
    const n = Number(qty)
    if (!STOCK_SIZES.includes(size)) throw new HttpError(400, `Size must be one of: ${STOCK_SIZES.join(', ')}`)
    if (!Number.isInteger(n) || n < 0 || n > 50) throw new HttpError(400, `${size}: enter a whole number from 0 to 50`)
    for (let k = 0; k < n; k++) sizes.push(size)
  }
  if (!sizes.length) throw new HttpError(400, 'Add at least one piece')
  const madeOn = blank(b.madeOn)
  if (madeOn && !/^\d{4}-\d{2}-\d{2}$/.test(madeOn)) throw new HttpError(400, 'Made on must be a date')
  const note = source === 'Made' ? (status === 'In Production' ? 'Production batch' : 'Made') : source
  const rows = await sql`
    INSERT INTO stock_pieces (product_id, size, kind, status, source, made_on, location_note, notes, move_note, created_by)
    SELECT ${productId}, size, ${kind}, ${status}, ${source}, ${madeOn}::date, ${blank(b.locationNote)}, ${blank(b.notes)}, ${note}, ${user?.id ?? null}
    FROM unnest(${sizes}::text[]) AS size
    RETURNING id`
  return { created: rows.length, ids: rows.map((r) => r.id), product: product.name }
}

// Many outfits at once: { items: [{ productId, sizes: { Small: 2 } }], kind, status, source, madeOn, locationNote, notes }
export async function addPiecesBulk(b, user) {
  const items = Array.isArray(b.items) ? b.items : []
  const kind = b.kind ?? 'Stock', status = b.status ?? 'At Studio', source = b.source ?? 'Made'
  if (!KINDS.includes(kind)) throw new HttpError(400, 'Kind must be Stock or Sample')
  if (!['In Production', 'At Studio'].includes(status)) throw new HttpError(400, 'New pieces are In Production or At Studio')
  if (!SOURCES.includes(source)) throw new HttpError(400, `Source must be one of: ${SOURCES.join(', ')}`)
  const madeOn = blank(b.madeOn)
  if (madeOn && !/^\d{4}-\d{2}-\d{2}$/.test(madeOn)) throw new HttpError(400, 'Made on must be a date')
  const productIds = [], sizes = []
  for (const it of items) {
    const pid = Number(it.productId)
    if (!Number.isInteger(pid)) throw new HttpError(400, 'Unknown outfit')
    for (const [size, qty] of Object.entries(it.sizes || {})) {
      const n = Number(qty)
      if (!STOCK_SIZES.includes(size)) throw new HttpError(400, `Size must be one of: ${STOCK_SIZES.join(', ')}`)
      if (!Number.isInteger(n) || n < 0 || n > 50) throw new HttpError(400, `${size}: enter a whole number from 0 to 50`)
      for (let k = 0; k < n; k++) { productIds.push(pid); sizes.push(size) }
    }
  }
  if (!sizes.length) throw new HttpError(400, 'Add at least one piece')
  if (sizes.length > 1000) throw new HttpError(400, 'Add up to 1,000 pieces at a time')
  const known = await sql`SELECT id FROM products WHERE id = ANY(${[...new Set(productIds)]}::int[])`
  if (known.length !== new Set(productIds).size) throw new HttpError(400, 'Some outfits no longer exist')
  const note = source === 'Made' ? (status === 'In Production' ? 'Production batch' : 'Made') : source
  const rows = await sql`
    INSERT INTO stock_pieces (product_id, size, kind, status, source, made_on, location_note, notes, move_note, created_by)
    SELECT pid, size, ${kind}, ${status}, ${source}, ${madeOn}::date, ${kind === 'Sample' ? blank(b.locationNote) : null}, ${blank(b.notes)}, ${note}, ${user?.id ?? null}
    FROM unnest(${productIds}::int[], ${sizes}::text[]) AS t(pid, size)
    RETURNING id`
  return { created: rows.length, outfits: new Set(productIds).size }
}

// Damaged but still sellable: the label, what's wrong and an asking price. { damaged, damageNote, askingPricePkr }
function damageFields(b) {
  const damaged = !!b.damaged
  const note = damaged ? blank(b.damageNote) : null
  if (damaged && !note) throw new HttpError(400, "Say what's wrong with the piece")
  const price = !damaged || b.askingPricePkr === '' || b.askingPricePkr == null ? null : Number(b.askingPricePkr)
  if (price != null && !(price >= 0)) throw new HttpError(400, 'Asking price must be a number')
  return { damaged, note, price }
}

// Label pieces damaged (still for sale) or clear the label: { pieceIds, damaged, damageNote, askingPricePkr }
export async function markDamaged(b, user) {
  const ids = b.pieceIds
  if (!Array.isArray(ids) || !ids.length) throw new HttpError(400, 'Choose at least one piece')
  if (ids.length > 500 || ids.some((x) => !UUID.test(x))) throw new HttpError(400, 'Unknown piece')
  const f = damageFields(b)
  const pieces = await sql`SELECT s.id, s.status, p.name FROM stock_pieces s JOIN products p ON p.id = s.product_id WHERE s.id = ANY(${ids}::uuid[])`
  if (pieces.length !== new Set(ids).size) throw new HttpError(400, 'Some pieces no longer exist')
  const gone = pieces.filter((p) => !['At Studio', 'At Shoot', 'In Production'].includes(p.status))
  if (gone.length) throw new HttpError(400, `${gone.map((p) => `${p.name} (${p.status})`).join(', ')}: only pieces at the studio or a shoot can be labelled`)
  const rows = await sql`
    UPDATE stock_pieces SET damaged = ${f.damaged}, damage_note = ${f.note}, asking_price_pkr = ${f.price}, updated_by = ${user?.id ?? null}
    WHERE id = ANY(${ids}::uuid[]) RETURNING id`
  return { updated: rows.length }
}

// Edit status, kind, locationNote, notes, moveNote, orderNumber, and the damaged label
export async function updatePiece(id, b, user) {
  const piece = await getPiece(id)
  if (piece.status === 'With Reseller') throw new HttpError(400, `This piece is with ${piece.reseller || 'a reseller'}. Change it from the reseller screens.`)
  const status = b.status ?? piece.status
  if (b.status !== undefined && b.status !== piece.status) checkStatus(b.status, b.moveNote)
  if (b.kind !== undefined && !KINDS.includes(b.kind)) throw new HttpError(400, 'Kind must be Stock or Sample')
  // An order number links a sold or gifted piece to the order it went to; leaving those statuses drops the link
  const linkable = status === 'Sold' || status === 'Gifted'
  let orderId = linkable || status === 'At Studio' ? piece.orderId : null
  if (b.orderNumber !== undefined && linkable) {
    const no = blank(b.orderNumber)?.toUpperCase()
    orderId = null
    if (no) {
      const [o] = await sql`SELECT id FROM orders WHERE order_number = ${no}`
      if (!o) throw new HttpError(400, `Order ${no} not found`)
      orderId = o.id
    }
  }
  const changed = status !== piece.status
  const dmg = b.damaged !== undefined ? damageFields(b) : null
  await sql`
    UPDATE stock_pieces SET
      damaged          = COALESCE(${dmg ? dmg.damaged : null}::boolean, damaged),
      damage_note      = CASE WHEN ${!!dmg} THEN ${dmg?.note ?? null} ELSE damage_note END,
      asking_price_pkr = CASE WHEN ${!!dmg} THEN ${dmg?.price ?? null}::numeric ELSE asking_price_pkr END,
      status        = ${status},
      kind          = COALESCE(${b.kind ?? null}, kind),
      location_note = CASE WHEN ${b.locationNote !== undefined} THEN ${blank(b.locationNote)} ELSE location_note END,
      notes         = CASE WHEN ${b.notes !== undefined} THEN ${blank(b.notes)} ELSE notes END,
      order_id      = ${orderId}::uuid,
      move_note     = CASE WHEN ${changed} THEN ${blank(b.moveNote)} ELSE move_note END,
      updated_by    = ${user?.id ?? null}
    WHERE id = ${id}`
  return getPiece(id)
}

// Bulk status change: { pieceIds, status, moveNote } (Mark ready, Send to shoot, …)
export async function movePieces(b, user) {
  const ids = b.pieceIds
  if (!Array.isArray(ids) || !ids.length) throw new HttpError(400, 'Choose at least one piece')
  if (ids.length > 500 || ids.some((x) => !UUID.test(x))) throw new HttpError(400, 'Unknown piece')
  checkStatus(b.status, b.moveNote)
  const pieces = await sql`SELECT s.id, s.status, p.name FROM stock_pieces s JOIN products p ON p.id = s.product_id WHERE s.id = ANY(${ids}::uuid[])`
  if (pieces.length !== new Set(ids).size) throw new HttpError(400, 'Some pieces no longer exist')
  const away = pieces.filter((p) => p.status === 'With Reseller')
  if (away.length) throw new HttpError(400, `${away.map((p) => p.name).join(', ')}: with a reseller. Change it from the reseller screens.`)
  const rows = await sql`
    UPDATE stock_pieces SET status = ${b.status}, move_note = ${blank(b.moveNote)}, updated_by = ${user?.id ?? null},
      order_id = CASE WHEN ${b.status} IN ('Sold', 'Gifted') THEN order_id ELSE NULL END
    WHERE id = ANY(${ids}::uuid[]) AND status <> ${b.status} RETURNING id`
  return { moved: rows.length }
}

export async function pieceHistory(id) {
  await getPiece(id)
  const rows = await sql`
    SELECT m.id, m.from_status, m.to_status, m.note, m.at, u.name AS user_name
    FROM stock_movements m LEFT JOIN users u ON u.id = m.user_id
    WHERE m.piece_id = ${id} ORDER BY m.at DESC, m.id DESC`
  return rows.map((r) => ({ id: r.id, from: r.from_status, to: r.to_status, note: r.note || '', at: r.at, user: r.user_name || null }))
}

export async function deletePiece(id) {
  const piece = await getPiece(id)
  if (!piece.canDelete) throw new HttpError(400, 'Only pieces added by mistake in the last 7 days can be deleted. Mark it Damaged or Archived instead.')
  await sql`DELETE FROM stock_pieces WHERE id = ${id}`
  return piece
}

// At Studio stock per outfit and size, for the handover form
export async function availableStock() {
  const rows = await sql`
    SELECT product_id, size, count(*)::int AS n FROM stock_pieces
    WHERE kind = 'Stock' AND status = 'At Studio' AND order_id IS NULL GROUP BY 1, 2`
  return rows.map((r) => ({ productId: r.product_id, size: r.size, count: r.n }))
}

// ── Links to reseller handovers and status changes ─────────────────────
// Queries that record a handover's pieces in studio stock. `pieces` are the new consignment pieces
// ({ id, productId, size }); each takes the oldest matching At Studio stock piece (first in, first out)
// or, when there's none, gets a new piece recorded as made and already With Reseller.
// Returns queries to run in the same transaction as the consignment insert.
export async function handoverStockQueries(pieces, { reseller, handoverDate }, user) {
  const note = `Handover to ${reseller} on ${longDate(handoverDate)}`
  const keys = [...new Set(pieces.map((p) => `${p.productId}|${p.size}`))]
  const available = keys.length ? await sql`
    SELECT id, product_id, size FROM stock_pieces
    WHERE kind = 'Stock' AND status = 'At Studio' AND consignment_item_id IS NULL AND order_id IS NULL
      AND (product_id::text || '|' || size) = ANY(${keys}::text[])
    ORDER BY made_on NULLS LAST, created_at` : []
  const pool = new Map()
  for (const a of available) { const k = `${a.product_id}|${a.size}`; pool.set(k, [...(pool.get(k) || []), a.id]) }
  const take = { pieceIds: [], itemIds: [] }, make = []
  for (const p of pieces) {
    const next = pool.get(`${p.productId}|${p.size}`)?.shift()
    if (next) { take.pieceIds.push(next); take.itemIds.push(p.id) }
    else if ([...STOCK_SIZES, 'Custom'].includes(p.size)) make.push(p)
  }
  const queries = []
  // The status guard means a piece taken by someone else at the same moment is simply not linked twice
  if (take.pieceIds.length) queries.push(db()`
    UPDATE stock_pieces s SET status = 'With Reseller', consignment_item_id = u.item_id, move_note = ${note}, updated_by = ${user?.id ?? null}
    FROM unnest(${take.pieceIds}::uuid[], ${take.itemIds}::uuid[]) AS u(piece_id, item_id)
    WHERE s.id = u.piece_id AND s.status = 'At Studio'`)
  if (make.length) queries.push(db()`
    INSERT INTO stock_pieces (product_id, size, kind, status, source, consignment_item_id, made_on, move_note, created_by)
    SELECT product_id, size, 'Stock', 'With Reseller', 'Made', item_id, ${day(handoverDate)}::date, ${note}, ${user?.id ?? null}
    FROM unnest(${make.map((p) => p.productId)}::int[], ${make.map((p) => p.size)}::text[], ${make.map((p) => p.id)}::uuid[]) AS u(product_id, size, item_id)`)
  return { queries, fromStudio: take.pieceIds.length, newlyMade: make.length }
}

// After consignment pieces change status, bring their linked studio pieces along:
// At Store → With Reseller, Sold/Paid → Sold, Returned → At Studio. A returned piece from before
// studio stock existed gets a new At Studio piece (source 'Reseller return').
export async function syncStockFromConsignment(consignmentItemIds, user) {
  const ids = [...new Set((consignmentItemIds || []).filter((x) => UUID.test(x || '')))]
  if (!ids.length) return { synced: 0 }
  const rows = await sql`
    SELECT ci.id, ci.status, ci.product_id, ci.size, r.name AS reseller, s.id AS piece_id, s.status AS piece_status
    FROM consignment_items ci JOIN consignments c ON c.id = ci.consignment_id JOIN resellers r ON r.id = c.reseller_id
    LEFT JOIN stock_pieces s ON s.consignment_item_id = ci.id
    WHERE ci.id = ANY(${ids}::uuid[])`
  const target = { 'At Store': 'With Reseller', Sold: 'Sold', Paid: 'Sold', Returned: 'At Studio' }
  const noteFor = (r) => (r.status === 'Returned' ? `Returned by ${r.reseller}` : r.status === 'At Store' ? `Back at ${r.reseller}` : `Sold by ${r.reseller}`)
  const queries = []
  for (const r of rows) {
    const to = target[r.status]
    if (r.piece_id) {
      if (to && to !== r.piece_status) queries.push(db()`
        UPDATE stock_pieces SET status = ${to}, move_note = ${noteFor(r)}, updated_by = ${user?.id ?? null} WHERE id = ${r.piece_id}`)
    } else if (r.status === 'Returned' && [...STOCK_SIZES, 'Custom'].includes(r.size)) {
      queries.push(db()`
        INSERT INTO stock_pieces (product_id, size, kind, status, source, consignment_item_id, move_note, created_by)
        VALUES (${r.product_id}, ${r.size}, 'Stock', 'At Studio', 'Reseller return', ${r.id}, ${noteFor(r)}, ${user?.id ?? null})
        ON CONFLICT (consignment_item_id) DO NOTHING`)
    }
  }
  if (queries.length) await db().transaction(queries)
  return { synced: queries.length }
}

// ── Links to customer and PR orders ────────────────────────────────────
// Most orders are stitched for the customer and never touch stock. When an order is filled with a
// piece already at the studio (a shoot sample or a piece back from a reseller), the piece is reserved
// for the order (order_id set, still At Studio) and follows it: delivered or paid → Sold (Gifted for
// PR), cancelled → free again, returned by the customer → back At Studio.

// At Studio pieces that an order could use: free ones, plus those already reserved for this order
export async function piecesForOrder({ productIds, orderId } = {}) {
  const ids = String(productIds || '').split(',').map(Number).filter(Number.isInteger)
  if (!ids.length) return []
  const oid = UUID.test(orderId || '') ? orderId : null
  const rows = await sql`
    SELECT id, product_id, size, kind, source, order_id, damaged, damage_note, asking_price_pkr FROM stock_pieces
    WHERE product_id = ANY(${ids}::int[]) AND status = 'At Studio' AND (order_id IS NULL OR order_id = ${oid}::uuid)
    ORDER BY kind = 'Sample', made_on NULLS LAST, created_at`
  return rows.map((r) => ({
    id: r.id, productId: r.product_id, size: r.size, kind: r.kind, source: r.source, reserved: !!r.order_id,
    damaged: !!r.damaged, damageNote: r.damage_note || '', askingPricePkr: r.asking_price_pkr == null ? null : Number(r.asking_price_pkr),
  }))
}

// Before saving an order: every chosen piece must still be free at the studio (or already this order's)
export async function checkOrderPieces(pieceIds, orderId = null) {
  if (!Array.isArray(pieceIds) || !pieceIds.length) return
  if (pieceIds.length > 50 || pieceIds.some((x) => !UUID.test(x || ''))) throw new HttpError(400, 'Unknown studio piece')
  const rows = await sql`
    SELECT s.id, s.status, s.order_id, s.size, p.name FROM stock_pieces s JOIN products p ON p.id = s.product_id
    WHERE s.id = ANY(${pieceIds}::uuid[])`
  const taken = rows.filter((r) => r.status !== 'At Studio' || (r.order_id && r.order_id !== orderId))
  if (rows.length !== new Set(pieceIds).size || taken.length)
    throw new HttpError(400, `${taken.map((r) => `${r.name} (${r.size})`).join(', ') || 'A studio piece'} is no longer free at the studio. Untick it and save again.`)
}

// After an order is saved: reserve the chosen pieces (when pieceIds is given), then move them with the order's status
export async function syncOrderStock(orderId, user, { pieceIds } = {}) {
  const [o] = await sql`SELECT id, order_number, status, order_type FROM orders WHERE id = ${orderId}`
  if (!o) return
  const by = user?.id ?? null
  const queries = []
  if (Array.isArray(pieceIds)) {
    queries.push(db()`UPDATE stock_pieces SET order_id = NULL, updated_by = ${by}
                      WHERE order_id = ${orderId} AND status = 'At Studio' AND NOT (id = ANY(${pieceIds}::uuid[]))`)
    if (pieceIds.length) queries.push(db()`UPDATE stock_pieces SET order_id = ${orderId}, updated_by = ${by}
                      WHERE id = ANY(${pieceIds}::uuid[]) AND status = 'At Studio' AND (order_id IS NULL OR order_id = ${orderId})`)
  }
  const gone = o.order_type === 'PR' ? 'Gifted' : 'Sold'
  if (['Out for Delivery', 'Paid'].includes(o.status)) queries.push(db()`
    UPDATE stock_pieces SET status = ${gone}, move_note = ${`${gone} with ${o.order_number}`}, updated_by = ${by}
    WHERE order_id = ${orderId} AND status = 'At Studio'`)
  else if (['New', 'In Tailoring', 'Ready'].includes(o.status)) queries.push(db()`
    UPDATE stock_pieces SET status = 'At Studio', move_note = ${`${o.order_number} moved back to ${o.status}`}, updated_by = ${by}
    WHERE order_id = ${orderId} AND status IN ('Sold', 'Gifted')`)
  else if (o.status === 'Cancelled') queries.push(db()`
    UPDATE stock_pieces SET status = 'At Studio', order_id = NULL, move_note = ${`${o.order_number} cancelled`}, updated_by = ${by}
    WHERE order_id = ${orderId} AND status IN ('At Studio', 'Sold', 'Gifted')`)
  else if (o.status === 'Returned') queries.push(db()`
    UPDATE stock_pieces SET status = 'At Studio', order_id = NULL, move_note = ${`Returned by the customer (${o.order_number})`}, updated_by = ${by}
    WHERE order_id = ${orderId} AND status IN ('At Studio', 'Sold', 'Gifted')`)
  if (queries.length) await db().transaction(queries)
}
