// Reads/writes through the local Express server (dev) or Vercel functions (prod).
// Database credentials never touch the browser — all API calls go server-side.

// Status colours: soft tints in light mode, deep tints in dark mode (written out so Tailwind finds them)

// Consignment pieces ("FC - " prefix is the frontend's internal value; the API stores plain names)
export const FC_STATUS_OPTIONS = [
  { value: 'FC - At Store', label: 'At Store', color: 'bg-gold-100 text-gold-700 ring-1 ring-inset ring-gold-300/60 dark:bg-gold-700/25 dark:text-gold-200 dark:ring-white/10',     dot: 'bg-gold-500' },
  { value: 'FC - Sold',     label: 'Sold',     color: 'bg-amber-100 text-amber-700 ring-1 ring-inset ring-amber-200/70 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-white/10',  dot: 'bg-amber-500' },
  { value: 'FC - Paid',     label: 'Paid',     color: 'bg-green-100 text-green-700 ring-1 ring-inset ring-green-200/70 dark:bg-green-900/30 dark:text-green-300 dark:ring-white/10', dot: 'bg-green-600' },
  { value: 'FC - Returned', label: 'Returned', color: 'bg-stone-100 text-stone-600 ring-1 ring-inset ring-stone-200/70 dark:bg-stone-800/40 dark:text-stone-300 dark:ring-white/10',    dot: 'bg-stone-400' },
]

export const FC_STATUSES = FC_STATUS_OPTIONS.map((s) => s.value)

export const STATUS_OPTIONS = [
  { value: 'New',              label: 'New',              color: 'bg-gold-100 text-gold-700 ring-1 ring-inset ring-gold-300/60 dark:bg-gold-700/25 dark:text-gold-200 dark:ring-white/10',    dot: 'bg-gold-500' },
  { value: 'In Tailoring',    label: 'In Tailoring',     color: 'bg-amber-100 text-amber-700 ring-1 ring-inset ring-amber-200/70 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-white/10',   dot: 'bg-amber-500' },
  { value: 'Ready',           label: 'Ready',            color: 'bg-plum-100 text-plum-700 ring-1 ring-inset ring-plum-200/70 dark:bg-plum-800/30 dark:text-plum-300 dark:ring-white/10',   dot: 'bg-plum-500' },
  { value: 'Payment Pending', label: 'Payment Pending',  color: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-300/60 dark:bg-amber-900/30 dark:text-amber-200 dark:ring-white/10',  dot: 'bg-amber-600' },
  { value: 'Paid',            label: 'Paid',             color: 'bg-green-100 text-green-700 ring-1 ring-inset ring-green-200/70 dark:bg-green-900/30 dark:text-green-300 dark:ring-white/10',    dot: 'bg-green-600' },
  { value: 'Out for Delivery',label: 'Out for Delivery', color: 'bg-sky-100 text-sky-800 ring-1 ring-inset ring-sky-200/70 dark:bg-sky-800/40 dark:text-sky-200 dark:ring-white/10',  dot: 'bg-sky-500' },
  { value: 'Returned',        label: 'Returned',         color: 'bg-stone-100 text-stone-600 ring-1 ring-inset ring-stone-200/70 dark:bg-stone-800/40 dark:text-stone-300 dark:ring-white/10',    dot: 'bg-stone-400' },
  { value: 'Cancelled',       label: 'Cancelled',        color: 'bg-rose-50 text-rose-600 ring-1 ring-inset ring-rose-200/70 dark:bg-rose-900/30 dark:text-rose-300 dark:ring-white/10',   dot: 'bg-rose-600' },
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

export async function api(path, options = {}) {
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
// Resellers (menu + pages). Cached for the session; call refreshResellers() after changes.
let resellersPromise
export const getResellers = () => (resellersPromise ??= api('/resellers').catch((err) => { resellersPromise = null; throw err }))
// Pages that change resellers announce it so the menu reloads them
export const RESELLERS_CHANGED = 'koko:resellers-changed'
export const refreshResellers = () => { resellersPromise = null; window.dispatchEvent(new Event(RESELLERS_CHANGED)); return getResellers() }

export const getDashboard = () => api('/dashboard')

export const search = (q) => api(`/search?q=${encodeURIComponent(q)}`)

// Public status board (no login; no contact details or amounts)
export const getBoard = () => api('/board')

// ── Retail orders ──────────────────────────────────────────────────────
export const getOrders    = ()         => api('/orders')
export const getOrderById = (id)       => api(`/orders/${id}`)
export const getNextNumbers = ()       => api('/orders/next-numbers')
// Where an order came from. Our SO number is the ID everywhere; Shopify orders also carry Shopify's number.
export const CHANNELS = ['Studio', 'WhatsApp', 'Instagram', 'Shopify', 'Other']
export const getWebsiteOrders = ()     => api('/orders/website')
export const importWebsiteOrders = (ids) => api('/orders/website/import', { method: 'POST', body: JSON.stringify({ ids }) })
export const getOrderHistory = (id)    => api(`/orders/${id}/history`)
export const addOrder     = (order)    => api('/orders',      { method: 'POST',  body: JSON.stringify(order) })
export const updateOrder  = (id, upd)  => api(`/orders/${id}`,{ method: 'PATCH', body: JSON.stringify(upd) })
export const deleteOrder  = (id)       => api(`/orders/${id}`,{ method: 'DELETE' })

// ── Catalog & customers ────────────────────────────────────────────────
let productsPromise
export const getProducts = () => (productsPromise ??= api('/products').catch((err) => { productsPromise = null; throw err }))
export const searchCustomers = (q) => api(`/customers?q=${encodeURIComponent(q)}`)
export const getCustomers    = ({ q = '', sort = 'recent' } = {}) => api(`/customers?all=1&sort=${sort}&q=${encodeURIComponent(q)}`)
export const getCustomer     = (id) => api(`/customers/${id}`)
export const updateCustomer  = (id, upd) => api(`/customers/${id}`, { method: 'PATCH', body: JSON.stringify(upd) })
export const mergeCustomer   = (id, intoId) => api(`/customers/${id}/merge`, { method: 'POST', body: JSON.stringify({ intoId }) })

export const getCollections   = () => api('/collections')
export const addCollection    = (name) => api('/collections', { method: 'POST', body: JSON.stringify({ name }) })
export const getProduct       = (id) => api(`/products/${id}`)
export const updateProduct    = (id, upd) => api(`/products/${id}`, { method: 'PATCH', body: JSON.stringify(upd) }).then((p) => { productsPromise = null; return p })
export const importCatalogue  = (products) => api('/catalogue/import', { method: 'POST', body: JSON.stringify({ products }) }).then((r) => { productsPromise = null; return r })
export const previewStoreSync = () => api('/catalogue/store-sync')
export const runStoreSync     = (include) => api('/catalogue/store-sync', { method: 'POST', body: JSON.stringify({ include }) }).then((r) => { productsPromise = null; return r })

// ── B2B consignment (Fashion Collage) ──────────────────────────────────
// Pieces are returned in the shape the FC pages use: `status` carries the FC_STATUS_OPTIONS
// value ("FC - At Store") and `aedPrice` the piece price.
const toPiece = (p) => ({ ...p, status: `FC - ${p.status}`, aedPrice: p.price })

export async function getConsignments(resellerId) {
  const data = await api(`/consignments${resellerId ? `?resellerId=${resellerId}` : ''}`)
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

export const addReseller      = (r) => api('/resellers', { method: 'POST', body: JSON.stringify(r) }).then((x) => { refreshResellers(); return x })
export const updateReseller   = (id, r) => api(`/resellers/${id}`, { method: 'PATCH', body: JSON.stringify(r) }).then((x) => { refreshResellers(); return x })
export const getResellerCodes = (id) => api(`/resellers/${id}/codes`)
export const setResellerCode = (id, productId, code) => api(`/resellers/${id}/codes/${productId}`, { method: 'PUT', body: JSON.stringify({ code }) })
export const nextResellerCode = (id, productId) => api(`/resellers/${id}/codes/${productId}/next`, { method: 'POST' })
export const enterStatement   = (id, lines) => api(`/resellers/${id}/statement`, { method: 'POST', body: JSON.stringify({ lines }) })
export const getPayments      = (id) => api(`/resellers/${id}/payments`)
export const recordPayment    = (id, p) => api(`/resellers/${id}/payments`, { method: 'POST', body: JSON.stringify(p) })
export const deletePayment    = (id, paymentId) => api(`/resellers/${id}/payments/${paymentId}`, { method: 'DELETE', body: '{}' })
export const recordReturns    = (id, r) => api(`/resellers/${id}/returns`, { method: 'POST', body: JSON.stringify(r) })

export const addConsignment = (handover) =>
  api('/consignments', { method: 'POST', body: JSON.stringify(handover) })

// ── Studio inventory (pieces made ahead of an order) ───────────────────
export const STOCK_SIZES = ['X-Small', 'Small', 'Medium', 'Large', 'X-Large']
export const STOCK_STATUS_OPTIONS = [
  { value: 'In Production', color: 'bg-amber-100 text-amber-700 ring-1 ring-inset ring-amber-200/70 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-white/10', dot: 'bg-amber-500' },
  { value: 'At Studio',     color: 'bg-gold-100 text-gold-700 ring-1 ring-inset ring-gold-300/60 dark:bg-gold-700/25 dark:text-gold-200 dark:ring-white/10',       dot: 'bg-gold-500' },
  { value: 'At Shoot',      color: 'bg-plum-100 text-plum-700 ring-1 ring-inset ring-plum-200/70 dark:bg-plum-800/30 dark:text-plum-300 dark:ring-white/10',       dot: 'bg-plum-500' },
  { value: 'With Reseller', color: 'bg-sky-100 text-sky-800 ring-1 ring-inset ring-sky-200/70 dark:bg-sky-800/40 dark:text-sky-200 dark:ring-white/10',            dot: 'bg-sky-500' },
  { value: 'Sold',          color: 'bg-green-100 text-green-700 ring-1 ring-inset ring-green-200/70 dark:bg-green-900/30 dark:text-green-300 dark:ring-white/10', dot: 'bg-green-600' },
  { value: 'Gifted',        color: 'bg-pink-50 text-pink-700 ring-1 ring-inset ring-pink-200/70 dark:bg-pink-950/40 dark:text-pink-300 dark:ring-white/10',       dot: 'bg-pink-500' },
  { value: 'Archived',      color: 'bg-stone-100 text-stone-600 ring-1 ring-inset ring-stone-200/70 dark:bg-stone-800/40 dark:text-stone-300 dark:ring-white/10', dot: 'bg-stone-400' },
  { value: 'Damaged',       color: 'bg-rose-50 text-rose-600 ring-1 ring-inset ring-rose-200/70 dark:bg-rose-900/30 dark:text-rose-300 dark:ring-white/10',       dot: 'bg-rose-600' },
]
const query = (f) => new URLSearchParams(Object.entries(f).filter(([, v]) => v !== '' && v != null)).toString()
export const getInventory      = () => api('/inventory')
export const getStockPieces    = (filters = {}) => api(`/inventory/pieces?${query(filters)}`)
export const addStockPieces    = (b) => api('/inventory/pieces', { method: 'POST', body: JSON.stringify(b) })
export const updateStockPiece  = (id, b) => api(`/inventory/pieces/${id}`, { method: 'PATCH', body: JSON.stringify(b) })
export const moveStockPieces   = (pieceIds, status, moveNote) => api('/inventory/pieces/move', { method: 'POST', body: JSON.stringify({ pieceIds, status, moveNote }) })
export const addStockPiecesBulk = (b) => api('/inventory/pieces/bulk', { method: 'POST', body: JSON.stringify(b) })
export const markStockDamaged  = (b) => api('/inventory/pieces/damage', { method: 'POST', body: JSON.stringify(b) })
export const getStockHistory   = (id) => api(`/inventory/pieces/${id}/history`)
export const deleteStockPiece  = (id) => api(`/inventory/pieces/${id}`, { method: 'DELETE', body: '{}' })
export const getAvailableStock = () => api('/inventory/available')
export const getLookbook = () => api('/lookbook')

// Studio pieces an order could be filled from (shoot samples, reseller returns)
export const getPiecesForOrder = (productIds, orderId) => api(`/inventory/for-order?productIds=${productIds}${orderId ? `&orderId=${orderId}` : ''}`)
export const updatePayment    = (id, paymentId, p) => api(`/resellers/${id}/payments/${paymentId}`, { method: 'PATCH', body: JSON.stringify(p) })
export const addPaymentFile   = (id, paymentId, f) => api(`/resellers/${id}/payments/${paymentId}/files`, { method: 'POST', body: JSON.stringify(f) })
export const getPaymentFile   = (id, paymentId, fileId) => api(`/resellers/${id}/payments/${paymentId}/files/${fileId}`)
export const deletePaymentFile = (id, paymentId, fileId) => api(`/resellers/${id}/payments/${paymentId}/files/${fileId}`, { method: 'DELETE', body: '{}' })
