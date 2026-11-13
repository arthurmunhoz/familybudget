// Modo Casa — the always-on hub: the day at a glance (date · weather · the
// family strip, a big clock), the family's areas as live previews ("Painel")
// or one big swipeable widget at a time ("Widgets"), Money as a small locked
// link, the photo frame (button or after N idle minutes), and Roof at the
// bottom. Nothing navigates away: panels grow in place.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, Images, ListChecks, Lock, PawPrint, Settings, Sparkles, Wallet } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../hooks/useTheme'
import { useI18n } from '../hooks/useI18n'
import { useHomeWeather, weatherIcon, type TempUnit } from '../lib/weather'
import type { PanelId } from './assistant'
import { useHubData, type HubData } from './data'
import { useFramePhotos } from './frame'
import { FrameMode, FrameWidget } from './FrameShow'
import CalendarPanel from './panels/CalendarPanel'
import FamilyPanel from './panels/FamilyPanel'
import ListsPanel from './panels/ListsPanel'
import MoneyPanel from './panels/MoneyPanel'
import PetsPanel from './panels/PetsPanel'
import { usePrefs } from './prefs'
import { CalendarPreview, ListsPreview, MoneyWidget, PetsPreview, PreviewCard, calendarSub, petRows } from './Previews'
import Roof from './Roof'
import { sceneFor, WeatherScene } from './WeatherScene'
import { usePlan } from './session'
import { PlanSheet, SettingsSheet } from './Sheets'
import { unlockAudioOnFirstTouch, tick } from './sound'
import { Avatar, Grow, useNow, type GrowHandle } from './ui'
import { GRAD, LOCALE, cap, grad, isoOf, lsGet, lsSet } from './util'
import Widgets, { type WidgetPage } from './Widgets'

const IDLE_LOCK_MS = 2 * 60_000
const DRIFT_MS = 4 * 60_000

type HubPanel = PanelId | 'family'

function usePortrait(): boolean {
  const [p, setP] = useState(() => window.matchMedia('(orientation: portrait)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait)')
    const f = () => setP(mq.matches)
    mq.addEventListener('change', f)
    return () => mq.removeEventListener('change', f)
  }, [])
  return p
}

export default function Hub() {
  const { t, lang } = useI18n()
  const { profile } = useAuth()
  const { theme } = useTheme()
  const prefs = usePrefs()
  const plan = usePlan()
  const { data, loading, revalidate } = useHubData()
  const album = useFramePhotos()
  const now = useNow(1000)
  const today = isoOf(now)
  const portrait = usePortrait()
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
  const [panel, setPanel] = useState<{ id: HubPanel; origin: DOMRect | null; member?: string | null } | null>(null)
  const panelRef = useRef<GrowHandle>(null)
  const [sheet, setSheet] = useState<{ k: 'settings' | 'plan'; origin: DOMRect | null } | null>(null)
  const sheetRef = useRef<GrowHandle>(null)
  const [unlocked, setUnlocked] = useState(false)
  const [roofOpen, setRoofOpen] = useState(false)
  const [frame, setFrame] = useState(false)
  const lastTouch = useRef(Date.now())

  const openPanel = useCallback(
    (id: HubPanel, el?: HTMLElement | null, member?: string | null) => {
      if (id === 'money' && !plan.full) {
        setSheet({ k: 'plan', origin: el?.getBoundingClientRect() ?? null })
        return
      }
      tick()
      setPanel({ id, origin: el?.getBoundingClientRect() ?? null, member })
    },
    [plan.full],
  )
  const panelId = useRef<HubPanel | null>(null)
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

  useEffect(() => {
    const touch = () => (lastTouch.current = Date.now())
    window.addEventListener('pointerdown', touch)
    window.addEventListener('keydown', touch)
    return () => {
      window.removeEventListener('pointerdown', touch)
      window.removeEventListener('keydown', touch)
    }
  }, [])
  // Money locks itself after 2 minutes without a touch, and the hub returns.
  useEffect(() => {
    if (!unlocked) return
    const id = setInterval(() => {
      if (Date.now() - lastTouch.current < IDLE_LOCK_MS) return
      setUnlocked(false)
      if (panel?.id === 'money') void closePanel()
    }, 5000)
    return () => clearInterval(id)
  }, [unlocked, panel, closePanel])

  // The photo frame takes over after N idle minutes — only over the bare hub
  // (never over an open panel, a sheet or Roof), and only with photos.
  const idleMs = prefs.frameIdle * 60_000
  const canIdle = idleMs > 0 && album.photos.length > 0 && !panel && !sheet && !roofOpen && !frame
  useEffect(() => {
    if (!canIdle) return
    const id = setInterval(() => {
      if (Date.now() - lastTouch.current >= idleMs) setFrame(true)
    }, 5000)
    return () => clearInterval(id)
  }, [canIdle, idleMs])
  // Roof heard "Ei Roof" while the frame was up: give the screen back.
  useEffect(() => {
    if (roofOpen) setFrame(false)
  }, [roofOpen])

  // ── derived ────────────────────────────────────────────────────────────────
  const loc = LOCALE[lang]
  const hour = now.getHours()
  const greeting = hour < 5 ? t('casa.night') : hour < 12 ? t('casa.morning') : hour < 18 ? t('casa.afternoon') : t('casa.evening')
  const WIcon = weather.weather ? weatherIcon(weather.weather.code) : null
  const me = {
    email: profile?.email ?? '',
    name: data.members.find((m) => m.email === profile?.email)?.name ?? profile?.display_name ?? '',
  }
  const moneyState: 'plus' | 'pin' | 'open' = plan.full ? (unlocked ? 'open' : 'pin') : 'plus'
  const petsLeft = useMemo(() => petRows(data, data.done, today, t).filter((r) => !r.done).length, [data, today, t])
  const listsSub = t('casa.lists.openCount', { count: data.open.length })
  const petsSub = data.pets.length ? (petsLeft ? t('casa.pets.dueCount', { count: petsLeft }) : t('casa.pets.allDone')) : undefined

  const pages: WidgetPage[] = [
    {
      id: 'calendar',
      label: t('app.calendar.name'),
      render: () => (
        <PreviewCard plain i={0} icon={CalendarDays} g={GRAD.calendar} title={t('app.calendar.name')} sub={calendarSub(data, today, now, t)} onOpen={(el) => openPanel('calendar', el)}>
          <CalendarPreview data={data} today={today} now={now} big />
        </PreviewCard>
      ),
    },
    {
      id: 'lists',
      label: t('casa.lists.title'),
      render: () => (
        <PreviewCard plain i={0} icon={ListChecks} g={GRAD.lists} title={t('casa.lists.title')} sub={listsSub} onOpen={(el) => openPanel('lists', el)}>
          <ListsPreview data={data} full={plan.full} refresh={refresh} big />
        </PreviewCard>
      ),
    },
    {
      id: 'pets',
      label: t('casa.pets.title'),
      render: () => (
        <PreviewCard plain i={0} icon={PawPrint} g={GRAD.pets} title={t('casa.pets.title')} sub={petsSub} onOpen={(el) => openPanel('pets', el)}>
          <PetsPreview data={data} today={today} full={plan.full} refresh={refresh} big />
        </PreviewCard>
      ),
    },
    {
      id: 'money',
      label: t('app.budget.name'),
      render: () => <MoneyWidget state={moneyState} onOpen={(el) => openPanel('money', el)} />,
    },
    {
      id: 'frame',
      label: t('casa.frame.title'),
      render: (active) => <FrameWidget photos={album.photos} members={data.members} today={today} active={active} onFullscreen={() => setFrame(true)} />,
    },
  ]

  return (
    <div className="casa-root">
      {/* The weather sky across the top; the soft aurora only when no city is set. */}
      {weather.weather ? (
        <WeatherScene kind={sceneFor(weather.weather.code, weather.weather.isDay !== false)} dark={theme === 'dark'} />
      ) : (
        <div className="casa-aurora" aria-hidden>
          <i />
          <i />
          <i />
        </div>
      )}

      <div
        className="casa-drift relative flex h-full flex-col px-[clamp(20px,3.2vw,48px)] pt-[clamp(14px,2.2vh,26px)] pb-[clamp(14px,2vh,24px)]"
        style={{ transform: `translate3d(${drift.x}px, ${drift.y}px, 0)` }}
      >
        {/* top line */}
        <header className="casa-fade flex items-center gap-3 text-[clamp(1.05rem,1.5vw,1.3rem)] text-(--text-muted)">
          <span className="min-w-0 flex-1 truncate">
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
          {plan.trialDays !== null && plan.full ? (
            <span className="casa-glass hidden rounded-full px-3.5 py-1.5 text-[0.95rem] font-semibold landscape:inline">{t('casa.plan.trial', { count: plan.trialDays })}</span>
          ) : null}
          <button
            onClick={(e) => openPanel('money', e.currentTarget)}
            className="casa-glass casa-press inline-flex h-12 shrink-0 items-center gap-2 rounded-full pr-4 pl-1.5 text-[1rem] font-semibold text-(--text)"
          >
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full" style={{ background: grad(GRAD.money) }}>
              <Wallet size={18} color="#fff" strokeWidth={2.2} aria-hidden />
            </span>
            {t('app.budget.name')}
            {moneyState !== 'open' ? <Lock size={15} strokeWidth={2.6} className="text-(--text-muted)" aria-hidden /> : null}
          </button>
          <button
            onClick={() => {
              tick()
              setFrame(true)
            }}
            aria-label={t('casa.frame.title')}
            className="casa-glass casa-press inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-(--text)"
          >
            <Images size={22} aria-hidden />
          </button>
          <FamilyStrip data={data} loading={loading} max={portrait ? 4 : 6} onOpen={(el) => openPanel('family', el)} />
          <button
            onClick={(e) => setSheet({ k: 'settings', origin: e.currentTarget.getBoundingClientRect() })}
            aria-label={t('casa.settings.title')}
            className="casa-press inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-(--text-muted)"
          >
            <Settings size={26} aria-hidden />
          </button>
        </header>

        {/* middle: the clock, and the areas (cards or one big widget) */}
        <div className="grid min-h-0 flex-1 gap-x-[clamp(20px,3vw,44px)] gap-y-4 py-3 portrait:grid-cols-[minmax(0,1fr)] portrait:grid-rows-[auto_minmax(0,1fr)] landscape:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <section className="casa-rise flex flex-col justify-center portrait:pt-4 portrait:pb-1" style={{ ['--i' as string]: 0 }}>
            <div className="casa-drift" style={{ transform: `translate3d(${drift.cx}px, ${drift.cy}px, 0)` }}>
              <Clock now={now} loc={loc} />
              <p className="font-display mt-2 text-[clamp(1.3rem,2vw,1.8rem)] text-(--text-muted)">{greeting}</p>
            </div>
          </section>

          {prefs.layout === 'widgets' ? (
            <div className="min-h-0 min-w-0">
              <Widgets pages={pages} />
            </div>
          ) : (
            <section className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 portrait:grid-rows-[1.15fr_1fr] landscape:grid-rows-2">
              <PreviewCard
                i={1}
                icon={CalendarDays}
                g={GRAD.calendar}
                title={t('app.calendar.name')}
                sub={calendarSub(data, today, now, t)}
                onOpen={(el) => openPanel('calendar', el)}
                className="portrait:col-span-2 landscape:row-span-2"
              >
                <CalendarPreview data={data} today={today} now={now} big />
              </PreviewCard>
              <PreviewCard i={2} icon={ListChecks} g={GRAD.lists} title={t('casa.lists.title')} sub={listsSub} onOpen={(el) => openPanel('lists', el)}>
                <ListsPreview data={data} full={plan.full} refresh={refresh} />
              </PreviewCard>
              <PreviewCard i={3} icon={PawPrint} g={GRAD.pets} title={t('casa.pets.title')} sub={petsSub} onOpen={(el) => openPanel('pets', el)}>
                <PetsPreview data={data} today={today} full={plan.full} refresh={refresh} />
              </PreviewCard>
            </section>
          )}
        </div>

        {!plan.full ? (
          <div className="casa-card casa-rise mb-3 flex items-center gap-5 rounded-[26px] px-6 py-3.5" style={{ ['--i' as string]: 5 }}>
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

        <div className="casa-rise mx-auto mt-[clamp(6px,1.2vh,12px)] w-full max-w-[880px]" style={{ ['--i' as string]: 6 }}>
          <Roof
            data={data}
            full={plan.full}
            today={today}
            me={me}
            refresh={refresh}
            hidden={!!panel || !!sheet}
            onOpenPanel={(id) => openPanel(id)}
            onLocked={() => setSheet({ k: 'plan', origin: null })}
            onOpenChange={setRoofOpen}
          />
        </div>
      </div>

      {panel ? (
        <Grow key={panel.id} ref={panelRef} origin={panel.origin} radius={40} onBackdrop={() => void closePanel()} className="inset-3 bg-(--bg) sm:inset-6">
          {panel.id === 'lists' ? (
            <ListsPanel data={data} full={plan.full} me={profile?.email ?? ''} refresh={refresh} onClose={() => void closePanel()} />
          ) : panel.id === 'calendar' ? (
            <CalendarPanel data={data} today={today} full={plan.full} refresh={refresh} onClose={() => void closePanel()} />
          ) : panel.id === 'pets' ? (
            <PetsPanel data={data} today={today} full={plan.full} refresh={refresh} onClose={() => void closePanel()} />
          ) : panel.id === 'family' ? (
            <FamilyPanel data={data} today={today} me={profile?.email ?? ''} initial={panel.member} onClose={() => void closePanel()} />
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

      {frame ? (
        <FrameMode
          photos={album.photos}
          members={data.members}
          today={today}
          now={now}
          onExit={() => {
            lastTouch.current = Date.now()
            setFrame(false)
          }}
        />
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

/** Up to `max` overlapping faces + "+N"; the whole strip opens Família. */
function FamilyStrip({ data, loading, max, onOpen }: { data: HubData; loading: boolean; max: number; onOpen: (el: HTMLElement) => void }) {
  const { t } = useI18n()
  const ms = data.members
  if (loading && !ms.length) return <span className="casa-shimmer h-12 w-28 shrink-0 rounded-full" />
  if (!ms.length) return null
  const shown = ms.length > max ? ms.slice(0, max - 1) : ms
  const extra = ms.length - shown.length
  return (
    <button
      onClick={(e) => onOpen(e.currentTarget)}
      aria-label={t('casa.family.title')}
      className="casa-glass casa-press inline-flex h-12 shrink-0 items-center rounded-full py-1 pr-1.5 pl-1.5"
    >
      {shown.map((m, i) => (
        <span key={m.email} className="casa-face inline-flex rounded-full" style={{ marginLeft: i ? -10 : 0, zIndex: shown.length - i }}>
          <Avatar m={m} size={38} />
        </span>
      ))}
      {extra > 0 ? (
        <span className="casa-face relative -ml-2.5 inline-flex h-[38px] min-w-[38px] items-center justify-center rounded-full bg-(--surface-2) px-1.5 text-[0.9rem] font-bold text-(--text)">
          +{extra}
        </span>
      ) : null}
    </button>
  )
}
