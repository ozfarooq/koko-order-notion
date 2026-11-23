// Reading bank statements without sending them anywhere (spec F4; owner: statements are never sent to
// Claude). Pure functions shared by the browser (which extracts the PDF text with pdf.js) and the server
// / tests. Built on the Bank Alfalah monthly "Statement of Account" PDF; CSV / Excel exports with Date,
// Description, Debit, Credit, Balance columns work too.
//
// Each transaction's direction comes from the running balance, not from column positions: if the balance
// went down by the amount it was money out, up by the amount money in. A line where neither holds is
// flagged, so a misread row can't slip through.

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
const pad = (n) => String(n).padStart(2, '0')
const AMT = /-?\d{1,3}(?:,\d{3})*(?:\.\d{2})|-?\d+\.\d{2}/
// paisa (integer) from "13,732.22" / "-14,167.66"
export const toPaisa = (s) => {
  const t = String(s).replace(/,/g, '').trim()
  const neg = t.startsWith('-')
  const [w, f = ''] = t.replace('-', '').split('.')
  const p = Number(w) * 100 + Number((f + '00').slice(0, 2))
  return neg ? -p : p
}
export function parseDate(s) {
  let m = String(s).trim().match(/^(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s-](\d{2,4})$/)
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(m[1])}`
  m = String(s).trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)          // 05/10/2026 (day first in Pakistan)
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`
  m = String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

// Page headers repeated on every page (the bank name and "MONTHLY" may come out as one line)
const PAGE_JUNK = [/^page \d+ of \d+/i, /^monthly\b/i, /statement of account/i, /^bank alfalah$/i, /^bank alfalah\s+monthly\b/i, /^from date:/i]
// "05 Oct 2026 …"; a narrow date column can wrap the year onto the next line ("05 Oct …" / "2026")
const TXN_START = /^(\d{1,2} [A-Za-z]{3})(?: (\d{4}))?\s+(.*)$/
const TRAILING = new RegExp(`\\s(${AMT.source})\\s+(${AMT.source})\\s*$`)

// lines: the PDF text, one string per visual line (left to right). Returns the statement.
export function parseStatementText(lines) {
  const out = { bank: null, accountLast4: null, title: null, from: null, to: null, opening: null, closing: null, lines: [], warnings: [] }
  let inTable = false
  let cur = null
  const finish = () => { if (cur) { out.lines.push(cur); cur = null } }
  for (const raw of lines) {
    const line = String(raw).replace(/\s+/g, ' ').trim()
    if (!line) continue
    if (/bank alfalah/i.test(line) && !out.bank) out.bank = 'Bank Alfalah'
    const period = line.match(/From Date:\s*(\d{2}\/\d{2}\/\d{4}).*To Date:\s*(\d{2}\/\d{2}\/\d{4})/i)
    if (period) { out.from ??= parseDate(period[1]); out.to ??= parseDate(period[2]) }
    const iban = line.match(/\bPK\d{2}[A-Z]{4}\d{8,}/)
    if (iban && !out.accountLast4) out.accountLast4 = iban[0].slice(-4)
    const title = line.match(/^Title Of Account\s+(.+?)(\s+IBAN\b.*)?$/i)
    if (title && !out.title) out.title = title[1].trim()
    if (/^date\s+description\b/i.test(line)) { finish(); inTable = true; continue }
    if (PAGE_JUNK.some((r) => r.test(line))) { finish(); inTable = false; continue }
    if (!inTable) continue
    const ob = line.match(new RegExp(`^Opening Balance\\s+(${AMT.source})$`, 'i'))
    if (ob) { finish(); out.opening = toPaisa(ob[1]); continue }
    const cb = line.match(new RegExp(`^Closing Balance\\s+(${AMT.source})$`, 'i'))
    if (cb) { finish(); out.closing = toPaisa(cb[1]); continue }
    const start = line.match(TXN_START)
    if (start) {
      const rest = start[3]
      const tail = rest.match(TRAILING)
      if (tail || start[2]) {
        finish()
        const year = start[2] || (out.to || out.from || '').slice(0, 4)
        if (!tail) { out.warnings.push(`Couldn't read the amounts on the ${start[1]} line: "${line.slice(0, 80)}"`); continue }
        if (!year) { out.warnings.push(`No year for the ${start[1]} line`); continue }
        cur = { date: parseDate(`${start[1]} ${year}`), description: rest.slice(0, tail.index).trim(), amount: toPaisa(tail[1]), balance: toPaisa(tail[2]), yearWrapped: !start[2] }
        continue
      }
    }
    if (cur) {
      // the wrapped year of the date column, if any, is not part of the description
      if (cur.yearWrapped && /^\d{4}\b/.test(line)) { cur.yearWrapped = false; const t = line.replace(/^\d{4}\s*/, ''); if (t) cur.description += ` ${t}`; continue }
      cur.description += ` ${line}`
    }
  }
  finish()
  return settle(out)
}

// rows: [{ date, description, debit, credit, balance }] from a CSV / Excel export (amounts as text or numbers)
export function parseStatementRows(rows, meta = {}) {
  const out = { bank: meta.bank || null, accountLast4: meta.accountLast4 || null, title: null, from: null, to: null, opening: null, closing: null, lines: [], warnings: [] }
  for (const r of rows) {
    const desc = String(r.description ?? '').trim()
    const bal = r.balance === '' || r.balance == null ? null : toPaisa(r.balance)
    if (/opening balance/i.test(desc)) { out.opening = bal; continue }
    if (/closing balance/i.test(desc)) { out.closing = bal; continue }
    const date = r.date instanceof Date ? `${r.date.getFullYear()}-${pad(r.date.getMonth() + 1)}-${pad(r.date.getDate())}` : parseDate(r.date)
    if (!date) continue
    const debit = r.debit === '' || r.debit == null ? 0 : toPaisa(r.debit)
    const credit = r.credit === '' || r.credit == null ? 0 : toPaisa(r.credit)
    out.lines.push({ date, description: desc, amount: Math.abs(debit || credit), balance: bal, hint: debit ? -1 : credit ? 1 : 0 })
  }
  if (out.opening == null && out.lines.length && out.lines[0].balance != null) {
    const f = out.lines[0]; out.opening = f.balance - (f.hint || 0) * f.amount
  }
  return settle(out)
}

// Signs each amount from the balance chain and checks the statement adds up
function settle(out) {
  let prev = out.opening
  out.lines = out.lines.map((l, i) => {
    let signed = null, issue = null
    if (prev != null && l.balance != null) {
      if (prev - l.amount === l.balance) signed = -l.amount
      else if (prev + l.amount === l.balance) signed = l.amount
    }
    if (signed == null && l.hint) signed = l.hint * l.amount
    if (signed == null || (prev != null && l.balance != null && prev + signed !== l.balance)) issue = "The balance doesn't follow from the previous line: check this row against the statement"
    prev = l.balance ?? (prev != null && signed != null ? prev + signed : null)
    return { lineNo: i + 1, date: l.date, description: l.description, amount: signed ?? l.amount, balance: l.balance, ...describe(l.description), ...(issue ? { issue } : {}) }
  })
  const dates = out.lines.map((l) => l.date).filter(Boolean).sort()
  out.from ??= dates[0] || null
  out.to ??= dates[dates.length - 1] || null
  const totalIn = out.lines.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0)
  const totalOut = out.lines.filter((l) => l.amount < 0).reduce((s, l) => s - l.amount, 0)
  out.totals = { in: totalIn, out: totalOut }
  out.checks = {
    lines: out.lines.length,
    balanceChain: out.lines.every((l) => !l.issue),
    closingMatches: out.opening != null && out.closing != null ? out.opening + totalIn - totalOut === out.closing : null,
  }
  if (out.closing == null) out.warnings.push('No closing balance found')
  if (out.checks.closingMatches === false) out.warnings.push("Opening + money in − money out doesn't equal the closing balance")
  return out
}

// What a narration says: channel, who the other side is, references. Long digit runs (account and phone
// numbers) are cut to their last 4 digits before anything is stored.
export function describe(text) {
  const t = String(text || '')
  const transId = t.match(/TRANS\.?\s*ID:?\s*([A-Z0-9]+)/i)?.[1] || null
  const ref = t.match(/\[Ref:?\s*([A-Za-z0-9]+)\]?/i)?.[1] || null
  let channel = 'other', party = null, partyLast4 = null
  const KOKO = /koko atelier/i
  let m
  if (/federal excise duty|service charge|charges?\b|commission|sms alert|withholding/i.test(t) && !/transfer|ibft|raast/i.test(t)) channel = 'charge'
  else if ((m = t.match(/Raast P2P Funds Transfer (?:from|to) (.+?)(?:\s*\(.*?\))?\s*\*+(\d{4})/i))) { channel = 'raast'; party = m[1]; partyLast4 = m[2] }
  else if ((m = t.match(/IBFT (?:Remittance )?From (.+?) - (.+?) - ([\d-]+) (?:To|to) (.+?) - (.+?) - ([\d-]+)/i))) {
    channel = 'ibft'
    const [from, , fromAc, to, , toAc] = m.slice(1)
    if (KOKO.test(from)) { party = to; partyLast4 = toAc.replace(/\D/g, '').slice(-4) } else { party = from; partyLast4 = fromAc.replace(/\D/g, '').slice(-4) }
  } else if ((m = t.match(/IBFT (?:Remittance )?From (.+?) - (.+?) - ([\d-]+)/i))) { channel = 'ibft'; party = m[1]; partyLast4 = m[3].replace(/\D/g, '').slice(-4) }
  else if ((m = t.match(/Funds Transfer From (.+?) - ([\d-]+) to (.+?) - ([\d-]+)/i))) {
    channel = 'transfer'
    if (KOKO.test(m[1])) { party = m[3]; partyLast4 = m[4].slice(-4) } else { party = m[1]; partyLast4 = m[2].slice(-4) }
  }
  const institution = t.match(/ - ((?:[A-Z][\w/&.]*\s?)+(?:Bank|Limited|Microfinance Bank)[\w\s]*?) - /)?.[1]?.trim() || null
  return {
    channel, party: party ? party.replace(/\s+/g, ' ').trim() : null, partyLast4, institution,
    reference: transId, bankRef: ref,
    narration: t.replace(/\[Ref:?[^\]]*\]?/gi, '').replace(/<\s*TRANS\.?\s*ID:?[^>]*>/gi, '').replace(/\d[\d -]{6,}\d/g, (x) => `…${x.replace(/\D/g, '').slice(-4)}`).replace(/\s+/g, ' ').trim().slice(0, 400),
  }
}
