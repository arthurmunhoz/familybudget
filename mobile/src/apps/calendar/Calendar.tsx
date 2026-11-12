// Shared Calendar — Day / Week / Month (2026-11; the old "Upcoming" list is
// gone). One anchor date (`selected`) drives all three views:
// - Month: the 7-column grid (colour dots per day) + the selected day's events
//   in detail (time range, who, place, notes); on wide screens (≥ 760 pt —
//   iPad, the iPad app on a Mac) the list sits BESIDE the grid.
// - Week: 7 day columns on an hour grid (TimeGrid), all-day strip on top;
//   tapping a day header opens that Day.
// - Day: one column on the hour grid, all-day strip on top, a "now" line on
//   today, and a week strip above to hop between days.
// Swiping sideways (SwipePager) or the chevrons move one day / week / month.
// Tapping an event opens the editor; tapping an empty slot in Day/Week creates
// an event at that half hour (the all-day strip → an all-day event).
// Recurrence is expanded via occurrencesByDay; events are coloured by owner.
// Google/Apple-sourced rows (source !== 'oneroof') render read-only.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { APP_GRADIENT } from '@/components/home/palette'
import { Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { CalendarDays, ChevronLeft, ChevronRight, MapPin } from 'lucide-react-native'

import { Loader, NewItemButton, Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { useToday } from '@/hooks/useToday'
import { daysBetweenISO } from '@/lib/format'
import {
  addDays,
  compareOccurrences,
  eventColor,
  formatTime,
  KIND_EMOJI,
  occurrencesByDay,
  upcomingOccurrences,
  yearsAt,
  type Occurrence,
} from '@/lib/calendar'
import { track } from '@/lib/analytics'
import { supabase } from '@/lib/supabase'
import { channelName } from '@/lib/realtime'
import type { CalendarEvent } from '@/lib/types'
import { fonts, radius, sp, useTheme } from '@/theme/theme'
import { getGoogleConnection } from '@/lib/googleCalendar'
import { getAppleConnection, isAppleCalendarAvailable, syncAppleCalendar } from '@/lib/appleCalendar'
import EventForm, { type EventDraft } from './EventForm'
import { GoogleIcon } from './GoogleIcon'
import { AppleIcon } from './AppleIcon'
import { minutesToHHMM, weekStart } from './calendarLayout'
import { SwipePager, type PagerHandle } from './SwipePager'
import { TimeGrid } from './TimeGrid'

// App language → BCP-47 locale for Intl date/time formatting.
const LOCALES: Record<string, string> = { en: 'en', es: 'es', pt: 'pt-BR' }
/** Width from which the layout uses the room: month list beside the grid,
 *  roomier hour grid. iPad (both orientations) and the iPad app on a Mac. */
const WIDE = 760

type Mode = 'day' | 'week' | 'month'
const MODES: { id: Mode; label: TKey }[] = [
  { id: 'day', label: 'calendar.tabDay' },
  { id: 'week', label: 'calendar.tabWeek' },
  { id: 'month', label: 'calendar.tabMonth' },
]

const pad = (n: number) => String(n).padStart(2, '0')
const toDate = (iso: string) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function emptyDraft(start: string, owner: string | null): EventDraft {
  return {
    title: '',
    allDay: true,
    start,
    end: start,
    startTime: '09:00',
    endTime: '10:00',
    owner,
    kind: 'event',
    repeat: 'none',
    remind: false,
    location: '',
    notes: '',
  }
}

export default function Calendar() {
  const { c } = useTheme()
  const { t, lang } = useI18n()
  const { profile, profiles } = useAuth()
  const { width } = useWindowDimensions()
  const wide = width >= WIDE
  const locale = LOCALES[lang] ?? 'en'
  // Drives "today" everywhere — silently wrong if captured once and the app
  // then sits open (or suspended) across midnight. See useToday.
  const today = useToday()
  const memberEmails = useMemo(() => profiles.map((p) => p.email), [profiles])
  const ownerName = (email: string) => profiles.find((p) => p.email === email)?.display_name ?? email

  const {
    data: events = [],
    loading,
    revalidate: load,
  } = useCachedQuery<CalendarEvent[]>('calendar', async () => {
    const { data } = await supabase.from('calendar_events').select('*')
    return (data ?? []) as CalendarEvent[]
  })

  useEffect(() => {
    // Realtime: refetch when any household row changes (RLS scopes the stream).
    const channel = supabase
      .channel(channelName('calendar_events'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_events' }, load)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load])

  // Colors the header Google button: full-color when a Google account is linked,
  // grey otherwise. Re-checked on focus so it updates after connect/disconnect.
  const [googleConnected, setGoogleConnected] = useState(false)
  useFocusEffect(
    useCallback(() => {
      let active = true
      getGoogleConnection().then((v) => {
        if (active) setGoogleConnected(!!v)
      })
      return () => {
        active = false
      }
    }, []),
  )

  // Apple Calendar is on-device (EventKit). Color the header button, and when
  // linked, sync on open so pulled device events stay fresh, then refresh.
  const [appleConnected, setAppleConnected] = useState(false)
  useFocusEffect(
    useCallback(() => {
      let active = true
      getAppleConnection().then((v) => {
        if (!active) return
        setAppleConnected(!!v)
        if (v) {
          syncAppleCalendar()
            .then(() => {
              if (active) load()
            })
            .catch(() => {})
        }
      })
      return () => {
        active = false
      }
    }, [load]),
  )

  // `?date=YYYY-MM-DD` opens on that day (the assistant's "Open in Calendar"
  // for "what's on tomorrow" landed on today, 2026-11) — in the Day view.
  const { date: dateParam } = useLocalSearchParams<{ date?: string }>()
  const deepDay = typeof dateParam === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : null
  const [selected, setSelected] = useState(deepDay ?? today)
  const [mode, setMode] = useState<Mode>(deepDay ? 'day' : 'month')
  // A second deep link while the screen is already mounted (Calendar → Home →
  // ask → Open in Calendar again) must move it too.
  useEffect(() => {
    if (!deepDay) return
    // Syncing from the route param (a new deep link), not derivable state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(deepDay)
    setMode('day')
  }, [deepDay])
  const pager = useRef<PagerHandle>(null)

  // --- the visible period ---
  const sy = Number(selected.slice(0, 4))
  const sm = Number(selected.slice(5, 7))
  const monthStart = `${sy}-${pad(sm)}-01`
  const monthEnd = `${sy}-${pad(sm)}-${pad(new Date(sy, sm, 0).getDate())}`
  const ws = weekStart(selected)
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(ws, i)), [ws])
  const pageKey = mode === 'month' ? monthStart : mode === 'week' ? ws : selected

  // Occurrences (recurrence expanded + multi-day spread). Month needs the month;
  // Week and Day need the week (Day's strip shows the week's dots).
  const [rangeStart, rangeEnd] = mode === 'month' ? [monthStart, monthEnd] : [ws, weekDays[6]]
  const byDay = useMemo(() => occurrencesByDay(events, rangeStart, rangeEnd), [events, rangeStart, rangeEnd])
  const dayOccs: Occurrence[] = useMemo(() => [...(byDay.get(selected) ?? [])].sort(compareOccurrences), [byDay, selected])

  // the faded state line under the title: how the next week looks
  const upcoming = useMemo(() => upcomingOccurrences(events, today, 7), [events, today])
  const soonCount = upcoming.filter((o) => daysBetweenISO(today, o.start) <= 7).length
  const stateLine =
    soonCount === 0 ? t('calendar.stateNone') : soonCount === 1 ? t('calendar.stateOne') : t('calendar.stateMany', { n: soonCount })

  function shift(dir: 1 | -1) {
    if (mode === 'day') setSelected((s) => addDays(s, dir))
    else if (mode === 'week') {
      // Land on today when the new week holds it, so Day opens on today.
      const next = addDays(selected, 7 * dir)
      setSelected(weekStart(next) === weekStart(today) ? today : next)
    }
    else {
      // Land on today when it's in the new month, else on the 1st — so the
      // list under the grid always belongs to the month on screen.
      const d = new Date(sy, sm - 1 + dir, 1)
      const first = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`
      setSelected(today.slice(0, 7) === first.slice(0, 7) ? today : first)
    }
  }

  const periodLabel = (() => {
    if (mode === 'month') return cap(toDate(selected).toLocaleDateString(locale, { month: 'long', year: 'numeric' }))
    if (mode === 'day')
      return cap(toDate(selected).toLocaleDateString(locale, { weekday: wide ? 'long' : 'short', month: 'long', day: 'numeric' }))
    const opts = { month: 'short', day: 'numeric' } as const
    const a = toDate(weekDays[0]).toLocaleDateString(locale, opts).replace('.', '')
    const b = toDate(weekDays[6]).toLocaleDateString(locale, opts).replace('.', '')
    return `${cap(a)} – ${b}`
  })()
  const showToday = mode === 'week' ? !weekDays.includes(today) : selected !== today

  // --- add / edit form ---
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<CalendarEvent | null>(null)
  const [draft, setDraft] = useState<EventDraft>(() => emptyDraft(today, null))

  function openNew(day = selected, at?: number) {
    setEditing(null)
    const d = emptyDraft(day, profile?.email ?? null)
    if (at != null) {
      d.allDay = false
      d.startTime = minutesToHHMM(at)
      d.endTime = minutesToHHMM(Math.min(at + 60, 23 * 60 + 59))
    }
    setDraft(d)
    setShowForm(true)
  }

  function openEdit(ev: CalendarEvent) {
    // Externally-sourced rows (Google / Apple device calendar) are read-only —
    // surface them but don't open the editor.
    if (ev.source !== 'oneroof') return
    setEditing(ev)
    setDraft({
      title: ev.title,
      allDay: ev.all_day,
      start: ev.start_date,
      end: ev.end_date,
      startTime: ev.start_time?.slice(0, 5) ?? '09:00',
      endTime: ev.end_time?.slice(0, 5) ?? '10:00',
      owner: ev.owner_email,
      kind: ev.kind,
      repeat: ev.recurrence,
      remind: ev.reminder_minutes != null,
      location: ev.location ?? '',
      notes: ev.notes ?? '',
    })
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditing(null)
  }

  async function remove(ev: CalendarEvent) {
    await supabase.from('calendar_events').delete().eq('id', ev.id)
    track('calendar.deleted', { title: ev.title })
    load()
  }

  const red = APP_GRADIENT.calendar as [string, string]
  const tint = red[1]
  const gutterX = wide ? sp.xl : sp.lg

  // Week columns narrower than this get the compact look (titles only).
  const contentW = width - gutterX * 2
  const compactWeek = (contentW - 52) / 7 < 84
  const hourHeight = wide ? 60 : mode === 'day' ? 56 : 48

  const roundBtn = {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    backgroundColor: c.card,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  }

  // --- the selected day's events, in detail (Month) ---
  const dayList = (
    <View style={{ gap: sp.sm }}>
      <Txt style={[styles.section, { color: c.textMuted }]}>
        {toDate(selected).toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric' })}
      </Txt>
      {dayOccs.length === 0 ? (
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border, alignItems: 'center', gap: 4, paddingVertical: sp.xl }]}>
          <CalendarDays size={24} color={c.textFaint} />
          <Txt style={{ fontFamily: fonts.display, fontSize: 17, color: c.text, marginTop: 4 }}>{t('calendar.empty')}</Txt>
          <Txt variant="faint">{t('calendar.emptyHint')}</Txt>
        </View>
      ) : (
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          {dayOccs.map((o, i) => {
            const ev = o.event
            const span =
              o.start !== o.end
                ? `${toDate(o.start).toLocaleDateString(locale, { month: 'short', day: 'numeric' }).replace('.', '')} – ${toDate(o.end)
                    .toLocaleDateString(locale, { month: 'short', day: 'numeric' })
                    .replace('.', '')}`
                : ''
            const when = ev.all_day
              ? span || t('calendar.allDay')
              : `${ev.start_time ? formatTime(ev.start_time, locale) : ''}${ev.end_time ? ` – ${formatTime(ev.end_time, locale)}` : ''}${span ? ` · ${span}` : ''}`
            const age = ev.kind === 'birthday' || ev.kind === 'anniversary' ? yearsAt(ev, o.start) : 0
            return (
              <EventRow
                key={`${ev.id}:${o.start}`}
                first={i === 0}
                color={eventColor(ev, memberEmails)}
                emoji={KIND_EMOJI[ev.kind]}
                time={ev.all_day ? null : ev.start_time ? formatTime(ev.start_time, locale) : null}
                allDayLabel={t('calendar.allDay')}
                title={ev.title}
                when={[when, age > 0 ? t('calendar.turns', { years: age }) : ''].filter(Boolean).join(' · ')}
                who={ev.owner_email ? ownerName(ev.owner_email) : t('calendar.everyone')}
                location={ev.location}
                notes={ev.notes}
                onPress={() => openEdit(ev)}
              />
            )
          })}
        </View>
      )}
    </View>
  )

  // --- the month grid ---
  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: 'narrow' })
    // 2023-01-01 is a Sunday → label columns Sun…Sat.
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2023, 0, 1 + i)))
  }, [locale])
  const firstDow = new Date(sy, sm - 1, 1).getDay()
  const dim = new Date(sy, sm, 0).getDate()
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: dim }, (_, i) => i + 1)]
  const cellH = wide ? 58 : 48

  const monthGrid = (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border, padding: sp.md }]}>
      <View style={{ flexDirection: 'row' }}>
        {weekdays.map((w, i) => (
          <View key={i} style={{ flex: 1, alignItems: 'center', paddingBottom: 6 }}>
            <Txt style={{ fontSize: 11, fontFamily: fonts.semibold, color: c.textFaint }}>{w}</Txt>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {cells.map((day, i) => {
          if (day === null) return <View key={`b${i}`} style={{ width: `${100 / 7}%`, height: cellH }} />
          const dateStr = `${sy}-${pad(sm)}-${pad(day)}`
          const occs = byDay.get(dateStr)
          const isToday = dateStr === today
          const isSelected = dateStr === selected
          return (
            <Pressable
              key={day}
              onPress={() => setSelected(dateStr)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={toDate(dateStr).toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric' })}
              style={{ width: `${100 / 7}%`, height: cellH, alignItems: 'center', justifyContent: wide ? 'center' : 'flex-start' }}
            >
              <DayCircle day={day} selected={isSelected} today={isToday} red={red} tint={tint} />
              <View style={{ flexDirection: 'row', gap: 2, marginTop: 3, height: 5 }}>
                {occs?.slice(0, 3).map((o, j) => (
                  <View key={j} style={{ height: 5, width: 5, borderRadius: 3, backgroundColor: eventColor(o.event, memberEmails) }} />
                ))}
              </View>
            </Pressable>
          )
        })}
      </View>
    </View>
  )

  // --- Day: the week strip to hop between days ---
  const weekStrip = (
    <View style={{ flexDirection: 'row' }}>
      {weekDays.map((d) => {
        const occs = byDay.get(d)
        return (
          <Pressable
            key={d}
            onPress={() => setSelected(d)}
            accessibilityRole="button"
            accessibilityState={{ selected: d === selected }}
            accessibilityLabel={toDate(d).toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric' })}
            style={{ flex: 1, alignItems: 'center', gap: 2 }}
          >
            <Txt style={{ fontSize: 11, fontFamily: fonts.semibold, color: d === today ? tint : c.textFaint }}>{weekdays[toDate(d).getDay()]}</Txt>
            <DayCircle day={Number(d.slice(8, 10))} selected={d === selected} today={d === today} red={red} tint={tint} />
            <View style={{ flexDirection: 'row', gap: 2, height: 5 }}>
              {occs?.slice(0, 3).map((o, j) => (
                <View key={j} style={{ height: 5, width: 5, borderRadius: 3, backgroundColor: eventColor(o.event, memberEmails) }} />
              ))}
            </View>
          </Pressable>
        )
      })}
    </View>
  )

  const grid = (days: string[], compact: boolean) => (
    <TimeGrid
      key={mode}
      days={days}
      byDay={byDay}
      today={today}
      locale={locale}
      memberEmails={memberEmails}
      hourHeight={hourHeight}
      compact={compact}
      tint={tint}
      onEventPress={openEdit}
      onSlotPress={(d, min) => openNew(d, min)}
      onAllDayPress={(d) => openNew(d)}
      onDayPress={(d) => {
        setSelected(d)
        setMode('day')
      }}
    />
  )

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      {/* Home-style top bar: round back; Google / Apple sync as round buttons */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, paddingHorizontal: gutterX, paddingVertical: sp.sm }}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          style={({ pressed }) => [roundBtn, { opacity: pressed ? 0.7 : 1 }]}
        >
          <ChevronLeft size={22} color={c.text} />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={() => router.push('/google-calendar')}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('calendar.google')}
          style={({ pressed }) => [roundBtn, { opacity: pressed ? 0.7 : 1 }]}
        >
          <GoogleIcon size={18} color={googleConnected ? undefined : c.textFaint} />
        </Pressable>
        {isAppleCalendarAvailable ? (
          <Pressable
            onPress={() => router.push('/apple-calendar')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('calendar.apple')}
            style={({ pressed }) => [roundBtn, { opacity: pressed ? 0.7 : 1 }]}
          >
            <AppleIcon size={17} color={appleConnected ? c.text : c.textFaint} />
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <Loader />
      ) : (
        <View style={{ flex: 1, paddingHorizontal: gutterX, gap: sp.md }}>
          {/* big title, state faded under it — the Home's voice. Title and
              segmented side by side on wide screens. */}
          <View style={wide ? { flexDirection: 'row', alignItems: 'flex-end', gap: sp.lg } : { gap: sp.md }}>
            <View style={wide ? { flex: 1 } : undefined}>
              <Txt style={{ fontFamily: fonts.display, fontSize: 36, lineHeight: 42, letterSpacing: -0.8, color: c.text }}>{t('calendar.title')}</Txt>
              <Txt style={{ fontFamily: fonts.display, fontSize: 20, lineHeight: 26, color: c.textFaint }}>{stateLine}</Txt>
            </View>

            {/* Day · Week · Month */}
            <View style={{ flexDirection: 'row', backgroundColor: c.surface, borderRadius: radius.pill, padding: 4, gap: 4, width: wide ? 360 : undefined }}>
              {MODES.map((m) => {
                const active = mode === m.id
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => setMode(m.id)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    style={{
                      flex: 1,
                      alignItems: 'center',
                      paddingVertical: 9,
                      borderRadius: radius.pill,
                      // Opaque on Android — elevation under a translucent fill shows through it.
                      backgroundColor: active ? (Platform.OS === 'android' ? c.sheet : c.card) : 'transparent',
                      ...(active ? { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 } : {}),
                    }}
                  >
                    <Txt style={{ color: active ? c.text : c.textMuted, fontFamily: fonts.semibold, fontSize: 14.5 }}>{t(m.label)}</Txt>
                  </Pressable>
                )
              })}
            </View>
          </View>

          {/* the period: label, Today, previous / next */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
            <Txt numberOfLines={1} style={{ flex: 1, fontFamily: fonts.display, fontSize: 21, lineHeight: 26, color: c.text, paddingLeft: 2 }}>
              {periodLabel}
            </Txt>
            {showToday ? (
              <Pressable
                onPress={() => setSelected(today)}
                hitSlop={6}
                accessibilityRole="button"
                style={({ pressed }) => [styles.todayPill, { backgroundColor: tint + '1F', opacity: pressed ? 0.7 : 1 }]}
              >
                <Txt style={{ fontSize: 13, fontFamily: fonts.semibold, color: tint }}>{t('calendar.today')}</Txt>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => pager.current?.go(-1)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('calendar.previous')}
              style={({ pressed }) => [styles.navBtn, { backgroundColor: c.surface, opacity: pressed ? 0.7 : 1 }]}
            >
              <ChevronLeft size={18} color={c.text} />
            </Pressable>
            <Pressable
              onPress={() => pager.current?.go(1)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('calendar.next')}
              style={({ pressed }) => [styles.navBtn, { backgroundColor: c.surface, opacity: pressed ? 0.7 : 1 }]}
            >
              <ChevronRight size={18} color={c.text} />
            </Pressable>
          </View>

          {mode === 'day' ? weekStrip : null}

          <SwipePager ref={pager} pageKey={pageKey} onShift={shift}>
            {mode === 'month' ? (
              wide ? (
                <View style={{ flex: 1, flexDirection: 'row', gap: sp.lg }}>
                  <View style={{ width: Math.min(520, contentW * 0.52) }}>{monthGrid}</View>
                  <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: sp.md }} showsVerticalScrollIndicator={false}>
                    {dayList}
                  </ScrollView>
                </View>
              ) : (
                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: sp.md, gap: sp.md }} showsVerticalScrollIndicator={false}>
                  {monthGrid}
                  {dayList}
                </ScrollView>
              )
            ) : mode === 'week' ? (
              grid(weekDays, compactWeek)
            ) : (
              grid([selected], false)
            )}
          </SwipePager>
        </View>
      )}

      {/* Bottom action in NORMAL flow — the branch above is flex:1, so this
          stays pinned to the bottom and the content ends AT it, never under it. */}
      <NewItemButton label={t('calendar.addBtn')} onPress={() => openNew()} colors={APP_GRADIENT.calendar} />

      {showForm && (
        <EventForm
          draft={draft}
          setDraft={setDraft}
          editing={editing}
          profiles={profiles}
          memberEmails={memberEmails}
          locale={locale}
          onClose={closeForm}
          onSaved={(savedStart) => {
            setSelected(savedStart)
            closeForm()
            load()
          }}
          onDelete={remove}
        />
      )}
    </SafeAreaView>
  )
}

/** A day number: selected = Calendar-red gradient circle, today = soft red. */
function DayCircle({ day, selected, today, red, tint }: { day: number; selected: boolean; today: boolean; red: [string, string]; tint: string }) {
  const { c } = useTheme()
  if (selected) {
    return (
      <GradientBox colors={red} radius={17} style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}>
        <Txt style={{ fontSize: 14.5, color: '#fff', fontFamily: fonts.semibold }}>{day}</Txt>
      </GradientBox>
    )
  }
  return (
    <View style={{ height: 34, width: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: today ? tint + '1F' : 'transparent' }}>
      <Txt style={{ fontSize: 14.5, color: today ? tint : c.text, fontFamily: today ? fonts.semibold : fonts.body }}>{day}</Txt>
    </View>
  )
}

/** One event as a row of the day's card: the start time (or the kind's emoji)
 *  in a tile tinted with the owner's colour, the title, when (range / span /
 *  "turns N"), who (with their colour dot), the place and the first line of
 *  the notes. */
function EventRow({
  first,
  color,
  emoji,
  time,
  allDayLabel,
  title,
  when,
  who,
  location,
  notes,
  onPress,
}: {
  first: boolean
  color: string
  emoji?: string
  /** "5:00 PM" for a timed event; null = all day. */
  time: string | null
  allDayLabel: string
  title: string
  when: string
  who: string
  location?: string | null
  notes?: string | null
  onPress: () => void
}) {
  const { c, dark } = useTheme()
  const [hm, ampm] = time ? time.split(/\s/u) : [null, null]
  const note = notes?.split('\n').find((l) => l.trim())
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: sp.md,
        paddingHorizontal: sp.md,
        paddingVertical: 12,
        borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
        borderTopColor: c.border,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View style={{ width: 52, minHeight: 48, borderRadius: 14, backgroundColor: color + (dark ? '33' : '1F'), alignItems: 'center', justifyContent: 'center', paddingVertical: 6 }}>
        {emoji ? (
          <Txt style={{ fontSize: 22 }}>{emoji}</Txt>
        ) : time ? (
          <>
            <Txt style={{ fontFamily: fonts.semibold, fontSize: 14, color }}>{hm}</Txt>
            {ampm ? <Txt style={{ fontSize: 10, fontFamily: fonts.semibold, color }}>{ampm}</Txt> : null}
          </>
        ) : (
          <Txt style={{ fontSize: 10.5, fontFamily: fonts.semibold, color, textAlign: 'center' }} numberOfLines={2}>
            {allDayLabel}
          </Txt>
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt style={{ fontFamily: fonts.display, fontSize: 16.5, lineHeight: 21, color: c.text }} numberOfLines={2}>
          {title}
        </Txt>
        <Txt variant="muted" style={{ fontSize: 13 }} numberOfLines={1}>
          {when}
        </Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
          <Txt variant="faint" style={{ fontSize: 13, flexShrink: 1 }} numberOfLines={1}>
            {who}
          </Txt>
        </View>
        {location ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <MapPin size={12} color={c.textMuted} />
            <Txt variant="muted" style={{ fontSize: 13, flexShrink: 1 }} numberOfLines={1}>
              {location}
            </Txt>
          </View>
        ) : null}
        {note ? (
          <Txt variant="faint" style={{ fontSize: 13 }} numberOfLines={1}>
            {note}
          </Txt>
        ) : null}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  section: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase', marginTop: sp.xs, paddingHorizontal: 2 },
  todayPill: { paddingHorizontal: 12, height: 32, borderRadius: 16, justifyContent: 'center' },
  navBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
})
