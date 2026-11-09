// Customer list, profile, edit and merge.
import { neon } from '@neondatabase/serverless'
import { HttpError, assertId, num, blank, listOrders } from './db.js'

let _sql
const sql = (...args) => (_sql ??= neon(process.env.DATABASE_URL))(...args)

const SORTS = {
  recent: 'max(o.order_date) DESC NULLS LAST, c.name',
  spend: 'total_spend DESC, c.name',
  balance: 'balance DESC, c.name',
  orders: 'order_count DESC, c.name',
  name: 'lower(c.name)',
}

const toCustomer = (r) => ({
  id: r.id, name: r.name, phone: r.phone || '', email: r.email || '', address: r.address || '', city: r.city || '',
  orderCount: r.order_count, totalSpend: num(r.total_spend), balance: num(r.balance),
  firstOrder: r.first_order, lastOrder: r.last_order, references: r.refs || [], createdAt: r.created_at,
})

const CUSTOMER_SELECT = `
  SELECT c.id, c.name, c.phone, c.email, c.address, c.city, c.created_at,
         count(o.id)::int AS order_count,
         min(o.order_date)::text AS first_order, max(o.order_date)::text AS last_order,
         COALESCE(sum(o.amount_pkr) FILTER (WHERE o.status NOT IN ('Cancelled', 'Returned')), 0) AS total_spend,
         COALESCE(sum(o.balance_due_pkr) FILTER (WHERE o.status <> 'Cancelled' AND o.balance_due_pkr > 0), 0) AS balance,
         array_remove(array_agg(DISTINCT o.reference), NULL) AS refs
  FROM customers c LEFT JOIN orders o ON o.customer_id = c.id`

export async function customerList({ q = '', sort = 'recent' } = {}) {
  const term = q.trim()
  const like = `%${term}%`
  const db = (_sql ??= neon(process.env.DATABASE_URL))
  const rows = await db.query(
    `${CUSTOMER_SELECT}
     WHERE $1 = '' OR c.name ILIKE $2 OR c.phone ILIKE $2 OR c.city ILIKE $2 OR c.email ILIKE $2
     GROUP BY c.id ORDER BY ${SORTS[sort] || SORTS.recent} LIMIT 1000`,
    [term, like])
  return rows.map(toCustomer)
}

export async function customerProfile(id) {
  assertId(id, 'Customer')
  const db = (_sql ??= neon(process.env.DATABASE_URL))
  const [row] = await db.query(`${CUSTOMER_SELECT} WHERE c.id = $1 GROUP BY c.id`, [id])
  if (!row) throw new HttpError(404, 'Customer not found')
  const orders = await listOrders({ customerId: id })
  // Latest order that has measurements filled in
  const withMeasurements = orders.find((o) => Object.values(o.measurements || {}).some((v) => String(v || '').trim()))
  // Products this customer buys most
  const counts = {}
  orders.filter((o) => o.status !== 'Cancelled').forEach((o) => o.items.forEach((i) => {
    counts[i.product] ??= { product: i.product, imageUrl: i.imageUrl, quantity: 0, sizes: new Set() }
    counts[i.product].quantity += i.quantity
    if (i.size) counts[i.product].sizes.add(i.size)
  }))
  return {
    ...toCustomer(row),
    orders,
    latestMeasurements: withMeasurements ? { orderNumber: withMeasurements.orderNumber, orderId: withMeasurements.id, ...withMeasurements.measurements } : null,
    favourites: Object.values(counts).sort((a, b) => b.quantity - a.quantity).slice(0, 5).map((f) => ({ ...f, sizes: [...f.sizes] })),
  }
}

export async function updateCustomer(id, body) {
  assertId(id, 'Customer')
  if (body.name !== undefined && !blank(body.name)) throw new HttpError(400, 'Name is required')
  const rows = await sql`
    UPDATE customers SET
      name    = COALESCE(${blank(body.name)}, name),
      phone   = CASE WHEN ${body.phone !== undefined} THEN ${blank(body.phone)} ELSE phone END,
      email   = CASE WHEN ${body.email !== undefined} THEN ${blank(body.email)} ELSE email END,
      address = CASE WHEN ${body.address !== undefined} THEN ${blank(body.address)} ELSE address END,
      city    = CASE WHEN ${body.city !== undefined} THEN ${blank(body.city)} ELSE city END
    WHERE id = ${id} RETURNING id`
  if (!rows.length) throw new HttpError(404, 'Customer not found')
  return customerProfile(id)
}

// Move every order from `sourceId` to `targetId`, keep the target's details (filling any blanks
// from the source), then delete the source record.
export async function mergeCustomers(sourceId, targetId) {
  assertId(sourceId, 'Customer')
  assertId(targetId, 'Customer')
  if (sourceId === targetId) throw new HttpError(400, 'Choose a different customer to merge into')
  const [source] = await sql`SELECT * FROM customers WHERE id = ${sourceId}`
  const [target] = await sql`SELECT * FROM customers WHERE id = ${targetId}`
  if (!source || !target) throw new HttpError(404, 'Customer not found')
  const db = (_sql ??= neon(process.env.DATABASE_URL))
  const [moved] = await db.transaction([
    db`UPDATE orders SET customer_id = ${targetId} WHERE customer_id = ${sourceId} RETURNING id`,
    db`UPDATE customers SET
         phone = COALESCE(phone, ${source.phone}), email = COALESCE(email, ${source.email}),
         address = COALESCE(address, ${source.address}), city = COALESCE(city, ${source.city})
       WHERE id = ${targetId}`,
    db`DELETE FROM customers WHERE id = ${sourceId}`,
  ])
  return { merged: source.name, into: target.name, ordersMoved: moved.length, customer: await customerProfile(targetId) }
}
