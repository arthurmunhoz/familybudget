// The hour grid behind the Calendar's Day and Week views: one column per day
// (1 for Day, 7 for Week), an hour gutter on the left, an all-day strip on top,
// timed events drawn at their times (overlaps side by side — calendarLayout),
// and a Calendar-red "now" line across today. Tapping an event opens it;
// tapping an empty slot asks to create one at that half hour; tapping the
// all-day strip of a day creates an all-day event. In Week, tapping a day's
// header opens that day.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View, type GestureResponderEvent } from 'react-native'

import { Check } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { eventColor, formatTime, KIND_EMOJI, type Occurrence } from '@/lib/calendar'
import type { CalendarEvent } from '@/lib/types'
import { fonts, useTheme } from '@/theme/theme'
import { allDayRows, layoutColumns, timedBlocks } from './calendarLayout'

const ALLDAY_ROW = 24
const ALLDAY_MAX_ROWS = 3
const TOP_PAD = 10
/** One line of title + padding. */
const BLOCK_MIN_PX = 24 // room for the 00:00 label above the first line

const hm = (t: string | null) => {
  if (!t) return 0
  const [h, m] = t.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** "✓ Ended" — the note on a block that's already over. */
function EndedTag({ label, color }: { label: string; color: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      <Check size={11} color={color} strokeWidth={3} />
      <Txt style={{ fontSize: 11.5, lineHeight: 15, fontFamily: fonts.semibold, color }}>{label}</Txt>
    </View>
  )
}

function nowMinutes() {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}

/** Minutes since midnight, refreshed every 30 s while mounted. */
function useNowMinutes() {
  const [now, setNow] = useState(nowMinutes)
  useEffect(() => {
    const id = setInterval(() => setNow(nowMinutes()), 30_000)
    return () => clearInterval(id)
  }, [])
  return now
}

export function TimeGrid({
  days,
  byDay,
  today,
  locale,
  memberEmails,
  hourHeight,
  compact,
  tint,
  onEventPress,
  onSlotPress,
  onAllDayPress,
  onDayPress,
  fit,
}: {
  days: string[]
  byDay: Map<string, Occurrence[]>
  today: string
  locale: string
  memberEmails: string[]
  hourHeight: number
  /** narrow columns (Week on a phone): smaller type, titles only */
  compact: boolean
  tint: string
  onEventPress: (ev: CalendarEvent) => void
  onSlotPress: (day: string, minutes: number) => void
  onAllDayPress: (day: string) => void
  /** Week only: tap a day header → open that day */
  onDayPress?: (day: string) => void
  /** Day only (Home's "family's day"): shrink the hours so the span holding
   *  the timed events fits the screen, and open scrolled to its start. */
  fit?: boolean
}) {
  const { c, dark } = useTheme()
  const { t, lang } = useI18n()
  const now = useNowMinutes()
  const gutter = compact ? 40 : 52
  const multi = days.length > 1
  const showNow = days.includes(today)
  const [viewH, setViewH] = useState(0)

  // --- all-day bars across the visible days ---
  const allDay = useMemo(() => {
    const occs: Occurrence[] = []
    for (const d of days) for (const o of byDay.get(d) ?? []) occs.push(o)
    return allDayRows(occs, days)
  }, [days, byDay])
  const rowCount = allDay.reduce((m, b) => Math.max(m, b.row + 1), 0)
  const overflow = rowCount > ALLDAY_MAX_ROWS
  const shownRows = overflow ? ALLDAY_MAX_ROWS - 1 : rowCount
  // per-day count of bars that didn't fit
  const hidden = days.map((_, i) => allDay.filter((b) => b.row >= shownRows && b.from <= i && b.to >= i).length)
  const stripRows = overflow ? ALLDAY_MAX_ROWS : rowCount

  // --- timed blocks per day ---
  const baseBlocks = useMemo(() => days.map((d) => timedBlocks(byDay.get(d) ?? [], d)), [days, byDay])

  // --- fit: the whole hours from the first event's start to the last's end ---
  const fitSpan = useMemo(() => {
    if (!fit) return null
    const all = baseBlocks.flat()
    if (!all.length) return null
    const from = Math.floor(Math.min(...all.map((b) => b.start)) / 60) * 60
    const to = Math.ceil(Math.max(...all.map((b) => b.end)) / 60) * 60
    return { from, to: Math.max(to, from + 60) }
  }, [fit, baseBlocks])
  const H =
    fitSpan && viewH
      ? Math.max(26, Math.min(hourHeight, (viewH - TOP_PAD * 2) / ((fitSpan.to - fitSpan.from) / 60)))
      : hourHeight
  // The shortest a block is drawn: enough for one line of title (BLOCK_MIN_PX),
  // so a 30-min meeting on a squeezed grid isn't cut in half.
  const minMin = Math.max(30, Math.ceil((BLOCK_MIN_PX / H) * 60))
  const columns = useMemo(
    () => days.map((d) => layoutColumns(timedBlocks(byDay.get(d) ?? [], d, minMin))),
    [days, byDay, minMin],
  )

  // --- first scroll: an hour and a half before now on today, else just before
  //     the first event of the period, else 7:00 ---
  const scrollRef = useRef<ScrollView>(null)
  const scrolled = useRef(false)
  const initialY = (() => {
    if (fitSpan) return Math.max(0, (fitSpan.from / 60) * H)
    let min: number
    if (days.includes(today)) min = now - 90
    else {
      const starts = columns.flat().map((b) => b.start)
      min = starts.length ? Math.min(...starts) - 30 : 7 * 60
    }
    return Math.max(0, (Math.min(min, 16 * 60) / 60) * H)
  })()

  // Fit mode: scroll once the viewport is measured (H may not change the
  // content size, so onContentSizeChange can't be relied on for it).
  // Re-runs while the layout settles (the first measure can be taller than the
  // final one), until the person scrolls by hand.
  const dragged = useRef(false)
  useEffect(() => {
    if (!fitSpan || !viewH || dragged.current) return
    scrolled.current = true
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: initialY, animated: false }))
  }, [fitSpan, viewH, initialY])

  const hourLabel = (h: number) => {
    if (lang === 'en') {
      const h12 = h % 12 === 0 ? 12 : h % 12
      return `${h12} ${h < 12 ? 'AM' : 'PM'}`
    }
    return `${String(h).padStart(2, '0')}:00`
  }

  const slotPress = (day: string) => (e: GestureResponderEvent) => {
    const y = e.nativeEvent.locationY
    const min = Math.floor(((y / H) * 60) / 30) * 30
    onSlotPress(day, Math.max(0, Math.min(23 * 60 + 30, min)))
  }

  const weekdayFmt = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: compact ? 'narrow' : 'short' }), [locale, compact])
  const dayDate = (iso: string) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))

  const blockFill = (color: string) => color + (dark ? '47' : '2B')
  const title = (ev: CalendarEvent) => `${KIND_EMOJI[ev.kind] ? `${KIND_EMOJI[ev.kind]} ` : ''}${ev.title}`

  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      {/* Week: day headers (tap → that day) */}
      {multi ? (
        <View style={{ flexDirection: 'row', paddingLeft: gutter, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border }}>
          {days.map((d) => {
            const isToday = d === today
            return (
              <Pressable
                key={d}
                onPress={() => onDayPress?.(d)}
                accessibilityRole="button"
                accessibilityLabel={dayDate(d).toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric' })}
                style={({ pressed }) => ({ flex: 1, alignItems: 'center', paddingVertical: 8, gap: 3, opacity: pressed ? 0.6 : 1 })}
              >
                <Txt style={{ fontSize: 11, fontFamily: fonts.semibold, color: isToday ? tint : c.textFaint, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  {weekdayFmt.format(dayDate(d)).replace('.', '')}
                </Txt>
                <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: isToday ? tint : 'transparent' }}>
                  <Txt style={{ fontSize: 15, fontFamily: fonts.semibold, color: isToday ? '#fff' : c.text }}>{Number(d.slice(8, 10))}</Txt>
                </View>
              </Pressable>
            )
          })}
        </View>
      ) : null}

      {/* all-day strip */}
      {stripRows > 0 ? (
        <View style={{ flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border, paddingVertical: 4 }}>
          <View style={{ width: gutter, justifyContent: 'center', alignItems: 'flex-end', paddingRight: 6 }}>
            <Txt style={{ fontSize: compact ? 9.5 : 10.5, fontFamily: fonts.semibold, color: c.textFaint, textAlign: 'right' }} numberOfLines={2}>
              {t('calendar.allDay')}
            </Txt>
          </View>
          <View style={{ flex: 1, height: stripRows * ALLDAY_ROW }}>
            {/* empty-slot taps per day */}
            <View style={StyleSheet.absoluteFill}>
              <View style={{ flex: 1, flexDirection: 'row' }}>
                {days.map((d) => (
                  <Pressable key={d} onPress={() => onAllDayPress(d)} style={{ flex: 1 }} accessibilityLabel={t('calendar.newEvent')} />
                ))}
              </View>
            </View>
            {allDay
              .filter((b) => b.row < shownRows)
              .map((b) => {
                const color = eventColor(b.occ.event, memberEmails)
                return (
                  <View
                    key={`${b.occ.event.id}:${b.occ.start}`}
                    style={{
                      position: 'absolute',
                      top: b.row * ALLDAY_ROW,
                      height: ALLDAY_ROW - 3,
                      left: `${(b.from / days.length) * 100}%`,
                      width: `${((b.to - b.from + 1) / days.length) * 100}%`,
                      paddingHorizontal: 1.5,
                    }}
                  >
                    <Pressable
                      onPress={() => onEventPress(b.occ.event)}
                      accessibilityRole="button"
                      accessibilityLabel={b.occ.event.title}
                      style={({ pressed }) => ({ flex: 1, borderRadius: 6, backgroundColor: color, justifyContent: 'center', paddingHorizontal: compact ? 3 : 7, opacity: pressed ? 0.75 : 1 })}
                    >
                      <Txt numberOfLines={1} style={{ fontSize: compact ? 10.5 : 12, fontFamily: fonts.semibold, color: '#fff' }}>
                        {title(b.occ.event)}
                      </Txt>
                    </Pressable>
                  </View>
                )
              })}
            {overflow
              ? hidden.map((n, i) =>
                  n > 0 ? (
                    <View
                      key={`more${i}`}
                      pointerEvents="none"
                      style={{ position: 'absolute', top: shownRows * ALLDAY_ROW, height: ALLDAY_ROW - 3, left: `${(i / days.length) * 100}%`, width: `${100 / days.length}%`, justifyContent: 'center', paddingHorizontal: 4 }}
                    >
                      <Txt numberOfLines={1} style={{ fontSize: 10.5, fontFamily: fonts.semibold, color: c.textMuted }}>
                        {compact ? `+${n}` : t('calendar.moreEvents', { count: n })}
                      </Txt>
                    </View>
                  ) : null,
                )
              : null}
          </View>
        </View>
      ) : null}

      {/* the hours */}
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        onLayout={(e) => {
          if (fit) setViewH(e.nativeEvent.layout.height)
        }}
        onScrollBeginDrag={() => {
          dragged.current = true
        }}
        onContentSizeChange={() => {
          if (scrolled.current) return
          if (fitSpan && !viewH) return
          scrolled.current = true
          scrollRef.current?.scrollTo({ y: initialY, animated: false })
        }}
      >
        <View style={{ height: 24 * H + TOP_PAD * 2, flexDirection: 'row' }}>
          {/* gutter */}
          <View style={{ width: gutter }}>
            {Array.from({ length: 24 }, (_, h) => (
              <Txt
                key={h}
                style={{ position: 'absolute', top: TOP_PAD + h * H - 7, right: 6, fontSize: compact ? 10 : 11, lineHeight: 14, color: c.textFaint, fontFamily: fonts.medium }}
              >
                {h === 0 || (showNow && Math.abs(h * 60 - now) < 20) ? '' : hourLabel(h)}
              </Txt>
            ))}
          </View>

          <View style={{ flex: 1, marginTop: TOP_PAD, height: 24 * H }}>
            {/* hour lines */}
            {Array.from({ length: 25 }, (_, h) => (
              <View key={h} pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: h * H, height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />
            ))}
            {!compact
              ? Array.from({ length: 24 }, (_, h) => (
                  <View key={`h${h}`} pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: h * H + H / 2, height: StyleSheet.hairlineWidth, backgroundColor: c.border, opacity: 0.45 }} />
                ))
              : null}

            <View style={{ flex: 1, flexDirection: 'row' }}>
              {days.map((d, di) => {
                const isToday = d === today
                return (
                  <View key={d} style={{ flex: 1, borderLeftWidth: multi ? StyleSheet.hairlineWidth : 0, borderLeftColor: c.border, backgroundColor: multi && isToday ? tint + '0D' : 'transparent' }}>
                    <Pressable onPress={slotPress(d)} style={StyleSheet.absoluteFill} accessibilityLabel={t('calendar.newEvent')} />
                    {columns[di].map((b) => {
                      const ev = b.occ.event
                      const color = eventColor(ev, memberEmails)
                      const top = (b.start / 60) * H
                      const height = Math.max(BLOCK_MIN_PX - 2, ((b.end - b.start) / 60) * H - 2)
                      const oneLine = !compact && height < 38
                      const showTime = !compact && height >= 38
                      const showPlace = !compact && height >= 54 && !!ev.location
                      const timeText = ev.start_time
                        ? `${formatTime(ev.start_time, locale)}${ev.end_time ? ` – ${formatTime(ev.end_time, locale)}` : ''}`
                        : ''
                      // Day view: what's already over fades back with a
                      // "✓ Ended" note (owner, 2026-11-25 — same as the Home
                      // cards). The REAL end, not the drawn (min-height) one.
                      const realEnd = b.occ.end > d ? 1440 : hm(ev.end_time ?? ev.start_time)
                      const over = !multi && (d < today || (d === today && realEnd <= now))
                      return (
                        <View
                          key={`${ev.id}:${b.occ.start}`}
                          style={{
                            position: 'absolute',
                            top: top + 1,
                            height,
                            left: `${(b.col / b.cols) * 100}%`,
                            width: `${(b.span / b.cols) * 100}%`,
                            paddingLeft: compact ? 1 : 1.5,
                            paddingRight: compact ? 1 : 3,
                          }}
                        >
                          <Pressable
                            onPress={() => onEventPress(ev)}
                            accessibilityRole="button"
                            accessibilityLabel={`${ev.title}${timeText ? `, ${timeText}` : ''}`}
                            style={({ pressed }) => ({ flex: 1, borderRadius: compact ? 5 : 8, overflow: 'hidden', backgroundColor: c.sheet, opacity: (over ? 0.45 : 1) * (pressed ? 0.7 : 1) })}
                          >
                            <View style={{ flex: 1, flexDirection: 'row', backgroundColor: blockFill(color) }}>
                              <View style={{ width: compact ? 2 : 3, backgroundColor: color }} />
                              <View
                                style={{
                                  flex: 1,
                                  minWidth: 0,
                                  paddingHorizontal: compact ? 2 : 6,
                                  paddingVertical: compact ? 2 : oneLine ? 2 : 4,
                                  justifyContent: oneLine ? 'center' : 'flex-start',
                                }}
                              >
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                <Txt
                                  numberOfLines={compact ? Math.max(1, Math.floor((height - 4) / 13)) : oneLine ? 1 : 2}
                                  style={{ flexShrink: 1, fontSize: compact ? 10 : oneLine ? 12.5 : 13, lineHeight: compact ? 12.5 : oneLine ? 15 : 16, fontFamily: fonts.semibold, color: c.text }}
                                >
                                  {title(ev)}
                                </Txt>
                                {over && oneLine ? <EndedTag label={t('home.ended')} color={c.textMuted} /> : null}
                                </View>
                                {over && showTime ? (
                                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                    <EndedTag label={t('home.ended')} color={c.textMuted} />
                                    <Txt numberOfLines={1} style={{ flexShrink: 1, fontSize: 11.5, lineHeight: 15, color: c.textMuted }}>
                                      · {timeText}
                                    </Txt>
                                  </View>
                                ) : showTime ? (
                                  <Txt numberOfLines={1} style={{ fontSize: 11.5, lineHeight: 15, color: c.textMuted }}>
                                    {timeText}
                                  </Txt>
                                ) : null}
                                {showPlace ? (
                                  <Txt numberOfLines={1} style={{ fontSize: 11.5, lineHeight: 15, color: c.textMuted }}>
                                    {ev.location}
                                  </Txt>
                                ) : null}
                              </View>
                            </View>
                          </Pressable>
                        </View>
                      )
                    })}
                    {isToday ? (
                      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: (now / 60) * H - 1 }}>
                        <View style={{ height: 2, backgroundColor: tint }} />
                        <View style={{ position: 'absolute', left: -4, top: -3, width: 8, height: 8, borderRadius: 4, backgroundColor: tint }} />
                      </View>
                    ) : null}
                  </View>
                )
              })}
            </View>
          </View>

          {/* current time in the gutter, over the hour label it covers */}
          {showNow ? (
            <View pointerEvents="none" style={{ position: 'absolute', left: 2, width: gutter - 4, top: TOP_PAD + (now / 60) * H - 8, alignItems: 'flex-end' }}>
              <View style={{ backgroundColor: c.sheet, borderRadius: 6, paddingHorizontal: 3 }}>
                <Txt style={{ fontSize: compact ? 9.5 : 10.5, lineHeight: 16, fontFamily: fonts.semibold, color: tint }}>
                  {formatTime(`${Math.floor(now / 60)}:${now % 60}`, locale).replace(/\s?[AP]M$/iu, '')}
                </Txt>
              </View>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { flex: 1, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
})
