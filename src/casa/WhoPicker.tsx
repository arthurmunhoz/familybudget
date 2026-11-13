// "Quem é?" — a big, friendly picker for any per-person (or per-budget)
// choice: large avatars, a question in display type, and a quiet 20-second
// countdown after which it gives up on its own.
import { useEffect } from 'react'
import { Avatar } from './ui'
import type { PickOption } from './assistant'
import { grad, rem, remScale } from './util'

export const PICK_TIMEOUT_MS = 20_000

export default function WhoPicker({
  question,
  options,
  onPick,
  onTimeout,
  dark = false,
}: {
  question: string
  options: PickOption[]
  onPick: (id: string) => void
  onTimeout: () => void
  dark?: boolean
}) {
  useEffect(() => {
    const id = setTimeout(onTimeout, PICK_TIMEOUT_MS)
    return () => clearTimeout(id)
  }, [onTimeout, question])

  // Big faces, but always all on screen: shrink with a short or narrow screen.
  // (Sizes are at the 16 px base; Avatar scales them with the root font.)
  const k = remScale()
  const cap = options.length > 4 ? 112 : 140
  const perRow = Math.min(options.length, window.innerWidth < 600 ? 3 : 5)
  const size = Math.round(Math.max(60, Math.min(cap, (window.innerHeight * 0.17) / k, (window.innerWidth * 0.8) / perRow / k - 24)))
  return (
    <div className="casa-fade flex w-full flex-col items-center">
      <p className={`font-display text-center text-[clamp(1.8rem,min(5vw,7dvh),4rem)] leading-none ${dark ? 'text-white' : ''}`}>{question}</p>
      <div className="mt-[clamp(14px,4dvh,2.5rem)] flex max-w-[62.5rem] flex-wrap justify-center gap-x-[clamp(14px,3vw,2.5rem)] gap-y-[clamp(10px,2.5dvh,2rem)]">
        {options.map((o, i) => (
          <button
            key={o.id}
            onClick={() => onPick(o.id)}
            className="casa-press casa-rise flex flex-col items-center gap-[clamp(4px,1dvh,12px)]"
            style={{ ['--i' as string]: i }}
          >
            {o.gradient ? (
              <span
                className="font-display inline-flex items-center justify-center rounded-full text-white"
                style={{ width: rem(size), height: rem(size), background: grad(o.gradient), fontSize: rem(size * 0.34), boxShadow: `0 18px 40px -18px ${o.gradient[1]}` }}
              >
                {o.label.charAt(0).toUpperCase()}
              </span>
            ) : (
              <span className="rounded-full" style={{ boxShadow: `0 18px 40px -18px ${o.color ?? '#000'}` }}>
                <Avatar m={{ first: o.label, color: o.color ?? '#c2603f', avatar: o.avatar ?? null }} size={size} />
              </span>
            )}
            <span className={`max-w-[10rem] truncate text-[clamp(1.05rem,3dvh,1.5rem)] font-semibold ${dark ? 'text-white' : ''}`}>{o.label}</span>
          </button>
        ))}
      </div>
      <div className={`mt-[clamp(14px,4dvh,2.5rem)] h-1.5 w-56 overflow-hidden rounded-full ${dark ? 'bg-white/15' : 'bg-(--surface)'}`}>
        <div key={question} className={`casa-countdown h-full ${dark ? 'bg-white/60' : 'bg-(--text-faint)'}`} style={{ animationDuration: `${PICK_TIMEOUT_MS}ms` }} />
      </div>
    </div>
  )
}
