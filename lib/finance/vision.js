// Reads a receipt, bill or bank-app screenshot with the Claude API (vision) and returns structured
// fields. Needs ANTHROPIC_API_KEY; FINANCE_VISION_MODEL picks the model. Only names and the last 4
// digits of account numbers come back, and sanitise() enforces that again before anything is stored.
import { HttpError } from '../db.js'

const MODEL = () => process.env.FINANCE_VISION_MODEL || 'claude-sonnet-5-5'
export const visionConfigured = () => !!process.env.ANTHROPIC_API_KEY

const PROMPT = `You are reading one finance document for Koko Atelier (Private) Limited, a fashion studio in Pakistan.
It is a bank / wallet app transfer screenshot, a shop receipt, or a supplier bill. Record what it shows with the record_document tool.

Rules:
- Amounts are Pakistani rupees unless the document says otherwise. Give plain numbers (23200, not "Rs 23,200").
- Dates as YYYY-MM-DD. Pakistani documents usually write day/month/year.
- reference: the transaction / reference / TID / RRN number exactly as printed.
- For accounts give the holder's NAME and only the LAST 4 DIGITS of the account / IBAN / wallet number. Never return a full account number, IBAN, CNIC or an account balance.
- Transfer screenshots often carry a handwritten or sticker note (e.g. "Nov 26 Week 3 / Tailor Salary 17,500 / Market 5,700 / Final Payment 23,200"). Copy each note line into note_lines with its amount (null if it has none), keeping the words as written.
- For a receipt or bill, list the items with amounts and the total; shop is the seller's name.
- suggested_category: a short plain phrase for what the money was for (e.g. "thread and stitching supplies", "electrician", "owner funding", "salary").
- confidence: 0 to 1, how sure you are that the amount, date and reference are read correctly.`

const TOOL = {
  name: 'record_document',
  description: 'Record the fields read from the document',
  input_schema: {
    type: 'object',
    properties: {
      doc_type: { type: 'string', enum: ['bank_transfer', 'receipt', 'bill', 'other'] },
      source: { type: 'string', description: 'Bank, wallet app or shop' },
      reference: { type: ['string', 'null'] },
      date: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
      time: { type: ['string', 'null'] },
      amount: { type: ['number', 'null'] },
      currency: { type: 'string' },
      from_name: { type: ['string', 'null'] },
      from_account_last4: { type: ['string', 'null'] },
      to_name: { type: ['string', 'null'] },
      to_account_last4: { type: ['string', 'null'] },
      purpose: { type: ['string', 'null'] },
      note_lines: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, amount: { type: ['number', 'null'] } }, required: ['text'] } },
      shop: { type: ['string', 'null'] },
      items: { type: 'array', items: { type: 'object', properties: { description: { type: 'string' }, amount: { type: ['number', 'null'] } }, required: ['description'] } },
      total: { type: ['number', 'null'] },
      suggested_category: { type: ['string', 'null'] },
      confidence: { type: 'number' },
    },
    required: ['doc_type', 'amount', 'confidence'],
  },
}

const IMAGES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

// { mime, data: base64 } -> extracted fields (sanitised)
export async function extractDocument(file) {
  if (!visionConfigured()) throw new HttpError(400, 'Reading files needs ANTHROPIC_API_KEY on the server. You can still type the details in.')
  const source = { type: 'base64', media_type: file.mime, data: file.data }
  const block = IMAGES.includes(file.mime) ? { type: 'image', source }
    : file.mime === 'application/pdf' ? { type: 'document', source }
    : null
  if (!block) throw new HttpError(400, 'Only photos, screenshots and PDFs can be read')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL(), max_tokens: 2000, tools: [TOOL], tool_choice: { type: 'tool', name: TOOL.name },
      messages: [{ role: 'user', content: [block, { type: 'text', text: PROMPT }] }],
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new HttpError(502, `Couldn't read the file: ${body?.error?.message || res.statusText}`)
  const use = (body.content || []).find((c) => c.type === 'tool_use')
  if (!use) throw new HttpError(502, "Couldn't read the file: no result came back")
  return sanitise(use.input)
}

// Keeps only what may be stored: last 4 digits of accounts, no CNICs, no long digit runs outside the reference
const CNIC = /\b\d{5}-?\d{7}-?\d\b/g
const LONG = /\d[\d -]{9,}\d/g
const scrub = (s) => (s == null ? null : String(s).replace(CNIC, '[removed]').replace(LONG, (m) => `…${m.replace(/\D/g, '').slice(-4)}`).slice(0, 500))
const last4 = (s) => { const d = String(s ?? '').replace(/\D/g, ''); return d ? d.slice(-4) : null }
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(String(v).replace(/,/g, ''))) ? null : Math.round(Number(String(v).replace(/,/g, '')) * 100) / 100)
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '')

export function sanitise(x = {}) {
  return {
    docType: ['bank_transfer', 'receipt', 'bill', 'other'].includes(x.doc_type ?? x.docType) ? (x.doc_type ?? x.docType) : 'other',
    source: scrub(x.source),
    reference: x.reference ? String(x.reference).replace(/[^\w-]/g, '').slice(0, 60) || null : null,
    date: isDate(x.date) ? x.date : null,
    time: scrub(x.time),
    amount: num(x.amount),
    currency: (x.currency || 'PKR').toString().toUpperCase().slice(0, 3),
    fromName: scrub(x.from_name ?? x.fromName), fromLast4: last4(x.from_account_last4 ?? x.fromLast4),
    toName: scrub(x.to_name ?? x.toName), toLast4: last4(x.to_account_last4 ?? x.toLast4),
    purpose: scrub(x.purpose),
    noteLines: (x.note_lines ?? x.noteLines ?? []).slice(0, 30).map((l) => ({ text: scrub(l.text) || '', amount: num(l.amount) })),
    shop: scrub(x.shop),
    items: (x.items ?? []).slice(0, 60).map((l) => ({ description: scrub(l.description) || '', amount: num(l.amount) })),
    total: num(x.total),
    suggestedCategory: scrub(x.suggested_category ?? x.suggestedCategory),
    confidence: Math.max(0, Math.min(1, Number(x.confidence) || 0)),
  }
}
