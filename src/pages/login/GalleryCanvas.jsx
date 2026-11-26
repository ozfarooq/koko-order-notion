import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ease } from '../../ui/motion'

// Endless lookbook canvas: the pieces float at different depths on a field that repeats in every
// direction. It drifts on its own; drag to move it (nearer pieces move faster, and it carries on after
// you let go), scroll to zoom towards the pointer. Hovering a piece shows its name.
const ZOOM_MIN = 0.55
const ZOOM_MAX = 2.4
const DRIFT = { x: 0.014, y: 0.008 }   // px per ms at depth 1
const FRICTION = 0.94                 // momentum kept per 16 ms frame

const sized = (src, w) => (src.includes('width=') ? src.replace(/width=\d+/, `width=${w}`) : src)
const mod = (a, n) => ((a % n) + n) % n

// Seeded, so the layout is the same on every visit
function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 } }

// One piece per cell of a tile big enough to cover the view at the widest zoom
function layout(pieces, width, height, cell) {
  const cols = Math.ceil((width / ZOOM_MIN + cell * 2) / cell)
  const rows = Math.ceil((height / ZOOM_MIN + cell * 2) / cell)
  const r = rng(7)
  const order = pieces.map((p) => ({ p, k: r() })).sort((a, b) => a.k - b.k).map((x) => x.p)
  const items = []
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const n = j * cols + i
      // Neighbours in the grid never show the same piece side by side
      const p = order[(n + j * 3) % order.length]
      items.push({
        id: n, piece: p,
        x: (i + 0.2 + r() * 0.6) * cell, y: (j + 0.2 + r() * 0.6) * cell,
        z: 0.42 + r() * 0.58,
        delay: r() * 0.9,
      })
    }
  }
  return { items: items.sort((a, b) => a.z - b.z), tw: cols * cell, th: rows * cell }
}

export function GalleryCanvas({ items: pieces, compact = false }) {
  const reduce = useReducedMotion()
  const box = useRef(null)
  const els = useRef(new Map())
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [hover, setHover] = useState(null)
  const cell = compact ? 180 : 265
  const photoW = cell * 0.62

  const { items, tw, th } = useMemo(
    () => (size.w && pieces.length ? layout(pieces, size.w, size.h, cell) : { items: [], tw: 1, th: 1 }),
    [pieces, size.w, size.h, cell])

  // Measure the panel (the mobile and desktop copies are each hidden at the other size)
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }))
    ro.observe(box.current)
    return () => ro.disconnect()
  }, [])

  // Camera, momentum and zoom live outside React; each frame writes the transforms directly
  const cam = useRef({ x: 0, y: 0, vx: 0, vy: 0, zoom: 1, target: 1, px: 0, py: 0, drag: null, visible: true })

  useEffect(() => {
    if (!items.length) return
    const c = cam.current
    let raf, last = performance.now()
    const frame = (now) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(48, now - last); last = now
      if (!c.visible) return
      // Zoom eases to its target, keeping the point under the pointer in place
      if (Math.abs(c.target - c.zoom) > 0.0005) {
        const z0 = c.zoom
        c.zoom += (c.target - c.zoom) * Math.min(1, dt / 110)
        c.x += (c.px - size.w / 2) * (1 / z0 - 1 / c.zoom)
        c.y += (c.py - size.h / 2) * (1 / z0 - 1 / c.zoom)
      }
      if (!c.drag) {
        c.x += c.vx * dt; c.y += c.vy * dt
        const keep = Math.pow(FRICTION, dt / 16)
        c.vx *= keep; c.vy *= keep
        if (!reduce) { c.x += DRIFT.x * dt; c.y += DRIFT.y * dt }
      }
      for (const it of items) {
        const el = els.current.get(it.id)
        if (!el) continue
        let u = mod(it.x - c.x * it.z, tw); if (u > tw / 2) u -= tw
        let v = mod(it.y - c.y * it.z, th); if (v > th / 2) v -= th
        const s = it.z * c.zoom
        const sx = size.w / 2 + u * c.zoom
        const sy = size.h / 2 + v * c.zoom
        const half = photoW * 0.7 * s
        const off = sx < -half || sx > size.w + half || sy < -half * 1.4 || sy > size.h + half * 1.4
        el.style.visibility = off ? 'hidden' : 'visible'
        if (!off) el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -50%) scale(${s.toFixed(4)})`
      }
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [items, tw, th, size.w, size.h, photoW, reduce])

  // Stop drawing when the panel is off screen
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => { cam.current.visible = e.isIntersecting })
    io.observe(box.current)
    return () => io.disconnect()
  }, [])

  // Wheel zoom (needs a non-passive listener to keep the page from scrolling)
  useEffect(() => {
    const el = box.current
    const onWheel = (e) => {
      e.preventDefault()
      const r = el.getBoundingClientRect(), c = cam.current
      c.px = e.clientX - r.left; c.py = e.clientY - r.top
      c.target = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, c.target * Math.exp(-e.deltaY * 0.0015)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const onDown = (e) => {
    if (e.button !== 0) return
    const c = cam.current
    c.drag = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 }
    c.vx = 0; c.vy = 0
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = (e) => {
    const c = cam.current, d = c.drag
    if (!d) return
    const now = performance.now()
    const dx = e.clientX - d.x, dy = e.clientY - d.y, dt = Math.max(1, now - d.t)
    c.x -= dx / c.zoom; c.y -= dy / c.zoom
    // Smoothed release speed (camera px per ms)
    c.vx = c.vx * 0.6 + (-dx / c.zoom / dt) * 0.4
    c.vy = c.vy * 0.6 + (-dy / c.zoom / dt) * 0.4
    d.x = e.clientX; d.y = e.clientY; d.t = now; d.moved += Math.abs(dx) + Math.abs(dy)
    if (d.moved > 4 && hover) setHover(null)
  }
  const onUp = () => {
    const c = cam.current
    if (!c.drag) return
    if (performance.now() - c.drag.t > 80 || reduce) { c.vx = 0; c.vy = 0 }   // held still before letting go
    c.drag = null
  }

  const [dragging, setDragging] = useState(false)

  return (
    <div ref={box}
      className={`relative h-full w-full select-none overflow-hidden bg-sidebar ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      style={{ touchAction: compact ? 'pan-y' : 'none' }}
      onPointerDown={(e) => { onDown(e); setDragging(true) }} onPointerMove={onMove}
      onPointerUp={() => { onUp(); setDragging(false) }} onPointerCancel={() => { onUp(); setDragging(false) }}>

      {items.map((it) => (
        <div key={it.id} ref={(el) => (el ? els.current.set(it.id, el) : els.current.delete(it.id))}
          className="absolute left-0 top-0 will-change-transform" style={{ width: photoW, height: photoW * 1.3, zIndex: Math.round(it.z * 100), visibility: 'hidden' }}
          onPointerEnter={() => !cam.current.drag && setHover(it.piece)} onPointerLeave={() => setHover((h) => (h === it.piece ? null : h))}>
          <img src={sized(it.piece.src, compact ? 360 : 520)} alt="" draggable={false} decoding="async"
            onLoad={(e) => { e.currentTarget.style.opacity = String(0.5 + it.z * 0.5) }}
            className="h-full w-full rounded-xl object-cover object-top opacity-0 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.6)] ring-1 ring-white/10 transition-[opacity,transform,box-shadow] duration-700 hover:!opacity-100 hover:ring-gold-400/70"
            style={{ transitionDelay: `${it.delay}s, 0s, 0s` }} />
        </div>
      ))}

      {/* Shading so the words stay readable, and the wine glow of the brand */}
      <div className="pointer-events-none absolute inset-0 z-[200] bg-[radial-gradient(120%_90%_at_50%_50%,transparent_55%,rgba(0,0,0,0.55))]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[200] h-36 bg-gradient-to-b from-black/70 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[200] h-1/2 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
      <div className="pointer-events-none absolute inset-0 z-[200] bg-[radial-gradient(70%_55%_at_0%_100%,rgba(123,45,69,0.45),transparent_70%)]" />

      <div className={`pointer-events-none absolute inset-x-0 top-0 z-[201] flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.24em] ${compact ? 'p-4' : 'p-7 xl:p-9'}`}>
        <span className="text-gold-300">The Koko lookbook</span>
        {!compact && <span className="text-white/60">Drag to explore · Scroll to zoom</span>}
      </div>

      <div className={`pointer-events-none absolute inset-x-0 bottom-0 z-[201] ${compact ? 'p-4' : 'p-7 xl:p-9'}`}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={hover ? hover.name : 'brand'} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.35, ease }}>
            {hover ? (
              <>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-gold-300">{hover.collection}</p>
                <h2 className={`mt-2 font-display font-semibold uppercase leading-[0.92] tracking-tight text-white ${compact ? 'text-3xl' : 'text-5xl xl:text-6xl'}`}>{hover.name}</h2>
                {hover.tagline && !compact && <p className="mt-3 max-w-md text-[15px] leading-relaxed text-white/75">{hover.tagline}</p>}
              </>
            ) : (
              <>
                <h2 className={`font-display font-semibold uppercase leading-[0.92] tracking-tight text-white ${compact ? 'text-3xl' : 'text-5xl xl:text-6xl'}`}>Koko Atelier</h2>
                <div className="mt-4 flex items-center gap-3">
                  <span className="h-px w-10 bg-gold-400" />
                  <span className="text-xs text-white/60">Every order, every stitch, in one place.</span>
                </div>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
