// Data layer for the Neon Postgres database (schema: db/schema.sql).
// Used by the Vercel functions in api/ and by the local Express server.
import { neon } from '@neondatabase/serverless'
import { randomUUID } from 'crypto'
import { can } from './auth.js'

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
           count(o.id)::int AS order_count, max(o.order_date)::text AS last_order,
           COALESCE(sum(o.balance_due_pkr) FILTER (WHERE o.status <> 'Cancelled' AND o.balance_due_pkr > 0), 0) AS balance,
           COALESCE(sum(o.amount_pkr) FILTER (WHERE o.status NOT IN ('Cancelled', 'Returned')), 0) AS total_spend
    FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
    WHERE ${search.trim()} = '' OR c.name ILIKE ${like} OR c.phone ILIKE ${like}
    GROUP BY c.id ORDER BY max(o.order_date) DESC NULLS LAST, c.name
    LIMIT 50`
  return rows.map((r) => ({
    id: r.id, name: r.name, phone: r.phone, email: r.email, address: r.address, city: r.city,
    orderCount: r.order_count, lastOrder: r.last_order, balance: num(r.balance), totalSpend: num(r.total_spend),
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
         cu.name AS created_by_name, uu.name AS updated_by_name,
         c.address AS customer_address, c.city AS customer_city,
         COALESCE(json_agg(json_build_object(
           'id', i.id, 'productId', i.product_id, 'product', COALESCE(p.name, i.description),
           'collection', col.name, 'imageUrl', p.image_url, 'size', i.size, 'quantity', i.quantity,
           'unitPrice', i.unit_price_pkr, 'note', i.description
         ) ORDER BY i.id) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
  FROM orders o
  JOIN customers c        ON c.id = o.customer_id
  LEFT JOIN users cu      ON cu.id = o.created_by
  LEFT JOIN users uu      ON uu.id = o.updated_by
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
    createdBy: r.created_by_name || null,
    updatedBy: r.updated_by_name || null,
  }
}

export async function listOrders() {
  const rows = await query(`${ORDER_SELECT} GROUP BY o.id, c.id, cu.name, uu.name ORDER BY o.created_at DESC`)
  return rows.map(rowToOrder)
}

export async function getOrder(id) {
  assertId(id, 'Order')
  const rows = await query(`${ORDER_SELECT} WHERE o.id = $1 GROUP BY o.id, c.id, cu.name, uu.name`, [id])
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

export async function createOrder(body, user = null) {
  const items = (itemsFromBody(body) || []).filter((i) => blank(i.product) || i.productId)
  if (!items.length) throw new HttpError(400, 'Add at least one product')
  const customerId = await resolveCustomer(body)
  const id = randomUUID()
  await transaction([
    db()`
      INSERT INTO orders (id, order_number, shopify_order_number, customer_id, reference, status,
        order_date, delivery_date, amount_pkr, advance_paid_pkr, delivery_address, delivery_city,
        measurements, payment_notes, special_instructions, created_by, updated_by)
      VALUES (${id}, 'SO-' || lpad(nextval('order_number_seq')::text, 6, '0'), ${blank(body.shopifyOrderNumber)},
        ${customerId}, ${blank(body.reference)}, ${body.status || 'New'},
        ${blank(body.orderDate) ?? new Date().toISOString().slice(0, 10)}, ${blank(body.deliveryDate)},
        ${moneyOrZero(body.amount)}, ${moneyOrZero(body.advancePaid)}, ${blank(body.address)}, ${blank(body.city)},
        ${JSON.stringify(body.measurements || {})}, ${blank(body.paymentNotes)}, ${blank(body.specialInstructions)},
        ${user?.id ?? null}, ${user?.id ?? null})`,
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

export async function updateOrder(id, body, user = null) {
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
  if (sets.length || items) {
    params.push(user?.id ?? null)
    sets.push(`updated_by = $${params.length}`)
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

// Timeline for one order, from the audit trail (who did what, when)
export async function orderHistory(id) {
  assertId(id, 'Order')
  const [order] = await sql`
    SELECT o.created_at, o.order_number, u.name AS created_by FROM orders o LEFT JOIN users u ON u.id = o.created_by WHERE o.id = ${id}`
  if (!order) throw new HttpError(404, 'Order not found')
  const rows = await sql`
    SELECT a.action, a.changes, a.at, u.name AS user_name
    FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
    WHERE a.entity = 'order' AND a.entity_id = ${id}
    ORDER BY a.at`
  const events = rows.filter((r) => r.action !== 'order.create').map((r) => ({
    action: r.action, at: r.at, user: r.user_name || null, changes: r.changes || {},
  }))
  return [{ action: 'order.create', at: order.created_at, user: order.created_by || null, changes: { orderNumber: order.order_number } }, ...events]
}

// Public status board (no login): no phone, address, email or money
export async function listBoard() {
  const orders = await listOrders()
  return orders.map((o) => ({
    id: o.id, orderNumber: o.orderNumber, customer: o.customer, product: o.product, size: o.size,
    status: o.status, orderDate: o.orderDate, deliveryDate: o.deliveryDate,
  }))
}

export async function deleteOrder(id) {
  assertId(id, 'Order')
  const rows = await sql`DELETE FROM orders WHERE id = ${id} RETURNING id`
  if (!rows.length) throw new HttpError(404, 'Order not found')
}

// ── Search (Ctrl+K) ─────────────────────────────────────────────────────
export async function search(q, user) {
  const term = (q || '').trim()
  if (term.length < 2) return { orders: [], customers: [], products: [] }
  const like = `%${term}%`
  const [orders, customers, products] = await Promise.all([
    can(user, 'orders:read') ? sql`
      SELECT o.id, o.order_number, o.status, c.name AS customer
      FROM orders o JOIN customers c ON c.id = o.customer_id
      WHERE o.order_number ILIKE ${like} OR c.name ILIKE ${like} OR c.phone ILIKE ${like} OR o.shopify_order_number ILIKE ${like}
         OR EXISTS (SELECT 1 FROM order_items i LEFT JOIN products p ON p.id = i.product_id
                    WHERE i.order_id = o.id AND (p.name ILIKE ${like} OR i.description ILIKE ${like}))
      ORDER BY o.created_at DESC LIMIT 8` : [],
    can(user, 'customers:read') ? sql`
      SELECT id, name, phone FROM customers WHERE name ILIKE ${like} OR phone ILIKE ${like} ORDER BY name LIMIT 6` : [],
    can(user, 'products:read') ? sql`
      SELECT p.id, p.name, p.image_url, c.name AS collection FROM products p LEFT JOIN collections c ON c.id = p.collection_id
      WHERE p.name ILIKE ${like} OR c.name ILIKE ${like} ORDER BY p.name LIMIT 6` : [],
  ])
  return {
    orders: orders.map((o) => ({ id: o.id, orderNumber: o.order_number, status: o.status, customer: o.customer })),
    customers: customers.map((c) => ({ id: c.id, name: c.name, phone: c.phone })),
    products: products.map((p) => ({ id: p.id, name: p.name, imageUrl: p.image_url, collection: p.collection })),
  }
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
    resellerCode: r.reseller_code || '',
    price: num(r.price),                       // gross price set before handover
    designerDiscount: num(r.designer_discount), // discount Koko offers
    resellerDiscount: num(r.reseller_discount), // discount the reseller offers
    netPrice: num(r.net_price),                 // price − both discounts
    status: r.status,
    commissionPct: num(r.commission_pct),
    commissionAmount: num(r.commission_amount), // net price × commission %
    alterationCharge: num(r.alteration_charge), // alteration/laundry, deducted after commission
    netToKoko: num(r.net_to_koko),              // net payable to Koko
    resellerInvoiceNo: r.reseller_invoice_no || '',
    soldOn: r.sold_on, paidOn: r.paid_on, returnedOn: r.returned_on,
    notes: r.notes || '',
    updatedAt: r.updated_at,
  }
}

const PIECE_SELECT = `
  SELECT d.id, d.consignment_id, d.handover_date::text AS handover_date, d.reseller_id, d.reseller_name,
         d.currency, d.product_id, d.product_name, d.reseller_code, p.image_url, d.size, d.price, d.status,
         d.designer_discount, d.reseller_discount, d.net_price, d.alteration_charge, d.reseller_invoice_no,
         d.commission_pct, d.commission_amount, d.net_to_koko,
         d.sold_on::text AS sold_on, d.paid_on::text AS paid_on, d.returned_on::text AS returned_on,
         d.notes, d.updated_at
  FROM consignment_items_detail d JOIN products p ON p.id = d.product_id`

// Reseller logins see only their own reseller's stock; roles without 'fc:money' get no prices or payouts.
const MONEY_FIELDS = ['price', 'designerDiscount', 'resellerDiscount', 'netPrice', 'commissionPct',
  'commissionAmount', 'alterationCharge', 'netToKoko']

// Resellers for the menu: reseller logins get only their own; commission only with 'fc:money'
export async function listResellers(user) {
  const only = user?.role === 'reseller' ? user.resellerId : null
  const rows = await sql`
    SELECT r.id, r.name, r.city, r.country, r.currency, r.commission_pct, r.address,
           count(i.id) FILTER (WHERE i.status = 'At Store')::int AS at_store
    FROM resellers r
    LEFT JOIN consignments c ON c.reseller_id = r.id
    LEFT JOIN consignment_items i ON i.consignment_id = c.id
    WHERE ${only}::int IS NULL OR r.id = ${only}
    GROUP BY r.id ORDER BY r.name`
  const showMoney = can(user, 'fc:money')
  return rows.map((r) => ({
    id: r.id, name: r.name, city: r.city, country: r.country, address: r.address, currency: r.currency,
    commissionPct: showMoney ? num(r.commission_pct) : null, atStore: r.at_store,
  }))
}

// resellerId narrows to one reseller; reseller logins are always limited to their own
export async function getConsignments(user, { resellerId } = {}) {
  const requested = resellerId ? Number(resellerId) : null
  if (user?.role === 'reseller' && requested && requested !== user.resellerId) throw new HttpError(403, "You don't have access to this")
  const only = user?.role === 'reseller' ? user.resellerId : requested
  const [resellers, consignments, pieces] = await Promise.all([
    sql`SELECT id, name, address, city, country, currency, commission_pct FROM resellers
        WHERE ${only}::int IS NULL OR id = ${only} ORDER BY name`,
    sql`SELECT c.id, c.reseller_id, c.handover_date::text AS handover_date, c.commission_pct, c.notes,
               count(i.id)::int AS pieces
        FROM consignments c LEFT JOIN consignment_items i ON i.consignment_id = c.id
        WHERE ${only}::int IS NULL OR c.reseller_id = ${only}
        GROUP BY c.id ORDER BY c.handover_date DESC`,
    query(`${PIECE_SELECT} WHERE $1::int IS NULL OR d.reseller_id = $1 ORDER BY d.product_name, d.size`, [only]),
  ])
  const showMoney = can(user, 'fc:money')
  const strip = (p) => {
    if (!showMoney) MONEY_FIELDS.forEach((k) => { p[k] = null })
    if (user?.role === 'reseller') p.notes = ''      // internal notes stay internal
    return p
  }
  return {
    resellers: resellers.map((r) => ({
      id: r.id, name: r.name, address: r.address, city: r.city, country: r.country,
      currency: r.currency, commissionPct: showMoney ? num(r.commission_pct) : null,
    })),
    consignments: consignments.map((c) => ({
      id: c.id, resellerId: c.reseller_id, handoverDate: c.handover_date,
      commissionPct: showMoney ? num(c.commission_pct) : null, notes: user?.role === 'reseller' ? '' : c.notes || '', pieces: c.pieces,
    })),
    items: pieces.map((r) => strip(rowToPiece(r))),
  }
}

async function getPiece(id) {
  const rows = await query(`${PIECE_SELECT} WHERE d.id = $1`, [id])
  if (!rows.length) throw new HttpError(404, 'Consignment piece not found')
  return rowToPiece(rows[0])
}

// Status changes stamp the matching date; moving back clears dates that no longer apply.
// Discounts can't exceed the price (enforced by the database).
export async function updateConsignmentItem(id, body, user = null) {
  assertId(id, 'Consignment piece')
  if (body.status !== undefined && !CONSIGNMENT_STATUSES.includes(body.status))
    throw new HttpError(400, `Status must be one of: ${CONSIGNMENT_STATUSES.join(', ')}`)
  const price = body.price === undefined ? undefined : (body.price === '' || body.price == null ? null : Number(body.price))
  const amount = (key) => (body[key] === undefined ? null : Number(body[key]) || 0)   // null = leave unchanged
  const s = body.status ?? null

  const [piece] = await sql`
    SELECT ci.product_id, c.reseller_id FROM consignment_items ci JOIN consignments c ON c.id = ci.consignment_id
    WHERE ci.id = ${id}`
  if (!piece) throw new HttpError(404, 'Consignment piece not found')
  const code = body.resellerCode === undefined ? undefined : blank(body.resellerCode)
  if (code) {
    const [taken] = await sql`
      SELECT p.name FROM reseller_products rp JOIN products p ON p.id = rp.product_id
      WHERE rp.reseller_id = ${piece.reseller_id} AND rp.reseller_code = ${code} AND rp.product_id <> ${piece.product_id}`
    if (taken) throw new HttpError(400, `Code ${code} is already used for ${taken.name}`)
  }

  // In SET expressions `status` is the value before this update
  const rows = await sql`
    UPDATE consignment_items SET
      price       = CASE WHEN ${price !== undefined} THEN ${price ?? null}::numeric ELSE price END,
      notes       = CASE WHEN ${body.notes !== undefined} THEN ${blank(body.notes)} ELSE notes END,
      designer_discount   = COALESCE(${amount('designerDiscount')}::numeric, designer_discount),
      reseller_discount   = COALESCE(${amount('resellerDiscount')}::numeric, reseller_discount),
      alteration_charge   = COALESCE(${amount('alterationCharge')}::numeric, alteration_charge),
      reseller_invoice_no = CASE WHEN ${body.resellerInvoiceNo !== undefined} THEN ${blank(body.resellerInvoiceNo)} ELSE reseller_invoice_no END,
      status      = COALESCE(${s}, status),
      updated_by  = ${user?.id ?? null},
      sold_on     = CASE WHEN ${s}::text IS NULL OR ${s} = status THEN sold_on
                         WHEN ${s} IN ('Sold', 'Paid') THEN COALESCE(sold_on, CURRENT_DATE) ELSE NULL END,
      paid_on     = CASE WHEN ${s}::text IS NULL OR ${s} = status THEN paid_on
                         WHEN ${s} = 'Paid' THEN CURRENT_DATE ELSE NULL END,
      returned_on = CASE WHEN ${s}::text IS NULL OR ${s} = status THEN returned_on
                         WHEN ${s} = 'Returned' THEN CURRENT_DATE ELSE NULL END
    WHERE id = ${id} RETURNING id`
  if (!rows.length) throw new HttpError(404, 'Consignment piece not found')

  // Dates typed in from a statement override the automatic stamps (only where the status allows them)
  if (body.soldOn !== undefined) await sql`
    UPDATE consignment_items SET sold_on = ${blank(body.soldOn)}::date WHERE id = ${id} AND status IN ('Sold', 'Paid')`
  if (body.paidOn !== undefined) await sql`
    UPDATE consignment_items SET paid_on = ${blank(body.paidOn)}::date WHERE id = ${id} AND status = 'Paid'`

  // The reseller's code belongs to the product (same code for every piece of it)
  if (code !== undefined) {
    if (code) await sql`
      INSERT INTO reseller_products (reseller_id, product_id, reseller_code) VALUES (${piece.reseller_id}, ${piece.product_id}, ${code})
      ON CONFLICT (reseller_id, product_id) DO UPDATE SET reseller_code = EXCLUDED.reseller_code`
    else await sql`DELETE FROM reseller_products WHERE reseller_id = ${piece.reseller_id} AND product_id = ${piece.product_id}`
  }
  return getPiece(id)
}

// New handover: { resellerId, handoverDate, notes, items: [{ productId | product, size, price, quantity }] }
// Each unit becomes its own piece. The reseller's current commission is locked in for this handover.
export async function createConsignment(body, user = null) {
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
    INSERT INTO consignments (reseller_id, handover_date, commission_pct, notes, created_by)
    VALUES (${reseller.id}, ${blank(body.handoverDate) ?? new Date().toISOString().slice(0, 10)},
            ${reseller.commission_pct}, ${blank(body.notes)}, ${user?.id ?? null})
    RETURNING id`
  await sql`
    INSERT INTO consignment_items (consignment_id, product_id, size, price)
    SELECT ${id}, * FROM unnest(${pieces.map((p) => p.productId)}::int[], ${pieces.map((p) => p.size)}::text[],
                                ${pieces.map((p) => p.price)}::numeric[])`
  return { id, pieces: pieces.length }
}
