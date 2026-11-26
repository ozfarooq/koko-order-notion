// Catalogue: collections, product detail (retail sales + reseller stock), edits and Shopify re-import.
import { neon } from '@neondatabase/serverless'
import { HttpError, num, norm, blank } from './db.js'
import { can } from './auth.js'
import { storeCatalog } from './shopify.js'

let _sql
const db = () => (_sql ??= neon(process.env.DATABASE_URL))
const sql = (...args) => db()(...args)

// Receipt one-liner from a Shopify description. Descriptions usually open with a bold headline
// ("🔥 Azure – Navy Blue Grip Dress | …") followed by prose; we take the prose's first sentence,
// and fall back to the headline (minus emoji, name and "| …" tail) when there's no prose.
const textOf = (h) => h.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, '’')
  .replace(/\s+/g, ' ').replace(/(\w)-\s+(\w)/g, '$1-$2').replace(/\(\s+/g, '(').replace(/\s+([,.)])/g, '$1').trim()
export function tagline(html) {
  const blocks = String(html || '')
    .replace(/<li\b[^>]*>(\s*<p\b[^>]*>)?/gi, '\n\u0001').replace(/<h[1-6]\b[^>]*>/gi, '\n<strong>').replace(/<\/h[1-6]>/gi, '</strong>\n')
    .split(/<\/?(?:p|div|ul|ol|li)\b[^>]*>|<br\s*\/?>|\n/i)
    .map((raw) => ({ text: textOf(raw), bullet: raw.includes('\u0001'), bold: !textOf(raw.replace(/<(strong|b)\b[^>]*>[\s\S]*?<\/\1>/gi, '')).replace(/[^\p{L}\p{N}]/gu, '') }))
    .map((b) => ({ ...b, text: b.text.replace(/\u0001/g, '').trim() })).filter((b) => b.text)
  const prose = blocks.find((b) => !b.bold && !b.bullet && b.text.split(' ').length >= 6 && !/^(style|styling|note|care|fabric|details)\b/i.test(b.text))
  let line = prose
    ? (prose.text.match(/^.+?[.!?](?=\s|$)/) || [prose.text])[0]
    : (blocks[0]?.text || '').replace(/^[^\p{L}\p{N}]+/u, '').replace(/^.{0,40}?\s[–—-]\s+(?=\p{L})/u, '').replace(/\s*\|.*$/, '')
  if (!line) return null
  if (line.length > 150) {
    // end at a natural break that fits: a dash, then "featuring …", then the last comma
    const head = line.slice(0, 150)
    const after40 = (re) => { const i = head.slice(40).search(re); return i < 0 ? -1 : i + 40 }
    const cut = [after40(/ [—–] /), after40(/,? (featuring|adorned with) /), head.lastIndexOf(',')].find((i) => i > 40)
    line = cut ? line.slice(0, cut).replace(/[,;:]$/, '') + '.' : head.slice(0, 147).replace(/\s+\S*$/, '') + '…'
  }
  return line
}
const PHOTOS = 4

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
    images: p.images?.length ? p.images : p.image_url ? [p.image_url] : [], tagline: p.tagline,
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
      price_pkr     = CASE WHEN ${body.pricePkr !== undefined} THEN ${body.pricePkr === '' || body.pricePkr == null ? null : Number(body.pricePkr)}::numeric ELSE price_pkr END,
      tagline       = CASE WHEN ${body.tagline !== undefined} THEN ${blank(body.tagline) ?? null}::text ELSE tagline END
    WHERE id = ${pid} RETURNING id`
  if (!rows.length) throw new HttpError(404, 'Product not found')
  return productDetail(pid, user)
}

// Shopify re-import. `products` are already grouped per handle by the browser:
// [{ handle, title, pricePkr, compareAtPkr, imageUrl, images, description, status, tags }]
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
    const images = (Array.isArray(p.images) ? p.images : []).filter(Boolean).slice(0, PHOTOS)
    const line = tagline(p.description)
    const current = byHandle.get(handle)
    if (current) {
      const clash = byName.get(title.toLowerCase())
      if (clash && clash.id !== current.id) { result.skipped.push(`${title} (name already used by another product)`); continue }
      queries.push(db()`UPDATE products SET name = ${title}, price_pkr = ${price}, compare_at_pkr = ${compare},
                          image_url = COALESCE(${blank(p.imageUrl)}, image_url), is_active = ${active},
                          images = CASE WHEN ${images.length > 0} THEN ${images}::text[] ELSE images END,
                          tagline = COALESCE(tagline, ${line}) WHERE id = ${current.id}`)
      result.updated++
    } else {
      if (byName.has(title.toLowerCase())) { result.skipped.push(`${title} (a product with this name already exists)`); continue }
      queries.push(db()`INSERT INTO products (name, shopify_handle, price_pkr, compare_at_pkr, image_url, is_active, collection_id, images, tagline)
                          VALUES (${title}, ${handle}, ${price}, ${compare}, ${blank(p.imageUrl)}, ${active}, ${collectionFor(p.tags)}, ${images}::text[], ${line})`)
      result.added.push(title)
    }
  }
  if (queries.length) await db().transaction(queries)
  return result
}

// ── Sync from the live website ──────────────────────────────────────────
// The storefront publishes its collections and products as public JSON, so no API key is needed.
// Only published collections and products are visible this way; hidden ones still need the CSV import.
// Shopify throttles the per-collection product lists hard, so those are fetched only when needed:
// for collections the app doesn't have yet, and for ones whose piece count differs from the app's.
const STORE = process.env.SHOPIFY_STORE_URL || 'https://kokoatelier.com'
// Website groupings that aren't design collections (shop-by-category, sale, bestsellers)
const MERCHANDISING = /\b(sale|trending|pret|bottoms?|botton|new arrivals?|all|best ?sellers?)\b/i

async function storeJson(path) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(STORE + path, { headers: { 'User-Agent': 'KokoAtelierOrders/1.0', Accept: 'application/json' } })
    if (res.ok) return res.json()
    if (res.status === 429 && attempt < 2) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue }
    throw new HttpError(502, res.status === 429
      ? 'The website is limiting requests right now. Please try again in a minute.'
      : `The website did not respond (${res.status})`)
  }
}

async function allPages(path, key) {
  const out = []
  for (let page = 1; ; page++) {
    const r = await storeJson(`${path}${path.includes('?') ? '&' : '?'}limit=250&page=${page}`)
    out.push(...r[key])
    if (r[key].length < 250) return out
  }
}

// Same shape from the Admin API (base PKR prices; see storeCatalog in shopify.js)
const fromAdmin = (p) => {
  const prices = p.variants.map((v) => Number(v.price)).filter((n) => n > 0)
  const min = prices.length ? Math.min(...prices) : null
  const v = p.variants.find((x) => Number(x.price) === min) || p.variants[0]
  return {
    handle: p.handle, title: p.title, pricePkr: min,
    compareAtPkr: v && Number(v.compareAtPrice) > 0 ? Number(v.compareAtPrice) : null,
    imageUrl: p.images[0] || null, images: p.images.slice(0, PHOTOS), tagline: tagline(p.descriptionHtml),
  }
}

const fromStore = (p) => {
  const prices = p.variants.map((v) => Number(v.price)).filter((n) => n > 0)
  const min = prices.length ? Math.min(...prices) : null
  const v = p.variants.find((x) => Number(x.price) === min) || p.variants[0]
  return {
    handle: p.handle, title: p.title, pricePkr: min,
    compareAtPkr: v && Number(v.compare_at_price) > 0 ? Number(v.compare_at_price) : null,
    imageUrl: p.images?.[0]?.src || null,
    images: (p.images || []).slice(0, PHOTOS).map((i) => i.src), tagline: tagline(p.body_html),
  }
}

// apply=false: a preview of what would change. apply=true: `include` lists the website collection
// handles to bring in (new ones are created). Products already in a collection are never moved.
export async function syncFromStore({ apply = false, include = [] } = {}) {
  // Prefer the Admin API (right prices, no rate limit); the public storefront is the fallback
  const admin = await storeCatalog()
  const [siteCollections, siteProducts, existing, collections] = await Promise.all([
    admin ? admin.collections : allPages('/collections.json', 'collections'),
    admin ? admin.products : allPages('/products.json', 'products'),
    sql`SELECT id, name, shopify_handle, collection_id, price_pkr, compare_at_pkr, image_url, images, tagline FROM products`,
    sql`SELECT c.id, c.name, count(p.id)::int AS n FROM collections c LEFT JOIN products p ON p.collection_id = c.id GROUP BY c.id`,
  ])
  const byHandle = new Map(existing.map((p) => [p.shopify_handle, p]))
  const byName = new Map(existing.map((p) => [p.name.toLowerCase(), p]))
  const colByNorm = new Map(collections.map((c) => [norm(c.name), c]))
  const wanted = new Set(include)

  // Which collections need their piece list from the website
  const members = new Map()
  for (const c of siteCollections) {
    const inApp = colByNorm.get(norm(c.title))
    const need = inApp ? c.products_count > inApp.n
      : apply ? wanted.has(c.handle) : !MERCHANDISING.test(c.title) && c.products_count > 0
    if (need) members.set(c.handle, c.members ?? (await allPages(`/collections/${c.handle}/products.json`, 'products')).map((p) => p.handle))
  }

  const products = new Map(siteProducts.map((p) => [p.handle, admin ? fromAdmin(p) : fromStore(p)]))
  const preview = siteCollections.map((c) => {
    const inApp = !!colByNorm.get(norm(c.title))
    const handles = members.get(c.handle)
    const toAdd = handles ? handles.filter((h) => !byHandle.get(h)?.collection_id).map((h) => products.get(h)?.title || h) : null
    return {
      handle: c.handle, title: c.title, inApp, products: c.products_count, toAdd,
      suggested: inApp || (!!toAdd && toAdd.length === c.products_count && !MERCHANDISING.test(c.title)),
    }
  })
  const changed = [...products.values()].filter((p) => {
    const cur = byHandle.get(p.handle)
    return cur && (Number(cur.price_pkr) !== p.pricePkr || (p.imageUrl && cur.image_url !== p.imageUrl) || cur.name !== p.title
      || (p.images.length && p.images.join() !== (cur.images || []).join()) || (!cur.tagline && p.tagline))
  })
  if (!apply) return { collections: preview, updates: changed.map((p) => p.title) }

  const result = { collectionsCreated: [], added: [], placed: [], updated: 0, skipped: [] }
  const queries = []
  for (const c of siteCollections.filter((x) => wanted.has(x.handle) && members.has(x.handle))) {
    let col = colByNorm.get(norm(c.title))
    if (!col) {
      ;[col] = await sql`INSERT INTO collections (name) VALUES (${c.title}) RETURNING id, name`
      colByNorm.set(norm(c.title), col)
      result.collectionsCreated.push(c.title)
    }
    for (const h of members.get(c.handle)) {
      const p = products.get(h), cur = byHandle.get(h)
      if (!p) continue
      if (!cur) {
        if (byName.has(p.title.toLowerCase())) { result.skipped.push(`${p.title} (a product with this name already exists)`); continue }
        queries.push(db()`INSERT INTO products (name, shopify_handle, price_pkr, compare_at_pkr, image_url, is_active, collection_id, images, tagline)
                            VALUES (${p.title}, ${p.handle}, ${p.pricePkr}, ${p.compareAtPkr}, ${p.imageUrl}, true, ${col.id}, ${p.images}::text[], ${p.tagline})`)
        const row = { name: p.title, shopify_handle: h, collection_id: col.id }
        byHandle.set(h, row); byName.set(p.title.toLowerCase(), row)
        result.added.push(p.title)
      } else if (!cur.collection_id) {
        queries.push(db()`UPDATE products SET collection_id = ${col.id} WHERE id = ${cur.id}`)
        cur.collection_id = col.id
        result.placed.push(p.title)
      }
    }
  }
  // Refresh name, price and photo of products the website shows
  for (const p of changed) {
    const cur = byHandle.get(p.handle)
    const clash = byName.get(p.title.toLowerCase())
    if (clash && clash.id !== cur.id) { result.skipped.push(`${p.title} (name already used by another product)`); continue }
    queries.push(db()`UPDATE products SET name = ${p.title}, price_pkr = ${p.pricePkr}, compare_at_pkr = ${p.compareAtPkr},
                        image_url = COALESCE(${p.imageUrl}, image_url), is_active = true,
                        images = CASE WHEN ${p.images.length > 0} THEN ${p.images}::text[] ELSE images END,
                        tagline = COALESCE(tagline, ${p.tagline}) WHERE id = ${cur.id}`)
    result.updated++
  }
  if (queries.length) await db().transaction(queries)
  return result
}

// Public, for the login page: one photo of every active piece, newest collections first (the same photos the website shows)
export async function lookbook() {
  const rows = await sql`
    SELECT p.name, c.name AS collection, p.tagline, COALESCE(p.images[1], p.image_url) AS src
    FROM products p JOIN collections c ON c.id = p.collection_id
    WHERE p.is_active AND COALESCE(p.images[1], p.image_url) IS NOT NULL
    ORDER BY c.id DESC, p.name
    LIMIT 150`
  const sized = (u) => (u.includes('cdn.shopify.com') ? `${u}${u.includes('?') ? '&' : '?'}width=420` : u)
  return rows.map((r) => ({ name: r.name, collection: r.collection, tagline: r.tagline || '', src: sized(r.src) }))
}
