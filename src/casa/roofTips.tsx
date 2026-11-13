// What Roof suggests while it listens on the home device, and its "what can
// you do?" screen (owner, 2026-11-13: "it always shows the same sentence").
// Same idea as the phone (mobile/src/components/home/roofTips.ts): each
// opening shows the next example; every fourth one, the hint to ask "what can
// you do?". Only lists what Modo Casa's Roof really does.
import { CalendarDays, ListChecks, PawPrint, Sparkles, Wallet, type LucideIcon } from 'lucide-react'
import { useI18n } from '../hooks/useI18n'
import type { TKey } from '../lib/i18n'
import { GRAD, grad, lsGet, lsSet } from './util'

const TIPS: TKey[] = [
  'casa.tip.1',
  'casa.tip.2',
  'casa.tip.3',
  'casa.tip.4',
  'casa.tip.5',
  'casa.tip.6',
  'casa.tip.7',
  'casa.tip.8',
  'casa.tip.9',
  'casa.tip.10',
]

export type Tip = { kind: 'example'; key: TKey } | { kind: 'help' }

const KEY = 'casa.roof.tipN'

/** The tip for this opening (advances the rotation, kept across reloads). */
export function nextTip(): Tip {
  const n = (Number(lsGet(KEY)) || 0) + 1
  lsSet(KEY, String(n))
  if (n % 4 === 0) return { kind: 'help' }
  return { kind: 'example', key: TIPS[(n - Math.floor(n / 4)) % TIPS.length] }
}

/** "o que você sabe fazer?", "what can you do?", "¿qué puedes hacer?"… */
export function isCapabilitiesAsk(text: string): boolean {
  const f = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return (
    /\bo que (voce|vc|tu|o roof)? ?(sabe|pode|consegue) fazer\b/.test(f) ||
    /\bo que (eu )?(posso|da pra|da para) (te )?pedir\b/.test(f) ||
    /\b(como|em que) (voce|vc) (pode )?(me )?ajuda(r)?\b/.test(f) ||
    /\bwhat (can|do) you (do|know)\b/.test(f) ||
    /\bwhat can i (ask|say)\b/.test(f) ||
    /\bque (puedes|sabes) hacer\b/.test(f) ||
    /\bque (te )?puedo pedir\b/.test(f) ||
    /^(ajuda|help|ayuda)$/.test(f)
  )
}

const AREAS: { title: TKey; icon: LucideIcon; g: readonly [string, string]; ex: TKey[] }[] = [
  { title: 'casa.lists.title' as TKey, icon: ListChecks, g: GRAD.lists, ex: ['casa.tip.2', 'casa.tip.7', 'casa.tip.10'] as TKey[] },
  { title: 'app.calendar.name' as TKey, icon: CalendarDays, g: GRAD.calendar, ex: ['casa.tip.1', 'casa.tip.3', 'casa.tip.8'] as TKey[] },
  { title: 'casa.pets.title' as TKey, icon: PawPrint, g: GRAD.pets, ex: ['casa.tip.5'] as TKey[] },
  { title: 'app.budget.name' as TKey, icon: Wallet, g: GRAD.money, ex: ['casa.tip.4'] as TKey[] },
  { title: 'casa.caps.open' as TKey, icon: Sparkles, g: GRAD.orb, ex: ['casa.tip.6', 'casa.tip.9'] as TKey[] },
]

/** The "what can I do" screen inside Roof's full-screen sheet (dark). */
export function Capabilities({ onTry }: { onTry: (text: string) => void }) {
  const { t } = useI18n()
  return (
    <div className="casa-fade w-full max-w-[1100px] text-left">
      <p className="font-display text-center text-[clamp(1.8rem,min(5vw,7dvh),3.4rem)] leading-tight">{t('casa.roof.capsTitle')}</p>
      <p className="mt-2 text-center text-[clamp(1rem,2.6dvh,1.25rem)] text-white/60">{t('casa.roof.capsSub')}</p>
      <div className="mt-[clamp(14px,3.5dvh,2rem)] grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(17rem,100%),1fr))]">
        {AREAS.map((a, i) => (
          <section key={a.title} className="casa-rise rounded-[24px] bg-white/8 p-4" style={{ ['--i' as string]: i }}>
            <header className="mb-2.5 flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-[12px]" style={{ background: grad(a.g) }}>
                <a.icon size={20} color="#fff" aria-hidden />
              </span>
              <span className="font-display text-[1.25rem]">{t(a.title)}</span>
            </header>
            <ul className="grid gap-2">
              {a.ex.map((k) => (
                <li key={k}>
                  <button
                    onClick={() => onTry(t(k))}
                    className="casa-press w-full rounded-[16px] bg-white/8 px-4 py-2.5 text-left text-[1.02rem] text-white/90"
                  >
                    “{t(k)}”
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
