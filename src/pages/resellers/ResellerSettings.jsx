import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Settings, Building2, Save } from 'lucide-react'
import { getResellers, refreshResellers, addReseller, updateReseller } from '../../data/storage'
import { PageHeader, Field, SkeletonRows, ErrorBanner } from '../../ui/kit'

const EMPTY = { name: '', address: '', city: '', country: '', currency: 'AED', commissionPct: 30 }

export default function ResellerSettings() {
  const { resellerId } = useParams()
  const isNew = !resellerId
  const navigate = useNavigate()
  const [form, setForm] = useState(isNew ? EMPTY : null)
  const [original, setOriginal] = useState(null)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isNew) { setForm(EMPTY); return }
    setForm(null)
    refreshResellers().then((list) => {
      const r = list.find((x) => String(x.id) === String(resellerId))
      if (!r) return setError('Reseller not found')
      const f = { name: r.name || '', address: r.address || '', city: r.city || '', country: r.country || '', currency: r.currency || 'AED', commissionPct: r.commissionPct ?? '' }
      setForm(f); setOriginal(f)
    }).catch((e) => setError(e.message))
  }, [resellerId, isNew])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const body = { ...form, commissionPct: form.commissionPct === '' ? undefined : Number(form.commissionPct) }
      if (isNew) {
        const r = await addReseller(body)
        await getResellers()
        toast.success(`${form.name} added`)
        navigate(`/resellers/${r.id}/handovers`)
      } else {
        await updateReseller(resellerId, body)
        await getResellers()
        setOriginal(form)
        toast.success('Settings saved')
      }
    } catch (err) { toast.error(err.message) } finally { setSaving(false) }
  }

  const rateChanged = original && String(original.commissionPct) !== String(form?.commissionPct)

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader eyebrow={isNew ? 'Admin' : original?.name || 'Reseller'} title={isNew ? 'Add a reseller' : 'Settings'} icon={isNew ? Building2 : Settings}
        subtitle={isNew ? 'A store that sells Koko pieces on consignment' : 'Contact details, currency and commission'} />
      <ErrorBanner>{error}</ErrorBanner>
      {!form ? <SkeletonRows rows={4} /> : (
        <form onSubmit={save} className="card space-y-5 p-5 sm:p-6">
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
          <div className="flex justify-end">
            <button className="btn-primary" disabled={saving}><Save size={15} />{saving ? 'Saving…' : isNew ? 'Add reseller' : 'Save settings'}</button>
          </div>
        </form>
      )}
    </div>
  )
}
