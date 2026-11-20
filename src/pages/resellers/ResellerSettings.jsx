import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Settings, Building2, Save, Barcode, Wand2 } from 'lucide-react'
import { getResellers, refreshResellers, addReseller, updateReseller, previewResellerCodes, assignResellerCodes } from '../../data/storage'
import { PageHeader, Field, SkeletonRows, ErrorBanner } from '../../ui/kit'

const EMPTY = { name: '', address: '', city: '', country: '', currency: 'AED', commissionPct: 30, codePrefix: '', nextCode: 1 }
const cleanPrefix = (v) => String(v || '').trim().toUpperCase().replace(/-+$/, '')
const pad = (n) => String(Math.max(1, Number(n) || 1)).padStart(3, '0')

// Outfits without a code, and the codes they would get
function MissingCodes({ resellerId, prefix, version }) {
  const [list, setList] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => { previewResellerCodes(resellerId).then(setList).catch(() => setList([])) }, [resellerId])
  useEffect(() => { load() }, [load, version])

  const assign = async () => {
    if (!window.confirm(`Give ${list.length} outfit${list.length === 1 ? '' : 's'} the codes shown? Codes can't be reused afterwards.`)) return
    setBusy(true)
    try {
      const done = await assignResellerCodes(resellerId)
      toast.success(`${done.length} code${done.length === 1 ? '' : 's'} assigned`, { description: done.map((d) => `${d.product} ${d.code}`).join(', ') })
      load()
    } catch (err) { toast.error(err.message) } finally { setBusy(false) }
  }

  if (!prefix) return <p className="text-xs text-muted">Set a prefix and save to turn on automatic codes.</p>
  if (!list) return <SkeletonRows rows={2} />
  if (!list.length) return <p className="text-xs text-emerald-700 dark:text-emerald-400">Every outfit at this reseller has a code.</p>
  return (
    <div className="space-y-3 rounded-xl border border-line p-4">
      <p className="text-sm text-ink"><span className="font-semibold">{list.length} outfit{list.length === 1 ? '' : 's'}</span> at this reseller {list.length === 1 ? 'has' : 'have'} no code yet. They would get:</p>
      <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {list.map((c) => <li key={c.productId} className="flex justify-between gap-3"><span className="truncate text-ink-soft">{c.product}</span><span className="font-mono font-semibold text-ink">{c.code}</span></li>)}
      </ul>
      <p className="text-xs text-muted">If the reseller already uses a code for one of these, type it in Enter sales or the sale details instead (it applies to every piece of that outfit) before assigning.</p>
      <button type="button" className="btn-primary" onClick={assign} disabled={busy}><Wand2 size={15} />{busy ? 'Assigning…' : `Assign ${list.length} code${list.length === 1 ? '' : 's'}`}</button>
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
            <p className="-mt-2 text-sm text-muted">Each outfit gets the next number when it's first handed over. The till barcode adds the size.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Code prefix" hint="Letters, numbers and dashes. Leave empty for no automatic codes.">
                <input className="input font-mono uppercase" maxLength={21} value={form.codePrefix} onChange={set('codePrefix')} placeholder="KOATLR" />
              </Field>
              <Field label="Next number" hint="Skips past any code already used with this prefix">
                <input type="number" min="1" max="99999" className="input" value={form.nextCode} onChange={set('nextCode')} />
              </Field>
            </div>
            {prefix && (
              <p className="rounded-lg bg-subtle px-3 py-2 text-sm text-ink-soft">
                Next outfit: <span className="font-mono font-semibold text-ink">{prefix}-{pad(form.nextCode)}</span> · barcodes <span className="font-mono text-ink">{prefix}-{pad(form.nextCode)}-S</span>, <span className="font-mono text-ink">-M</span>, <span className="font-mono text-ink">-L</span>, <span className="font-mono text-ink">-XS</span>, <span className="font-mono text-ink">-XL</span>
              </p>
            )}
            {!isNew && <MissingCodes resellerId={resellerId} prefix={cleanPrefix(original?.codePrefix)} version={version} />}
          </div>

          <div className="flex justify-end">
            <button className="btn-primary" disabled={saving}><Save size={15} />{saving ? 'Saving…' : isNew ? 'Add reseller' : 'Save settings'}</button>
          </div>
        </form>
      )}
    </div>
  )
}
