import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion'
import { LOOKBOOK } from '../../data/lookbook'
import { ease } from '../../ui/motion'

// ── Lookbook: tilted columns of Koko pieces drifting past, with a little mouse parallax ──
function Column({ items, index, mx, my, duration, reverse }) {
  const depth = 10 + index * 8
  const x = useTransform(mx, (v) => v * depth)
  const y = useTransform(my, (v) => v * depth * 1.4)
  const loop = [...items, ...items] // two copies so the scroll can loop seamlessly
  return (
    <motion.div style={{ x, y }} className="w-1/3 flex-shrink-0">
      <div className={`marquee-col flex flex-col gap-4 ${reverse ? 'marquee-down' : ''}`} style={{ '--dur': `${duration}s` }}>
        {loop.map((p, i) => (
          <figure key={i} className="group relative aspect-[3/4] overflow-hidden rounded-2xl bg-[#2C2C2A]">
            <img src={p.src} alt="" loading={i < 6 ? 'eager' : 'lazy'} draggable={false}
              onLoad={(e) => e.currentTarget.classList.remove('opacity-0')}
              className="h-full w-full object-cover opacity-0 brightness-[.72] saturate-[.85] transition duration-700 ease-out group-hover:scale-105 group-hover:brightness-100 group-hover:saturate-100" />
            <figcaption className="absolute inset-x-0 bottom-0 translate-y-full bg-gradient-to-t from-black/70 to-transparent p-3 pt-8 transition duration-500 group-hover:translate-y-0">
              <p className="text-sm font-semibold text-white">{p.name}</p>
              <p className="text-[10px] uppercase tracking-[0.2em] text-white/60">{p.collection}</p>
            </figcaption>
          </figure>
        ))}
      </div>
    </motion.div>
  )
}

export function Lookbook({ mx, my }) {
  const cols = useMemo(() => [0, 1, 2].map((c) => LOOKBOOK.filter((_, i) => i % 3 === c)), [])
  return (
    <motion.div
      initial={{ opacity: 0, scale: 1.12, rotate: -8 }} animate={{ opacity: 1, scale: 1, rotate: -8 }} transition={{ duration: 1.6, ease }}
      className="pointer-events-auto absolute -right-[12%] -top-[25%] flex h-[150%] w-[72%] gap-4 [mask-image:linear-gradient(to_right,transparent,black_30%)]"
    >
      {cols.map((items, i) => <Column key={i} index={i} items={items} mx={mx} my={my} duration={[70, 58, 82][i]} reverse={i === 1} />)}
    </motion.div>
  )
}

// ── Headline: words rise out of a mask, then the key word keeps changing ──
const WORDS = ['stitch', 'fitting', 'silhouette', 'drape', 'detail']

function Rise({ children, delay }) {
  return (
    <span className="inline-block overflow-hidden pb-[0.12em] align-bottom">
      <motion.span className="inline-block" initial={{ y: '110%' }} animate={{ y: 0 }} transition={{ duration: 0.9, delay, ease }}>{children}</motion.span>
    </span>
  )
}

function RotatingWord({ start }) {
  const reduce = useReducedMotion()
  const [i, setI] = useState(0)
  useEffect(() => {
    if (reduce) return
    let timer
    const begin = setTimeout(() => { timer = setInterval(() => setI((n) => (n + 1) % WORDS.length), 2400) }, start * 1000 + 1200)
    return () => { clearTimeout(begin); clearInterval(timer) }
  }, [reduce, start])
  return (
    <span className="relative inline-flex overflow-hidden pb-[0.12em] align-bottom">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={WORDS[i]} className="inline-block italic text-[#E98074]"
          initial={{ y: '100%', opacity: 0, filter: 'blur(6px)' }} animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
          exit={{ y: '-100%', opacity: 0, filter: 'blur(6px)' }} transition={{ duration: 0.55, ease }}>
          {WORDS[i]},
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

export function Headline() {
  const t = 0.35, step = 0.08
  return (
    <div className="relative z-10 max-w-lg">
      <motion.div className="mb-6 h-px bg-gradient-to-r from-brand-primary to-transparent" initial={{ width: 0 }} animate={{ width: 96 }} transition={{ duration: 1, delay: 0.2, ease }} />
      <p className="font-display text-5xl font-semibold leading-[1.08] tracking-tight xl:text-[3.5rem]">
        <Rise delay={t}>Every</Rise>{' '}<Rise delay={t + step}>order,</Rise>
        <br />
        <Rise delay={t + step * 2}>every</Rise>{' '}
        <span className="inline-block overflow-hidden pb-[0.12em] align-bottom">
          <motion.span className="inline-block" initial={{ y: '110%' }} animate={{ y: 0 }} transition={{ duration: 0.9, delay: t + step * 3, ease }}>
            <RotatingWord start={t + step * 3} />
          </motion.span>
        </span>
        <br />
        <Rise delay={t + step * 4}>in</Rise>{' '}<Rise delay={t + step * 5}>one</Rise>{' '}<Rise delay={t + step * 6}>place.</Rise>
      </p>
      <motion.p className="mt-6 max-w-sm text-sm leading-relaxed text-[#8E8D8A]" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 1.1, ease }}>
        Orders, customers and reseller stock for the Koko Atelier studio.
      </motion.p>
    </div>
  )
}

// ── A coral running stitch that sews itself across the panel ──
const THREAD = 'M -20 700 C 160 640, 280 790, 450 700 S 680 540, 800 620 S 920 800, 1040 720'
export function StitchThread() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1000 900" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <mask id="thread-reveal">
          <motion.path d={THREAD} fill="none" stroke="white" strokeWidth="8" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 2.8, delay: 0.6, ease: [0.65, 0, 0.35, 1] }} />
        </mask>
      </defs>
      <path d={THREAD} fill="none" stroke="#E98074" strokeOpacity="0.55" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="10 9" className="stitch-flow" mask="url(#thread-reveal)" />
    </svg>
  )
}

// ── Collection names gliding along the bottom, outlined like an editorial masthead ──
export function CollectionTicker() {
  const names = useMemo(() => [...new Set(LOOKBOOK.map((p) => p.collection))], [])
  const row = names.map((n) => (
    <span key={n} className="flex items-center gap-8 pr-8">
      <span className="ticker-outline font-display text-5xl font-semibold uppercase tracking-tight">{n}</span>
      <span className="h-1.5 w-1.5 rounded-full bg-[#E98074]/70" />
    </span>
  ))
  return (
    <motion.div className="pointer-events-none relative -mx-12 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1.2, delay: 1.3 }}>
      <div className="ticker-track flex w-max">{row}{row}</div>
    </motion.div>
  )
}

// Mouse position over the panel, normalised to -0.5…0.5 and smoothed
export function usePointerParallax() {
  const rawX = useMotionValue(0), rawY = useMotionValue(0)
  const mx = useSpring(rawX, { stiffness: 60, damping: 20 }), my = useSpring(rawY, { stiffness: 60, damping: 20 })
  const onMouseMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    rawX.set((e.clientX - r.left) / r.width - 0.5)
    rawY.set((e.clientY - r.top) / r.height - 0.5)
  }
  const onMouseLeave = () => { rawX.set(0); rawY.set(0) }
  return { mx, my, handlers: { onMouseMove, onMouseLeave } }
}
