// Modo Casa — the hub's side column under the clock and Roof (owner, 2026-11:
// "no dead corners, the header is crammed"): today at a glance (what's coming
// up, the weather's word for the day, the next birthday), the family as its
// own block (faces open their profile; scales to 12+ with "+N"), and quiet
// tiles for Money and the photo frame.
import { useMemo } from 'react'
import { CalendarDays, ChevronRight, Images, Lock, Wallet } from 'lucide-react'
import { useI18n } from '../hooks/useI18n'
import { addDays, KIND_EMOJI } from '../lib/calendar'
import { weatherIcon, type CurrentWeather, type WeatherAlertKind } from '../lib/weather'
import { agenda, minutesOf, type HubData, type Member } from './data'
import { ageOf } from './panels/FamilyPanel'
import { Avatar } from './ui'
import { GRAD, LOCALE, grad } from './util'

function daysTo(birthday: string, today: string): number {
  const [, bm, bd] = birthday.split('-').map(Number)
  const [ty, tm, td] = today.split('-').map(Number)
  const t = new Date(ty, tm - 1, td)
  let next = new Date(ty, bm - 1, bd)
  if (next < t) next = new Date(ty + 1, bm - 1, bd)
  return Math.round((next.getTime() - t.getTime()) / 86_400_000)
}

const Row = ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) =>
  onClick ? (
    <button onClick={onClick} className="casa-press flex min-h-11 w-full items-center gap-3 rounded-[16px] px-2.5 py-1.5 text-left">
      {children}
    </button>
  ) : (
    <div className="flex min-h-11 items-center gap-3 px-2.5 py-1.5">{children}</div>
  )

const Badge = ({ g, children }: { g: readonly string[]; children: React.ReactNode }) => (
  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] text-white" style={{ background: grad(g) }}>
    {children}
  </span>
)

/** Today at a glance: weather word, the next few events, the next birthday. */
export function Glance({
  data,
  today,
  now,
  weather,
  alert,
  city,
  onCalendar,
  onMember,
  showEvents = true,
  className = '',
}: {
  /** false in Painel mode: the Calendar card beside it already lists them
   *  (owner, 2026-11: no duplicated information). */
  showEvents?: boolean
  data: HubData
  today: string
  now: Date
  weather: CurrentWeather | null
  alert: WeatherAlertKind | null
  city: string | null
  onCalendar: () => void
  onMember: (email: string) => void
  className?: string
}) {
  const { t, lang } = useI18n()
  const loc = LOCALE[lang]
  const mins = now.getHours() * 60 + now.getMinutes()
  const next = useMemo(() => {
    const days = agenda(data.events, today, 8)
    const out: { key: string; when: string; title: string }[] = []
    for (let i = 0; i < 8; i++) {
      const d = addDays(today, i)
      for (const o of days.get(d) ?? []) {
        const ev = o.event
        if (i === 0 && !ev.all_day && minutesOf(ev.end_time ?? ev.start_time) <= mins) continue
        const day = i === 0 ? t('casa.when.todayCap') : i === 1 ? t('casa.when.tomorrowCap') : new Date(d + 'T12:00').toLocaleDateString(loc, { weekday: 'short' }).replace('.', '')
        out.push({
          key: `${ev.id}-${d}`,
          when: ev.all_day ? `${day} · ${t('casa.cal.allDayShort')}` : `${day} · ${ev.start_time?.slice(0, 5)}`,
          title: `${KIND_EMOJI[ev.kind] ? `${KIND_EMOJI[ev.kind]} ` : ''}${ev.title}`,
        })
      }
    }
    return out.slice(0, 8)
  }, [data.events, today, mins, t, loc])

  const bday = useMemo(() => {
    let best: { m: Member; in: number } | null = null
    for (const m of data.members) {
      const b = m.profile?.birthday
      if (!b) continue
      const n = daysTo(b, today)
      if (n <= 30 && (!best || n < best.in)) best = { m, in: n }
    }
    return best
  }, [data.members, today])

  const WIcon = weather ? weatherIcon(weather.code) : null
  const age = bday ? ageOf(bday.m.profile?.birthday, addDays(today, bday.in)) : null

  // Painel with no weather and no birthday: nothing of its own to say.
  if (!showEvents && !(weather && WIcon) && !bday) return null

  return (
    <section className={`casa-liquid casa-rise flex min-h-0 flex-col overflow-hidden rounded-[28px] p-2.5 ${className}`} style={{ ['--i' as string]: 2 }}>
      <p className="px-2.5 pt-1.5 pb-1 text-[0.8rem] font-semibold uppercase tracking-[0.14em] text-(--text-faint)">{t('casa.glance.title')}</p>
      <div className="casa-fadeout relative min-h-0 flex-1 overflow-hidden">
        {weather && WIcon ? (
          <Row>
            <Badge g={['#5AB8FF', '#3F7BEA']}>
              <WIcon size={20} aria-hidden />
            </Badge>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[1.05rem] font-semibold">
                {weather.temperature}° {city ? <span className="font-normal text-(--text-muted)">· {city}</span> : null}
              </span>
              {alert ? <span className="block truncate text-[0.9rem] font-semibold text-(--expense)">{t(`casa.wx.${alert}`)}</span> : null}
            </span>
          </Row>
        ) : null}
        {bday ? (
          <Row onClick={() => onMember(bday.m.email)}>
            <Avatar m={bday.m} size={36} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[1.05rem] font-semibold">
                🎂 {t('casa.glance.birthday', { name: bday.m.first })}
                {age != null ? <span className="font-normal text-(--text-muted)"> · {t('family.yrs', { years: age })}</span> : null}
              </span>
              <span className="block truncate text-[0.9rem] text-(--text-muted)">
                {bday.in === 0 ? t('casa.family.bdayToday') : t('casa.family.bdayIn', { count: bday.in })}
              </span>
            </span>
          </Row>
        ) : null}
        {showEvents ? (
          <>
        <Row onClick={onCalendar}>
          <Badge g={GRAD.calendar}>
            <CalendarDays size={19} aria-hidden />
          </Badge>
          <span className="min-w-0 flex-1 text-[1.05rem] font-semibold">{t('casa.glance.next')}</span>
          <ChevronRight size={20} className="shrink-0 text-(--text-faint)" aria-hidden />
        </Row>
        {next.length ? (
          <ul className="pb-1">
            {next.map((e) => (
              <li key={e.key} className="flex items-baseline gap-3 px-2.5 py-1">
                <span className="w-[6.6rem] shrink-0 truncate text-[0.92rem] font-semibold tabular-nums" style={{ color: GRAD.calendar[1] }}>
                  {e.when}
                </span>
                <span className="min-w-0 flex-1 truncate text-[1rem]">{e.title}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-2.5 py-1 text-[0.95rem] text-(--text-muted)">{t('casa.glance.nothing')}</p>
        )}
          </>
        ) : null}
      </div>
    </section>
  )
}

/** The family's own block: faces (names while there's room), "+N" past 12. */
export function FamilyBlock({
  data,
  loading,
  onOpen,
  onMember,
  className = '',
}: {
  data: HubData
  loading: boolean
  onOpen: (el: HTMLElement) => void
  onMember: (email: string, el: HTMLElement) => void
  className?: string
}) {
  const { t } = useI18n()
  const ms = data.members
  if (loading && !ms.length) return <div className={`casa-shimmer h-28 rounded-[28px] ${className}`} />
  if (!ms.length) return null
  const max = 12
  const shown = ms.length > max ? ms.slice(0, max - 1) : ms
  const extra = ms.length - shown.length
  const named = ms.length <= 6
  return (
    <section className={`casa-liquid casa-rise rounded-[28px] p-2.5 ${className}`} style={{ ['--i' as string]: 3 }}>
      <button onClick={(e) => onOpen(e.currentTarget)} className="casa-press flex min-h-11 w-full items-center gap-2 rounded-[16px] px-2.5 text-left">
        <span className="min-w-0 flex-1 truncate text-[0.8rem] font-semibold uppercase tracking-[0.14em] text-(--text-faint)">
          {t('casa.family.title')} · {t('casa.family.count', { count: ms.length })}
        </span>
        <ChevronRight size={20} className="shrink-0 text-(--text-faint)" aria-hidden />
      </button>
      <ul className="flex flex-wrap gap-x-2 gap-y-2 px-1.5 pb-1">
        {shown.map((m) => (
          <li key={m.email}>
            <button
              onClick={(e) => onMember(m.email, e.currentTarget)}
              aria-label={m.name}
              className={`casa-press flex flex-col items-center gap-1 rounded-[18px] p-1 ${named ? 'w-[4.25rem]' : ''}`}
            >
              <Avatar m={m} size={named ? 48 : 44} />
              {named ? <span className="w-full truncate text-center text-[0.85rem] font-medium">{m.first}</span> : null}
            </button>
          </li>
        ))}
        {extra > 0 ? (
          <li>
            <button
              onClick={(e) => onOpen(e.currentTarget)}
              className="casa-press m-1 inline-flex h-11 min-w-11 items-center justify-center rounded-full bg-(--surface-2) px-2 text-[0.95rem] font-bold"
            >
              +{extra}
            </button>
          </li>
        ) : null}
      </ul>
    </section>
  )
}

/** Money and the photo frame: clear but quiet. */
export function QuickTiles({
  moneyOpen,
  onMoney,
  onFrame,
  className = '',
}: {
  moneyOpen: boolean
  onMoney: (el: HTMLElement) => void
  onFrame: () => void
  className?: string
}) {
  const { t } = useI18n()
  const tile = 'casa-liquid casa-press flex h-[3.75rem] min-w-0 flex-1 items-center gap-2 rounded-[22px] pr-2.5 pl-2 portrait:min-w-[8.75rem] text-left text-[1rem] font-semibold'
  return (
    <div className={`casa-rise @container flex flex-wrap gap-2.5 ${className}`} style={{ ['--i' as string]: 4 }}>
      <button onClick={(e) => onMoney(e.currentTarget)} className={tile}>
        <Badge g={GRAD.money}>
          <Wallet size={19} aria-hidden />
        </Badge>
        <span className="min-w-0 flex-1 truncate">{t('app.budget.name')}</span>
        {!moneyOpen ? <Lock size={15} strokeWidth={2.6} className="hidden shrink-0 text-(--text-muted) @[21rem]:inline" aria-hidden /> : null}
      </button>
      <button onClick={onFrame} className={tile}>
        <Badge g={GRAD.frame}>
          <Images size={19} aria-hidden />
        </Badge>
        <span className="min-w-0 flex-1 truncate">{t('casa.frame.title')}</span>
      </button>
    </div>
  )
}
