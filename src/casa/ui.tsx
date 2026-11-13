// Modo Casa — shared visual pieces: the Roof orb, member avatars, the gradient
// icon chip, the "Plus" lock tag, and <Grow> — the container transform every
// panel and Roof itself open with (a clip-path reveal from the thing tapped,
// so content never stretches), reversed on close.
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Lock, Sparkles, type LucideIcon } from 'lucide-react'
import { grad, prefersReducedMotion, rem } from './util'
import type { Member } from './data'

export function Orb({ size = 40, live = false }: { size?: number; live?: boolean }) {
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full"
      style={{ width: rem(size), height: rem(size), boxShadow: live ? '0 0 0 4px rgb(139 108 255 / .18)' : undefined }}
    >
      <span className="casa-orb absolute inset-[-25%]" />
      <span className="casa-orb-counter relative flex items-center justify-center">
        <Sparkles size={rem(size * 0.48)} color="#fff" strokeWidth={2.2} aria-hidden />
      </span>
    </span>
  )
}

export function Avatar({ m, size = 56, ring = false }: { m: Pick<Member, 'first' | 'color' | 'avatar'>; size?: number; ring?: boolean }) {
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-display"
      style={{
        width: rem(size),
        height: rem(size),
        background: m.avatar ? undefined : `${m.color}2E`,
        color: m.color,
        fontSize: rem(size * 0.42),
        boxShadow: ring ? `0 0 0 3px var(--bg), 0 0 0 5px ${m.color}` : undefined,
      }}
    >
      {m.avatar ? (
        <img src={m.avatar} alt="" className="h-full w-full object-cover" draggable={false} />
      ) : (
        (m.first.charAt(0) || '?').toUpperCase()
      )}
    </span>
  )
}

export function IconChip({ icon: Icon, g, size = 56 }: { icon: LucideIcon; g: readonly string[]; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center"
      style={{
        width: rem(size),
        height: rem(size),
        borderRadius: rem(size * 0.32),
        background: grad(g),
        boxShadow: `0 10px 24px -10px ${g[1]}aa, inset 0 1px 0 rgb(255 255 255 / .35)`,
      }}
    >
      <Icon size={rem(size * 0.5)} color="#fff" strokeWidth={2.1} aria-hidden />
    </span>
  )
}

export function PlusTag({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-(--surface) px-2.5 py-1 text-[13px] font-semibold text-(--text-muted)">
      <Lock size={13} strokeWidth={2.4} aria-hidden />
      {label}
    </span>
  )
}

/** A drawn ✓ in a circle (the confirmation mark). */
export function CheckMark({ size = 72, color = '#fff', max }: { size?: number; color?: string; /** CSS cap, e.g. '14vmin'. */ max?: string }) {
  const w = max ? `min(${rem(size)}, ${max})` : rem(size)
  return (
    <svg className="casa-check casa-pop shrink-0" style={{ width: w, height: w }} viewBox="0 0 48 48" aria-hidden>
      <circle cx="24" cy="24" r="22" fill="rgb(255 255 255 / .22)" />
      <path d="M14 24.5 L21 31.5 L34 17.5" fill="none" stroke={color} strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Ticks every `ms` (aligned to the minute when ms = 60 000 would drift). */
export function useNow(ms = 1000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

// ── Grow ─────────────────────────────────────────────────────────────────────

export interface GrowHandle {
  /** Play the closing animation; resolves when it's done. */
  close: () => Promise<void>
}

const EASE = 'cubic-bezier(0.2, 0.85, 0.15, 1)'

export const Grow = forwardRef<
  GrowHandle,
  {
    origin: DOMRect | null
    /** The tapped thing's gradient, laid over the panel and faded out as it grows. */
    tint?: readonly string[]
    radius?: number
    className?: string
    style?: CSSProperties
    onBackdrop?: () => void
    /** Darker scrim (Roof's full-screen mode). */
    scrim?: 'soft' | 'deep'
    children: ReactNode
  }
>(function Grow({ radius = 36, className = '', style, onBackdrop, scrim = 'soft', children }, ref) {
  const panel = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const back = useRef<HTMLDivElement>(null)



  // Simple and smooth (owner, 2026-11: the clip-path "grow from the card" felt
  // laggy on a tablet): the scrim fades, the panel fades up from a hair below
  // and slightly smaller — opacity + transform only, so it runs on the GPU.
  useLayoutEffect(() => {
    const el = panel.current
    if (!el) return
    const reduce = prefersReducedMotion()
    back.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reduce ? 120 : 220, easing: 'ease-out', fill: 'both' })
    el.animate(
      [
        { opacity: 0, transform: reduce ? 'none' : 'translateY(14px) scale(.985)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: reduce ? 140 : 260, easing: EASE, fill: 'both' },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useImperativeHandle(ref, () => ({
    close: async () => {
      const el = panel.current
      if (!el) return
      const reduce = prefersReducedMotion()
      const anims: Animation[] = []
      if (back.current) anims.push(back.current.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduce ? 100 : 180, easing: 'ease-in', fill: 'both' }))
      anims.push(
        el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: reduce ? 'none' : 'translateY(10px) scale(.99)' }], {
          duration: reduce ? 100 : 180,
          easing: 'ease-in',
          fill: 'both',
        }),
      )
      await Promise.all(anims.map((a) => a.finished.catch(() => undefined)))
    },
  }))

  // Portalled to <body>: an ancestor with a transform (the hub's drift, an
  // entrance animation) would otherwise become the containing block of
  // `fixed` and squeeze the panel into it.
  return createPortal(
    <div className="fixed inset-0 z-40 text-(--text)">
      <div
        ref={back}
        onClick={onBackdrop}
        className="absolute inset-0"
        style={{
          background: scrim === 'deep' ? 'rgb(20 12 30 / .55)' : 'rgb(40 24 14 / .28)',
        }}
      />
      <div ref={panel} className={`absolute overflow-hidden shadow-2xl ${className}`} style={{ borderRadius: radius, willChange: 'transform, opacity', ...style }}>
        <div ref={inner} className="relative h-full w-full">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  )
})
