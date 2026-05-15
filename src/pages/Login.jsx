import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { login } from '../utils/auth'

export default function Login() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setTimeout(() => {
      if (login(username, password)) {
        navigate('/', { replace: true })
      } else {
        setError('Invalid username or password.')
        setLoading(false)
      }
    }, 400)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#1a1035]">
      <div className="w-full max-w-sm">
        {/* Logo card */}
        <div className="mb-6 flex flex-col items-center gap-3">
          <img
            src="/kokoLogo.jpg"
            alt="Koko Atelier"
            className="h-20 w-20 rounded-full object-cover ring-4 ring-white/20 shadow-xl"
            onError={(e) => {
              e.target.style.display = 'none'
              e.target.nextSibling.style.display = 'flex'
            }}
          />
          <div className="hidden h-20 w-20 items-center justify-center rounded-full bg-brand-600 text-3xl font-bold text-white">
            K
          </div>
          <div className="text-center">
            <p className="text-xl font-bold tracking-wide text-white">Koko Atelier</p>
            <p className="text-xs tracking-widest text-white/40 uppercase">Order Management</p>
          </div>
        </div>

        {/* Form */}
        <div className="rounded-2xl bg-white p-8 shadow-2xl">
          <h2 className="mb-6 text-center text-lg font-bold text-gray-800">Sign In</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Username</label>
              <input
                className="input"
                type="text"
                autoFocus
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter username"
              />
            </div>
            <div>
              <label className="label">Password</label>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
              />
            </div>

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !username || !password}
              className="btn-primary w-full justify-center py-2.5 disabled:opacity-50"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-white/20">Koko Atelier &copy; 2026</p>
      </div>
    </div>
  )
}
