// "Today" for one family member, on their Family page right under the birthday
// card (2026-11): their calendar for the day — their own events plus the whole
// household's — (or the next thing coming up; tapping opens Calendar on that day), the
// money they logged today (+ the last 7 days), where they are (Whereabouts, only
// when they share), and what they put on the shopping list today. Everything is
// read under the normal RLS — a private budget I can't see simply doesn't count —
// and filtered to this member on the client/query. Each tile opens its app.
import { useCallback, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { CalendarDays, ChevronRight, MapPin, ShoppingCart, Wallet } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import { APP_GRADIENT } from '@/components/home/palette'
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { useI18n } from '@/hooks/useI18n'
import { useToday } from '@/hooks/useToday'
import { supabase } from '@/lib/supabase'
import {
  KIND_EMOJI,
  compareOccurrences,
  formatTime,
  occurrencesByDay,
  upcomingOccurrences,
  yearsAt,
} from '@/lib/calendar'
import { categoryById } from '@/lib/categories'
import { addDaysISO, formatDay, formatMoney } from '@/lib/format'
import { WHEREABOUTS_ENABLED } from '@/lib/features'
import { isPaused, isSharingLive } from '@/lib/location'
import { placeAt } from '@/lib/places'
import type { CalendarEvent, CustomCategory, Entry, MemberLocation, Place } from '@/lib/types'
import { fonts, sp, useTheme } from '@/theme/theme'
import { IconTile } from './MemberDetail'

const LOCALE: Record<string, string> = { en: 'en-US', es: 'es', pt: 'pt-BR' }
const MAX_EVENTS = 4
const MAX_ENTRIES = 3

type EntryLite = Pick<Entry, 'id' | 'type' | 'label' | 'amount' | 'category' | 'entry_date' | 'created_at' | 'month_id'>
interface TodayData {
  events: CalendarEvent[]
  entries: EntryLite[]
  customCats: CustomCategory[]
  location: MemberLocation | null
  places: Place[]
  shoppingToday: number
  /** month_id → budget_id, so a tapped entry opens its own period. */
  budgetOf: Record<string, string>
}

const EMPTY: TodayData = { events: [], entries: [], customCats: [], location: null, places: [], shoppingToday: 0, budgetOf: {} }

type IconT = typeof Wallet
type GradientT = (typeof APP_GRADIENT)[keyof typeof APP_GRADIENT]

function Head({ icon, colors, title, right }: { icon: IconT; colors: GradientT; title: string; right?: string }) {
  const { c } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
      <IconTile Icon={icon} colors={colors} size={32} />
      <Txt style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 15.5 }} numberOfLines={1}>
        {title}
      </Txt>
      {right ? (
        <Txt style={{ fontFamily: fonts.display, fontSize: 19 }} numberOfLines={1}>
          {right}
        </Txt>
      ) : null}
      <ChevronRight size={16} color={c.textFaint} />
    </View>
  )
}

/** "5 min ago" in the app language (lib/format's timeAgo is English-only). */
function agoText(iso: string, t: ReturnType<typeof useI18n>['t']): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return t('ask.justNow')
  if (min < 60) return t('ask.minutesAgo', { n: min })
  if (min < 60 * 24) return t('ask.hoursAgo', { n: Math.floor(min / 60) })
  return formatDay(iso.slice(0, 10))
}

function Muted({ text }: { text: string }) {
  const { c } = useTheme()
  return <Txt style={{ color: c.textMuted, fontSize: 14 }}>{text}</Txt>
}

export function MemberToday({ email, firstName }: { email: string; firstName: string }) {
  const { t, lang } = useI18n()
  const { c } = useTheme()
  const locale = LOCALE[lang] ?? 'en-US'
  const today = useToday()
  const weekStart = addDaysISO(today, -6)

  const { data = EMPTY, revalidate } = useCachedQuery<TodayData>(`family:today:${email}:${today}`, async () => {
    // Local midnight → "added today" for timestamptz columns.
    const [y, m, d] = today.split('-').map(Number)
    const dayStart = new Date(y, m - 1, d).toISOString()
    const [ev, en, cc, loc, pl, sh] = await Promise.all([
      // Theirs + the whole household's (owner_email null). The email is quoted:
      // it carries '.' and '@', which PostgREST's or() grammar would split on.
      supabase.from('calendar_events').select('*').or(`owner_email.eq."${email}",owner_email.is.null`),
      supabase
        .from('entries')
        .select('id, type, label, amount, category, entry_date, created_at, month_id')
        .eq('person_email', email)
        .gte('entry_date', weekStart)
        .lte('entry_date', today)
        .order('created_at', { ascending: false }),
      supabase.from('custom_categories').select('*'),
      WHEREABOUTS_ENABLED
        ? supabase.from('member_locations').select('*').eq('user_email', email).maybeSingle()
        : Promise.resolve({ data: null }),
      WHEREABOUTS_ENABLED ? supabase.from('places').select('*') : Promise.resolve({ data: [] }),
      supabase
        .from('shopping_items')
        .select('id', { count: 'exact', head: true })
        .eq('added_by', email)
        .gte('created_at', dayStart),
    ])
    const entries = (en.data ?? []) as EntryLite[]
    const monthIds = [...new Set(entries.map((e) => e.month_id))]
    const mo = monthIds.length ? await supabase.from('months').select('id, budget_id').in('id', monthIds) : { data: [] }
    const budgetOf = Object.fromEntries(((mo.data ?? []) as { id: string; budget_id: string }[]).map((m) => [m.id, m.budget_id]))
    return {
      budgetOf,
      events: (ev.data ?? []) as CalendarEvent[],
      entries,
      customCats: (cc.data ?? []) as CustomCategory[],
      location: (loc.data as MemberLocation | null) ?? null,
      places: (pl.data ?? []) as Place[],
      shoppingToday: sh.count ?? 0,
    }
  })

  useFocusEffect(
    useCallback(() => {
      void revalidate()
    }, [revalidate]),
  )

  const todaysOcc = useMemo(
    () => [...(occurrencesByDay(data.events, today, today).get(today) ?? [])].sort(compareOccurrences),
    [data.events, today],
  )
  const next = useMemo(
    () => (todaysOcc.length ? null : upcomingOccurrences(data.events, today, 60).find((o) => o.start > today) ?? null),
    [data.events, today, todaysOcc.length],
  )

  const expenses = data.entries.filter((e) => e.type === 'expense')
  /** The screen an entry was logged on — and, `open`, with its form open. */
  const entryPath = (e: EntryLite, open: boolean) => {
    const b = data.budgetOf[e.month_id]
    return b ? `/budget/${b}/${e.month_id}${open ? `?entry=${e.id}` : ''}` : '/budget'
  }
  const todayExp = expenses.filter((e) => e.entry_date === today)
  const todayTotal = todayExp.reduce((s, e) => s + Number(e.amount), 0)
  const weekTotal = expenses.reduce((s, e) => s + Number(e.amount), 0)

  const loc = data.location
  const live = isSharingLive(loc) ? loc : null
  const place = live ? placeAt(data.places, { lat: live.lat, lng: live.lng }) : null

  const tile = {
    backgroundColor: c.card,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    padding: 14,
    gap: 10,
  }


  return (
    <View style={{ gap: sp.md }}>
      <Txt
        style={{
          fontFamily: fonts.semibold,
          fontSize: 12,
          letterSpacing: 1.1,
          textTransform: 'uppercase',
          color: c.textMuted,
          marginTop: sp.sm,
        }}
      >
        {t('family.todayFor', { name: firstName })}
      </Txt>

      {/* Agenda */}
      <Pressable
        // Opens the day it's showing: today, or the day of the "Next" event.
        onPress={() => router.push(`/calendar?date=${todaysOcc.length || !next ? today : next.start}`)}
        accessibilityRole="button"
        style={({ pressed }) => [tile, { opacity: pressed ? 0.75 : 1 }]}
      >
        <Head
          icon={CalendarDays}
          colors={APP_GRADIENT.calendar}
          title={t('family.todayAgenda')}
          right={todaysOcc.length ? String(todaysOcc.length) : undefined}
        />
        {todaysOcc.length ? (
          <View style={{ gap: 8 }}>
            {todaysOcc.slice(0, MAX_EVENTS).map((o) => {
              const ev = o.event
              const years = ev.kind === 'birthday' || ev.kind === 'anniversary' ? yearsAt(ev, o.start) : 0
              const when = ev.all_day
                ? t('calendar.allDay')
                : ev.start_time
                  ? formatTime(ev.start_time, locale)
                  : ''
              const sub =
                ev.kind === 'birthday' && years > 0
                  ? t('home.turns', { n: years })
                  : ev.kind === 'anniversary' && years > 0
                    ? t('home.years', { n: years })
                    : ev.location
              // Whole-household events read "Everyone" so they don't look like theirs alone.
              const subLine = ev.owner_email ? sub : [sub, t('calendar.everyone')].filter(Boolean).join(' · ')
              return (
                <View key={`${ev.id}:${o.start}`} style={{ flexDirection: 'row', gap: sp.md, alignItems: 'flex-start' }}>
                  <Txt style={{ width: 74, color: c.textMuted, fontSize: 13.5, fontFamily: fonts.semibold, paddingTop: 1 }} numberOfLines={1}>
                    {when}
                  </Txt>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt style={{ fontSize: 15 }} numberOfLines={1}>
                      {ev.kind !== 'event' ? `${KIND_EMOJI[ev.kind]} ` : ''}
                      {ev.title}
                    </Txt>
                    {subLine ? (
                      <Txt style={{ color: c.textMuted, fontSize: 12.5 }} numberOfLines={1}>
                        {subLine}
                      </Txt>
                    ) : null}
                  </View>
                </View>
              )
            })}
            {todaysOcc.length > MAX_EVENTS ? (
              <Muted text={t('family.todayMore', { n: todaysOcc.length - MAX_EVENTS })} />
            ) : null}
          </View>
        ) : (
          <View style={{ gap: 2 }}>
            <Muted text={t('family.todayNoEvents')} />
            {next ? (
              <Txt style={{ fontSize: 14 }} numberOfLines={1}>
                {t('family.todayNext', { title: next.event.title, date: formatDay(next.start) })}
              </Txt>
            ) : null}
          </View>
        )}
      </Pressable>

      {/* Money */}
      <Pressable
        // The period today's latest expense was logged in; else the money app.
        onPress={() => router.push((todayExp[0] ? entryPath(todayExp[0], false) : '/budget') as never)}
        accessibilityRole="button"
        style={({ pressed }) => [tile, { opacity: pressed ? 0.75 : 1 }]}
      >
        <Head
          icon={Wallet}
          colors={APP_GRADIENT.budget}
          title={t('family.todaySpent')}
          right={todayExp.length ? formatMoney(todayTotal) : undefined}
        />
        {todayExp.length ? (
          <View style={{ gap: 8 }}>
            {todayExp.slice(0, MAX_ENTRIES).map((e) => (
              <Pressable
                key={e.id}
                onPress={() => router.push(entryPath(e, true) as never)}
                accessibilityRole="button"
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: sp.md, opacity: pressed ? 0.6 : 1 })}
              >
                <Txt style={{ width: 22, textAlign: 'center', fontSize: 16 }}>
                  {categoryById(e.category, data.customCats).icon}
                </Txt>
                <Txt style={{ flex: 1, fontSize: 15 }} numberOfLines={1}>
                  {e.label}
                </Txt>
                <Txt style={{ fontSize: 15, fontFamily: fonts.semibold }}>{formatMoney(Number(e.amount))}</Txt>
              </Pressable>
            ))}
            {todayExp.length > MAX_ENTRIES ? (
              <Muted text={t('family.todayMore', { n: todayExp.length - MAX_ENTRIES })} />
            ) : null}
          </View>
        ) : (
          <Muted text={t('family.todayNoSpend')} />
        )}
        {weekTotal > 0 ? (
          <Txt style={{ color: c.textMuted, fontSize: 12.5 }}>
            {t('family.todayWeek', { amount: formatMoney(weekTotal) })}
          </Txt>
        ) : null}
      </Pressable>

      {/* Whereabouts — only when they share */}
      {WHEREABOUTS_ENABLED && (live || isPaused(loc)) ? (
        <Pressable
          onPress={() => router.push('/location')}
          accessibilityRole="button"
          style={({ pressed }) => [tile, { opacity: pressed ? 0.75 : 1 }]}
        >
          <Head
            icon={MapPin}
            colors={APP_GRADIENT.location}
            title={
              live
                ? place
                  ? `${place.icon ? `${place.icon} ` : ''}${place.name}`
                  : t('family.todaySeen')
                : t('family.todayPaused')
            }
          />
          {live ? (
            <Muted
              text={[
                agoText(live.updated_at, t),
                live.battery != null ? `🔋 ${Math.round(live.battery)}%` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            />
          ) : null}
        </Pressable>
      ) : null}

      {/* Shopping list */}
      {data.shoppingToday > 0 ? (
        <Pressable
          onPress={() => router.push('/shopping')}
          accessibilityRole="button"
          style={({ pressed }) => [tile, { opacity: pressed ? 0.75 : 1 }]}
        >
          <Head
            icon={ShoppingCart}
            colors={APP_GRADIENT.shopping}
            title={t('family.todayShopping', { n: data.shoppingToday })}
          />
        </Pressable>
      ) : null}
    </View>
  )
}
