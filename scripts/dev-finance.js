// Runs the app (API + Vite) against the finance development database with the Finance menu on.
// Live data is never touched: DATABASE_URL is replaced by FINANCE_DEV_DATABASE_URL for this run.
// Usage: npm run dev:finance      (first time: node scripts/finance-dev-db.js --copy-owner, to sign in)
import 'dotenv/config'
import { spawn } from 'child_process'

const dev = process.env.FINANCE_DEV_DATABASE_URL
if (!dev || new URL(dev).pathname !== '/koko_finance_dev') { console.error('FINANCE_DEV_DATABASE_URL must point at koko_finance_dev'); process.exit(1) }
const env = { ...process.env, DATABASE_URL: dev, DATABASE_URL_UNPOOLED: process.env.FINANCE_DEV_DATABASE_URL_UNPOOLED || dev, VITE_FINANCE: '1' }
console.log('Finance development: API + Vite on koko_finance_dev (live data untouched)')
spawn('npx concurrently "node server.js" "vite"', { stdio: 'inherit', shell: true, env }).on('exit', (code) => process.exit(code ?? 0))
