import { handle } from '../lib/http.js'
import { listOrders, createOrder } from '../lib/db.js'

export default handle({
  GET:  () => listOrders(),
  POST: (req) => createOrder(req.body || {}),
}, { label: 'api/orders' })
