import { handle } from '../../lib/http.js'
import { getOrder, updateOrder, deleteOrder } from '../../lib/db.js'

export default handle({
  GET:    (req) => getOrder(req.query.id),
  PATCH:  (req) => updateOrder(req.query.id, req.body || {}),
  DELETE: (req) => deleteOrder(req.query.id),
}, { label: 'api/orders/[id]' })
