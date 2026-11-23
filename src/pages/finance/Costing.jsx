import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Calculator, Plus, Trash2, AlertTriangle, CheckCircle2, Save, FileDown, Ruler, Settings2, Scissors, Warehouse, Scale } from 'lucide-react'
import {
  getCostingDesigns, getCostingDesign, saveCostCard, activateCostCard, confirmPrice, getFabricLots, saveFabricLot, getLotMoves, addFabricMove,
  getPricingPolicies, savePricingPolicy, deletePricingPolicy, getProfit, getFinCollections, getSuppliers, PAID_FROM,
  getStockAt, getStockValuations, postStockValuation, getVariance,
} from '../../data/finance'
import { PageHeader, Modal, Field, Segmented, SkeletonRows, EmptyState, StatCard, fmtDate } from '../../ui/kit'
import { FinBadge, fmtRs, formatRs, safePaisa, todayPk } from './shared'
import { PeriodPicker, presetRange, Num, ReportSheet } from './reportKit'
import { downloadElementPdf } from '../../utils/statementPdf'

const TABS = [{ value: 'designs', label: 'Designs' }, { value: 'lots', label: 'Fabric lots' }, { value: 'stock', label: 'Stock value' }, { value: 'variance', label: 'Standard vs actual' },
  { value: 'profit', label: 'Profit' }, { value: 'policy', label: 'Pricing policy' }]
const KIND_LABELS = { fabric: 'Fabric', stitching: 'Stitching', extra: 'Extra (lace, buttons…)', outsourced: 'Outsourced (dye, embroidery…)', consumables: 'Consumables', overhead: 'Overhead' }
const pct = (v) => (v == null ? '—' : `${v.toFixed(1)}%`)

// What each design costs and what it should sell for (the owner's cost sheet method), and real profit
export default function Costing() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'designs'
  const [collections, setCollections] = useState([])
  const collectionId = params.get('collection') || ''
  useEffect(() => { getFinCollections().then(setCollections).catch(() => {}) }, [])
  const setColl = (v) => setParams({ tab, ...(v ? { collection: v } : {}) })
  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
      <PageHeader eyebrow="Finance" title="Costing & pricing" icon={Calculator}
        subtitle="Cost cards from the shoot cost sheet, fabric left in each lot, the price your margins give, and real profit by design and collection." />
      <div className="flex flex-wrap items-center gap-2">
        <div className="overflow-x-auto"><Segmented options={TABS} value={tab} onChange={(v) => setParams({ tab: v, ...(collectionId ? { collection: collectionId } : {}) })} /></div>
        {['designs', 'lots'].includes(tab) && (
          <select className="input w-auto" value={collectionId} onChange={(e) => setColl(e.target.value)}>
            <option value="">All collections</option>{collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>)}
      </div>
      {tab === 'lots' ? <Lots collectionId={collectionId} collections={collections} />
        : tab === 'stock' ? <StockValue />
        : tab === 'variance' ? <Variance />
        : tab === 'profit' ? <Profit />
        : tab === 'policy' ? <Policies collections={collections} />
        : <Designs collectionId={collectionId} />}
    </div>
  )
}

function Designs({ collectionId }) {
  const navigate = useNavigate()
  const [rows, setRows] = useState(null)
  const [onlyCosted, setOnlyCosted] = useState(true)
  useEffect(() => { setRows(null); getCostingDesigns(collectionId).then(setRows).catch((e) => toast.error(e.message)) }, [collectionId])
  if (!rows) return <SkeletonRows rows={6} />
  const shown = rows.filter((r) => !onlyCosted || r.hasCard)
  const below = rows.filter((r) => r.belowTarget).length
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2 text-muted"><input type="checkbox" checked={onlyCosted} onChange={(e) => setOnlyCosted(e.target.checked)} />Only designs with a cost card ({rows.filter((r) => r.hasCard).length} of {rows.length})</label>
        {below > 0 && <span className="flex items-center gap-1.5 text-rose-600"><AlertTriangle size={14} />{below} below the profit target</span>}
      </div>
      {shown.length === 0 ? <EmptyState icon={Calculator} title="No cost cards here yet" hint="Untick the box to see every design, then open one and enter its cost sheet." /> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-surface-accent text-left font-label text-[10.5px] uppercase tracking-wider text-ink">
              <tr><th className="px-4 py-2.5 font-medium">Design</th><th className="px-3 py-2.5 text-right font-medium">Production cost</th><th className="px-3 py-2.5 text-right font-medium">Unit cost</th>
                <th className="px-3 py-2.5 text-right font-medium">Price by policy</th><th className="px-3 py-2.5 text-right font-medium">Selling price</th>
                <th className="px-3 py-2.5 text-right font-medium">Margin</th><th className="px-4 py-2.5 text-right font-medium">On cost</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((r) => (
                <tr key={r.productId} className="cursor-pointer hover:bg-subtle/60" onClick={() => navigate(`/finance/costing/${r.productId}`)}>
                  <td className="px-4 py-2"><div className="flex items-center gap-3">
                    {r.imageUrl ? <img src={`${r.imageUrl}${r.imageUrl.includes('?') ? '&' : '?'}width=80`} alt="" className="h-11 w-9 rounded object-cover" /> : <div className="h-11 w-9 rounded bg-subtle2" />}
                    <div><p className="font-medium text-ink">{r.name}</p><p className="text-xs text-muted">{r.collection}{r.hasCard && ` · card v${r.cardVersion}`}</p></div></div></td>
                  {r.hasCard ? <>
                    <td className="px-3 py-2 text-right"><Num v={r.productionCost} /></td>
                    <td className="px-3 py-2 text-right"><Num v={r.unitCost} /></td>
                    <td className="px-3 py-2 text-right"><Num v={r.computedPrice} /></td>
                    <td className="px-3 py-2 text-right"><Num v={r.finalPrice || r.websitePrice} strong />{r.priceDiffers && <p className="text-[11px] text-amber-700">website {fmtRs(r.websitePrice, { decimals: false })}</p>}{!r.finalPrice && <p className="text-[11px] text-faint">website price</p>}</td>
                    <td className="px-3 py-2 text-right"><Num v={r.margin} /></td>
                    <td className={`px-4 py-2 text-right font-semibold tabular-nums ${r.belowTarget ? 'text-rose-600' : 'text-emerald-700 dark:text-emerald-400'}`}>{pct(r.marginOnCost)}
                      {r.reprice && <p className={`text-[11px] font-normal ${r.reprice.belowTarget ? 'text-rose-600' : 'text-muted'}`} title={`At current fabric prices the production cost is ${fmtRs(r.reprice.productionCost, { decimals: false })}`}>
                        now {pct(r.reprice.marginOnCost)}{r.reprice.belowTarget && ` · price ${fmtRs(r.reprice.suggestedPrice, { decimals: false })}`}</p>}</td>
                  </> : <td colSpan={6} className="px-3 py-2 text-xs text-muted">No cost card yet · website price {r.websitePrice ? fmtRs(r.websitePrice, { decimals: false }) : '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted">Unit cost = production cost + the marketing / packaging allowance. Margin is at the selling price after the courier's cut, which is taken on the price, not the cost. "Now" is the margin at current fabric prices (the average paid for each lot); in red with the price your policy would now ask when it falls below target.</p>
    </>
  )
}

// ── One design: cost card, price, history ──────────────────────────────
let seq = 0
export function CostDesign() {
  const { productId } = useParams()
  const [d, setD] = useState(null)
  const [lines, setLines] = useState(null)
  const [meta, setMeta] = useState({ source: '', effectiveFrom: todayPk(), notes: '' })
  const [finalPrice, setFinalPrice] = useState('')
  const [busy, setBusy] = useState(false)
  const sheet = useRef(null)
  const take = (x) => {
    setD(x)
    setLines((x.active?.lines || [{ kind: 'fabric' }, { kind: 'stitching', description: 'Stitching' }]).map((l) => ({ key: ++seq, kind: l.kind, description: l.description || '', lotId: l.lotId || '', quantity: l.quantity ?? '', rate: l.rate ?? '', amount: l.amount ?? '' })))
    setMeta({ source: x.active?.source || 'Shoot cost sheet', effectiveFrom: todayPk(), notes: '' })
    setFinalPrice(x.history[0]?.finalPrice ? String(Number(x.history[0].finalPrice)) : x.pricing ? String(Number(x.pricing.suggested)) : '')
  }
  const load = useCallback(() => getCostingDesign(productId).then(take).catch((e) => toast.error(e.message)), [productId])
  useEffect(() => { load() }, [load])
  const set = (key, p) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)))
  const lineAmount = (l) => (l.quantity !== '' && l.rate !== '' ? Math.round(Number(l.quantity) * safePaisa(l.rate)) : safePaisa(l.amount) || 0)
  const total = useMemo(() => (lines || []).reduce((s, l) => s + (lineAmount(l) || 0), 0), [lines])
  const dirty = d && lines && (total !== safePaisa(d.active?.productionCost || 0) || JSON.stringify(lines.map(({ key, ...l }) => l)) !== JSON.stringify((d.active?.lines || []).map((l) => ({ kind: l.kind, description: l.description, lotId: l.lotId || '', quantity: l.quantity ?? '', rate: l.rate ?? '', amount: l.amount ?? '' }))))
  if (!d || !lines) return <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8"><SkeletonRows rows={8} /></div>
  const pol = d.policy
  const fp = safePaisa(finalPrice) || 0
  const unit = d.pricing ? safePaisa(d.pricing.unitCost) : total + safePaisa(pol.allowance)
  const courier = Math.round((fp * pol.courierPct) / 100), margin = fp - unit - courier
  const act = async (fn, msg) => { setBusy(true); try { take(await fn()); toast.success(msg) } catch (err) { toast.error(err.message) } finally { setBusy(false) } }
  const saveCard = () => act(() => saveCostCard(d.productId, { ...meta, lines: lines.map(({ key, ...l }) => l) }), 'Cost card saved and in use')

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
      <PageHeader eyebrow={<Link to={`/finance/costing?collection=${d.collectionId || ''}`} className="hover:text-accent">Costing · {d.collection}</Link>} title={d.name} icon={Scissors}
        subtitle={d.active ? `Cost card v${d.active.version} from ${fmtDate(d.active.effectiveFrom)}${d.active.source ? ` · ${d.active.source}` : ''}` : 'No cost card yet: enter the cost sheet below'}
        actions={d.active && <button className="btn-secondary" onClick={() => downloadElementPdf(sheet.current, `Cost card ${d.name}.pdf`).catch((e) => toast.error(e.message))}><FileDown size={15} />Cost card PDF</button>} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="card space-y-3 p-5">
          <p className="section-title">Cost sheet</p>
          {lines.map((l) => (
            <div key={l.key} className="space-y-2 rounded-xl border border-line p-2">
              <div className="grid grid-cols-[minmax(0,150px)_minmax(0,1fr)_28px] gap-2">
                <select className="input py-1.5 text-sm" value={l.kind} onChange={(e) => set(l.key, { kind: e.target.value, lotId: e.target.value === 'fabric' ? l.lotId : '' })}>{Object.entries(KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v.split(' (')[0]}</option>)}</select>
                <input className="input py-1.5 text-sm" value={l.description} onChange={(e) => set(l.key, { description: e.target.value })} placeholder={l.kind === 'fabric' ? 'e.g. Fabric (Ivory velvet)' : 'e.g. Lace'} />
                <button type="button" className="btn-icon" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label="Remove"><Trash2 size={13} /></button>
              </div>
              <div className="grid grid-cols-3 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_70px_90px_100px] sm:pr-9">
                {l.kind === 'fabric' ? <select className="input col-span-3 py-1.5 text-sm sm:col-span-1" value={l.lotId} onChange={(e) => { const lot = d.lots.find((x) => String(x.id) === e.target.value); set(l.key, { lotId: e.target.value, rate: lot && l.rate === '' ? String(Number(lot.rate)) : l.rate, description: l.description || (lot ? `Fabric (${lot.name})` : '') }) }}>
                  <option value="">Fabric lot (optional)</option>{d.lots.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select> : <span className="hidden text-xs text-faint sm:block">Quantity × rate, or just the amount</span>}
                <input inputMode="decimal" className="input py-1.5 text-right text-sm" value={l.quantity} onChange={(e) => set(l.key, { quantity: e.target.value })} placeholder={l.kind === 'fabric' ? 'yards' : 'qty'} />
                <input inputMode="decimal" className="input py-1.5 text-right text-sm" value={l.rate} onChange={(e) => set(l.key, { rate: e.target.value })} placeholder="rate" />
                {l.quantity !== '' && l.rate !== '' ? <span className="text-right text-sm font-semibold tabular-nums text-ink">{formatRs(lineAmount(l), { symbol: '' })}</span>
                  : <input inputMode="decimal" className="input py-1.5 text-right text-sm" value={l.amount} onChange={(e) => set(l.key, { amount: e.target.value })} placeholder="amount" />}
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <button type="button" className="btn-ghost text-xs" onClick={() => setLines((ls) => [...ls, { key: ++seq, kind: 'extra', description: '', lotId: '', quantity: '', rate: '', amount: '' }])}><Plus size={12} />Add a line</button>
            <span className="text-sm text-muted">Production cost <b className="text-ink">{formatRs(total)}</b></span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Source"><input className="input" value={meta.source} onChange={(e) => setMeta({ ...meta, source: e.target.value })} placeholder="Shoot cost sheet (Usman)" /></Field>
            <Field label="From"><input type="date" className="input" value={meta.effectiveFrom} onChange={(e) => setMeta({ ...meta, effectiveFrom: e.target.value })} /></Field>
            <Field label="Notes"><input className="input" value={meta.notes} onChange={(e) => setMeta({ ...meta, notes: e.target.value })} /></Field>
          </div>
          <div className="flex justify-end"><button className="btn-primary" disabled={busy || (d.active && !dirty)} onClick={saveCard}><Save size={15} />{d.active ? 'Save as a new version' : 'Save cost card'}</button></div>
          {d.sizes.length > 0 && <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted"><Ruler size={13} />By size (fabric scales): {d.sizes.map((s) => <span key={s.size}>{s.size} {fmtRs(s.cost, { decimals: false })}</span>)}</p>}
        </section>

        <section className="card space-y-3 p-5">
          <p className="section-title">Price</p>
          {!d.pricing ? <p className="text-sm text-muted">Save the cost card to work out the price.</p> : <>
            <dl className="space-y-1.5 text-sm">
              <Row k="Production cost" v={d.active.productionCost} />
              <Row k={`Marketing / packaging allowance`} v={pol.allowance} />
              <Row k="Unit cost" v={d.pricing.unitCost} strong />
              <Row k={`Koko method · × ${(1 + (pol.profitPct + pol.courierPct) / 100).toFixed(2)}`} v={d.pricing.koko} hint={pol.method === 'koko' ? 'policy' : ''} />
              <Row k="Gross-up · recovers the courier % exactly" v={d.pricing.grossup} hint={pol.method === 'grossup' ? 'policy' : ''} />
              <Row k={`Suggested (rounded up to ${pol.roundTo})`} v={d.pricing.suggested} strong />
            </dl>
            <Field label="Final selling price (Rs)"><input inputMode="decimal" className="input text-lg font-semibold" value={finalPrice} onChange={(e) => setFinalPrice(e.target.value)} /></Field>
            <dl className="space-y-1.5 rounded-xl bg-subtle/60 p-3 text-sm">
              <Row k={`Courier ${pol.courierPct}% of the price`} v={(courier / 100).toFixed(2)} />
              <Row k="Margin" v={(margin / 100).toFixed(2)} strong />
              <div className="flex justify-between"><dt className="text-muted">On cost · of price</dt>
                <dd className={`font-semibold tabular-nums ${unit && margin / unit * 100 < pol.profitPct - 0.05 ? 'text-rose-600' : 'text-emerald-700 dark:text-emerald-400'}`}>{unit ? pct(margin / unit * 100) : '—'} · {fp ? pct(margin / fp * 100) : '—'}</dd></div>
            </dl>
            {unit && fp && margin / unit * 100 < pol.profitPct - 0.05 && <p className="flex gap-2 text-xs text-rose-600"><AlertTriangle size={13} className="mt-0.5 shrink-0" />Below the {pol.profitPct}% profit target on cost.</p>}
            {d.websitePrice && fp && safePaisa(d.websitePrice) !== fp && <p className="text-xs text-amber-700">The website sells it at {fmtRs(d.websitePrice)}. Change the price on Shopify too; the catalogue follows the website.</p>}
            <button className="btn-primary w-full" disabled={busy || !fp} onClick={() => act(() => confirmPrice(d.productId, { finalPrice }), 'Price confirmed')}><CheckCircle2 size={15} />Confirm this price</button>
            <p className="text-[11px] text-faint">Policy for {d.collection || 'this collection'}: allowance {fmtRs(pol.allowance, { decimals: false })}, profit {pol.profitPct}%, courier {pol.courierPct}%{pol.isDefault ? ' (default)' : ''}. Change it under Pricing policy.</p>
          </>}
        </section>
      </div>

      {d.history.length > 0 && (
        <section className="space-y-2">
          <h2 className="section-title">Price history</h2>
          <div className="card overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><tbody className="divide-y divide-line">
            {d.history.map((h) => (
              <tr key={h.id}><td className="whitespace-nowrap px-4 py-2 text-ink-soft">{fmtDate(h.approvedAt)}</td><td className="px-3 py-2 text-xs text-muted">unit cost {fmtRs(h.unitCost, { decimals: false })} · {h.method === 'grossup' ? 'gross-up' : `×${(1 + (h.profitPct + h.courierPct) / 100).toFixed(2)}`} → {fmtRs(h.computedPrice, { decimals: false })}{h.note && ` · ${h.note}`}{h.approvedBy && ` · ${h.approvedBy}`}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink">{fmtRs(h.finalPrice, { decimals: false })}</td><td className="px-4 py-2 text-right text-xs tabular-nums text-muted">{pct(h.marginOnCost)} on cost</td></tr>
            ))}
          </tbody></table></div>
        </section>
      )}
      {d.versions.length > 1 && (
        <section className="space-y-2">
          <h2 className="section-title">Cost card versions</h2>
          <div className="card divide-y divide-line">
            {d.versions.map((v) => (
              <div key={v.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
                <span className="font-semibold text-ink">v{v.version}</span><span className="flex-1 text-xs text-muted">{fmtDate(v.effectiveFrom)} · {v.source} · {v.lines.length} lines{v.createdBy && ` · ${v.createdBy}`}</span>
                <span className="tabular-nums text-ink">{fmtRs(v.productionCost, { decimals: false })}</span>
                {v.status === 'Active' ? <FinBadge status="Posted" /> : <button className="btn-secondary text-xs" disabled={busy} onClick={() => act(() => activateCostCard(v.id), `v${v.version} is now in use`)}>Use this one</button>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Printable cost card for the studio (off screen) */}
      {d.active && (
        <div className="pointer-events-none fixed -left-[9999px] top-0 w-[900px]">
          <ReportSheet ref={sheet} title={`Cost card · ${d.name}`} period={`${d.collection} · v${d.active.version} from ${fmtDate(d.active.effectiveFrom)}`}>
            <table className="w-full text-sm"><tbody className="divide-y divide-line">
              {d.active.lines.map((l) => <tr key={l.id}><td className="py-1.5 text-ink">{l.description}{l.lotName && <span className="text-muted"> · {l.lotName}</span>}</td>
                <td className="py-1.5 text-right text-muted">{l.quantity !== '' ? `${l.quantity} × ${fmtRs(l.rate, { decimals: false })}` : ''}</td><td className="py-1.5 text-right tabular-nums text-ink">{fmtRs(l.amount, { decimals: false })}</td></tr>)}
              <tr className="font-semibold"><td className="py-2">Production cost</td><td /><td className="py-2 text-right">{fmtRs(d.active.productionCost, { decimals: false })}</td></tr>
              {d.pricing && <><tr><td className="py-1.5">Marketing / packaging allowance</td><td /><td className="py-1.5 text-right">{fmtRs(pol.allowance, { decimals: false })}</td></tr>
                <tr className="font-semibold"><td className="py-2">Unit cost</td><td /><td className="py-2 text-right">{fmtRs(d.pricing.unitCost, { decimals: false })}</td></tr>
                {d.history[0] && <tr className="font-semibold"><td className="py-2">Selling price</td><td className="text-right text-xs font-normal text-muted">margin {pct(d.history[0].marginOnCost)} on cost</td><td className="py-2 text-right">{fmtRs(d.history[0].finalPrice, { decimals: false })}</td></tr>}</>}
            </tbody></table>
            {d.sizes.length > 0 && <p className="mt-3 text-xs text-muted">By size: {d.sizes.map((s) => `${s.size} ${fmtRs(s.cost, { decimals: false })}`).join(' · ')}</p>}
          </ReportSheet>
        </div>
      )}
    </div>
  )
}
const Row = ({ k, v, strong, hint }) => (
  <div className="flex justify-between gap-3"><dt className="text-muted">{k}{hint && <span className="ml-1.5 rounded-full bg-plum-50 px-1.5 text-[10px] font-semibold text-plum-700 dark:bg-plum-900/40 dark:text-plum-300">{hint}</span>}</dt>
    <dd className={`tabular-nums ${strong ? 'font-semibold text-ink' : 'text-ink-soft'}`}>{fmtRs(v)}</dd></div>
)

// ── Fabric lots ────────────────────────────────────────────────────────
function Lots({ collectionId, collections }) {
  const [rows, setRows] = useState(null)
  const [editing, setEditing] = useState(null)
  const [moving, setMoving] = useState(null)       // { lot, kind }
  const load = () => getFabricLots(collectionId).then(setRows).catch((e) => toast.error(e.message))
  useEffect(() => { setRows(null); load() }, [collectionId]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows) return <SkeletonRows rows={5} />
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-secondary" onClick={() => setEditing({ name: '', collectionId, unit: 'yard', rate: '', notes: '', isActive: true })}><Plus size={15} />Add fabric lot</button>
        <span className="text-xs text-muted">Yards used come from the cost cards: every outfit made (samples, reseller stock) and every order from In Tailoring on, with larger sizes using more.</span>
      </div>
      {rows.length === 0 ? <EmptyState icon={Ruler} title="No fabric lots" hint="Add each fabric bought for a collection, named as on the cost sheet." /> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-surface-accent text-left font-label text-[10.5px] uppercase tracking-wider text-ink">
              <tr><th className="px-4 py-2.5 font-medium">Fabric</th><th className="px-3 py-2.5 text-right font-medium">Rate</th><th className="px-3 py-2.5 text-right font-medium">Bought</th>
                <th className="px-3 py-2.5 text-right font-medium">Made</th><th className="px-3 py-2.5 text-right font-medium">Orders</th><th className="px-3 py-2.5 text-right font-medium">Left</th>
                <th className="px-3 py-2.5 font-medium">Covers</th><th className="px-4 py-2.5" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((l) => (
                <tr key={l.id} className={l.isActive ? '' : 'opacity-50'}>
                  <td className="px-4 py-2"><button className="text-left font-medium text-ink hover:text-accent" onClick={() => setEditing({ ...l, collectionId: l.collectionId ? String(l.collectionId) : '' })}>{l.name}</button><p className="text-xs text-muted">{l.collection}</p></td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-soft">{fmtRs(l.averageRate, { decimals: false })}<span className="text-xs text-muted">/{l.unit}</span></td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.bought || <span className="text-amber-700">enter</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-soft">{l.usedMade}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-soft">{l.usedOrders}</td>
                  <td className={`px-3 py-2 text-right font-semibold tabular-nums ${l.left < 0 ? 'text-rose-600' : 'text-ink'}`}>{l.left}</td>
                  <td className="px-3 py-2 text-xs text-muted">{l.designs.map((x) => `${x.name}: ${x.outfitsLeft ?? '—'}`).join(' · ') || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    <button className="btn-secondary mr-1 text-xs" onClick={() => setMoving({ lot: l, kind: 'purchase' })}>Bought</button>
                    <button className="btn-ghost text-xs" onClick={() => setMoving({ lot: l, kind: 'adjust' })}>Count</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <LotModal lot={editing} collections={collections} onClose={() => setEditing(null)} onSaved={(r) => { setRows(r); setEditing(null) }} />}
      {moving && <MoveModal {...moving} onClose={() => setMoving(null)} onSaved={(r) => { setRows(r); setMoving(null) }} />}
    </>
  )
}
function LotModal({ lot, collections, onClose, onSaved }) {
  const [b, setB] = useState({ ...lot, rate: lot.rate ? String(Number(lot.rate)) : '' })
  const [moves, setMoves] = useState(null)
  useEffect(() => { if (lot.id) getLotMoves(lot.id).then(setMoves).catch(() => {}) }, [lot.id])
  const save = async () => { try { onSaved(await saveFabricLot(lot.id, b)); toast.success('Saved') } catch (err) { toast.error(err.message) } }
  return (
    <Modal open onClose={onClose} title={lot.id ? lot.name : 'Add fabric lot'} footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save}>Save</button></>}>
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Name" hint="As the cost sheet calls it"><input className="input" value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} placeholder="Ivory velvet" /></Field>
        <Field label="Collection"><select className="input" value={b.collectionId || ''} onChange={(e) => setB({ ...b, collectionId: e.target.value })}><option value="">Any</option>{collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Rate (Rs)" hint="Per unit, before any purchases are recorded"><input inputMode="decimal" className="input" value={b.rate} onChange={(e) => setB({ ...b, rate: e.target.value })} /></Field>
        <Field label="Unit"><select className="input" value={b.unit} onChange={(e) => setB({ ...b, unit: e.target.value })}><option value="yard">Yard</option><option value="metre">Metre</option><option value="piece">Piece</option></select></Field>
        <Field label="Notes" className="sm:col-span-2"><input className="input" value={b.notes || ''} onChange={(e) => setB({ ...b, notes: e.target.value })} /></Field>
        {lot.id && <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={b.isActive} onChange={(e) => setB({ ...b, isActive: e.target.checked })} />In use</label>}
        {moves?.length > 0 && <div className="space-y-1 text-xs sm:col-span-2"><p className="section-title">Purchases and counts</p>{moves.map((m) => <p key={m.id} className="text-ink-soft">{fmtDate(m.date)} · {m.kind === 'purchase' ? `bought ${m.quantity} at ${fmtRs(m.rate, { decimals: false })}` : `count ${m.quantity > 0 ? '+' : ''}${m.quantity}`}{m.entryNo && ` · paid, ${m.entryNo}`}{m.note && ` · ${m.note}`}{m.by && ` · ${m.by}`}</p>)}</div>}
      </div>
    </Modal>
  )
}
function MoveModal({ lot, kind, onClose, onSaved }) {
  const [b, setB] = useState({ kind, quantity: '', rate: kind === 'purchase' ? String(Number(lot.rate)) : '', date: todayPk(), note: '', paidFrom: '', supplierId: '', reference: '' })
  const [suppliers, setSuppliers] = useState([])
  useEffect(() => { if (kind === 'purchase') getSuppliers().then(setSuppliers).catch(() => {}) }, [kind])
  const save = async () => { try { onSaved(await addFabricMove(lot.id, b)); toast.success('Saved') } catch (err) { toast.error(err.message) } }
  return (
    <Modal open size="sm" onClose={onClose} title={kind === 'purchase' ? `Bought: ${lot.name}` : `Count: ${lot.name}`} subtitle={kind === 'adjust' ? `The app thinks ${lot.left} ${lot.unit}s are left` : ''}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save}>Save</button></>}>
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label={kind === 'purchase' ? `${lot.unit}s bought` : `${lot.unit}s found (+) or lost (−)`}><input inputMode="decimal" autoFocus className="input" value={b.quantity} onChange={(e) => setB({ ...b, quantity: e.target.value })} /></Field>
        {kind === 'purchase' ? <Field label="Rate (Rs)"><input inputMode="decimal" className="input" value={b.rate} onChange={(e) => setB({ ...b, rate: e.target.value })} /></Field>
          : <Field label="Date"><input type="date" className="input" value={b.date} onChange={(e) => setB({ ...b, date: e.target.value })} /></Field>}
        {kind === 'purchase' && <>
          <Field label="Date"><input type="date" className="input" value={b.date} onChange={(e) => setB({ ...b, date: e.target.value })} /></Field>
          <Field label="Paid" hint={b.paidFrom ? `Booked as fabric bought: ${fmtRs((Number(b.quantity) || 0) * (Number(b.rate) || 0), { decimals: false })}` : 'Already entered as an expense? Leave this'}>
            <select className="input" value={b.paidFrom} onChange={(e) => setB({ ...b, paidFrom: e.target.value })}><option value="">Only record the yards</option>{Object.entries(PAID_FROM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          {b.paidFrom && <>
            <Field label="Supplier"><select className="input" value={b.supplierId} onChange={(e) => setB({ ...b, supplierId: e.target.value })}><option value="">{b.paidFrom === 'unpaid' ? 'Choose…' : 'None'}</option>{suppliers.filter((x) => x.isActive).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
            <Field label="Reference"><input className="input" value={b.reference} onChange={(e) => setB({ ...b, reference: e.target.value })} /></Field>
          </>}
        </>}
        <Field label={kind === 'adjust' ? 'Why' : 'Note'} className="sm:col-span-2"><input className="input" value={b.note} onChange={(e) => setB({ ...b, note: e.target.value })} placeholder={kind === 'adjust' ? 'e.g. Remnant too small to use' : ''} /></Field>
      </div>
    </Modal>
  )
}

// ── Profit ─────────────────────────────────────────────────────────────
function Profit() {
  const [period, setPeriod] = useState({ preset: 'fytd' })
  const range = presetRange(period.preset, period)
  const [d, setD] = useState(null)
  const [view, setView] = useState('collections')
  useEffect(() => { setD(null); getProfit(range).then(setD).catch((e) => toast.error(e.message)) }, [range.from, range.to]) // eslint-disable-line react-hooks/exhaustive-deps
  const cols = { collections: 'collection', designs: 'name', channels: 'channel' }
  const rows = d ? (view === 'orders' ? d.orders : d[view]) : []
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <PeriodPicker value={period} onChange={setPeriod} />
        <Segmented options={[{ value: 'collections', label: 'Collections' }, { value: 'designs', label: 'Designs' }, { value: 'channels', label: 'Channels' }, { value: 'orders', label: 'Orders' }]} value={view} onChange={setView} />
      </div>
      <p className="text-xs text-muted">Revenue from the books (orders paid and reseller sales in the period); cost from each design's cost card (standard cost). Contribution = revenue − cost − selling costs (courier on COD orders, reseller commission and alterations). Designs without a cost card are counted but carry no cost: add their cards for a true figure.</p>
      {!d ? <SkeletonRows rows={6} /> : rows.length === 0 ? <EmptyState icon={Calculator} title="No sales in this period" /> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-surface-accent text-left font-label text-[10.5px] uppercase tracking-wider text-ink">
              <tr><th className="px-4 py-2.5 font-medium">{view === 'orders' ? 'Order' : view.slice(0, -1).replace(/^./, (c) => c.toUpperCase())}</th>
                {view !== 'orders' && <th className="px-3 py-2.5 text-right font-medium">Units</th>}
                <th className="px-3 py-2.5 text-right font-medium">Revenue</th><th className="px-3 py-2.5 text-right font-medium">Cost</th>
                <th className="px-3 py-2.5 text-right font-medium">Selling costs</th><th className="px-3 py-2.5 text-right font-medium">Contribution</th>
                {view === 'collections' && <th className="px-4 py-2.5 text-right font-medium">After collection costs</th>}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r, i) => {
                const missing = r.missingCost > 0
                const margin = safePaisa(r.revenue) ? (safePaisa(r.contribution) / safePaisa(r.revenue)) * 100 : null
                return (
                  <tr key={i}>
                    <td className="px-4 py-2"><p className="font-medium text-ink">{view === 'orders' ? <Link to={`/orders/${r.orderId}`} className="hover:text-accent">{r.orderNumber}</Link> : r[cols[view]] || '—'}</p>
                      <p className="text-xs text-muted">{view === 'orders' ? `${r.customer} · ${r.channel || 'channel not recorded'}` : view === 'designs' ? r.collection : ''}{missing && <span className="text-amber-700"> · {r.missingCost} without a cost card</span>}</p></td>
                    {view !== 'orders' && <td className="px-3 py-2 text-right tabular-nums text-ink-soft">{r.units}</td>}
                    <td className="px-3 py-2 text-right"><Num v={r.revenue} /></td>
                    <td className="px-3 py-2 text-right"><Num v={r.cost} /></td>
                    <td className="px-3 py-2 text-right"><Num v={r.selling ?? r.courier} /></td>
                    <td className="px-3 py-2 text-right"><Num v={r.contribution} strong /><p className="text-[11px] text-muted">{margin == null ? '' : `${margin.toFixed(0)}%`}{missing ? ' · incomplete' : ''}</p></td>
                    {view === 'collections' && <td className="px-4 py-2 text-right"><Num v={r.net} />{safePaisa(r.taggedTotal) > 0 && <p className="text-[11px] text-muted">less {fmtRs(r.taggedTotal, { decimals: false })} tagged costs</p>}
                      {safePaisa(r.allowanceCovered) > 0 && safePaisa(r.cost) > 0 && <p className={`text-[11px] ${safePaisa(r.marketingSpent) > safePaisa(r.allowanceCovered) ? 'text-rose-600' : 'text-muted'}`}>marketing {fmtRs(r.marketingSpent, { decimals: false })} of {fmtRs(r.allowanceCovered, { decimals: false })} allowance</p>}</td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Pricing policy ─────────────────────────────────────────────────────
function Policies({ collections }) {
  const [rows, setRows] = useState(null)
  const [editing, setEditing] = useState(null)
  useEffect(() => { getPricingPolicies().then(setRows).catch((e) => toast.error(e.message)) }, [])
  const save = async () => { try { setRows(await savePricingPolicy(editing)); setEditing(null); toast.success('Saved') } catch (err) { toast.error(err.message) } }
  const remove = async (p) => { if (!window.confirm(`Use the default policy for ${p.collectionName}?`)) return; try { setRows(await deletePricingPolicy(p.collectionId)) } catch (err) { toast.error(err.message) } }
  if (!rows) return <SkeletonRows rows={3} />
  const used = new Set(rows.map((r) => r.collectionId))
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">Unit cost = production cost + allowance. Koko method: price = unit cost × (1 + profit % + courier %). Gross-up: unit cost × (1 + profit %) ÷ (1 − courier %), which recovers the courier's cut on the price exactly. The price is then rounded up and confirmed by you.</p>
      <div className="card divide-y divide-line">
        {rows.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
            <span className="w-44 font-medium text-ink">{p.isDefault ? 'Default (all collections)' : p.collectionName}</span>
            <span className="flex-1 text-xs text-ink-soft">allowance {fmtRs(p.allowance, { decimals: false })} · profit {p.profitPct}% · courier {p.courierPct}% · {p.method === 'grossup' ? 'gross-up' : 'Koko method'} · round to {p.roundTo}</span>
            <button className="btn-secondary text-xs" onClick={() => setEditing({ ...p, collectionId: p.collectionId || '', allowance: String(Number(p.allowance)) })}><Settings2 size={13} />Edit</button>
            {!p.isDefault && <button className="btn-icon hover:text-rose-600" onClick={() => remove(p)} aria-label="Remove"><Trash2 size={13} /></button>}
          </div>
        ))}
      </div>
      <button className="btn-ghost text-xs" onClick={() => setEditing({ collectionId: '', allowance: '3000', profitPct: 20, courierPct: 2, method: 'koko', roundTo: 500, isNew: true })}><Plus size={12} />Policy for a collection</button>
      {editing && (
        <Modal open onClose={() => setEditing(null)} title={editing.isDefault ? 'Default pricing policy' : editing.collectionName || 'Collection policy'} footer={<><button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button><button className="btn-primary" onClick={save}>Save</button></>}>
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            {editing.isNew && <Field label="Collection" className="sm:col-span-2"><select className="input" value={editing.collectionId} onChange={(e) => setEditing({ ...editing, collectionId: e.target.value })}><option value="">Choose…</option>{collections.filter((c) => !used.has(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
            <Field label="Marketing / packaging allowance per piece (Rs)"><input inputMode="decimal" className="input" value={editing.allowance} onChange={(e) => setEditing({ ...editing, allowance: e.target.value })} /></Field>
            <Field label="Profit % on cost"><input inputMode="decimal" className="input" value={editing.profitPct} onChange={(e) => setEditing({ ...editing, profitPct: e.target.value })} /></Field>
            <Field label="Courier % of the price"><input inputMode="decimal" className="input" value={editing.courierPct} onChange={(e) => setEditing({ ...editing, courierPct: e.target.value })} /></Field>
            <Field label="Round up to the next"><input inputMode="numeric" className="input" value={editing.roundTo} onChange={(e) => setEditing({ ...editing, roundTo: e.target.value })} /></Field>
            <Field label="Method" className="sm:col-span-2"><select className="input" value={editing.method} onChange={(e) => setEditing({ ...editing, method: e.target.value })}><option value="koko">Koko method (× 1 + profit + courier)</option><option value="grossup">Gross-up (recovers the courier % exactly)</option></select></Field>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── Stock value (month end) ────────────────────────────────────────────
const BUCKET_LABELS = { materials: ['1300 Fabric left', 'Yards left in each lot at the average price paid'], wip: ['1310 Being stitched', 'Orders started and not yet paid'],
  studio: ['1320 At the studio', 'Finished pieces and samples; damaged ones at their asking price if lower'], reseller: ['1330 At resellers', 'Pieces at the reseller\'s store'] }
const monthEndOf = (m) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10)
function StockValue() {
  const [month, setMonth] = useState(todayPk().slice(0, 7))
  const [d, setD] = useState(null)
  const [hist, setHist] = useState([])
  const [busy, setBusy] = useState(false)
  const asOf = monthEndOf(month) > todayPk() ? todayPk() : monthEndOf(month)
  const load = () => { setD(null); getStockAt(asOf).then(setD).catch((e) => toast.error(e.message)); getStockValuations().then(setHist).catch(() => {}) }
  useEffect(() => { load() }, [asOf]) // eslint-disable-line react-hooks/exhaustive-deps
  const posted = hist.find((h) => h.month === month)
  const post = async () => {
    setBusy(true)
    try { const r = await postStockValuation(month); toast.success(r.entryNo ? `Stock value posted: ${r.entryNo}` : 'Stock value recorded; the books already matched'); load() }
    catch (err) { toast.error(err.message) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input type="month" className="input w-auto" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />
        <button className="btn-primary" onClick={post} disabled={busy || !d}><Warehouse size={15} />{busy ? 'Posting…' : posted ? `Value again and update ${month}` : `Post stock value for ${month}`}</button>
        {posted && <span className="text-xs text-muted">Posted {fmtDate(posted.updatedAt)}{posted.entryNo && ` · ${posted.entryNo}`}</span>}
      </div>
      <p className="text-xs text-muted">Fabric, wages and outsourced work go to cost of sales when paid. At each month end the stock still held is valued and the stock accounts are moved to that value against 5050 Change in inventories, so cost of sales = what was spent less what is still in stock. Value {asOf < monthEndOf(month) ? 'so far this month' : `at ${fmtDate(asOf)}`}; posting dates it {fmtDate(monthEndOf(month))}. Running it again replaces the month's entry.</p>
      {!d ? <SkeletonRows rows={6} /> : <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {Object.keys(BUCKET_LABELS).map((k) => <StatCard key={k} label={BUCKET_LABELS[k][0]} value={safePaisa(d.buckets[k].value) / 100} prefix="Rs " />)}
          <StatCard label="Total stock" value={safePaisa(d.total) / 100} prefix="Rs " sub={`${d.pieces} pieces`} />
        </div>
        {d.missing.length > 0 && (
          <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            <p className="flex items-center gap-2 font-semibold"><AlertTriangle size={14} />{d.missing.reduce((s, m) => s + m.pieces, 0)} pieces of {d.missing.length} designs have no cost card, so they count as nothing. Stock is understated until their cards are entered:</p>
            <p className="mt-1">{d.missing.map((m, i) => <span key={m.productId}>{i > 0 && ' · '}<Link className="underline" to={`/finance/costing/${m.productId}`}>{m.name}</Link> ({m.pieces})</span>)}</p>
          </div>
        )}
        {Object.keys(BUCKET_LABELS).map((k) => d.buckets[k].rows.length > 0 && (
          <section key={k} className="space-y-2">
            <h2 className="section-title">{BUCKET_LABELS[k][0]} · {BUCKET_LABELS[k][1]}</h2>
            <div className="card overflow-x-auto"><table className="w-full min-w-[560px] text-sm"><tbody className="divide-y divide-line">
              {d.buckets[k].rows.map((r, i) => (
                <tr key={i}>
                  <td className="px-4 py-2"><p className="font-medium text-ink">{r.productId ? <Link to={`/finance/costing/${r.productId}`} className="hover:text-accent">{r.name}</Link> : r.name}</p><p className="text-xs text-muted">{[r.collection, r.size, r.note].filter(Boolean).join(' · ')}</p></td>
                  <td className="px-3 py-2 text-right text-xs text-muted">{k === 'materials' ? `${r.quantity} ${r.unit}s × ${fmtRs(r.rate, { decimals: false })}` : `${r.pieces} × ${r.unitCost == null ? 'no cost card' : fmtRs(r.unitCost, { decimals: false })}`}</td>
                  <td className="px-4 py-2 text-right"><Num v={r.value} strong /></td>
                </tr>
              ))}
            </tbody></table></div>
          </section>
        ))}
      </>}
      {hist.length > 0 && (
        <section className="space-y-2">
          <h2 className="section-title">Posted stock values</h2>
          <div className="card divide-y divide-line">
            {hist.map((h) => (
              <div key={h.month} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
                <span className="w-24 font-medium text-ink">{h.month}</span><span className="flex-1 text-xs text-muted">{h.pieces} pieces{h.missing.length ? ` · ${h.missing.length} designs without a cost card` : ''}{h.by && ` · ${h.by}`}</span>
                <span className="tabular-nums text-ink">{fmtRs(h.total, { decimals: false })}</span>{h.entryNo && <Link to={`/finance/journals/${h.entryId}`} className="font-mono text-xs text-accent">{h.entryNo}</Link>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ── Standard vs actual ─────────────────────────────────────────────────
const ELEMENTS = { materials: ['Materials', 'Fabric and extras (5100)'], labour: ['Labour', 'Production wages (5200)'], outsourced: ['Outsourced', 'Dye, embroidery… (5300)'], consumables: ['Consumables', 'Thread, needles… (5410)'] }
function Variance() {
  const [month, setMonth] = useState(todayPk().slice(0, 7))
  const [d, setD] = useState(null)
  useEffect(() => { setD(null); getVariance(month).then(setD).catch((e) => toast.error(e.message)) }, [month])
  return (
    <div className="space-y-4">
      <input type="month" className="input w-auto" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />
      <p className="text-xs text-muted">Standard: the outfits started this month (studio pieces made, reseller pieces handed over, orders begun) at their cost cards. Actual: what was booked to each cost account this month. A positive variance means more was spent than the cost cards allow; timing (fabric bought for later) shows here too.</p>
      {!d ? <SkeletonRows rows={5} /> : <>
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-surface-accent text-left font-label text-[10.5px] uppercase tracking-wider text-ink">
              <tr><th className="px-4 py-2.5 font-medium">Element</th><th className="px-3 py-2.5 text-right font-medium">Standard</th><th className="px-3 py-2.5 text-right font-medium">Actual</th><th className="px-4 py-2.5 text-right font-medium">Variance</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {d.rows.map((r) => (
                <tr key={r.element}><td className="px-4 py-2"><p className="font-medium text-ink">{ELEMENTS[r.element][0]}</p><p className="text-xs text-muted">{ELEMENTS[r.element][1]}</p></td>
                  <td className="px-3 py-2 text-right"><Num v={r.standard} /></td><td className="px-3 py-2 text-right"><Num v={r.actual} /></td>
                  <td className={`px-4 py-2 text-right font-semibold tabular-nums ${safePaisa(r.variance) > 0 ? 'text-rose-600' : 'text-emerald-700 dark:text-emerald-400'}`}>{fmtRs(r.variance, { decimals: false })}</td></tr>
              ))}
              <tr className="border-t-2 border-ink/70 font-semibold"><td className="px-4 py-2 text-ink">Total</td><td className="px-3 py-2 text-right"><Num v={d.total.standard} strong /></td><td className="px-3 py-2 text-right"><Num v={d.total.actual} strong /></td>
                <td className="px-4 py-2 text-right tabular-nums text-ink">{fmtRs((safePaisa(d.total.actual) - safePaisa(d.total.standard)) / 100, { decimals: false })}</td></tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">{d.pieces} outfits at standard{d.uncosted ? `; ${d.uncosted} more have no cost card and are left out` : ''}.</p>
        <section className="card space-y-2 p-4 text-sm">
          <p className="flex items-center gap-2 font-semibold text-ink"><Scale size={15} />Labour by the hours logged in payroll</p>
          {!d.labour.hours ? <p className="text-muted">No hours by job were logged in this month's posted payroll weeks. Split each week's hours by job (Payroll › week › hours) to see labour per order.</p> : <>
            <p className="text-ink-soft">{d.labour.hours} hours logged · {fmtRs(d.labour.rate)} an hour · idle {d.labour.idle} hours ({fmtRs(d.labour.idleCost, { decimals: false })} of capacity not used)</p>
            {d.labour.orders.length > 0 && <div className="divide-y divide-line">{d.labour.orders.map((o) => <p key={o.orderNumber} className="flex justify-between py-1 text-xs"><span className="text-ink">{o.orderNumber}</span><span className="text-muted">{o.hours} h · {fmtRs(o.cost, { decimals: false })}</span></p>)}</div>}
          </>}
        </section>
      </>}
    </div>
  )
}
