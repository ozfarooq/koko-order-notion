import { useState, useEffect, useCallback } from 'react'
import { Users as UsersIcon, UserPlus, RefreshCw, Pencil, X, Save } from 'lucide-react'
import { getUsers, addUser, updateUser, getResellers } from '../data/storage'
import { useAuth } from '../auth/AuthContext'

const ROLES = [
  { value: 'owner',    label: 'Owner',    help: 'Everything, including staff accounts and commission rates' },
  { value: 'manager',  label: 'Manager',  help: 'Orders (incl. delete), Fashion Collage prices and statements, revenue' },
  { value: 'staff',    label: 'Staff',    help: 'Create and edit orders; Fashion Collage stock without money' },
  { value: 'reseller', label: 'Reseller', help: "Read-only view of their own reseller's stock" },
]
const roleLabel = (r) => ROLES.find((x) => x.value === r)?.label || r
const fmtWhen = (d) => (d ? new Date(d).toLocaleString('en-PK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Never')

const EMPTY = { name: '', username: '', email: '', phone: '', role: 'staff', resellerId: '', password: '' }

function UserModal({ user, resellers, onClose, onSaved }) {
  const isNew = !user
  const [form, setForm] = useState(isNew ? EMPTY : { ...EMPTY, ...user, resellerId: user.resellerId || '', password: '' })
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const payload = {
      name: form.name, email: form.email, phone: form.phone, role: form.role,
      resellerId: form.role === 'reseller' ? Number(form.resellerId) || null : null,
      ...(form.password ? { password: form.password } : {}),
    }
    try {
      const saved = isNew ? await addUser({ ...payload, username: form.username }) : await updateUser(user.id, payload)
      onSaved(saved)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <form className="card w-full max-w-lg p-6 space-y-4" onMouseDown={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">{isNew ? 'Add user' : `Edit ${user.name}`}</h2>
          <button type="button" className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="label">Full name</label>
            <input className="input" value={form.name} onChange={set('name')} required />
          </div>
          <div>
            <label className="label">Username</label>
            <input className="input" value={form.username} onChange={set('username')} disabled={!isNew} required autoComplete="off" />
          </div>
          <div>
            <label className="label">{isNew ? 'Password' : 'New password'}</label>
            <input className="input" type="password" value={form.password} onChange={set('password')} required={isNew}
                   placeholder={isNew ? '' : 'Leave blank to keep'} autoComplete="new-password" />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={form.email} onChange={set('email')} />
          </div>
          <div>
            <label className="label">Phone</label>
            <input className="input" value={form.phone} onChange={set('phone')} />
          </div>
          <div className="col-span-2">
            <label className="label">Role</label>
            <select className="input" value={form.role} onChange={set('role')}>
              {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-gray-400">{ROLES.find((r) => r.value === form.role)?.help}</p>
          </div>
          {form.role === 'reseller' && (
            <div className="col-span-2">
              <label className="label">Reseller</label>
              <select className="input" value={form.resellerId} onChange={set('resellerId')} required>
                <option value="">Choose…</option>
                {resellers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <p className="mt-1 text-[11px] text-gray-400">This login will only see this reseller's stock.</p>
            </div>
          )}
        </div>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}><Save size={14} />{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  )
}

export default function Users() {
  const { user: me } = useAuth()
  const [users, setUsers] = useState([])
  const [resellers, setResellers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(undefined)   // undefined = closed, null = new, object = edit

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [u, r] = await Promise.all([getUsers(), getResellers()])
      setUsers(u)
      setResellers(r)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const saved = (u) => setUsers((prev) => (prev.some((x) => x.id === u.id) ? prev.map((x) => (x.id === u.id ? u : x)) : [...prev, u]))

  const toggleActive = async (u) => {
    try { saved(await updateUser(u.id, { isActive: !u.isActive })) }
    catch (err) { setError(err.message) }
  }
  const unlock = async (u) => {
    try { saved(await updateUser(u.id, { unlock: true })); }
    catch (err) { setError(err.message) }
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-100"><UsersIcon size={20} className="text-brand-600" /></div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Users</h1>
            <p className="text-sm text-gray-500">Staff and reseller logins · every change they make is recorded</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Refresh</button>
          <button className="btn-primary" onClick={() => setEditing(null)}><UserPlus size={16} />Add user</button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50/80">
              {['Name', 'Username', 'Role', 'Contact', 'Last login', 'Status', ''].map((h) => (
                <th key={h} className="px-4 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-400">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={`border-b border-gray-50 ${u.isActive ? '' : 'opacity-50'}`}>
                <td className="px-4 py-3 text-sm font-semibold text-gray-900">{u.name}{u.id === me?.id && <span className="ml-2 text-xs font-normal text-gray-400">(you)</span>}</td>
                <td className="px-4 py-3 font-mono text-sm text-gray-600">{u.username}</td>
                <td className="px-4 py-3 text-sm text-gray-700">
                  {roleLabel(u.role)}
                  {u.resellerName && <p className="text-xs text-gray-400">{u.resellerName}</p>}
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">{u.email}<p>{u.phone}</p></td>
                <td className="px-4 py-3 text-xs text-gray-500">{fmtWhen(u.lastLoginAt)}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${u.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                    {u.isActive ? 'Active' : 'Disabled'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <button className="btn-secondary px-2 py-1 text-xs" onClick={() => unlock(u)} title="Clear a lock after wrong passwords">Unlock</button>
                    {u.id !== me?.id && (
                      <button className="btn-secondary px-2 py-1 text-xs" onClick={() => toggleActive(u)}>{u.isActive ? 'Disable' : 'Enable'}</button>
                    )}
                    <button className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-brand-50 hover:text-brand-600" onClick={() => setEditing(u)} title="Edit">
                      <Pencil size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing !== undefined && (
        <UserModal user={editing} resellers={resellers} onClose={() => setEditing(undefined)} onSaved={saved} />
      )}
    </div>
  )
}
