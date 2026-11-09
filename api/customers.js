import { handle } from '../lib/http.js'
import { listCustomers } from '../lib/db.js'

export default handle({
  GET: (req) => listCustomers(req.query.q || ''),
}, { label: 'api/customers' })
