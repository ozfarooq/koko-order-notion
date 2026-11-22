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
