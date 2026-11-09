// Single serverless function for the whole API (vercel.json rewrites /api/* here; req.url keeps
// the original path) — routes live in lib/router.js.
import { handleApi } from '../lib/router.js'

export default handleApi
