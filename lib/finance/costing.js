// Finance F5a: cost cards, fabric lots, pricing and profit (spec 7.4). The owner's method: after the shoot
// the cost sheet gives the cost of each outfit (fabric, stitching, extras); the marketing / packaging
// allowance is added to make the unit cost; price = unit cost × (1 + profit % + courier %), rounded and
// confirmed by the owner. The check at the final price takes the courier's cut on the selling price.
// Profit by order / design / collection reads revenue from the books (so it reconciles to the P&L) and
// costs from the cost cards (marked "standard" until actual job costing in F5b).
import { neon } from '@neondatabase/serverless'
import { HttpError, blank } from '../db.js'
import { toPaisa, fromPaisa } from './money.js'
import { day, isDate, today } from './expenses.js'

let _sql
const db = () => (_sql ??= neon(process.env.DATABASE_URL))
const sql = (...args) => db()(...args)
const P = (v) => toPaisa(v ?? 0)
const money = (p) => fromPaisa(Math.round(p))
const KINDS = ['fabric', 'stitching', 'extra', 'outsourced', 'consumables', 'overhead']

// ── Pricing (pure) ─────────────────────────────────────────────────────
// paisa in; prices to the whole rupee, as on the cost sheet
export function priceFor({ productionCost, allowance, profitPct, courierPct, method = 'koko', roundTo = 500 }) {
  const unit = productionCost + allowance
  const rupee = (p) => Math.round(p / 100) * 100
  const koko = rupee(unit * (1 + (profitPct + courierPct) / 100))
  const grossup = rupee((unit * (1 + profitPct / 100)) / (1 - courierPct / 100))
  const computed = method === 'grossup' ? grossup : koko
  const step = roundTo * 100
  return { unitCost: unit, koko, grossup, computed, suggested: Math.ceil(computed / step) * step }
}
// What a selling price really leaves after the courier's cut (on the price, not the cost)
export function checkPrice(finalPrice, unitCost, courierPct) {
  const courier = Math.round((finalPrice * courierPct) / 100)
  const margin = finalPrice - unitCost - courier
  return { courier, margin, onCost: unitCost ? (margin / unitCost) * 100 : null, ofPrice: finalPrice ? (margin / finalPrice) * 100 : null }
}
// Fabric for larger sizes: X-Small … X-Large, also S / M / L shorthand
const SIZE_KEYS = { xs: 'X-Small', 'x-small': 'X-Small', s: 'Small', small: 'Small', m: 'Medium', medium: 'Medium', l: 'Large', large: 'Large', xl: 'X-Large', 'x-large': 'X-Large' }
export const sizeFactor = (factors, size) => Number(factors?.[SIZE_KEYS[String(size || '').trim().toLowerCase()]] ?? 1) || 1
// Cost of one piece in a size: fabric lines scale with the size factor
export const pieceCost = (lines, factors, size) => lines.reduce((s, l) => s + (l.kind === 'fabric' ? Math.round(P(l.amount) * sizeFactor(factors, size)) : P(l.amount)), 0)

// ── Policies ───────────────────────────────────────────────────────────
const rowToPolicy = (r) => r && ({ id: r.id, collectionId: r.collection_id, collectionName: r.collection_name || null, allowance: money(P(r.allowance)), profitPct: Number(r.profit_pct),
  courierPct: Number(r.courier_pct), method: r.method, roundTo: r.round_to, sizeFactors: r.size_factors, isDefault: r.collection_id == null })
export async function listPolicies() {
  const rows = await sql`SELECT p.*, c.name AS collection_name FROM fin_pricing_policies p LEFT JOIN collections c ON c.id = p.collection_id ORDER BY p.collection_id NULLS FIRST, c.name`
  return rows.map(rowToPolicy)
}
async function policyFor(collectionId) {
  const rows = await sql`SELECT * FROM fin_pricing_policies WHERE collection_id = ${collectionId ?? null} OR collection_id IS NULL ORDER BY collection_id NULLS LAST LIMIT 1`
  return rowToPolicy(rows[0])
}
export async function savePolicy(b) {
  const collectionId = b.collectionId ? Number(b.collectionId) : null
  let allowance; try { allowance = P(b.allowance) } catch { throw new HttpError(400, 'Allowance is an amount') }
  const profit = Number(b.profitPct), courier = Number(b.courierPct), roundTo = Number(b.roundTo) || 500
  if (!(profit >= 0 && profit < 500)) throw new HttpError(400, 'Profit % is between 0 and 500')
  if (!(courier >= 0 && courier < 50)) throw new HttpError(400, 'Courier % is between 0 and 50')
  if (!['koko', 'grossup'].includes(b.method)) throw new HttpError(400, 'Choose the pricing method')
  const sf = b.sizeFactors && typeof b.sizeFactors === 'object' ? Object.fromEntries(Object.entries(b.sizeFactors).map(([k, v]) => [k, Number(v)]).filter(([, v]) => v > 0 && v < 3)) : null
  if (collectionId) {
    await sql`INSERT INTO fin_pricing_policies (collection_id, allowance, profit_pct, courier_pct, method, round_to, size_factors)
      VALUES (${collectionId}, ${fromPaisa(allowance)}::numeric, ${profit}, ${courier}, ${b.method}, ${roundTo}, coalesce(${sf ? JSON.stringify(sf) : null}::jsonb, (SELECT size_factors FROM fin_pricing_policies WHERE collection_id IS NULL)))
      ON CONFLICT (collection_id) DO UPDATE SET allowance = EXCLUDED.allowance, profit_pct = EXCLUDED.profit_pct, courier_pct = EXCLUDED.courier_pct,
        method = EXCLUDED.method, round_to = EXCLUDED.round_to, size_factors = EXCLUDED.size_factors, updated_at = now()`
  } else {
    await sql`UPDATE fin_pricing_policies SET allowance = ${fromPaisa(allowance)}::numeric, profit_pct = ${profit}, courier_pct = ${courier}, method = ${b.method},
      round_to = ${roundTo}, size_factors = coalesce(${sf ? JSON.stringify(sf) : null}::jsonb, size_factors), updated_at = now() WHERE collection_id IS NULL`
  }
  return listPolicies()
}
export async function deletePolicy(collectionId) {
  await sql`DELETE FROM fin_pricing_policies WHERE collection_id = ${Number(collectionId) || 0}`
  return listPolicies()
}

// ── Cost cards ─────────────────────────────────────────────────────────
async function activeCards(productIds = null) {
  const cards = await sql`
    SELECT cc.id, cc.product_id, cc.version, cc.effective_from, cc.source, json_agg(json_build_object('kind', l.kind, 'amount', l.amount, 'lotId', l.lot_id, 'quantity', l.quantity) ORDER BY l.line_no) AS lines
    FROM fin_cost_cards cc JOIN fin_cost_card_lines l ON l.card_id = cc.id
    WHERE cc.status = 'Active' AND (${productIds}::int[] IS NULL OR cc.product_id = ANY(${productIds}::int[]))
    GROUP BY cc.id`
  return new Map(cards.map((c) => [c.product_id, c]))
}
const latestPrices = async () => new Map((await sql`
  SELECT DISTINCT ON (product_id) product_id, final_price, approved_at FROM fin_price_history ORDER BY product_id, approved_at DESC, id DESC`).map((r) => [r.product_id, r]))

// Designs of a collection with cost, pricing and the check at the price in force
export async function listDesigns({ collectionId } = {}) {
  const products = await sql`
    SELECT p.id, p.name, p.price_pkr, p.image_url, p.collection_id, c.name AS collection_name
    FROM products p LEFT JOIN collections c ON c.id = p.collection_id
    WHERE (${collectionId ? Number(collectionId) : null}::int IS NULL OR p.collection_id = ${collectionId ? Number(collectionId) : null}::int)
    ORDER BY c.name, p.id`
  const [cards, prices, policies] = await Promise.all([activeCards(products.map((p) => p.id)), latestPrices(), listPolicies()])
  const policyOf = (cid) => policies.find((x) => x.collectionId === cid) || policies.find((x) => x.isDefault)
  return products.map((p) => {
    const card = cards.get(p.id)
    const pol = policyOf(p.collection_id)
    const base = { productId: p.id, name: p.name, imageUrl: p.image_url, collectionId: p.collection_id, collection: p.collection_name || '', websitePrice: p.price_pkr == null ? null : money(P(p.price_pkr)) }
    if (!card) return { ...base, hasCard: false }
    const production = card.lines.reduce((s, l) => s + P(l.amount), 0)
    const pr = priceFor({ productionCost: production, allowance: P(pol.allowance), profitPct: pol.profitPct, courierPct: pol.courierPct, method: pol.method, roundTo: pol.roundTo })
    const confirmed = prices.get(p.id)
    const selling = confirmed ? P(confirmed.final_price) : p.price_pkr != null ? P(p.price_pkr) : null
    const chk = selling ? checkPrice(selling, pr.unitCost, pol.courierPct) : null
    return { ...base, hasCard: true, cardVersion: card.version, productionCost: money(production), allowance: pol.allowance, unitCost: money(pr.unitCost),
      computedPrice: money(pr.computed), suggestedPrice: money(pr.suggested), finalPrice: confirmed ? money(P(confirmed.final_price)) : null,
      margin: chk && money(chk.margin), marginOnCost: chk?.onCost, marginOfPrice: chk?.ofPrice, belowTarget: chk ? chk.onCost < pol.profitPct - 0.05 : false,
      priceDiffers: confirmed && p.price_pkr != null && P(confirmed.final_price) !== P(p.price_pkr) }
  })
}

export async function getDesign(productId) {
  const [p] = await sql`SELECT p.id, p.name, p.price_pkr, p.image_url, p.collection_id, c.name AS collection_name FROM products p LEFT JOIN collections c ON c.id = p.collection_id WHERE p.id = ${Number(productId) || 0}`
  if (!p) throw new HttpError(404, 'Design not found')
  const [cards, history, pol, lots] = await Promise.all([
    sql`SELECT cc.*, u.name AS created_by_name FROM fin_cost_cards cc LEFT JOIN users u ON u.id = cc.created_by WHERE cc.product_id = ${p.id} ORDER BY cc.version DESC`,
    sql`SELECT h.*, u.name AS approved_by_name FROM fin_price_history h LEFT JOIN users u ON u.id = h.approved_by WHERE h.product_id = ${p.id} ORDER BY h.approved_at DESC, h.id DESC`,
    policyFor(p.collection_id),
    sql`SELECT id, name, unit, rate FROM fin_fabric_lots WHERE is_active AND (collection_id = ${p.collection_id} OR collection_id IS NULL) ORDER BY name`,
  ])
  const lines = cards.length ? await sql`SELECT l.*, f.name AS lot_name FROM fin_cost_card_lines l LEFT JOIN fin_fabric_lots f ON f.id = l.lot_id WHERE l.card_id = ANY(${cards.map((c) => c.id)}::int[]) ORDER BY l.line_no` : []
  const card = (c) => {
    const ls = lines.filter((l) => l.card_id === c.id).map((l) => ({ id: l.id, lineNo: l.line_no, kind: l.kind, description: l.description, lotId: l.lot_id, lotName: l.lot_name || '',
      quantity: l.quantity == null ? '' : Number(l.quantity), rate: l.rate == null ? '' : money(P(l.rate)), amount: money(P(l.amount)) }))
    return { id: c.id, version: c.version, effectiveFrom: day(c.effective_from), status: c.status, source: c.source || '', notes: c.notes || '', createdBy: c.created_by_name || '', createdAt: c.created_at,
      lines: ls, productionCost: money(ls.reduce((s, l) => s + P(l.amount), 0)) }
  }
  const versions = cards.map(card)
  const active = versions.find((v) => v.status === 'Active') || null
  const pricing = active ? priceFor({ productionCost: P(active.productionCost), allowance: P(pol.allowance), profitPct: pol.profitPct, courierPct: pol.courierPct, method: pol.method, roundTo: pol.roundTo }) : null
  const sizes = active ? Object.keys(pol.sizeFactors || {}).map((s) => ({ size: s, factor: Number(pol.sizeFactors[s]), cost: money(pieceCost(active.lines, pol.sizeFactors, s)) })).sort((a, b) => a.factor - b.factor) : []
  const hist = history.map((h) => {
    const c = checkPrice(P(h.final_price), P(h.unit_cost), Number(h.courier_pct))
    return { id: h.id, productionCost: money(P(h.production_cost)), allowance: money(P(h.allowance)), unitCost: money(P(h.unit_cost)), method: h.method, profitPct: Number(h.profit_pct),
      courierPct: Number(h.courier_pct), computedPrice: money(P(h.computed_price)), finalPrice: money(P(h.final_price)), margin: money(c.margin), marginOnCost: c.onCost, marginOfPrice: c.ofPrice,
      note: h.note || '', approvedBy: h.approved_by_name || '', approvedAt: h.approved_at }
  })
  return {
    productId: p.id, name: p.name, imageUrl: p.image_url, collectionId: p.collection_id, collection: p.collection_name || '', websitePrice: p.price_pkr == null ? null : money(P(p.price_pkr)),
    policy: pol, active, versions, lots: lots.map((l) => ({ id: l.id, name: l.name, unit: l.unit, rate: money(P(l.rate)) })), sizes,
    pricing: pricing && { unitCost: money(pricing.unitCost), koko: money(pricing.koko), grossup: money(pricing.grossup), computed: money(pricing.computed), suggested: money(pricing.suggested) },
    history: hist,
  }
}

// Saving a cost card makes a new version (the old one is kept); activating it supersedes the previous one
export async function saveCard(productId, b, user) {
  const d = await getDesign(productId)
  if (!Array.isArray(b.lines) || !b.lines.length) throw new HttpError(400, 'Add at least one cost line')
  const lines = b.lines.map((l, i) => {
    if (!KINDS.includes(l.kind)) throw new HttpError(400, `Line ${i + 1}: choose the kind of cost`)
    const desc = blank(l.description) || (l.kind === 'stitching' ? 'Stitching' : null)
    if (!desc) throw new HttpError(400, `Line ${i + 1}: say what it is`)
    let qty = null, rate = null, amount
    try {
      if (l.quantity !== '' && l.quantity != null && l.rate !== '' && l.rate != null) { qty = Number(l.quantity); rate = P(l.rate); amount = Math.round(qty * rate) }
      else amount = P(l.amount)
    } catch (err) { throw new HttpError(400, `Line ${i + 1}: ${err.message}`) }
    if (qty != null && !(qty > 0)) throw new HttpError(400, `Line ${i + 1}: quantity must be more than zero`)
    if (!(amount >= 0)) throw new HttpError(400, `Line ${i + 1}: amount can't be negative`)
    if (l.lotId && l.kind !== 'fabric') throw new HttpError(400, `Line ${i + 1}: only fabric is drawn from a lot`)
    return { kind: l.kind, description: desc, lotId: l.lotId ? Number(l.lotId) : null, qty, rate, amount }
  })
  const from = isDate(b.effectiveFrom) ? b.effectiveFrom : today()
  const version = (d.versions[0]?.version || 0) + 1
  const activate = b.activate !== false
  const [card] = await sql`INSERT INTO fin_cost_cards (product_id, version, effective_from, status, source, notes, created_by, approved_by, approved_at)
    VALUES (${d.productId}, ${version}, ${from}::date, 'Draft', ${blank(b.source)}, ${blank(b.notes)}, ${user?.id ?? null}, ${activate ? user?.id ?? null : null}, ${activate ? new Date().toISOString() : null}) RETURNING id`
  await db().transaction([
    ...lines.map((l, i) => db()`INSERT INTO fin_cost_card_lines (card_id, line_no, kind, description, lot_id, quantity, rate, amount)
      VALUES (${card.id}, ${i + 1}, ${l.kind}, ${l.description}, ${l.lotId}::int, ${l.qty}, ${l.rate == null ? null : fromPaisa(l.rate)}::numeric, ${fromPaisa(l.amount)}::numeric)`),
    ...(activate ? [db()`UPDATE fin_cost_cards SET status = 'Superseded' WHERE product_id = ${d.productId} AND status = 'Active'`,
      db()`UPDATE fin_cost_cards SET status = 'Active' WHERE id = ${card.id}`] : []),
  ])
  return getDesign(d.productId)
}
export async function activateCard(cardId, user) {
  const [c] = await sql`SELECT id, product_id, status FROM fin_cost_cards WHERE id = ${Number(cardId) || 0}`
  if (!c) throw new HttpError(404, 'Cost card not found')
  await db().transaction([
    db()`UPDATE fin_cost_cards SET status = 'Superseded' WHERE product_id = ${c.product_id} AND status = 'Active'`,
    db()`UPDATE fin_cost_cards SET status = 'Active', approved_by = ${user?.id ?? null}, approved_at = now() WHERE id = ${c.id}`,
  ])
  return getDesign(c.product_id)
}

// The owner confirms the selling price; the cost and the policy behind it are kept with it
export async function confirmPrice(productId, { finalPrice, note } = {}, user) {
  const d = await getDesign(productId)
  if (!d.active) throw new HttpError(400, 'Give the design a cost card first')
  let fp; try { fp = P(finalPrice) } catch { throw new HttpError(400, 'Enter the final price') }
  if (fp <= 0) throw new HttpError(400, 'Enter the final price')
  const pol = d.policy
  await sql`INSERT INTO fin_price_history (product_id, card_id, production_cost, allowance, unit_cost, method, profit_pct, courier_pct, computed_price, final_price, note, approved_by)
    VALUES (${d.productId}, ${d.active.id}, ${d.active.productionCost}::numeric, ${pol.allowance}::numeric, ${d.pricing.unitCost}::numeric, ${pol.method}, ${pol.profitPct}, ${pol.courierPct},
            ${d.pricing.computed}::numeric, ${fromPaisa(fp)}::numeric, ${blank(note)}, ${user?.id ?? null})`
  return getDesign(d.productId)
}

// ── Fabric lots ────────────────────────────────────────────────────────
// Yards used: every outfit made (studio pieces, reseller pieces from before inventory) and every order in
// production or later, × the yards on its design's active cost card × the size factor
async function fabricUse() {
  const [cards, policies, made, ordered] = await Promise.all([
    activeCards(),
    listPolicies(),
    sql`SELECT s.product_id, s.size, count(*)::int AS n, 'made' AS src FROM stock_pieces s WHERE s.source = 'Made' GROUP BY 1, 2
        UNION ALL
        SELECT ci.product_id, ci.size, count(*)::int, 'reseller' FROM consignment_items ci
        WHERE NOT EXISTS (SELECT 1 FROM stock_pieces s WHERE s.consignment_item_id = ci.id) GROUP BY 1, 2`,
    sql`SELECT oi.product_id, oi.size, sum(oi.quantity)::int - coalesce(max(sp.n), 0)::int AS n
        FROM order_items oi JOIN orders o ON o.id = oi.order_id AND o.status NOT IN ('New', 'Cancelled')
        LEFT JOIN LATERAL (SELECT count(*) AS n FROM stock_pieces s WHERE s.order_id = o.id AND s.product_id = oi.product_id) sp ON true
        WHERE oi.product_id IS NOT NULL GROUP BY oi.product_id, oi.size, o.id`,
  ])
  const prodCollections = new Map((await sql`SELECT id, collection_id FROM products`).map((p) => [p.id, p.collection_id]))
  const factorsOf = (pid) => (policies.find((x) => x.collectionId === prodCollections.get(pid)) || policies.find((x) => x.isDefault)).sizeFactors
  const use = new Map()     // lotId -> { made, ordered }
  const add = (rows, key) => {
    for (const r of rows) {
      const card = cards.get(r.product_id)
      if (!card || r.n <= 0) continue
      for (const l of card.lines.filter((x) => x.kind === 'fabric' && x.lotId)) {
        const u = use.get(l.lotId) || { made: 0, ordered: 0 }
        u[key] += Number(l.quantity || 0) * sizeFactor(factorsOf(r.product_id), r.size) * r.n
        use.set(l.lotId, u)
      }
    }
  }
  add(made, 'made'); add(ordered, 'ordered')
  return { use, cards }
}

export async function listLots({ collectionId } = {}) {
  const lots = await sql`
    SELECT f.*, c.name AS collection_name, s.name AS supplier_name,
      coalesce((SELECT sum(quantity) FROM fin_fabric_moves m WHERE m.lot_id = f.id AND m.kind = 'purchase'), 0) AS bought,
      coalesce((SELECT round(sum(quantity * rate), 2) FROM fin_fabric_moves m WHERE m.lot_id = f.id AND m.kind = 'purchase'), 0) AS bought_value,
      coalesce((SELECT sum(quantity) FROM fin_fabric_moves m WHERE m.lot_id = f.id AND m.kind = 'adjust'), 0) AS adjusted
    FROM fin_fabric_lots f LEFT JOIN collections c ON c.id = f.collection_id LEFT JOIN fin_suppliers s ON s.id = f.supplier_id
    WHERE (${collectionId ? Number(collectionId) : null}::int IS NULL OR f.collection_id = ${collectionId ? Number(collectionId) : null}::int)
    ORDER BY c.name, f.name`
  const { use, cards } = await fabricUse()
  const products = new Map((await sql`SELECT id, name FROM products`).map((p) => [p.id, p.name]))
  return lots.map((f) => {
    const u = use.get(f.id) || { made: 0, ordered: 0 }
    const bought = Number(f.bought), adjusted = Number(f.adjusted)
    const left = Math.round((bought + adjusted - u.made - u.ordered) * 100) / 100
    const avg = bought > 0 ? P(f.bought_value) / bought : P(f.rate)
    // Designs cut from this lot and how many more outfits the leftover covers
    const designs = [...cards.values()].flatMap((c) => c.lines.filter((l) => l.lotId === f.id).map((l) => ({ productId: c.product_id, name: products.get(c.product_id), perPiece: Number(l.quantity || 0) })))
    return { id: f.id, collectionId: f.collection_id, collection: f.collection_name || '', name: f.name, unit: f.unit, rate: money(P(f.rate)), averageRate: money(avg),
      supplier: f.supplier_name || '', notes: f.notes || '', isActive: f.is_active,
      bought, adjusted, usedMade: Math.round(u.made * 100) / 100, usedOrders: Math.round(u.ordered * 100) / 100, left, valueLeft: money(Math.max(left, 0) * avg),
      designs: designs.map((x) => ({ ...x, outfitsLeft: x.perPiece > 0 ? Math.max(0, Math.floor(left / x.perPiece)) : null })) }
  })
}
export async function saveLot(id, b) {
  const name = blank(b.name)
  if (!name) throw new HttpError(400, 'Name the fabric as the cost sheet does, e.g. Ivory velvet')
  let rate; try { rate = P(b.rate) } catch { throw new HttpError(400, 'Rate is an amount') }
  if (rate < 0) throw new HttpError(400, 'Rate cannot be negative')
  const unit = ['yard', 'metre', 'piece'].includes(b.unit) ? b.unit : 'yard'
  try {
    if (id) await sql`UPDATE fin_fabric_lots SET name = ${name}, collection_id = ${b.collectionId ? Number(b.collectionId) : null}::int, unit = ${unit}, rate = ${fromPaisa(rate)}::numeric,
      supplier_id = ${b.supplierId ? Number(b.supplierId) : null}::int, notes = ${blank(b.notes)}, is_active = ${b.isActive !== false} WHERE id = ${Number(id)}`
    else await sql`INSERT INTO fin_fabric_lots (collection_id, name, unit, rate, supplier_id, notes)
      VALUES (${b.collectionId ? Number(b.collectionId) : null}::int, ${name}, ${unit}, ${fromPaisa(rate)}::numeric, ${b.supplierId ? Number(b.supplierId) : null}::int, ${blank(b.notes)})`
  } catch (err) { if (err.code === '23505') throw new HttpError(400, `There is already a lot called ${name} in this collection`); throw err }
  return listLots()
}
// A purchase (yards bought at a rate; the lot's average follows) or a count adjustment (+/−)
export async function addFabricMove(lotId, b, user) {
  const [f] = await sql`SELECT id FROM fin_fabric_lots WHERE id = ${Number(lotId) || 0}`
  if (!f) throw new HttpError(404, 'Fabric lot not found')
  if (!['purchase', 'adjust'].includes(b.kind)) throw new HttpError(400, 'Purchase or count adjustment')
  const qty = Number(b.quantity)
  if (!qty || (b.kind === 'purchase' && qty <= 0)) throw new HttpError(400, b.kind === 'purchase' ? 'Enter the yards bought' : 'Enter the yards found (+) or lost (−)')
  let rate = null
  if (b.kind === 'purchase') { try { rate = P(b.rate) } catch { throw new HttpError(400, 'Enter the rate per yard') } if (rate <= 0) throw new HttpError(400, 'Enter the rate per yard') }
  if (b.kind === 'adjust' && !blank(b.note)) throw new HttpError(400, 'Say why the count changed')
  await sql`INSERT INTO fin_fabric_moves (lot_id, kind, moved_on, quantity, rate, note, created_by)
    VALUES (${f.id}, ${b.kind}, ${isDate(b.date) ? b.date : today()}::date, ${qty}, ${rate == null ? null : fromPaisa(rate)}::numeric, ${blank(b.note)}, ${user?.id ?? null})`
  return listLots()
}
export async function lotMoves(lotId) {
  const rows = await sql`SELECT m.*, u.name AS by_name FROM fin_fabric_moves m LEFT JOIN users u ON u.id = m.created_by WHERE m.lot_id = ${Number(lotId) || 0} ORDER BY m.moved_on DESC, m.id DESC`
  return rows.map((m) => ({ id: m.id, kind: m.kind, date: day(m.moved_on), quantity: Number(m.quantity), rate: m.rate == null ? null : money(P(m.rate)), note: m.note || '', by: m.by_name || '' }))
}

// ── Profit (management view at standard cost) ──────────────────────────
// Revenue from the books (lines tagged with the order / reseller piece), cost from the cost cards
export async function profitReport({ from, to } = {}) {
  const f = isDate(from) ? from : `${today().slice(0, 4)}-01-01`, t = isDate(to) ? to : today()
  const [orderRev, resellerRev, items, collCosts, cards, policies, products, cod] = await Promise.all([
    sql`SELECT l.order_id, sum(l.credit - l.debit) AS revenue FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'Draft'
        JOIN fin_accounts a ON a.id = l.account_id AND a.type = 'income' WHERE l.order_id IS NOT NULL AND e.entry_date BETWEEN ${f}::date AND ${t}::date AND e.entry_type <> 'CL'
        GROUP BY l.order_id HAVING sum(l.credit - l.debit) <> 0`,
    sql`SELECT l.consignment_item_id AS id, ci.product_id, ci.size, r.name AS reseller,
          sum(CASE WHEN a.system_key = 'sales_reseller' THEN l.credit - l.debit ELSE 0 END) AS revenue,
          sum(CASE WHEN a.system_key IN ('reseller_commission', 'reseller_alteration') THEN l.debit - l.credit ELSE 0 END) AS selling_costs
        FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'Draft' JOIN fin_accounts a ON a.id = l.account_id
        JOIN consignment_items ci ON ci.id = l.consignment_item_id JOIN consignments c ON c.id = ci.consignment_id JOIN resellers r ON r.id = c.reseller_id
        WHERE e.entry_date BETWEEN ${f}::date AND ${t}::date GROUP BY 1, 2, 3, 4`,
    sql`SELECT oi.order_id, oi.product_id, oi.size, oi.quantity, o.order_number, o.channel, c.name AS customer FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN customers c ON c.id = o.customer_id`,
    sql`SELECT l.collection_id, a.system_key, a.code, a.name, sum(l.debit - l.credit) AS amount FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'Draft'
        JOIN fin_accounts a ON a.id = l.account_id AND a.type IN ('expense', 'cogs') WHERE l.collection_id IS NOT NULL AND e.entry_date BETWEEN ${f}::date AND ${t}::date
        GROUP BY 1, 2, 3, 4`,
    activeCards(), listPolicies(),
    sql`SELECT p.id, p.name, p.collection_id, c.name AS collection FROM products p LEFT JOIN collections c ON c.id = p.collection_id`,
    sql`SELECT DISTINCT order_id FROM customer_payments WHERE method = 'trax_cod'`,
  ])
  const prod = new Map(products.map((p) => [p.id, p]))
  const collName = new Map((await sql`SELECT id, name FROM collections`).map((c) => [c.id, c.name]))
  const pol = (cid) => policies.find((x) => x.collectionId === cid) || policies.find((x) => x.isDefault)
  const codOrders = new Set(cod.map((r) => r.order_id))
  const costOf = (pid, size) => { const c = cards.get(pid); return c ? pieceCost(c.lines.map((l) => ({ kind: l.kind, amount: l.amount })), pol(prod.get(pid)?.collection_id).sizeFactors, size) : null }

  const designs = new Map(), channels = new Map(), orders = []
  const design = (pid) => {
    if (!designs.has(pid)) { const p = prod.get(pid) || {}; designs.set(pid, { productId: pid, name: p.name || 'Unknown', collectionId: p.collection_id ?? null, collection: p.collection || '', units: 0, revenue: 0, cost: 0, selling: 0, missingCost: 0 }) }
    return designs.get(pid)
  }
  const channel = (k) => { if (!channels.has(k)) channels.set(k, { channel: k, units: 0, revenue: 0, cost: 0, selling: 0, missingCost: 0 }); return channels.get(k) }

  for (const r of orderRev) {
    const its = items.filter((i) => i.order_id === r.order_id)
    const revenue = P(r.revenue)
    const units = its.reduce((s, i) => s + i.quantity, 0) || 1
    let cost = 0, missing = 0
    const courier = codOrders.has(r.order_id) ? Math.round((revenue * pol(null).courierPct) / 100) : 0
    for (const i of its) {
      const c = i.product_id ? costOf(i.product_id, i.size) : null
      const share = Math.round((revenue * i.quantity) / units)
      const d = design(i.product_id)
      d.units += i.quantity; d.revenue += share
      if (c == null) { missing += i.quantity; d.missingCost += i.quantity } else { cost += c * i.quantity; d.cost += c * i.quantity }
      d.selling += Math.round((courier * i.quantity) / units)
    }
    const first = its[0] || {}
    const ch = channel(first.channel || 'Not recorded')
    ch.units += units; ch.revenue += revenue; ch.cost += cost; ch.selling += courier; ch.missingCost += missing
    orders.push({ orderId: r.order_id, orderNumber: first.order_number || '', customer: first.customer || '', channel: first.channel || '', revenue, cost, courier, missingCost: missing,
      contribution: revenue - cost - courier })
  }
  for (const r of resellerRev) {
    const revenue = P(r.revenue), selling = P(r.selling_costs), c = costOf(r.product_id, r.size)
    const d = design(r.product_id)
    d.units += 1; d.revenue += revenue; d.selling += selling
    const ch = channel(r.reseller)
    ch.units += 1; ch.revenue += revenue; ch.selling += selling
    if (c == null) { d.missingCost += 1; ch.missingCost += 1 } else { d.cost += c; ch.cost += c }
  }
  const fin = (x) => ({ ...x, contribution: x.revenue - x.cost - x.selling })
  const designRows = [...designs.values()].map(fin)
  // Collections: their designs plus costs tagged to the collection (shoot, ads, samples…)
  const colls = new Map()
  for (const d of designRows) {
    const k = d.collectionId ?? 0
    const c = colls.get(k) || { collectionId: d.collectionId, collection: d.collection || 'No collection', units: 0, revenue: 0, cost: 0, selling: 0, missingCost: 0, contribution: 0, tagged: [], taggedTotal: 0 }
    c.units += d.units; c.revenue += d.revenue; c.cost += d.cost; c.selling += d.selling; c.missingCost += d.missingCost; c.contribution += d.contribution
    colls.set(k, c)
  }
  for (const r of collCosts) {
    const c = colls.get(r.collection_id) || { collectionId: r.collection_id, collection: collName.get(r.collection_id) || 'Collection', units: 0, revenue: 0, cost: 0, selling: 0, missingCost: 0, contribution: 0, tagged: [], taggedTotal: 0 }
    c.tagged.push({ code: r.code, name: r.name, key: r.system_key, amount: P(r.amount) }); c.taggedTotal += P(r.amount)
    colls.set(r.collection_id, c)
  }
  const MARKETING = ['marketing_ads', 'pr_cost', 'photoshoots', 'events', 'packaging']
  const collectionRows = [...colls.values()].map((c) => {
    const allowance = P(pol(c.collectionId).allowance) * c.units
    const spent = c.tagged.filter((x) => MARKETING.includes(x.key)).reduce((s, x) => s + x.amount, 0)
    return { ...c, net: c.contribution - c.taggedTotal, allowanceCovered: allowance, marketingSpent: spent }
  })
  const out = (x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, typeof v === 'number' && ['revenue', 'cost', 'selling', 'contribution', 'courier', 'net', 'taggedTotal', 'allowanceCovered', 'marketingSpent', 'amount'].includes(k) ? money(v) : v]))
  return {
    from: f, to: t,
    collections: collectionRows.map((c) => out({ ...c, tagged: c.tagged.map(out) })).sort((a, b) => P(b.revenue) - P(a.revenue)),
    designs: designRows.map(out).sort((a, b) => P(b.revenue) - P(a.revenue)),
    channels: [...channels.values()].map(fin).map(out).sort((a, b) => P(b.revenue) - P(a.revenue)),
    orders: orders.map(out).sort((a, b) => P(b.revenue) - P(a.revenue)),
  }
}
