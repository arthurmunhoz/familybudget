// Shared bits for the Whereabouts screens: a stable per-member color, a ringed
// avatar (photo or initials) used both as a map pin and in lists, a small
// battery chip, the pulsing "Watching" badge, and a localized "time ago" helper.
import { useEffect, useRef, useState } from 'react'
import { Animated, StyleSheet, View } from 'react-native'
import { Image } from 'expo-image'
import { ShieldCheck } from 'lucide-react-native'

import { getSignedUrl } from '@/lib/signedUrls'
import { useI18n } from '@/hooks/useI18n'
import { fonts, radius, sp, useTheme } from '@/theme/theme'
import { Txt } from '@/components/ui'
import type { TKey } from '@/lib/i18n'

/** Roster card geometry, shared by the collapsed card, the expanded detail card
 *  and the camera padding.
 *
 *  THE HEIGHT IS THE SAME IN BOTH STATES ON PURPOSE — expanding grows the card
 *  sideways only. The roster therefore never changes height, which matters for
 *  more than tidiness: Mapbox's logo and the OpenStreetMap attribution are
 *  pinned just above the cards, and covering them breaches ODbL. A roster that
 *  grew on tap would either hide them or need its offset re-pushed to native on
 *  every tap. Keep these two heights equal. */
export const CARD_W = 138
export const CARD_H = 168
export const CARD_W_EXPANDED = 300
/** Breathing room the floating roster needs around the cards themselves.
 *  A horizontal ScrollView clips to its bounds, so without the shadow padding
 *  the cards' drop shadows would be sliced off top and bottom. */
export const ROSTER_SHADOW_PAD = 10
export const ROSTER_BOTTOM_GAP = 12
/** Everything the roster occupies besides the card. CARD_H + this is how much
 *  map it covers, which is what BOTH the camera padding and the Mapbox logo
 *  offset are derived from — keep them derived, never hardcode a total. */
export const ROSTER_CHROME = ROSTER_SHADOW_PAD * 2 + ROSTER_BOTTOM_GAP

/** Cards float directly on the map, so they carry their own lift. Matches the
 *  Toast's shadow — the app's other free-floating element. */
export const FLOAT_SHADOW = {
  shadowColor: '#000',
  shadowOpacity: 0.22,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 5 },
  elevation: 6,
} as const

// Distinct, warm-leaning member colors that read on both Paper and Dusk.
export const MEMBER_PALETTE = [
  '#c2603f', // clay (brand)
  '#4f7fa6', // steel blue
  '#3f9a84', // teal
  '#c68a2b', // amber
  '#97688b', // plum
  '#5f9e4d', // moss
  '#b5524e', // rust
  '#3f7fa0', // ocean
] as const

/** Assign each email a stable color by its position in the sorted member list,
 *  so a household's colors don't reshuffle between renders. */
export function buildMemberColors(emails: string[]): Record<string, string> {
  const sorted = [...emails].sort()
  const out: Record<string, string> = {}
  sorted.forEach((e, i) => {
    out[e] = MEMBER_PALETTE[i % MEMBER_PALETTE.length]
  })
  return out
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Round avatar with a colored identity: the member's photo when set, else their
 *  initials on their color. `ring` adds a card-colored border so a pin reads
 *  clearly on top of the map. */
export function MemberAvatar({
  name,
  avatarPath,
  color,
  size = 44,
  ring = true,
}: {
  name: string
  avatarPath?: string | null
  color: string
  size?: number
  ring?: boolean
}) {
  const { c } = useTheme()
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    if (!avatarPath) {
      setUrl(null)
      return
    }
    getSignedUrl(avatarPath).then((u) => {
      if (active) setUrl(u)
    })
    return () => {
      active = false
    }
  }, [avatarPath])

  const border = ring ? Math.max(2, Math.round(size * 0.07)) : 0
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        borderWidth: border,
        borderColor: c.sheet,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {url ? (
        <Image source={{ uri: url }} style={{ width: size, height: size }} contentFit="cover" transition={120} />
      ) : (
        <Txt style={{ fontFamily: fonts.semibold, color: '#ffffff', fontSize: size * 0.4 }}>
          {initials(name)}
        </Txt>
      )}
    </View>
  )
}

/** Shared level → colour, so the chip and the full gauge can't drift apart. */
function batteryColor(level: number, c: ReturnType<typeof useTheme>['c']): string {
  return level <= 15 ? c.expense : level <= 30 ? '#c8862a' : c.income
}

/** A real battery, laid out horizontally and filled to the actual percentage —
 *  a 40% charge fills 40% of the shell. Used on your OWN expanded card, where
 *  the battery gets a full-width row to itself; the compact `BatteryChip` is
 *  still what goes on the small roster cards.
 *
 *  The fill is an absolutely-positioned child of an inner TRACK rather than of
 *  the bordered shell, so its `width: '<pct>%'` measures against exactly the
 *  space a full battery would occupy — no border or padding smuggled into the
 *  percentage. */
export function BatteryGauge({ level, height = 34 }: { level: number; height?: number }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const pct = Math.max(0, Math.min(100, Math.round(level)))
  const color = batteryColor(pct, c)
  return (
    <View
      accessible
      accessibilityLabel={`${t('location.stat.battery')} ${pct}%`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}
    >
      <View
        style={{
          flex: 1,
          height,
          borderRadius: 9,
          borderWidth: 2,
          borderColor: c.border,
          padding: 3,
        }}
      >
        <View style={{ flex: 1, borderRadius: 5, overflow: 'hidden', justifyContent: 'center' }}>
          <View
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: `${pct}%`,
              backgroundColor: color,
            }}
          />
          {/* c.text reads over both the filled and the empty side in either theme. */}
          <Txt style={{ fontFamily: fonts.semibold, fontSize: 13, color: c.text, textAlign: 'center' }}>
            {pct}%
          </Txt>
        </View>
      </View>
      {/* The terminal nub, so it reads as a battery and not a progress bar. */}
      <View style={{ width: 3, height: Math.round(height * 0.34), borderRadius: 2, backgroundColor: c.border }} />
    </View>
  )
}

/** Small battery gauge + percentage; green / amber / red by level. */
export function BatteryChip({ level }: { level: number }) {
  const { c } = useTheme()
  const color = batteryColor(level, c)
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <View
        style={{
          width: 20,
          height: 11,
          borderWidth: 1.5,
          borderColor: color,
          borderRadius: 3,
          padding: 1.5,
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            height: '100%',
            width: `${Math.max(6, Math.min(100, level))}%`,
            backgroundColor: color,
            borderRadius: 1,
          }}
        />
      </View>
      <Txt style={{ fontFamily: fonts.semibold, fontSize: 11, color: c.textMuted }}>{level}%</Txt>
    </View>
  )
}

/** A titled group inside a sheet. Without these a form reads as one flat column
 *  of labels and controls on a single fill — a wall.
 *
 *  The BORDER is doing most of the work, not the fill: `c.surface` is a
 *  translucent overlay on the sheet (10% white in Dusk), so on its own it barely
 *  separates from the sheet behind it. A hairline edge reads at any opacity, in
 *  either theme.
 *
 *  `shrink` is needed when the section wraps a ScrollView that has to yield once
 *  the sheet hits its max height: RN defaults flexShrink to 0, so EVERY link in
 *  the chain has to opt in or the list pushes the sheet past its cap. */
export function Section({
  title,
  shrink,
  children,
}: {
  title?: string
  shrink?: boolean
  children: React.ReactNode
}) {
  const { c } = useTheme()
  return (
    <View style={{ gap: 7, flexShrink: shrink ? 1 : 0 }}>
      {title ? (
        <Txt
          style={{
            fontFamily: fonts.semibold,
            fontSize: 11,
            color: c.textMuted,
            textTransform: 'uppercase',
            letterSpacing: 0.7,
            marginLeft: 2,
          }}
        >
          {title}
        </Txt>
      ) : null}
      <View
        style={{
          backgroundColor: c.surface,
          borderRadius: radius.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: c.border,
          padding: sp.md,
          gap: sp.md,
          flexShrink: shrink ? 1 : 0,
        }}
      >
        {children}
      </View>
    </View>
  )
}

/** Wraps anything in a slow opacity heartbeat, so "this is running right now"
 *  reads as activity instead of as a static label. Used for the Watching chip
 *  and for the Safety Radius header glyph while a watch is live. */
export function Pulse({ children }: { children: React.ReactNode }) {
  const opacity = useRef(new Animated.Value(1)).current
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.3, duration: 850, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 850, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [opacity])
  return <Animated.View style={{ opacity }}>{children}</Animated.View>
}

/** "Watching" badge — softly pulses so an active Safety Radius reads as ongoing
 *  activity rather than a static label. */
export function WatchingChip() {
  const { c } = useTheme()
  const { t } = useI18n()
  return (
    <Pulse>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 3,
          backgroundColor: c.accentSoft,
          borderRadius: radius.pill,
          paddingHorizontal: 7,
          paddingVertical: 2,
        }}
      >
        <ShieldCheck size={10} color={c.accent} />
        <Txt style={{ fontFamily: fonts.semibold, fontSize: 9, color: c.accent }}>
          {t('location.card.watching')}
        </Txt>
      </View>
    </Pulse>
  )
}

/** Localized relative time from an ISO timestamp, e.g. "just now", "5 min ago". */
export function timeAgo(iso: string, t: (key: TKey, vars?: Record<string, string | number>) => string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return t('location.ago.now')
  const mins = Math.floor(secs / 60)
  if (mins < 60) return t('location.ago.min', { count: mins })
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return t('location.ago.hr', { count: hrs })
  return t('location.ago.day', { count: Math.floor(hrs / 24) })
}
