import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion'
import { ease } from '../../ui/motion'

// ── Lookbook: columns of the newest pieces drifting past, with a little mouse parallax ──
function Column({ items, index, mx, my, duration, reverse }) {
  const depth = 8 + index * 6
  const x = useTransform(mx, (v) => v * depth)
  const y = useTransform(my, (v) => v * depth * 1.4)
  const loop = [...items, ...items] // two copies so the scroll can loop seamlessly
  return (
    <motion.div style={{ x, y }} className="min-w-0 flex-1">
      <div className={`marquee-col flex flex-col gap-4 ${reverse ? 'marquee-down' : ''}`} style={{ '--dur': `${duration}s` }}>
        {loop.map((p, i) => (
          <figure key={i} className="group relative aspect-[3/4] overflow-hidden rounded-2xl bg-white/5">
            <img src={p.src} alt="" loading={i < 6 ? 'eager' : 'lazy'} draggable={false}
              onLoad={(e) => e.currentTarget.classList.remove('opacity-0')}
              className="h-full w-full object-cover opacity-0 brightness-[.8] transition duration-700 ease-out group-hover:scale-105 group-hover:brightness-100" />
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

export function Lookbook({ items, mx, my }) {
  const cols = useMemo(() => [0, 1, 2].map((c) => items.filter((_, i) => i % 3 === c)), [items])
  return (
    <motion.div
      initial={{ opacity: 0, scale: 1.08 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.6, ease }}
      className="absolute -inset-y-[20%] inset-x-6 flex rotate-[-4deg] gap-4"
    >
      {cols.map((list, i) => <Column key={i} index={i} items={list} mx={mx} my={my} duration={[64, 52, 74][i]} reverse={i === 1} />)}
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
        <motion.span key={WORDS[i]} className="inline-block italic text-gold-400"
          initial={{ y: '100%', opacity: 0, filter: 'blur(6px)' }} animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
          exit={{ y: '-100%', opacity: 0, filter: 'blur(6px)' }} transition={{ duration: 0.55, ease }}>
          {WORDS[i]},
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

export function Headline({ delay = 0.5 }) {
  const step = 0.08
  return (
    <p className="font-display text-[2.6rem] font-semibold leading-[1.06] tracking-tight text-white xl:text-[3.25rem]">
      <Rise delay={delay}>Every</Rise>{' '}<Rise delay={delay + step}>order,</Rise>
      <br />
      <Rise delay={delay + step * 2}>every</Rise>{' '}
      <span className="inline-block overflow-hidden pb-[0.12em] align-bottom">
        <motion.span className="inline-block" initial={{ y: '110%' }} animate={{ y: 0 }} transition={{ duration: 0.9, delay: delay + step * 3, ease }}>
          <RotatingWord start={delay + step * 3} />
        </motion.span>
      </span>
      <br />
      <Rise delay={delay + step * 4}>in</Rise>{' '}<Rise delay={delay + step * 5}>one</Rise>{' '}<Rise delay={delay + step * 6}>place.</Rise>
    </p>
  )
}

// ── One piece from the newest collection at a time, with its one-line description ──
export function Featured({ items, delay = 1.2 }) {
  const reduce = useReducedMotion()
  const pieces = useMemo(() => items.filter((p) => p.tagline), [items])
  const [i, setI] = useState(0)
  useEffect(() => {
    if (reduce || pieces.length < 2) return
    const t = setInterval(() => setI((n) => (n + 1) % pieces.length), 4200)
    return () => clearInterval(t)
  }, [reduce, pieces.length])
  const p = pieces[i]
  if (!p) return null
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay, ease }}
      className="flex max-w-md items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.06] p-3 pr-5 backdrop-blur-md">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={p.name} className="flex min-w-0 items-center gap-4" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.45, ease }}>
          <img src={p.src} alt="" className="h-16 w-12 flex-shrink-0 rounded-lg object-cover" />
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold-400">{p.collection}</p>
            <p className="font-semibold text-white">{p.name}</p>
            <p className="truncate text-xs text-white/60">{p.tagline}</p>
          </div>
        </motion.div>
      </AnimatePresence>
    </motion.div>
  )
}

// ── Phone: a slim strip of pieces gliding sideways above the form ──
export function PhotoStrip({ items }) {
  const row = items.slice(0, 10).map((p, i) => (
    <img key={i} src={p.src} alt="" draggable={false} className="h-24 w-[72px] flex-shrink-0 rounded-xl object-cover" />
  ))
  return (
    <div className="-mx-6 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)] sm:-mx-10">
      <div className="ticker-track flex w-max gap-3 pr-3" style={{ animationDuration: '40s' }}>{row}{row}</div>
    </div>
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
