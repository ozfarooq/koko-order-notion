// Accounts, sessions and permissions.
// Passwords: scrypt with a per-user salt. Sessions: random token in an httpOnly cookie; only its
// SHA-256 hash is stored. Permissions: fixed per role (see PERMISSIONS).
import { neon } from '@neondatabase/serverless'
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'crypto'
import { promisify } from 'util'

const scrypt = promisify(scryptCb)
let _sql
const sql = (...args) => (_sql ??= neon(process.env.DATABASE_URL))(...args)

export const COOKIE = 'koko_session'
const SESSION_DAYS = 14            // sliding: extended on use
const MAX_FAILED = 5               // wrong passwords before a temporary lock
const LOCK_MINUTES = 15

// ── Roles ──────────────────────────────────────────────────────────────
export const ROLES = ['owner', 'manager', 'staff', 'reseller']
export const PERMISSIONS = {
  owner:    ['*'],
  manager:  ['orders:read', 'orders:write', 'orders:delete', 'customers:read', 'products:read',
             'fc:read', 'fc:money', 'fc:write', 'dashboard:money'],
  staff:    ['orders:read', 'orders:write', 'customers:read', 'products:read', 'fc:read'],
  // Read-only view of their own consignment stock (scoped to users.reseller_id in the queries)
  reseller: ['fc:read', 'fc:money'],
}
export const can = (user, permission) =>
  !!user && (PERMISSIONS[user.role] || []).some((p) => p === '*' || p === permission)

// ── Passwords ──────────────────────────────────────────────────────────
export async function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = await scrypt(password, salt, 64)
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

async function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = (stored || '').split('$')
  if (scheme !== 'scrypt') return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length)
  return timingSafeEqual(actual, expected)
}

// ── Sessions ───────────────────────────────────────────────────────────
const tokenHash = (token) => createHash('sha256').update(token).digest('hex')

export function publicUser(u) {
  return {
    id: u.id, username: u.username, name: u.name, email: u.email || '', phone: u.phone || '',
    role: u.role, resellerId: u.reseller_id ?? null, resellerName: u.reseller_name ?? null,
    isActive: u.is_active, lastLoginAt: u.last_login_at ?? null,
    permissions: PERMISSIONS[u.role] || [],
  }
}

export class AuthError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

export async function login(username, password) {
  const [u] = await sql`SELECT * FROM users WHERE lower(username) = lower(${(username || '').trim()})`
  // Same message for unknown user and wrong password, so usernames can't be probed
  const fail = new AuthError(401, 'Incorrect username or password')
  if (!u || !u.is_active) { await verifyPassword(password || '', 'scrypt$00$00'); throw fail }
  if (u.locked_until && new Date(u.locked_until) > new Date())
    throw new AuthError(429, `Too many attempts. Try again after ${new Date(u.locked_until).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}`)

  if (!(await verifyPassword(password || '', u.password_hash))) {
    await sql`
      UPDATE users SET failed_logins = failed_logins + 1,
        locked_until = CASE WHEN failed_logins + 1 >= ${MAX_FAILED} THEN now() + make_interval(mins => ${LOCK_MINUTES}) END
      WHERE id = ${u.id}`
    throw fail
  }

  const token = randomBytes(32).toString('base64url')
  await sql`UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = ${u.id}`
  await sql`
    INSERT INTO sessions (token_hash, user_id, expires_at)
    VALUES (${tokenHash(token)}, ${u.id}, now() + make_interval(days => ${SESSION_DAYS}))`
  await sql`DELETE FROM sessions WHERE expires_at < now()`   // housekeeping
  return { token, user: await getUser(u.id) }
}

export async function logout(token) {
  if (token) await sql`DELETE FROM sessions WHERE token_hash = ${tokenHash(token)}`
}

// Returns the logged-in user for a session token, or null. Extends the session at most hourly.
export async function userFromToken(token) {
  if (!token) return null
  const [row] = await sql`
    SELECT u.*, r.name AS reseller_name, s.last_seen_at
    FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN resellers r ON r.id = u.reseller_id
    WHERE s.token_hash = ${tokenHash(token)} AND s.expires_at > now() AND u.is_active`
  if (!row) return null
  if (Date.now() - new Date(row.last_seen_at).getTime() > 3600_000)
    await sql`UPDATE sessions SET last_seen_at = now(), expires_at = now() + make_interval(days => ${SESSION_DAYS})
              WHERE token_hash = ${tokenHash(token)}`
  return publicUser(row)
}

export async function getUser(id) {
  const [u] = await sql`SELECT u.*, r.name AS reseller_name FROM users u LEFT JOIN resellers r ON r.id = u.reseller_id WHERE u.id = ${id}`
  if (!u) throw new AuthError(404, 'User not found')
  return publicUser(u)
}

// ── Cookies ────────────────────────────────────────────────────────────
export function readCookie(req, name = COOKIE) {
  const header = req.headers?.cookie || ''
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return null
}

export function sessionCookie(req, token) {
  const secure = (req.headers?.['x-forwarded-proto'] || '').includes('https') ? '; Secure' : ''
  return token
    ? `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`
    : `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
}

// ── User management (owner) ────────────────────────────────────────────
export async function listUsers() {
  const rows = await sql`SELECT u.*, r.name AS reseller_name FROM users u LEFT JOIN resellers r ON r.id = u.reseller_id ORDER BY u.is_active DESC, u.role, u.name`
  return rows.map(publicUser)
}

function validateUserFields({ role, resellerId }) {
  if (role !== undefined && !ROLES.includes(role)) throw new AuthError(400, `Role must be one of: ${ROLES.join(', ')}`)
  if (role === 'reseller' && !resellerId) throw new AuthError(400, 'Choose which reseller this login belongs to')
}

export async function createUser({ username, name, email, phone, role, resellerId, password }) {
  if (!username?.trim() || !name?.trim()) throw new AuthError(400, 'Username and name are required')
  if (!password || password.length < 4) throw new AuthError(400, 'Password must be at least 4 characters')
  validateUserFields({ role, resellerId })
  const [exists] = await sql`SELECT 1 FROM users WHERE lower(username) = lower(${username.trim()})`
  if (exists) throw new AuthError(400, `Username "${username.trim()}" is already taken`)
  const [u] = await sql`
    INSERT INTO users (username, name, email, phone, role, reseller_id, password_hash)
    VALUES (${username.trim()}, ${name.trim()}, ${email?.trim() || null}, ${phone?.trim() || null}, ${role},
            ${role === 'reseller' ? resellerId : null}, ${await hashPassword(password)})
    RETURNING id`
  return getUser(u.id)
}

export async function updateUser(id, body, actingUser) {
  const target = await getUser(id)
  const role = body.role ?? target.role
  validateUserFields({ role, resellerId: body.resellerId ?? target.resellerId })
  // Never lock the business out of its own app
  if (target.role === 'owner' && (role !== 'owner' || body.isActive === false)) {
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM users WHERE role = 'owner' AND is_active AND id <> ${id}`
    if (n === 0) throw new AuthError(400, 'There must always be at least one active owner')
  }
  if (Number(id) === actingUser.id && body.isActive === false) throw new AuthError(400, "You can't deactivate your own account")

  await sql`
    UPDATE users SET
      name        = COALESCE(${body.name?.trim() || null}, name),
      email       = CASE WHEN ${body.email !== undefined} THEN ${body.email?.trim() || null} ELSE email END,
      phone       = CASE WHEN ${body.phone !== undefined} THEN ${body.phone?.trim() || null} ELSE phone END,
      role        = ${role},
      reseller_id = ${role === 'reseller' ? (body.resellerId ?? target.resellerId) : null},
      is_active   = COALESCE(${body.isActive ?? null}, is_active),
      failed_logins = CASE WHEN ${body.unlock === true} THEN 0 ELSE failed_logins END,
      locked_until  = CASE WHEN ${body.unlock === true} THEN NULL ELSE locked_until END
    WHERE id = ${id}`
  if (body.password) {
    if (body.password.length < 4) throw new AuthError(400, 'Password must be at least 4 characters')
    await sql`UPDATE users SET password_hash = ${await hashPassword(body.password)} WHERE id = ${id}`
  }
  // Deactivated or demoted users are logged out everywhere
  if (body.isActive === false || body.role !== undefined || body.password)
    await sql`DELETE FROM sessions WHERE user_id = ${id} AND ${Number(id) !== actingUser.id}`
  return getUser(id)
}

export async function changeOwnPassword(user, currentPassword, newPassword) {
  const [u] = await sql`SELECT password_hash FROM users WHERE id = ${user.id}`
  if (!(await verifyPassword(currentPassword || '', u.password_hash))) throw new AuthError(400, 'Current password is incorrect')
  if (!newPassword || newPassword.length < 4) throw new AuthError(400, 'New password must be at least 4 characters')
  await sql`UPDATE users SET password_hash = ${await hashPassword(newPassword)} WHERE id = ${user.id}`
}

// ── Audit ──────────────────────────────────────────────────────────────
export async function audit(user, action, entity, entityId, changes) {
  const clean = changes && typeof changes === 'object'
    ? Object.fromEntries(Object.entries(changes).filter(([k]) => !/password/i.test(k)))
    : changes ?? null
  await sql`
    INSERT INTO audit_log (user_id, action, entity, entity_id, changes)
    VALUES (${user?.id ?? null}, ${action}, ${entity ?? null}, ${entityId == null ? null : String(entityId)},
            ${clean == null ? null : JSON.stringify(clean)})`
}
