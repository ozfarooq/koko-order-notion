import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Users, Plus, FileText } from 'lucide-react'
import { getStaff, getStaffMember, createStaff, updateStaff, setStaffSalary, getSuppliers, createSupplier, updateSupplier, getAccounts, getStatement } from '../../data/finance'
import { PageHeader, Modal, Field, Segmented, SkeletonRows, EmptyState, fmtDate } from '../../ui/kit'
import { fmtRs, safePaisa, todayPk, CategorySelect } from './shared'
import { PeriodPicker, presetRange, Num } from './reportKit'

const TABS = [{ value: 'staff', label: 'Staff' }, { value: 'suppliers', label: 'Suppliers' }]

// Who the studio pays: staff (salary, claims, advances) and suppliers (bills), with what is owed
export default function People() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'staff'
  const [statement, setStatement] = useState(null)   // { type, id, name }
  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6 lg:p-8">
      <PageHeader eyebrow="Finance" title="Staff & suppliers" icon={Users} subtitle="Everyone the studio pays, and what is owed to them right now" />
      <Segmented options={TABS} value={tab} onChange={(v) => setParams({ tab: v })} />
      {tab === 'suppliers' ? <Suppliers onStatement={setStatement} /> : <Staff onStatement={setStatement} />}
      {statement && <Statement {...statement} onClose={() => setStatement(null)} />}
    </div>
  )
}

function Staff({ onStatement }) {
  const [rows, setRows] = useState(null)
  const [editing, setEditing] = useState(null)
  const load = () => getStaff().then(setRows).catch((e) => toast.error(e.message))
  useEffect(() => { load() }, [])
  const open = async (s) => { try { setEditing(s ? await getStaffMember(s.id) : { name: '', roleTitle: 'tailor', payType: 'weekly_salary', isProduction: true, hoursPerDay: 10, weeklySalary: '', salaryFrom: todayPk(), isActive: true }) } catch (err) { toast.error(err.message) } }
  return (
    <>
      <button className="btn-secondary" onClick={() => open(null)}><Plus size={15} />Add staff</button>
      {!rows ? <SkeletonRows rows={4} /> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-surface-accent text-left font-label text-[10.5px] uppercase tracking-wider text-ink">
              <tr><th className="px-4 py-2.5 font-medium">Name</th><th className="px-3 py-2.5 font-medium">Pay</th><th className="px-3 py-2.5 text-right font-medium">Wages owed</th>
                <th className="px-3 py-2.5 text-right font-medium">Claims owed</th><th className="px-3 py-2.5 text-right font-medium">Advances</th><th className="px-4 py-2.5" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((s) => (
                <tr key={s.id} className={`cursor-pointer hover:bg-subtle/60 ${s.isActive ? '' : 'opacity-50'}`} onClick={() => open(s)}>
                  <td className="px-4 py-2.5"><p className="font-medium text-ink">{s.name}</p><p className="text-xs text-muted">{s.roleTitle}{s.hoursPerDay ? ` · ${s.hoursPerDay} h/day` : ''}</p></td>
                  <td className="px-3 py-2.5 text-xs text-muted">{s.payType === 'per_piece_external' ? 'Per piece (not paid by Koko)' : s.weeklySalary ? `${fmtRs(s.weeklySalary, { decimals: false })} / week` : <span className="text-amber-700 dark:text-amber-300">Salary not set</span>}</td>
                  <td className="px-3 py-2.5 text-right"><Num v={s.owedWages} /></td>
                  <td className="px-3 py-2.5 text-right"><Num v={s.owedClaims} /></td>
                  <td className="px-3 py-2.5 text-right"><Num v={s.advances} /></td>
                  <td className="px-4 py-2.5 text-right"><button className="btn-icon" title="Statement" onClick={(e) => { e.stopPropagation(); onStatement({ type: 'staff', id: s.id, name: s.name }) }}><FileText size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <StaffForm s={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
    </>
  )
}

function StaffForm({ s: initial, onClose, onSaved }) {
  const [s, setS] = useState(initial)
  const [salary, setSalary] = useState({ weeklySalary: '', effectiveFrom: todayPk() })
  const [saving, setSaving] = useState(false)
  const set = (p) => setS((x) => ({ ...x, ...p }))
  const save = async () => {
    setSaving(true)
    try {
      if (s.id) {
        await updateStaff(s.id, s)
        if (salary.weeklySalary !== '') await setStaffSalary(s.id, salary)
      } else await createStaff(s)
      toast.success('Saved'); onSaved()
    } catch (err) { toast.error(err.message) } finally { setSaving(false) }
  }
  return (
    <Modal open onClose={onClose} title={s.id ? s.name : 'Add staff'}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></>}>
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Name"><input className="input" value={s.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="Role"><input className="input" value={s.roleTitle} onChange={(e) => set({ roleTitle: e.target.value })} placeholder="tailor, embroidery, cutting master" /></Field>
        <Field label="Pay"><select className="input" value={s.payType} onChange={(e) => set({ payType: e.target.value })}><option value="weekly_salary">Weekly salary</option><option value="per_piece_external">Per piece (external, not paid by Koko)</option></select></Field>
        <Field label="Hours a day"><input inputMode="decimal" className="input" value={s.hoursPerDay ?? ''} onChange={(e) => set({ hoursPerDay: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm text-ink sm:col-span-2"><input type="checkbox" checked={s.isProduction} onChange={(e) => set({ isProduction: e.target.checked })} />
          Works on production (wages are cost of sales); untick for admin staff</label>
        <Field label="Other spellings" hint="Comma separated; how the name appears on bank screenshots" className="sm:col-span-2">
          <input className="input" value={Array.isArray(s.aliases) ? s.aliases.join(', ') : s.aliases || ''} onChange={(e) => set({ aliases: e.target.value })} placeholder="e.g. Abdur Rehman, Abdul Rahman" /></Field>
        <Field label="CNIC" hint="Kept private; never shown in lists"><input className="input" value={s.cnic || ''} onChange={(e) => set({ cnic: e.target.value })} /></Field>
        <Field label="How they are paid"><input className="input" value={s.paymentMethod || ''} onChange={(e) => set({ paymentMethod: e.target.value })} placeholder="e.g. Easypaisa 0300…" /></Field>
        {!s.id && s.payType === 'weekly_salary' && <>
          <Field label="Weekly salary (Rs)"><input inputMode="decimal" className="input" value={s.weeklySalary} onChange={(e) => set({ weeklySalary: e.target.value })} /></Field>
          <Field label="From"><input type="date" className="input" value={s.salaryFrom} onChange={(e) => set({ salaryFrom: e.target.value })} /></Field>
        </>}
        {s.id && s.payType === 'weekly_salary' && (
          <div className="space-y-2 rounded-xl border border-line p-3 sm:col-span-2">
            <p className="text-sm font-semibold text-ink">Weekly salary: {s.weeklySalary ? fmtRs(s.weeklySalary) : 'not set'}</p>
            {s.salaryHistory?.length > 1 && <p className="text-xs text-muted">{s.salaryHistory.map((h) => `${fmtRs(h.weeklySalary, { decimals: false })} from ${fmtDate(h.effectiveFrom)}`).join(' · ')}</p>}
            <div className="flex flex-wrap gap-2"><input inputMode="decimal" className="input w-40" value={salary.weeklySalary} onChange={(e) => setSalary({ ...salary, weeklySalary: e.target.value })} placeholder="New salary" />
              <input type="date" className="input w-auto" value={salary.effectiveFrom} onChange={(e) => setSalary({ ...salary, effectiveFrom: e.target.value })} aria-label="From" /></div>
            <p className="text-[11px] text-faint">A change applies to weeks ending on or after that date.</p>
          </div>
        )}
        <Field label="Notes" className="sm:col-span-2"><input className="input" value={s.notes || ''} onChange={(e) => set({ notes: e.target.value })} /></Field>
        {s.id && <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={s.isActive} onChange={(e) => set({ isActive: e.target.checked })} />Still working at the studio</label>}
      </div>
    </Modal>
  )
}

function Suppliers({ onStatement }) {
  const [rows, setRows] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [editing, setEditing] = useState(null)
  const load = () => getSuppliers().then(setRows).catch((e) => toast.error(e.message))
  useEffect(() => { load(); getAccounts().then(setAccounts).catch(() => {}) }, [])
  const save = async () => {
    try { editing.id ? await updateSupplier(editing.id, editing) : await createSupplier(editing); toast.success('Saved'); setEditing(null); load() } catch (err) { toast.error(err.message) }
  }
  const set = (p) => setEditing((x) => ({ ...x, ...p }))
  return (
    <>
      <button className="btn-secondary" onClick={() => setEditing({ name: '', phone: '', defaultAccountId: '', isRelatedParty: false, notes: '', isActive: true })}><Plus size={15} />Add supplier</button>
      {!rows ? <SkeletonRows rows={4} /> : rows.length === 0 ? <EmptyState icon={Users} title="No suppliers yet" hint="They are added as you enter expenses, or here." /> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="bg-surface-accent text-left font-label text-[10.5px] uppercase tracking-wider text-ink">
              <tr><th className="px-4 py-2.5 font-medium">Supplier</th><th className="px-3 py-2.5 text-right font-medium">Bills</th><th className="px-3 py-2.5 text-right font-medium">Spent</th>
                <th className="px-3 py-2.5 text-right font-medium">Owed now</th><th className="px-4 py-2.5" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((s) => (
                <tr key={s.id} className={`cursor-pointer hover:bg-subtle/60 ${s.isActive ? '' : 'opacity-50'}`} onClick={() => setEditing({ ...s, defaultAccountId: s.defaultAccountId ? String(s.defaultAccountId) : '' })}>
                  <td className="px-4 py-2.5"><p className="font-medium text-ink">{s.name}{s.isRelatedParty && <span className="ml-2 text-[10px] font-semibold uppercase text-amber-700">related party</span>}</p><p className="text-xs text-muted">{s.phone}</p></td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-soft">{s.bills}</td>
                  <td className="px-3 py-2.5 text-right"><Num v={s.spent} /></td>
                  <td className="px-3 py-2.5 text-right">{safePaisa(s.owed) ? <Num v={s.owed} strong /> : <span className="text-faint">—</span>}</td>
                  <td className="px-4 py-2.5 text-right"><button className="btn-icon" title="Statement" onClick={(e) => { e.stopPropagation(); onStatement({ type: 'supplier', id: s.id, name: s.name }) }}><FileText size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <Modal open onClose={() => setEditing(null)} title={editing.id ? editing.name : 'Add supplier'}
          footer={<><button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button><button className="btn-primary" onClick={save}>Save</button></>}>
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Name"><input className="input" value={editing.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="Phone"><input className="input" value={editing.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
            <Field label="Usual category" hint="Filled in when you pick this supplier" className="sm:col-span-2"><CategorySelect accounts={accounts} value={editing.defaultAccountId} onChange={(v) => set({ defaultAccountId: v })} /></Field>
            <label className="flex items-center gap-2 text-sm text-ink sm:col-span-2"><input type="checkbox" checked={editing.isRelatedParty} onChange={(e) => set({ isRelatedParty: e.target.checked })} />Related party (owned by a director or family)</label>
            <Field label="Notes" className="sm:col-span-2"><input className="input" value={editing.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
            {editing.id && <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={editing.isActive} onChange={(e) => set({ isActive: e.target.checked })} />Active</label>}
          </div>
        </Modal>
      )}
    </>
  )
}

// Everything posted against one person: bills, wages, claims, payments, advances
function Statement({ type, id, name, onClose }) {
  const [period, setPeriod] = useState({ preset: 'fytd' })
  const range = presetRange(period.preset, period)
  const [d, setD] = useState(null)
  useEffect(() => { setD(null); getStatement(type, id, range).then(setD).catch((e) => toast.error(e.message)) }, [type, id, range.from, range.to]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal open onClose={onClose} title={`Statement: ${name}`} subtitle="Positive balance = the studio owes them; bracketed = they owe the studio (e.g. an advance)" size="xl">
      <div className="space-y-3 p-5">
        <PeriodPicker value={period} onChange={setPeriod} />
        {!d ? <SkeletonRows rows={5} /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead><tr className="border-b border-line text-left font-label text-[10.5px] uppercase tracking-wider text-muted">
                <th className="px-2 py-2 font-medium">Date</th><th className="px-2 py-2 font-medium">Entry</th><th className="px-2 py-2 font-medium">Details</th>
                <th className="px-2 py-2 text-right font-medium">Paid / owed less</th><th className="px-2 py-2 text-right font-medium">Owed more</th><th className="px-2 py-2 text-right font-medium">Balance</th></tr></thead>
              <tbody className="divide-y divide-line">
                <tr className="bg-subtle/50"><td className="px-2 py-1.5">{fmtDate(d.from)}</td><td /><td className="px-2 py-1.5 font-medium text-ink">Opening balance</td><td /><td /><td className="px-2 py-1.5 text-right"><Num v={d.opening} strong /></td></tr>
                {d.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap px-2 py-1.5 text-ink-soft">{fmtDate(l.date)}</td>
                    <td className="px-2 py-1.5"><Link to={`/finance/journals/${l.entryId}`} className="font-mono text-xs font-semibold text-accent">{l.entryNo}</Link></td>
                    <td className="max-w-[300px] px-2 py-1.5"><p className="truncate text-ink">{l.memo}</p><p className="truncate text-xs text-muted">{l.account}</p></td>
                    <td className="px-2 py-1.5 text-right">{Number(l.debit) ? <Num v={l.debit} /> : ''}</td>
                    <td className="px-2 py-1.5 text-right">{Number(l.credit) ? <Num v={l.credit} /> : ''}</td>
                    <td className="px-2 py-1.5 text-right"><Num v={l.balance} /></td>
                  </tr>
                ))}
                {!d.lines.length && <tr><td colSpan={6} className="px-2 py-5 text-center text-muted">Nothing in this period.</td></tr>}
                <tr className="border-t-2 border-ink/70 font-semibold"><td className="px-2 py-2">{fmtDate(d.to)}</td><td /><td className="px-2 py-2 text-ink">Closing balance</td><td /><td /><td className="px-2 py-2 text-right"><Num v={d.closing} strong /></td></tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  )
}
