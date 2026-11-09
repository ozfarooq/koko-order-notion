// Local development API server (Express v4).
// Runs the same router Vercel runs from api/index.js, so dev and production behave identically.
import 'dotenv/config'
import express from 'express'
import { handleApi } from './lib/router.js'

const app = express()
app.use(express.json())
app.use('/api', (req, res) => {
  req.url = req.originalUrl   // the router expects the full /api/... path, as on Vercel
  return handleApi(req, res)
})

const PORT = process.env.API_PORT || 3002
app.listen(PORT, () => {
  console.log(`[koko-api] running on http://localhost:${PORT}`)
})
