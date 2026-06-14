import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Backdrop from '../components/Backdrop'
import Drawer from '../components/Drawer'
import { useAppPrefs } from '../hooks/useAppPrefs'
import { useAuth } from '../hooks/useAuth'
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
  // Header shows the family's own name ("Munhoz Family"); the hook caches it
  // locally so it doesn't flash "One Roof" on every open.
  const { household } = useHousehold()
  // Each user picks their own tiles and density; Admin is always shown to admins.
  const { hidden, tileStyle } = useAppPrefs()
  const navigate = useNavigate()
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Open (unchecked) shopping items, shown as a badge on the tile. Live via
  // the same Realtime table the list itself uses, so the badge updates while
  // the other phone is shopping.
  const [shoppingCount, setShoppingCount] = useState(0)
  const loadShoppingCount = useCallback(async () => {
    const { count } = await supabase
      .from('shopping_items')
      .select('id', { count: 'exact', head: true })
      .eq('checked', false)
    setShoppingCount(count ?? 0)
  }, [])
  useEffect(() => {
    loadShoppingCount()
    const channel = supabase
      .channel('hub_shopping_badge')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shopping_items' },
        () => loadShoppingCount(),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadShoppingCount])

  // Overdue/ due-today pet reminders, shown as a red attention badge. Reloads
  // when the hub remounts (i.e. on return from Pet Care), which is enough —
  // overdue status changes by date, not by another phone's live action.
  const [overduePets, setOverduePets] = useState(0)
  useEffect(() => {
    let cancelled = false
    supabase
      .from('pet_events')
      .select('*')
      .order('event_date', { ascending: false })
      .then(({ data }) => {
        if (cancelled) return
        setOverduePets(overdueEvents((data ?? []) as PetEvent[], todayISO()).length)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Dates due within ~30 days (or an expired one-time) → amber badge.
  const [dueSoonDates, setDueSoonDates] = useState(0)
  useEffect(() => {
    let cancelled = false
    supabase
      .from('important_dates')
      .select('*')
      .then(({ data }) => {
        if (cancelled) return
        setDueSoonDates(dueSoonCount((data ?? []) as ImportantDate[], todayISO()))
      })
    return () => {
      cancelled = true
    }
  }, [])

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
            {t('hub.greeting', { name: profile?.display_name ?? '' })}
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
