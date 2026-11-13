// "Quem é?" — a big, friendly picker for any per-person (or per-budget)
// choice: large avatars, a question in display type, and a quiet 20-second
// countdown after which it gives up on its own.
import { useEffect } from 'react'
import { Avatar } from './ui'
import type { PickOption } from './assistant'
import { grad } from './util'

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

  const size = options.length > 4 ? 112 : 140
  return (
    <div className="casa-fade flex w-full flex-col items-center">
      <p className={`font-display text-center text-[clamp(2.6rem,5vw,4rem)] leading-none ${dark ? 'text-white' : ''}`}>{question}</p>
      <div className="mt-10 flex max-w-[1000px] flex-wrap justify-center gap-x-10 gap-y-8">
        {options.map((o, i) => (
          <button
            key={o.id}
            onClick={() => onPick(o.id)}
            className="casa-press casa-rise flex flex-col items-center gap-3"
            style={{ ['--i' as string]: i }}
          >
            {o.gradient ? (
              <span
                className="font-display inline-flex items-center justify-center rounded-full text-white"
                style={{ width: size, height: size, background: grad(o.gradient), fontSize: size * 0.34, boxShadow: `0 18px 40px -18px ${o.gradient[1]}` }}
              >
                {o.label.charAt(0).toUpperCase()}
              </span>
            ) : (
              <span className="rounded-full" style={{ boxShadow: `0 18px 40px -18px ${o.color ?? '#000'}` }}>
                <Avatar m={{ first: o.label, color: o.color ?? '#c2603f', avatar: o.avatar ?? null }} size={size} />
              </span>
            )}
            <span className={`max-w-[10rem] truncate text-[1.5rem] font-semibold ${dark ? 'text-white' : ''}`}>{o.label}</span>
          </button>
        ))}
      </div>
      <div className={`mt-10 h-1.5 w-56 overflow-hidden rounded-full ${dark ? 'bg-white/15' : 'bg-(--surface)'}`}>
        <div key={question} className={`casa-countdown h-full ${dark ? 'bg-white/60' : 'bg-(--text-faint)'}`} style={{ animationDuration: `${PICK_TIMEOUT_MS}ms` }} />
      </div>
    </div>
  )
}
