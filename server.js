// Local development API server — mirrors the Vercel serverless functions
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import * as notion from './lib/notion.js'

const app = express()
app.use(cors())
app.use(express.json())

app.get('/api/orders', async (req, res) => {
  try { res.json(await notion.getAllOrders()) }
  catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/orders', async (req, res) => {
  try { res.status(201).json(await notion.createOrder(req.body)) }
  catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/orders/:id', async (req, res) => {
  try { res.json(await notion.getOrderById(req.params.id)) }
  catch (err) { res.status(500).json({ error: err.message }) }
})

app.patch('/api/orders/:id', async (req, res) => {
  try { res.json(await notion.updateOrder(req.params.id, req.body)) }
  catch (err) { res.status(500).json({ error: err.message }) }
})

app.delete('/api/orders/:id', async (req, res) => {
  try { await notion.deleteOrder(req.params.id); res.status(204).end() }
  catch (err) { res.status(500).json({ error: err.message }) }
})

const PORT = 3001
app.listen(PORT, () => console.log(`[koko-api] running on http://localhost:${PORT}`))
