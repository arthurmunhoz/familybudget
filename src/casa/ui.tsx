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
import { grad, prefersReducedMotion } from './util'
import type { Member } from './data'

export function Orb({ size = 40, live = false }: { size?: number; live?: boolean }) {
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full"
      style={{ width: size, height: size, boxShadow: live ? '0 0 0 4px rgb(139 108 255 / .18)' : undefined }}
    >
      <span className="casa-orb absolute inset-[-25%]" />
      <span className="casa-orb-counter relative flex items-center justify-center">
        <Sparkles size={size * 0.48} color="#fff" strokeWidth={2.2} aria-hidden />
      </span>
    </span>
  )
}

export function Avatar({ m, size = 56, ring = false }: { m: Pick<Member, 'first' | 'color' | 'avatar'>; size?: number; ring?: boolean }) {
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-display"
      style={{
        width: size,
        height: size,
        background: m.avatar ? undefined : `${m.color}2E`,
        color: m.color,
        fontSize: size * 0.42,
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
        width: size,
        height: size,
        borderRadius: size * 0.32,
        background: grad(g),
        boxShadow: `0 10px 24px -10px ${g[1]}aa, inset 0 1px 0 rgb(255 255 255 / .35)`,
      }}
    >
      <Icon size={size * 0.5} color="#fff" strokeWidth={2.1} aria-hidden />
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
export function CheckMark({ size = 72, color = '#fff' }: { size?: number; color?: string }) {
  return (
    <svg className="casa-check casa-pop" width={size} height={size} viewBox="0 0 48 48" aria-hidden>
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
>(function Grow({ origin, tint, radius = 36, className = '', style, onBackdrop, scrim = 'soft', children }, ref) {
  const panel = useRef<HTMLDivElement>(null)
  const ghost = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const back = useRef<HTMLDivElement>(null)

  const clipFrom = (): string | null => {
    const el = panel.current
    if (!el || !origin) return null
    const r = el.getBoundingClientRect()
    const top = Math.max(0, origin.top - r.top)
    const left = Math.max(0, origin.left - r.left)
    const right = Math.max(0, r.right - origin.right)
    const bottom = Math.max(0, r.bottom - origin.bottom)
    return `inset(${top}px ${right}px ${bottom}px ${left}px round 28px)`
  }

  useLayoutEffect(() => {
    const el = panel.current
    if (!el) return
    const reduce = prefersReducedMotion()
    back.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reduce ? 150 : 420, easing: 'ease', fill: 'both' })
    const from = clipFrom()
    if (reduce || !from) {
      el.animate([{ opacity: 0, transform: reduce ? 'none' : 'translateY(24px) scale(.98)' }, { opacity: 1, transform: 'none' }], {
        duration: reduce ? 160 : 420,
        easing: EASE,
        fill: 'both',
      })
      if (ghost.current) ghost.current.style.opacity = '0'
      return
    }
    el.animate([{ clipPath: from }, { clipPath: `inset(0px 0px 0px 0px round ${radius}px)` }], { duration: 620, easing: EASE, fill: 'both' })
    ghost.current?.animate([{ opacity: 1 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }], { duration: 560, easing: 'ease-out', fill: 'both' })
    inner.current?.animate(
      [
        { opacity: 0, transform: 'translateY(26px)' },
        { opacity: 0, transform: 'translateY(26px)', offset: 0.3 },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 700, easing: EASE, fill: 'both' },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useImperativeHandle(ref, () => ({
    close: async () => {
      const el = panel.current
      if (!el) return
      const reduce = prefersReducedMotion()
      const from = clipFrom()
      const anims: Animation[] = []
      if (back.current) anims.push(back.current.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduce ? 140 : 380, easing: 'ease', fill: 'both' }))
      if (reduce || !from) {
        anims.push(el.animate([{ opacity: 1 }, { opacity: 0, transform: reduce ? 'none' : 'translateY(20px) scale(.98)' }], { duration: reduce ? 140 : 300, easing: 'ease-in', fill: 'both' }))
      } else {
        anims.push(inner.current!.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: 'ease-in', fill: 'both' }))
        if (ghost.current) anims.push(ghost.current.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 80, easing: 'ease', fill: 'both' }))
        anims.push(
          el.animate([{ clipPath: `inset(0px 0px 0px 0px round ${radius}px)` }, { clipPath: from }], { duration: 460, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'both' }),
        )
      }
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
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
        }}
      />
      <div ref={panel} className={`absolute overflow-hidden ${className}`} style={{ borderRadius: radius, ...style }}>
        <div ref={inner} className="relative h-full w-full">
          {children}
        </div>
        {tint ? <div ref={ghost} className="pointer-events-none absolute inset-0" style={{ background: grad(tint), opacity: 0 }} /> : null}
      </div>
    </div>,
    document.body,
  )
})
