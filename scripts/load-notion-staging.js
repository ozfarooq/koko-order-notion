// Copy every Notion order row, as-is, into staging.notion_orders in Neon.
// This is a raw landing table — the normalized tables are built from it later.
// Safe to re-run: rows are upserted by Notion page id.
// Usage: node scripts/load-notion-staging.js
import 'dotenv/config'
import { Client } from '@notionhq/client'
import { neon } from '@neondatabase/serverless'
import { pageToOrder } from '../lib/notion.js'

const sql = neon(process.env.DATABASE_URL)
const notion = new Client({ auth: process.env.NOTION_TOKEN })

await sql`CREATE SCHEMA IF NOT EXISTS staging`
await sql`
  CREATE TABLE IF NOT EXISTS staging.notion_orders (
    notion_page_id       UUID PRIMARY KEY,
    order_number         TEXT,
    customer             TEXT,
    product              TEXT,
    size                 TEXT,
    quantity             NUMERIC,
    status               TEXT,
    order_date           DATE,
    delivery_date        DATE,
    amount_pkr           NUMERIC,
    advance_paid_pkr     NUMERIC,
    balance_due_pkr      NUMERIC,
    aed_price            NUMERIC,
    email                TEXT,
    phone                TEXT,
    address              TEXT,
    city                 TEXT,
    measurements         JSONB,
    payment_notes        TEXT,
    special_instructions TEXT,
    notion_created_at    TIMESTAMPTZ,
    notion_updated_at    TIMESTAMPTZ,
    raw_properties       JSONB NOT NULL,
    loaded_at            TIMESTAMPTZ DEFAULT now()
  )`

const pages = []
let cursor
do {
  const res = await notion.databases.query({
    database_id: process.env.NOTION_DATABASE_ID,
    page_size: 100,
    ...(cursor ? { start_cursor: cursor } : {}),
  })
  pages.push(...res.results)
  cursor = res.has_more ? res.next_cursor : undefined
} while (cursor)

for (const page of pages) {
  const o = pageToOrder(page)
  await sql`
    INSERT INTO staging.notion_orders (
      notion_page_id, order_number, customer, product, size, quantity, status,
      order_date, delivery_date, amount_pkr, advance_paid_pkr, balance_due_pkr, aed_price,
      email, phone, address, city, measurements, payment_notes, special_instructions,
      notion_created_at, notion_updated_at, raw_properties, loaded_at
    ) VALUES (
      ${o.id}, ${o.orderNumber}, ${o.customer}, ${o.product}, ${o.size}, ${o.quantity}, ${o.status},
      ${o.orderDate}, ${o.deliveryDate}, ${o.amount}, ${o.advancePaid}, ${o.balanceDue}, ${o.aedPrice},
      ${o.email}, ${o.phone}, ${o.address}, ${o.city}, ${JSON.stringify(o.measurements)},
      ${o.paymentNotes}, ${o.specialInstructions},
      ${o.createdAt}, ${o.updatedAt}, ${JSON.stringify(page.properties)}, now()
    )
    ON CONFLICT (notion_page_id) DO UPDATE SET
      order_number = EXCLUDED.order_number, customer = EXCLUDED.customer,
      product = EXCLUDED.product, size = EXCLUDED.size, quantity = EXCLUDED.quantity,
      status = EXCLUDED.status, order_date = EXCLUDED.order_date,
      delivery_date = EXCLUDED.delivery_date, amount_pkr = EXCLUDED.amount_pkr,
      advance_paid_pkr = EXCLUDED.advance_paid_pkr, balance_due_pkr = EXCLUDED.balance_due_pkr,
      aed_price = EXCLUDED.aed_price, email = EXCLUDED.email, phone = EXCLUDED.phone,
      address = EXCLUDED.address, city = EXCLUDED.city, measurements = EXCLUDED.measurements,
      payment_notes = EXCLUDED.payment_notes, special_instructions = EXCLUDED.special_instructions,
      notion_created_at = EXCLUDED.notion_created_at, notion_updated_at = EXCLUDED.notion_updated_at,
      raw_properties = EXCLUDED.raw_properties, loaded_at = now()`
}

const [{ count }] = await sql`SELECT count(*)::int AS count FROM staging.notion_orders`
console.log(`Loaded ${pages.length} Notion rows. staging.notion_orders now has ${count} rows.`)
