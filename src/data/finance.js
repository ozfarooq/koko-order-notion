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
