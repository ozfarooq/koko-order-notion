import { handle } from '../../lib/http.js'
import { updateConsignmentItem } from '../../lib/db.js'

export default handle({
  PATCH: (req) => updateConsignmentItem(req.query.id, req.body || {}),
}, { label: 'api/consignment-items/[id]' })
