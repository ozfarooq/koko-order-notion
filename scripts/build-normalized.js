// Build the normalized tables (db/schema.sql) from the staging tables, in one transaction.
//   staging.shopify_variants + shopify_collection_map → collections, products
//   staging.notion_orders (retail rows)               → customers, orders, order_items
//   staging.notion_orders (FC rows)                   → resellers, consignments, consignment_items
//
// Usage: node scripts/build-normalized.js            (first build)
//        node scripts/build-normalized.js --rebuild  (drop and rebuild; refused once the app has added its own data)
import 'dotenv/config'
import fs from 'fs'
import { Pool, neonConfig } from '@neondatabase/serverless'

neonConfig.webSocketConstructor = globalThis.WebSocket
const pool = new Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL })
const db = await pool.connect()
const q = async (text, params) => (await db.query(text, params)).rows

const FASHION_COLLAGE = {
  name: 'Fashion Collage Dubai', address: 'Al-Wasl Road', city: 'Dubai', country: 'UAE',
  currency: 'AED', commission_pct: 30,
}

// Shorthand used in Notion entries → exact Shopify title
const ALIASES = {
  'Women Emb Trouser': 'Women Embroidered Trouser',
}

// ── Helpers ────────────────────────────────────────────────────────────
const norm = (s) => (s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '')
const digits = (s) => (s || '').replace(/\D/g, '').slice(-10)

// "Manan Arooba [CONFIRMED]" → name "Manan Arooba"; "Mrs Nadeem - Walkin" → name "Mrs Nadeem", reference "Walkin".
// Status tags are dropped; tags that say how the sale came in move to orders.reference.
const STATUS_TAGS = /^(confirmed)$/i
function splitName(raw) {
  const tags = []
  let name = raw.replace(/\[([^\]]*)\]/g, (_, t) => { tags.push(t.trim()); return '' })
  name = name.replace(/\s+-\s*(walk-?in)\s*$/i, (_, t) => { tags.push(t); return '' })
  const reference = tags
    .filter((t) => t && !STATUS_TAGS.test(t))
    .map((t) => t.replace(/^(studio\s+)?wal?k(ing|-?in)$/i, 'Walkin'))
    .join(', ') || null
  return { name: name.replace(/\s+/g, ' ').trim(), reference }
}

const SIZE_PATTERNS = [
  ['X-Small', /^\s*[|(\-–]?\s*(extra[\s-]*small|x-?small|xs)\b/i],
  ['X-Large', /^\s*[|(\-–]?\s*(extra[\s-]*large|x-?large|xl)\b/i],
  ['Small',   /^\s*[|(\-–]?\s*(small|sml|s)\b/i],
  ['Medium',  /^\s*[|(\-–]?\s*(medium|m)\b/i],
  ['Large',   /^\s*[|(\-–]?\s*(large|l)\b/i],
]
const sizeAt = (text) => SIZE_PATTERNS.find(([, re]) => re.test(text))?.[0] || null

// Find every catalog product named in a free-text Notion "Product" value, longest names first
// so "Shab-e-Siyah" wins over "Shab". Returns [{ product, size }] in order of appearance.
function parseProducts(text, catalog) {
  // Map each normalized character back to its index in the original text
  const map = []
  let flat = ''
  for (let i = 0; i < text.length; i++) {
    const c = norm(text[i])
    for (const ch of c) { flat += ch; map.push(i) }
  }
  const taken = new Array(flat.length).fill(false)
  const found = []
  for (const p of catalog) {
    let from = 0
    while ((from = flat.indexOf(p.key, from)) !== -1) {
      const end = from + p.key.length
      if (!taken.slice(from, end).some(Boolean)) {
        taken.fill(true, from, end)
        const after = text.slice(map[end - 1] + 1, map[end - 1] + 30)
        found.push({ pos: from, product: p, size: sizeAt(after) })
      }
      from = end
    }
  }
  found.sort((a, b) => a.pos - b.pos)
  const seen = new Set()
  return found.filter((f) => !seen.has(f.product.id) && seen.add(f.product.id))
}

// ── Safety: never wipe data the app created ────────────────────────────
const exists = (await q(`SELECT to_regclass('public.orders') IS NOT NULL AS e`))[0].e
if (exists) {
  if (!process.argv.includes('--rebuild')) {
    console.error('Normalized tables already exist. Re-run with --rebuild to drop and rebuild them.')
    process.exit(1)
  }
  const [{ n }] = await q(`
    SELECT (SELECT count(*) FROM orders o WHERE NOT EXISTS
              (SELECT 1 FROM staging.notion_orders s WHERE s.notion_page_id = o.id))
         + (SELECT count(*) FROM consignment_items c WHERE NOT EXISTS
              (SELECT 1 FROM staging.notion_orders s WHERE s.notion_page_id = c.id)) AS n`)
  if (Number(n) > 0) {
    console.error(`Refusing to rebuild: ${n} order(s)/piece(s) were created after migration and would be lost.`)
    process.exit(1)
  }
}

const report = { skipped: [], unmatched: [], renumbered: [], defaultedStatus: [], cleanedNames: [] }

try {
  await q('BEGIN')
  if (exists) {
    await q(`DROP VIEW IF EXISTS consignment_items_detail;
             DROP TABLE IF EXISTS consignment_items, consignments, resellers, order_items, orders, customers, products, collections CASCADE;
             DROP SEQUENCE IF EXISTS order_number_seq;
             DROP FUNCTION IF EXISTS touch_updated_at CASCADE;`)
  }
  await q(fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'))

  // ── Catalog ──────────────────────────────────────────────────────────
  await q(`INSERT INTO collections (name) SELECT DISTINCT collection FROM staging.shopify_collection_map ORDER BY 1`)
  await q(`
    INSERT INTO products (collection_id, name, shopify_handle, price_pkr, compare_at_pkr, image_url, is_active)
    SELECT c.id, v.title, v.handle, v.price_pkr, v.compare_at_pkr, NULLIF(v.raw->>'Image Src', ''), v.status = 'active'
    FROM (SELECT DISTINCT ON (handle) * FROM staging.shopify_variants ORDER BY handle, id) v
    LEFT JOIN staging.shopify_collection_map m ON m.handle = v.handle
    LEFT JOIN collections c ON c.name = m.collection
    ORDER BY v.title`)
  const products = await q(`SELECT id, name FROM products`)
  const catalog = [
    ...products.map((p) => ({ ...p, key: norm(p.name) })),
    ...Object.entries(ALIASES).map(([alias, name]) => ({ ...products.find((p) => p.name === name), key: norm(alias) })),
  ].sort((a, b) => b.key.length - a.key.length)

  const rows = await q(`
    SELECT notion_page_id AS id, order_number, customer, product, size, quantity, status,
           order_date::text AS order_date, delivery_date::text AS delivery_date,
           amount_pkr, advance_paid_pkr, aed_price, email, phone, address, city, measurements,
           payment_notes, special_instructions, notion_created_at, notion_updated_at
    FROM staging.notion_orders ORDER BY notion_created_at`)

  // ── Retail ───────────────────────────────────────────────────────────
  const retail = rows.filter((r) => !r.status.startsWith('FC'))
  const customers = [] // { id, name, phone, ... }
  const findCustomer = (name, phone) => {
    const ph = digits(phone)
    return customers.find((c) => (ph && c.ph === ph) ||
      (norm(c.name) === norm(name) && (!ph || !c.ph || c.ph === ph)))
  }
  const usedNumbers = new Set()
  let maxSO = 0

  for (const r of retail) {
    if (!r.customer.trim() && r.amount_pkr == null && !r.product.trim()) {
      report.skipped.push(r.order_number || '(blank)')
      continue
    }

    // Customer: same phone, or same name with no conflicting phone, is the same person
    const { name: customerName, reference } = splitName(r.customer)
    if (customerName !== r.customer.trim()) report.cleanedNames.push(`"${r.customer.trim()}" → "${customerName}"${reference ? ` (reference: ${reference})` : ''}`)
    let cust = findCustomer(customerName, r.phone)
    if (!cust) {
      const [row] = await q(
        `INSERT INTO customers (name, phone, email, address, city, created_at)
         VALUES ($1, NULLIF($2,''), NULLIF($3,''), NULLIF($4,''), NULLIF($5,''), $6) RETURNING id`,
        [customerName, r.phone.trim(), r.email.trim(), r.address.trim(), r.city.trim(), r.notion_created_at])
      cust = { id: row.id, name: customerName, ph: digits(r.phone) }
      customers.push(cust)
    } else {
      // Later orders carry the latest contact details
      await q(`UPDATE customers SET phone = COALESCE(NULLIF($2,''), phone), email = COALESCE(NULLIF($3,''), email),
                 address = COALESCE(NULLIF($4,''), address), city = COALESCE(NULLIF($5,''), city) WHERE id = $1`,
        [cust.id, r.phone.trim(), r.email.trim(), r.address.trim(), r.city.trim()])
      if (!cust.ph) cust.ph = digits(r.phone)
    }

    // Order number: "SO-000187 / Shopify #1151" → SO-000187 + #1151; duplicates get a suffix
    const m = r.order_number.match(/(SO-\d+)(?:.*?Shopify\s*#\s*(\d+))?/i)
    let number = m ? m[1].toUpperCase() : r.order_number.trim()
    const shopifyNo = m?.[2] ? `#${m[2]}` : (r.product.match(/Shopify\s*#\s*(\d+)/i)?.[1] ? `#${r.product.match(/Shopify\s*#\s*(\d+)/i)[1]}` : null)
    if (usedNumbers.has(number)) {
      let n = 2
      while (usedNumbers.has(`${number}-${n}`)) n++
      report.renumbered.push(`${number} (${r.customer}) → ${number}-${n}`)
      number = `${number}-${n}`
    }
    usedNumbers.add(number)
    const so = number.match(/^SO-(\d+)/)
    if (so) maxSO = Math.max(maxSO, Number(so[1]))

    let status = r.status
    if (!status) { status = 'New'; report.defaultedStatus.push(`${number} (${r.customer})`) }

    await q(
      `INSERT INTO orders (id, order_number, shopify_order_number, customer_id, reference, status, order_date, delivery_date,
         amount_pkr, advance_paid_pkr, delivery_address, delivery_city, measurements, payment_notes,
         special_instructions, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,0),COALESCE($10,0),NULLIF($11,''),NULLIF($12,''),$13,NULLIF($14,''),NULLIF($15,''),$16,$17)`,
      [r.id, number, shopifyNo, cust.id, reference, status, r.order_date, r.delivery_date, r.amount_pkr, r.advance_paid_pkr,
       r.address.trim(), r.city.trim(), r.measurements || {}, r.payment_notes.trim(), r.special_instructions.trim(),
       r.notion_created_at, r.notion_updated_at])

    // Items
    const items = parseProducts(r.product, catalog)
    const qty = Number(r.quantity) || 1
    if (items.length === 0) {
      report.unmatched.push(`${number}: "${r.product}"`)
      await q(`INSERT INTO order_items (order_id, product_id, description, size, quantity) VALUES ($1, NULL, $2, $3, $4)`,
        [r.id, r.product, r.size || null, qty])
      continue
    }
    const single = items.length === 1
    for (const it of items) {
      await q(
        `INSERT INTO order_items (order_id, product_id, description, size, quantity, unit_price_pkr)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [r.id, it.product.id, r.product === it.product.name ? null : r.product,
         (single && r.size) || it.size || r.size || null, single ? qty : 1,
         single && r.amount_pkr != null ? Number(r.amount_pkr) / qty : null])
    }
  }
  await q(`SELECT setval('order_number_seq', $1)`, [Math.max(maxSO, 1)])

  // ── Fashion Collage consignment ──────────────────────────────────────
  const fc = rows.filter((r) => r.status.startsWith('FC'))
  const [{ id: resellerId }] = await q(
    `INSERT INTO resellers (name, address, city, country, currency, commission_pct)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [FASHION_COLLAGE.name, FASHION_COLLAGE.address, FASHION_COLLAGE.city, FASHION_COLLAGE.country,
     FASHION_COLLAGE.currency, FASHION_COLLAGE.commission_pct])

  // A handover batch is the set of pieces recorded on the same date at the store address;
  // stray rows are attached to the most recent batch on or before their date.
  const atStore = (r) => /wasl/i.test(r.address)
  const batchDates = [...new Set(fc.filter(atStore).map((r) => r.order_date))].sort()
  const batchIds = {}
  for (const d of batchDates) {
    const [{ id }] = await q(
      `INSERT INTO consignments (reseller_id, handover_date, commission_pct) VALUES ($1,$2,$3) RETURNING id`,
      [resellerId, d, FASHION_COLLAGE.commission_pct])
    batchIds[d] = id
  }
  for (const r of fc) {
    const date = batchDates.filter((d) => d <= r.order_date).pop() || batchDates[0]
    const [hit] = parseProducts(r.product, catalog)
    if (!hit) { report.unmatched.push(`FC piece: "${r.product}"`); continue }
    await q(
      `INSERT INTO consignment_items (id, consignment_id, product_id, size, price, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [r.id, batchIds[date], hit.product.id, r.size || null, r.aed_price, r.status.replace(/^FC\s*-\s*/, ''),
       r.notion_created_at, r.notion_updated_at])
  }

  await q('COMMIT')
} catch (err) {
  await q('ROLLBACK')
  console.error('Build failed, nothing was changed:', err.message)
  process.exit(1)
} finally {
  db.release()
}

// ── Summary ────────────────────────────────────────────────────────────
const summary = await pool.query(`
  SELECT (SELECT count(*) FROM collections)::int AS collections,
         (SELECT count(*) FROM products)::int AS products,
         (SELECT count(*) FROM products WHERE collection_id IS NULL)::int AS products_no_collection,
         (SELECT count(*) FROM customers)::int AS customers,
         (SELECT count(*) FROM orders)::int AS orders,
         (SELECT count(*) FROM order_items)::int AS order_items,
         (SELECT count(*) FROM consignments)::int AS consignments,
         (SELECT count(*) FROM consignment_items)::int AS consignment_pieces`)
console.table(summary.rows)
for (const [k, v] of Object.entries(report)) if (v.length) console.log(`\n${k} (${v.length}):\n  ` + v.join('\n  '))
await pool.end()
