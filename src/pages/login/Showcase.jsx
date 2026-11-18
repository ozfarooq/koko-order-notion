import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { ease } from '../../ui/motion'

const SLIDE_MS = 5500
// Same Shopify photo at a size fit for a full-height panel
const large = (src) => (src.includes('width=') ? src.replace(/width=\d+/, 'width=1400') : src)

// Story-style progress: past bars full, the current one filling, upcoming empty
function Progress({ count, index, paused, onPick }) {
  return (
    <div className="flex gap-1.5">
      {Array.from({ length: count }).map((_, i) => (
        <button key={i} type="button" onClick={() => onPick(i)} aria-label={`Show piece ${i + 1}`} className="group h-4 flex-1 py-1.5">
          <span className="block h-[3px] overflow-hidden rounded-full bg-white/25 transition group-hover:bg-white/40">
            {i < index && <span className="block h-full w-full bg-white" />}
            {i === index && (
              <span key={`${index}-${paused}`} className="runway-fill block h-full bg-white"
                style={{ animationDuration: `${SLIDE_MS}ms`, animationPlayState: paused ? 'paused' : 'running' }} />
            )}
          </span>
        </button>
      ))}
    </div>
  )
}

// The piece's name rises in letter by letter
function Name({ text, compact }) {
  return (
    <h2 aria-label={text} className={`font-display font-semibold uppercase leading-[0.92] tracking-tight text-white ${compact ? 'text-4xl' : 'text-6xl xl:text-7xl'}`}>
      {[...text].map((ch, i) => (
        <span key={i} className="inline-block overflow-hidden align-bottom">
          <motion.span className="inline-block" initial={{ y: '105%' }} animate={{ y: 0 }} transition={{ duration: 0.8, delay: 0.25 + i * 0.035, ease }}>
            {ch === ' ' ? ' ' : ch}
          </motion.span>
        </span>
      ))}
    </h2>
  )
}

// Full-bleed lookbook slideshow: slow zoom on each photo, a sideways wipe between pieces,
// story bars, the piece's name and one-liner, and the next pieces as thumbnails
export function Runway({ items, compact = false }) {
  const reduce = useReducedMotion()
  const slides = useMemo(() => items.slice(0, 8).map((p) => ({ ...p, hero: large(p.src) })), [items])
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const count = slides.length
  const go = useCallback((n) => setIndex(((n % count) + count) % count), [count])

  useEffect(() => { setIndex(0) }, [count])
  useEffect(() => {
    if (paused || count < 2) return
    const t = setTimeout(() => go(index + 1), SLIDE_MS)
    return () => clearTimeout(t)
  }, [index, paused, count, go])
  // Warm the next photo so the wipe never reveals a blank frame
  useEffect(() => { if (count) { const img = new Image(); img.src = slides[(index + 1) % count].hero } }, [index, count, slides])

  if (!count) return <div className="h-full w-full bg-sidebar" />
  const p = slides[index]
  const upNext = [1, 2, 3].map((k) => ({ ...slides[(index + k) % count], at: (index + k) % count })).slice(0, Math.min(3, count - 1))

  return (
    <div className="relative h-full w-full overflow-hidden bg-sidebar" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      {/* Photos: the new one wipes in over the old one */}
      <AnimatePresence initial={false}>
        <motion.div key={p.hero} className="absolute inset-0"
          initial={reduce ? { opacity: 0 } : { clipPath: 'inset(0 0 0 100%)' }}
          animate={reduce ? { opacity: 1 } : { clipPath: 'inset(0 0 0 0%)' }}
          exit={{ opacity: 1, transition: { duration: 1.1 } }}
          transition={{ duration: 1.1, ease: [0.77, 0, 0.18, 1] }}>
          <motion.img src={p.hero} alt={p.name} draggable={false} className="h-full w-full object-cover object-top"
            initial={{ scale: reduce ? 1 : 1.14 }} animate={{ scale: 1 }} transition={{ duration: reduce ? 0 : SLIDE_MS / 1000 + 1.5, ease: 'linear' }} />
        </motion.div>
      </AnimatePresence>

      {/* Shading so the text stays readable on any photo */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/55 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3/4 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_55%_at_0%_100%,rgba(123,45,69,0.45),transparent_70%)]" />

      {/* Top: story bars, collection and counter */}
      <div className={`absolute inset-x-0 top-0 space-y-3 ${compact ? 'p-4' : 'p-7 xl:p-9'}`}>
        <Progress count={count} index={index} paused={paused} onPick={go} />
        <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.24em]">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={p.collection} className="text-gold-300" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.4 }}>
              {p.collection}
            </motion.span>
          </AnimatePresence>
          <span className="tabular-nums text-white/70">{String(index + 1).padStart(2, '0')} / {String(count).padStart(2, '0')}</span>
        </div>
      </div>

      {/* Bottom: name, one-liner, next pieces */}
      <div className={`absolute inset-x-0 bottom-0 flex items-end justify-between gap-8 ${compact ? 'p-4' : 'p-7 xl:p-9'}`}>
        <div className="min-w-0 max-w-xl" key={p.name}>
          <Name text={p.name} compact={compact} />
          {p.tagline && !compact && (
            <motion.p className="mt-4 max-w-md text-[15px] leading-relaxed text-white/75" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.55, ease }}>
              {p.tagline}
            </motion.p>
          )}
          {!compact && (
            <motion.div className="mt-6 flex items-center gap-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }}>
              <span className="h-px w-10 bg-gold-400" />
              <span className="text-xs text-white/60">Every order, every stitch, in one place.</span>
            </motion.div>
          )}
        </div>

        {!compact && upNext.length > 0 && (
          <div className="hidden flex-shrink-0 xl:block">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/60">Next up</span>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => go(index - 1)} className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white backdrop-blur-md transition hover:bg-white/25" aria-label="Previous piece"><ChevronLeft size={15} /></button>
                <button type="button" onClick={() => go(index + 1)} className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white backdrop-blur-md transition hover:bg-white/25" aria-label="Next piece"><ChevronRight size={15} /></button>
              </div>
            </div>
            <div className="flex gap-2.5">
              <AnimatePresence initial={false} mode="popLayout">
                {upNext.map((n, k) => (
                  <motion.button key={n.hero} type="button" layout onClick={() => go(n.at)}
                    initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24, scale: 0.9 }} transition={{ duration: 0.5, delay: k * 0.05, ease }}
                    className="group relative h-28 w-20 overflow-hidden rounded-xl ring-1 ring-white/15 transition hover:ring-gold-400" aria-label={`Show ${n.name}`}>
                    <img src={n.src} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-110" />
                    <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-1.5 pb-1 pt-4 text-left text-[10px] font-semibold text-white">{n.name}</span>
                  </motion.button>
                ))}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
