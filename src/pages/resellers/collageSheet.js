// Reads a reseller's monthly sales sheet (Fashion Collage's Excel) and matches each line to a
// piece at their store. Pure functions, so they can be checked outside the browser.

const SIZE_SUFFIX = { XS: 'X-Small', S: 'Small', M: 'Medium', L: 'Large', XL: 'X-Large', C: 'Custom' }
const clean = (v) => String(v ?? '').trim()
const key = (v) => clean(v).toUpperCase().replace(/\s+/g, '')
const nameKey = (v) => clean(v).toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')
const amount = (v) => {
  if (typeof v === 'number') return v
  const n = Number(clean(v).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

// "2026-10-03 20:28:32", a Date, an Excel day number or "03/10/2026" → "2026-10-03"
export function sheetDate(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const d = new Date(v.getTime() + 12 * 3600_000)           // midday guards against time-zone shifts
    return d.toISOString().slice(0, 10)
  }
  if (typeof v === 'number' && v > 30000 && v < 80000) return new Date(Math.round((v - 25569) * 86400_000)).toISOString().slice(0, 10)
  const s = clean(v)
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/)          // day first, as in the UAE and Pakistan
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return ''
}

// KOATLR-010-S → { base: 'KOATLR-010', size: 'Small' }; KOATLR-010 → { base, size: null }
export function splitCode(code) {
  const c = key(code)
  const m = c.match(/^(.*\d)-(XS|S|M|L|XL|C)$/)
  return m ? { base: m[1], size: SIZE_SUFFIX[m[2]] } : { base: c, size: null }
}

// rows: the sheet as arrays of cells. Finds the header row (it has CODE and INV NO) wherever it is,
// then reads every line under it until the sheet runs out; total rows and blank rows are skipped.
export function parseSalesSheet(rows) {
  const headerAt = rows.findIndex((r) => {
    const cells = r.map(key)
    return cells.some((c) => c === 'CODE') && cells.some((c) => c.startsWith('INV'))
  })
  if (headerAt < 0) throw new Error("This doesn't look like a sales sheet: there's no row with CODE and INV NO headings.")
  const head = rows[headerAt].map(key)
  const col = (test) => head.findIndex(test)
  const c = {
    date: col((h) => h.startsWith('DATE')),
    invoice: col((h) => h.startsWith('INV')),
    code: col((h) => h === 'CODE'),
    product: col((h) => h.includes('PRODUCT')),
    gross: col((h) => h.includes('GROSS')),
    designer: col((h) => h.includes('DESIGNER')),
    reseller: col((h) => h.includes('DISCOUNT') && !h.includes('DESIGNER')),
    alteration: col((h) => h.includes('ALT') || h.includes('LAUNDRY')),
    payable: col((h) => h.includes('NETPAYABLE')),
  }
  const cell = (r, i) => (i >= 0 ? r[i] : '')
  const lines = []
  for (const r of rows.slice(headerAt + 1)) {
    const code = clean(cell(r, c.code)), product = clean(cell(r, c.product)), invoice = clean(cell(r, c.invoice))
    if (!code && !product) continue
    if (/total/i.test(`${code} ${product} ${clean(cell(r, c.date))}`)) continue
    lines.push({
      row: lines.length + 1,
      soldOn: sheetDate(cell(r, c.date)), invoiceNo: invoice, code, product,
      gross: amount(cell(r, c.gross)), designerDiscount: amount(cell(r, c.designer)), resellerDiscount: amount(cell(r, c.reseller)),
      alterationCharge: amount(cell(r, c.alteration)), netPayable: c.payable >= 0 ? amount(cell(r, c.payable)) : null,
    })
  }
  if (!lines.length) throw new Error('The sheet has headings but no sales under them.')
  return lines
}

// pieces: the reseller's pieces (status 'FC - At Store' etc., productId, product, size, resellerCode, resellerInvoiceNo).
// Each line gets: product (by code, else by name), the sizes available at the store, a suggested piece,
// and a status: ok | size (choose a size) | recorded (already entered) | nostock | notfound.
export function matchSales(lines, pieces) {
  const byCode = new Map(), byName = new Map(), codeOf = new Map()
  for (const p of pieces) {
    if (p.resellerCode) { byCode.set(key(p.resellerCode), p.productId); codeOf.set(p.productId, key(p.resellerCode)) }
    byName.set(nameKey(p.product), p.productId)
  }
  const taken = new Set()
  return lines.map((l) => {
    const { base, size } = splitCode(l.code)
    let productId = byCode.get(base) ?? null
    let via = 'code'
    if (productId == null && byName.has(nameKey(l.product))) { productId = byName.get(nameKey(l.product)); via = 'name' }
    if (productId == null) return { ...l, status: 'notfound', productId: null, sizes: [], pieceId: '' }
    const product = pieces.find((p) => p.productId === productId)
    const knownCode = codeOf.get(productId) || null
    const newCode = base && !knownCode ? base : null                    // a reserved design gets its confirmed code
    const recorded = pieces.find((p) => p.productId === productId && ['FC - Sold', 'FC - Paid'].includes(p.status)
      && l.invoiceNo && key(p.resellerInvoiceNo) === key(l.invoiceNo))
    if (recorded) return { ...l, status: 'recorded', productId, product: product.product, imageUrl: product.imageUrl, sizes: [], pieceId: recorded.id, via, newCode: null }
    const free = pieces.filter((p) => p.productId === productId && p.status === 'FC - At Store' && !taken.has(p.id))
    const sizes = [...new Set(free.map((p) => p.size))]
    const wanted = size && sizes.includes(size) ? size : sizes.length === 1 ? sizes[0] : null
    const piece = wanted ? free.find((p) => p.size === wanted) : null
    if (piece) taken.add(piece.id)
    return {
      ...l, productId, product: product.product, imageUrl: product.imageUrl, via, newCode, knownCode, sizes, size: wanted,
      pieceId: piece?.id || '', price: piece?.aedPrice ?? null,
      status: !free.length ? 'nostock' : piece ? 'ok' : 'size',
    }
  })
}
