// Create a login from the command line (the Users screen does the same for the owner in the app).
// Usage: node scripts/create-user.js --username omer --password ... --name "Omer Farooq" --role owner
//          [--email x@y.com] [--phone +92...] [--reseller "Fashion Collage Dubai"]
import 'dotenv/config'
import { neon } from '@neondatabase/serverless'
import { createUser } from '../lib/auth.js'

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined }
const sql = neon(process.env.DATABASE_URL)

let resellerId
if (arg('reseller')) {
  const [r] = await sql`SELECT id FROM resellers WHERE lower(name) = lower(${arg('reseller')})`
  if (!r) { console.error(`No reseller named "${arg('reseller')}"`); process.exit(1) }
  resellerId = r.id
}

try {
  const user = await createUser({
    username: arg('username'), password: arg('password'), name: arg('name'), role: arg('role'),
    email: arg('email'), phone: arg('phone'), resellerId,
  })
  console.log(`Created ${user.role} "${user.username}" (${user.name})${user.resellerName ? ` for ${user.resellerName}` : ''}`)
} catch (err) {
  console.error(err.message)
  process.exit(1)
}
