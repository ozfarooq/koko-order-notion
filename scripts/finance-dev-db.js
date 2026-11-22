// Builds the finance development database (koko_finance_dev): the baseline schema plus every
// migration, with no live data. Finance tests post permanent journals, so they never run on neondb.
// db/schema.sql already contains some later changes (e.g. 005-007 columns), so each migration runs
// statement by statement and a statement whose object already exists is skipped; anything else fails.
// Usage: node scripts/finance-dev-db.js            (create structure if empty, then apply pending migrations)
//        node scripts/finance-dev-db.js --status   (list applied / pending)
//        node scripts/finance-dev-db.js --copy-owner (copy the owner login from live, to sign in to npm run dev:finance)
import 'dotenv/config'
import fs from 'fs'
import { Pool, neonConfig } from '@neondatabase/serverless'

neonConfig.webSocketConstructor = globalThis.WebSocket
const url = process.env.FINANCE_DEV_DATABASE_URL_UNPOOLED || process.env.FINANCE_DEV_DATABASE_URL
if (!url || new URL(url).pathname !== '/koko_finance_dev') {
  console.error('FINANCE_DEV_DATABASE_URL must point at the koko_finance_dev database'); process.exit(1)
}
const dir = new URL('../db/migrations/', import.meta.url)
const migrations = () => fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
const ALREADY_EXISTS = new Set(['42701', '42P07', '42710', '42P06', '42723'])   // duplicate column / table / object / schema / function

// Split SQL into statements, keeping $$-quoted bodies, strings and comments intact
function statements(sql) {
  const out = []
  let cur = '', i = 0, dollar = null
  while (i < sql.length) {
    const ch = sql[i], rest = sql.slice(i)
    if (dollar) { if (rest.startsWith(dollar)) { cur += dollar; i += dollar.length; dollar = null } else { cur += ch; i++ } continue }
    if (rest.startsWith('--')) { const end = sql.indexOf('\n', i); const stop = end < 0 ? sql.length : end; cur += sql.slice(i, stop); i = stop; continue }
    const tag = rest.match(/^\$[A-Za-z_]*\$/)
    if (tag) { dollar = tag[0]; cur += dollar; i += dollar.length; continue }
    if (ch === "'") { const end = sql.indexOf("'", i + 1); cur += sql.slice(i, end + 1); i = end + 1; continue }
    if (ch === ';') { if (cur.replace(/--[^\n]*/g, '').trim()) out.push(cur.trim()); cur = ''; i++; continue }
    cur += ch; i++
  }
  if (cur.replace(/--[^\n]*/g, '').trim()) out.push(cur.trim())
  return out
}

const pool = new Pool({ connectionString: url })
const client = await pool.connect()
try {
  const empty = !(await client.query(`SELECT to_regclass('public.orders') AS t`)).rows[0].t
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
  const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name))
  if (process.argv.includes('--copy-owner')) {
    // So you can sign in to `npm run dev:finance` with your usual login. Only owner accounts are copied.
    const { neon } = await import('@neondatabase/serverless')
    const owners = await neon(process.env.DATABASE_URL)`SELECT row_to_json(u) AS u FROM users u WHERE role = 'owner' AND username = ${process.env.FINANCE_OWNER_USERNAME || 'omer'}`
    for (const { u } of owners) {
      // A fresh id (test users may already hold low ids); matched by username so re-running is safe
      const cols = Object.keys(u).filter((k) => k !== 'id')
      const r = await client.query(`INSERT INTO users (${cols.join(', ')}) SELECT ${cols.join(', ')} FROM json_populate_record(null::users, $1)
        WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(username) = lower($2)) RETURNING username`, [JSON.stringify(u), u.username])
      console.log(r.rowCount ? `owner login copied: ${u.username}` : `owner login already there: ${u.username}`)
    }
    await client.query(`SELECT setval(pg_get_serial_sequence('users', 'id'), GREATEST((SELECT max(id) FROM users), 1))`)
  } else if (process.argv.includes('--status')) {
    for (const f of migrations()) console.log(`${done.has(f) ? 'applied' : 'PENDING'}  ${f}`)
  } else {
    await client.query('BEGIN')
    if (empty) { await client.query(fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8')); console.log('baseline schema created') }
    for (const file of migrations().filter((f) => !done.has(f))) {
      let skipped = 0
      for (const [n, stmt] of statements(fs.readFileSync(new URL(file, dir), 'utf8')).entries()) {
        await client.query(`SAVEPOINT s${n}`)
        try { await client.query(stmt) } catch (err) {
          if (!ALREADY_EXISTS.has(err.code)) throw new Error(`${file}: ${err.message}`)
          await client.query(`ROLLBACK TO SAVEPOINT s${n}`); skipped++
        }
      }
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
      console.log(`applied ${file}${skipped ? ` (${skipped} statement${skipped === 1 ? '' : 's'} already in the baseline)` : ''}`)
    }
    await client.query('COMMIT')
    console.log('koko_finance_dev is up to date')
  }
} catch (err) { await client.query('ROLLBACK').catch(() => {}); console.error(err.message); process.exitCode = 1 }
finally { client.release(); await pool.end() }
