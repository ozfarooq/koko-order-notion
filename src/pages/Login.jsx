import { useState } from 'react'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Eye, EyeOff, LogIn } from 'lucide-react'
import { useAuth, homeFor } from '../auth/AuthContext'
import { Lookbook, Headline, StitchThread, CollectionTicker, usePointerParallax } from './login/Showcase'
import { ease } from '../ui/motion'

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const parallax = usePointerParallax()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const u = await login(username, password)
      // Back to the page they were trying to open, unless their role can't use it
      const from = location.state?.from
      navigate(u.role !== 'reseller' && from && !['/login', '/'].includes(from) ? from : homeFor(u), { replace: true })
    } catch (err) {
      setError(err.message || 'Could not sign in')
      setLoading(false)
    }
  }

  if (user) return <Navigate to={homeFor(user)} replace />

  return (
    <div className="grid min-h-[100dvh] bg-canvas lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel */}
      <div {...parallax.handlers} className="relative flex flex-col justify-between overflow-hidden bg-sidebar px-8 py-10 text-[#EAE7DC] sm:px-12 lg:py-14">
        {/* Animated lookbook, running stitch and legibility fades (desktop only) */}
        <div className="absolute inset-0 hidden lg:block">
          <Lookbook mx={parallax.mx} my={parallax.my} />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-sidebar via-sidebar/80 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-sidebar to-transparent" />
          <StitchThread />
        </div>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_60%_at_100%_100%,rgba(233,128,116,0.16),transparent_60%)]" />
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease }} className="relative z-20 -mx-8 -mt-10 flex items-center gap-4 border-b border-brand-primary bg-[#EAE7DC] px-8 py-6 dark:bg-surface sm:-mx-12 sm:px-12 lg:-mt-14">
          <img src="/brand/emblem.png" alt="" className="h-16 w-auto dark:hidden" />
          <img src="/brand/emblem-white.png" alt="" className="hidden h-16 w-auto opacity-90 dark:block" />
          <img src="/brand/wordmark.png" alt="Koko Atelier" className="h-11 w-auto dark:hidden" />
          <img src="/brand/wordmark-white.png" alt="" className="hidden h-11 w-auto opacity-90 dark:block" />
        </motion.div>

        <div className="pointer-events-none relative my-10 hidden lg:block"><Headline /></div>

        <div className="pointer-events-none relative z-10 hidden space-y-6 lg:block">
          <CollectionTicker />
          <p className="text-xs text-[#8E8D8A]/70">Koko Atelier © {new Date().getFullYear()}</p>
        </div>
      </div>

      {/* Form */}
      <div className="flex items-center justify-center px-6 py-10 sm:px-10">
        <motion.form
          onSubmit={handleSubmit}
          initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.15, ease }}
          className="w-full max-w-sm space-y-5"
        >
          <div>
            <p className="eyebrow">Welcome back</p>
            <h1 className="mt-1 text-3xl text-ink">Sign in</h1>
            <p className="mt-1 text-sm text-muted">Use the username and password from your studio account.</p>
          </div>

          <div>
            <label className="label" htmlFor="username">Username</label>
            <input id="username" className="input h-11" type="text" autoFocus autoComplete="username" autoCapitalize="none"
              value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. omer" />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <div className="relative">
              <input id="password" className="input h-11 pr-10" type={show ? 'text' : 'password'} autoComplete="current-password"
                value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-faint hover:text-ink" aria-label={show ? 'Hide password' : 'Show password'}>
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && (
            <motion.p initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: [0, -6, 6, -3, 0] }} transition={{ duration: 0.35 }}
              className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
              {error}
            </motion.p>
          )}

          <button type="submit" disabled={loading || !username || !password} className="btn-primary h-11 w-full">
            {loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <LogIn size={16} />}
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </motion.form>
      </div>
    </div>
  )
}
