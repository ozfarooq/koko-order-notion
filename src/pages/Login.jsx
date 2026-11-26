import { useEffect, useState } from 'react'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Eye, EyeOff, ArrowRight } from 'lucide-react'
import { useAuth, homeFor } from '../auth/AuthContext'
import { getLookbook } from '../data/storage'
import { LOOKBOOK } from '../data/lookbook'
import { GalleryCanvas } from './login/GalleryCanvas'
import { ease } from '../ui/motion'

const TAGLINE = 'From the first cut to the final fitting, every Koko piece passes through here.'

// Text that comes into focus a letter or a word at a time (blur to sharp, a small rise)
function Reveal({ as = 'p', text, by = 'word', delay = 0, className = '' }) {
  const Tag = motion[as]
  const parts = by === 'letter' ? [...text] : text.split(/(\s+)/)
  const step = by === 'letter' ? 0.045 : 0.05
  return (
    <Tag className={className} aria-label={text} initial="hidden" animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: step, delayChildren: delay } } }}>
      {parts.map((t, i) => (/^\s+$/.test(t) ? <span key={i}>{' '}</span> : (
        <motion.span key={i} aria-hidden className="inline-block"
          variants={{ hidden: { opacity: 0, y: 8, filter: 'blur(8px)' }, show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.7, ease } } }}>
          {t}
        </motion.span>
      )))}
    </Tag>
  )
}

// Opening sequence: logo, then the welcome, then each field, then the button
const seq = { hidden: {}, show: { transition: { staggerChildren: 0.09, delayChildren: 0.1 } } }
const rise = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease } } }

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [pieces, setPieces] = useState(LOOKBOOK)   // replaced by the newest collections once loaded

  useEffect(() => { getLookbook().then((r) => { if (r?.length >= 6) setPieces(r) }).catch(() => {}) }, [])

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
    <div className="grid min-h-[100dvh] grid-cols-[minmax(0,1fr)] bg-surface lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      {/* Sign-in side */}
      <motion.div variants={seq} initial="hidden" animate="show" className="relative isolate flex min-w-0 flex-col overflow-hidden px-6 py-8 sm:px-10 lg:px-16 lg:py-10">
        {/* Two soft glows, wine and champagne, drifting slowly behind the form */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <span className="login-glow login-glow-a" />
          <span className="login-glow login-glow-b" />
        </div>
        <motion.div variants={rise} className="flex items-center gap-3">
          <img src="/brand/emblem.png" alt="" className="h-12 w-auto dark:hidden" />
          <img src="/brand/emblem-white.png" alt="" className="hidden h-12 w-auto opacity-90 dark:block" />
          <img src="/brand/wordmark.png" alt="Koko Atelier" className="h-8 w-auto dark:hidden" />
          <img src="/brand/wordmark-white.png" alt="" className="hidden h-8 w-auto opacity-90 dark:block" />
          <span className="rounded border border-line-strong px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.18em] text-muted">CRM</span>
        </motion.div>

        <motion.div variants={rise} className="mt-6 h-64 overflow-hidden rounded-2xl sm:h-80 lg:hidden"><GalleryCanvas items={pieces} compact /></motion.div>

        <div className="flex flex-1 items-center py-10">
          <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-5">
            <div>
              <p className="eyebrow flex items-center gap-2.5 text-accent">
                <motion.span className="h-px bg-accent" initial={{ width: 0 }} animate={{ width: 22 }} transition={{ duration: 0.7, delay: 0.25, ease }} />
                <motion.span initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.6, delay: 0.35, ease }}>Sign-in</motion.span>
              </p>
              <Reveal as="h1" text="Welcome Back" by="letter" delay={0.45} className="mt-2 text-[2.1rem] leading-tight text-ink" />
              <Reveal as="p" text={TAGLINE} by="word" delay={0.95} className="mt-2 text-sm text-muted" />
            </div>

            <motion.div variants={rise}>
              <label className="label" htmlFor="username">Username</label>
              <input id="username" className="input h-12 rounded-xl" type="text" autoFocus autoComplete="username" autoCapitalize="none"
                value={username} onChange={(e) => setUsername(e.target.value)} />
            </motion.div>
            <motion.div variants={rise}>
              <label className="label" htmlFor="password">Password</label>
              <div className="relative">
                <input id="password" className="input h-12 rounded-xl pr-11" type={show ? 'text' : 'password'} autoComplete="current-password"
                  value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-faint transition hover:text-ink" aria-label={show ? 'Hide password' : 'Show password'}>
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </motion.div>

            {error && (
              <motion.p initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: [0, -6, 6, -3, 0] }} transition={{ duration: 0.35 }}
                className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                {error}
              </motion.p>
            )}

            <motion.div variants={rise}>
              <button type="submit" disabled={loading || !username || !password} className="btn-primary btn-shine group h-12 w-full rounded-xl text-[15px]">
                {loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : null}
                {loading ? 'Signing in…' : 'Sign in'}
                {!loading && <ArrowRight size={16} className="transition-transform duration-300 group-hover:translate-x-1" />}
              </button>
            </motion.div>
          </form>
        </div>

        <motion.p variants={rise} className="text-xs text-faint">Koko Atelier CRM © {new Date().getFullYear()}</motion.p>
      </motion.div>

      {/* Lookbook canvas (desktop) */}
      <div className="hidden p-4 pl-0 lg:block">
        <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.9, ease }}
          className="relative h-full overflow-hidden rounded-[28px] bg-sidebar shadow-lift">
          <GalleryCanvas items={pieces} />
        </motion.div>
      </div>
    </div>
  )
}
