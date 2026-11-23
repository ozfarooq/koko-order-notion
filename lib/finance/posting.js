// Posting rules for sales, customer receipts and resellers (spec 7.1 with v1.6 C1, C5). Pure functions:
// facts in (amounts in paisa / fils), journal lines out, so each rule is unit-tested without a database.
// acc maps system keys to account ids. Tax is off: the full price is revenue (spec 8.0).

export const PAY_KEYS = { bank: 'bank_baf', cash: 'cash_studio', trax_cod: 'clearing_trax', director_omer: 'director_omer', director_usman: 'director_usman' }
export const PAY_LABELS = { bank: 'Bank Alfalah', cash: 'Cash', trax_cod: 'Trax COD', director_omer: 'Paid to Omer', director_usman: 'Paid to Usman' }

const line = (accountId, debit, credit, extra = {}) => ({ accountId, debit, credit, ...extra })

// A customer payment (negative = refund): Dr where the money went, Cr customer advances 2200
export function paymentLines(p, acc) {
  if (!PAY_KEYS[p.method]) throw new Error(`Unknown payment method ${p.method}`)
  if (!Number.isInteger(p.amount) || p.amount === 0) throw new Error('A payment needs an amount')
  const tag = { partyType: 'customer', partyId: String(p.customerId), orderId: p.orderId }
  const cash = acc[PAY_KEYS[p.method]], adv = acc.customer_advances
  const text = `${p.orderNumber}${p.reference ? `, ref ${p.reference}` : ''}`
  return p.amount > 0
    ? [line(cash, p.amount, 0, { ...tag, description: text }), line(adv, 0, p.amount, { ...tag, description: text })]
    : [line(adv, -p.amount, 0, { ...tag, description: `Refund ${text}` }), line(cash, 0, -p.amount, { ...tag, description: `Refund ${text}` })]
}

// Revenue when the order is Paid (C1): Dr customer advances, Cr sales by channel; pieces filled from a
// damaged studio piece or a shoot sample go to 4500 (C5c)
export function revenueLines(o, acc) {
  if (!Number.isInteger(o.amount) || o.amount <= 0) return null
  const tag = { partyType: 'customer', partyId: String(o.customerId), orderId: o.orderId }
  const special = Math.min(Math.max(o.specialPaisa || 0, 0), o.amount)
  const sales = o.channel === 'Shopify' ? acc.sales_web : acc.sales_retail
  const lines = [line(acc.customer_advances, o.amount, 0, { ...tag, description: `${o.orderNumber}: advance applied to the sale` })]
  if (o.amount - special > 0) lines.push(line(sales, 0, o.amount - special, { ...tag, description: o.orderNumber }))
  if (special > 0) lines.push(line(acc.sales_damaged, 0, special, { ...tag, description: `${o.orderNumber}: damaged / sample pieces` }))
  return lines
}

// Keeping a cancelled order's advance (owner only, with a reason): Dr 2200, Cr other income 4900
export function forfeitLines(o, acc) {
  const tag = { partyType: 'customer', partyId: String(o.customerId), orderId: o.orderId }
  return [line(acc.customer_advances, o.amount, 0, { ...tag, description: `${o.orderNumber}: advance kept on cancellation` }),
    line(acc.fx_gain, 0, o.amount, { ...tag, description: `${o.orderNumber}: advance kept on cancellation` })]
}

// The reseller's figures for one piece, in fils (1/100 of the reseller's currency), as consignment_items_detail does
export function pieceFigures(i) {
  const net = i.price - i.designerDiscount - i.resellerDiscount
  const commission = Math.round((net * i.commissionPct) / 100)
  return { net, commission, alteration: i.alteration, toKoko: net - commission - i.alteration }
}

// A reseller piece sold (from the statement): Dr reseller receivable (what Koko is owed), commission 6500,
// alteration 6510; Cr reseller sales 4200 at the net price. Converted at the sale-date rate; the receivable
// line keeps the foreign amount so the payment can work out the exchange difference.
export function resellerSaleLines(i, rate, acc) {
  const f = pieceFigures(i)
  const pk = (fils) => Math.round(fils * rate)
  const netP = pk(f.net), comP = pk(f.commission), altP = pk(f.alteration), arP = netP - comP - altP
  const tag = { partyType: 'reseller', partyId: String(i.resellerId), consignmentItemId: i.id, productId: i.productId }
  const fc = (fils) => (i.currency === 'PKR' ? {} : { currency: i.currency, amountFc: (fils / 100).toFixed(2), fxRate: String(rate) })
  const text = `${i.product}${i.size ? ` (${i.size})` : ''}${i.code ? ` ${i.code}` : ''}`
  const lines = []
  if (arP) lines.push(line(acc.ar_resellers, arP > 0 ? arP : 0, arP < 0 ? -arP : 0, { ...tag, ...fc(f.toKoko), description: text }))
  if (comP) lines.push(line(acc.reseller_commission, comP, 0, { ...tag, description: `${text}: reseller commission` }))
  if (altP) lines.push(line(acc.reseller_alteration, altP, 0, { ...tag, description: `${text}: alteration` }))
  if (netP) lines.push(line(acc.sales_reseller, 0, netP, { ...tag, description: text }))
  return lines.length >= 2 ? { lines, receivable: arP } : null
}

// A reseller payment: Dr bank (PKR received), Cr reseller receivable (what those pieces were booked at);
// the difference is an exchange gain (4900) or loss (6990)
export function resellerPaymentLines(p, bookedPaisa, acc) {
  const tag = { partyType: 'reseller', partyId: String(p.resellerId) }
  const text = `${p.resellerName} payment${p.reference ? `, ref ${p.reference}` : ''}`
  const lines = [line(acc.bank_baf, p.amountPkr, 0, { description: text, ...tag })]
  const fc = p.currency === 'PKR' ? {} : { currency: p.currency, amountFc: (p.amountFils / 100).toFixed(2), fxRate: (bookedPaisa / p.amountFils).toFixed(6) }
  if (bookedPaisa) lines.push(line(acc.ar_resellers, 0, bookedPaisa, { ...tag, ...fc, description: text }))
  const diff = p.amountPkr - bookedPaisa
  const why = p.differenceReason ? `: ${p.differenceReason}` : ''
  if (diff > 0) lines.push(line(acc.fx_gain, 0, diff, { ...tag, description: `Exchange difference${why}` }))
  if (diff < 0) lines.push(line(acc.fx_loss, -diff, 0, { ...tag, description: `Exchange difference${why}` }))
  return lines
}
