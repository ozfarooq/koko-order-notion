import * as notion from '../../lib/notion.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const { id } = req.query

  try {
    if (req.method === 'GET') {
      const order = await notion.getOrderById(id)
      return res.json(order)
    }
    if (req.method === 'PATCH') {
      const order = await notion.updateOrder(id, req.body)
      return res.json(order)
    }
    if (req.method === 'DELETE') {
      await notion.deleteOrder(id)
      return res.status(204).end()
    }
    res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    console.error(`[api/orders/${id}]`, err)
    res.status(500).json({ error: err.message })
  }
}
