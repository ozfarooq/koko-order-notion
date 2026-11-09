// Reads/writes through the local Express server (dev) or Vercel functions (prod).
// Database credentials never touch the browser — all API calls go server-side.

export const FC_STATUS_OPTIONS = [
  { value: 'FC - At Store', label: 'At Store', color: 'bg-sky-100 text-sky-800',    dot: 'bg-sky-500' },
  { value: 'FC - Sold',     label: 'Sold',     color: 'bg-violet-100 text-violet-800', dot: 'bg-violet-500' },
  { value: 'FC - Paid',     label: 'Paid',     color: 'bg-emerald-100 text-emerald-800', dot: 'bg-emerald-500' },
  { value: 'FC - Returned', label: 'Returned', color: 'bg-rose-100 text-rose-800',   dot: 'bg-rose-500' },
]

export const FC_STATUSES = FC_STATUS_OPTIONS.map((s) => s.value)

export const STATUS_OPTIONS = [
  { value: 'New',              label: 'New',              color: 'bg-blue-100 text-blue-800',    dot: 'bg-blue-500' },
  { value: 'In Tailoring',    label: 'In Tailoring',     color: 'bg-amber-100 text-amber-800',  dot: 'bg-amber-500' },
  { value: 'Ready',           label: 'Ready',            color: 'bg-green-100 text-green-800',  dot: 'bg-green-500' },
  { value: 'Payment Pending', label: 'Payment Pending',  color: 'bg-orange-100 text-orange-800',dot: 'bg-orange-500' },
  { value: 'Paid',            label: 'Paid',             color: 'bg-teal-100 text-teal-800',    dot: 'bg-teal-500' },
  { value: 'Out for Delivery',label: 'Out for Delivery', color: 'bg-purple-100 text-purple-800',dot: 'bg-purple-500' },
  { value: 'Returned',        label: 'Returned',         color: 'bg-rose-100 text-rose-800',    dot: 'bg-rose-500' },
  { value: 'Cancelled',       label: 'Cancelled',        color: 'bg-gray-100 text-gray-500',    dot: 'bg-gray-400' },
]

export const getStatusMeta = (status) =>
  STATUS_OPTIONS.find((s) => s.value === status) || STATUS_OPTIONS[0]

export const groupByStatus = (orders) => {
  const grouped = {}
  STATUS_OPTIONS.forEach((s) => { grouped[s.value] = [] })
  orders.forEach((o) => {
    // Only include orders whose status exactly matches a known status value
    if (o.status && grouped[o.status] !== undefined) {
      grouped[o.status].push(o)
    }
  })
  return grouped
}

// Called when the session has expired, so the app can send the user back to the login page
let onUnauthorized = () => {}
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn }

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...options,
  })
  if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized()
  if (res.status === 204) return null
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `API error ${res.status}`)
    err.status = res.status
    throw err
  }
  return data
}

// ── Auth & accounts ────────────────────────────────────────────────────
export const login          = (username, password) => api('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })
export const logout         = () => api('/auth/logout', { method: 'POST', body: '{}' })
export const getMe          = () => api('/auth/me')
export const changePassword = (currentPassword, newPassword) =>
  api('/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) })
export const getUsers       = () => api('/users')
export const addUser        = (user) => api('/users', { method: 'POST', body: JSON.stringify(user) })
export const updateUser     = (id, upd) => api(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(upd) })
export const getResellers   = () => api('/resellers')

// Public status board (no login; no contact details or amounts)
export const getBoard = () => api('/board')

// ── Retail orders ──────────────────────────────────────────────────────
export const getOrders    = ()         => api('/orders')
export const getOrderById = (id)       => api(`/orders/${id}`)
export const addOrder     = (order)    => api('/orders',      { method: 'POST',  body: JSON.stringify(order) })
export const updateOrder  = (id, upd)  => api(`/orders/${id}`,{ method: 'PATCH', body: JSON.stringify(upd) })
export const deleteOrder  = (id)       => api(`/orders/${id}`,{ method: 'DELETE' })

// ── Catalog & customers ────────────────────────────────────────────────
let productsPromise
export const getProducts = () => (productsPromise ??= api('/products').catch((err) => { productsPromise = null; throw err }))
export const searchCustomers = (q) => api(`/customers?q=${encodeURIComponent(q)}`)

// ── B2B consignment (Fashion Collage) ──────────────────────────────────
// Pieces are returned in the shape the FC pages use: `status` carries the FC_STATUS_OPTIONS
// value ("FC - At Store") and `aedPrice` the piece price.
const toPiece = (p) => ({ ...p, status: `FC - ${p.status}`, aedPrice: p.price })

export async function getConsignments() {
  const data = await api('/consignments')
  return { ...data, items: data.items.map(toPiece) }
}

const PIECE_FIELDS = ['notes', 'designerDiscount', 'resellerDiscount', 'alterationCharge', 'resellerInvoiceNo', 'resellerCode', 'soldOn', 'paidOn']

export async function updateConsignmentItem(id, upd) {
  const body = {}
  if (upd.status !== undefined)   body.status = upd.status.replace(/^FC\s*-\s*/, '')
  if (upd.aedPrice !== undefined) body.price  = upd.aedPrice
  PIECE_FIELDS.forEach((k) => { if (upd[k] !== undefined) body[k] = upd[k] })
  return toPiece(await api(`/consignment-items/${id}`, { method: 'PATCH', body: JSON.stringify(body) }))
}

// Same formula as the reseller's statement (and the database view):
//   net price = gross − designer discount − reseller discount
//   commission = net price × commission %;  net payable = net price − commission − alteration/laundry
// `gross` lets the FC page preview a price that is still being typed.
export function pieceMoney(p, gross = p.aedPrice) {
  const netPrice   = (Number(gross) || 0) - (Number(p.designerDiscount) || 0) - (Number(p.resellerDiscount) || 0)
  const commission = netPrice * (Number(p.commissionPct) || 0) / 100
  return { netPrice, commission, netPayable: netPrice - commission - (Number(p.alterationCharge) || 0) }
}

export const addConsignment = (handover) =>
  api('/consignments', { method: 'POST', body: JSON.stringify(handover) })
