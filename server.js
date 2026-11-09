// Local development API server (Express v4).
// Mounts the same handlers Vercel runs from api/, so dev and production behave identically.
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import orders from './api/orders.js'
import orderById from './api/orders/[id].js'
import products from './api/products.js'
import customers from './api/customers.js'
import consignments from './api/consignments.js'
import consignmentItemById from './api/consignment-items/[id].js'

const app = express()
app.use(cors())
app.use(express.json())

// Vercel passes dynamic route segments in req.query
const withParams = (handler) => (req, res) => {
  Object.defineProperty(req, 'query', { value: { ...req.query, ...req.params }, configurable: true })
  return handler(req, res)
}

app.all('/api/orders', orders)
app.all('/api/orders/:id', withParams(orderById))
app.all('/api/products', products)
app.all('/api/customers', customers)
app.all('/api/consignments', consignments)
app.all('/api/consignment-items/:id', withParams(consignmentItemById))

const PORT = process.env.API_PORT || 3002
app.listen(PORT, () => {
  console.log(`[koko-api] running on http://localhost:${PORT}`)
})
