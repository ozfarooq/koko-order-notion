// Data layer for the Neon Postgres database (schema: db/schema.sql).
// Used by the Vercel functions in api/ and by the local Express server.
import { neon } from '@neondatabase/serverless'
import { randomUUID } from 'crypto'

let _sql
const sql = (...args) => (_sql ??= neon(process.env.DATABASE_URL))(...args)
const query = (text, params) => (_sql ??= neon(process.env.DATABASE_URL)).query(text, params)
const transaction = (queries) => (_sql ??= neon(process.env.DATABASE_URL)).transaction(queries)
const db = () => (_sql ??= neon(process.env.DATABASE_URL))

const num = (v) => (v == null ? null : Number(v))
const norm = (s) => (s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '')
const digits = (s) => (s || '').replace(/\D/g, '').slice(-10)
const blank = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim())

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const assertId = (id, what) => { if (!UUID.test(id || '')) throw new HttpError(404, `${what} not found`) }

// ── Catalog ────────────────────────────────────────────────────────────
export async function listProducts() {
  const rows = await sql`
    SELECT p.id, p.name, p.shopify_handle, p.price_pkr, p.image_url, p.is_active, c.name AS collection
    FROM products p LEFT JOIN collections c ON c.id = p.collection_id
    ORDER BY p.name`
  return rows.map((r) => ({
    id: r.id, name: r.name, handle: r.shopify_handle, pricePkr: num(r.price_pkr),
    imageUrl: r.image_url, isActive: r.is_active, collection: r.collection,
  }))
}

// Resolve product names (as typed in the order form) to catalog ids
async function resolveProducts(names) {
  const products = await sql`SELECT id, name FROM products`
  const byKey = new Map(products.map((p) => [norm(p.name), p]))
  return names.map((n) => byKey.get(norm(n)) || null)
}

// ── Customers ──────────────────────────────────────────────────────────
export async function listCustomers(search = '') {
  const like = `%${search.trim()}%`
  const rows = await sql`
    SELECT c.id, c.name, c.phone, c.email, c.address, c.city,
           count(o.id)::int AS order_count, max(o.order_date)::text AS last_order
    FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
    WHERE ${search.trim()} = '' OR c.name ILIKE ${like} OR c.phone ILIKE ${like}
    GROUP BY c.id ORDER BY max(o.order_date) DESC NULLS LAST, c.name
    LIMIT 50`
  return rows.map((r) => ({
    id: r.id, name: r.name, phone: r.phone, email: r.email, address: r.address, city: r.city,
    orderCount: r.order_count, lastOrder: r.last_order,
  }))
}

// Same phone → same customer; otherwise same name with no conflicting phone. Creates one if none.
// Contact details given here become the customer's latest details.
async function resolveCustomer({ customerId, customer, phone, email, address, city }) {
  const name = blank(customer)
  let id = customerId || null
  if (!id) {
    if (!name) throw new HttpError(400, 'Customer name is required')
    const ph = digits(phone)
    const candidates = await sql`
      SELECT id, name, phone FROM customers
      WHERE lower(name) = lower(${name}) OR (${ph} <> '' AND right(regexp_replace(coalesce(phone,''), '\\D', '', 'g'), 10) = ${ph})`
    const match = candidates.find((c) => ph && digits(c.phone) === ph) ||
      candidates.find((c) => norm(c.name) === norm(name) && (!ph || !digits(c.phone) || digits(c.phone) === ph))
    id = match?.id
  }
  if (id) {
    await sql`
      UPDATE customers SET
        name    = COALESCE(${name}, name),
        phone   = COALESCE(${blank(phone)}, phone),
        email   = COALESCE(${blank(email)}, email),
        address = COALESCE(${blank(address)}, address),
        city    = COALESCE(${blank(city)}, city)
      WHERE id = ${id}`
    return id
  }
  const [row] = await sql`
    INSERT INTO customers (name, phone, email, address, city)
    VALUES (${name}, ${blank(phone)}, ${blank(email)}, ${blank(address)}, ${blank(city)})
    RETURNING id`
  return row.id
}

// ── Retail orders ──────────────────────────────────────────────────────
const ORDER_SELECT = `
  SELECT o.id, o.order_number, o.shopify_order_number, o.reference, o.status,
         o.order_date::text AS order_date, o.delivery_date::text AS delivery_date,
         o.amount_pkr, o.advance_paid_pkr, o.balance_due_pkr, o.delivery_address, o.delivery_city,
         o.measurements, o.payment_notes, o.special_instructions, o.created_at, o.updated_at,
         c.id AS customer_id, c.name AS customer_name, c.phone, c.email,
         c.address AS customer_address, c.city AS customer_city,
         COALESCE(json_agg(json_build_object(
           'id', i.id, 'productId', i.product_id, 'product', COALESCE(p.name, i.description),
           'collection', col.name, 'imageUrl', p.image_url, 'size', i.size, 'quantity', i.quantity,
           'unitPrice', i.unit_price_pkr, 'note', i.description
         ) ORDER BY i.id) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
  FROM orders o
  JOIN customers c        ON c.id = o.customer_id
  LEFT JOIN order_items i ON i.order_id = o.id
  LEFT JOIN products p    ON p.id = i.product_id
  LEFT JOIN collections col ON col.id = p.collection_id`

// Shape kept compatible with the previous Notion API: flat customer fields plus a
// "Name (Size) × qty" product summary, alongside the structured items list.
function rowToOrder(r) {
  const items = r.items.map((i) => ({ ...i, unitPrice: num(i.unitPrice) }))
  return {
    id: r.id,
    orderNumber: r.order_number,
    shopifyOrderNumber: r.shopify_order_number,
    reference: r.reference,
    status: r.status,
    customerId: r.customer_id,
    customer: r.customer_name,
    phone: r.phone || '',
    email: r.email || '',
    address: r.delivery_address ?? r.customer_address ?? '',
    city: r.delivery_city ?? r.customer_city ?? '',
    items,
    product: items.map((i) => `${i.product} (${i.size || '—'}) × ${i.quantity}`).join('\n'),
    size: items.length === 1 ? items[0].size || '' : '',
    quantity: items.reduce((s, i) => s + i.quantity, 0),
    amount: num(r.amount_pkr),
    advancePaid: num(r.advance_paid_pkr),
    balanceDue: num(r.balance_due_pkr),
    orderDate: r.order_date,
    deliveryDate: r.delivery_date,
    measurements: r.measurements || {},
    paymentNotes: r.payment_notes || '',
    specialInstructions: r.special_instructions || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export async function listOrders() {
  const rows = await query(`${ORDER_SELECT} GROUP BY o.id, c.id ORDER BY o.created_at DESC`)
  return rows.map(rowToOrder)
}

export async function getOrder(id) {
  assertId(id, 'Order')
  const rows = await query(`${ORDER_SELECT} WHERE o.id = $1 GROUP BY o.id, c.id`, [id])
  if (!rows.length) throw new HttpError(404, 'Order not found')
  return rowToOrder(rows[0])
}

// Items come either structured ({ product | productId, size, quantity, unitPrice }) or, from the
// current order form, as "Name (Size) × qty" lines in `product`.
function itemsFromBody(body) {
  if (Array.isArray(body.items)) return body.items
  if (typeof body.product !== 'string') return null
  return body.product.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const m = line.match(/^(.+?)\s*\(([^)]*)\)\s*[×x]\s*(\d+)$/)
    return m ? { product: m[1].trim(), size: m[2].trim(), quantity: Number(m[3]) }
             : { product: line, size: body.size || null, quantity: Number(body.quantity) || 1 }
  })
}

// Returns the (not yet executed) insert query wrapped in an array, so callers can add it to a
// transaction — returning the query itself from an async function would run it on await.
async function itemInsert(orderId, items) {
  const ids = items.some((i) => i.productId == null)
    ? await resolveProducts(items.map((i) => i.product || ''))
    : items.map(() => null)
  const cols = items.map((it, k) => {
    const productId = it.productId ?? ids[k]?.id ?? null
    return {
      productId,
      note: productId ? (blank(it.note) ?? null) : blank(it.product),   // unknown product: keep the typed text
      size: blank(it.size === '—' ? '' : it.size),
      quantity: Math.max(1, Number(it.quantity) || 1),
      unitPrice: it.unitPrice === '' || it.unitPrice == null ? null : Number(it.unitPrice),
    }
  })
  return [db()`
    INSERT INTO order_items (order_id, product_id, description, size, quantity, unit_price_pkr)
    SELECT ${orderId}, * FROM unnest(
      ${cols.map((c) => c.productId)}::int[], ${cols.map((c) => c.note)}::text[],
      ${cols.map((c) => c.size)}::text[], ${cols.map((c) => c.quantity)}::int[],
      ${cols.map((c) => c.unitPrice)}::numeric[])`]
}

const moneyOrZero = (v) => (v === '' || v == null ? 0 : Number(v))

export async function createOrder(body) {
  const items = (itemsFromBody(body) || []).filter((i) => blank(i.product) || i.productId)
  if (!items.length) throw new HttpError(400, 'Add at least one product')
  const customerId = await resolveCustomer(body)
  const id = randomUUID()
  await transaction([
    db()`
      INSERT INTO orders (id, order_number, shopify_order_number, customer_id, reference, status,
        order_date, delivery_date, amount_pkr, advance_paid_pkr, delivery_address, delivery_city,
        measurements, payment_notes, special_instructions)
      VALUES (${id}, 'SO-' || lpad(nextval('order_number_seq')::text, 6, '0'), ${blank(body.shopifyOrderNumber)},
        ${customerId}, ${blank(body.reference)}, ${body.status || 'New'},
        ${blank(body.orderDate) ?? new Date().toISOString().slice(0, 10)}, ${blank(body.deliveryDate)},
        ${moneyOrZero(body.amount)}, ${moneyOrZero(body.advancePaid)}, ${blank(body.address)}, ${blank(body.city)},
        ${JSON.stringify(body.measurements || {})}, ${blank(body.paymentNotes)}, ${blank(body.specialInstructions)})`,
    ...(await itemInsert(id, items)),
  ])
  return getOrder(id)
}

// Partial update: only fields present in the body change.
const ORDER_FIELDS = {
  status: 'status', orderDate: 'order_date', deliveryDate: 'delivery_date',
  amount: 'amount_pkr', advancePaid: 'advance_paid_pkr', address: 'delivery_address', city: 'delivery_city',
  measurements: 'measurements', paymentNotes: 'payment_notes', specialInstructions: 'special_instructions',
  reference: 'reference', shopifyOrderNumber: 'shopify_order_number',
}

export async function updateOrder(id, body) {
  assertId(id, 'Order')
  const [existing] = await sql`SELECT customer_id FROM orders WHERE id = ${id}`
  if (!existing) throw new HttpError(404, 'Order not found')

  const sets = []
  const params = []
  for (const [key, col] of Object.entries(ORDER_FIELDS)) {
    if (body[key] === undefined) continue
    let v = body[key]
    if (col === 'amount_pkr' || col === 'advance_paid_pkr') v = moneyOrZero(v)
    else if (col === 'measurements') v = JSON.stringify(v || {})
    else v = blank(v)
    params.push(v)
    sets.push(`${col} = $${params.length}`)
  }

  const contactKeys = ['customer', 'phone', 'email', 'address', 'city']
  if (contactKeys.some((k) => body[k] !== undefined)) {
    const customerId = await resolveCustomer({
      // Renaming keeps the same customer unless the details clearly point to someone else
      customerId: body.customerId || (body.customer === undefined ? existing.customer_id : null),
      customer: body.customer, phone: body.phone, email: body.email, address: body.address, city: body.city,
    })
    params.push(customerId)
    sets.push(`customer_id = $${params.length}`)
  }

  const items = itemsFromBody(body)
  const queries = []
  if (sets.length) {
    params.push(id)
    queries.push(db().query(`UPDATE orders SET ${sets.join(', ')} WHERE id = $${params.length}`, params))
  }
  if (items) {
    const kept = items.filter((i) => blank(i.product) || i.productId)
    if (!kept.length) throw new HttpError(400, 'Add at least one product')
    queries.push(db()`DELETE FROM order_items WHERE order_id = ${id}`)
    queries.push(...(await itemInsert(id, kept)))
  }
  if (queries.length) await transaction(queries)
  return getOrder(id)
}

export async function deleteOrder(id) {
  assertId(id, 'Order')
  const rows = await sql`DELETE FROM orders WHERE id = ${id} RETURNING id`
  if (!rows.length) throw new HttpError(404, 'Order not found')
}

// ── B2B consignment (Fashion Collage etc.) ─────────────────────────────
const CONSIGNMENT_STATUSES = ['At Store', 'Sold', 'Paid', 'Returned']

function rowToPiece(r) {
  return {
    id: r.id,
    consignmentId: r.consignment_id,
    handoverDate: r.handover_date,
    resellerId: r.reseller_id,
    reseller: r.reseller_name,
    currency: r.currency,
    productId: r.product_id,
    product: r.product_name,
    imageUrl: r.image_url,
    size: r.size || '',
    price: num(r.price),
    status: r.status,
    commissionPct: num(r.commission_pct),
    commissionAmount: num(r.commission_amount),
    netToKoko: num(r.net_to_koko),
    soldOn: r.sold_on, paidOn: r.paid_on, returnedOn: r.returned_on,
    notes: r.notes || '',
    updatedAt: r.updated_at,
  }
}

const PIECE_SELECT = `
  SELECT d.id, d.consignment_id, d.handover_date::text AS handover_date, d.reseller_id, d.reseller_name,
         d.currency, d.product_id, d.product_name, p.image_url, d.size, d.price, d.status,
         d.commission_pct, d.commission_amount, d.net_to_koko,
         d.sold_on::text AS sold_on, d.paid_on::text AS paid_on, d.returned_on::text AS returned_on,
         d.notes, d.updated_at
  FROM consignment_items_detail d JOIN products p ON p.id = d.product_id`

export async function getConsignments() {
  const [resellers, consignments, pieces] = await Promise.all([
    sql`SELECT id, name, address, city, country, currency, commission_pct FROM resellers ORDER BY name`,
    sql`SELECT c.id, c.reseller_id, c.handover_date::text AS handover_date, c.commission_pct, c.notes,
               count(i.id)::int AS pieces
        FROM consignments c LEFT JOIN consignment_items i ON i.consignment_id = c.id
        GROUP BY c.id ORDER BY c.handover_date DESC`,
    query(`${PIECE_SELECT} ORDER BY d.product_name, d.size`),
  ])
  return {
    resellers: resellers.map((r) => ({
      id: r.id, name: r.name, address: r.address, city: r.city, country: r.country,
      currency: r.currency, commissionPct: num(r.commission_pct),
    })),
    consignments: consignments.map((c) => ({
      id: c.id, resellerId: c.reseller_id, handoverDate: c.handover_date,
      commissionPct: num(c.commission_pct), notes: c.notes || '', pieces: c.pieces,
    })),
    items: pieces.map(rowToPiece),
  }
}

async function getPiece(id) {
  const rows = await query(`${PIECE_SELECT} WHERE d.id = $1`, [id])
  if (!rows.length) throw new HttpError(404, 'Consignment piece not found')
  return rowToPiece(rows[0])
}

// Status changes stamp the matching date; moving back clears dates that no longer apply.
export async function updateConsignmentItem(id, body) {
  assertId(id, 'Consignment piece')
  if (body.status !== undefined && !CONSIGNMENT_STATUSES.includes(body.status))
    throw new HttpError(400, `Status must be one of: ${CONSIGNMENT_STATUSES.join(', ')}`)
  const price = body.price === undefined ? undefined : (body.price === '' || body.price == null ? null : Number(body.price))
  const s = body.status ?? null
  // In SET expressions `status` is the value before this update
  const rows = await sql`
    UPDATE consignment_items SET
      price       = CASE WHEN ${price !== undefined} THEN ${price ?? null}::numeric ELSE price END,
      notes       = CASE WHEN ${body.notes !== undefined} THEN ${blank(body.notes)} ELSE notes END,
      status      = COALESCE(${s}, status),
      sold_on     = CASE WHEN ${s}::text IS NULL OR ${s} = status THEN sold_on
                         WHEN ${s} IN ('Sold', 'Paid') THEN COALESCE(sold_on, CURRENT_DATE) ELSE NULL END,
      paid_on     = CASE WHEN ${s}::text IS NULL OR ${s} = status THEN paid_on
                         WHEN ${s} = 'Paid' THEN CURRENT_DATE ELSE NULL END,
      returned_on = CASE WHEN ${s}::text IS NULL OR ${s} = status THEN returned_on
                         WHEN ${s} = 'Returned' THEN CURRENT_DATE ELSE NULL END
    WHERE id = ${id} RETURNING id`
  if (!rows.length) throw new HttpError(404, 'Consignment piece not found')
  return getPiece(id)
}

// New handover: { resellerId, handoverDate, notes, items: [{ productId | product, size, price, quantity }] }
// Each unit becomes its own piece. The reseller's current commission is locked in for this handover.
export async function createConsignment(body) {
  const lines = (body.items || []).filter((i) => i.productId || blank(i.product))
  if (!lines.length) throw new HttpError(400, 'Add at least one piece')
  const [reseller] = await sql`SELECT id, commission_pct FROM resellers WHERE id = ${body.resellerId}`
  if (!reseller) throw new HttpError(400, 'Unknown reseller')
  const resolved = await resolveProducts(lines.map((l) => l.product || ''))
  const pieces = []
  lines.forEach((l, k) => {
    const productId = l.productId ?? resolved[k]?.id
    if (!productId) throw new HttpError(400, `Unknown product: ${l.product}`)
    for (let n = 0; n < Math.max(1, Number(l.quantity) || 1); n++)
      pieces.push({ productId, size: blank(l.size), price: l.price === '' || l.price == null ? null : Number(l.price) })
  })
  const [{ id }] = await sql`
    INSERT INTO consignments (reseller_id, handover_date, commission_pct, notes)
    VALUES (${reseller.id}, ${blank(body.handoverDate) ?? new Date().toISOString().slice(0, 10)},
            ${reseller.commission_pct}, ${blank(body.notes)})
    RETURNING id`
  await sql`
    INSERT INTO consignment_items (consignment_id, product_id, size, price)
    SELECT ${id}, * FROM unnest(${pieces.map((p) => p.productId)}::int[], ${pieces.map((p) => p.size)}::text[],
                                ${pieces.map((p) => p.price)}::numeric[])`
  return { id, pieces: pieces.length }
}
