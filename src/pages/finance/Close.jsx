import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { CalendarCheck, CheckCircle2, Circle, AlertTriangle, MinusCircle, Play, Lock, Plus, Trash2, Undo2, Pencil, FileText, Ban } from 'lucide-react'
import {
  getCloseMonths, getChecklist, tickChecklist, runMonthEnd, closeMonth, getAllowance, getRevaluation, setLossRates, getYear, closeYear, reopenYear,
  getRecurringJournals, saveRecurringJournal, getAssets, getAssetSuggestions, dismissAssetSuggestion, saveAsset, removeAsset, disposeAsset, undoDisposal,
  getProvisions, saveProvision, addProvisionMove, voidProvisionMove, getAccounts, getSuppliers, getFinanceSettings, PAID_FROM, ASSET_CATEGORIES,
} from '../../data/finance'
import { PageHeader, Modal, Field, Segmented, SkeletonRows, EmptyState, StatCard, fmtDate } from '../../ui/kit'
import { FinBadge, fmtRs, safePaisa, todayPk, AccountSelect, askReason } from './shared'
import { Num } from './reportKit'
import { confirmDialog } from '../../ui/dialog'

const TABS = [{ value: 'checklist', label: 'Month-end checklist' }, { value: 'assets', label: 'Fixed assets' }, { value: 'provisions', label: 'Provisions' },
  { value: 'journals', label: 'Recurring journals' }, { value: 'year', label: 'Year end' }]
const lastMonth = () => { const d = new Date(`${todayPk().slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7) }
const monthLabel = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const JOB_LABELS = { bills: 'Recurring bills', journals: 'Recurring journals', depreciation: 'Depreciation', fx: 'Exchange revaluation', ecl: 'Credit-loss allowance', stock: 'Stock valuation' }

// Month-end and year-end close (F6)
export default function Close() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'checklist'
  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
      <PageHeader eyebrow="Finance" title="Month-end close" icon={CalendarCheck} subtitle="Checklist, fixed assets, provisions, recurring journals and the year-end close" />
      <div className="overflow-x-auto"><Segmented value={tab} onChange={(v) => setParams({ tab: v })} options={TABS} /></div>
      {tab === 'checklist' && <Checklist onTab={(v) => setParams({ tab: v })} />}
      {tab === 'assets' && <Assets />}
      {tab === 'provisions' && <Provisions />}
      {tab === 'journals' && <Journals />}
      {tab === 'year' && <YearEnd />}
    </div>
  )
}

// ── Checklist ──────────────────────────────────────────────────────────
const ICON = {
  done: <CheckCircle2 size={17} className="text-emerald-600" />, todo: <Circle size={17} className="text-amber-600" />,
  warn: <AlertTriangle size={17} className="text-amber-500" />, na: <MinusCircle size={17} className="text-faint" />,
}
function Checklist({ onTab }) {
  const [month, setMonth] = useState(lastMonth())
  const [months, setMonths] = useState([])
  const [c, setC] = useState(null)
  const [busy, setBusy] = useState('')
  const [results, setResults] = useState(null)
  const [closing, setClosing] = useState(null)
  const load = useCallback(() => { setC(null); getChecklist(month).then(setC).catch((e) => { toast.error(e.message); setC({ error: e.message }) }) }, [month])
  useEffect(() => { load() }, [load])
  useEffect(() => { getCloseMonths().then(setMonths).catch(() => {}) }, [c?.period?.status])

  const run = async (jobs) => {
    setBusy(jobs ? jobs[0] : 'all'); setResults(null)
    try { const r = await runMonthEnd(month, jobs); setResults(r.results); setC(r.checklist); r.results.every((x) => x.ok) ? toast.success('Month-end entries up to date') : toast.error('Some jobs need attention') }
    catch (err) { toast.error(err.message) } finally { setBusy('') }
  }
  const tick = async (key, done) => { try { setC(await tickChecklist(month, key, done)) } catch (err) { toast.error(err.message) } }
  const doClose = async () => {
    try { const r = await closeMonth(month, closing.reason); setC(r); setClosing(null); toast.success(`${r.period.name} closed`) } catch (err) { toast.error(err.message) }
  }
  const year = months.filter((m) => m.fiscalYear === months.find((x) => x.month === month)?.fiscalYear)
  const groups = c?.items ? [...new Set(c.items.map((i) => i.group))] : []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input type="month" className="input w-auto" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" />
        {c?.period && <FinBadge status={c.period.status} />}
        <div className="flex-1" />
        {c?.period?.status === 'Open' && <>
          <button className="btn-secondary" onClick={() => run()} disabled={!!busy}><Play size={15} />{busy === 'all' ? 'Running…' : 'Run month-end entries'}</button>
          <button className="btn-primary" onClick={() => setClosing({ reason: '' })} disabled={!c.ended}><Lock size={15} />Close {c.period.name}</button>
        </>}
      </div>
      {year.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {year.map((m) => (
            <button key={m.month} onClick={() => setMonth(m.month)} title={m.status}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${m.month === month ? 'bg-ink text-white ring-ink' : m.status === 'Open' ? 'ring-line text-ink-soft' : 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300'}`}>
              {m.name.slice(0, 3)}{m.status !== 'Open' && ' ✓'}
            </button>
          ))}
        </div>
      )}
      <p className="text-xs text-muted">"Run month-end entries" books the recurring bills and journals, depreciation, the exchange revaluation, the credit-loss allowance and the stock value for {monthLabel(month)}. Each can be run again: it only changes what has changed. Closing the month keeps this checklist with it; after that only you can post into the month, with a reason.</p>
      {results && (
        <div className="card divide-y divide-line text-sm">
          {results.map((r) => <div key={r.job} className="flex gap-3 px-4 py-2">{r.ok ? ICON.done : ICON.warn}<span className="w-44 font-medium text-ink">{JOB_LABELS[r.job]}</span><span className="text-xs text-muted">{r.detail || (r.ok ? 'Up to date' : '')}</span></div>)}
        </div>
      )}
      {!c ? <SkeletonRows rows={10} /> : c.error ? <EmptyState icon={CalendarCheck} title="No checklist" hint={c.error} /> : <>
        {c.closed && (
          <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
            Closed {fmtDate(c.closed.at)}{c.closed.overrideReason && ` with items open: ${c.closed.overrideReason}`}. The checklist below is live; the one saved at closing stays on record.
          </div>
        )}
        {!c.ended && c.period.status === 'Open' && <p className="rounded-xl bg-subtle2 p-3 text-xs text-muted">{c.period.name} hasn't ended yet. You can run the entries to see where things stand; closing opens after {fmtDate(c.asOf)}.</p>}
        {groups.map((g) => (
          <section key={g} className="space-y-2">
            <h2 className="section-title">{g}</h2>
            <div className="card divide-y divide-line">
              {c.items.filter((i) => i.group === g).map((i) => (
                <div key={i.key} className="flex flex-wrap items-start gap-3 px-4 py-2.5 text-sm">
                  <span className="mt-0.5">{ICON[i.status]}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">{i.label}{!i.blocking && i.status !== 'done' && i.status !== 'na' && <span className="ml-2 text-[11px] font-normal text-faint">advisory</span>}</p>
                    {i.detail && <p className="text-xs text-muted">{i.detail}</p>}
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    {i.manual && c.period.status === 'Open' && (
                      <button className="btn-secondary px-2.5 py-1 text-xs" onClick={() => tick(i.key, i.status !== 'done')}>{i.status === 'done' ? 'Untick' : 'Mark done'}</button>
                    )}
                    {i.job && i.status === 'todo' && c.period.status === 'Open' && (
                      <button className="btn-secondary px-2.5 py-1 text-xs" onClick={() => run([i.job])} disabled={!!busy}><Play size={12} />{busy === i.job ? 'Running…' : 'Run'}</button>
                    )}
                    {i.tab && i.status !== 'done' && i.status !== 'na' && <button className="btn-secondary px-2.5 py-1 text-xs" onClick={() => onTab(i.tab)}>Open</button>}
                    {i.link && i.status !== 'done' && i.status !== 'na' && <Link className="btn-secondary px-2.5 py-1 text-xs" to={i.link}>Open</Link>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
        <MonthDetail month={month} />
      </>}
      <Modal open={!!closing} onClose={() => setClosing(null)} size="sm" title={c?.period ? `Close ${c.period.name}` : ''}
        footer={<><button className="btn-secondary" onClick={() => setClosing(null)}>Cancel</button><button className="btn-primary" onClick={doClose} disabled={c?.openItems > 0 && !closing?.reason.trim()}>Close the month</button></>}>
        {closing && c && (
          <div className="space-y-3 p-5 text-sm text-ink-soft">
            {c.openItems ? <p className="text-amber-800 dark:text-amber-300">{c.openItems} item{c.openItems === 1 ? ' is' : 's are'} still open. You can close anyway with a reason; it is kept with the month.</p>
              : <p>Everything on the checklist is done.</p>}
            <p>After closing, only you can post into {c.period.name}, and only with a reason. A sale reported late by a reseller goes into the next open month.</p>
            {c.openItems > 0 && <Field label="Reason"><input autoFocus className="input" value={closing.reason} onChange={(e) => setClosing({ reason: e.target.value })} /></Field>}
          </div>
        )}
      </Modal>
    </div>
  )
}

// Allowance matrix and revaluation figures for the month
function MonthDetail({ month }) {
  const [ecl, setEcl] = useState(null)
  const [fx, setFx] = useState(null)
  const [rates, setRates] = useState(null)
  const load = useCallback(() => {
    getAllowance(month).then((a) => { setEcl(a); setRates(a.rates) }).catch(() => setEcl(null))
    getRevaluation(month).then(setFx).catch(() => setFx(null))
  }, [month])
  useEffect(() => { load() }, [load])
  const saveRates = async () => { try { await setLossRates(rates); toast.success('Loss rates saved; run the allowance to book them'); load() } catch (err) { toast.error(err.message) } }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="space-y-2">
        <h2 className="section-title">Expected credit losses</h2>
        {!ecl ? <SkeletonRows rows={4} /> : (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-muted"><tr><th className="px-4 py-2">Age</th><th className="px-2 py-2 text-right">Owed</th><th className="px-2 py-2 text-right">Loss rate</th><th className="px-4 py-2 text-right">Allowance</th></tr></thead>
              <tbody className="divide-y divide-line">
                {ecl.buckets.map((b) => (
                  <tr key={b.key}>
                    <td className="px-4 py-2 text-ink">{b.label}</td><td className="px-2 py-2 text-right"><Num v={b.owed} /></td>
                    <td className="px-2 py-2 text-right"><input type="number" min="0" max="100" step="0.5" className="input w-20 py-1 text-right" value={rates?.[b.key] ?? 0}
                      onChange={(e) => setRates((r) => ({ ...r, [b.key]: e.target.value }))} aria-label={`Loss rate ${b.label}`} />%</td>
                    <td className="px-4 py-2 text-right"><Num v={b.allowance} /></td>
                  </tr>
                ))}
                <tr className="bg-surface-accent"><td className="px-4 py-2 font-semibold text-ink" colSpan={3}>Allowance needed (booked {fmtRs(ecl.booked)})</td><td className="px-4 py-2 text-right"><Num v={ecl.target} strong /></td></tr>
              </tbody>
            </table>
            <div className="flex items-center gap-2 border-t border-line px-4 py-2"><p className="flex-1 text-[11px] text-muted">Receivables are aged from the ledger; payments clear the oldest amounts first. Rates are yours to set (no loss history yet).</p><button className="btn-secondary px-2.5 py-1 text-xs" onClick={saveRates}>Save rates</button></div>
          </div>
        )}
      </section>
      <section className="space-y-2">
        <h2 className="section-title">Exchange revaluation</h2>
        {!fx ? <SkeletonRows rows={3} /> : fx.items.length === 0 && !fx.missingRates.length ? <p className="card px-4 py-3 text-sm text-muted">No foreign-currency reseller balances at {fmtDate(fx.asOf)}.</p> : (
          <div className="card divide-y divide-line text-sm">
            {fx.missingRates.length > 0 && <p className="px-4 py-2 text-xs text-amber-700">No {fx.missingRates.join(', ')} rate on or before {fmtDate(fx.asOf)}: <Link className="underline" to="/finance/sales">add it</Link>.</p>}
            {fx.items.map((i) => (
              <div key={i.resellerId} className="flex flex-wrap items-center gap-3 px-4 py-2">
                <span className="flex-1 font-medium text-ink">{i.name}</span>
                <span className="text-xs text-muted">{i.owedFc} {i.currency} × {i.rate} = {fmtRs(i.atClosingRate)}; booked {fmtRs(i.booked)}</span>
                <Num v={i.difference} strong />
              </div>
            ))}
            <p className="px-4 py-2 text-[11px] text-muted">The difference is an unrealised gain or loss (4920 / 6991) and is reversed on the 1st, so the payment books the real one.</p>
          </div>
        )}
      </section>
    </div>
  )
}

// ── Fixed assets ───────────────────────────────────────────────────────
function Assets() {
  const [d, setD] = useState(null)
  const [sug, setSug] = useState([])
  const [edit, setEdit] = useState(null)
  const [dispose, setDispose] = useState(null)
  const load = useCallback(() => { getAssets().then(setD).catch((e) => toast.error(e.message)); getAssetSuggestions().then(setSug).catch(() => {}) }, [])
  useEffect(() => { load() }, [load])
  const dismiss = async (id) => { try { setSug(await dismissAssetSuggestion(id)) } catch (err) { toast.error(err.message) } }
  const remove = async (a) => { const r = await askReason(`Remove ${a.code} ${a.name} from the register?`); if (!r) return; try { await removeAsset(a.id, r); toast.success('Removed'); load() } catch (err) { toast.error(err.message) } }
  const undo = async (a) => { const r = await askReason(`Undo the disposal of ${a.code}?`); if (!r) return; try { await undoDisposal(a.id, r); load() } catch (err) { toast.error(err.message) } }
  if (!d) return <SkeletonRows rows={6} />
  const inUse = d.assets.filter((a) => a.status === 'In use'), gone = d.assets.filter((a) => a.status === 'Disposed')
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Cost" value={safePaisa(d.totals.cost) / 100} prefix="Rs " sub={`${inUse.length} in use`} />
        <StatCard label="Depreciation booked" value={safePaisa(d.totals.accumulated) / 100} prefix="Rs " />
        <StatCard label="Carrying amount" value={safePaisa(d.totals.carrying) / 100} prefix="Rs " />
        <StatCard label="Due, not booked yet" value={safePaisa(d.totals.notYetBooked) / 100} prefix="Rs " sub="run the month's depreciation" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-xs text-muted">Straight line over the useful life, to the residual value. In use by the 15th: depreciated from that month. Depreciation is booked with the month-end entries.</p>
        <button className="btn-primary" onClick={() => setEdit({ source: 'purchase' })}><Plus size={15} />Add an asset</button>
      </div>
      {sug.length > 0 && (
        <section className="space-y-2">
          <h2 className="section-title">Might be fixed assets</h2>
          <div className="card divide-y divide-line text-sm">
            {sug.map((s) => (
              <div key={s.expenseId} className="flex flex-wrap items-center gap-3 px-4 py-2">
                <div className="min-w-0 flex-1"><p className="font-medium text-ink">{s.description || s.supplier}</p><p className="text-xs text-muted">{fmtDate(s.date)} · {s.account} · {s.entryNo}{s.onAssetAccount && ' · booked to an asset account but not on the register'}</p></div>
                <span className="tabular-nums text-ink">{fmtRs(s.amount, { decimals: false })}</span>
                <button className="btn-secondary px-2.5 py-1 text-xs" onClick={() => setEdit({ source: 'expense', expenseId: s.expenseId, name: s.description, category: s.category || 'machinery', cost: s.amount, acquiredOn: s.date })}>Register</button>
                {!s.onAssetAccount && <button className="btn-secondary px-2.5 py-1 text-xs" onClick={() => dismiss(s.expenseId)}>Not an asset</button>}
              </div>
            ))}
          </div>
        </section>
      )}
      {d.assets.length === 0 ? <EmptyState icon={CalendarCheck} title="No fixed assets yet" hint="Add the sewing machines, furniture and computers the studio owns, including those bought before go-live." /> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wider text-muted"><tr>
              <th className="px-4 py-2">Asset</th><th className="px-2 py-2">In use from</th><th className="px-2 py-2 text-right">Cost</th><th className="px-2 py-2 text-right">Monthly</th>
              <th className="px-2 py-2 text-right">Depreciation</th><th className="px-2 py-2 text-right">Carrying</th><th className="px-4 py-2" />
            </tr></thead>
            <tbody className="divide-y divide-line">
              {[...inUse, ...gone].map((a) => (
                <tr key={a.id} className={a.status === 'Disposed' ? 'opacity-60' : ''}>
                  <td className="px-4 py-2"><p className="font-medium text-ink">{a.code} · {a.name}</p>
                    <p className="text-xs text-muted">{a.categoryLabel} · {a.lifeMonths / 12 >= 1 && a.lifeMonths % 12 === 0 ? `${a.lifeMonths / 12} years` : `${a.lifeMonths} months`}{a.source === 'opening' ? ' · before go-live' : a.expenseEntryNo ? ` · ${a.expenseEntryNo}` : ''}
                      {a.status === 'Disposed' && ` · disposed ${fmtDate(a.disposedOn)}${a.disposalEntryNo ? ` (${a.disposalEntryNo})` : ''}`}{a.fullyDepreciated && ' · fully depreciated'}</p></td>
                  <td className="px-2 py-2 text-xs text-muted">{fmtDate(a.availableOn)}</td>
                  <td className="px-2 py-2 text-right"><Num v={a.cost} /></td>
                  <td className="px-2 py-2 text-right"><Num v={a.monthly} /></td>
                  <td className="px-2 py-2 text-right"><Num v={a.accumulated} />{safePaisa(a.notYetBooked) > 0 && <p className="text-[11px] text-amber-700">+{fmtRs(a.notYetBooked, { decimals: false })} due</p>}</td>
                  <td className="px-2 py-2 text-right"><Num v={a.carrying} strong /></td>
                  <td className="px-4 py-2 text-right"><div className="inline-flex gap-1">
                    {a.status === 'In use' ? <>
                      <button className="btn-secondary px-2 py-1 text-xs" onClick={() => setEdit(a)} aria-label="Edit"><Pencil size={12} /></button>
                      <button className="btn-secondary px-2 py-1 text-xs" onClick={() => setDispose({ asset: a, date: todayPk(), proceeds: '', paidTo: 'bank', note: '' })}>Sold / scrapped</button>
                      <button className="btn-secondary px-2 py-1 text-xs" onClick={() => remove(a)} aria-label="Remove"><Trash2 size={12} /></button>
                    </> : a.disposalEntryId && <button className="btn-secondary px-2 py-1 text-xs" onClick={() => undo(a)}><Undo2 size={12} />Undo</button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && <AssetModal asset={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load() }} />}
      <Modal open={!!dispose} onClose={() => setDispose(null)} size="sm" title={dispose ? `${dispose.asset.code} sold or scrapped` : ''}
        footer={<><button className="btn-secondary" onClick={() => setDispose(null)}>Cancel</button><button className="btn-primary" onClick={async () => {
          try { await disposeAsset(dispose.asset.id, { ...dispose, asset: undefined, paidTo: safePaisa(dispose.proceeds || 0) > 0 ? dispose.paidTo : undefined }); toast.success('Disposal booked'); setDispose(null); load() } catch (err) { toast.error(err.message) }
        }}>Book disposal</button></>}>
        {dispose && (
          <div className="space-y-3 p-5">
            <p className="text-sm text-ink-soft">Carrying amount now {fmtRs(dispose.asset.carrying)}. Depreciation up to the date is booked in the same entry, and the gain or loss against the sale price.</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date"><input type="date" className="input" value={dispose.date} onChange={(e) => setDispose((x) => ({ ...x, date: e.target.value }))} /></Field>
              <Field label="Sold for (0 if scrapped)"><input className="input" inputMode="decimal" value={dispose.proceeds} onChange={(e) => setDispose((x) => ({ ...x, proceeds: e.target.value }))} /></Field>
            </div>
            {safePaisa(dispose.proceeds || 0) > 0 && <Field label="Money received into"><select className="input" value={dispose.paidTo} onChange={(e) => setDispose((x) => ({ ...x, paidTo: e.target.value }))}>
              {Object.entries(PAID_FROM).filter(([k]) => k !== 'unpaid').map(([k, v]) => <option key={k} value={k}>{v.replace(' paid personally', ' personally')}</option>)}</select></Field>}
            <Field label="Note"><input className="input" value={dispose.note} onChange={(e) => setDispose((x) => ({ ...x, note: e.target.value }))} /></Field>
          </div>
        )}
      </Modal>
    </div>
  )
}

function AssetModal({ asset, onClose, onSaved }) {
  const isNew = !asset.id
  const [f, setF] = useState({
    source: asset.source || 'purchase', name: asset.name || '', category: asset.category || 'machinery', cost: asset.cost || '', acquiredOn: asset.acquiredOn || todayPk(),
    availableOn: asset.availableOn || '', lifeMonths: asset.lifeMonths || '', residual: asset.residual && asset.residual !== '0.00' ? asset.residual : '',
    openingDepreciation: asset.openingDepreciation && asset.openingDepreciation !== '0.00' ? asset.openingDepreciation : '', paidFrom: 'bank', supplierId: asset.supplierId || '',
    serialNo: asset.serialNo || '', location: asset.location || '', notes: asset.notes || '', reference: '', expenseId: asset.expenseId,
  })
  const [suppliers, setSuppliers] = useState([])
  const [goLive, setGoLive] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { getSuppliers().then(setSuppliers).catch(() => {}); getFinanceSettings().then((s) => setGoLive(s.goLiveDate)).catch(() => {}) }, [])
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const life = f.lifeMonths || ASSET_CATEGORIES[f.category][1]
  const monthly = safePaisa(f.cost || 0) > 0 ? (safePaisa(f.cost) - safePaisa(f.residual || 0)) / life / 100 : null
  const save = async () => {
    setBusy(true)
    try { await saveAsset(asset.id, { ...f, lifeMonths: f.lifeMonths === '' ? undefined : Number(f.lifeMonths), availableOn: f.availableOn || undefined }); toast.success(isNew ? 'Asset added' : 'Saved'); onSaved() }
    catch (err) { toast.error(err.message) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={isNew ? 'Add a fixed asset' : `${asset.code} · ${asset.name}`}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : isNew && f.source === 'purchase' ? 'Add and book the payment' : 'Save'}</button></>}>
      <div className="space-y-3 p-5">
        {isNew && f.source !== 'expense' && (
          <Segmented value={f.source} onChange={(v) => setF((x) => ({ ...x, source: v }))} options={[{ value: 'purchase', label: 'Bought now' }, { value: 'opening', label: `Owned before ${goLive ? fmtDate(goLive) : 'go-live'}` }]} />
        )}
        {f.source === 'expense' && isNew && <p className="rounded-xl bg-subtle2 p-3 text-xs text-muted">From an expense already booked ({fmtRs(f.cost)} on {fmtDate(f.acquiredOn)}). It moves to the asset account.</p>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" className="col-span-2"><input className="input" value={f.name} onChange={set('name')} placeholder="Juki DDL-8700 sewing machine" /></Field>
          <Field label="Kind"><select className="input" value={f.category} onChange={set('category')} disabled={!isNew && asset.source !== 'opening'}>
            {Object.entries(ASSET_CATEGORIES).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}</select></Field>
          <Field label="Useful life (months)" hint={`Default ${ASSET_CATEGORIES[f.category][1]}`}><input className="input" inputMode="numeric" value={f.lifeMonths} onChange={set('lifeMonths')} placeholder={String(ASSET_CATEGORIES[f.category][1])} /></Field>
          {(isNew ? f.source !== 'expense' : asset.source === 'opening') && <>
            <Field label="Cost"><input className="input" inputMode="decimal" value={f.cost} onChange={set('cost')} /></Field>
            {isNew && <Field label="Bought on"><input type="date" className="input" value={f.acquiredOn} onChange={set('acquiredOn')} /></Field>}
          </>}
          <Field label="In use from" hint="If later than bought"><input type="date" className="input" value={f.availableOn} onChange={set('availableOn')} /></Field>
          <Field label="Residual value" hint="Expected resale at end of life"><input className="input" inputMode="decimal" value={f.residual} onChange={set('residual')} placeholder="0" /></Field>
          {f.source === 'opening' && <Field label="Depreciation up to go-live" hint="From the accountant's figures" className="col-span-2"><input className="input" inputMode="decimal" value={f.openingDepreciation} onChange={set('openingDepreciation')} placeholder="0" /></Field>}
          {isNew && f.source === 'purchase' && <>
            <Field label="Paid from"><select className="input" value={f.paidFrom} onChange={set('paidFrom')}>{Object.entries(PAID_FROM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Supplier"><select className="input" value={f.supplierId} onChange={set('supplierId')}><option value="">—</option>{suppliers.filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          </>}
          <Field label="Serial number"><input className="input" value={f.serialNo} onChange={set('serialNo')} /></Field>
          <Field label="Where it is"><input className="input" value={f.location} onChange={set('location')} placeholder="Studio" /></Field>
          <Field label="Notes" className="col-span-2"><input className="input" value={f.notes} onChange={set('notes')} /></Field>
        </div>
        {monthly != null && <p className="text-xs text-muted">Depreciation about {fmtRs(String(monthly.toFixed(2)), { decimals: false })} a month{f.source === 'opening' ? ' (what is left is spread over the life remaining at go-live)' : ''}.</p>}
      </div>
    </Modal>
  )
}

// ── Provisions ─────────────────────────────────────────────────────────
function Provisions() {
  const [list, setList] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [edit, setEdit] = useState(null)
  const [move, setMove] = useState(null)
  const load = useCallback(() => getProvisions().then(setList).catch((e) => toast.error(e.message)), [])
  useEffect(() => { load(); getAccounts().then(setAccounts).catch(() => {}) }, [load])
  const save = async () => { try { setList(await saveProvision(edit.id, edit)); setEdit(null) } catch (err) { toast.error(err.message) } }
  const book = async () => { try { setList(await addProvisionMove(move.provision.id, move)); setMove(null); toast.success('Booked') } catch (err) { toast.error(err.message) } }
  const voidMove = async (m) => { const r = await askReason('Undo this movement?'); if (!r) return; try { setList(await voidProvisionMove(m.id, r)) } catch (err) { toast.error(err.message) } }
  if (!list) return <SkeletonRows rows={4} />
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-xs text-muted">A provision is booked when Koko owes something of uncertain amount or timing because of something that has already happened (a dispute, a warranty, a penalty). A contingency is only possible, so it is described in the notes and not booked.</p>
        <button className="btn-primary" onClick={() => setEdit({ name: '', kind: 'provision', expenseAccountId: '', disclosure: '' })}><Plus size={15} />Add</button>
      </div>
      {list.length === 0 ? <EmptyState icon={FileText} title="No provisions or contingencies" hint="Nothing to book or disclose. Review this at each month end." /> : list.map((p) => (
        <div key={p.id} className="card">
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0 flex-1"><p className="font-medium text-ink">{p.name} <span className="ml-1 text-[11px] font-normal text-muted">{p.kind === 'contingency' ? 'contingency, disclosed only' : p.account}</span></p>
              {p.disclosure && <p className="text-xs text-muted">{p.disclosure}</p>}</div>
            {p.kind === 'provision' && <span className="tabular-nums font-semibold text-ink">{fmtRs(p.balance)}</span>}
            <FinBadge status={p.status === 'Open' ? 'Open' : 'Closed'} />
            <button className="btn-secondary px-2 py-1 text-xs" onClick={() => setEdit(p)} aria-label="Edit"><Pencil size={12} /></button>
            {p.kind === 'provision' && <button className="btn-secondary px-2.5 py-1 text-xs" onClick={() => setMove({ provision: p, kind: 'recognise', date: todayPk(), amount: '', paidFrom: 'bank', note: '' })}>Book / use / release</button>}
          </div>
          {p.moves.length > 0 && <div className="divide-y divide-line text-sm">{p.moves.map((m) => (
            <div key={m.id} className={`flex items-center gap-3 px-4 py-2 ${m.status === 'Void' ? 'opacity-50 line-through' : ''}`}>
              <span className="w-24 text-xs text-muted">{fmtDate(m.date)}</span><span className="w-20 text-ink">{{ recognise: 'Booked', use: 'Used', release: 'Released' }[m.kind]}</span>
              <span className="flex-1 text-xs text-muted">{m.note}</span>{m.entryNo && <span className="font-mono text-xs text-accent">{m.entryNo}</span>}
              <span className="tabular-nums">{m.kind === 'recognise' ? '' : '−'}{fmtRs(m.amount)}</span>
              {m.status === 'Posted' && <button className="text-faint hover:text-rose-600" onClick={() => voidMove(m)} aria-label="Undo"><Ban size={13} /></button>}
            </div>))}</div>}
        </div>
      ))}
      <Modal open={!!edit} onClose={() => setEdit(null)} size="sm" title={edit?.id ? 'Edit' : 'Add a provision or contingency'}
        footer={<><button className="btn-secondary" onClick={() => setEdit(null)}>Cancel</button><button className="btn-primary" onClick={save}>Save</button></>}>
        {edit && <div className="space-y-3 p-5">
          <Field label="Name"><input className="input" value={edit.name} onChange={(e) => setEdit((x) => ({ ...x, name: e.target.value }))} /></Field>
          {!edit.id && <Segmented value={edit.kind} onChange={(v) => setEdit((x) => ({ ...x, kind: v }))} options={[{ value: 'provision', label: 'Provision (booked)' }, { value: 'contingency', label: 'Contingency (disclosed)' }]} />}
          {edit.kind === 'provision' && <Field label="Charged to"><AccountSelect accounts={accounts.filter((a) => ['expense', 'cogs'].includes(a.type))} value={edit.expenseAccountId} onChange={(v) => setEdit((x) => ({ ...x, expenseAccountId: v }))} manual /></Field>}
          <Field label="Note for the accounts"><textarea className="input min-h-[80px]" value={edit.disclosure} onChange={(e) => setEdit((x) => ({ ...x, disclosure: e.target.value }))} /></Field>
          {edit.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.status === 'Settled'} onChange={(e) => setEdit((x) => ({ ...x, status: e.target.checked ? 'Settled' : 'Open' }))} />Settled (no longer needed)</label>}
        </div>}
      </Modal>
      <Modal open={!!move} onClose={() => setMove(null)} size="sm" title={move ? move.provision.name : ''}
        footer={<><button className="btn-secondary" onClick={() => setMove(null)}>Cancel</button><button className="btn-primary" onClick={book}>Book</button></>}>
        {move && <div className="space-y-3 p-5">
          <Segmented value={move.kind} onChange={(v) => setMove((x) => ({ ...x, kind: v }))} options={[{ value: 'recognise', label: 'Book / increase' }, { value: 'use', label: 'Paid out' }, { value: 'release', label: 'Release' }]} />
          <p className="text-xs text-muted">{{ recognise: 'Charged to the expense now; held in 2700 Provisions.', use: 'Paid out of the provision: no new expense.', release: 'No longer needed: back to the expense it was charged to.' }[move.kind]} Held now: {fmtRs(move.provision.balance)}.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date"><input type="date" className="input" value={move.date} onChange={(e) => setMove((x) => ({ ...x, date: e.target.value }))} /></Field>
            <Field label="Amount"><input className="input" inputMode="decimal" value={move.amount} onChange={(e) => setMove((x) => ({ ...x, amount: e.target.value }))} /></Field>
          </div>
          {move.kind === 'use' && <Field label="Paid from"><select className="input" value={move.paidFrom} onChange={(e) => setMove((x) => ({ ...x, paidFrom: e.target.value }))}>
            {Object.entries(PAID_FROM).filter(([k]) => k !== 'unpaid').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>}
          <Field label="Note"><input className="input" value={move.note} onChange={(e) => setMove((x) => ({ ...x, note: e.target.value }))} /></Field>
        </div>}
      </Modal>
    </div>
  )
}

// ── Recurring and accrual journals ─────────────────────────────────────
const emptyLines = () => [{ accountId: '', debit: '', credit: '', description: '' }, { accountId: '', debit: '', credit: '', description: '' }]
function Journals() {
  const [list, setList] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [edit, setEdit] = useState(null)
  const load = useCallback(() => getRecurringJournals().then(setList).catch((e) => toast.error(e.message)), [])
  useEffect(() => { load(); getAccounts().then(setAccounts).catch(() => {}) }, [load])
  const save = async () => { try { setList(await saveRecurringJournal(edit.id, edit)); setEdit(null); toast.success('Saved') } catch (err) { toast.error(err.message) } }
  const setLine = (i, k, v) => setEdit((x) => ({ ...x, lines: x.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }))
  const d = edit ? edit.lines.reduce((s, l) => s + (safePaisa(l.debit || 0) || 0), 0) : 0, c = edit ? edit.lines.reduce((s, l) => s + (safePaisa(l.credit || 0) || 0), 0) : 0
  if (!list) return <SkeletonRows rows={4} />
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-xs text-muted">Journals posted on the last day of each month with the month-end entries. An accrual (say, electricity used in the month but billed next month: Dr utilities, Cr 2500 Accrued expenses) reverses itself on the 1st, so the real bill isn't counted twice. For a one-off accrual, set the same first and last month.</p>
        <button className="btn-primary" onClick={() => setEdit({ name: '', memo: '', autoReverse: true, startsMonth: lastMonth(), endsMonth: '', isActive: true, lines: emptyLines() })}><Plus size={15} />Add</button>
      </div>
      {list.length === 0 ? <EmptyState icon={FileText} title="No recurring journals" hint="Rent paid in advance, accruals and other month-end journals go here." /> : (
        <div className="card divide-y divide-line text-sm">
          {list.map((j) => (
            <div key={j.id} className={`flex flex-wrap items-center gap-3 px-4 py-2.5 ${j.isActive ? '' : 'opacity-50'}`}>
              <div className="min-w-0 flex-1"><p className="font-medium text-ink">{j.name}{j.autoReverse && <span className="ml-2 text-[11px] font-normal text-muted">accrual, reverses on the 1st</span>}</p>
                <p className="text-xs text-muted">{j.startsMonth}{j.endsMonth ? ` to ${j.endsMonth}` : ' onwards'}{j.lastMonth && ` · last posted ${j.lastMonth}`}</p></div>
              <span className="tabular-nums text-ink">{fmtRs(j.total)}</span>
              <button className="btn-secondary px-2 py-1 text-xs" onClick={() => setEdit({ ...j, lines: j.lines.map((l) => ({ ...l, debit: l.debit === '0.00' ? '' : l.debit, credit: l.credit === '0.00' ? '' : l.credit })) })} aria-label="Edit"><Pencil size={12} /></button>
            </div>
          ))}
        </div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} size="lg" title={edit?.id ? edit.name : 'Add a recurring journal'}
        footer={<><span className={`mr-auto text-xs ${d === c && d > 0 ? 'text-emerald-700' : 'text-amber-700'}`}>Debits {fmtRs(String(d / 100))} · credits {fmtRs(String(c / 100))}</span>
          <button className="btn-secondary" onClick={() => setEdit(null)}>Cancel</button><button className="btn-primary" onClick={save} disabled={d !== c || !d}>Save</button></>}>
        {edit && <div className="space-y-3 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><input className="input" value={edit.name} onChange={(e) => setEdit((x) => ({ ...x, name: e.target.value }))} /></Field>
            <Field label="Memo"><input className="input" value={edit.memo} onChange={(e) => setEdit((x) => ({ ...x, memo: e.target.value }))} /></Field>
            <Field label="First month"><input type="month" className="input" value={edit.startsMonth} onChange={(e) => setEdit((x) => ({ ...x, startsMonth: e.target.value }))} /></Field>
            <Field label="Last month" hint="Empty: every month"><input type="month" className="input" value={edit.endsMonth} onChange={(e) => setEdit((x) => ({ ...x, endsMonth: e.target.value }))} /></Field>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={edit.autoReverse} onChange={(e) => setEdit((x) => ({ ...x, autoReverse: e.target.checked }))} />Accrual: reverse on the 1st of the next month</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={edit.isActive} onChange={(e) => setEdit((x) => ({ ...x, isActive: e.target.checked }))} />Active</label>
          </div>
          <div className="space-y-2">
            {edit.lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_6rem_6rem_auto] gap-2 max-sm:grid-cols-2">
                <AccountSelect accounts={accounts} value={l.accountId} onChange={(v) => setLine(i, 'accountId', v)} manual className="input max-sm:col-span-2" />
                <input className="input text-right" inputMode="decimal" placeholder="Debit" value={l.debit} onChange={(e) => setLine(i, 'debit', e.target.value)} />
                <input className="input text-right" inputMode="decimal" placeholder="Credit" value={l.credit} onChange={(e) => setLine(i, 'credit', e.target.value)} />
                <button className="text-faint hover:text-rose-600 max-sm:hidden" onClick={() => setEdit((x) => ({ ...x, lines: x.lines.filter((_, j) => j !== i) }))} aria-label="Remove line" disabled={edit.lines.length <= 2}><Trash2 size={14} /></button>
              </div>
            ))}
            <button className="btn-secondary px-2.5 py-1 text-xs" onClick={() => setEdit((x) => ({ ...x, lines: [...x.lines, { accountId: '', debit: '', credit: '', description: '' }] }))}><Plus size={12} />Line</button>
          </div>
        </div>}
      </Modal>
    </div>
  )
}

// ── Year end ───────────────────────────────────────────────────────────
function YearEnd() {
  const [years, setYears] = useState([])
  const [fy, setFy] = useState('')
  const [y, setY] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    getCloseMonths().then((ms) => {
      const list = [...new Set(ms.map((m) => m.fiscalYear))].filter((x) => x !== '2098-99').sort().reverse()
      setYears(list)
      const t = todayPk()
      setFy(ms.find((m) => t >= m.startsOn && t <= m.endsOn)?.fiscalYear || list[0] || '')
    }).catch((e) => toast.error(e.message))
  }, [])
  const load = useCallback(() => { if (fy) { setY(null); getYear(fy).then(setY).catch((e) => toast.error(e.message)) } }, [fy])
  useEffect(() => { load() }, [load])
  const doClose = async () => {
    if (!await confirmDialog(`Close FY ${fy}? Income and cost accounts are zeroed into retained earnings with a closing entry on ${fmtDate(y.to)}, in the adjustment period.`)) return
    setBusy(true)
    try { setY(await closeYear(fy)); toast.success(`FY ${fy} closed`) } catch (err) { toast.error(err.message) } finally { setBusy(false) }
  }
  const reopen = async () => { const r = await askReason(`Reopen FY ${fy}? The closing entry is reversed.`); if (!r) return; try { setY(await reopenYear(fy, r)) } catch (err) { toast.error(err.message) } }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select className="input w-auto" value={fy} onChange={(e) => setFy(e.target.value)} aria-label="Fiscal year">{years.map((x) => <option key={x} value={x}>FY {x}</option>)}</select>
        <Link className="btn-secondary" to={`/finance/notes?fy=${fy}`}><FileText size={15} />Notes pack</Link>
        <Link className="btn-secondary" to="/finance/reports">Statements</Link>
      </div>
      <p className="text-xs text-muted">At the year end: close every month, post the auditor's adjustments in the adjustment period (dated 30 June, kept apart from June), then close the year. Closing posts one CL entry moving the year's profit into 3200 Retained earnings and adds the next fiscal year. Adjustments after that make the close out of date; closing again replaces the entry. Lock the months once the accounts are signed.</p>
      {!y ? <SkeletonRows rows={5} /> : <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label={`Profit FY ${y.fiscalYear}`} value={safePaisa(y.profit) / 100} prefix="Rs " sub={`${fmtDate(y.from)} to ${fmtDate(y.to)}`} />
          <StatCard label="Months still open" value={y.notClosed.length} />
          <StatCard label="Adjustment period" value={y.adjustmentStatus} />
          <StatCard label="Year close" value={y.closed ? (y.current ? 'Closed' : 'Out of date') : 'Not closed'} sub={y.entryNo || ''} />
        </div>
        {y.notClosed.length > 0 && <p className="rounded-xl bg-subtle2 p-3 text-xs text-muted">Still open: {y.notClosed.join(', ')}. Close them from the checklist first.</p>}
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={doClose} disabled={busy || y.notClosed.length > 0 || (y.closed && y.current)}><Lock size={15} />{y.closed && !y.current ? 'Close again with the adjustments' : `Close FY ${y.fiscalYear}`}</button>
          {y.closed && <button className="btn-secondary" onClick={reopen}><Undo2 size={15} />Reopen the year</button>}
        </div>
        {y.accounts.length > 0 && (
          <div className="card overflow-x-auto"><table className="w-full min-w-[420px] text-sm"><tbody className="divide-y divide-line">
            {y.accounts.map((a) => <tr key={a.id}><td className="px-4 py-1.5 font-mono text-xs text-muted">{a.code}</td><td className="px-2 py-1.5 text-ink">{a.name}</td><td className="px-4 py-1.5 text-right"><Num v={a.balance} /></td></tr>)}
          </tbody></table></div>
        )}
      </>}
    </div>
  )
}
