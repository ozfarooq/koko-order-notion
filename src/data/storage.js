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
export const enterStatement   = (id, lines) => api(`/resellers/${id}/statement`, { method: 'POST', body: JSON.stringify({ lines }) })
export const getPayments      = (id) => api(`/resellers/${id}/payments`)
export const recordPayment    = (id, p) => api(`/resellers/${id}/payments`, { method: 'POST', body: JSON.stringify(p) })
export const deletePayment    = (id, paymentId) => api(`/resellers/${id}/payments/${paymentId}`, { method: 'DELETE', body: '{}' })
export const recordReturns    = (id, r) => api(`/resellers/${id}/returns`, { method: 'POST', body: JSON.stringify(r) })

export const addConsignment = (handover) =>
  api('/consignments', { method: 'POST', body: JSON.stringify(handover) })
