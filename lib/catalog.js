// Catalogue: collections, product detail (retail sales + reseller stock), edits and Shopify re-import.
import { neon } from '@neondatabase/serverless'
import { HttpError, num, norm, blank } from './db.js'
import { can } from './auth.js'

let _sql
const db = () => (_sql ??= neon(process.env.DATABASE_URL))
const sql = (...args) => db()(...args)

export async function listCollections() {
  const rows = await sql`
    SELECT c.id, c.name, count(p.id)::int AS products,
           count(p.id) FILTER (WHERE p.is_active)::int AS active,
           (array_agg(p.image_url ORDER BY p.name) FILTER (WHERE p.image_url IS NOT NULL))[1] AS cover,
           min(p.price_pkr) AS min_price, max(p.price_pkr) AS max_price
    FROM collections c LEFT JOIN products p ON p.collection_id = c.id
    GROUP BY c.id ORDER BY c.name`
  const [separates] = await sql`
    SELECT count(*)::int AS products, (array_agg(image_url ORDER BY name) FILTER (WHERE image_url IS NOT NULL))[1] AS cover,
           min(price_pkr) AS min_price, max(price_pkr) AS max_price
    FROM products WHERE collection_id IS NULL`
  const list = rows.map((r) => ({ id: r.id, name: r.name, products: r.products, active: r.active, cover: r.cover, minPrice: num(r.min_price), maxPrice: num(r.max_price) }))
  if (separates.products) list.push({ id: 'none', name: 'Separates', products: separates.products, active: separates.products, cover: separates.cover, minPrice: num(separates.min_price), maxPrice: num(separates.max_price) })
  return list
}

export async function createCollection(name) {
  const n = blank(name)
  if (!n) throw new HttpError(400, 'Collection name is required')
  const [r] = await sql`INSERT INTO collections (name) VALUES (${n}) RETURNING id, name`
  return r
}

export async function productDetail(id, user) {
  const pid = Number(id)
  if (!Number.isInteger(pid)) throw new HttpError(404, 'Product not found')
  const [p] = await sql`
    SELECT p.*, c.name AS collection FROM products p LEFT JOIN collections c ON c.id = p.collection_id WHERE p.id = ${pid}`
  if (!p) throw new HttpError(404, 'Product not found')

  const [bySize, recent, stock] = await Promise.all([
    can(user, 'orders:read') ? sql`
      SELECT COALESCE(i.size, '—') AS size, sum(i.quantity)::int AS qty
      FROM order_items i JOIN orders o ON o.id = i.order_id
      WHERE i.product_id = ${pid} AND o.status NOT IN ('Cancelled', 'Returned')
      GROUP BY 1 ORDER BY 2 DESC` : [],
    can(user, 'orders:read') ? sql`
      SELECT o.id, o.order_number, o.status, o.order_date::text AS order_date, c.name AS customer, i.size, i.quantity, i.unit_price_pkr
      FROM order_items i JOIN orders o ON o.id = i.order_id JOIN customers c ON c.id = o.customer_id
      WHERE i.product_id = ${pid} ORDER BY o.order_date DESC NULLS LAST LIMIT 10` : [],
    can(user, 'fc:read') ? sql`
      SELECT r.id AS reseller_id, r.name AS reseller, r.currency, ci.status, ci.size, count(*)::int AS pieces, avg(ci.price) AS price
      FROM consignment_items ci JOIN consignments c ON c.id = ci.consignment_id JOIN resellers r ON r.id = c.reseller_id
      WHERE ci.product_id = ${pid}
      GROUP BY r.id, ci.status, ci.size ORDER BY r.name` : [],
  ])

  const resellers = {}
  for (const s of stock) {
    resellers[s.reseller_id] ??= { id: s.reseller_id, name: s.reseller, currency: s.currency, price: null, byStatus: {}, atStoreSizes: [] }
    const r = resellers[s.reseller_id]
    r.byStatus[s.status] = (r.byStatus[s.status] || 0) + s.pieces
    if (s.status === 'At Store') r.atStoreSizes.push(...Array(s.pieces).fill(s.size || '—'))
    if (can(user, 'fc:money') && s.price != null) r.price = Math.round(num(s.price))
  }

  return {
    id: p.id, name: p.name, handle: p.shopify_handle, collectionId: p.collection_id, collection: p.collection,
    pricePkr: num(p.price_pkr), compareAtPkr: num(p.compare_at_pkr), imageUrl: p.image_url, isActive: p.is_active,
    shopifyUrl: p.shopify_handle ? `https://kokoatelier.com/products/${p.shopify_handle}` : null,
    sales: {
      bySize: bySize.map((r) => ({ size: r.size, quantity: r.qty })),
      totalQuantity: bySize.reduce((s, r) => s + r.qty, 0),
      recent: recent.map((r) => ({ orderId: r.id, orderNumber: r.order_number, status: r.status, orderDate: r.order_date, customer: r.customer, size: r.size, quantity: r.quantity, unitPrice: num(r.unit_price_pkr) })),
    },
    resellers: Object.values(resellers),
  }
}

export async function updateProduct(id, body, user) {
  const pid = Number(id)
  if (!Number.isInteger(pid)) throw new HttpError(404, 'Product not found')
  const collectionId = body.collectionId === undefined ? undefined : (body.collectionId === null || body.collectionId === 'none' || body.collectionId === '' ? null : Number(body.collectionId))
  const rows = await sql`
    UPDATE products SET
      collection_id = CASE WHEN ${collectionId !== undefined} THEN ${collectionId ?? null}::int ELSE collection_id END,
      is_active     = COALESCE(${body.isActive ?? null}::boolean, is_active),
      price_pkr     = CASE WHEN ${body.pricePkr !== undefined} THEN ${body.pricePkr === '' || body.pricePkr == null ? null : Number(body.pricePkr)}::numeric ELSE price_pkr END
    WHERE id = ${pid} RETURNING id`
  if (!rows.length) throw new HttpError(404, 'Product not found')
  return productDetail(pid, user)
}

// Shopify re-import. `products` are already grouped per handle by the browser:
// [{ handle, title, pricePkr, compareAtPkr, imageUrl, status, tags }]
// Existing products (matched by handle) get name/price/image/active updated; new ones are added,
// placed in a collection when one of their tags matches a collection name.
export async function importShopify(products = []) {
  if (!Array.isArray(products) || !products.length) throw new HttpError(400, 'No products found in the file')
  const [existing, collections] = await Promise.all([
    sql`SELECT id, name, shopify_handle FROM products`,
    sql`SELECT id, name FROM collections`,
  ])
  const byHandle = new Map(existing.map((p) => [p.shopify_handle, p]))
  const byName = new Map(existing.map((p) => [p.name.toLowerCase(), p]))
  const collectionFor = (tags) => {
    const keys = String(tags || '').split(',').map((t) => norm(t)).filter(Boolean)
    return collections.find((c) => keys.includes(norm(c.name)))?.id ?? null
  }
  const result = { updated: 0, added: [], skipped: [] }
  const queries = []
  for (const p of products) {
    const handle = blank(p.handle), title = blank(p.title)
    if (!handle || !title) continue
    const price = p.pricePkr == null || p.pricePkr === '' ? null : Number(p.pricePkr)
    const compare = p.compareAtPkr == null || p.compareAtPkr === '' ? null : Number(p.compareAtPkr)
    const active = (p.status || 'active') === 'active'
    const current = byHandle.get(handle)
    if (current) {
      const clash = byName.get(title.toLowerCase())
      if (clash && clash.id !== current.id) { result.skipped.push(`${title} (name already used by another product)`); continue }
      queries.push(db()`UPDATE products SET name = ${title}, price_pkr = ${price}, compare_at_pkr = ${compare},
                          image_url = COALESCE(${blank(p.imageUrl)}, image_url), is_active = ${active} WHERE id = ${current.id}`)
      result.updated++
    } else {
      if (byName.has(title.toLowerCase())) { result.skipped.push(`${title} (a product with this name already exists)`); continue }
      queries.push(db()`INSERT INTO products (name, shopify_handle, price_pkr, compare_at_pkr, image_url, is_active, collection_id)
                          VALUES (${title}, ${handle}, ${price}, ${compare}, ${blank(p.imageUrl)}, ${active}, ${collectionFor(p.tags)})`)
      result.added.push(title)
    }
  }
  if (queries.length) await db().transaction(queries)
  return result
}
