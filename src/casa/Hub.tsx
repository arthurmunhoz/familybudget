// Modo Casa — the always-on hub: the day at a glance (date · weather · family,
// a big clock, who's home), cards for what's next, big tiles that grow into
// in-hub panels, and Roof at the bottom. Nothing navigates away.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, ListChecks, Lock, PawPrint, Settings, Sparkles, Wallet, type LucideIcon } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
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
import { usePlan } from './session'
import { PlanSheet, SettingsSheet } from './Sheets'
import { unlockAudioOnFirstTouch, tick } from './sound'
import { Avatar, Grow, IconChip, PlusTag, useNow, type GrowHandle } from './ui'
import { GRAD, LOCALE, cap, grad, isoOf, lsGet, lsSet } from './util'

const IDLE_LOCK_MS = 2 * 60_000
const DRIFT_MS = 4 * 60_000

export default function Hub() {
  const { t, lang } = useI18n()
  const { profile } = useAuth()
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
      <div className="casa-aurora" aria-hidden>
        <i />
        <i />
        <i />
      </div>

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

        {/* middle */}
        <div className="casa-scroll grid min-h-0 flex-1 content-center gap-x-[clamp(24px,3.5vw,56px)] gap-y-6 py-3 landscape:grid-cols-[1fr_1.08fr] landscape:items-center">
          <section className="casa-rise" style={{ ['--i' as string]: 0 }}>
            <div className="casa-drift" style={{ transform: `translate3d(${drift.cx}px, ${drift.cy}px, 0)` }}>
              <Clock now={now} loc={loc} />
              <p className="font-display mt-3 text-[clamp(1.6rem,2.6vw,2.4rem)] text-(--text-muted)">{greeting}</p>
            </div>
            <Members data={data} me={profile?.email} loading={loading} />
          </section>

          <section className="grid gap-4">
            <NextCard
              data={data}
              next={next}
              now={now}
              today={today}
              loc={loc}
              onClick={(el) => openPanel('calendar', el)}
            />
            <div className="grid grid-cols-2 gap-4">
              <ListsCard data={data} onClick={(el) => openPanel('lists', el)} />
              <PetsCard due={due} onClick={(el) => openPanel('pets', el)} />
            </div>
            <div className="casa-card casa-rise flex min-h-[60px] items-center gap-3 rounded-[22px] px-5 py-3 text-[1.15rem]" style={{ ['--i' as string]: 4 }}>
              <span className="font-semibold">{t('casa.when.tomorrowCap')}</span>
              <span className="min-w-0 flex-1 truncate text-(--text-muted)">
                {tomorrowList.length
                  ? tomorrowList
                      .slice(0, 4)
                      .map((o) => `${o.event.all_day ? '' : `${o.event.start_time?.slice(0, 5)} `}${KIND_EMOJI[o.event.kind] ? `${KIND_EMOJI[o.event.kind]} ` : ''}${o.event.title}`)
                      .join('  ·  ')
                  : t('casa.cal.freeTomorrow')}
              </span>
            </div>
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

        {/* tiles */}
        <nav className="grid grid-cols-4 gap-[clamp(10px,1.4vw,18px)]">
          <Tile
            i={6}
            id="calendar"
            icon={CalendarDays}
            label={t('app.calendar.name')}
            sub={todayList.length ? t('casa.tile.today', { count: todayList.length }) : t('casa.tile.free')}
            tiles={tiles}
            onOpen={openPanel}
          />
          <Tile
            i={7}
            id="lists"
            icon={ListChecks}
            label={t('casa.lists.title')}
            sub={t('casa.lists.openCount', { count: data.open.length })}
            tiles={tiles}
            onOpen={openPanel}
          />
          <Tile i={8} id="pets" icon={PawPrint} label={t('casa.pets.title')} sub={due.length ? t('casa.pets.dueCount', { count: due.length }) : t('casa.pets.allDone')} tiles={tiles} onOpen={openPanel} />
          <Tile
            i={9}
            id="money"
            icon={Wallet}
            label={t('app.budget.name')}
            sub={plan.full ? (unlocked ? t('casa.money.open') : t('casa.money.locked')) : ''}
            lock={plan.full ? (unlocked ? null : 'pin') : 'plus'}
            tiles={tiles}
            onOpen={openPanel}
          />
        </nav>

        <div className="casa-rise mt-[clamp(10px,1.6vh,18px)]" style={{ ['--i' as string]: 10 }}>
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
    <p className="casa-clock text-[clamp(7rem,15.5vw,14.5rem)] whitespace-nowrap" aria-label={now.toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit' })}>
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
      <div className="mt-8 flex gap-5">
        {[0, 1, 2].map((i) => (
          <span key={i} className="casa-shimmer h-[68px] w-[68px] rounded-full" />
        ))}
      </div>
    )
  }
  return (
    <ul className="casa-scroll mt-8 flex gap-5 overflow-x-auto pb-1">
      {data.members.map((m, i) => (
        <li key={m.email} className="casa-rise flex shrink-0 flex-col items-center gap-2" style={{ ['--i' as string]: i + 1 }}>
          <Avatar m={m} size={68} ring={m.email === me} />
          <span className="max-w-[5.5rem] truncate text-[1rem] font-semibold text-(--text-muted)">{m.email === me ? `${m.first}` : m.first}</span>
        </li>
      ))}
      {!data.members.length ? <li className="text-(--text-faint)">{t('casa.noMembers')}</li> : null}
    </ul>
  )
}

function NextCard({
  data,
  next,
  now,
  today,
  loc,
  onClick,
}: {
  data: HubData
  next: ReturnType<typeof nextToday>
  now: Date
  today: string
  loc: string
  onClick: (el: HTMLElement) => void
}) {
  const { t } = useI18n()
  if (!next) {
    const upcoming = [...agenda(data.events, addDays(today, 1), 14).entries()].find(([, l]) => l.length)
    return (
      <button onClick={(e) => onClick(e.currentTarget)} className="casa-card casa-press casa-rise flex min-h-[150px] items-center gap-5 rounded-[32px] p-6 text-left" style={{ ['--i' as string]: 1 }}>
        <IconChip icon={CalendarDays} g={GRAD.calendar} size={64} />
        <span className="min-w-0">
          <span className="font-display block text-[clamp(1.7rem,2.6vw,2.3rem)] leading-tight">{t('casa.cal.nothingMore')}</span>
          {upcoming ? (
            <span className="mt-1 block truncate text-[1.1rem] text-(--text-muted)">
              {t('casa.cal.nextOn', {
                title: upcoming[1][0].event.title,
                day: new Date(upcoming[0] + 'T12:00').toLocaleDateString(loc, { weekday: 'long', day: 'numeric' }),
              })}
            </span>
          ) : null}
        </span>
      </button>
    )
  }
  const ev = next.event
  const g = ev.kind === 'birthday' || ev.kind === 'anniversary' ? GRAD.birthday : GRAD.event
  const owner = data.members.find((m) => m.email === ev.owner_email)
  const mins = now.getHours() * 60 + now.getMinutes()
  const start = minutesOf(ev.start_time)
  const inMin = start - mins
  const when = ev.all_day
    ? t('casa.cal.allDay')
    : inMin <= 0
      ? t('casa.cal.now')
      : inMin < 60
        ? t('casa.cal.inMinutes', { count: inMin })
        : t('casa.cal.inHours', { h: Math.floor(inMin / 60), m: String(inMin % 60).padStart(2, '0') })
  return (
    <button
      onClick={(e) => onClick(e.currentTarget)}
      className="casa-press casa-rise relative flex min-h-[150px] items-center gap-5 overflow-hidden rounded-[32px] p-7 text-left text-white"
      style={{ ['--i' as string]: 1, background: grad(g), boxShadow: `0 24px 50px -26px ${g[1]}` }}
    >
      <span className="pointer-events-none absolute -top-16 -right-10 h-56 w-56 rounded-full bg-white/10" aria-hidden />
      <span className="pointer-events-none absolute -bottom-20 right-24 h-40 w-40 rounded-full bg-white/8" aria-hidden />
      <span className="relative min-w-0 flex-1">
        <span className="block text-[1rem] font-semibold uppercase tracking-[0.14em] opacity-80">{t('casa.cal.nextToday')}</span>
        <span className="font-display mt-1 block truncate text-[clamp(2rem,3.4vw,3rem)] leading-[1.05]">
          {KIND_EMOJI[ev.kind] ? `${KIND_EMOJI[ev.kind]} ` : ''}
          {ev.title}
        </span>
        <span className="mt-2 block truncate text-[1.2rem] opacity-90">
          {!ev.all_day ? `${ev.start_time?.slice(0, 5)} · ` : ''}
          {when}
          {ev.location ? ` · ${ev.location}` : ''}
        </span>
      </span>
      {owner ? (
        <span className="relative rounded-full" style={{ boxShadow: '0 0 0 3px rgb(255 255 255 / .5)' }}>
          <Avatar m={owner} size={64} />
        </span>
      ) : null}
    </button>
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
    <button onClick={(e) => onClick(e.currentTarget)} className="casa-card casa-press casa-rise flex min-h-[170px] flex-col rounded-[30px] p-6 text-left" style={{ ['--i' as string]: 2 }}>
      <span className="flex items-center gap-3">
        <IconChip icon={ListChecks} g={GRAD.lists} size={48} />
        <span className="font-display text-[1.7rem]">{t('casa.lists.title')}</span>
      </span>
      <span className="mt-3 flex items-baseline gap-2">
        <span className="font-display text-[3rem] leading-none">{data.open.length}</span>
        <span className="text-[1.1rem] text-(--text-muted)">{t('casa.lists.openWord', { count: data.open.length })}</span>
      </span>
      <span className="mt-2 block truncate text-[1.05rem] text-(--text-muted)">
        {groups.length ? groups.map((g) => `${g.name} ${g.n}`).join('  ·  ') : t('casa.lists.allDone')}
      </span>
    </button>
  )
}

function PetsCard({ due, onClick }: { due: ReturnType<typeof petsDue>; onClick: (el: HTMLElement) => void }) {
  const { t } = useI18n()
  return (
    <button onClick={(e) => onClick(e.currentTarget)} className="casa-card casa-press casa-rise flex min-h-[170px] flex-col rounded-[30px] p-6 text-left" style={{ ['--i' as string]: 3 }}>
      <span className="flex items-center gap-3">
        <IconChip icon={PawPrint} g={GRAD.pets} size={48} />
        <span className="font-display text-[1.7rem]">{t('casa.pets.title')}</span>
      </span>
      {due.length ? (
        <>
          <span className="mt-3 flex items-baseline gap-2">
            <span className="font-display text-[3rem] leading-none">{due.length}</span>
            <span className="text-[1.1rem] text-(--text-muted)">{t('casa.pets.today', { count: due.length })}</span>
          </span>
          <span className="mt-2 block truncate text-[1.05rem] text-(--text-muted)">
            {due
              .slice(0, 3)
              .map((d) => `${d.pet.emoji} ${d.title}`)
              .join('  ·  ')}
          </span>
        </>
      ) : (
        <span className="font-display mt-4 block text-[1.6rem] leading-tight text-(--text-muted)">{t('casa.pets.allDone')} ✓</span>
      )}
    </button>
  )
}

function Tile({
  i,
  id,
  icon,
  label,
  sub,
  lock,
  tiles,
  onOpen,
}: {
  i: number
  id: PanelId
  icon: LucideIcon
  label: string
  sub: string
  lock?: 'pin' | 'plus' | null
  tiles: React.MutableRefObject<Partial<Record<PanelId, HTMLElement | null>>>
  onOpen: (id: PanelId, el?: HTMLElement | null) => void
}) {
  const { t } = useI18n()
  return (
    <button
      ref={(el) => {
        tiles.current[id] = el
      }}
      onClick={(e) => onOpen(id, e.currentTarget)}
      className="casa-card casa-press casa-rise flex min-h-[112px] items-center gap-4 rounded-[30px] px-5 py-4 text-left portrait:flex-col portrait:items-start portrait:gap-3"
      style={{ ['--i' as string]: i }}
    >
      <span className="relative">
        <IconChip icon={icon} g={GRAD[id]} size={60} />
        {lock === 'pin' ? (
          <span className="absolute -right-1.5 -bottom-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-(--card) shadow">
            <Lock size={15} strokeWidth={2.6} className="text-(--text-muted)" aria-hidden />
          </span>
        ) : null}
      </span>
      <span className="min-w-0">
        <span className="font-display block truncate text-[clamp(1.35rem,1.9vw,1.75rem)] leading-tight">{label}</span>
        {lock === 'plus' ? (
          <span className="mt-1 block">
            <PlusTag label={t('casa.plan.noPlus')} />
          </span>
        ) : sub ? (
          <span className="mt-0.5 block truncate text-[1rem] text-(--text-muted)">{sub}</span>
        ) : null}
      </span>
    </button>
  )
}

