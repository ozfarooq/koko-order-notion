// All API routes, served by a single Vercel function (api/[...route].js) and by server.js in dev.
// Each route declares the permission it needs; requests without a valid session get 401,
// and logged-in users without the permission get 403.
import * as db from './db.js'
import * as auth from './auth.js'

const route = (method, path, permission, fn) => {
  const keys = []
  const pattern = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)' }) + '/?$')
  return { method, pattern, keys, permission, fn }
}

const ROUTES = [
  // ── Public ────────────────────────────────────────────────
  route('GET',  '/board', 'public', () => db.listBoard()),
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
  route('GET',    '/orders/:id', 'orders:read', ({ params }) => db.getOrder(params.id)),
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
  route('GET', '/customers', 'customers:read', ({ query }) => db.listCustomers(query.q || '')),
  route('GET', '/products', 'products:read', () => db.listProducts()),

  // ── B2B consignment ───────────────────────────────────────
  route('GET',   '/consignments', 'fc:read', ({ user }) => db.getConsignments(user)),
  route('POST',  '/consignments', 'fc:write', async ({ user, body }) => {
    const result = await db.createConsignment(body, user)
    await auth.audit(user, 'consignment.create', 'consignment', result.id, body)
    return result
  }),
  route('PATCH', '/consignment-items/:id', 'fc:write', async ({ user, params, body }) => {
    const piece = await db.updateConsignmentItem(params.id, body, user)
    await auth.audit(user, 'piece.update', 'piece', params.id, body)
    return piece
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
  route('GET', '/resellers', 'users:manage', () => db.getConsignments({ role: 'owner' }).then((d) => d.resellers)),
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
    return send(status, { error: status >= 500 ? 'Something went wrong on the server' : err.message })
  }
}
