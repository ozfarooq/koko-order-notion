// One-off: add consignment stock sent to Fashion Collage Dubai.
// One Notion record per piece, matching the format of existing FC records.
// Usage: node scripts/add-fc-stock.js          (dry run)
//        node scripts/add-fc-stock.js --apply  (writes to Notion)
import 'dotenv/config'
import { Client } from '@notionhq/client'
import { orderToProps, getAllOrders } from '../lib/notion.js'

const ORDER_DATE = '2026-10-17'
const SIZES = ['Medium', 'Large']
const ITEMS = [
  { product: 'GulEMehtab', aedPrice: 800 },
  { product: 'Mehfil',     aedPrice: 650 },
  { product: 'Sunehri',    aedPrice: 650 },
  { product: 'Gulnaar',    aedPrice: 600 },
  { product: 'Barg',       aedPrice: 500 },
  { product: 'Shab',       aedPrice: 500 },
]

const records = ITEMS.flatMap(({ product, aedPrice }) =>
  SIZES.map((size) => ({
    orderNumber: 'Fashion Collage Dubai',
    customer:    'Fashion Collage Dubai',
    address:     'Al-Wasl Road Dubai',
    status:      'FC - At Store',
    quantity:    1,
    orderDate:   ORDER_DATE,
    product, size, aedPrice,
  }))
)

const apply = process.argv.includes('--apply')

// Guard against double-running: skip if any of these products already exist as FC records
const existing = (await getAllOrders()).filter(
  (o) => o.status.startsWith('FC') && ITEMS.some((i) => i.product === o.product)
)
if (existing.length) {
  console.error(`Abort: ${existing.length} FC record(s) already exist for these products.`)
  process.exit(1)
}

console.table(records.map(({ product, size, aedPrice }) => ({ product, size, aedPrice })))
if (!apply) {
  console.log('Dry run. Re-run with --apply to create these records.')
  process.exit(0)
}

const notion = new Client({ auth: process.env.NOTION_TOKEN })
for (const r of records) {
  const properties = await orderToProps(notion, r)
  await notion.pages.create({ parent: { database_id: process.env.NOTION_DATABASE_ID }, properties })
  console.log(`Created ${r.product} ${r.size} @ AED ${r.aedPrice}`)
}
