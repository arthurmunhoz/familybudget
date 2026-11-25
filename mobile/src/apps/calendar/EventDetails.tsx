// Read-only details of an event pulled from Google / Apple (2026-11): whose
// calendar it's on, when, where, the video link, the organizer, the guests
// with their RSVP, and the description. Opened by tapping an external event in
// any Calendar view — for EVERY member's events, since the point is seeing
// what the family has on. "Edit" shows only when the event is mine and
// editable here (Calendar's externalKind) and hands over to EventForm.
// One Roof events skip this and open EventForm directly, as before.
import { useState } from 'react'
import { Linking, Modal, ScrollView, StyleSheet, View } from 'react-native'
import { CalendarDays, Clock, MapPin, UserRound, Users, Video, X } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import { TintButton } from '@/components/TintButton'
import { GradientBox } from '@/components/home/GradientBox'
import { APP_GRADIENT } from '@/components/home/palette'
import { MemberAvatar } from '@/apps/location/locationUi'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'
import { HOUSEHOLD_COLOR, formatTime, memberColor } from '@/lib/calendar'
import type { CalendarEvent, Profile } from '@/lib/types'
import { fonts, sp, useTheme } from '@/theme/theme'

const GUESTS_SHOWN = 4
const RSVP_ORDER: Record<string, number> = { accepted: 0, tentative: 1, needsAction: 2, declined: 3 }

/** Google descriptions are often HTML (links, <br>) — show them as text. */
function plainText(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function initials(name: string): string {
  const parts = name.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase()
}

export default function EventDetails({
  event,
  profiles,
  memberEmails,
  locale,
  canEdit,
  onEdit,
  onClose,
}: {
  event: CalendarEvent
  profiles: Profile[]
  memberEmails: string[]
  locale: string
  canEdit: boolean
  onEdit: () => void
  onClose: () => void
}) {
  const { c, dark } = useTheme()
  const { t } = useI18n()
  const bottomGap = useBottomGap(sp.md)
  const [allGuests, setAllGuests] = useState(false)
  const red = APP_GRADIENT.calendar as [string, string]
  const tint = red[1]

  const owner = event.owner_email ? profiles.find((p) => p.email === event.owner_email) : null
  const ownerName = owner?.display_name || event.owner_email || t('calendar.everyone')
  const ownerColor = event.owner_email ? memberColor(event.owner_email, memberEmails) : HOUSEHOLD_COLOR

  const day = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'short' })
  }
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  const multiDay = event.end_date && event.end_date !== event.start_date
  let when = cap(day(event.start_date))
  if (event.all_day) {
    when += multiDay ? ` – ${day(event.end_date)}` : ` · ${t('home.allDay')}`
  } else {
    const st = event.start_time ? formatTime(event.start_time, locale) : ''
    const et = event.end_time ? formatTime(event.end_time, locale) : ''
    when += multiDay ? ` ${st} – ${day(event.end_date)} ${et}` : ` · ${st}${et ? ` – ${et}` : ''}`
  }

  const guests = [...(event.attendees ?? [])].sort(
    (a, b) =>
      (a.organizer ? -1 : 0) - (b.organizer ? -1 : 0) || (RSVP_ORDER[a.status] ?? 2) - (RSVP_ORDER[b.status] ?? 2),
  )
  const shownGuests = allGuests ? guests : guests.slice(0, GUESTS_SHOWN)
  const rsvpColor = (s: string) => (s === 'accepted' ? '#1E9E6A' : s === 'declined' ? c.expense : c.textMuted)
  const notes = event.notes ? plainText(event.notes) : ''
  const source =
    event.source === 'google' ? t('calendar.fromGoogle') : event.source === 'apple' ? t('calendar.fromApple') : null

  const rowIcon = (Icon: typeof Clock) => (
    <View style={[styles.rowIcon, { backgroundColor: tint + (dark ? '2E' : '17') }]}>
      <Icon size={16} color={tint} />
    </View>
  )

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessible={false} />
        <View style={[styles.sheet, { backgroundColor: c.sheet }]}>
          <View style={styles.head}>
            <GradientBox colors={red} radius={18} style={styles.tile}>
              <CalendarDays size={26} color="#fff" />
            </GradientBox>
            <View style={{ flex: 1, minWidth: 0 }}>
              {source ? <Txt style={[styles.kicker, { color: c.textMuted }]}>{source}</Txt> : null}
              <Txt style={{ fontFamily: fonts.display, fontSize: 25, lineHeight: 30, color: c.text, marginTop: 2 }}>
                {event.title}
              </Txt>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              style={[styles.close, { backgroundColor: c.surface }]}
            >
              <X size={16} color={c.textMuted} />
            </Pressable>
          </View>

          <ScrollView
            style={{ flexGrow: 0, flexShrink: 1 }}
            contentContainerStyle={{ gap: sp.lg, paddingHorizontal: sp.lg, paddingBottom: sp.lg }}
            showsVerticalScrollIndicator={false}
          >
            {/* whose calendar this is on — first, since several people's events
                share one calendar */}
            <View style={[styles.owner, { backgroundColor: ownerColor + (dark ? '2E' : '14') }]}>
              {event.owner_email ? (
                <MemberAvatar name={ownerName} color={ownerColor} size={34} ring={false} />
              ) : (
                <View style={[styles.house, { backgroundColor: ownerColor }]}>
                  <Users size={17} color="#fff" />
                </View>
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt style={{ fontSize: 12, color: c.textMuted }}>{t('calendar.onCalendarOf')}</Txt>
                <Txt style={{ fontFamily: fonts.semibold, fontSize: 15.5, color: c.text }} numberOfLines={1}>
                  {event.owner_email ? ownerName : t('calendar.everyone')}
                </Txt>
              </View>
            </View>

            <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
              <View style={styles.row}>
                {rowIcon(Clock)}
                <Txt style={styles.rowText}>{when}</Txt>
              </View>
              {event.location ? (
                <View style={[styles.row, styles.sep, { borderTopColor: c.border }]}>
                  {rowIcon(MapPin)}
                  <Txt style={styles.rowText}>{event.location}</Txt>
                </View>
              ) : null}
              {event.meeting_url ? (
                <Pressable
                  accessibilityRole="link"
                  onPress={() => Linking.openURL(event.meeting_url!).catch(() => {})}
                  style={[styles.row, styles.sep, { borderTopColor: c.border }]}
                >
                  {rowIcon(Video)}
                  <Txt style={[styles.rowText, { color: c.accent, fontFamily: fonts.semibold }]}>
                    {t('calendar.joinMeeting')}
                  </Txt>
                </Pressable>
              ) : null}
              {event.organizer ? (
                <View style={[styles.row, styles.sep, { borderTopColor: c.border }]}>
                  {rowIcon(UserRound)}
                  <Txt style={styles.rowText}>{t('calendar.organizedBy', { name: event.organizer })}</Txt>
                </View>
              ) : null}
            </View>

            {guests.length ? (
              <View>
                <Txt style={[styles.label, { color: c.textMuted }]}>{t('calendar.guests', { n: guests.length })}</Txt>
                <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
                  {shownGuests.map((g, i) => (
                    <View key={`${g.name}:${i}`} style={[styles.row, i ? [styles.sep, { borderTopColor: c.border }] : null]}>
                      <View style={[styles.guest, { backgroundColor: c.surface }]}>
                        <Txt style={{ fontSize: 12, fontFamily: fonts.semibold, color: c.textMuted }}>{initials(g.name)}</Txt>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Txt style={{ fontSize: 15 }} numberOfLines={1}>
                          {g.name}
                        </Txt>
                        {g.organizer ? <Txt style={{ fontSize: 12, color: c.textMuted }}>{t('calendar.organizer')}</Txt> : null}
                      </View>
                      <Txt style={{ fontSize: 13, fontFamily: fonts.semibold, color: rsvpColor(g.status) }}>
                        {t(`calendar.rsvp.${RSVP_ORDER[g.status] !== undefined ? g.status : 'needsAction'}` as TKey)}
                      </Txt>
                    </View>
                  ))}
                  {guests.length > GUESTS_SHOWN ? (
                    <Pressable
                      onPress={() => setAllGuests(!allGuests)}
                      style={[styles.row, styles.sep, { borderTopColor: c.border }]}
                    >
                      <Txt style={{ fontSize: 14, fontFamily: fonts.semibold, color: c.textMuted }}>
                        {allGuests ? t('calendar.fewerGuests') : t('calendar.moreGuests', { n: guests.length - GUESTS_SHOWN })}
                      </Txt>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ) : null}

            {notes ? (
              <View>
                <Txt style={[styles.label, { color: c.textMuted }]}>{t('calendar.description')}</Txt>
                <Txt style={{ fontSize: 14.5, lineHeight: 21, color: c.textMuted }} selectable>
                  {notes}
                </Txt>
              </View>
            ) : null}
          </ScrollView>

          {canEdit ? (
            <View style={{ paddingHorizontal: sp.lg, paddingTop: sp.sm, paddingBottom: bottomGap }}>
              <TintButton tint={tint} colors={red} title={t('calendar.editEvent')} onPress={onEdit} />
            </View>
          ) : (
            <View style={{ height: bottomGap }} />
          )}
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: sp.lg, maxHeight: '90%' },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingHorizontal: sp.lg, paddingBottom: sp.md },
  tile: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  kicker: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase' },
  close: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  owner: { flexDirection: 'row', alignItems: 'center', gap: sp.md, padding: sp.md, borderRadius: 18 },
  house: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: sp.md, paddingVertical: 12 },
  sep: { borderTopWidth: StyleSheet.hairlineWidth },
  rowIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, fontSize: 15, lineHeight: 20 },
  guest: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase', marginBottom: sp.sm },
})
