// Clears the finance JOURNALS for a fresh start before real go-live (e.g. after testing on live).
// Removes: journal entries and lines, their attachments links, entry numbering, finance files, FX rates,
// and what posted them: expenses, studio claims, payroll weeks, payments to staff and the receipt inbox.
// Keeps: chart of accounts, periods (reopened), finance settings, staff and salaries, suppliers, recurring
// bill set-up, sticker-note words, and everything outside finance:
// orders, customers, products, inventory, resellers, payments and users are never touched.
// Usage: node scripts/finance-reset.js            (shows what would be removed)
//        node scripts/finance-reset.js --confirm  (removes it)
import 'dotenv/config'
import { Pool, neonConfig } from '@neondatabase/serverless'

neonConfig.webSocketConstructor = globalThis.WebSocket
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
const pool = new Pool({ connectionString: url })
const c = await pool.connect()
try {
  const count = async (t) => (await c.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n
  const tables = ['fin_entries', 'fin_lines', 'fin_entry_files', 'fin_files', 'fin_sequences', 'fin_fx_rates',
    'fin_expenses', 'fin_claims', 'fin_payroll_runs', 'fin_staff_payments', 'fin_intake_items']
  console.log(`Database: ${new URL(url).pathname.slice(1)}`)
  for (const t of tables) console.log(`  ${t.padEnd(18)} ${await count(t)} rows`)
  if (!process.argv.includes('--confirm')) { console.log('\nNothing removed. Run again with --confirm to clear these finance tables.'); process.exit(0) }
  await c.query('BEGIN')
  // TRUNCATE bypasses the per-row "posted entries are permanent" rules on purpose: this is the one reset
  await c.query(`TRUNCATE fin_intake_items, fin_staff_payment_files, fin_staff_payment_parts, fin_staff_payments, fin_payroll_files, fin_payroll_hours,
    fin_payroll_income, fin_payroll_lines, fin_payroll_runs, fin_claim_files, fin_claim_lines, fin_claims, fin_expense_files, fin_expenses,
    fin_entry_files, fin_lines, fin_entries, fin_file_blobs, fin_files, fin_sequences, fin_fx_rates RESTART IDENTITY`)
  await c.query('UPDATE fin_recurring SET last_generated_month = NULL')
  await c.query(`UPDATE fin_periods SET status = 'Open', closed_by = NULL, closed_at = NULL`)
  await c.query(`INSERT INTO audit_log (action, entity, changes) VALUES ('finance.reset', 'finance', '{"reason": "scripts/finance-reset.js"}')`)
  await c.query('COMMIT')
  console.log('\nFinance journals cleared. Accounts, periods and settings kept; nothing outside finance was touched.')
} catch (err) { await c.query('ROLLBACK').catch(() => {}); console.error(err.message); process.exitCode = 1 }
finally { c.release(); await pool.end() }
