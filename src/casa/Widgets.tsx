// Modo Casa — "Widgets" display mode: ONE large widget at a time, swiped
// sideways. Pointer drag (touch, pen, mouse) with an axis lock — vertical
// moves stay native scrolling (touch-action: pan-y) — rubber-banding at the
// ends, and a release that carries the finger's velocity into the snap. The
// track moves with transform only, written straight to the element while
// dragging (no React render per frame). Dots + arrows for a tap instead.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useI18n } from '../hooks/useI18n'
import { tick } from './sound'
import { lsGet, lsSet, prefersReducedMotion } from './util'

export interface WidgetPage {
  id: string
  label: string
  /** `active` = this page is the one on screen (run slideshows only then). */
  render: (active: boolean) => ReactNode
}

const KEY = 'casa.widget'
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

export default function Widgets({ pages }: { pages: WidgetPage[] }) {
  const { t } = useI18n()
  const n = pages.length
  const [index, setIndex] = useState(() => {
    const saved = pages.findIndex((p) => p.id === lsGet(KEY))
    return saved >= 0 ? saved : 0
  })
  const box = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const idx = useRef(index)
  idx.current = index

  const place = useCallback((i: number, px: number, ms: number) => {
    const el = track.current
    if (!el) return
    el.style.transition = ms ? `transform ${ms}ms ${EASE}` : 'none'
    el.style.transform = `translate3d(calc(${-i * 100}% + ${px}px), 0, 0)`
  }, [])

  useLayoutEffect(() => place(index, 0, 0), []) // eslint-disable-line react-hooks/exhaustive-deps

  const go = useCallback(
    (i: number, ms = 520) => {
      const to = Math.max(0, Math.min(n - 1, i))
      if (to !== idx.current) tick()
      setIndex(to)
      lsSet(KEY, pages[to]?.id ?? null)
      place(to, 0, prefersReducedMotion() ? 0 : ms)
    },
    [n, pages, place],
  )

  // ── drag ───────────────────────────────────────────────────────────────────
  const drag = useRef<{ id: number; x0: number; y0: number; dx: number; on: boolean; dead: boolean; samples: [number, number][] } | null>(null)
  const swallowClick = useRef(false)

  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, on: false, dead: false, samples: [[e.timeStamp, e.clientX]] }
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId || d.dead) return
    const dx = e.clientX - d.x0
    const dy = e.clientY - d.y0
    if (!d.on) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      if (Math.abs(dy) > Math.abs(dx)) {
        d.dead = true // a vertical scroll: leave it to the page
        return
      }
      d.on = true
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    }
    const atEdge = (idx.current === 0 && dx > 0) || (idx.current === n - 1 && dx < 0)
    d.dx = atEdge ? dx * 0.32 : dx
    d.samples.push([e.timeStamp, e.clientX])
    if (d.samples.length > 6) d.samples.shift()
    place(idx.current, d.dx, 0)
  }
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d || d.id !== e.pointerId || !d.on) return
    swallowClick.current = true
    setTimeout(() => (swallowClick.current = false), 0)
    const w = box.current?.clientWidth || 1
    const [t0, x0] = d.samples[0]
    const [t1, x1] = d.samples[d.samples.length - 1]
    const v = (x1 - x0) / Math.max(1, t1 - t0) // px/ms
    let to = idx.current
    if (d.dx < -w * 0.18 || v < -0.45) to++
    else if (d.dx > w * 0.18 || v > 0.45) to--
    to = Math.max(0, Math.min(n - 1, to))
    // Carry the fling: the faster the release, the shorter the settle.
    const left = Math.abs((idx.current - to) * w + d.dx)
    const ms = Math.round(Math.max(260, Math.min(620, left / Math.max(0.9, Math.abs(v)) * 1.6)))
    go(to, ms)
  }
  const onCancel = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (d?.on && d.id === e.pointerId) place(idx.current, 0, 320)
  }

  // Keyboard arrows (a keyboard-attached device).
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea')) return
      if (e.key === 'ArrowRight') go(idx.current + 1)
      if (e.key === 'ArrowLeft') go(idx.current - 1)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [go])

  const arrow = (dir: -1 | 1) => {
    const Icon = dir < 0 ? ChevronLeft : ChevronRight
    const off = dir < 0 ? index === 0 : index === n - 1
    return (
      <button
        onClick={() => go(index + dir)}
        disabled={off}
        aria-label={dir < 0 ? t('casa.widgets.prev') : t('casa.widgets.next')}
        className="casa-press inline-flex h-12 w-12 items-center justify-center rounded-full bg-(--surface) text-(--text) disabled:opacity-30"
      >
        <Icon size={24} aria-hidden />
      </button>
    )
  }

  return (
    <section className="casa-liquid casa-rise flex h-full min-h-0 flex-col overflow-hidden rounded-[30px]" style={{ ['--i' as string]: 1 }}>
      <div
        ref={box}
        className="relative min-h-0 flex-1 overflow-hidden"
        style={{ touchAction: 'pan-y' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
        onClickCapture={(e) => {
          if (swallowClick.current) {
            e.stopPropagation()
            e.preventDefault()
          }
        }}
      >
        <div ref={track} className="flex h-full" style={{ willChange: 'transform' }}>
          {pages.map((p, i) => (
            <div key={p.id} className="h-full w-full shrink-0 p-3" aria-hidden={i !== index} inert={i !== index ? true : undefined}>
              {Math.abs(i - index) <= 1 ? p.render(i === index) : null}
            </div>
          ))}
        </div>
      </div>
      <footer className="flex shrink-0 items-center gap-3 px-4 pt-1 pb-3">
        {arrow(-1)}
        <div className="flex flex-1 justify-center">
          {/* Static dots + one pill that slides to the current page (transform only). */}
          <div className="relative flex items-center">
            <span
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-0 h-2.5 w-[26px] rounded-full bg-(--text)"
              style={{ transform: `translate3d(${index * 26}px, -50%, 0)`, transition: `transform .45s ${EASE}` }}
            />
            {pages.map((p, i) => (
              <button key={p.id} onClick={() => go(i)} aria-label={p.label} className="inline-flex h-10 w-[26px] items-center justify-center">
                <span className="block h-2.5 w-2.5 rounded-full bg-(--surface-2)" />
              </button>
            ))}
          </div>
        </div>
        {arrow(1)}
      </footer>
    </section>
  )
}
