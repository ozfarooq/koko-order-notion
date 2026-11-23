// Copies the live business data (orders, customers, catalogue, resellers, stock, payments) into the
// finance development database, so posting rules and the backfill can be tried on real data (spec v1.6 C2).
// Live is only read. On koko_finance_dev it first clears the finance journals (finance-reset) and the
// business tables, keeps dev users, and leaves user references (created_by…) empty.
// Usage: node scripts/finance-copy-live.js
import 'dotenv/config'
import { execSync } from 'child_process'
import { Pool, neonConfig, neon } from '@neondatabase/serverless'

neonConfig.webSocketConstructor = globalThis.WebSocket
const liveUrl = process.env.DATABASE_URL
const devUrl = process.env.FINANCE_DEV_DATABASE_URL_UNPOOLED || process.env.FINANCE_DEV_DATABASE_URL
if (new URL(liveUrl).pathname !== '/neondb') throw new Error('DATABASE_URL should be the live database (neondb)')
if (new URL(devUrl).pathname !== '/koko_finance_dev') throw new Error('FINANCE_DEV_DATABASE_URL must point at koko_finance_dev')

// Parents first. Only rows of these tables are copied; audit_log only for orders (paid dates come from it).
const TABLES = ['collections', 'products', 'customers', 'orders', 'order_items', 'resellers', 'reseller_products', 'consignments',
  'reseller_payments', 'reseller_payment_files', 'consignment_items', 'stock_pieces', 'stock_movements', 'customer_payments', 'audit_log']
const USER_COLS = ['created_by', 'updated_by', 'user_id']

const live = neon(liveUrl)
console.log('1/3 Clearing the finance journals on koko_finance_dev')
execSync('node scripts/finance-reset.js --confirm', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: process.env.FINANCE_DEV_DATABASE_URL, DATABASE_URL_UNPOOLED: devUrl } })

const pool = new Pool({ connectionString: devUrl })
const c = await pool.connect()
try {
  const devTables = new Set((await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`)).rows.map((r) => r.table_name))
  const liveTables = new Set((await live`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`).map((r) => r.table_name))
  const tables = TABLES.filter((t) => devTables.has(t) && liveTables.has(t))
  await c.query('BEGIN')
  for (const t of tables) await c.query(`ALTER TABLE ${t} DISABLE TRIGGER USER`)
  console.log('2/3 Clearing the business tables on koko_finance_dev')
  await c.query(`DELETE FROM audit_log WHERE entity = 'order'`)
  await c.query('UPDATE users SET reseller_id = NULL')
  for (const t of [...tables].reverse()) if (t !== 'audit_log') await c.query(`DELETE FROM ${t}`)
  console.log('3/3 Copying from live')
  for (const t of tables) {
    // Columns both databases have, minus generated ones
    const cols = (await c.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND is_generated = 'NEVER'`, [t])).rows.map((r) => r.column_name)
    const liveCols = new Set((await live`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${t}`).map((r) => r.column_name))
    const use = cols.filter((x) => liveCols.has(x))
    // JSON built by Postgres, so dates stay dates (no time-zone shift in JavaScript)
    const rows = (await live.query(`SELECT row_to_json(x) AS r FROM (SELECT ${use.join(', ')} FROM ${t}${t === 'audit_log' ? ` WHERE entity = 'order'` : ''}) x`)).map((x) => x.r)
    for (const r of rows) for (const u of USER_COLS) if (u in r) r[u] = null
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200)
      await c.query(`INSERT INTO ${t} (${use.join(', ')}) SELECT ${use.join(', ')} FROM json_populate_recordset(null::${t}, $1)`, [JSON.stringify(chunk)])
    }
    console.log(`  ${t.padEnd(22)} ${rows.length}`)
  }
  for (const t of tables) await c.query(`ALTER TABLE ${t} ENABLE TRIGGER USER`)
  // Sequences follow the copied ids
  const seqs = (await c.query(`SELECT c.relname AS seq, t.relname AS tbl, a.attname AS col FROM pg_class c JOIN pg_depend d ON d.objid = c.oid
    JOIN pg_class t ON t.oid = d.refobjid JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid WHERE c.relkind = 'S'`)).rows
  for (const s of seqs.filter((x) => tables.includes(x.tbl))) await c.query(`SELECT setval('${s.seq}', greatest((SELECT max(${s.col}) FROM ${s.tbl}), 1))`)
  const [{ n }] = await live`SELECT last_value AS n FROM order_number_seq`
  await c.query(`SELECT setval('order_number_seq', $1)`, [n])
  await c.query('COMMIT')
  console.log('Done: koko_finance_dev has a copy of the live business data. Live was only read.')
} catch (err) { await c.query('ROLLBACK').catch(() => {}); console.error(err.message); process.exitCode = 1 }
finally { c.release(); await pool.end() }
