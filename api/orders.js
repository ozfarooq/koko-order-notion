import * as notion from '../lib/notion.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    if (req.method === 'GET') {
      const orders = await notion.getAllOrders()
      return res.json(orders)
    }
    if (req.method === 'POST') {
      const order = await notion.createOrder(req.body)
      return res.status(201).json(order)
    }
    res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    console.error('[api/orders]', err)
    res.status(500).json({ error: err.message })
  }
}
