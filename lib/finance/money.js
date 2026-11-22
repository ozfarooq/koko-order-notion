// Money for the ledger: amounts are whole paisa (integers) in JavaScript and NUMERIC(14,2) in SQL,
// so sums never pick up floating-point errors. Shared by the server and the finance screens.

// '1,234.5' | 1234.5 | '1234.50' -> 123450. Empty is 0. More than 2 decimals is refused.
export function toPaisa(value) {
  if (value === '' || value == null) return 0
  const s = String(value).replace(/,/g, '').trim()
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new RangeError(`"${value}" is not an amount (up to 2 decimals)`)
  const negative = s.startsWith('-')
  const [whole, frac = ''] = s.replace('-', '').split('.')
  const p = Number(whole) * 100 + Number(frac.padEnd(2, '0'))
  if (!Number.isSafeInteger(p) || p > 99_999_999_999_99) throw new RangeError(`${value} is too large`)
  return negative ? -p : p
}

// 123450 -> '1234.50' (what SQL receives)
export function fromPaisa(p) {
  const a = Math.abs(p)
  return `${p < 0 ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`
}

// 123450 -> 'Rs 1,234.50'
export function formatRs(p, { symbol = 'Rs', decimals = true } = {}) {
  const a = Math.abs(p)
  const whole = Math.floor(a / 100).toLocaleString('en-US')
  const body = decimals ? `${whole}.${String(a % 100).padStart(2, '0')}` : whole
  return `${p < 0 ? '-' : ''}${symbol ? `${symbol} ` : ''}${body}`
}

export const sumPaisa = (list) => list.reduce((s, p) => s + p, 0)
