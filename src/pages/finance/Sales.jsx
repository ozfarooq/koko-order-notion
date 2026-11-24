import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Banknote, RefreshCw, AlertTriangle, CheckCircle2, FileText, Trash2, HandCoins, Plus, Upload, Truck, Ban } from 'lucide-react'
import { getReceivables, getSyncExceptions, syncBatch, retrySync, keepAdvance, getFxRates, setFxRate, deleteFxRate, getTraxSettlements, previewTrax, importTrax, voidTrax, readTraxFile } from '../../data/finance'
import { PageHeader, Segmented, SkeletonRows, EmptyState, StatCard, Field, fmtDate } from '../../ui/kit'
import { fmtRs, safePaisa, todayPk, askReason } from './shared'
import { Num } from './reportKit'
import { Statement } from './People'
import { useAuth } from '../../auth/AuthContext'

const TABS = [{ value: 'status', label: 'Posting status' }, { value: 'receivables', label: 'Receivables' }, { value: 'trax', label: 'Trax settlements' }, { value: 'rates', label: 'Exchange rates' }]

// Sales, customer payments and reseller statements post themselves; this is where to see that they did,
// fix what is waiting, and see who owes what
export default function Sales() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'status'
  const [statement, setStatement] = useState(null)
  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
      <PageHeader eyebrow="Finance" title="Sales & receipts" icon={Banknote} subtitle="Orders, customer payments and reseller statements post to the books on their own. Check here that nothing is waiting." />
      <Segmented options={TABS} value={tab} onChange={(v) => setParams({ tab: v })} />
      {tab === 'receivables' ? <Receivables onStatement={setStatement} /> : tab === 'rates' ? <Rates /> : tab === 'trax' ? <TraxSettlements /> : <Status onStatement={setStatement} />}
      {statement && <Statement {...statement} onClose={() => setStatement(null)} />}
    </div>
  )
}

function Status({ onStatement }) {
  const { user } = useAuth()
  const [exc, setExc] = useState(null)
  const [rates, setRates] = useState(null)
  const [rec, setRec] = useState(null)
  const [busy, setBusy] = useState('')
  const load = useCallback(() => {
    getSyncExceptions().then(setExc).catch((e) => toast.error(e.message))
    getFxRates().then(setRates).catch(() => {})
    getReceivables().then(setRec).catch(() => {})
  }, [])
  useEffect(() => { load() }, [load])

  const checkAll = async () => {
    let after = '', done = 0, failed = 0
    try {
      for (;;) {
        setBusy(`Checking… ${done}`)
        const r = await syncBatch(after)
        done += r.done; failed += r.failed.length
        if (!r.next) break
        after = r.next
      }
      toast.success(failed ? `Checked ${done}; ${failed} waiting` : `Checked ${done}: the books match the CRM`)
    } catch (err) { toast.error(err.message) } finally { setBusy(''); load() }
  }
  const retry = async (x) => {
    setBusy(`Retrying ${x.label || ''}`)
    try { await retrySync(x.sourceType, x.sourceId); toast.success('Posted') } catch (err) { toast.error(err.message) } finally { setBusy(''); load() }
  }
  const keep = async (o) => {
    const r = askReason(`Keep ${o.orderNumber}'s advance of ${fmtRs(o.advance)} instead of refunding it? It becomes other income.`)
    if (!r) return
    try { await keepAdvance(o.id, r); toast.success('Advance kept'); load() } catch (err) { toast.error(err.message) }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" onClick={checkAll} disabled={!!busy}><RefreshCw size={15} className={busy ? 'animate-spin' : ''} />Check everything now</button>
        <span className="text-sm text-muted">{busy || 'Compares every order and reseller statement since go-live with the books, and posts or corrects what differs. Safe to run any time.'}</span>
      </div>

      {rates?.missing.length > 0 && <MissingRates missing={rates.missing} hints={rates.paymentRates} onSaved={load} />}

      <section className="space-y-2">
        <h2 className="section-title">Waiting to post</h2>
        {!exc ? <SkeletonRows rows={2} /> : exc.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400"><CheckCircle2 size={15} />Nothing waiting: every order and reseller statement is in the books.</p>
        ) : (
          <div className="card divide-y divide-line">
            {exc.map((x) => (
              <div key={`${x.sourceType}${x.sourceId}`} className="flex flex-wrap items-start gap-3 px-4 py-3 text-sm">
                <AlertTriangle size={15} className="mt-0.5 text-amber-600" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">{x.sourceType === 'order' ? <Link className="hover:text-accent" to={`/orders/${x.sourceId}`}>{x.label || 'Order'}</Link> : x.label || 'Reseller'}</p>
                  <p className="text-xs text-muted">{x.error}</p>
                  <p className="text-[11px] text-faint">{x.attempts} attempt{x.attempts === 1 ? '' : 's'} · last {fmtDate(x.lastAt)}</p>
                </div>
                <button className="btn-secondary text-xs" disabled={!!busy} onClick={() => retry(x)}>Retry</button>
              </div>
            ))}
          </div>
        )}
      </section>

      {rec?.refundsDue.length > 0 && (
        <section className="space-y-2">
          <h2 className="section-title">Advances on cancelled or returned orders</h2>
          <p className="text-xs text-muted">Refund the customer (record a refund on the order), or an owner can keep the advance with a reason.</p>
          <div className="card divide-y divide-line">
            {rec.refundsDue.map((o) => (
              <div key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <Link to={`/orders/${o.id}`} className="font-medium text-ink hover:text-accent">{o.orderNumber}</Link>
                <span className="flex-1 text-muted">{o.customer} · {o.status}</span>
                <span className="font-semibold tabular-nums text-ink">{fmtRs(o.advance)}</span>
                <Link to={`/orders/${o.id}`} className="btn-secondary text-xs">Refund</Link>
                {user?.role === 'owner' && <button className="btn-secondary text-xs" onClick={() => keep(o)}><HandCoins size={13} />Keep</button>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function MissingRates({ missing, hints, onSaved }) {
  const [vals, setVals] = useState({})
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      for (const m of missing) { const v = vals[`${m.date}${m.currency}`]; if (v) await setFxRate({ date: m.date, currency: m.currency, rate: v }) }
      toast.success('Rates saved; waiting sales posted'); onSaved()
    } catch (err) { toast.error(err.message) } finally { setBusy(false) }
  }
  return (
    <section className="card space-y-3 border-amber-300 p-4 dark:border-amber-800">
      <p className="flex items-center gap-2 text-sm font-semibold text-ink"><AlertTriangle size={15} className="text-amber-600" />Exchange rates needed for reseller sales</p>
      <p className="text-xs text-muted">Each sale is converted at the rate on its sale date (State Bank or your bank's rate). A rate covers its date and every later date until the next one.
        {hints.length > 0 && ` Rates your payments came in at: ${hints.slice(0, 3).map((h) => `${h.rate} (${fmtDate(h.date)})`).join(', ')}.`}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {missing.map((m) => (
          <label key={`${m.date}${m.currency}`} className="flex items-center gap-2 text-sm">
            <span className="w-32 text-ink-soft">{fmtDate(m.date)}</span>
            <input inputMode="decimal" className="input w-28 py-1.5" placeholder={`PKR per ${m.currency}`} value={vals[`${m.date}${m.currency}`] || ''} onChange={(e) => setVals({ ...vals, [`${m.date}${m.currency}`]: e.target.value })} />
          </label>
        ))}
      </div>
      <div className="flex justify-end"><button className="btn-primary" onClick={save} disabled={busy || !Object.values(vals).some(Boolean)}>{busy ? 'Saving…' : 'Save rates'}</button></div>
    </section>
  )
}

function Receivables({ onStatement }) {
  const [d, setD] = useState(null)
  useEffect(() => { getReceivables().then(setD).catch((e) => toast.error(e.message)) }, [])
  if (!d) return <SkeletonRows rows={6} />
  const due = d.openOrders.reduce((s, o) => s + safePaisa(o.balance), 0)
  const advCheck = safePaisa(d.advancesHeldCrm) - safePaisa(d.advancesLedger)
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Resellers owe (in the books)" value={d.resellers.reduce((s, r) => s + safePaisa(r.ledgerPkr), 0) / 100} prefix="Rs " />
        <StatCard label="Balance due on open orders" value={due / 100} prefix="Rs " />
        <StatCard label="Advances held (orders)" value={safePaisa(d.advancesHeldCrm) / 100} prefix="Rs " />
        <StatCard label="Advances in the books (2200)" value={safePaisa(d.advancesLedger) / 100} prefix="Rs " sub={advCheck ? 'Differs from the orders: see below' : 'Matches the orders'} />
      </div>
      {advCheck !== 0 && <p className="flex gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"><AlertTriangle size={14} className="mt-0.5 shrink-0" />
        Advances on the orders and in the books differ by {fmtRs(Math.abs(advCheck) / 100)}. Advances paid before go-live are only in the books once the opening balances include them (customer advances at 30 June 2026).</p>}

      <section className="space-y-2">
        <h2 className="section-title">Resellers: sold, not yet paid</h2>
        {d.resellers.length === 0 ? <p className="text-sm text-muted">Nothing owed.</p> : (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-surface-accent text-left font-label text-[10.5px] uppercase tracking-wider text-ink">
                <tr><th className="px-4 py-2.5 font-medium">Reseller</th><th className="px-3 py-2.5 text-right font-medium">0–30 days</th><th className="px-3 py-2.5 text-right font-medium">31–60</th>
                  <th className="px-3 py-2.5 text-right font-medium">61–90</th><th className="px-3 py-2.5 text-right font-medium">Over 90</th><th className="px-3 py-2.5 text-right font-medium">Total</th>
                  <th className="px-3 py-2.5 text-right font-medium">In the books (PKR)</th><th className="px-4 py-2.5" /></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {d.resellers.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2.5"><p className="font-medium text-ink">{r.name}</p><p className="text-xs text-muted">{r.pieces} piece{r.pieces === 1 ? '' : 's'} · {r.currency}</p></td>
                    {['b30', 'b60', 'b90', 'b90p', 'total'].map((k) => <td key={k} className="px-3 py-2.5 text-right"><Num v={r[k]} strong={k === 'total'} /></td>)}
                    <td className="px-3 py-2.5 text-right"><Num v={r.ledgerPkr} /></td>
                    <td className="px-4 py-2.5 text-right"><button className="btn-icon" title="Statement" onClick={() => onStatement({ type: 'reseller', id: r.id, name: r.name })}><FileText size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted">Ageing is by sale date, in the reseller's currency (what Koko receives after commission and alterations). "In the books" includes only sales since go-live and is shown in rupees; bracketed would mean the reseller has paid ahead.</p>
      </section>

      <section className="space-y-2">
        <h2 className="section-title">Customers: open orders</h2>
        {d.openOrders.length === 0 ? <EmptyState icon={Banknote} title="No open orders" /> : (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-surface-accent text-left font-label text-[10.5px] uppercase tracking-wider text-ink">
                <tr><th className="px-4 py-2.5 font-medium">Order</th><th className="px-3 py-2.5 font-medium">Customer</th><th className="px-3 py-2.5 text-right font-medium">Total</th>
                  <th className="px-3 py-2.5 text-right font-medium">Advance</th><th className="px-3 py-2.5 text-right font-medium">Balance</th><th className="px-4 py-2.5" /></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {d.openOrders.map((o) => (
                  <tr key={o.id}>
                    <td className="px-4 py-2.5"><Link to={`/orders/${o.id}`} className="font-medium text-ink hover:text-accent">{o.orderNumber}</Link><p className="text-xs text-muted">{o.status} · {fmtDate(o.orderDate)}</p></td>
                    <td className="px-3 py-2.5 text-ink-soft">{o.customer}</td>
                    <td className="px-3 py-2.5 text-right"><Num v={o.amount} /></td>
                    <td className="px-3 py-2.5 text-right"><Num v={o.advance} /></td>
                    <td className="px-3 py-2.5 text-right"><Num v={o.balance} strong /></td>
                    <td className="px-4 py-2.5 text-right"><button className="btn-icon" title="Statement" onClick={() => onStatement({ type: 'customer', id: o.customerId, name: o.customer })}><FileText size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted">Sales count once the order is Paid (Finance settings). Until then what the customer has paid is an advance the studio holds.</p>
      </section>
    </div>
  )
}

function Rates() {
  const [d, setD] = useState(null)
  const [b, setB] = useState({ date: todayPk(), currency: 'AED', rate: '' })
  const load = () => getFxRates().then(setD).catch((e) => toast.error(e.message))
  useEffect(() => { load() }, [])
  const save = async () => { try { setD(await setFxRate(b)); setB({ ...b, rate: '' }); toast.success('Saved') } catch (err) { toast.error(err.message) } }
  const remove = async (r) => { if (!window.confirm(`Delete the ${r.currency} rate of ${fmtDate(r.date)}?`)) return; try { setD(await deleteFxRate(r)) } catch (err) { toast.error(err.message) } }
  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <Field label="Date"><input type="date" className="input" value={b.date} onChange={(e) => setB({ ...b, date: e.target.value })} /></Field>
        <Field label="Currency"><input className="input w-24 uppercase" maxLength={3} value={b.currency} onChange={(e) => setB({ ...b, currency: e.target.value.toUpperCase() })} /></Field>
        <Field label="PKR for 1"><input inputMode="decimal" className="input w-32" value={b.rate} onChange={(e) => setB({ ...b, rate: e.target.value })} placeholder="e.g. 76.45" /></Field>
        <button className="btn-primary" onClick={save} disabled={!b.rate}>Save rate</button>
      </div>
      <p className="text-xs text-muted">A rate applies to its date and later dates until the next rate. Reseller sales are converted at their sale date; a payment's own rupee amount is what reached the bank, and the difference is the exchange gain or loss.</p>
      {!d ? <SkeletonRows rows={4} /> : d.rates.length === 0 ? <EmptyState icon={Banknote} title="No rates yet" hint="Add the AED rate for the dates of Collage's sales." /> : (
        <div className="card divide-y divide-line">
          {d.rates.map((r) => (
            <div key={`${r.date}${r.currency}`} className="flex items-center gap-3 px-4 py-2 text-sm">
              <span className="w-32 text-ink-soft">{fmtDate(r.date)}</span><span className="w-16 font-mono text-xs text-muted">{r.currency}</span>
              <span className="flex-1 font-semibold tabular-nums text-ink">{r.rate}</span>
              <button className="btn-icon hover:text-rose-600" onClick={() => remove(r)} aria-label="Delete"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Trax settlements ───────────────────────────────────────────────────
// Paste the Trax "Payment Details / Sales Tax Invoice" page (select all, copy) or upload it; check; import
function TraxSettlements() {
  const [list, setList] = useState(null)
  const [f, setF] = useState(null)              // { text, date, invoiceNo, ibft, payable }
  const [pv, setPv] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => getTraxSettlements().then(setList).catch((e) => toast.error(e.message)), [])
  useEffect(() => { load() }, [load])
  const preview = async (next = f) => {
    setBusy(true)
    try {
      const r = await previewTrax(next); setPv(r)
      setF((x) => ({ ...x, invoiceNo: x.invoiceNo || r.invoiceNo || '', date: x.date || r.date, ibft: x.ibft || (safePaisa(r.totals.ibft) ? r.totals.ibft : ''), payable: x.payable || r.totals.payable }))
    } catch (err) { toast.error(err.message); setPv(null) } finally { setBusy(false) }
  }
  const pick = async (file) => { try { const text = await readTraxFile(file); const next = { text, date: '', invoiceNo: '', ibft: '', payable: '' }; setF(next); preview(next) } catch (err) { toast.error(err.message) } }
  const doImport = async () => {
    setBusy(true)
    try { const s = await importTrax(f); toast.success(`Trax invoice ${s.invoiceNo} imported · ${s.entryNo}`); setF(null); setPv(null); load() }
    catch (err) { toast.error(err.message) } finally { setBusy(false) }
  }
  const undo = async (s) => {
    const r = window.prompt(`Undo Trax invoice ${s.invoiceNo}? The entry is reversed; COD payments already set on orders stay.\n\nReason (kept on the record):`)
    if (!r || !r.trim()) return
    try { setList(await voidTrax(s.id, r.trim())) } catch (err) { toast.error(err.message) }
  }
  const sum = (...v) => String(v.reduce((s, x) => s + safePaisa(x || 0), 0) / 100)
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-sm text-muted">Open the payment's invoice on the Trax portal, select all and copy it, then paste here (or upload the saved page or a spreadsheet). The page is read here; nothing is sent anywhere.</p>
        {!f && <button className="btn-primary" onClick={() => setF({ text: '', date: '', invoiceNo: '', ibft: '', payable: '' })}><Plus size={15} />Import a settlement</button>}
      </div>
      {f && (
        <div className="card space-y-3 p-4">
          <textarea className="input min-h-[120px] font-mono text-xs" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} placeholder="Paste the Trax invoice page here" />
          <div className="flex flex-wrap items-end gap-3">
            <label className="btn-secondary cursor-pointer"><Upload size={15} />Upload file<input type="file" accept=".html,.htm,.xlsx,.xls,.csv,.txt" className="sr-only" onChange={(e) => e.target.files[0] && pick(e.target.files[0])} /></label>
            <Field label="Invoice no."><input className="input w-32" value={f.invoiceNo} onChange={(e) => setF({ ...f, invoiceNo: e.target.value })} /></Field>
            <Field label="Reached the bank on"><input type="date" className="input" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            <Field label="IBFT charge"><input className="input w-24" inputMode="decimal" value={f.ibft} onChange={(e) => setF({ ...f, ibft: e.target.value })} /></Field>
            <Field label="Total payable"><input className="input w-32" inputMode="decimal" value={f.payable} onChange={(e) => setF({ ...f, payable: e.target.value })} /></Field>
            <div className="flex-1" />
            <button className="btn-secondary" onClick={() => { setF(null); setPv(null) }}>Cancel</button>
            <button className="btn-secondary" onClick={() => preview()} disabled={busy || !f.text.trim()}>Check</button>
            <button className="btn-primary" onClick={doImport} disabled={busy || !pv || pv.problems.length > 0}>Import</button>
          </div>
          {pv && <>
            {pv.problems.length > 0 && <div className="rounded-xl bg-rose-50 p-3 text-xs text-rose-800 dark:bg-rose-950/40 dark:text-rose-300">{pv.problems.map((p) => <p key={p}>{p}</p>)}</div>}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <StatCard label="Cash collected" value={safePaisa(pv.totals.collection) / 100} prefix="Rs " />
              <StatCard label="Charges + GST" value={safePaisa(sum(pv.totals.charges, pv.totals.gst, pv.totals.other)) / 100} prefix="Rs " />
              <StatCard label="WHT + COD sales tax" value={safePaisa(sum(pv.totals.wht, pv.totals.sst)) / 100} prefix="Rs " />
              <StatCard label="IBFT" value={safePaisa(pv.totals.ibft) / 100} prefix="Rs " sub={safePaisa(pv.totals.rounding) ? `rounding ${fmtRs(pv.totals.rounding)}` : ''} />
              <StatCard label="Paid to the bank" value={safePaisa(pv.totals.payable) / 100} prefix="Rs " />
            </div>
            <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead className="text-left text-[11px] uppercase tracking-wider text-muted"><tr>
              <th className="px-3 py-2">Shipment</th><th className="px-2 py-2">Order</th><th className="px-2 py-2 text-right">Collected</th><th className="px-2 py-2 text-right">Charges</th><th className="px-2 py-2 text-right">Deducted</th><th className="px-2 py-2 text-right">Paid out</th><th className="px-3 py-2">On the order</th>
            </tr></thead><tbody className="divide-y divide-line">{pv.rows.map((r) => (
              <tr key={`${r.trackingNo}-${r.kind}`}>
                <td className="px-3 py-1.5"><p className="text-ink">{r.kind}</p><p className="font-mono text-[11px] text-muted">{r.trackingNo}</p></td>
                <td className="px-2 py-1.5">{r.orderId ? <Link className="text-accent" to={`/orders/${r.orderId}`}>{r.orderNumber}</Link> : <span className="text-muted">{r.orderNumber || '—'}</span>}<p className="text-[11px] text-muted">{r.customer}</p></td>
                <td className="px-2 py-1.5 text-right"><Num v={r.collection} /></td>
                <td className="px-2 py-1.5 text-right"><Num v={sum(r.totalCharges, r.gst, r.sms)} /></td>
                <td className="px-2 py-1.5 text-right"><Num v={sum(r.wht, r.codSst)} /></td>
                <td className="px-2 py-1.5 text-right"><Num v={r.netDisbursement} strong /></td>
                <td className="px-3 py-1.5 text-xs text-muted">{r.note}</td>
              </tr>))}</tbody></table></div>
            <p className="text-xs text-muted">Importing posts one entry: the payout to Bank Alfalah, charges and GST to courier charges (per order), WHT and COD sales tax to courier deductions (tax credits once tax is on), IBFT to bank charges, and clears the cash Trax collected from Trax COD clearing. The bank statement line then matches this entry.</p>
          </>}
        </div>
      )}
      {!list ? <SkeletonRows rows={4} /> : <>
        {list.awaiting.length > 0 && (
          <section className="space-y-2">
            <h2 className="section-title">Cash with Trax, not settled yet · {fmtRs(list.awaitingTotal, { decimals: false })}</h2>
            <div className="card divide-y divide-line text-sm">{list.awaiting.map((x) => (
              <div key={x.orderId || x.orderNumber} className="flex items-center gap-3 px-4 py-2">
                {x.orderId ? <Link className="w-28 text-accent" to={`/orders/${x.orderId}`}>{x.orderNumber}</Link> : <span className="w-28 text-muted">{x.orderNumber}</span>}
                <span className="flex-1 text-ink-soft">{x.customer}</span><span className="text-xs text-muted">since {fmtDate(x.since)}</span><Num v={x.amount} strong />
              </div>))}</div>
          </section>
        )}
        {list.settlements.length === 0 ? <EmptyState icon={Truck} title="No Trax settlements yet" hint="Import each payment's invoice as it arrives." /> : (
          <section className="space-y-2">
            <h2 className="section-title">Settlements</h2>
            <div className="card divide-y divide-line text-sm">{list.settlements.map((s) => (
              <div key={s.id} className={`flex flex-wrap items-center gap-3 px-4 py-2 ${s.status === 'Void' ? 'opacity-50 line-through' : ''}`}>
                <span className="w-24 text-xs text-muted">{fmtDate(s.date)}</span><span className="flex-1 text-ink">Invoice {s.invoiceNo} · {s.shipments} shipments · collected {fmtRs(s.collection, { decimals: false })}</span>
                {s.entryNo && <Link to={`/finance/journals/${s.entryId}`} className="font-mono text-xs text-accent">{s.entryNo}</Link>}
                <span className="tabular-nums font-semibold text-ink">{fmtRs(s.payable)}</span>
                {s.status === 'Posted' && <button className="text-faint hover:text-rose-600" onClick={() => undo(s)} aria-label="Undo"><Ban size={13} /></button>}
              </div>))}</div>
          </section>
        )}
      </>}
    </div>
  )
}
