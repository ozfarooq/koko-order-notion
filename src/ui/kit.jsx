// Koko UI kit — small building blocks shared by every screen.
import { useEffect, useRef } from 'react'
import { motion, AnimatePresence, animate, useInView } from 'framer-motion'
import { X } from 'lucide-react'
import { ease } from './motion'

// ── Page header ────────────────────────────────────────────────────────
export function PageHeader({ eyebrow, title, subtitle, actions, icon: Icon }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex items-start gap-3">
        {Icon && (
          <div className="mt-1 hidden h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-plum-50 text-plum-600 ring-1 ring-plum-100 dark:bg-plum-900/40 dark:text-plum-300 dark:ring-plum-800 sm:flex">
            <Icon size={20} />
          </div>
        )}
        <div className="min-w-0">
          {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
          <h1 className="text-2xl leading-tight text-ink sm:text-[1.75rem]">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

// ── Animated number (counts up when shown) ─────────────────────────────
export function AnimatedNumber({ value, format = (n) => Math.round(n).toLocaleString(), className }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true })
  const prev = useRef(0)
  useEffect(() => {
    if (!inView || !ref.current) return
    const from = prev.current
    prev.current = Number(value) || 0
    const controls = animate(from, Number(value) || 0, {
      duration: 0.8, ease,
      onUpdate: (n) => { if (ref.current) ref.current.textContent = format(n) },
    })
    return () => controls.stop()
  }, [value, inView]) // eslint-disable-line react-hooks/exhaustive-deps
  return <span ref={ref} className={className}>{format(0)}</span>
}

// ── Stat card ──────────────────────────────────────────────────────────
const TONES = {
  default: 'text-ink',
  plum: 'text-plum-700 dark:text-plum-300',
  gold: 'text-plum-800 dark:text-plum-300',
  green: 'text-emerald-700 dark:text-emerald-400',
  red: 'text-rose-600 dark:text-rose-400',
  orange: 'text-orange-600 dark:text-orange-400',
}
export function StatCard({ label, value, prefix = '', sub, tone = 'default', icon: Icon, format }) {
  const numeric = typeof value === 'number'
  return (
    <motion.div
      className="card relative overflow-hidden p-4 sm:p-5"
      whileHover={{ y: -2 }}
      transition={{ duration: 0.2 }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted">{label}</p>
        {Icon && <Icon size={16} className="text-faint" />}
      </div>
      <p className={`mt-1.5 font-display text-[1.65rem] font-semibold leading-none ${TONES[tone]}`}>
        {prefix}{numeric ? <AnimatedNumber value={value} format={format} /> : value}
      </p>
      {sub && <p className="mt-1.5 text-xs text-faint">{sub}</p>}
      <div className="gold-rule absolute bottom-0 left-0 right-0 opacity-60" />
    </motion.div>
  )
}

// ── Skeletons ──────────────────────────────────────────────────────────
export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded-lg bg-subtle2/80 ${className}`} />
}
export function SkeletonRows({ rows = 5 }) {
  return (
    <div className="card divide-y divide-line overflow-hidden">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 p-4">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="hidden h-4 w-24 sm:block" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      ))}
    </div>
  )
}
export function SkeletonCards({ count = 4 }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => <Skeleton key={i} className="h-24" />)}
    </div>
  )
}

// ── Empty state ────────────────────────────────────────────────────────
export function EmptyState({ icon: Icon, title, hint, action }) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
      {Icon && (
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-plum-50 text-plum-400 dark:bg-plum-900/40">
          <Icon size={24} />
        </div>
      )}
      <p className="font-display text-xl text-ink">{title}</p>
      {hint && <p className="max-w-sm text-sm text-muted">{hint}</p>}
      {action}
    </div>
  )
}

// ── Error banner ───────────────────────────────────────────────────────
export function ErrorBanner({ children, onRetry }) {
  if (!children) return null
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
      <span>{children}</span>
      {onRetry && <button className="font-semibold underline" onClick={onRetry}>Retry</button>}
    </div>
  )
}

// ── Modal (centered on desktop, bottom sheet on phones) ────────────────
export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const width = { sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-3xl', xl: 'sm:max-w-5xl' }[size]
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center bg-plum-950/40 backdrop-blur-[2px] sm:items-center sm:p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onMouseDown={onClose}
        >
          <motion.div
            role="dialog" aria-modal="true"
            className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-lift sm:rounded-2xl ${width}`}
            initial={{ y: 40, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 40, opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.28, ease }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {title && (
              <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
                <div>
                  <h2 className="font-display text-2xl font-semibold text-ink">{title}</h2>
                  {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
                </div>
                <button className="btn-icon" onClick={onClose} aria-label="Close"><X size={16} /></button>
              </div>
            )}
            <div className="flex-1 overflow-y-auto">{children}</div>
            {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ── Form field ─────────────────────────────────────────────────────────
export function Field({ label, hint, error, children, className = '' }) {
  return (
    <div className={className}>
      {label && <label className="label">{label}</label>}
      {children}
      {error ? <p className="mt-1 text-xs text-rose-600">{error}</p> : hint && <p className="mt-1 text-[11px] text-faint">{hint}</p>}
    </div>
  )
}

// ── Segmented control ──────────────────────────────────────────────────
export function Segmented({ options, value, onChange }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-subtle p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`relative whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition ${value === o.value ? 'text-ink' : 'text-muted hover:text-ink'}`}
        >
          {value === o.value && (
            <motion.span layoutId={`seg-${options.map((x) => x.value).join()}`} className="absolute inset-0 rounded-md bg-surface shadow-sm" transition={{ duration: 0.25, ease }} />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  )
}

// ── Money ──────────────────────────────────────────────────────────────
export const money = (n, cur = 'PKR', digits = 0) =>
  n == null || n === '' ? '—' : `${cur} ${Number(n).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
export const fmtDate = (d, opts = { day: 'numeric', month: 'short', year: 'numeric' }) =>
  d ? new Date(d).toLocaleDateString('en-PK', opts) : '—'
