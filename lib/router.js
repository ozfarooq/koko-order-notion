// All API routes, served by a single Vercel function (api/index.js) and by server.js in dev.
// Each route declares the permission it needs; requests without a valid session get 401,
// and logged-in users without the permission get 403.
import * as db from './db.js'
import * as auth from './auth.js'
import * as customers from './customers.js'
import * as catalog from './catalog.js'
import * as resellers from './resellers.js'
import * as shopify from './shopify.js'
import * as inventory from './inventory.js'
import { dashboard } from './dashboard.js'

const route = (method, path, permission, fn) => {
  const keys = []
  const pattern = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)' }) + '/?$')
  return { method, pattern, keys, permission, fn }
}

const ROUTES = [
  // ── Public ────────────────────────────────────────────────
  route('GET',  '/board', 'public', () => db.listBoard()),
  route('GET',  '/lookbook', 'public', () => catalog.lookbook()),
  route('POST', '/auth/login', 'public', async ({ req, res, body }) => {
    const { token, user } = await auth.login(body.username, body.password)
    res.setHeader('Set-Cookie', auth.sessionCookie(req, token))
    await auth.audit(user, 'auth.login', 'user', user.id)
    return user
  }),
  route('POST', '/auth/logout', 'public', async ({ req, res }) => {
    await auth.logout(auth.readCookie(req))
    res.setHeader('Set-Cookie', auth.sessionCookie(req, null))
    return { ok: true }
  }),

  // ── Any logged-in user ────────────────────────────────────
  route('GET',  '/auth/me', 'login', ({ user }) => user),
  route('POST', '/auth/password', 'login', async ({ user, body }) => {
    await auth.changeOwnPassword(user, body.currentPassword, body.newPassword)
    await auth.audit(user, 'auth.password_change', 'user', user.id)
    return { ok: true }
  }),

  // ── Retail ────────────────────────────────────────────────
  route('GET',    '/orders', 'orders:read', () => db.listOrders()),
  route('POST',   '/orders', 'orders:write', async ({ user, body }) => {
    const order = await db.createOrder(body, user)
    await auth.audit(user, 'order.create', 'order', order.id, { orderNumber: order.orderNumber, ...body })
    return order
  }),
  route('GET',    '/orders/next-numbers', 'orders:write', () => db.nextNumbers()),
  route('GET',    '/orders/website', 'orders:write', () => shopify.pendingWebsiteOrders()),
  route('POST',   '/orders/website/import', 'orders:write', async ({ user, body }) => {
    const r = await shopify.importWebsiteOrders(body.ids, user)
    for (const c of r.created) await auth.audit(user, 'order.import_website', 'order', c.id, { shopifyOrderNumber: c.shopifyOrderNumber })
    return r
  }),
  route('GET',    '/orders/:id', 'orders:read', ({ params }) => db.getOrder(params.id)),
  route('GET',    '/orders/:id/history', 'orders:read', ({ params }) => db.orderHistory(params.id)),
  route('PATCH',  '/orders/:id', 'orders:write', async ({ user, params, body }) => {
    const order = await db.updateOrder(params.id, body, user)
    await auth.audit(user, 'order.update', 'order', params.id, body)
    return order
  }),
  route('DELETE', '/orders/:id', 'orders:delete', async ({ user, params }) => {
    const order = await db.getOrder(params.id)
    await db.deleteOrder(params.id)
    await auth.audit(user, 'order.delete', 'order', params.id, { orderNumber: order.orderNumber, customer: order.customer, amount: order.amount })
  }),
  route('GET', '/search', 'login', ({ user, query }) => db.search(query.q, user)),
  // The order form's quick search (q) vs the Customers page list (all=1, sort)
  route('GET', '/customers', 'customers:read', ({ query }) =>
    query.all ? customers.customerList({ q: query.q || '', sort: query.sort }) : db.listCustomers(query.q || '')),
  route('GET', '/customers/:id', 'customers:read', ({ params }) => customers.customerProfile(params.id)),
  route('PATCH', '/customers/:id', 'customers:write', async ({ user, params, body }) => {
    const c = await customers.updateCustomer(params.id, body)
    await auth.audit(user, 'customer.update', 'customer', params.id, body)
    return c
  }),
  route('POST', '/customers/:id/merge', 'customers:merge', async ({ user, params, body }) => {
    const r = await customers.mergeCustomers(params.id, body.intoId)
    await auth.audit(user, 'customer.merge', 'customer', body.intoId, { mergedFrom: params.id, name: r.merged, ordersMoved: r.ordersMoved })
    return r
  }),

  route('GET', '/collections', 'products:read', () => catalog.listCollections()),
  route('POST', '/collections', 'catalog:write', async ({ user, body }) => {
    const c = await catalog.createCollection(body.name)
    await auth.audit(user, 'collection.create', 'collection', c.id, body)
    return c
  }),
  route('GET', '/products/:id', 'products:read', ({ user, params }) => catalog.productDetail(params.id, user)),
  route('PATCH', '/products/:id', 'catalog:write', async ({ user, params, body }) => {
    const p = await catalog.updateProduct(params.id, body, user)
    await auth.audit(user, 'product.update', 'product', params.id, body)
    return p
  }),
  route('POST', '/catalogue/import', 'catalog:write', async ({ user, body }) => {
    const r = await catalog.importShopify(body.products)
    await auth.audit(user, 'catalogue.import', 'catalogue', null, { updated: r.updated, added: r.added.length, skipped: r.skipped.length })
    return r
  }),
  route('GET', '/catalogue/store-sync', 'catalog:write', () => catalog.syncFromStore()),
  route('POST', '/catalogue/store-sync', 'catalog:write', async ({ user, body }) => {
    const r = await catalog.syncFromStore({ apply: true, include: body.include || [] })
    await auth.audit(user, 'catalogue.store_sync', 'catalogue', null, { collections: r.collectionsCreated, added: r.added.length, placed: r.placed.length, updated: r.updated })
    return r
  }),
  route('GET', '/products', 'products:read', () => db.listProducts()),
  route('GET', '/dashboard', 'orders:read', ({ user }) => dashboard(user)),

  // ── B2B consignment ───────────────────────────────────────
  route('GET',   '/resellers', 'fc:read', ({ user }) => db.listResellers(user)),
  route('POST',  '/resellers', 'resellers:manage', async ({ user, body }) => {
    const r = await resellers.createReseller(body)
    await auth.audit(user, 'reseller.create', 'reseller', r.id, body)
    return r
  }),
  route('GET',   '/resellers/:id/codes', 'resellers:manage', ({ params }) => resellers.listDesignCodes(params.id)),
  // A confirmed code typed in, or cleared
  route('PUT',   '/resellers/:id/codes/:productId', 'resellers:manage', async ({ user, params, body }) => {
    const r = await resellers.setDesignCode(params.id, params.productId, body.code)
    await auth.audit(user, 'reseller.code', 'reseller', params.id, r)
    return r
  }),
  // A new design: the next number in the series
  route('POST',  '/resellers/:id/codes/:productId/next', 'resellers:manage', async ({ user, params }) => {
    const [r] = await resellers.assignCodes(params.id, [params.productId])
    if (!r) throw Object.assign(new Error('Set a code prefix first, or this design already has a code'), { status: 400 })
    await auth.audit(user, 'reseller.code', 'reseller', params.id, r)
    return r
  }),
  route('PATCH', '/resellers/:id', 'resellers:manage', async ({ user, params, body }) => {
    const r = await resellers.updateReseller(params.id, body)
    await auth.audit(user, 'reseller.update', 'reseller', params.id, body)
    return r
  }),
  route('POST',  '/resellers/:id/statement', 'fc:write', async ({ user, params, body }) => {
    const r = await resellers.enterStatement(params.id, body.lines, user)
    await auth.audit(user, 'reseller.statement', 'reseller', params.id, { lines: body.lines })
    return r
  }),
  route('GET',   '/resellers/:id/payments', 'fc:money', ({ user, params }) => {
    if (user.role === 'reseller' && String(user.resellerId) !== String(params.id)) throw Object.assign(new Error("You don't have access to this"), { status: 403 })
    return resellers.listPayments(params.id, user)
  }),
  route('POST',  '/resellers/:id/payments', 'fc:write', async ({ user, params, body }) => {
    const r = await resellers.recordPayment(params.id, body, user)
    await auth.audit(user, 'reseller.payment', 'reseller', params.id, body)
    return r
  }),
  route('PATCH',  '/resellers/:id/payments/:paymentId', 'fc:write', async ({ user, params, body }) => {
    const r = await resellers.updatePayment(params.id, params.paymentId, body)
    await auth.audit(user, 'reseller.payment_update', 'reseller', params.id, { paymentId: params.paymentId, ...body })
    return r
  }),
  route('POST',   '/resellers/:id/payments/:paymentId/files', 'fc:write', async ({ user, params, body }) => {
    const f = await resellers.addPaymentFile(params.id, params.paymentId, body, user)
    await auth.audit(user, 'reseller.payment_file', 'reseller', params.id, { paymentId: params.paymentId, file: f.name, size: f.size })
    return f
  }),
  route('GET',    '/resellers/:id/payments/:paymentId/files/:fileId', 'fc:money', ({ user, params }) => {
    if (user.role === 'reseller' && String(user.resellerId) !== String(params.id)) throw Object.assign(new Error("You don't have access to this"), { status: 403 })
    return resellers.getPaymentFile(params.id, params.paymentId, params.fileId)
  }),
  route('DELETE', '/resellers/:id/payments/:paymentId/files/:fileId', 'fc:write', async ({ user, params }) => {
    const f = await resellers.deletePaymentFile(params.id, params.paymentId, params.fileId)
    await auth.audit(user, 'reseller.payment_file_delete', 'reseller', params.id, { paymentId: params.paymentId, file: f.name })
  }),
  route('DELETE', '/resellers/:id/payments/:paymentId', 'fc:write', async ({ user, params }) => {
    await resellers.deletePayment(params.id, params.paymentId)
    await auth.audit(user, 'reseller.payment_delete', 'reseller', params.id, { paymentId: params.paymentId })
  }),
  route('POST',  '/resellers/:id/returns', 'fc:write', async ({ user, params, body }) => {
    const r = await resellers.recordReturns(params.id, body, user)
    await auth.audit(user, 'reseller.returns', 'reseller', params.id, body)
    return r
  }),
  route('GET',   '/consignments', 'fc:read', ({ user, query }) => db.getConsignments(user, { resellerId: query.resellerId })),
  route('POST',  '/consignments', 'fc:write', async ({ user, body }) => {
    const result = await db.createConsignment(body, user)
    await auth.audit(user, 'consignment.create', 'consignment', result.id, body)
    // New designs that will need a code once the reseller approves the shipment (nothing assigned yet)
    try { result.needCodes = await resellers.codesNeededForHandover(result.id) }
    catch (err) { console.error('codes after handover', result.id, err); result.needCodes = [] }
    return result
  }),
  route('PATCH', '/consignment-items/:id', 'fc:write', async ({ user, params, body }) => {
    const piece = await db.updateConsignmentItem(params.id, body, user)
    await auth.audit(user, 'piece.update', 'piece', params.id, body)
    return piece
  }),

  // ── Studio inventory ──────────────────────────────────────
  route('GET',    '/inventory', 'inventory:read', () => inventory.overview()),
  route('GET',    '/inventory/available', 'fc:write', () => inventory.availableStock()),
  route('GET',    '/inventory/for-order', 'orders:write', ({ query }) => inventory.piecesForOrder(query)),
  route('GET',    '/inventory/pieces', 'inventory:read', ({ query }) => inventory.listPieces(query)),
  route('POST',   '/inventory/pieces', 'inventory:write', async ({ user, body }) => {
    const r = await inventory.addPieces(body, user)
    await auth.audit(user, 'stock.add', 'product', body.productId, { ...body, created: r.created })
    return r
  }),
  route('POST',   '/inventory/pieces/bulk', 'inventory:write', async ({ user, body }) => {
    const r = await inventory.addPiecesBulk(body, user)
    await auth.audit(user, 'stock.add_bulk', 'stock', null, { created: r.created, outfits: r.outfits, status: body.status })
    return r
  }),
  route('POST',   '/inventory/pieces/damage', 'inventory:write', async ({ user, body }) => {
    const r = await inventory.markDamaged(body, user)
    await auth.audit(user, 'stock.damage', 'stock', null, body)
    return r
  }),
  route('POST',   '/inventory/pieces/move', 'inventory:write', async ({ user, body }) => {
    const r = await inventory.movePieces(body, user)
    await auth.audit(user, 'stock.move', 'stock_piece', null, { ...body, moved: r.moved })
    return r
  }),
  route('PATCH',  '/inventory/pieces/:id', 'inventory:write', async ({ user, params, body }) => {
    const piece = await inventory.updatePiece(params.id, body, user)
    await auth.audit(user, 'stock.update', 'stock_piece', params.id, body)
    return piece
  }),
  route('GET',    '/inventory/pieces/:id/history', 'inventory:read', ({ params }) => inventory.pieceHistory(params.id)),
  route('DELETE', '/inventory/pieces/:id', 'inventory:write', async ({ user, params }) => {
    const piece = await inventory.deletePiece(params.id)
    await auth.audit(user, 'stock.delete', 'stock_piece', params.id, { product: piece.product, size: piece.size, kind: piece.kind })
  }),

  // ── Staff accounts (owner) ────────────────────────────────
  route('GET',   '/users', 'users:manage', () => auth.listUsers()),
  route('POST',  '/users', 'users:manage', async ({ user, body }) => {
    const created = await auth.createUser(body)
    await auth.audit(user, 'user.create', 'user', created.id, body)
    return created
  }),
  route('PATCH', '/users/:id', 'users:manage', async ({ user, params, body }) => {
    const updated = await auth.updateUser(params.id, body, user)
    await auth.audit(user, 'user.update', 'user', params.id, body)
    return updated
  }),
]

const CLIENT_ERRORS = ['23514', '23505', '23503', '22P02']

export async function handleApi(req, res) {
  const url = new URL(req.url, 'http://local')
  const path = url.pathname.replace(/^\/api/, '') || '/'
  const send = (status, data) => (data === undefined ? res.status(status).end() : res.status(status).json(data))
  res.setHeader('Cache-Control', 'no-store')

  let match, params
  const sameVerb = []
  for (const r of ROUTES) {
    const m = r.pattern.exec(path)
    if (!m) continue
    if (r.method !== req.method) { sameVerb.push(r.method); continue }
    match = r
    params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]))
    break
  }
  if (!match) return sameVerb.length ? send(405, { error: 'Method not allowed' }) : send(404, { error: 'Not found' })

  // Cross-site form posts can't send JSON, so requiring it blocks CSRF on cookie-authenticated writes
  if (req.method !== 'GET' && !(req.headers['content-type'] || '').includes('application/json'))
    return send(415, { error: 'Content-Type must be application/json' })

  try {
    let user = null
    if (match.permission !== 'public') {
      user = await auth.userFromToken(auth.readCookie(req))
      if (!user) return send(401, { error: 'Please log in' })
      if (match.permission !== 'login' && !auth.can(user, match.permission))
        return send(403, { error: "You don't have access to this" })
    }
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const query = Object.fromEntries(url.searchParams)
    const result = await match.fn({ req, res, user, params, body, query })
    return send(result === undefined ? 204 : req.method === 'POST' && !path.startsWith('/auth') ? 201 : 200, result)
  } catch (err) {
    if (err.code === '23514' && /discounts_within_price/.test(err.message)) err.message = 'Discounts cannot be more than the price'
    const status = err.status || (CLIENT_ERRORS.includes(err.code) ? 400 : 500)
    if (status >= 500) console.error(`[api ${req.method} ${path}]`, err)
    // Messages we raise on purpose (HttpError) are safe to show, even for 5xx like "Shopify refused the connection"
    const expose = status < 500 || err instanceof db.HttpError
    return send(status, { error: expose ? err.message : 'Something went wrong on the server' })
  }
}
