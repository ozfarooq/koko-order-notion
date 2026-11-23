// Finance API client (owner only). Amounts travel as strings like '1234.50'.
import { api } from './storage'

const query = (f) => new URLSearchParams(Object.entries(f).filter(([, v]) => v !== '' && v != null)).toString()
const body = (b) => ({ body: JSON.stringify(b) })

export const getFinanceSettings = () => api('/finance/settings')
export const updateFinanceSettings = (b) => api('/finance/settings', { method: 'PATCH', ...body(b) })

export const getAccounts = () => api('/finance/accounts')
export const createAccount = (b) => api('/finance/accounts', { method: 'POST', ...body(b) })
export const updateAccount = (id, b) => api(`/finance/accounts/${id}`, { method: 'PATCH', ...body(b) })

export const getPeriods = () => api('/finance/periods')
export const setPeriodStatus = (id, status, reason) => api(`/finance/periods/${id}/status`, { method: 'POST', ...body({ status, reason }) })
export const addFiscalYear = () => api('/finance/years', { method: 'POST' })

export const getEntries = (f = {}) => api(`/finance/entries?${query(f)}`)
export const getEntry = (id) => api(`/finance/entries/${id}`)
export const createEntry = (b) => api('/finance/entries', { method: 'POST', ...body(b) })
export const updateDraft = (id, b) => api(`/finance/entries/${id}`, { method: 'PATCH', ...body(b) })
export const deleteDraft = (id) => api(`/finance/entries/${id}`, { method: 'DELETE' })
export const postDraft = (id, overrideReason) => api(`/finance/entries/${id}/post`, { method: 'POST', ...body({ overrideReason }) })
export const reverseEntry = (id, b) => api(`/finance/entries/${id}/reverse`, { method: 'POST', ...body(b) })
export const attachEntryFile = (id, f) => api(`/finance/entries/${id}/files`, { method: 'POST', ...body(f) })

export const uploadFinanceFile = (f) => api('/finance/files', { method: 'POST', ...body(f) })
export const getFinanceFile = (id) => api(`/finance/files/${id}`)
export const getOpening = () => api('/finance/opening')
export const postOpening = (b) => api('/finance/opening', { method: 'POST', ...body(b) })

// Reads a chosen file as { name, mime, data: base64 }
export function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve({ name: file.name, mime: file.type || 'application/octet-stream', data: String(r.result).split(',')[1] })
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

export async function openFinanceFile(id) {
  const tab = window.open('', '_blank')
  const f = await getFinanceFile(id)
  const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: f.mime }))
  if (tab) tab.location.href = url; else window.location.href = url
}

export const TYPE_LABELS = { asset: 'Assets', liability: 'Liabilities', equity: 'Equity', income: 'Income', cogs: 'Cost of sales', expense: 'Expenses', tax: 'Tax' }
export const ENTRY_LABELS = { JV: 'Journal', OB: 'Opening balances', SI: 'Sale', RC: 'Receipt', EX: 'Expense', PY: 'Payroll', PU: 'Purchase', IN: 'Inventory', BK: 'Bank', TX: 'Tax', CL: 'Closing' }

// ── Reports and ledgers (F1) ───────────────────────────────────────────
export const getLedger = (accountId, f = {}) => api(`/finance/ledger/${accountId}?${query(f)}`)
export const getReport = (name, f = {}) => api(`/finance/reports/${name}?${query(f)}`)

// ── F2a: expenses, claims, staff, payroll, staff payments ──
const post = (path, b = {}) => api(path, { method: 'POST', ...body(b) })
const patch = (path, b) => api(path, { method: 'PATCH', ...body(b) })
export const getFinCollections = () => api('/finance/collections')
export const getSuppliers = () => api('/finance/suppliers')
export const createSupplier = (b) => post('/finance/suppliers', b)
export const updateSupplier = (id, b) => patch(`/finance/suppliers/${id}`, b)
export const getExpenses = (f = {}) => api(`/finance/expenses?${query(f)}`)
export const getExpense = (id) => api(`/finance/expenses/${id}`)
export const createExpense = (b) => post('/finance/expenses', b)
export const updateExpense = (id, b) => patch(`/finance/expenses/${id}`, b)
export const voidExpense = (id, reason) => post(`/finance/expenses/${id}/void`, { reason })
export const payBill = (id, b) => post(`/finance/expenses/${id}/pay`, b)
export const unpayBill = (id, reason) => post(`/finance/expenses/${id}/unpay`, { reason })
export const addExpenseFiles = (id, fileIds) => post(`/finance/expenses/${id}/files`, { fileIds })
export const getRecurring = () => api('/finance/recurring')
export const saveRecurring = (id, b) => (id ? patch(`/finance/recurring/${id}`, b) : post('/finance/recurring', b))
export const generateRecurring = (month) => post('/finance/recurring/generate', { month })
export const getClaims = (f = {}) => api(`/finance/claims?${query(f)}`)
export const getClaim = (id) => api(`/finance/claims/${id}`)
export const createClaim = (b) => post('/finance/claims', b)
export const updateClaim = (id, b) => patch(`/finance/claims/${id}`, b)
export const approveClaim = (id) => post(`/finance/claims/${id}/approve`)
export const unapproveClaim = (id, reason) => post(`/finance/claims/${id}/unapprove`, { reason })
export const rejectClaim = (id, reason) => post(`/finance/claims/${id}/reject`, { reason })
export const getStaff = () => api('/finance/staff')
export const getStaffMember = (id) => api(`/finance/staff/${id}`)
export const getStaffOwed = (id) => api(`/finance/staff/${id}/owed`)
export const createStaff = (b) => post('/finance/staff', b)
export const updateStaff = (id, b) => patch(`/finance/staff/${id}`, b)
export const setStaffSalary = (id, b) => post(`/finance/staff/${id}/salary`, b)
export const getPayrollRuns = () => api('/finance/payroll')
export const getPayrollRun = (id) => api(`/finance/payroll/${id}`)
export const createPayrollRun = (weekEnding) => post('/finance/payroll', { weekEnding })
export const savePayrollRun = (id, b) => patch(`/finance/payroll/${id}`, b)
export const deletePayrollRun = (id) => api(`/finance/payroll/${id}`, { method: 'DELETE' })
export const postPayrollRun = (id) => post(`/finance/payroll/${id}/post`)
export const unpostPayrollRun = (id, reason) => post(`/finance/payroll/${id}/unpost`, { reason })
export const getStaffPayments = (f = {}) => api(`/finance/staff-payments?${query(f)}`)
export const createStaffPayment = (b) => post('/finance/staff-payments', b)
export const voidStaffPayment = (id, reason) => post(`/finance/staff-payments/${id}/void`, { reason })
export const getStatement = (type, id, f = {}) => api(`/finance/statement/${type}/${id}?${query(f)}`)

// Uploads chosen files and returns their ids (receipts, bank screenshots)
export async function uploadFiles(fileList, folder) {
  const ids = []
  for (const f of fileList || []) ids.push((await uploadFinanceFile({ ...(await readFile(f)), folder })).id)
  return ids
}
export const PAID_FROM = { bank: 'Bank Alfalah', cash: 'Studio petty cash', director_omer: 'Omer paid personally', director_usman: 'Usman paid personally', unpaid: 'Not paid yet (owed to supplier)' }

// ── F2b: receipt and screenshot inbox ──
export const getIntake = (group) => api(`/finance/intake?${query({ group })}`)
export const getIntakeItem = (id) => api(`/finance/intake/${id}`)
export const addToIntake = (fileIds) => post('/finance/intake', { fileIds })
export const readIntakeItem = (id) => post(`/finance/intake/${id}/read`)
export const saveIntakeItem = (id, b) => patch(`/finance/intake/${id}`, b)
export const approveIntakeItem = (id, b) => post(`/finance/intake/${id}/approve`, b)
export const rejectIntakeItem = (id, reason) => post(`/finance/intake/${id}/reject`, { reason })
export const parkIntakeItem = (id, reason) => post(`/finance/intake/${id}/park`, { reason })
export const reopenIntakeItem = (id) => post(`/finance/intake/${id}/reopen`)
export const approveReadyIntake = () => post('/finance/intake/approve-ready')
export const getIntakeLabels = () => api('/finance/intake-labels')
export const saveIntakeLabel = (id, b) => (id ? patch(`/finance/intake-labels/${id}`, b) : post('/finance/intake-labels', b))
export const INTAKE_KINDS = { staff_payment: 'Staff payment', expense: 'Expense / supplier', owner_funding: 'Funds added by a director', customer_receipt: 'Customer payment (F3)', reseller_payment: 'Reseller payment (F3)', other: 'Not sure yet' }

// ── F3: sales, receipts, resellers ──
export const getReceivables = () => api('/finance/receivables')
export const getSyncExceptions = () => api('/finance/sync/exceptions')
export const syncBatch = (after) => post('/finance/sync', { after, limit: 12 })
export const retrySync = (type, id) => post('/finance/sync/retry', { type, id })
export const keepAdvance = (orderId, reason) => post(`/finance/orders/${orderId}/keep-advance`, { reason })
export const getFxRates = () => api('/finance/fx-rates')
export const setFxRate = (b) => post('/finance/fx-rates', b)
export const deleteFxRate = (b) => post('/finance/fx-rates/delete', b)

// ── F4: bank reconciliation ──
export const getBankStatements = () => api('/finance/bank/statements')
export const getBankStatement = (id) => api(`/finance/bank/statements/${id}`)
export const previewBankStatement = (b) => post('/finance/bank/preview', b)
export const importBankStatement = (b) => post('/finance/bank/statements', b)
export const deleteBankStatement = (id) => api(`/finance/bank/statements/${id}`, { method: 'DELETE' })
export const autoMatchStatement = (id) => post(`/finance/bank/statements/${id}/auto-match`)
export const reconcileStatement = (id, b) => post(`/finance/bank/statements/${id}/reconcile`, b)
export const matchBankLine = (id, entryId) => post(`/finance/bank/lines/${id}/match`, { entryId })
export const unmatchBankLine = (id) => post(`/finance/bank/lines/${id}/unmatch`)
export const ignoreBankLine = (id, reason) => post(`/finance/bank/lines/${id}/ignore`, { reason })
export const bookBankLine = (id, b) => post(`/finance/bank/lines/${id}/book`, b)
export const getBankRules = () => api('/finance/bank/rules')
export const deleteBankRule = (id) => api(`/finance/bank/rules/${id}`, { method: 'DELETE' })
export const findOrdersForPayment = (q, amount) => api(`/finance/bank/orders?${query({ q, amount })}`)

// Reads a statement file in the browser: PDF text lines (pdf.js) or spreadsheet rows. Nothing leaves the app.
export async function readStatementFile(file) {
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    const pdfjs = await import('pdfjs-dist/build/pdf.min.mjs')
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
    const textLines = []
    for (let p = 1; p <= doc.numPages; p++) {
      const items = (await (await doc.getPage(p)).getTextContent()).items.filter((i) => i.str && i.str.trim())
      // Group pieces of text into visual lines (same height on the page), left to right
      const rows = []
      for (const i of items.sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4])) {
        const y = i.transform[5]
        const row = rows.find((r) => Math.abs(r.y - y) <= 3)
        if (row) row.items.push(i); else rows.push({ y, items: [i] })
      }
      for (const r of rows.sort((a, b) => b.y - a.y)) textLines.push(r.items.sort((a, b) => a.transform[4] - b.transform[4]).map((i) => i.str.trim()).join(' '))
    }
    return { source: 'pdf', textLines }
  }
  const XLSX = await import('xlsx')
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
  const grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' })   // real dates and numbers
  const h = grid.findIndex((r) => r.some((c) => /^date/i.test(String(c).trim())) && r.some((c) => /balance/i.test(String(c))))
  if (h < 0) throw new Error('No header row with Date and Balance columns was found')
  const head = grid[h].map((c) => String(c).toLowerCase().trim())
  const col = (re) => head.findIndex((c) => re.test(c))
  const ix = { date: col(/^(txn |value |transaction )?date/), description: col(/desc|narration|particular|detail|remarks/), debit: col(/debit|withdraw/), credit: col(/credit|deposit/), balance: col(/balance/) }
  const rows = grid.slice(h + 1).map((r) => Object.fromEntries(Object.entries(ix).map(([k, i]) => [k, i >= 0 ? r[i] : ''])))
  return { source: name.endsWith('.csv') ? 'csv' : 'xlsx', rows }
}

// ── F5a: costing and pricing ──
export const getCostingDesigns = (collectionId) => api(`/finance/costing/designs?${query({ collectionId })}`)
export const getCostingDesign = (productId) => api(`/finance/costing/designs/${productId}`)
export const saveCostCard = (productId, b) => post(`/finance/costing/designs/${productId}/cards`, b)
export const activateCostCard = (cardId) => post(`/finance/costing/cards/${cardId}/activate`)
export const confirmPrice = (productId, b) => post(`/finance/costing/designs/${productId}/price`, b)
export const getFabricLots = (collectionId) => api(`/finance/costing/lots?${query({ collectionId })}`)
export const saveFabricLot = (id, b) => (id ? patch(`/finance/costing/lots/${id}`, b) : post('/finance/costing/lots', b))
export const getLotMoves = (id) => api(`/finance/costing/lots/${id}/moves`)
export const addFabricMove = (id, b) => post(`/finance/costing/lots/${id}/moves`, b)
export const getPricingPolicies = () => api('/finance/costing/policies')
export const savePricingPolicy = (b) => post('/finance/costing/policies', b)
export const deletePricingPolicy = (collectionId) => api(`/finance/costing/policies/${collectionId}`, { method: 'DELETE' })
export const getProfit = (f) => api(`/finance/costing/profit?${query(f)}`)
