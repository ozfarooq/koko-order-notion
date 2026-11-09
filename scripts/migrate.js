// Apply pending database migrations (db/migrations/*.sql) in filename order.
// db/schema.sql is the baseline; each migration runs once, in its own transaction,
// and is recorded in schema_migrations.
// Usage: node scripts/migrate.js            (apply pending)
//        node scripts/migrate.js --status   (list applied / pending)
import 'dotenv/config'
import fs from 'fs'
import { Pool, neonConfig } from '@neondatabase/serverless'

neonConfig.webSocketConstructor = globalThis.WebSocket
const dir = new URL('../db/migrations/', import.meta.url)
const allFiles = () => fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()

async function appliedSet(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
  return new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name))
}

// Runs pending migrations without managing transactions — for callers that already hold one
// (scripts/build-normalized.js applies them right after the baseline schema).
export async function applyPending(client, { log = console.log } = {}) {
  const applied = await appliedSet(client)
  for (const file of allFiles().filter((f) => !applied.has(f))) {
    await client.query(fs.readFileSync(new URL(file, dir), 'utf8'))
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
    log(`applied ${file}`)
  }
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL })
  const client = await pool.connect()
  try {
    const applied = await appliedSet(client)
    if (process.argv.includes('--status')) {
      for (const f of allFiles()) console.log(`${applied.has(f) ? 'applied' : 'PENDING'}  ${f}`)
      return
    }
    for (const file of allFiles().filter((f) => !applied.has(f))) {
      await client.query('BEGIN')
      try {
        await client.query(fs.readFileSync(new URL(file, dir), 'utf8'))
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
        await client.query('COMMIT')
        console.log(`applied ${file}`)
      } catch (err) {
        await client.query('ROLLBACK')
        throw new Error(`${file} failed, nothing from it was applied: ${err.message}`)
      }
    }
    console.log('Database is up to date.')
  } catch (err) {
    console.error(err.message)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/migrate.js')) await main()
