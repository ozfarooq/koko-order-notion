// Clears the finance JOURNALS for a fresh start before real go-live (e.g. after testing on live).
// Removes: journal entries and lines, their attachments links, entry numbering, finance files,
// and what posted them: expenses, studio claims, payroll weeks, payments to staff, the receipt inbox and
// postings waiting for a retry, month-end stock valuations. Customer payments are CRM records and stay (the
// backfill posts them again); imported bank statements stay, unmatched; cost cards, fabric lots and prices stay.
// Keeps: exchange rates, chart of accounts, periods (reopened), finance settings, staff and salaries, suppliers, recurring
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
  const tables = ['fin_entries', 'fin_lines', 'fin_entry_files', 'fin_files', 'fin_sequences',
    'fin_expenses', 'fin_claims', 'fin_payroll_runs', 'fin_staff_payments', 'fin_intake_items', 'fin_post_exceptions', 'fin_stock_valuations']
  console.log(`Database: ${new URL(url).pathname.slice(1)}`)
  for (const t of tables) console.log(`  ${t.padEnd(18)} ${await count(t)} rows`)
  if (!process.argv.includes('--confirm')) { console.log('\nNothing removed. Run again with --confirm to clear these finance tables.'); process.exit(0) }
  await c.query('BEGIN')
  // Things that point at the journals but are kept: imported bank lines go back to unmatched, fabric
  // purchases lose their payment link (the yards stay), bank statements lose their stored file
  await c.query(`UPDATE fin_bank_lines SET status = CASE WHEN status = 'Matched' THEN 'Unmatched' ELSE status END, entry_id = NULL, matched_by = NULL WHERE entry_id IS NOT NULL`)
  await c.query('UPDATE fin_fabric_moves SET expense_id = NULL WHERE expense_id IS NOT NULL')
  await c.query('UPDATE fin_bank_statements SET file_id = NULL WHERE file_id IS NOT NULL')
  // Tables nothing else points at are emptied with TRUNCATE
  await c.query(`TRUNCATE fin_stock_valuations, fin_intake_items, fin_staff_payment_files, fin_staff_payment_parts, fin_staff_payments, fin_payroll_files, fin_payroll_hours,
    fin_payroll_income, fin_payroll_lines, fin_payroll_runs, fin_claim_files, fin_claim_lines, fin_claims, fin_expense_files,
    fin_entry_files, fin_lines, fin_file_blobs, fin_sequences, fin_post_exceptions RESTART IDENTITY`)
  // Journals, expenses and files are pointed at by kept tables (bank lines, fabric purchases, statements),
  // so they are deleted row by row; the "posted entries are permanent" triggers are paused for this one reset
  await c.query('ALTER TABLE fin_entries DISABLE TRIGGER USER')
  await c.query('DELETE FROM fin_expenses')
  await c.query('DELETE FROM fin_entries')
  await c.query('DELETE FROM fin_files')
  await c.query('ALTER TABLE fin_entries ENABLE TRIGGER USER')
  for (const t of ['fin_entries', 'fin_expenses', 'fin_files']) await c.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), 1, false)`)
  await c.query('UPDATE fin_recurring SET last_generated_month = NULL')
  await c.query(`UPDATE fin_periods SET status = 'Open', closed_by = NULL, closed_at = NULL`)
  await c.query(`INSERT INTO audit_log (action, entity, changes) VALUES ('finance.reset', 'finance', '{"reason": "scripts/finance-reset.js"}')`)
  await c.query('COMMIT')
  console.log('\nFinance journals cleared. Accounts, periods and settings kept; nothing outside finance was touched.')
} catch (err) { await c.query('ROLLBACK').catch(() => {}); console.error(err.message); process.exitCode = 1 }
finally { c.release(); await pool.end() }
