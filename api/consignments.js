import { handle } from '../lib/http.js'
import { getConsignments, createConsignment } from '../lib/db.js'

export default handle({
  GET:  () => getConsignments(),
  POST: (req) => createConsignment(req.body || {}),
}, { label: 'api/consignments' })
