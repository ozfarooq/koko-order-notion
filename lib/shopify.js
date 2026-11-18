// Website (Shopify) orders → app orders, on demand.
// Uses a Dev Dashboard app installed on the store (read_orders, read_customers, read_products).
// The client-credentials grant gives a 24-hour token; it's cached per server instance.
import { neon } from '@neondatabase/serverless'
import { HttpError, createOrder } from './db.js'

const API_VERSION = '2026-10'
let _sql, _token
const sql = (...args) => (_sql ??= neon(process.env.DATABASE_URL))(...args)

function config() {
  // Tolerate values pasted with https://, a trailing slash, quotes or spaces
  const clean = (v) => String(v || '').trim().replace(/^['"]|['"]$/g, '').trim()
  const shop = clean(process.env.SHOPIFY_SHOP).replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase()
  const id = clean(process.env.SHOPIFY_CLIENT_ID), secret = clean(process.env.SHOPIFY_CLIENT_SECRET)
  if (!shop || !id || !secret) throw new HttpError(503, 'The Shopify connection is not set up yet (SHOPIFY_SHOP, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET)')
  if (!/^[a-z0-9-]+\.myshopify\.com$/.test(shop)) throw new HttpError(503, `SHOPIFY_SHOP should look like your-store.myshopify.com (it is "${shop}")`)
  return { shop, id, secret }
}

// Network failures become a readable error instead of a generic server error
async function call(url, init) {
  try { return await fetch(url, init) } catch (err) {
    throw new HttpError(502, `Could not reach Shopify (${err.cause?.code || err.message})`)
  }
}

async function token() {
  if (_token && _token.expires > Date.now() + 60_000) return _token.value
  const { shop, id, secret } = config()
  const res = await call(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.access_token) throw new HttpError(502, `Shopify refused the connection (${body.error_description || body.error || res.status})`)
  _token = { value: body.access_token, expires: Date.now() + (body.expires_in || 3600) * 1000 }
  return _token.value
}

async function gql(query, variables = {}) {
  const { shop } = config()
  const res = await call(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': await token() },
    body: JSON.stringify({ query, variables }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.errors) throw new HttpError(502, `Shopify error: ${body.errors?.[0]?.message || res.status}`)
  return body.data
}

const ORDER_FIELDS = `
  id name createdAt cancelledAt test note email phone
  displayFinancialStatus displayFulfillmentStatus paymentGatewayNames
  currentTotalPriceSet { shopMoney { amount } }
  totalReceivedSet { shopMoney { amount } }
  customer { displayName phone email }
  shippingAddress { name phone address1 address2 city }
  lineItems(first: 30) { nodes {
    title variantTitle quantity sku
    product { handle }
    discountedUnitPriceAfterAllDiscountsSet { shopMoney { amount } }
  } }`

const money = (set) => (set ? Number(set.shopMoney.amount) : 0)
const karachiDate = (iso) => new Date(new Date(iso).getTime() + 5 * 3600_000).toISOString().slice(0, 10)

// Shopify order → the app's order shape (what createOrder takes), plus what the preview shows
function toAppOrder(o, productByHandle) {
  const amount = money(o.currentTotalPriceSet)
  const received = Math.min(money(o.totalReceivedSet), amount)
  const paid = o.displayFinancialStatus === 'PAID' || (amount > 0 && received >= amount)
  const fulfilled = o.displayFulfillmentStatus === 'FULFILLED'
  const status = o.cancelledAt ? 'Cancelled' : fulfilled ? (paid ? 'Paid' : 'Out for Delivery') : 'New'
  const a = o.shippingAddress || {}
  const items = o.lineItems.nodes.map((li) => {
    const p = productByHandle.get(li.product?.handle)
    return {
      productId: p?.id ?? null, product: p?.name ?? li.title, matched: !!p,
      size: li.variantTitle && li.variantTitle !== 'Default Title' ? li.variantTitle : null,
      quantity: li.quantity, unitPrice: money(li.discountedUnitPriceAfterAllDiscountsSet),
    }
  })
  const gateways = o.paymentGatewayNames.join(', ')
  return {
    shopifyId: o.id, shopifyOrderNumber: o.name, createdAt: o.createdAt,
    adminUrl: `https://admin.shopify.com/store/${config().shop.replace('.myshopify.com', '')}/orders/${o.id.split('/').pop()}`,
    financialStatus: o.displayFinancialStatus, fulfillmentStatus: o.displayFulfillmentStatus,
    cancelled: !!o.cancelledAt, test: o.test,
    // Cancelled, voided-payment and test checkouts are listed but not pre-selected
    suggested: !o.cancelledAt && !o.test && o.displayFinancialStatus !== 'VOIDED',
    order: {
      customer: a.name || o.customer?.displayName || 'Website customer',
      phone: a.phone || o.customer?.phone || o.phone || null,
      email: o.email || o.customer?.email || null,
      address: [a.address1, a.address2].filter(Boolean).join(', ') || null,
      city: a.city || null,
      items, status, amount, advancePaid: paid ? amount : received,
      orderDate: karachiDate(o.createdAt), channel: 'Shopify', shopifyOrderNumber: o.name, shopifyOrderId: o.id.split('/').pop(),
      paymentNotes: `Shopify: ${o.displayFinancialStatus.toLowerCase().replace(/_/g, ' ')}${gateways ? ` · ${gateways}` : ''}`,
      specialInstructions: o.note || null,
    },
  }
}

async function context() {
  const [products, existing] = await Promise.all([
    sql`SELECT id, name, shopify_handle FROM products WHERE shopify_handle IS NOT NULL`,
    sql`SELECT shopify_order_number, shopify_order_id::text AS sid FROM orders WHERE shopify_order_number IS NOT NULL OR shopify_order_id IS NOT NULL`,
  ])
  return {
    productByHandle: new Map(products.map((p) => [p.shopify_handle, p])),
    imported: new Set(existing.flatMap((r) => [r.shopify_order_number, r.sid && `gid://shopify/Order/${r.sid}`]).filter(Boolean)),
  }
}

// Website orders from the last `days` days that aren't in the app yet (Shopify allows up to 60)
// Unexpected failures in the website import surface their reason instead of a generic server error
const explain = (fn) => async (...args) => {
  try { return await fn(...args) } catch (err) {
    if (err instanceof HttpError) throw err
    console.error('[shopify]', err)
    throw new HttpError(502, `Website import failed: ${err.message}`)
  }
}

export const pendingWebsiteOrders = explain(async function pendingWebsiteOrders({ days = 60 } = {}) {
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10)
  const { productByHandle, imported } = await context()
  const orders = []
  let after = null
  do {
    const data = await gql(`query($q: String, $after: String) {
      orders(first: 100, after: $after, sortKey: CREATED_AT, reverse: true, query: $q) {
        nodes { ${ORDER_FIELDS} } pageInfo { hasNextPage endCursor } } }`, { q: `created_at:>=${since}`, after })
    orders.push(...data.orders.nodes)
    after = data.orders.pageInfo.hasNextPage ? data.orders.pageInfo.endCursor : null
  } while (after && orders.length < 500)
  const fresh = orders.filter((o) => !imported.has(o.name) && !imported.has(o.id))
  return {
    since, alreadyImported: orders.length - fresh.length,
    orders: fresh.map((o) => toAppOrder(o, productByHandle)),
  }
})

// Import the chosen Shopify orders (by Shopify id). Re-checks for duplicates right before saving.
export async function importWebsiteOrders(ids = [], user = null) {
  if (!Array.isArray(ids) || !ids.length) throw new HttpError(400, 'Choose at least one order')
  if (ids.length > 100) throw new HttpError(400, 'Import at most 100 orders at a time')
  const data = await gql(`query($ids: [ID!]!) { nodes(ids: $ids) { ... on Order { ${ORDER_FIELDS} } } }`, { ids })
  const { productByHandle, imported } = await context()
  const result = { created: [], skipped: [] }
  const list = data.nodes.filter(Boolean).sort((a, b) => a.createdAt.localeCompare(b.createdAt)) // oldest first, so SO numbers follow website order
  for (const o of list) {
    if (imported.has(o.name) || imported.has(o.id)) { result.skipped.push(`${o.name} (already imported)`); continue }
    const { order } = toAppOrder(o, productByHandle)
    if (!order.items.length) { result.skipped.push(`${o.name} (no items)`); continue }
    try {
      const created = await createOrder(order, user)
      imported.add(o.name)
      result.created.push({ id: created.id, orderNumber: created.orderNumber, shopifyOrderNumber: o.name, customer: order.customer })
    } catch (err) {
      result.skipped.push(`${o.name} (${err.message})`)
    }
  }
  return result
}

// ── Catalogue through the Admin API ─────────────────────────────────────
// Base PKR prices, whatever country the server runs in. (The public storefront feed shows the
// international market's prices to a server outside Pakistan, which doubled every price.)
// Returns null when the Shopify connection isn't set up, so the caller can fall back to the storefront.
export async function storeCatalog() {
  try { config() } catch { return null }
  const collections = []
  let after = null
  do {
    const d = await gql(`query($after: String) { collections(first: 5, after: $after) {
      nodes { handle title products(first: 100) { nodes { handle status } } }
      pageInfo { hasNextPage endCursor } } }`, { after })
    for (const c of d.collections.nodes) {
      const live = c.products.nodes.filter((p) => p.status === 'ACTIVE').map((p) => p.handle)
      collections.push({ handle: c.handle, title: c.title, products_count: live.length, members: live })
    }
    after = d.collections.pageInfo.hasNextPage ? d.collections.pageInfo.endCursor : null
  } while (after)
  const products = []
  after = null
  do {
    const d = await gql(`query($after: String) { products(first: 25, after: $after, query: "status:active") {
      nodes { handle title descriptionHtml
        variants(first: 20) { nodes { price compareAtPrice } }
        media(first: 4) { nodes { ... on MediaImage { image { url } } } } }
      pageInfo { hasNextPage endCursor } } }`, { after })
    for (const p of d.products.nodes) products.push({
      handle: p.handle, title: p.title, descriptionHtml: p.descriptionHtml,
      variants: p.variants.nodes.map((v) => ({ price: v.price, compareAtPrice: v.compareAtPrice })),
      images: p.media.nodes.map((m) => m.image?.url).filter(Boolean),
    })
    after = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null
  } while (after)
  return { collections, products }
}
