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
      const status = err.status || 500
      if (status >= 500) console.error(`[${label}]`, err)
      return res.status(status).json({ error: err.message })
    }
  }
}
