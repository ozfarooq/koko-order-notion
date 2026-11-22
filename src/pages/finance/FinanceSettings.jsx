import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Settings2, Plus, Lock, Unlock, CalendarPlus, Search, Download, Upload, Paperclip, CheckCircle2, AlertTriangle, Send } from 'lucide-react'
import {
  getAccounts, createAccount, updateAccount, getPeriods, setPeriodStatus, addFiscalYear, getFinanceSettings, updateFinanceSettings,
  getOpening, postOpening, uploadFinanceFile, readFile, TYPE_LABELS,
} from '../../data/finance'
import { PageHeader, Segmented, Modal, Field, SkeletonRows, ErrorBanner, fmtDate } from '../../ui/kit'
import { FinBadge, balanceOf, formatRs, safePaisa, fmtRs } from './shared'

// ── Chart of accounts ──────────────────────────────────────────────────
function AccountsTab() {
  const [accounts, setAccounts] = useState(null)
  const [q, setQ] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [editing, setEditing] = useState(null)      // account, or {} for a new one
  const load = useCallback(() => getAccounts().then(setAccounts).catch((e) => toast.error(e.message)), [])
  useEffect(() => { load() }, [load])

  const save = async () => {
    try {
      const { id, code, name, type, fsLine, description, isActive, isCurrent, cashFlowClass } = editing
      if (id) await updateAccount(id, { name, fsLine, description, isActive })
      else await createAccount({ code, name, type, fsLine, description, isCurrent: isCurrent === '' ? null : isCurrent === 'true', cashFlowClass })
      toast.success(id ? 'Account updated' : 'Account added'); setEditing(null); load()
    } catch (err) { toast.error(err.message) }
  }
  if (!accounts) return <SkeletonRows rows={8} />
  const term = q.trim().toLowerCase()
  const shown = accounts.filter((a) => (showInactive || a.isActive) && (!term || `${a.code} ${a.name} ${a.fsLine}`.toLowerCase().includes(term)))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input className="input pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Code, name or statement line" />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted"><input type="checkbox" className="h-4 w-4 accent-[#7B2D45]" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />Show inactive (tax, full IFRS)</label>
        <button className="btn-primary" onClick={() => setEditing({ code: '', name: '', type: 'expense', fsLine: '', description: '', isCurrent: '', cashFlowClass: 'operating' })}><Plus size={15} />Add account</button>
      </div>
      {Object.entries(TYPE_LABELS).map(([type, label]) => {
        const list = shown.filter((a) => a.type === type)
        if (!list.length) return null
        return (
          <div key={type} className="card overflow-x-auto">
            <p className="border-b border-line bg-surface-accent px-4 py-2 font-label text-[11px] font-semibold uppercase tracking-wider text-ink">{label}</p>
            <table className="w-full min-w-[680px] text-sm">
              <tbody className="divide-y divide-line">
                {list.map((a) => {
                  const b = balanceOf(a)
                  return (
                    <tr key={a.id} className={`cursor-pointer transition hover:bg-subtle/60 ${a.isActive ? '' : 'opacity-60'}`} onClick={() => setEditing({ ...a })}>
                      <td className="w-20 px-4 py-2 font-mono text-xs font-semibold text-ink">{a.code}</td>
                      <td className="px-2 py-2 text-ink">{a.name}
                        {a.isControl && <span className="ml-2 rounded bg-subtle2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted" title="Kept by the system">System</span>}
                        {a.isTax && <span className="ml-2 rounded bg-subtle2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted">Tax</span>}
                        {!a.isActive && <span className="ml-2 text-[11px] text-faint">inactive</span>}</td>
                      <td className="px-2 py-2 text-xs text-muted">{a.fsLine}</td>
                      <td className={`w-44 px-4 py-2 text-right tabular-nums ${b.unusual ? 'text-rose-600' : 'text-ink'}`}>{b.paisa ? <>{formatRs(b.paisa, { symbol: '' })} <span className="text-xs text-muted">{b.side}</span></> : <span className="text-faint">—</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      })}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? `${editing.code} · ${editing.name}` : 'Add an account'} size="md"
        footer={<><button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button><button className="btn-primary" onClick={save}>Save</button></>}>
        {editing && (
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            {!editing.id && <>
              <Field label="Code" hint="4 digits, or a sub-account like 4200-01"><input className="input font-mono" value={editing.code} onChange={(e) => setEditing((x) => ({ ...x, code: e.target.value }))} /></Field>
              <Field label="Type"><select className="input" value={editing.type} onChange={(e) => setEditing((x) => ({ ...x, type: e.target.value }))}>{Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            </>}
            <Field label="Name" className="sm:col-span-2"><input className="input" value={editing.name} onChange={(e) => setEditing((x) => ({ ...x, name: e.target.value }))} /></Field>
            <Field label="Statement line" hint="e.g. Administrative expenses, Cash and bank"><input className="input" value={editing.fsLine} onChange={(e) => setEditing((x) => ({ ...x, fsLine: e.target.value }))} /></Field>
            {!editing.id ? (
              <Field label="Cash-flow class"><select className="input" value={editing.cashFlowClass} onChange={(e) => setEditing((x) => ({ ...x, cashFlowClass: e.target.value }))}>
                {['operating', 'investing', 'financing', 'cash'].map((c) => <option key={c}>{c}</option>)}</select></Field>
            ) : (
              <Field label="Status">
                <label className="flex h-[42px] cursor-pointer items-center gap-2 text-sm text-ink"><input type="checkbox" className="h-4 w-4 accent-[#7B2D45]" checked={!!editing.isActive} onChange={(e) => setEditing((x) => ({ ...x, isActive: e.target.checked }))} />Active</label>
              </Field>
            )}
            <Field label="Description" className="sm:col-span-2"><input className="input" value={editing.description} onChange={(e) => setEditing((x) => ({ ...x, description: e.target.value }))} /></Field>
            {editing.id && editing.postings > 0 && <p className="text-xs text-muted sm:col-span-2">This account has {editing.postings} posting{editing.postings === 1 ? '' : 's'}, so its code and type are fixed.</p>}
            {editing.isControl && <p className="text-xs text-muted sm:col-span-2">Kept by the system: its sub-ledger posts here. Manual journals can't use it.</p>}
          </div>
        )}
      </Modal>
    </div>
  )
}

// ── Periods ────────────────────────────────────────────────────────────
function PeriodsTab() {
  const [periods, setPeriods] = useState(null)
  const [change, setChange] = useState(null)     // { period, status, needsReason, reason }
  const load = useCallback(() => getPeriods().then(setPeriods).catch((e) => toast.error(e.message)), [])
  useEffect(() => { load() }, [load])

  const apply = async () => {
    try { await setPeriodStatus(change.period.id, change.status, change.reason); toast.success(`${change.period.name}: ${change.status.toLowerCase()}`); setChange(null); load() }
    catch (err) { toast.error(err.message) }
  }
  const addYear = async () => {
    if (!window.confirm('Add the next fiscal year (July to June, plus its adjustment period)?')) return
    try { const r = await addFiscalYear(); toast.success(`FY ${r.fiscalYear} added`); load() } catch (err) { toast.error(err.message) }
  }
  if (!periods) return <SkeletonRows rows={8} />
  const years = [...new Set(periods.map((p) => p.fiscalYear))].filter((y) => y !== '2098-99')    // 2098-99 is the test year
  const actions = (p) => ({
    Open: [{ label: 'Close', status: 'Closed', icon: Lock }],
    Closed: [{ label: 'Reopen', status: 'Open', icon: Unlock, reason: true }, { label: 'Lock', status: 'Locked', icon: Lock }],
    Locked: [{ label: 'Unlock', status: 'Closed', icon: Unlock, reason: true }],
  }[p.status])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1 text-sm text-muted">Closed months take postings only from you, with a reason. Locked months take none. The 13th period holds year-end and audit adjustments.</p>
        <button className="btn-secondary" onClick={addYear}><CalendarPlus size={15} />Add next fiscal year</button>
      </div>
      {years.map((fy) => (
        <div key={fy} className="card overflow-x-auto">
          <p className="border-b border-line bg-surface-accent px-4 py-2 font-label text-[11px] font-semibold uppercase tracking-wider text-ink">FY {fy} · Tax Year {Number(fy.slice(0, 4)) + 1}</p>
          <table className="w-full min-w-[620px] text-sm">
            <tbody className="divide-y divide-line">
              {periods.filter((p) => p.fiscalYear === fy).map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2 font-medium text-ink">{p.name}</td>
                  <td className="px-2 py-2 text-xs text-muted">{fmtDate(p.startsOn)} – {fmtDate(p.endsOn)}</td>
                  <td className="px-2 py-2 text-xs text-muted">{p.entries} entr{p.entries === 1 ? 'y' : 'ies'}</td>
                  <td className="px-2 py-2"><FinBadge status={p.status} />{p.closedBy && <span className="ml-2 text-[11px] text-faint">by {p.closedBy}</span>}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="inline-flex gap-1.5">{actions(p).map((a) => (
                      <button key={a.label} className="btn-secondary px-2.5 py-1 text-xs" onClick={() => setChange({ period: p, status: a.status, needsReason: !!a.reason, reason: '' })}><a.icon size={12} />{a.label}</button>
                    ))}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <Modal open={!!change} onClose={() => setChange(null)} size="sm" title={change ? `${change.period.name}: ${change.status === 'Open' ? 'reopen' : change.status === 'Locked' ? 'lock' : change.period.status === 'Locked' ? 'unlock' : 'close'}` : ''}
        footer={<><button className="btn-secondary" onClick={() => setChange(null)}>Cancel</button><button className="btn-primary" onClick={apply} disabled={change?.needsReason && !change.reason.trim()}>Confirm</button></>}>
        {change && (
          <div className="space-y-3 p-5 text-sm text-ink-soft">
            <p>{change.status === 'Closed' && change.period.status === 'Open' && 'After closing, only you can post into this month, and only with a reason.'}
              {change.status === 'Locked' && 'A locked month takes no postings at all, not even from you.'}
              {change.status === 'Open' && 'Reopening lets anyone with finance access post into this month again.'}
              {change.status === 'Closed' && change.period.status === 'Locked' && 'Unlocking returns the month to closed.'}</p>
            {change.needsReason && <Field label="Reason"><input autoFocus className="input" value={change.reason} onChange={(e) => setChange((c) => ({ ...c, reason: e.target.value }))} /></Field>}
          </div>
        )}
      </Modal>
    </div>
  )
}

// ── Opening balances ───────────────────────────────────────────────────
function OpeningTab() {
  const [data, setData] = useState(null)
  const [accounts, setAccounts] = useState(null)
  const [amounts, setAmounts] = useState({})    // { [accountId]: { debit, credit } }
  const [file, setFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const load = useCallback(() => Promise.all([getOpening(), getAccounts()]).then(([o, a]) => { setData(o); setAccounts(a.filter((x) => x.isActive)) }).catch((e) => toast.error(e.message)), [])
  useEffect(() => { load() }, [load])

  const totals = useMemo(() => {
    let d = 0, c = 0, bad = false
    for (const v of Object.values(amounts)) { const a = safePaisa(v.debit), b = safePaisa(v.credit); if (Number.isNaN(a) || Number.isNaN(b)) bad = true; else { d += a; c += b } }
    return { d, c, bad }
  }, [amounts])
  const set = (id, side, v) => setAmounts((x) => ({ ...x, [id]: { ...(x[id] || {}), [side]: v, ...(v ? { [side === 'debit' ? 'credit' : 'debit']: '' } : {}) } }))

  const downloadTemplate = async () => {
    const XLSX = await import('xlsx')
    const rows = [['Code', 'Account', 'Debit', 'Credit'], ...accounts.filter((a) => ['asset', 'liability', 'equity'].includes(a.type)).map((a) => [a.code, a.name, '', ''])]
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Opening balances')
    XLSX.writeFile(wb, `Koko opening balances ${data.goLiveDate}.xlsx`)
  }
  const importSheet = async (f) => {
    if (!f) return
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' })
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' })
      const head = rows.findIndex((r) => r.map((x) => String(x).trim().toLowerCase()).includes('code'))
      if (head < 0) throw new Error('No Code column found. Use the template.')
      const h = rows[head].map((x) => String(x).trim().toLowerCase())
      const [ci, di, ki] = ['code', 'debit', 'credit'].map((k) => h.indexOf(k))
      const next = {}, unknown = []
      for (const r of rows.slice(head + 1)) {
        const code = String(r[ci] ?? '').trim(); if (!code) continue
        const a = accounts.find((x) => x.code === code)
        const debit = r[di] === '' ? '' : String(r[di]).replace(/,/g, ''), credit = r[ki] === '' ? '' : String(r[ki]).replace(/,/g, '')
        if (!debit && !credit) continue
        if (!a) { unknown.push(code); continue }
        next[a.id] = { debit, credit }
      }
      setAmounts(next); setFile(f)
      toast.success(`${Object.keys(next).length} balances read from ${f.name}`, unknown.length ? { description: `Unknown codes skipped: ${unknown.join(', ')}` } : undefined)
    } catch (err) { toast.error(err.message) }
  }
  const post = async () => {
    if (!window.confirm(`Post opening balances of ${formatRs(totals.d)} dated ${fmtDate(data.goLiveDate)}? Posted entries can't be edited, only reversed.`)) return
    setSaving(true)
    try {
      let fileId = null
      if (file) fileId = (await uploadFinanceFile({ ...(await readFile(file)), folder: 'Opening balances' })).id
      const e = await postOpening({ fileId, lines: Object.entries(amounts).map(([accountId, v]) => ({ accountId, debit: v.debit, credit: v.credit })) })
      toast.success(`${e.entryNo} posted`); setAmounts({}); load()
    } catch (err) { toast.error(err.message) } finally { setSaving(false) }
  }

  if (!data || !accounts) return <SkeletonRows rows={8} />
  if (data.entry) return (
    <div className="card space-y-2 p-5">
      <p className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-400"><CheckCircle2 size={16} />Opening balances posted for FY {data.fiscalYear}</p>
      <p className="text-sm text-muted"><Link className="font-mono font-semibold text-accent" to={`/finance/journals/${data.entry.id}`}>{data.entry.entryNo}</Link> · {fmtDate(data.entry.date)} · {fmtRs(data.entry.total)} · {data.entry.lines.length} accounts</p>
      <p className="text-xs text-muted">To change them, reverse that entry and post the corrected balances.</p>
    </div>
  )
  const balanced = !totals.bad && totals.d === totals.c && totals.d > 0
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Enter your accountant's balances at the day before go-live; they post as one entry dated <b>{fmtDate(data.goLiveDate)}</b>. Fill the grid, or download the template, fill it in Excel and import it.</p>
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary" onClick={downloadTemplate}><Download size={15} />Download template</button>
        <label className="btn-secondary cursor-pointer"><Upload size={15} />Import filled template<input type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={(e) => { importSheet(e.target.files?.[0]); e.target.value = '' }} /></label>
        {file && <span className="inline-flex items-center gap-1 self-center text-xs text-muted"><Paperclip size={12} />{file.name} will be kept with the entry</span>}
      </div>
      {Object.entries(TYPE_LABELS).map(([type, label]) => {
        const list = accounts.filter((a) => a.type === type && ['asset', 'liability', 'equity'].includes(type))
        if (!list.length) return null
        return (
          <div key={type} className="card overflow-x-auto">
            <p className="border-b border-line bg-surface-accent px-4 py-2 font-label text-[11px] font-semibold uppercase tracking-wider text-ink">{label}</p>
            <table className="w-full min-w-[620px] text-sm"><tbody className="divide-y divide-line">
              {list.map((a) => (
                <tr key={a.id}>
                  <td className="w-20 px-4 py-1.5 font-mono text-xs font-semibold text-ink">{a.code}</td>
                  <td className="px-2 py-1.5 text-ink">{a.name}</td>
                  <td className="w-36 px-2 py-1.5"><input inputMode="decimal" placeholder="Debit" className="input py-1.5 text-right text-sm tabular-nums" value={amounts[a.id]?.debit || ''} onChange={(e) => set(a.id, 'debit', e.target.value)} /></td>
                  <td className="w-36 px-4 py-1.5"><input inputMode="decimal" placeholder="Credit" className="input py-1.5 text-right text-sm tabular-nums" value={amounts[a.id]?.credit || ''} onChange={(e) => set(a.id, 'credit', e.target.value)} /></td>
                </tr>
              ))}
            </tbody></table>
          </div>
        )
      })}
      <div className="sticky bottom-3 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-lift">
        <span className="text-sm tabular-nums text-ink">Debits <b>{formatRs(totals.d)}</b> · Credits <b>{formatRs(totals.c)}</b></span>
        {totals.bad ? <span className="text-sm text-rose-600">An amount isn't valid</span> : balanced ? <span className="inline-flex items-center gap-1 text-sm text-emerald-700 dark:text-emerald-400"><CheckCircle2 size={14} />Balanced</span>
          : (totals.d || totals.c) ? <span className="inline-flex items-center gap-1 text-sm text-amber-700 dark:text-amber-300"><AlertTriangle size={14} />Difference {formatRs(Math.abs(totals.d - totals.c))}</span> : null}
        <button className="btn-primary ml-auto" onClick={post} disabled={!balanced || saving}><Send size={15} />{saving ? 'Posting…' : 'Post opening balances'}</button>
      </div>
    </div>
  )
}

// ── Settings ───────────────────────────────────────────────────────────
function SettingsTab() {
  const [s, setS] = useState(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => { getFinanceSettings().then(setS).catch((e) => toast.error(e.message)) }, [])
  const save = async () => {
    setSaving(true)
    try { setS(await updateFinanceSettings({ companyName: s.companyName, reportingFramework: s.reportingFramework, goLiveDate: s.goLiveDate, accountingPolicies: s.accountingPolicies })); toast.success('Settings saved') }
    catch (err) { toast.error(err.message) } finally { setSaving(false) }
  }
  if (!s) return <SkeletonRows rows={4} />
  const set = (k) => (e) => setS((x) => ({ ...x, [k]: e.target.value }))
  return (
    <div className="card grid max-w-3xl gap-4 p-5 sm:grid-cols-2">
      <Field label="Company name" className="sm:col-span-2"><input className="input" value={s.companyName} onChange={set('companyName')} /></Field>
      <Field label="Reporting framework" hint="Your accountant confirms which applies">
        <select className="input" value={s.reportingFramework} onChange={set('reportingFramework')}>
          <option value="IFRS_SMES">IFRS for SMEs</option><option value="AFRS_SSE">AFRS for SSEs</option><option value="IFRS">Full IFRS</option>
        </select>
      </Field>
      <Field label="Go-live date" hint="Opening balances are dated this day; fixed once anything is posted"><input type="date" className="input" value={s.goLiveDate} onChange={set('goLiveDate')} /></Field>
      <Field label="Revenue counts when"><p className="input bg-subtle text-ink-soft">The order is paid</p></Field>
      <Field label="Tax"><p className="input bg-subtle text-ink-soft">{s.taxEnabled ? `On from ${fmtDate(s.taxEnabledFrom)}` : 'Off · planned from 1 July 2027 (Phase F7)'}</p></Field>
      <Field label="Accounting policies" hint="Printed in the notes to the financial statements" className="sm:col-span-2">
        <textarea className="input" rows={4} value={s.accountingPolicies} onChange={set('accountingPolicies')} />
      </Field>
      <div className="flex justify-end sm:col-span-2"><button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button></div>
    </div>
  )
}

export default function FinanceSettings() {
  const [tab, setTab] = useState('accounts')
  const [error, setError] = useState(null)
  useEffect(() => { getFinanceSettings().catch((e) => setError(e.message)) }, [])
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader eyebrow="Finance" title="Finance settings" icon={Settings2} subtitle="Chart of accounts, periods, opening balances and settings" />
      <ErrorBanner>{error}</ErrorBanner>
      <Segmented value={tab} onChange={setTab} options={[{ value: 'accounts', label: 'Chart of accounts' }, { value: 'periods', label: 'Periods' }, { value: 'opening', label: 'Opening balances' }, { value: 'settings', label: 'Settings' }]} />
      {tab === 'accounts' && <AccountsTab />}
      {tab === 'periods' && <PeriodsTab />}
      {tab === 'opening' && <OpeningTab />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  )
}
