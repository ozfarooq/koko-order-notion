import { handle } from '../lib/http.js'
import { listProducts } from '../lib/db.js'

export default handle({
  GET: () => listProducts(),
}, { label: 'api/products' })
