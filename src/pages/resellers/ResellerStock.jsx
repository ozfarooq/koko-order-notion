import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import { RefreshCw, Store, ArrowUp, ArrowDown, Pencil, Search, Package, CheckCircle2, Wallet, Undo2 } from 'lucide-react'
import { getConsignments, updateConsignmentItem, recordReturns, pieceMoney, FC_STATUS_OPTIONS } from '../../data/storage'
import { useAuth } from '../../auth/AuthContext'
import { PageHeader, StatCard, SkeletonCards, SkeletonRows, EmptyState, ErrorBanner, Segmented, Modal, Field, fmtDate } from '../../ui/kit'
import { ease } from '../../ui/motion'
import SaleDetailsModal from './SaleDetailsModal'

const fmt = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })
const net = (o) => pieceMoney(o).netPayable

export function StatusPill({ status }) {
  const meta = FC_STATUS_OPTIONS.find((s) => s.value === status)
  if (!meta) return null
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${meta.color}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />{meta.label}
    </span>
  )
}

function PieceDate({ o }) {
  if (o.status === 'FC - Returned') return <><p>Returned {fmtDate(o.returnedOn)}</p>{o.returnReason && <p className="text-[11px] text-faint">{o.returnReason}</p>}</>
  if (['FC - Sold', 'FC - Paid'].includes(o.status))
    return <><p>Sold {fmtDate(o.soldOn)}</p>{o.resellerInvoiceNo && <p className="tabular-nums font-medium text-[11px] text-faint">{o.resellerInvoiceNo}</p>}</>
  return <>Handed over {fmtDate(o.handoverDate)}</>
}

export default function ResellerStock() {
  const { resellerId } = useParams()
  const { user, can } = useAuth()
  const canEdit = can('fc:write')
  const showMoney = can('fc:money')
  const isReseller = user?.role === 'reseller'

  const [pieces, setPieces] = useState([])
  const [reseller, setReseller] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [sortDir, setSortDir] = useState('asc')
  const [editingPrice, setEditingPrice] = useState({})
  const [detailsId, setDetailsId] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [returning, setReturning] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getConsignments(resellerId)
      setPieces(data.items)
      setReseller(data.resellers.find((r) => String(r.id) === String(resellerId)) || data.resellers[0] || null)
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }, [resellerId])
  useEffect(() => { load() }, [load])

  const replace = (saved) => setPieces((prev) => prev.map((o) => {
    if (o.id === saved.id) return saved
    if (o.productId === saved.productId) return { ...o, resellerCode: saved.resellerCode }
    return o
  }))

  const changeStatus = async (o, status) => {
    setPieces((prev) => prev.map((p) => (p.id === o.id ? { ...p, status } : p)))
    try { replace(await updateConsignmentItem(o.id, { status })); toast.success(`${o.product} (${o.size}) → ${status.replace('FC - ', '')}`) }
    catch (err) { replace(o); toast.error(err.message) }
  }

  const savePrice = async (o) => {
    const draft = editingPrice[o.id]
    if (draft === undefined) return
    setEditingPrice((p) => { const n = { ...p }; delete n[o.id]; return n })
    const price = draft === '' ? null : Number(draft)
    if (price === o.aedPrice) return
    try { replace(await updateConsignmentItem(o.id, { aedPrice: price })); toast.success('Price saved') }
    catch (err) { toast.error(err.message) }
  }

  const cur = reseller?.currency || 'AED'
  const pct = reseller?.commissionPct ?? 0
  const sold = pieces.filter((o) => ['FC - Sold', 'FC - Paid'].includes(o.status))
  const totals = {
    atStore: pieces.filter((o) => o.status === 'FC - At Store').length,
    returned: pieces.filter((o) => o.status === 'FC - Returned').length,
    sold: pieces.filter((o) => o.status === 'FC - Sold').length,
    paid: pieces.filter((o) => o.status === 'FC - Paid').length,
    gross: sold.reduce((s, o) => s + (Number(o.aedPrice) || 0), 0),
    commission: sold.reduce((s, o) => s + pieceMoney(o).commission, 0),
    net: sold.reduce((s, o) => s + net(o), 0),
    owed: pieces.filter((o) => o.status === 'FC - Sold').reduce((s, o) => s + net(o), 0),
    received: pieces.filter((o) => o.status === 'FC - Paid').reduce((s, o) => s + net(o), 0),
  }
  const deductions = totals.gross - totals.commission - totals.net

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return pieces
      .filter((o) => statusFilter === 'all' || o.status === statusFilter)
      .filter((o) => !q || [o.product, o.size, o.resellerCode, o.resellerInvoiceNo].some((v) => (v || '').toLowerCase().includes(q)))
      .sort((a, b) => (sortDir === 'asc' ? 1 : -1) * (a.product || '').localeCompare(b.product || ''))
  }, [pieces, statusFilter, query, sortDir])

  const filterOptions = [{ value: 'all', label: `All ${pieces.length}` },
    ...FC_STATUS_OPTIONS.map((s) => ({ value: s.value, label: `${s.label} ${pieces.filter((o) => o.status === s.value).length}` }))]

  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const saveReturns = async () => {
    try {
      const r = await recordReturns(resellerId, { pieceIds: [...selected], returnedOn: returning.date, reason: returning.reason })
      toast.success(`${r.returned} piece${r.returned === 1 ? '' : 's'} marked returned`)
      setSelected(new Set()); setReturning(null); load()
    } catch (err) { toast.error(err.message) }
  }

  const moneyCols = showMoney ? ['Gross', 'Discount', 'Commission', 'Alt/Laundry', 'Net payable'] : []
  const detailPiece = pieces.find((o) => o.id === detailsId)

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        eyebrow={isReseller ? 'Your store' : `Reseller · ${reseller?.city || ''}`}
        title={isReseller ? 'My Stock' : `${reseller?.name || 'Reseller'} · Stock`}
        subtitle={`${isReseller ? 'Koko Atelier pieces with you' : 'Consignment stock'}${showMoney && reseller ? ` · ${pct}% commission` : ''}`}
        icon={Store}
        actions={
          <>
            <button className="btn-secondary" onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}>
              {sortDir === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}A–Z
            </button>
            <button className="btn-secondary" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Refresh</button>
          </>
        }
      />

      {loading ? <SkeletonCards /> : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="At store" value={totals.atStore} icon={Package} sub={`${pieces.length} pieces handed over`} />
          <StatCard label="Sold, awaiting payment" value={totals.sold} tone="plum" icon={CheckCircle2} />
          {showMoney
            ? <StatCard label={isReseller ? 'Payable to Koko' : 'Owed to Koko'} value={totals.owed} prefix={`${cur} `} tone="orange" icon={Wallet} />
            : <StatCard label="Paid" value={totals.paid} tone="green" icon={Wallet} />}
          <StatCard label="Returned" value={totals.returned} tone="red" icon={Undo2} />
        </div>
      )}

      {showMoney && totals.gross > 0 && (
        <div className="card grid gap-5 p-5 sm:grid-cols-3">
          <div><p className="text-xs text-muted">Sold value (gross)</p><p className="font-display text-2xl font-semibold text-ink">{cur} {fmt(totals.gross)}</p></div>
          <div><p className="text-xs text-muted">Commission ({pct}%)</p><p className="font-display text-2xl font-semibold text-rose-600 dark:text-rose-400">− {cur} {fmt(totals.commission)}</p></div>
          <div>
            <p className="text-xs text-muted">Net payable to Koko</p>
            <p className="font-display text-2xl font-semibold text-emerald-700 dark:text-emerald-400">{cur} {fmt(totals.net)}</p>
            {deductions > 0.5 && <p className="text-xs text-faint">after {cur} {fmt(deductions)} discounts &amp; alterations</p>}
            {totals.received > 0 && <p className="text-xs text-faint">{cur} {fmt(totals.received)} already received</p>}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"><Segmented options={filterOptions} value={statusFilter} onChange={setStatusFilter} /></div>
        <div className="relative lg:ml-auto lg:w-72">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input className="input pl-9" placeholder="Search product, size, code, invoice" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      <ErrorBanner onRetry={load}>{error}</ErrorBanner>

      {loading ? <SkeletonRows rows={8} /> : visible.length === 0 ? (
        <EmptyState icon={Store} title={pieces.length ? 'Nothing matches' : 'No stock yet'} hint={pieces.length ? 'Try another status or search.' : 'Pieces appear here once a handover is recorded.'} />
      ) : (
        <div className="card overflow-hidden">
          {/* Desktop */}
          <table className="hidden w-full md:table">
            <thead><tr className="bg-subtle/70">
              {canEdit && <th className="th w-8" />}
              {['Product', 'Size', ...moneyCols, 'Status', 'Date / Invoice', ''].map((h, i) => <th key={i} className="th">{h}</th>)}
            </tr></thead>
            <motion.tbody layout className="divide-y divide-line">
              <AnimatePresence initial={false}>
                {visible.map((o) => {
                  const drafting = editingPrice[o.id] !== undefined
                  const gross = drafting ? Number(editingPrice[o.id]) || 0 : Number(o.aedPrice) || 0
                  const m = pieceMoney(o, gross)
                  return (
                    <motion.tr key={o.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease }} className={selected.has(o.id) ? 'bg-plum-50/60 dark:bg-plum-900/20' : 'hover:bg-subtle/50'}>
                      {canEdit && <td className="pl-4">{o.status === 'FC - At Store' && <input type="checkbox" className="accent-plum-600" checked={selected.has(o.id)} onChange={() => toggle(o.id)} aria-label="Select for return" />}</td>}
                      <td className="td">
                        <div className="flex items-center gap-3">
                          {o.imageUrl && <img src={o.imageUrl} alt="" className="h-9 w-9 rounded-md object-cover" loading="lazy" />}
                          <div className="min-w-0"><p className="truncate font-medium text-ink">{o.product}</p>{o.resellerCode && <p className="tabular-nums font-medium text-[11px] text-faint">{o.resellerCode}</p>}</div>
                        </div>
                      </td>
                      <td className="td">{o.size || '—'}</td>
                      {showMoney && (
                        <>
                          <td className="td">
                            {canEdit ? (
                              <div className="flex items-center gap-1">
                                <span className="text-[11px] text-faint">{cur}</span>
                                <input type="number" className="w-20 rounded-md border border-line bg-surface px-2 py-1 text-sm font-semibold text-ink focus:border-plum-400 focus:outline-none"
                                  value={drafting ? editingPrice[o.id] : (o.aedPrice ?? '')}
                                  onChange={(e) => setEditingPrice((p) => ({ ...p, [o.id]: e.target.value }))}
                                  onBlur={() => savePrice(o)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
                              </div>
                            ) : <span className="font-semibold text-ink">{fmt(o.aedPrice)}</span>}
                          </td>
                          <td className="td">{(o.designerDiscount || 0) + (o.resellerDiscount || 0) ? fmt((o.designerDiscount || 0) + (o.resellerDiscount || 0)) : '—'}</td>
                          <td className="td text-rose-600 dark:text-rose-400">{gross ? fmt(m.commission) : '—'}</td>
                          <td className="td">{o.alterationCharge ? fmt(o.alterationCharge) : '—'}</td>
                          <td className="td font-semibold text-emerald-700 dark:text-emerald-400">{gross ? fmt(m.netPayable) : '—'}</td>
                        </>
                      )}
                      <td className="td">
                        {canEdit ? (
                          <select className="rounded-md border border-line bg-surface px-2 py-1 text-xs font-semibold text-ink-soft focus:border-plum-400 focus:outline-none"
                            value={o.status} onChange={(e) => changeStatus(o, e.target.value)}>
                            {FC_STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                          </select>
                        ) : <StatusPill status={o.status} />}
                      </td>
                      <td className="td text-xs text-muted"><PieceDate o={o} /></td>
                      <td className="py-3 pr-3 text-right">
                        {canEdit && <button className="btn-icon" onClick={() => setDetailsId(o.id)} title="Sale details"><Pencil size={14} /></button>}
                      </td>
                    </motion.tr>
                  )
                })}
              </AnimatePresence>
            </motion.tbody>
          </table>

          {/* Phone */}
          <div className="divide-y divide-line md:hidden">
            {visible.map((o) => (
              <div key={o.id} className="flex gap-3 p-4" onClick={() => canEdit && setDetailsId(o.id)}>
                {o.imageUrl && <img src={o.imageUrl} alt="" className="h-14 w-14 flex-shrink-0 rounded-lg object-cover" loading="lazy" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="truncate font-medium text-ink">{o.product}</p><p className="text-xs text-muted">{o.size}{o.resellerCode && ` · ${o.resellerCode}`}</p></div>
                    <StatusPill status={o.status} />
                  </div>
                  <div className="mt-1.5 flex items-end justify-between text-xs text-muted">
                    <div><PieceDate o={o} /></div>
                    {showMoney && <div className="text-right"><p className="text-ink">{cur} {fmt(o.aedPrice)}</p><p className="font-semibold text-emerald-700 dark:text-emerald-400">Net {fmt(net(o))}</p></div>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <AnimatePresence>
        {canEdit && selected.size > 0 && (
          <motion.div initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }} transition={{ duration: 0.25, ease }}
            className="fixed inset-x-4 bottom-20 z-30 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-plum-950 px-4 py-3 text-white shadow-2xl md:bottom-6">
            <p className="flex-1 text-sm">{selected.size} piece{selected.size === 1 ? '' : 's'} selected</p>
            <button className="text-xs text-white/70 hover:text-white" onClick={() => setSelected(new Set())}>Clear</button>
            <button className="btn-primary" onClick={() => setReturning({ date: new Date().toISOString().slice(0, 10), reason: '' })}><Undo2 size={15} />Return</button>
          </motion.div>
        )}
      </AnimatePresence>

      <Modal open={!!returning} onClose={() => setReturning(null)} title="Return pieces to Koko" subtitle={`${selected.size} piece${selected.size === 1 ? '' : 's'} coming back from ${reseller?.name || 'the reseller'}`}
        footer={<><button className="btn-secondary" onClick={() => setReturning(null)}>Cancel</button><button className="btn-primary" onClick={saveReturns}>Mark returned</button></>}>
        {returning && (
          <div className="space-y-4 p-5">
            <ul className="max-h-48 space-y-1 overflow-y-auto text-sm text-ink">{pieces.filter((p) => selected.has(p.id)).map((p) => <li key={p.id}>{p.product} <span className="text-faint">· {p.size}</span></li>)}</ul>
            <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
              <Field label="Returned on"><input type="date" className="input" value={returning.date} onChange={(e) => setReturning((r) => ({ ...r, date: e.target.value }))} /></Field>
              <Field label="Reason"><input className="input" value={returning.reason} onChange={(e) => setReturning((r) => ({ ...r, reason: e.target.value }))} placeholder="e.g. end of season, not selling" /></Field>
            </div>
          </div>
        )}
      </Modal>

      {canEdit && detailPiece && (
        <SaleDetailsModal piece={detailPiece} onClose={() => setDetailsId(null)}
          onSave={async (changes) => { replace(await updateConsignmentItem(detailPiece.id, changes)); toast.success('Sale details saved') }} />
      )}
    </div>
  )
}
