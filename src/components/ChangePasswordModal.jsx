import { useState } from 'react'
import { X, KeyRound } from 'lucide-react'
import { changePassword } from '../data/storage'

export default function ChangePasswordModal({ onClose }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  const mismatch = confirm && next !== confirm

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (mismatch) return
    setSaving(true)
    setError(null)
    try {
      await changePassword(current, next)
      setDone(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <form className="card w-full max-w-sm p-6 space-y-4" onMouseDown={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900"><KeyRound size={18} /> Change password</h2>
          <button type="button" className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {done ? (
          <>
            <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">Your password has been changed.</p>
            <button type="button" className="btn-primary w-full justify-center" onClick={onClose}>Done</button>
          </>
        ) : (
          <>
            <div>
              <label className="label">Current password</label>
              <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
            </div>
            <div>
              <label className="label">New password</label>
              <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            </div>
            <div>
              <label className="label">Confirm new password</label>
              <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              {mismatch && <p className="mt-1 text-xs text-red-600">Passwords don't match</p>}
            </div>
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
            <button type="submit" className="btn-primary w-full justify-center" disabled={saving || !current || !next || mismatch}>
              {saving ? 'Saving…' : 'Change password'}
            </button>
          </>
        )}
      </form>
    </div>
  )
}
