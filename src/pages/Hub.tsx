import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Backdrop from '../components/Backdrop'
import Drawer from '../components/Drawer'
import { useAppPrefs } from '../hooks/useAppPrefs'
import { useAuth } from '../hooks/useAuth'
import { useCachedQuery } from '../hooks/useCachedQuery'
import { useHousehold } from '../hooks/useHousehold'
import { useI18n } from '../hooks/useI18n'
import { ADMIN_APP, APPS } from '../lib/apps'
import { todayISO } from '../lib/format'
import type { TKey } from '../lib/i18n'
import { dueSoonCount } from '../lib/importantDates'
import { overdueEvents } from '../lib/petCare'
import { supabase } from '../lib/supabase'
import type { ImportantDate, PetEvent } from '../lib/types'

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
  const { hidden, tileStyle } = useAppPrefs()
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

  // Dates due within ~30 days (or an expired one-time) → amber badge.
  const { data: dueSoonDates = 0 } = useCachedQuery<number>('hub:dueSoonDates', async () => {
    const { data } = await supabase.from('important_dates').select('*')
    return dueSoonCount((data ?? []) as ImportantDate[], todayISO())
  })

  const badges: Record<string, number> = {
    shopping: shoppingCount,
    pets: overduePets,
    dates: dueSoonDates,
  }

  const tiles = [
    ...APPS.filter((app) => !hidden.includes(app.id)),
    ...(profile?.is_admin ? [ADMIN_APP] : []),
  ]

  const badgeFor = (appId: string) => {
    const n = badges[appId] ?? 0
    if (n === 0) return null
    // Pet reminders → red (overdue); dates → amber (heads-up); else accent.
    const color =
      appId === 'pets'
        ? 'bg-(--expense)'
        : appId === 'dates'
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

  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-28">
      <Backdrop />
      <header className="flex items-center justify-between pt-6 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-(--text)">
            {household?.name ?? 'One Roof'}
          </h1>
          <p className="text-sm text-(--text-muted)">
            {t(greetKey, { name: profile?.display_name ?? '' })}
          </p>
        </div>
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label={t('hub.openSettings')}
          className="rounded-lg px-3 py-2 text-xl text-(--text-muted) active:text-(--text)"
        >
          ☰
        </button>
      </header>

      {tiles.length === 0 ? (
        <div className="mt-16 text-center text-(--text-muted)">
          <div className="text-5xl">🫥</div>
          <p className="mt-4">{t('hub.allHidden')}</p>
          <p className="text-sm text-(--text-faint)">{t('hub.allHiddenHint')}</p>
        </div>
      ) : tileStyle === 'compact' ? (
        <div className="grid grid-cols-3 gap-2.5">
          {tiles.map((app) => (
            <button
              key={app.id}
              onClick={() => navigate(app.route)}
              className="relative flex flex-col items-center gap-1.5 rounded-xl bg-(--card) px-2 py-3.5 active:bg-(--card-active) transition-colors"
            >
              {badgeFor(app.id)}
              <span className="text-2xl">{app.icon}</span>
              <span className="w-full truncate text-center text-xs font-semibold text-(--text)">
                {t(`app.${app.id}.name` as TKey)}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {tiles.map((app) => (
            <button
              key={app.id}
              onClick={() => navigate(app.route)}
              className="relative flex flex-col items-start gap-1.5 rounded-2xl bg-(--card) p-5 text-left active:bg-(--card-active) transition-colors"
            >
              {badgeFor(app.id)}
              <span className="text-3xl">{app.icon}</span>
              <span className="mt-1 font-bold text-(--text)">
                {t(`app.${app.id}.name` as TKey)}
              </span>
              <span className="text-xs leading-snug text-(--text-faint)">
                {t(`app.${app.id}.desc` as TKey)}
              </span>
            </button>
          ))}
        </div>
      )}

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  )
}
