// Modo Casa — the always-on hub: the day at a glance (date · weather · family,
// a big clock, who's home), cards for what's next, big tiles that grow into
// in-hub panels, and Roof at the bottom. Nothing navigates away.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, ListChecks, Lock, PawPrint, Settings, Sparkles, Wallet, type LucideIcon } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../hooks/useTheme'
import { useI18n } from '../hooks/useI18n'
import { addDays, KIND_EMOJI } from '../lib/calendar'
import { useHomeWeather, weatherIcon, type TempUnit } from '../lib/weather'
import type { PanelId } from './assistant'
import { agenda, minutesOf, nextToday, petsDue, useHubData, type HubData } from './data'
import CalendarPanel from './panels/CalendarPanel'
import ListsPanel from './panels/ListsPanel'
import MoneyPanel from './panels/MoneyPanel'
import PetsPanel from './panels/PetsPanel'
import Roof from './Roof'
import { sceneFor, WeatherScene } from './WeatherScene'
import { usePlan } from './session'
import { PlanSheet, SettingsSheet } from './Sheets'
import { unlockAudioOnFirstTouch, tick } from './sound'
import { Avatar, Grow, IconChip, useNow, type GrowHandle } from './ui'
import { GRAD, LOCALE, cap, grad, isoOf, lsGet, lsSet } from './util'

const IDLE_LOCK_MS = 2 * 60_000
const DRIFT_MS = 4 * 60_000

export default function Hub() {
  const { t, lang } = useI18n()
  const { profile } = useAuth()
  const { theme } = useTheme()
  const plan = usePlan()
  const { data, loading, revalidate } = useHubData()
  const now = useNow(1000)
  const today = isoOf(now)
  const refresh = useCallback(() => void revalidate(), [revalidate])

  // The day changes at midnight: refetch so "today" means today.
  const day = useRef(today)
  useEffect(() => {
    if (day.current !== today) {
      day.current = today
      refresh()
    }
  }, [today, refresh])

  useEffect(() => unlockAudioOnFirstTouch(), [])

  // ── weather ────────────────────────────────────────────────────────────────
  const [unit, setUnitState] = useState<TempUnit>(() => (lsGet('casa.unit') as TempUnit) || (lang === 'en' ? 'fahrenheit' : 'celsius'))
  const setUnit = (u: TempUnit) => {
    setUnitState(u)
    lsSet('casa.unit', u)
  }
  const weather = useHomeWeather(unit)
  useEffect(() => {
    const id = setInterval(() => void weather.reload(), 20 * 60_000)
    return () => clearInterval(id)
  }, [weather])

  // ── burn-in: drift everything a few px every few minutes ───────────────────
  const [drift, setDrift] = useState({ x: 0, y: 0, cx: 0, cy: 0 })
  useEffect(() => {
    const id = setInterval(() => {
      const r = (n: number) => Math.round((Math.random() * 2 - 1) * n)
      setDrift({ x: r(8), y: r(6), cx: r(16), cy: r(10) })
    }, DRIFT_MS)
    return () => clearInterval(id)
  }, [])

  // ── panels ─────────────────────────────────────────────────────────────────
  const tiles = useRef<Partial<Record<PanelId, HTMLElement | null>>>({})
  const [panel, setPanel] = useState<{ id: PanelId; origin: DOMRect | null } | null>(null)
  const panelRef = useRef<GrowHandle>(null)
  const [sheet, setSheet] = useState<{ k: 'settings' | 'plan'; origin: DOMRect | null } | null>(null)
  const sheetRef = useRef<GrowHandle>(null)
  const [unlocked, setUnlocked] = useState(false)
  const lastTouch = useRef(Date.now())

  const openPanel = useCallback(
    (id: PanelId, el?: HTMLElement | null) => {
      if (id === 'money' && !plan.full) {
        setSheet({ k: 'plan', origin: (el ?? tiles.current.money)?.getBoundingClientRect() ?? null })
        return
      }
      tick()
      const src = el ?? tiles.current[id]
      setPanel({ id, origin: src?.getBoundingClientRect() ?? null })
    },
    [plan.full],
  )
  const panelId = useRef<PanelId | null>(null)
  panelId.current = panel?.id ?? null
  const closePanel = useCallback(async () => {
    const id = panelId.current
    await panelRef.current?.close()
    // Only if it's still the same panel (another may have opened meanwhile).
    setPanel((p) => (p?.id === id ? null : p))
  }, [])
  const closeSheet = useCallback(async () => {
    await sheetRef.current?.close()
    setSheet(null)
  }, [])

  // Money locks itself after 2 minutes without a touch, and the hub returns.
  useEffect(() => {
    const touch = () => (lastTouch.current = Date.now())
    window.addEventListener('pointerdown', touch)
    window.addEventListener('keydown', touch)
    return () => {
      window.removeEventListener('pointerdown', touch)
      window.removeEventListener('keydown', touch)
    }
  }, [])
  useEffect(() => {
    if (!unlocked) return
    const id = setInterval(() => {
      if (Date.now() - lastTouch.current < IDLE_LOCK_MS) return
      setUnlocked(false)
      if (panel?.id === 'money') void closePanel()
    }, 5000)
    return () => clearInterval(id)
  }, [unlocked, panel, closePanel])

  // ── derived ────────────────────────────────────────────────────────────────
  const days = useMemo(() => agenda(data.events, today, 2), [data.events, today])
  const todayList = days.get(today) ?? []
  const tomorrowList = days.get(addDays(today, 1)) ?? []
  const next = nextToday(todayList, now)
  const due = useMemo(() => petsDue(data, today), [data, today])
  const loc = LOCALE[lang]
  const hour = now.getHours()
  const greeting = hour < 5 ? t('casa.night') : hour < 12 ? t('casa.morning') : hour < 18 ? t('casa.afternoon') : t('casa.evening')
  const WIcon = weather.weather ? weatherIcon(weather.weather.code) : null
  const me = {
    email: profile?.email ?? '',
    name: data.members.find((m) => m.email === profile?.email)?.name ?? profile?.display_name ?? '',
  }

  return (
    <div className="casa-root">
      {/* The weather sky behind the top-left, like the phone's Home
          (owner, 2026-11); the soft aurora only when no city is set. */}
      {weather.weather ? (
        <WeatherScene kind={sceneFor(weather.weather.code, weather.weather.isDay !== false)} dark={theme === 'dark'} className="w-[min(78vw,110vh)]" />
      ) : (
        <div className="casa-aurora" aria-hidden>
          <i />
          <i />
          <i />
        </div>
      )}

      <div
        className="casa-drift relative flex h-full flex-col px-[clamp(20px,3.2vw,48px)] pt-[clamp(16px,2.4vh,28px)] pb-[clamp(14px,2vh,24px)]"
        style={{ transform: `translate3d(${drift.x}px, ${drift.y}px, 0)` }}
      >
        {/* top line */}
        <header className="casa-fade flex items-center gap-4 text-[clamp(1.05rem,1.5vw,1.3rem)] text-(--text-muted)">
          <span className="min-w-0 truncate">
            <span className="font-semibold text-(--text)">{cap(now.toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'long' }))}</span>
            {weather.weather && WIcon ? (
              <>
                <Dot />
                <WIcon size={22} className="-mt-1 inline" aria-hidden /> {weather.weather.temperature}°
              </>
            ) : null}
            {data.householdName ? (
              <>
                <Dot />
                {data.householdName}
              </>
            ) : null}
          </span>
          <span className="flex-1" />
          {plan.trialDays !== null && plan.full ? (
            <span className="rounded-full bg-(--surface) px-3.5 py-1.5 text-[0.95rem] font-semibold">{t('casa.plan.trial', { count: plan.trialDays })}</span>
          ) : null}
          <button
            onClick={(e) => setSheet({ k: 'settings', origin: e.currentTarget.getBoundingClientRect() })}
            aria-label={t('casa.settings.title')}
            className="casa-press inline-flex h-14 w-14 items-center justify-center rounded-full text-(--text-muted)"
          >
            <Settings size={26} aria-hidden />
          </button>
        </header>

        {/* middle: the day on the left, ONE card per area on the right — each
            card is that area's only way in (owner, 2026-11: the tile row
            below repeated them). */}
        <div className="casa-scroll grid min-h-0 flex-1 content-center gap-x-[clamp(20px,3vw,44px)] gap-y-5 py-3 landscape:grid-cols-[0.9fr_1.1fr] landscape:items-center">
          <section className="casa-rise" style={{ ['--i' as string]: 0 }}>
            <div className="casa-drift" style={{ transform: `translate3d(${drift.cx}px, ${drift.cy}px, 0)` }}>
              <Clock now={now} loc={loc} />
              <p className="font-display mt-1 text-[clamp(1.3rem,2vw,1.8rem)] text-(--text-muted)">{greeting}</p>
            </div>
            <Members data={data} me={profile?.email} loading={loading} />
          </section>

          <section className="grid grid-cols-2 gap-3">
            <NextCard
              data={data}
              next={next}
              now={now}
              today={today}
              loc={loc}
              tomorrow={tomorrowList}
              onClick={(el) => openPanel('calendar', el)}
            />
            <ListsCard data={data} onClick={(el) => openPanel('lists', el)} />
            <PetsCard due={due} onClick={(el) => openPanel('pets', el)} />
            <MoneyCard
              locked={plan.full ? (unlocked ? null : 'pin') : 'plus'}
              onClick={(el) => openPanel('money', el)}
            />
          </section>
        </div>

        {!plan.full ? (
          <div className="casa-card casa-rise mb-4 flex items-center gap-5 rounded-[26px] px-6 py-4" style={{ ['--i' as string]: 5 }}>
            <Sparkles size={28} className="shrink-0 text-[#8B6CFF]" aria-hidden />
            <p className="min-w-0 flex-1 text-[1.1rem] leading-snug text-(--text-muted)">{t('casa.plan.banner')}</p>
            <button
              onClick={(e) => setSheet({ k: 'plan', origin: e.currentTarget.getBoundingClientRect() })}
              className="casa-press h-14 shrink-0 rounded-full px-6 text-[1.1rem] font-semibold text-white"
              style={{ background: grad(GRAD.orb) }}
            >
              {t('casa.plan.see')}
            </button>
          </div>
        ) : null}

        <div className="casa-rise mx-auto mt-[clamp(8px,1.4vh,14px)] w-full max-w-[880px]" style={{ ['--i' as string]: 6 }}>
          <Roof
            data={data}
            full={plan.full}
            today={today}
            me={me}
            refresh={refresh}
            hidden={!!panel || !!sheet}
            onOpenPanel={(id) => openPanel(id)}
            onLocked={() => setSheet({ k: 'plan', origin: null })}
          />
        </div>
      </div>

      {panel ? (
        <Grow key={panel.id} ref={panelRef} origin={panel.origin} tint={GRAD[panel.id]} radius={40} onBackdrop={() => void closePanel()} className="inset-3 bg-(--bg) sm:inset-6">
          {panel.id === 'lists' ? (
            <ListsPanel data={data} full={plan.full} me={profile?.email ?? ''} refresh={refresh} onClose={() => void closePanel()} />
          ) : panel.id === 'calendar' ? (
            <CalendarPanel data={data} today={today} full={plan.full} refresh={refresh} onClose={() => void closePanel()} />
          ) : panel.id === 'pets' ? (
            <PetsPanel data={data} today={today} full={plan.full} refresh={refresh} onClose={() => void closePanel()} />
          ) : (
            <MoneyPanel
              data={data}
              unlocked={unlocked}
              onUnlock={() => {
                lastTouch.current = Date.now()
                setUnlocked(true)
              }}
              onClose={() => void closePanel()}
            />
          )}
        </Grow>
      ) : null}

      {sheet?.k === 'settings' ? (
        <SettingsSheet ref={sheetRef} origin={sheet.origin} onClose={() => void closeSheet()} unit={unit} setUnit={setUnit} onCity={() => void weather.reload()} />
      ) : sheet?.k === 'plan' ? (
        <PlanSheet ref={sheetRef} origin={sheet.origin} onClose={() => void closeSheet()} />
      ) : null}
    </div>
  )
}

function Dot() {
  return <span className="mx-3 inline-block h-1.5 w-1.5 -translate-y-[3px] rounded-full bg-(--text-faint)" aria-hidden />
}

function Clock({ now, loc }: { now: Date; loc: string }) {
  const parts = new Intl.DateTimeFormat(loc, { hour: 'numeric', minute: '2-digit' }).formatToParts(now)
  const hour = parts.find((p) => p.type === 'hour')?.value ?? ''
  const minute = parts.find((p) => p.type === 'minute')?.value ?? ''
  const period = parts.find((p) => p.type === 'dayPeriod')?.value
  return (
    <p className="casa-clock text-[clamp(4.5rem,10vw,9rem)] whitespace-nowrap" aria-label={now.toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit' })}>
      {hour}
      <span className="casa-colon">:</span>
      {minute}
      {period ? <span className="ml-3 align-top text-[0.22em] tracking-normal text-(--text-muted)">{period}</span> : null}
    </p>
  )
}

function Members({ data, me, loading }: { data: HubData; me?: string; loading: boolean }) {
  const { t } = useI18n()
  if (loading && !data.members.length) {
    return (
      <div className="mt-5 flex gap-4">
        {[0, 1, 2].map((i) => (
          <span key={i} className="casa-shimmer h-[52px] w-[52px] rounded-full" />
        ))}
      </div>
    )
  }
  return (
    <ul className="casa-scroll mt-5 flex gap-4 overflow-x-auto pb-1">
      {data.members.map((m, i) => (
        <li key={m.email} className="casa-rise flex shrink-0 flex-col items-center gap-2" style={{ ['--i' as string]: i + 1 }}>
          <Avatar m={m} size={52} ring={m.email === me} />
          <span className="max-w-[5rem] truncate text-[0.9rem] font-semibold text-(--text-muted)">{m.email === me ? `${m.first}` : m.first}</span>
        </li>
      ))}
      {!data.members.length ? <li className="text-(--text-faint)">{t('casa.noMembers')}</li> : null}
    </ul>
  )
}

/** The four area cards share one frame: chip + name, a big number or line,
 *  and a quiet detail line. Compact on purpose (owner, 2026-11). */
function AreaCard({
  i,
  icon,
  g,
  title,
  big,
  bigSub,
  detail,
  badge,
  onClick,
}: {
  i: number
  icon: LucideIcon
  g: readonly string[]
  title: string
  big?: string
  bigSub?: string
  detail?: string
  badge?: React.ReactNode
  onClick: (el: HTMLElement) => void
}) {
  return (
    <button
      onClick={(e) => onClick(e.currentTarget)}
      className="casa-card casa-press casa-rise flex min-h-[132px] flex-col rounded-[24px] p-4 text-left"
      style={{ ['--i' as string]: i }}
    >
      <span className="flex items-center gap-2.5">
        <span className="relative">
          <IconChip icon={icon} g={g} size={38} />
          {badge}
        </span>
        <span className="font-display text-[1.3rem]">{title}</span>
      </span>
      {big ? (
        <span className="mt-2.5 flex min-w-0 items-baseline gap-2">
          <span className="font-display truncate text-[2.1rem] leading-none">{big}</span>
          {bigSub ? <span className="shrink-0 text-[0.95rem] text-(--text-muted)">{bigSub}</span> : null}
        </span>
      ) : null}
      {detail ? <span className="mt-1.5 block truncate text-[0.95rem] text-(--text-muted)">{detail}</span> : null}
    </button>
  )
}

function NextCard({
  data,
  next,
  now,
  today,
  loc,
  tomorrow,
  onClick,
}: {
  data: HubData
  next: ReturnType<typeof nextToday>
  now: Date
  today: string
  loc: string
  tomorrow: ReturnType<typeof agenda> extends Map<string, infer L> ? L : never
  onClick: (el: HTMLElement) => void
}) {
  const { t } = useI18n()
  const tmr = tomorrow.length
    ? `${t('casa.when.tomorrowCap')}: ${tomorrow
        .slice(0, 3)
        .map((o) => `${o.event.all_day ? '' : `${o.event.start_time?.slice(0, 5)} `}${o.event.title}`)
        .join(' · ')}`
    : undefined
  if (!next) {
    const upcoming = [...agenda(data.events, addDays(today, 1), 14).entries()].find(([, l]) => l.length)
    return (
      <AreaCard
        i={1}
        icon={CalendarDays}
        g={GRAD.calendar}
        title={t('app.calendar.name')}
        big={t('casa.cal.nothingMore')}
        detail={
          tmr ??
          (upcoming
            ? t('casa.cal.nextOn', {
                title: upcoming[1][0].event.title,
                day: new Date(upcoming[0] + 'T12:00').toLocaleDateString(loc, { weekday: 'long', day: 'numeric' }),
              })
            : undefined)
        }
        onClick={onClick}
      />
    )
  }
  const ev = next.event
  const mins = now.getHours() * 60 + now.getMinutes()
  const inMin = minutesOf(ev.start_time) - mins
  const when = ev.all_day
    ? t('casa.cal.allDay')
    : inMin <= 0
      ? t('casa.cal.now')
      : inMin < 60
        ? t('casa.cal.inMinutes', { count: inMin })
        : t('casa.cal.inHours', { h: Math.floor(inMin / 60), m: String(inMin % 60).padStart(2, '0') })
  return (
    <AreaCard
      i={1}
      icon={CalendarDays}
      g={GRAD.calendar}
      title={t('app.calendar.name')}
      big={`${KIND_EMOJI[ev.kind] ? `${KIND_EMOJI[ev.kind]} ` : ''}${ev.title}`}
      detail={`${!ev.all_day ? `${ev.start_time?.slice(0, 5)} · ` : ''}${when}${ev.location ? ` · ${ev.location}` : ''}`}
      onClick={onClick}
    />
  )
}

function ListsCard({ data, onClick }: { data: HubData; onClick: (el: HTMLElement) => void }) {
  const { t } = useI18n()
  const valid = new Set(data.stores.map((s) => s.id))
  const groups: { name: string; n: number }[] = []
  const general = data.open.filter((i) => !i.store_id || !valid.has(i.store_id)).length
  if (general) groups.push({ name: t('casa.list.general'), n: general })
  for (const s of data.stores) {
    const n = data.open.filter((i) => i.store_id === s.id).length
    if (n) groups.push({ name: s.name, n })
  }
  return (
    <AreaCard
      i={2}
      icon={ListChecks}
      g={GRAD.lists}
      title={t('casa.lists.title')}
      big={String(data.open.length)}
      bigSub={t('casa.lists.openWord', { count: data.open.length })}
      detail={groups.length ? groups.map((g) => `${g.name} ${g.n}`).join(' · ') : t('casa.lists.allDone')}
      onClick={onClick}
    />
  )
}

function PetsCard({ due, onClick }: { due: ReturnType<typeof petsDue>; onClick: (el: HTMLElement) => void }) {
  const { t } = useI18n()
  return (
    <AreaCard
      i={3}
      icon={PawPrint}
      g={GRAD.pets}
      title={t('casa.pets.title')}
      big={due.length ? String(due.length) : '✓'}
      bigSub={due.length ? t('casa.pets.today', { count: due.length }) : t('casa.pets.allDone')}
      detail={due.length ? due.slice(0, 3).map((d) => `${d.pet.emoji} ${d.title}`).join(' · ') : undefined}
      onClick={onClick}
    />
  )
}

function MoneyCard({ locked, onClick }: { locked: 'pin' | 'plus' | null; onClick: (el: HTMLElement) => void }) {
  const { t } = useI18n()
  return (
    <AreaCard
      i={4}
      icon={Wallet}
      g={GRAD.money}
      title={t('app.budget.name')}
      badge={
        locked ? (
          <span className="absolute -right-1 -bottom-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-(--card) shadow">
            <Lock size={11} strokeWidth={2.8} className="text-(--text-muted)" aria-hidden />
          </span>
        ) : null
      }
      big={locked === 'plus' ? undefined : locked === 'pin' ? '••••' : t('casa.money.open')}
      detail={locked === 'plus' ? t('casa.plan.noPlus') : locked === 'pin' ? t('casa.money.locked') : undefined}
      onClick={onClick}
    />
  )
}

