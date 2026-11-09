// Load the Shopify product export and the collection mapping into staging tables.
// Raw landing data only — the normalized catalog is built from these later.
// Safe to re-run: both tables are rebuilt from scratch each time.
// Usage: node scripts/load-shopify-staging.js [path/to/products_export.csv]
import 'dotenv/config'
import fs from 'fs'
import XLSX from 'xlsx'
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL)
const csvPath = process.argv[2] || 'scripts/data/shopify_products_export.csv'

// Collection → product handles, from Shopify Admin › Collections (screenshots, 2026-11-09).
// `basis` records how each assignment was derived so uncertain ones can be reviewed.
const COLLECTIONS = [
  { name: 'Naqsh',                   basis: 'tag naqsh',           handles: ['barg', 'shab', 'mehfil', 'gulnaar', 'sunehri', 'gul-e-mehtab'] },
  { name: "Afsaneh – Eid Edit '26",  basis: 'tag afsaneh-26',      handles: ['shab-e-siyah', 'zard-chandni', 'junoon', 'neel', 'safaid-raat', 'dhundh', 'aatish', 'surkh-bagh', 'rang-e-bahar', 'shab-e-gul'] },
  { name: "Marsa'a",                 basis: 'tag Marsaa',          handles: ['shab-chirag', 'zard-gul', 'gulaab-booti', 'bagh-e-bahaar', 'khaak-roshan', 'shikargarh', 'gul-afshan', 'rang-mahal'] },
  { name: 'Aqad',                    basis: 'description "by AQAD"', handles: ['banafsheh', 'raaat-ki-raani', 'gull-lala', 'neelofar', 'ghulab-devi', 'gull-bahar'] },
  { name: 'SOIE',                    basis: 'grip-silk print set, count 7', handles: ['egyptian-tapestry-peach-bowtie', 'victorian-harmony-brown-kaftan', 'botanical-whimsy-white-green', 'panther-coral-orange', 'noir-black-kaftan', 'azure-navy-blue', 'spota-siren-maroon-red'] },
  { name: "Fiore D'autunno",         basis: 'SKU KO25-AC1',        handles: ['ortensia-secca', 'camelia-ombra', 'giglio-d-oro', 'papavero-cremisi', 'viola-d-autunno-1', 'viola-d-autunno'] },
  { name: 'Afsaneh',                 basis: 'SKU KO25 SC3',        handles: ['qissa-e-gulab-women', 'qissa-e-gulab-men', 'noor-e-safa-men', 'noor-e-safa-women', 'mahru-women', 'mahru-men', 'sehr-baiz-men', 'sehr-baiz-women', 'gulnaar-subah-women', 'gulnaar-subah-men', 'ziyaar-men', 'ziyaar'] },
  { name: 'CÈA',                     basis: 'UNCERTAIN: 6 candidates for 5 slots', handles: ['fuchsia-finesse-pink-black', 'peachy-paradise-peach', 'forest-finesse-green-long', 'icy-mirage-blue', 'midnight-moss-green-jacket-trouser'] },
  { name: 'Serenè',                  basis: 'SKU KO25 SC1 / "Serenè Collection"', handles: ['rosette', 'dew-blossom', 'celeste', 'lilac-bloom', 'soleil'] },
  { name: 'Pahli Eid',               basis: 'lawn pishwas set, count 6', handles: ['wasl-e-yaar-maroon', 'gulab-e-eid-lilac-long', 'baad-e-sabah-pink-short', 'dawat-nama-blue', 'sonehri-kiran-yellow-mustard', 'chaand-raat-black'] },
  { name: 'Luxe Silk',               basis: 'SKU KO24 SC2',        handles: ['sapphire-teal', 'crimson-maroon', 'goldenrod-mustard', 'soft-shell-peach', 'aquamarine-aqua', 'dusky-black'] },
  { name: 'K.Solids',                basis: 'SKU KO25 SC2 (+ Pearl Desire UNCERTAIN)', handles: ['mystic-lillac', 'moss-bloom', 'sand-whisper', 'noir-whisper', 'crimson-cascade', 'pearl-desire-pearl-white'] },
  { name: 'Bloom',                   basis: 'description "by Bloom"', handles: ['bluebell-sky-blue-sleevless', 'pink-rose-pink-lillac', 'dahlia-black', 'orchid-green', 'scarlet-rose-red', 'lilly-blue-white'] },
]

const wb = XLSX.read(fs.readFileSync(csvPath, 'utf8'), { type: 'string' })
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })

// Shopify repeats product-level fields only on a product's first row
const variants = []
let product
for (const r of rows) {
  if (!r.Handle) continue
  if (r.Title) product = r
  if (!r['Option1 Value']) continue // image-only rows
  const { 'Body (HTML)': _body, ...raw } = r
  variants.push({
    handle: r.Handle, title: product.Title, tags: product.Tags, category: product['Product Category'],
    status: product.Status, option1_name: product['Option1 Name'], option1: r['Option1 Value'],
    option2_name: product['Option2 Name'], option2: r['Option2 Value'] || null,
    sku: r['Variant SKU'] || null, price_pkr: Number(r['Variant Price']) || null,
    compare_at_pkr: Number(r['Variant Compare At Price']) || null,
    inventory_qty: r['Variant Inventory Qty'] === '' ? null : Number(r['Variant Inventory Qty']),
    raw,
  })
}

await sql`CREATE SCHEMA IF NOT EXISTS staging`
await sql`DROP TABLE IF EXISTS staging.shopify_variants`
await sql`
  CREATE TABLE staging.shopify_variants (
    id             SERIAL PRIMARY KEY,
    handle         TEXT NOT NULL,
    title          TEXT NOT NULL,
    tags           TEXT,
    category       TEXT,
    status         TEXT,
    option1_name   TEXT,
    option1        TEXT,
    option2_name   TEXT,
    option2        TEXT,
    sku            TEXT,
    price_pkr      NUMERIC,
    compare_at_pkr NUMERIC,
    inventory_qty  INTEGER,
    raw            JSONB NOT NULL,
    loaded_at      TIMESTAMPTZ DEFAULT now()
  )`
for (const v of variants) {
  await sql`
    INSERT INTO staging.shopify_variants
      (handle, title, tags, category, status, option1_name, option1, option2_name, option2,
       sku, price_pkr, compare_at_pkr, inventory_qty, raw)
    VALUES (${v.handle}, ${v.title}, ${v.tags}, ${v.category}, ${v.status}, ${v.option1_name}, ${v.option1},
            ${v.option2_name}, ${v.option2}, ${v.sku}, ${v.price_pkr}, ${v.compare_at_pkr}, ${v.inventory_qty},
            ${JSON.stringify(v.raw)})`
}

await sql`DROP TABLE IF EXISTS staging.shopify_collection_map`
await sql`
  CREATE TABLE staging.shopify_collection_map (
    collection TEXT NOT NULL,
    handle     TEXT NOT NULL UNIQUE,
    basis      TEXT
  )`
for (const c of COLLECTIONS)
  for (const h of c.handles)
    await sql`INSERT INTO staging.shopify_collection_map (collection, handle, basis) VALUES (${c.name}, ${h}, ${c.basis})`

const [{ products, nvariants }] = await sql`SELECT count(DISTINCT handle)::int products, count(*)::int nvariants FROM staging.shopify_variants`
const unmapped = await sql`
  SELECT DISTINCT v.handle, v.title FROM staging.shopify_variants v
  LEFT JOIN staging.shopify_collection_map m USING (handle) WHERE m.handle IS NULL ORDER BY v.title`
const unknown = await sql`
  SELECT m.handle FROM staging.shopify_collection_map m
  LEFT JOIN staging.shopify_variants v USING (handle) WHERE v.handle IS NULL`
console.log(`Loaded ${products} products / ${nvariants} variants.`)
console.log(`Products with no collection (${unmapped.length}):`, unmapped.map((u) => u.title).join(', ') || 'none')
if (unknown.length) console.log('Mapped handles missing from export:', unknown.map((u) => u.handle).join(', '))
