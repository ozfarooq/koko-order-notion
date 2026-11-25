import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Settings, Building2, Save, Barcode, Wand2, Pencil } from 'lucide-react'
import { getResellers, refreshResellers, addReseller, updateReseller, getResellerCodes, setResellerCode, nextResellerCode } from '../../data/storage'
import { PageHeader, Field, SkeletonRows, ErrorBanner } from '../../ui/kit'
import { confirmDialog } from '../../ui/dialog'

const EMPTY = { name: '', address: '', city: '', country: '', currency: 'AED', commissionPct: 30, codePrefix: '', nextCode: 1 }
const cleanPrefix = (v) => String(v || '').trim().toUpperCase().replace(/-+$/, '')
const pad = (n) => String(Math.max(1, Number(n) || 1)).padStart(3, '0')

// Every design at the reseller with its code. Designs without one are reserved: shipped, waiting for
// the reseller to confirm their number. Type the confirmed code, or give a new design the next number.
function DesignCodes({ resellerId, prefix, version }) {
  const [data, setData] = useState(null)
  const [draft, setDraft] = useState({})
  const [busy, setBusy] = useState(null)
  const load = useCallback(() => { getResellerCodes(resellerId).then((d) => { setData(d); setDraft({}) }).catch((e) => toast.error(e.message)) }, [resellerId])
  useEffect(() => { load() }, [load, version])

  const run = async (productId, fn, done) => {
    setBusy(productId)
    try { const r = await fn(); toast.success(done(r)); load() } catch (err) { toast.error(err.message) } finally { setBusy(null) }
  }
  const save = (d) => run(d.productId, () => setResellerCode(resellerId, d.productId, draft[d.productId]), (r) => (r.code ? `${d.product}: ${r.code}` : `${d.product}: code cleared`))
  const next = async (d) => {
    if (!await confirmDialog(`Give ${d.product} the next number, ${data.nextCode}? Only do this for a design new to the reseller, not one waiting for its code to be confirmed.`)) return
    run(d.productId, () => nextResellerCode(resellerId, d.productId), (r) => `${d.product}: ${r.code}`)
  }

  if (!data) return <SkeletonRows rows={3} />
  const reserved = data.designs.filter((d) => !d.code).length
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        {data.designs.length} design{data.designs.length === 1 ? '' : 's'} at the store, sold or awaiting payment
        {reserved > 0 && <> · <span className="font-semibold text-amber-700 dark:text-amber-400">{reserved} reserved</span>, waiting for the reseller to confirm their code</>}
        {data.nextCode && <> · next new design gets <span className="font-mono font-semibold text-ink">{data.nextCode}</span></>}
      </p>
      <ul className="divide-y divide-line rounded-xl border border-line">
        {data.designs.map((d) => {
          const editing = draft[d.productId] !== undefined
          return (
            <li key={d.productId} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              {d.imageUrl ? <img src={d.imageUrl} alt="" className="h-10 w-8 rounded object-cover object-top" loading="lazy" /> : <div className="h-10 w-8 rounded bg-subtle2" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{d.product}</p>
                <p className="text-[11px] text-muted">First shipped {d.firstHandover} · {d.pieces} piece{d.pieces === 1 ? '' : 's'}</p>
              </div>
              {editing ? (
                <div className="flex items-center gap-1.5">
                  <input autoFocus className="input w-36 py-1.5 font-mono text-sm uppercase" value={draft[d.productId]} placeholder={prefix ? `${prefix}-001` : 'Code'}
                    onChange={(e) => setDraft((x) => ({ ...x, [d.productId]: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), save(d))} />
                  <button type="button" className="btn-primary px-3 py-1.5 text-xs" disabled={busy === d.productId} onClick={() => save(d)}>Save</button>
                  <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setDraft((x) => { const n = { ...x }; delete n[d.productId]; return n })}>Cancel</button>
                </div>
              ) : d.code ? (
                <button type="button" className="font-mono text-sm font-semibold text-ink hover:text-accent" title="Change code" onClick={() => setDraft((x) => ({ ...x, [d.productId]: d.code }))}>{d.code}</button>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300">Reserved</span>
                  <button type="button" className="btn-secondary px-2.5 py-1 text-xs" onClick={() => setDraft((x) => ({ ...x, [d.productId]: '' }))}><Pencil size={12} />Enter code</button>
                  {data.nextCode && <button type="button" className="btn-secondary px-2.5 py-1 text-xs" disabled={busy === d.productId} onClick={() => next(d)}><Wand2 size={12} />Next number</button>}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {!prefix && <p className="text-xs text-muted">Set a prefix and save to use "Next number" for new designs.</p>}
    </div>
  )
}

export default function ResellerSettings() {
  const { resellerId } = useParams()
  const isNew = !resellerId
  const navigate = useNavigate()
  const [form, setForm] = useState(isNew ? EMPTY : null)
  const [original, setOriginal] = useState(null)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (isNew) { setForm(EMPTY); return }
    setForm(null)
    refreshResellers().then((list) => {
      const r = list.find((x) => String(x.id) === String(resellerId))
      if (!r) return setError('Reseller not found')
      const f = { name: r.name || '', address: r.address || '', city: r.city || '', country: r.country || '', currency: r.currency || 'AED', commissionPct: r.commissionPct ?? '', codePrefix: r.codePrefix || '', nextCode: r.nextCode ?? 1 }
      setForm(f); setOriginal(f)
    }).catch((e) => setError(e.message))
  }, [resellerId, isNew])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const body = { ...form, commissionPct: form.commissionPct === '' ? undefined : Number(form.commissionPct), codePrefix: cleanPrefix(form.codePrefix), nextCode: form.nextCode === '' ? undefined : Number(form.nextCode) }
      if (isNew) {
        const r = await addReseller(body)
        await getResellers()
        toast.success(`${form.name} added`)
        navigate(`/resellers/${r.id}/handovers`)
      } else {
        await updateReseller(resellerId, body)
        await getResellers()
        const saved = { ...form, codePrefix: body.codePrefix }
        setForm(saved); setOriginal(saved); setVersion((v) => v + 1)
        toast.success('Settings saved')
      }
    } catch (err) { toast.error(err.message) } finally { setSaving(false) }
  }

  const rateChanged = original && String(original.commissionPct) !== String(form?.commissionPct)
  const prefix = cleanPrefix(form?.codePrefix)

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader eyebrow={isNew ? 'Admin' : original?.name || 'Reseller'} title={isNew ? 'Add a reseller' : 'Settings'} icon={isNew ? Building2 : Settings}
        subtitle={isNew ? 'A store that sells Koko pieces on consignment' : 'Contact details, currency, commission and codes'} />
      <ErrorBanner>{error}</ErrorBanner>
      {!form ? <SkeletonRows rows={4} /> : (
        <form onSubmit={save} className="space-y-6">
          <div className="card space-y-5 p-5 sm:p-6">
            <Field label="Name"><input className="input" value={form.name} onChange={set('name')} required placeholder="e.g. Fashion Collage" /></Field>
            <Field label="Address"><input className="input" value={form.address} onChange={set('address')} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="City"><input className="input" value={form.city} onChange={set('city')} placeholder="Dubai" /></Field>
              <Field label="Country"><input className="input" value={form.country} onChange={set('country')} placeholder="UAE" /></Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Currency" hint="Prices and statements use this currency">
                <input className="input uppercase" maxLength={3} value={form.currency} onChange={set('currency')} required />
              </Field>
              <Field label="Commission %" hint={isNew ? 'Their share of each net sale' : 'Applies to new handovers only'}>
                <input type="number" min="0" max="99.99" step="0.01" className="input" value={form.commissionPct} onChange={set('commissionPct')} required />
              </Field>
            </div>
            {rateChanged && (
              <p className="rounded-lg bg-gold-50 px-3 py-2 text-xs text-gold-800 dark:bg-gold-700/20 dark:text-gold-200">
                Stock already handed over keeps the {original.commissionPct}% agreed at handover. The new {form.commissionPct}% applies from the next handover.
              </p>
            )}
          </div>

          <div className="card space-y-5 p-5 sm:p-6">
            <div className="flex items-center gap-2"><Barcode size={17} className="text-accent" /><h2 className="section-title">Codes &amp; barcodes</h2></div>
            <p className="-mt-2 text-sm text-muted">One code per design; the till barcode adds the size. Enter the codes the reseller confirms; a design new to them gets the next number once they approve the shipment. Designs that were all returned don't need one.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Code prefix" hint="Letters, numbers and dashes. Leave empty for no automatic codes.">
                <input className="input font-mono uppercase" maxLength={21} value={form.codePrefix} onChange={set('codePrefix')} placeholder="KOATLR" />
              </Field>
              <Field label="Next number" hint="For the next new design; skips past any code already used">
                <input type="number" min="1" max="99999" className="input" value={form.nextCode} onChange={set('nextCode')} />
              </Field>
            </div>
            {prefix && (
              <p className="rounded-lg bg-subtle px-3 py-2 text-sm text-ink-soft">
                Next design: <span className="font-mono font-semibold text-ink">{prefix}-{pad(form.nextCode)}</span> · barcodes <span className="font-mono text-ink">{prefix}-{pad(form.nextCode)}-S</span>, <span className="font-mono text-ink">-M</span>, <span className="font-mono text-ink">-L</span>, <span className="font-mono text-ink">-XS</span>, <span className="font-mono text-ink">-XL</span>
              </p>
            )}
            {!isNew && <DesignCodes resellerId={resellerId} prefix={cleanPrefix(original?.codePrefix)} version={version} />}
          </div>

          <div className="flex justify-end">
            <button className="btn-primary" disabled={saving}><Save size={15} />{saving ? 'Saving…' : isNew ? 'Add reseller' : 'Save settings'}</button>
          </div>
        </form>
      )}
    </div>
  )
}
