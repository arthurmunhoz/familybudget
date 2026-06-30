import { useEffect, useState } from 'react'
import { BellOff, LayoutGrid, Menu } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import Backdrop from '../components/Backdrop'
import Drawer from '../components/Drawer'
import PingsBanner from '../components/PingsBanner'
import WhatsNewModal from '../components/WhatsNewModal'
import { useAppPrefs } from '../hooks/useAppPrefs'
import { useAuth } from '../hooks/useAuth'
import { useCachedQuery } from '../hooks/useCachedQuery'
import { useHousehold } from '../hooks/useHousehold'
import { useI18n } from '../hooks/useI18n'
import { useNotificationsActive } from '../hooks/useNotificationsActive'
import { ADMIN_APP } from '../lib/apps'
import { upcomingOccurrences } from '../lib/calendar'
import { todayISO } from '../lib/format'
import type { TKey } from '../lib/i18n'
import { overdueEvents } from '../lib/petCare'
import { supabase } from '../lib/supabase'
import type { CalendarEvent, PetEvent } from '../lib/types'

export default function Hub() {
  const { profile } = useAuth()
  const { t } = useI18n()
  // Greeting follows the time of day: morning 5–11, afternoon 12–17, else evening.
  const hour = new Date().getHours()
  const greetKey =
    hour < 5 ? 'hub.evening' : hour < 12 ? 'hub.morning' : hour < 18 ? 'hub.afternoon' : 'hub.evening'
  // Header shows the family's own name ("Munhoz Family"); the hook caches it
  // locally so it doesn't flash "One Roof" on every open.
  const { household } = useHousehold()
  // Each user picks their own tiles and density; Admin is always shown to admins.
  const { hidden, tileStyle, orderedApps } = useAppPrefs()
  const navigate = useNavigate()
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Badges are cached in memory (useCachedQuery): on return to the hub they
  // render their last value instantly and only update if the data changed —
  // no flash from 0 → N on every remount.

  // Open (unchecked) shopping items. Live via the same Realtime table the list
  // uses, so the badge updates while the other phone is shopping.
  const { data: shoppingCount = 0, revalidate: reloadShopping } = useCachedQuery<number>(
    'hub:shoppingCount',
    async () => {
      const { count } = await supabase
        .from('shopping_items')
        .select('id', { count: 'exact', head: true })
        .eq('checked', false)
      return count ?? 0
    },
  )
  useEffect(() => {
    const channel = supabase
      .channel('hub_shopping_badge')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shopping_items' },
        () => reloadShopping(),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [reloadShopping])

  // Overdue / due-today pet reminders → red attention badge.
  const { data: overduePets = 0 } = useCachedQuery<number>('hub:overduePets', async () => {
    const { data } = await supabase
      .from('pet_events')
      .select('*')
      .order('event_date', { ascending: false })
    return overdueEvents((data ?? []) as PetEvent[], todayISO()).length
  })

  // Upcoming birthdays/anniversaries/renewals within ~30 days → amber badge.
  const { data: calendarSoon = 0 } = useCachedQuery<number>('hub:calendarSoon', async () => {
    const { data } = await supabase.from('calendar_events').select('*')
    const special = ((data ?? []) as CalendarEvent[]).filter((e) => e.kind !== 'event')
    return upcomingOccurrences(special, todayISO(), 30).length
  })

  const badges: Record<string, number> = {
    shopping: shoppingCount,
    pets: overduePets,
    calendar: calendarSoon,
  }

  const tiles = [
    ...orderedApps.filter((app) => !hidden.includes(app.id)),
    ...(profile?.is_admin ? [ADMIN_APP] : []),
  ]

  const badgeFor = (appId: string) => {
    const n = badges[appId] ?? 0
    if (n === 0) return null
    // Pet reminders → red (overdue); dates → amber (heads-up); else accent.
    const color =
      appId === 'pets'
        ? 'bg-(--expense)'
        : appId === 'calendar'
          ? 'bg-amber-500'
          : 'bg-(--accent)'
    return (
      <span
        className={`absolute right-2 top-2 min-w-5 rounded-full px-1.5 py-0.5 text-center text-[11px] font-bold leading-tight text-white ${color}`}
      >
        {n > 99 ? '99+' : n}
      </span>
    )
  }

  // The Nudges tile's own icon reflects whether this device can get alerts:
  // a struck-through bell (BellOff) when notifications are off, the normal bell
  // when they're on. `alertsOff` is computed per-tile below.
  const notifActive = useNotificationsActive()
  const alertsOff = (appId: string) => appId === 'pings' && notifActive === false

  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-28">
      <Backdrop />
      <header className="sticky top-0 z-10 -mx-4 -mt-[env(safe-area-inset-top)] flex items-center justify-between bg-(--bg) px-4 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-5">
        <div>
          <h1 className="font-display text-[26px] font-semibold text-(--text)">
            {household?.name ?? 'One Roof'}
          </h1>
          <p className="text-sm text-(--text-muted)">
            {t(greetKey, { name: profile?.display_name ?? '' })}
          </p>
        </div>
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label={t('hub.openSettings')}
          className="rounded-lg px-3 py-2 text-(--text-muted) active:text-(--text)"
        >
          <Menu size={24} strokeWidth={2} aria-hidden="true" />
        </button>
      </header>

      <PingsBanner />

      {tiles.length === 0 ? (
        <div className="mt-16 flex flex-col items-center text-center text-(--text-muted)">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-(--surface) text-(--text-faint)">
            <LayoutGrid size={32} strokeWidth={1.75} aria-hidden="true" />
          </div>
          <p className="mt-4">{t('hub.allHidden')}</p>
          <p className="text-sm text-(--text-faint)">{t('hub.allHiddenHint')}</p>
        </div>
      ) : tileStyle === 'compact' ? (
        <div className="mt-2 grid grid-cols-3 gap-2.5">
          {tiles.map((app) => {
            const off = alertsOff(app.id)
            const Icon = off ? BellOff : app.icon
            return (
              <button
                key={app.id}
                onClick={() => navigate(app.route)}
                className="relative flex flex-col items-center gap-2 rounded-2xl border border-(--surface-2) bg-(--card)/65 px-2 py-4 backdrop-blur-md active:bg-(--card-active) transition-colors"
              >
                {badgeFor(app.id)}
                <span
                  className="flex h-11 w-11 items-center justify-center rounded-xl bg-(--surface) text-(--accent)"
                  title={off ? t('notif.alertsOff') : undefined}
                >
                  <Icon size={21} strokeWidth={2} aria-hidden="true" />
                </span>
                <span className="w-full text-center text-[11px] font-semibold leading-tight text-(--text)">
                  {t(`app.${app.id}.name` as TKey)}
                </span>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="mt-2 grid grid-cols-2 gap-3">
          {tiles.map((app) => {
            const off = alertsOff(app.id)
            const Icon = off ? BellOff : app.icon
            return (
              <button
                key={app.id}
                onClick={() => navigate(app.route)}
                className="relative flex flex-col items-start gap-2 rounded-2xl border border-(--surface-2) bg-(--card)/65 p-4 text-left backdrop-blur-md active:bg-(--card-active) transition-colors"
              >
                {badgeFor(app.id)}
                <span
                  className="flex h-12 w-12 items-center justify-center rounded-2xl bg-(--surface) text-(--accent)"
                  title={off ? t('notif.alertsOff') : undefined}
                >
                  <Icon size={24} strokeWidth={2} aria-hidden="true" />
                </span>
                <span className="mt-1 font-semibold text-(--text)">
                  {t(`app.${app.id}.name` as TKey)}
                </span>
                <span className="text-xs leading-snug text-(--text-faint)">
                  {t(`app.${app.id}.desc` as TKey)}
                </span>
              </button>
            )
          })}
        </div>
      )}

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <WhatsNewModal />
    </div>
  )
}
