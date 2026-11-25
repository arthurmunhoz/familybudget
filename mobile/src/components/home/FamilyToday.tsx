// "Family today" on the Hub (2026-11, v2): a SUMMARY of everyone else's day,
// not a card per event — a family with two busy workers easily has 7+ meetings
// and the Home can't list them without turning into the calendar.
//
// Closed (ALWAYS on opening the app — owner, 2026-11-25; not remembered): one line — "8 events · 6 AM to
// 8 PM" + the faces of who has something. Open: a mini timeline, one lane per
// person (blocks in their colour over the span of the day that holds events,
// a red "now" tick), then "Now: …" / "Next: …", any pet care due, and "See the
// family's day" → the Calendar's Day view filtered to the family and zoomed to
// that span (Calendar `?date=…&family=1`).
import { useState } from 'react'
import { LayoutAnimation, StyleSheet, View } from 'react-native'
import { ChevronDown, ChevronRight, PawPrint } from 'lucide-react-native'

import { Pressable } from '../Pressable'
import { Txt } from '../ui'
import { MemberAvatar } from '../../apps/location/locationUi'
import { PetAvatar, type AgendaFace } from './AgendaCard'
import { useI18n } from '../../hooks/useI18n'
import { fonts, sp, useTheme } from '../../theme/theme'

const MAX_LANES = 5

export interface FamilyLane {
  key: string
  face: AgendaFace
  color: string
  /** timed events, minutes from midnight */
  blocks: { start: number; end: number }[]
  /** has an all-day event today → the whole lane gets a faint tint */
  allDay: boolean
}

export interface FamilyPetLine {
  key: string
  text: string
  alert: boolean
}

function Face({ face, size, ring }: { face: AgendaFace; size: number; ring?: string }) {
  const body =
    face.type === 'pet' ? (
      <PetAvatar photoPath={face.photoPath} emoji={face.emoji} color={face.color} size={size} ring={false} />
    ) : (
      <MemberAvatar name={face.name} avatarPath={face.avatarPath} color={face.color} size={size} ring={false} />
    )
  if (!ring) return body
  return <View style={{ borderRadius: size, borderWidth: 2, borderColor: ring }}>{body}</View>
}

export function FamilyToday({
  lanes,
  summary,
  span,
  nowMin,
  nowLine,
  nextLine,
  pets,
  onOpenDay,
  onOpenPets,
}: {
  lanes: FamilyLane[]
  /** "8 events · 6 AM to 8 PM" */
  summary: string
  /** the timeline's range in minutes (whole hours), null = no timed events */
  span: { from: number; to: number } | null
  nowMin: number
  nowLine: string | null
  nextLine: string | null
  pets: FamilyPetLine[]
  onOpenDay: () => void
  onOpenPets: () => void
}) {
  const { c } = useTheme()
  const { t, lang } = useI18n()
  const [open, setOpen] = useState(false)

  function toggle() {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    const next = !open
    setOpen(next)
  }

  const shownLanes = lanes.slice(0, MAX_LANES)
  const extraLanes = lanes.length - shownLanes.length
  const total = span ? span.to - span.from : 0
  const pct = (m: number) => `${((Math.min(Math.max(m, span!.from), span!.to) - span!.from) / total) * 100}%` as const
  // ~4 hour labels along the axis
  const ticks: number[] = []
  if (span) {
    const hours = total / 60
    const step = hours <= 6 ? 2 : hours <= 12 ? 4 : 6
    for (let m = span.from; m < span.to; m += step * 60) ticks.push(m)
    if (span.to - ticks[ticks.length - 1] >= 90) ticks.push(span.to)
  }
  const hourLabel = (m: number) => {
    const h = Math.floor(m / 60) % 24
    return lang === 'en' ? `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}` : `${h}h`
  }
  const alertPet = pets.some((p) => p.alert)

  return (
    <View style={[s.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${t('home.familyToday')}, ${summary}`}
        style={s.head}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt style={{ fontFamily: fonts.display, fontSize: 19, color: c.text }}>{t('home.familyToday')}</Txt>
          <Txt style={{ fontSize: 13, color: c.textMuted, marginTop: 1 }} numberOfLines={1}>
            {summary}
          </Txt>
        </View>
        {!open ? (
          <View style={{ flexDirection: 'row', marginRight: 2 }}>
            {lanes.slice(0, 4).map((l, i) => (
              <View key={l.key} style={{ marginLeft: i ? -9 : 0 }}>
                <Face face={l.face} size={26} ring={c.card} />
              </View>
            ))}
            {alertPet ? (
              <View style={[s.petDot, { backgroundColor: c.expense, borderColor: c.card, marginLeft: lanes.length ? -9 : 0 }]}>
                <PawPrint size={13} color="#fff" />
              </View>
            ) : null}
          </View>
        ) : null}
        {open ? <ChevronDown size={18} color={c.textMuted} /> : <ChevronRight size={18} color={c.textMuted} />}
      </Pressable>

      {open ? (
        <View style={{ paddingHorizontal: sp.md, paddingBottom: sp.md }}>
          {span ? (
            <>
              {shownLanes.map((l) => (
                <View key={l.key} style={s.lane}>
                  <Face face={l.face} size={24} />
                  <View style={[s.track, { backgroundColor: l.allDay ? l.color + '2E' : c.text + '0F' }]}>
                    {l.blocks.map((b, i) => (
                      <View
                        key={i}
                        style={[s.blk, { left: pct(b.start), width: `${((Math.min(b.end, span.to) - Math.max(b.start, span.from)) / total) * 100}%`, backgroundColor: l.color, borderColor: c.card }]}
                      />
                    ))}
                    {nowMin > span.from && nowMin < span.to ? (
                      <View pointerEvents="none" style={[s.now, { left: pct(nowMin), backgroundColor: c.expense }]} />
                    ) : null}
                  </View>
                </View>
              ))}
              {extraLanes > 0 ? (
                <Txt style={{ fontSize: 12.5, color: c.textMuted, marginTop: 6, marginLeft: 34 }}>{t('home.moreItems', { n: extraLanes })}</Txt>
              ) : null}
              <View style={{ marginLeft: 34, marginTop: 5, height: 14 }}>
                {ticks.map((m, i) => (
                  <Txt
                    key={m}
                    style={{
                      position: 'absolute',
                      left: pct(m),
                      fontSize: 11,
                      color: c.textFaint,
                      transform: [{ translateX: i === 0 ? 0 : m === span.to ? -24 : -10 }],
                    }}
                  >
                    {hourLabel(m)}
                  </Txt>
                ))}
              </View>
            </>
          ) : null}

          {nowLine || nextLine ? (
            <View style={{ marginTop: span ? sp.md : 0, gap: 3 }}>
              {nowLine ? (
                <Txt style={{ fontSize: 13.5, color: c.text }} numberOfLines={2}>
                  <Txt style={{ fontSize: 13.5, fontFamily: fonts.semibold, color: c.expense }}>{t('home.now')}</Txt>
                  {' · '}
                  {nowLine}
                </Txt>
              ) : null}
              {nextLine ? (
                <Txt style={{ fontSize: 13.5, color: c.textMuted }} numberOfLines={2}>
                  {nextLine}
                </Txt>
              ) : null}
            </View>
          ) : null}

          {pets.length ? (
            <Pressable onPress={onOpenPets} accessibilityRole="button" style={{ marginTop: sp.sm, gap: 3 }}>
              {pets.map((p) => (
                <View key={p.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <PawPrint size={14} color={p.alert ? c.expense : c.textMuted} />
                  <Txt
                    style={{ flex: 1, fontSize: 13.5, color: p.alert ? c.expense : c.textMuted, fontFamily: p.alert ? fonts.semibold : fonts.body }}
                    numberOfLines={1}
                  >
                    {p.text}
                  </Txt>
                </View>
              ))}
            </Pressable>
          ) : null}

          {lanes.length ? (
            <Pressable
              onPress={onOpenDay}
              accessibilityRole="button"
              style={({ pressed }) => [s.cta, { backgroundColor: c.accent + '1A', opacity: pressed ? 0.7 : 1 }]}
            >
              <Txt style={{ fontSize: 14.5, fontFamily: fonts.semibold, color: c.accent }}>{t('home.familyOpenDay')}</Txt>
              <ChevronRight size={16} color={c.accent} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

const s = StyleSheet.create({
  card: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: sp.sm, paddingHorizontal: sp.md, paddingVertical: 13 },
  lane: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 9 },
  track: { flex: 1, height: 22, borderRadius: 7 },
  blk: { position: 'absolute', top: 3, bottom: 3, borderRadius: 6, minWidth: 5, borderWidth: 1 },
  now: { position: 'absolute', top: -5, bottom: -5, width: 2, borderRadius: 1 },
  petDot: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  cta: {
    marginTop: sp.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 14,
    paddingVertical: 11,
  },
})
