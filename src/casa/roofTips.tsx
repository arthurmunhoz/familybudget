// What Roof suggests while it listens on the home device, and its "what can
// you do?" screen (owner, 2026-11-13: "it always shows the same sentence";
// 2026-11-14: "what can you do?" gave a short answer — now the phone's
// capabilities view, area by area with "See more"). Same idea as the phone
// (mobile/src/components/home/roofTips.ts + CapabilitiesView): each opening
// shows the next example; every fourth one, the hint to ask "what can you
// do?". Only lists what Modo Casa's Roof really does: everything the phone's
// Roof does EXCEPT money, games and documents (those stay on the phone).
import { useState } from 'react'
import { Bell, Calculator, CalendarDays, ChevronDown, ChevronUp, ListChecks, MonitorSmartphone, PawPrint, Smartphone, Users, type LucideIcon } from 'lucide-react'
import { useI18n } from '../hooks/useI18n'
import type { TKey } from '../lib/i18n'
import { GRAD, grad, lsGet, lsSet } from './util'

const k = (area: string, ns: number[]) => ns.map((n) => `roofEx.${area}.${n}` as TKey)

// Rotating "try saying" tips — no {name} in them (they show as-is).
const TIPS: TKey[] = [
  'casa.tip.1',
  'roofEx.shop.1',
  'roofEx.cal.2',
  'roofEx.pets.1',
  'casa.tip.6',
  'roofEx.shop.3',
  'roofEx.cal.1',
  'roofEx.cal.4',
  'roofEx.pets.9',
  'roofEx.nudge.1',
  'roofEx.calc.1',
  'casa.tip.9',
  'roofEx.cal.5',
  'roofEx.shop.4',
  'casa.ra.tipWeather',
] as TKey[]

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

// `ex` shows at once; `more` opens under "See more" for the area that caught
// the eye — never everything at once (same as the phone).
const AREAS: { id: string; title: TKey; icon: LucideIcon; g: readonly [string, string]; ex: TKey[]; more: TKey[] }[] = [
  { id: 'lists', title: 'casa.lists.title' as TKey, icon: ListChecks, g: GRAD.lists, ex: k('shop', [1, 3]), more: k('shop', [5, 6, 7, 2, 4]) },
  { id: 'cal', title: 'app.calendar.name' as TKey, icon: CalendarDays, g: GRAD.calendar, ex: k('cal', [2, 1]), more: k('cal', [5, 6, 3, 9, 7, 10, 8, 4]) },
  { id: 'pets', title: 'casa.pets.title' as TKey, icon: PawPrint, g: GRAD.pets, ex: k('pets', [1, 3]), more: k('pets', [7, 8, 4, 2, 10, 9, 5, 6]) },
  { id: 'family', title: 'app.family.name' as TKey, icon: Users, g: GRAD.family, ex: k('family', [2, 1]), more: [...k('family', [4, 3, 6, 5]), 'casa.ra.exWhere' as TKey] },
  { id: 'nudge', title: 'app.pings.name' as TKey, icon: Bell, g: GRAD.nudge, ex: k('nudge', [1, 3]), more: k('nudge', [2, 5, 4]) },
  { id: 'calc', title: 'casa.ra.areaCalc' as TKey, icon: Calculator, g: GRAD.calc, ex: [...k('calc', [1, 4]), 'casa.ra.tipWeather' as TKey], more: k('calc', [2, 3, 6, 7, 8]) },
  { id: 'open', title: 'casa.caps.open' as TKey, icon: MonitorSmartphone, g: GRAD.orb, ex: ['casa.tip.6', 'casa.tip.9'] as TKey[], more: [] },
]

/** The "what can I do" screen inside Roof's full-screen sheet (dark). */
export function Capabilities({ onTry, name }: { onTry: (text: string) => void; name: string }) {
  const { t } = useI18n()
  const [open, setOpen] = useState<Record<string, boolean>>({})
  return (
    <div className="casa-fade w-full max-w-[1100px] text-left">
      <p className="font-display text-center text-[clamp(1.8rem,min(5vw,7dvh),3.4rem)] leading-tight">{t('casa.roof.capsTitle')}</p>
      <p className="mt-2 text-center text-[clamp(1rem,2.6dvh,1.25rem)] text-white/60">{t('casa.roof.capsSub')}</p>
      <div className="mt-[clamp(14px,3.5dvh,2rem)] grid items-start gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(19rem,100%),1fr))]">
        {AREAS.map((a, i) => {
          const shown = open[a.id] ? [...a.ex, ...a.more] : a.ex
          return (
            <section key={a.id} className="casa-rise rounded-[26px] bg-white/8 p-4 sm:p-5" style={{ ['--i' as string]: i }}>
              <header className="mb-3 flex items-center gap-3">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-[14px]" style={{ background: grad(a.g), boxShadow: `0 10px 24px -12px ${a.g[1]}` }}>
                  <a.icon size={22} color="#fff" aria-hidden />
                </span>
                <span className="font-display text-[1.35rem]">{t(a.title)}</span>
              </header>
              <ul className="grid gap-2">
                {shown.map((key, j) => {
                  const phrase = t(key, { name })
                  return (
                    <li key={key} className={j >= a.ex.length ? 'casa-fade' : undefined}>
                      <button onClick={() => onTry(phrase)} className="casa-press w-full rounded-[16px] bg-white/8 px-4 py-3 text-left text-[1.08rem] leading-snug text-white/90">
                        “{phrase}”
                      </button>
                    </li>
                  )
                })}
              </ul>
              {a.more.length ? (
                <button
                  onClick={() => setOpen((o) => ({ ...o, [a.id]: !o[a.id] }))}
                  aria-expanded={!!open[a.id]}
                  className="casa-press mt-2.5 inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-[1rem] font-semibold text-white/70"
                >
                  {open[a.id] ? t('ask.capsLess') : t('ask.capsMore', { n: a.more.length })}
                  {open[a.id] ? <ChevronUp size={18} aria-hidden /> : <ChevronDown size={18} aria-hidden />}
                </button>
              ) : null}
            </section>
          )
        })}
      </div>
      <p className="mt-[clamp(14px,3dvh,1.75rem)] flex items-center justify-center gap-2 text-center text-[clamp(0.95rem,2.4dvh,1.15rem)] text-white/55">
        <Smartphone size={20} aria-hidden />
        {t('casa.ra.capsPhone')}
      </p>
    </div>
  )
}
