// Shared request handling for the Vercel functions in api/ (also mounted by server.js).
// Usage: export default handle({ GET: (req) => ..., POST: (req) => ... })
export function handle(methods, { label = 'api' } = {}) {
  const allow = [...Object.keys(methods), 'OPTIONS'].join(', ')
  return async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', allow)
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') return res.status(200).end()

    const fn = methods[req.method]
    if (!fn) return res.status(405).json({ error: 'Method not allowed' })
    try {
      const result = await fn(req)
      if (result === undefined) return res.status(204).end()
      return res.status(req.method === 'POST' ? 201 : 200).json(result)
    } catch (err) {
      // Postgres check / unique / foreign-key / bad-input violations are the caller's mistake
      const clientError = ['23514', '23505', '23503', '22P02'].includes(err.code)
      if (err.code === '23514' && /discounts_within_price/.test(err.message))
        err.message = 'Discounts cannot be more than the price'
      const status = err.status || (clientError ? 400 : 500)
      if (status >= 500) console.error(`[${label}]`, err)
      return res.status(status).json({ error: err.message })
    }
  }
}
