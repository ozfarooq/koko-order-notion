import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { FileSpreadsheet, CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react'
import { Modal } from '../../ui/kit'
import { parseSalesSheet, matchSales } from './collageSheet'

const f2 = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const STATUS = {
  ok: { label: 'Matched', icon: CheckCircle2, cls: 'text-emerald-700 dark:text-emerald-400' },
  size: { label: 'Choose the size', icon: AlertTriangle, cls: 'text-amber-700 dark:text-amber-300' },
  recorded: { label: 'Already recorded', icon: Info, cls: 'text-muted' },
  nostock: { label: 'None of this design at the store', icon: XCircle, cls: 'text-rose-600' },
  notfound: { label: 'Design not found', icon: XCircle, cls: 'text-rose-600' },
}

// Upload the reseller's monthly sales sheet; matched lines are added to Enter sales for a final check
export default function ImportSheet({ reseller, pieces, used, onAdd }) {
  const input = useRef(null)
  const [rows, setRows] = useState(null)
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)

  const read = async (file) => {
    if (!file) return
    setBusy(true)
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
      let lines = null, lastError = null
      for (const name of wb.SheetNames) {          // the first sheet that has sales headings
        try { lines = parseSalesSheet(XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' })); break }
        catch (err) { lastError = err }
      }
      if (!lines) throw lastError || new Error('No sales found in this file')
      const available = pieces.filter((p) => !used.has(p.id))
      setRows(matchSales(lines, available).map((r) => ({ ...r, include: r.status === 'ok' })))
      setFileName(file.name)
    } catch (err) { toast.error(err.message) } finally { setBusy(false); if (input.current) input.current.value = '' }
  }

  // Picking a size takes a free piece of that size, not already used by another line
  const chooseSize = (i, size) => setRows((rs) => {
    const takenElsewhere = new Set(rs.filter((r, j) => j !== i && r.pieceId && r.status !== 'recorded').map((r) => r.pieceId))
    const piece = pieces.find((p) => p.productId === rs[i].productId && p.size === size && p.status === 'FC - At Store' && !takenElsewhere.has(p.id) && !used.has(p.id))
    return rs.map((r, j) => (j === i ? { ...r, size, pieceId: piece?.id || '', price: piece?.aedPrice ?? null, status: piece ? 'ok' : 'size', include: !!piece } : r))
  })
  const toggle = (i) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, include: !r.include } : r)))
  const chosen = (rows || []).filter((r) => r.include && r.status === 'ok' && r.pieceId)
  const counts = (rows || []).reduce((m, r) => ({ ...m, [r.status]: (m[r.status] || 0) + 1 }), {})

  const add = () => {
    onAdd(chosen.map((r) => ({
      pieceId: r.pieceId, soldOn: r.soldOn, invoiceNo: r.invoiceNo, code: r.knownCode || r.newCode || '',   // never overwrite a design's code from a sheet
      designerDiscount: r.designerDiscount ? String(r.designerDiscount) : '', resellerDiscount: r.resellerDiscount ? String(r.resellerDiscount) : '',
      alterationCharge: r.alterationCharge ? String(r.alterationCharge) : '',
    })))
    toast.success(`${chosen.length} sale${chosen.length === 1 ? '' : 's'} added below. Check them, then click Record sales.`)
    setRows(null)
  }

  return (
    <>
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"><FileSpreadsheet size={18} /></div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink">Import {reseller.name}'s sales sheet</p>
          <p className="text-xs text-muted">Upload their monthly Excel. Each sale is matched by code and design; you check them before anything is saved.</p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => input.current?.click()} disabled={busy}><FileSpreadsheet size={15} />{busy ? 'Reading…' : 'Choose file'}</button>
        <input ref={input} type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={(e) => read(e.target.files?.[0])} />
      </div>

      <Modal open={!!rows} onClose={() => setRows(null)} size="xl" title="Check the imported sales" subtitle={fileName}
        footer={<>
          <p className="mr-auto self-center text-sm text-muted">{chosen.length} of {rows?.length || 0} ready to add</p>
          <button className="btn-secondary" onClick={() => setRows(null)}>Cancel</button>
          <button className="btn-primary" onClick={add} disabled={!chosen.length}>Add {chosen.length} sale{chosen.length === 1 ? '' : 's'}</button>
        </>}>
        {rows && (
          <div className="space-y-3 p-5">
            <div className="flex flex-wrap gap-2 text-xs">
              {Object.entries(counts).map(([k, n]) => { const S = STATUS[k]; return <span key={k} className={`inline-flex items-center gap-1 rounded-full bg-subtle px-2.5 py-1 font-semibold ${S.cls}`}><S.icon size={12} />{n} {S.label.toLowerCase()}</span> })}
            </div>
            <div className="max-h-[55vh] overflow-auto rounded-xl border border-line">
              <table className="w-full min-w-[860px] text-sm">
                <thead className="sticky top-0 z-10 bg-surface-accent text-left font-label text-[10.5px] uppercase tracking-wider text-ink">
                  <tr><th className="w-8 px-3 py-2" /><th className="px-2 py-2 font-medium">Date</th><th className="px-2 py-2 font-medium">Invoice</th><th className="px-2 py-2 font-medium">On their sheet</th>
                    <th className="px-2 py-2 font-medium">Piece at the store</th><th className="px-2 py-2 text-right font-medium">Gross</th><th className="px-2 py-2 text-right font-medium">Disc.</th><th className="px-2 py-2 text-right font-medium">Alt</th><th className="px-3 py-2 font-medium">Status</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r, i) => {
                    const S = STATUS[r.status]
                    const priceDiff = r.status === 'ok' && r.price != null && r.gross && Math.abs(Number(r.price) - r.gross) >= 1
                    return (
                      <tr key={i} className={r.include && r.status === 'ok' ? '' : 'opacity-70'}>
                        <td className="px-3 py-2"><input type="checkbox" className="h-4 w-4 accent-[#7B2D45]" checked={r.include && r.status === 'ok'} disabled={r.status !== 'ok'} onChange={() => toggle(i)} aria-label="Include this sale" /></td>
                        <td className="whitespace-nowrap px-2 py-2 text-ink-soft">{r.soldOn || <span className="text-rose-600">no date</span>}</td>
                        <td className="px-2 py-2 text-xs text-muted">{r.invoiceNo}</td>
                        <td className="px-2 py-2"><p className="font-mono text-xs font-semibold text-ink">{r.code || '—'}</p><p className="text-xs text-muted">{r.product}</p></td>
                        <td className="px-2 py-2">
                          {r.productId ? (
                            <div className="flex items-center gap-2">
                              {r.imageUrl && <img src={r.imageUrl} alt="" className="h-9 w-7 rounded object-cover object-top" />}
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-ink">{r.product}</p>
                                {r.status === 'size' || (r.status === 'ok' && r.sizes.length > 1) ? (
                                  <select className="mt-0.5 rounded-md border border-line bg-surface px-1.5 py-0.5 text-xs" value={r.size || ''} onChange={(e) => chooseSize(i, e.target.value)}>
                                    <option value="">Which size?</option>
                                    {r.sizes.map((z) => <option key={z} value={z}>{z}</option>)}
                                  </select>
                                ) : r.size ? <p className="text-xs text-muted">{r.size}</p> : null}
                                {r.newCode && <p className="text-[11px] text-sky-700 dark:text-sky-300">Code {r.newCode} will be saved for this design</p>}
                              </div>
                            </div>
                          ) : <span className="text-xs text-faint">—</span>}
                        </td>
                        <td className={`px-2 py-2 text-right tabular-nums ${priceDiff ? 'font-semibold text-amber-700 dark:text-amber-300' : 'text-ink-soft'}`} title={priceDiff ? `Our price is ${f2(r.price)}` : undefined}>{f2(r.gross)}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-ink-soft">{r.designerDiscount + r.resellerDiscount ? f2(r.designerDiscount + r.resellerDiscount) : '—'}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-ink-soft">{r.alterationCharge ? f2(r.alterationCharge) : '—'}</td>
                        <td className={`px-3 py-2 text-xs font-semibold ${S.cls}`}><span className="inline-flex items-center gap-1"><S.icon size={12} />{S.label}</span>{priceDiff && <p className="font-normal text-amber-700 dark:text-amber-300">Our price {f2(r.price)}</p>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted">Sales are matched by code (e.g. KOATLR-010-S), or by design name when the code is new. Lines already entered are recognised by invoice number and left out. Added lines appear in the form below; nothing is saved until you click <b>Record sales</b>.</p>
          </div>
        )}
      </Modal>
    </>
  )
}
