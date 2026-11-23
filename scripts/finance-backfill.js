// Posts every sale, customer payment and reseller statement / payment since the finance go-live date
// (Finance settings), and corrects any entry that no longer matches the CRM. Safe to re-run: anything
// already posted and unchanged is left alone, so a second run creates no new entries.
// Usage: node scripts/finance-backfill.js           (the database in DATABASE_URL)
//        node scripts/finance-backfill.js --dev     (koko_finance_dev)
import 'dotenv/config'

if (process.argv.includes('--dev')) {
  process.env.DATABASE_URL = process.env.FINANCE_DEV_DATABASE_URL
  if (new URL(process.env.DATABASE_URL).pathname !== '/koko_finance_dev') throw new Error('FINANCE_DEV_DATABASE_URL must point at koko_finance_dev')
}
const { neon } = await import('@neondatabase/serverless')
const sales = await import('../lib/finance/sales.js')
const { getSettings } = await import('../lib/finance/ledger.js')
const sql = neon(process.env.DATABASE_URL)

const count = async () => (await sql`SELECT count(*)::int AS n FROM fin_entries`)[0].n
console.log(`Database: ${new URL(process.env.DATABASE_URL).pathname.slice(1)} · go-live ${(await getSettings()).goLiveDate}`)
const before = await count()
const t0 = Date.now()
let after = '', done = 0
const failed = []
for (;;) {
  const r = await sales.syncBatch({ after, limit: 60 }, null)
  done += r.done; failed.push(...r.failed)
  process.stdout.write('.')
  if (!r.next) break
  after = r.next
}
console.log(`\nChecked ${done} orders and resellers in ${((Date.now() - t0) / 1000).toFixed(0)} s; entries ${before} -> ${await count()}`)
for (const f of failed) console.log(`  waiting: ${f.label}: ${f.error}`)
if (failed.length) console.log('Fix these (e.g. add the missing exchange rates) and run again, or retry from Finance › Sales & receipts.')
