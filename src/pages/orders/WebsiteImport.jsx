import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Globe, Check, AlertTriangle, ChevronDown, ExternalLink } from 'lucide-react'
import { getWebsiteOrders, importWebsiteOrders } from '../../data/storage'
import { Modal, Skeleton, money, fmtDate } from '../../ui/kit'
import StatusBadge from '../../components/StatusBadge'

const FINANCIAL = {
  PAID: 'bg-[#DCFCE7] text-[#15803D]', PARTIALLY_PAID: 'bg-[#FEF3C7] text-[#B45309]', PENDING: 'bg-[#FEF3C7] text-[#B45309]',
  VOIDED: 'bg-subtle2 text-muted', REFUNDED: 'bg-subtle2 text-muted', PARTIALLY_REFUNDED: 'bg-subtle2 text-muted',
}
const label = (s) => s.toLowerCase().replace(/_/g, ' ')

// Lists website orders that aren't in the app yet and imports the ticked ones
export default function WebsiteImport({ open, onClose, onDone }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState(new Set())
  const [showAll, setShowAll] = useState(false)
  const [openId, setOpenId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  useEffect(() => {
    if (!open) return
    setData(null); setError(''); setResult(null); setShowAll(false)
    getWebsiteOrders().then((d) => {
      setData(d)
      setPicked(new Set(d.orders.filter((o) => o.suggested).map((o) => o.shopifyId)))
    }).catch((err) => setError(err.message))
  }, [open])

  const toggle = (id) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const run = async () => {
    setBusy(true)
    try {
      const r = await importWebsiteOrders([...picked])
      setResult(r)
      if (r.created.length) toast.success(`${r.created.length} website order${r.created.length > 1 ? 's' : ''} imported`)
      onDone()
    } catch (err) { toast.error(err.message) } finally { setBusy(false) }
  }

  const orders = data?.orders || []
  const hidden = orders.filter((o) => !o.suggested)
  const shown = showAll ? orders : orders.filter((o) => o.suggested)

  return (
    <Modal open={open} onClose={onClose} size="lg" title="Import from website"
      subtitle={data ? `Website orders since ${fmtDate(data.since)} that aren't in the app yet` : 'Checking the website for new orders'}
      footer={result || error ? <button className="btn-primary" onClick={onClose}>Done</button> : <>
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={run} disabled={!picked.size || busy}><Globe size={15} />{busy ? 'Importing…' : `Import ${picked.size || ''}`}</button>
      </>}>
      <div className="space-y-3 p-5 text-sm">
        {error && <p className="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"><AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />{error}</p>}
        {!data && !error && <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>}

        {data && !result && (<>
          {shown.length === 0 && <p className="rounded-lg bg-subtle px-4 py-6 text-center text-muted">No new website orders. Everything is already in the app.</p>}
          {shown.map((o) => {
            const on = picked.has(o.shopifyId)
            return (
              <label key={o.shopifyId} className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition ${on ? 'border-brand-primary/60 bg-plum-50/40 dark:bg-plum-900/10' : 'border-line hover:bg-subtle'}`}>
                <input type="checkbox" className="mt-1 h-4 w-4 accent-[#7B2D45]" checked={on} onChange={() => toggle(o.shopifyId)} />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-semibold text-ink">{o.shopifyOrderNumber}</span>
                    <span className="text-muted">{fmtDate(o.order.orderDate)}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${FINANCIAL[o.financialStatus] || 'bg-subtle2 text-muted'}`}>{label(o.financialStatus)}</span>
                    {o.cancelled && <span className="rounded-full bg-[#FEE2E2] px-2 py-0.5 text-[11px] font-medium text-[#E85A4F]">cancelled</span>}
                    {o.test && <span className="rounded-full bg-subtle2 px-2 py-0.5 text-[11px] font-medium text-muted">test</span>}
                    <span className="ml-auto font-semibold tabular-nums text-ink">{money(o.order.amount)}</span>
                  </div>
                  <p className="text-ink">{o.order.customer} <span className="text-muted">· {[o.order.phone, o.order.city].filter(Boolean).join(' · ')}</span></p>
                  <p className="text-muted">
                    {o.order.items.map((i, k) => (
                      <span key={k}>{k > 0 && ', '}<span className={i.matched ? '' : 'text-[#B45309]'} title={i.matched ? '' : 'Not found in the catalogue; saved as text'}>{i.product}</span>{i.size ? ` (${i.size})` : ''}{i.quantity > 1 ? ` × ${i.quantity}` : ''}</span>
                    ))}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    Imports as <StatusBadge status={o.order.status} />{o.order.advancePaid > 0 && <span>· {money(o.order.advancePaid)} paid</span>}
                    <button type="button" className="ml-auto inline-flex items-center gap-1 font-medium text-accent hover:underline"
                      onClick={(e) => { e.preventDefault(); setOpenId((v) => (v === o.shopifyId ? null : o.shopifyId)) }}>
                      Details <ChevronDown size={13} className={`transition ${openId === o.shopifyId ? 'rotate-180' : ''}`} />
                    </button>
                  </div>
                  {openId === o.shopifyId && (
                    <div className="mt-2 space-y-2 rounded-lg bg-subtle p-3 text-xs" onClick={(e) => e.preventDefault()}>
                      <table className="w-full">
                        <tbody>
                          {o.order.items.map((i, k) => (
                            <tr key={k}>
                              <td className="py-0.5 text-ink">{i.product}{i.size ? ` · ${i.size}` : ''}{!i.matched && <span className="ml-1 text-[#B45309]">(not in catalogue)</span>}</td>
                              <td className="py-0.5 text-right tabular-nums text-muted">{i.quantity} × {money(i.unitPrice)}</td>
                            </tr>
                          ))}
                          <tr className="border-t border-line"><td className="pt-1 font-semibold text-ink">Order total</td><td className="pt-1 text-right font-semibold tabular-nums text-ink">{money(o.order.amount)}</td></tr>
                        </tbody>
                      </table>
                      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                        {[['Email', o.order.email], ['Address', [o.order.address, o.order.city].filter(Boolean).join(', ')], ['Payment', o.order.paymentNotes.replace(/^Shopify: /, '')], ['Customer note', o.order.specialInstructions]]
                          .filter(([, v]) => v).flatMap(([k, v]) => [<dt key={k + "t"} className="text-faint">{k}</dt>, <dd key={k + "d"} className="text-ink">{v}</dd>])}
                      </dl>
                      <a href={o.adminUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">Open in Shopify <ExternalLink size={12} /></a>
                    </div>
                  )}
                </div>
              </label>
            )
          })}
          {hidden.length > 0 && (
            <button type="button" className="text-xs font-medium text-accent hover:underline" onClick={() => setShowAll((s) => !s)}>
              {showAll ? 'Hide' : 'Show'} {hidden.length} cancelled, voided or test checkout{hidden.length > 1 ? 's' : ''}
            </button>
          )}
          <p className="text-xs text-muted">
            Customers are matched by phone so repeat clients keep one record. Pieces are matched to the catalogue. Add measurements and the delivery date after importing.
            {data.alreadyImported > 0 && ` ${data.alreadyImported} orders from this period are already in the app.`} Shopify only shares the last 60 days.
          </p>
        </>)}

        {result && (
          <div className="space-y-2">
            {result.created.map((c) => (
              <p key={c.id} className="flex items-center gap-2 text-ink"><Check size={15} className="text-emerald-600" />
                <Link to={`/orders/${c.id}`} className="font-semibold hover:underline" onClick={onClose}>{c.orderNumber}</Link>
                <span className="text-muted">from {c.shopifyOrderNumber} · {c.customer}</span>
              </p>
            ))}
            {!result.created.length && <p className="text-muted">Nothing was imported.</p>}
            {result.skipped.length > 0 && <p className="text-rose-600">Skipped: {result.skipped.join('; ')}</p>}
          </div>
        )}
      </div>
    </Modal>
  )
}
