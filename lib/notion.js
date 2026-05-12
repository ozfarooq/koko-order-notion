import { Client } from '@notionhq/client'

const createClient = () => new Client({ auth: process.env.NOTION_TOKEN })
const DB = () => process.env.NOTION_DATABASE_ID

// ── Read helpers ────────────────────────────────────────────────────
const getText  = (p) => p?.rich_text?.map((t) => t.plain_text).join('') || ''
const getTitle = (p) => p?.title?.map((t) => t.plain_text).join('') || ''
const getSelect= (p) => p?.select?.name || ''
const getNumber= (p) => (p?.number != null ? p.number : null)
const getDate  = (p) => p?.date?.start || null
const getEmail = (p) => p?.email || getText(p)   // handle both email & rich_text types
const getPhone = (p) => p?.phone_number || getText(p)

// ── Write helpers ───────────────────────────────────────────────────
const richText = (s) => ({
  rich_text: [{ text: { content: String(s || '').slice(0, 2000) } }],
})
const titleProp  = (s) => ({ title: [{ text: { content: String(s || '') } }] })
const selectProp = (s) => (s ? { select: { name: s } } : { select: null })
const numProp    = (n) => ({ number: n === '' || n == null ? null : Number(n) })
const dateProp   = (d) => (d ? { date: { start: d } } : { date: null })
const emailProp  = (e) => ({ email: e || null })
const phoneProp  = (p) => ({ phone_number: p || null })

// ── Measurements serialization ──────────────────────────────────────
function parseMeasurements(raw) {
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    // legacy plain-text measurements from Notion → put in notes
    return { additionalNotes: raw }
  }
}

function serializeMeasurements(m) {
  if (!m || typeof m !== 'object') return ''
  return JSON.stringify(m)
}

// ── Map Notion page → order object ──────────────────────────────────
export function pageToOrder(page) {
  const p = page.properties
  return {
    id:                  page.id,
    orderNumber:         getTitle(p['Order']),
    customer:            getText(p['Customer']),
    product:             getText(p['Product']),
    status:              getSelect(p['Status']) || 'New',
    paymentNotes:        getText(p['Payment Notes']),
    address:             getText(p['Address']),
    advancePaid:         getNumber(p['Advance Paid (PKR)']),
    amount:              getNumber(p['Amount (PKR)']),
    balanceDue:          getNumber(p['Balance Due (PKR)']),
    deliveryDate:        getDate(p['Delivery Date']),
    email:               getEmail(p['Email']),
    measurements:        parseMeasurements(getText(p['Measurements'])),
    orderDate:           getDate(p['Order Date']),
    phone:               getPhone(p['Phone']),
    place:               getText(p['Place']),
    specialInstructions: getText(p['Special Instructions']),
    createdAt:           page.created_time,
    updatedAt:           page.last_edited_time,
  }
}

// ── Map order object → Notion properties ────────────────────────────
export function orderToProps(order) {
  const props = {}
  if (order.orderNumber         !== undefined) props['Order']                 = titleProp(order.orderNumber)
  if (order.customer            !== undefined) props['Customer']              = richText(order.customer)
  if (order.product             !== undefined) props['Product']               = richText(order.product)
  if (order.status              !== undefined) props['Status']                = selectProp(order.status)
  if (order.paymentNotes        !== undefined) props['Payment Notes']         = richText(order.paymentNotes)
  if (order.address             !== undefined) props['Address']               = richText(order.address)
  if (order.advancePaid         !== undefined) props['Advance Paid (PKR)']    = numProp(order.advancePaid)
  if (order.amount              !== undefined) props['Amount (PKR)']          = numProp(order.amount)
  if (order.balanceDue          !== undefined) props['Balance Due (PKR)']     = numProp(order.balanceDue)
  if (order.deliveryDate        !== undefined) props['Delivery Date']         = dateProp(order.deliveryDate)
  if (order.email               !== undefined) props['Email']                 = emailProp(order.email)
  if (order.measurements        !== undefined) props['Measurements']          = richText(serializeMeasurements(order.measurements))
  if (order.orderDate           !== undefined) props['Order Date']            = dateProp(order.orderDate)
  if (order.phone               !== undefined) props['Phone']                 = phoneProp(order.phone)
  if (order.place               !== undefined) props['Place']                 = richText(order.place)
  if (order.specialInstructions !== undefined) props['Special Instructions']  = richText(order.specialInstructions)
  return props
}

// ── Next order number ────────────────────────────────────────────────
export async function getNextOrderNumber() {
  const notion = createClient()
  const response = await notion.databases.query({
    database_id: DB(),
    sorts: [{ property: 'Order', direction: 'descending' }],
    page_size: 50,
  })
  let max = 0
  response.results.forEach((page) => {
    const t = getTitle(page.properties['Order'])
    const m = t.match(/SO-(\d+)/)
    if (m) { const n = parseInt(m[1], 10); if (n > max) max = n }
  })
  return `SO-${String(max + 1).padStart(6, '0')}`
}

// ── CRUD ─────────────────────────────────────────────────────────────
export async function getAllOrders() {
  const notion = createClient()
  const results = []
  let cursor

  while (true) {
    const res = await notion.databases.query({
      database_id: DB(),
      sorts: [{ timestamp: 'created_time', direction: 'descending' }],
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    })
    results.push(...res.results.map(pageToOrder))
    if (!res.has_more) break
    cursor = res.next_cursor
  }
  return results
}

export async function getOrderById(id) {
  const notion = createClient()
  const page = await notion.pages.retrieve({ page_id: id })
  return pageToOrder(page)
}

export async function createOrder(order) {
  const notion = createClient()
  const orderNumber = await getNextOrderNumber()
  const page = await notion.pages.create({
    parent: { database_id: DB() },
    properties: orderToProps({ ...order, orderNumber }),
  })
  return pageToOrder(page)
}

export async function updateOrder(id, updates) {
  const notion = createClient()
  const page = await notion.pages.update({
    page_id: id,
    properties: orderToProps(updates),
  })
  return pageToOrder(page)
}

export async function deleteOrder(id) {
  const notion = createClient()
  await notion.pages.update({ page_id: id, archived: true })
}
