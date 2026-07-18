// The expanded member card — member detail shown IN PLACE in the roster instead
// of over the map in a sheet. Tapping a card (or a pin) expands it here and
// frames that person on the map, so the thing you're reading about stays visible
// behind the card. Leads with the drive-time ETA, then distance + battery, where
// they are, one-tap navigation and Nudge / Call.
//
// It is exactly as TALL as a collapsed card and only wider — see CARD_H in
// locationUi for why that matters (the sheet must not grow over Mapbox's logo).
// Everything below is therefore budgeted to fit 168pt; if you add a row, take
// one away. The budget, for the busiest (live member) case:
//
//   168 card − 24 padding            = 144 available
//   header 40 (the avatar sets it)
//   + gap 8 + stats 43 (12 + 21 + 10)
//   + gap 8 + actions 40 (10 + 16 + 2 + 12)
//                                    = 139, leaving 5pt of slack
//
// Text rows use explicit lineHeights so that arithmetic actually holds — the
// display font's natural line box is taller than its fontSize and would eat the
// slack. The action row is marginTop:'auto', so spare height falls in the middle
// rather than dangling under the last row.
//
// Only ONE of these is mounted at a time (the expanded member), which is why the
// ETA / reverse-geocode / live-mode hooks can live in here rather than being
// hoisted — a household of ten doesn't fire ten Directions requests.
import { useEffect, useRef, useState } from 'react'
import { Linking, Pressable, View } from 'react-native'
import * as Location from 'expo-location'
import { Bell, Navigation, Phone, Settings2, X } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import {
  driveEta,
  formatDistance,
  formatEta,
  haversineMeters,
  isPaused,
  isSharingLive,
} from '@/lib/location'
import { useWatchLive } from '@/lib/liveLocation'
import { placeAt } from '@/lib/places'
import type { MemberLocation, Place, Profile } from '@/lib/types'
import { fonts, radius, sp, useTheme } from '@/theme/theme'
import {
  BatteryGauge,
  CARD_H,
  CARD_W_EXPANDED,
  FLOAT_SHADOW,
  MemberAvatar,
  WatchingChip,
  timeAgo,
} from './locationUi'

/** One compact stat. The ETA tile is `primary` so it reads first. */
function Stat({ label, value, primary }: { label: string; value: string; primary?: boolean }) {
  const { c } = useTheme()
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: primary ? c.accentSoft : c.surface,
        borderRadius: radius.md,
        paddingVertical: 6,
        alignItems: 'center',
      }}
    >
      {/* Explicit lineHeight, here and below: the card is a FIXED 168pt and the
          display font's natural line box is tall enough to overflow the budget.
          Pinning it keeps the layout independent of font metrics. */}
      <Txt
        style={{ fontFamily: fonts.display, fontSize: 17, lineHeight: 21, color: primary ? c.accent : c.text }}
        numberOfLines={1}
      >
        {value}
      </Txt>
      <Txt
        style={{
          fontFamily: fonts.semibold,
          fontSize: 8,
          lineHeight: 10,
          color: c.textMuted,
          textTransform: 'uppercase',
          letterSpacing: 0.4,
        }}
      >
        {label}
      </Txt>
    </View>
  )
}

/** One small icon action. Nav hand-offs carry their service's brand colour so
 *  they're told apart at a glance (we don't ship their trademarked logos). */
function IconAction({
  icon,
  label,
  onPress,
}: {
  icon: React.ReactNode
  label: string
  onPress: () => void
}) {
  const { c } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        {
          flex: 1,
          backgroundColor: c.surface,
          borderRadius: radius.md,
          paddingVertical: 5,
          alignItems: 'center',
          gap: 2,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      {icon}
      <Txt
        style={{ fontFamily: fonts.semibold, fontSize: 10, lineHeight: 12, color: c.text }}
        numberOfLines={1}
      >
        {label}
      </Txt>
    </Pressable>
  )
}

export function MemberDetailCard({
  profile,
  location,
  isMe,
  color,
  avatarPath,
  phone,
  myLive,
  places,
  watched,
  onCollapse,
  onNavigate,
  onNudge,
  onManageSharing,
  onLaidOut,
}: {
  profile: Profile
  location: MemberLocation | null
  isMe: boolean
  color: string
  avatarPath?: string | null
  phone?: string
  myLive: (MemberLocation & { lat: number; lng: number }) | null
  /** Saved places, so we can say "At Home" instead of a street address. */
  places: Place[]
  /** In my active Safety Radius watch list. */
  watched: boolean
  onCollapse: () => void
  /** Open the map-app picker for this member (the parent owns the modal — a
   *  sheet can't be presented from inside a card in a horizontal scroller). */
  onNavigate: () => void
  onNudge: () => void
  onManageSharing: () => void
  /** Our x within the roster's content, once laid out — the parent uses it to
   *  scroll this card fully into view. Reported from onLayout rather than
   *  computed by the parent, because the parent would have to guess at our
   *  width before we've grown into it. */
  onLaidOut?: (x: number) => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()

  const live = isSharingLive(location) ? location : null
  const [eta, setEta] = useState<{ minutes: number } | null>(null)
  const [etaLoading, setEtaLoading] = useState(false)
  const [address, setAddress] = useState<string | null>(null)

  // Keep the latest coords in refs so the ETA/address effects can read them
  // without re-running on every tiny move — they key on a coarse ~100 m grid.
  const liveRef = useRef(live)
  liveRef.current = live
  const myLiveRef = useRef(myLive)
  myLiveRef.current = myLive
  const targetKey = live ? `${live.lat.toFixed(3)},${live.lng.toFixed(3)}` : null
  const myKey = myLive ? `${myLive.lat.toFixed(3)},${myLive.lng.toFixed(3)}` : null

  // Live mode: while this card is expanded on a sharing member (not me), ask
  // their device to ramp up to high-frequency GPS so their pin moves in near
  // real time. Collapsing unmounts this and lets it relax.
  useWatchLive(live && !isMe ? profile.email : null)

  // Drive-time ETA from me → them. Keyed coarse so live mode's rapid updates
  // don't spam the Directions API — refetch only when someone moves ~100 m.
  useEffect(() => {
    let active = true
    setEta(null)
    const them = liveRef.current
    const me = myLiveRef.current
    if (!them || isMe || !me) return
    setEtaLoading(true)
    driveEta(me, { lat: them.lat, lng: them.lng })
      .then((r) => {
        if (active) setEta(r)
      })
      .finally(() => {
        if (active) setEtaLoading(false)
      })
    return () => {
      active = false
    }
  }, [targetKey, myKey, isMe])

  // Human address via the on-device geocoder (keyed coarse, same reason as ETA).
  useEffect(() => {
    let active = true
    setAddress(null)
    const them = liveRef.current
    if (!them) return
    Location.reverseGeocodeAsync({ latitude: them.lat, longitude: them.lng })
      .then((res) => {
        if (!active) return
        const a = res[0]
        if (!a) return
        const line = [a.name || a.street, a.city].filter(Boolean).join(', ')
        setAddress(line || null)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [targetKey])

  /** The saved place they're inside, if any — "At Home" beats a street address. */
  const here = live ? placeAt(places, { lat: live.lat, lng: live.lng }) : null
  const where = here
    ? t('location.atPlace', { place: here.name })
    : (address ?? t('location.locating'))

  const distText = live && myLive ? formatDistance(haversineMeters(myLive, live)) : '—'
  const etaText = etaLoading ? '…' : eta ? formatEta(eta.minutes) : '—'
  const battText = live && live.battery != null ? `${live.battery}%` : '—'

  return (
    <View
      onLayout={(e) => onLaidOut?.(e.nativeEvent.layout.x)}
      style={{
        width: CARD_W_EXPANDED,
        height: CARD_H,
        // c.sheet, NOT c.surface — this floats straight on the map, and surface
        // is translucent under the glass skin (10% white in Dusk), which would
        // let the tiles show through the text. Same rule as any map panel.
        backgroundColor: c.sheet,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: c.accent,
        padding: sp.md,
        gap: sp.sm,
        ...FLOAT_SHADOW,
      }}
    >
      {/* Header: who, where, and a way back to the compact card. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
        <MemberAvatar name={profile.display_name} avatarPath={avatarPath} color={color} size={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Txt
              style={{ fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18, color: c.text, flexShrink: 1 }}
              numberOfLines={1}
            >
              {isMe ? t('location.you') : profile.display_name}
            </Txt>
            {watched ? <WatchingChip /> : null}
          </View>
          <Txt variant="muted" style={{ fontSize: 11, lineHeight: 14 }} numberOfLines={1}>
            {live
              ? `${where} · ${timeAgo(live.updated_at, t)}`
              : isPaused(location)
                ? t('location.status.paused')
                : t('location.status.off')}
          </Txt>
        </View>
        <Pressable
          onPress={onCollapse}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
        >
          <X size={17} color={c.textMuted} />
        </Pressable>
      </View>

      {live && !isMe ? (
        <>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {/* ETA leads — Arthur's call, and it's the thing you open this for. */}
            <Stat label={t('location.stat.eta')} value={etaText} primary />
            <Stat label={t('location.stat.distance')} value={distText} />
            <Stat label={t('location.stat.battery')} value={battText} />
          </View>
          {/* Three actions, not five. The map apps used to sit here as separate
              icon buttons, which made each one narrow enough that the glyph had
              to carry the meaning — unreadable at this size. They live behind
              "Navigate" now, which buys the remaining buttons enough width for a
              legible label. */}
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 'auto' }}>
            <IconAction
              icon={<Navigation size={16} color={c.accent} />}
              label={t('location.action.navigate')}
              onPress={onNavigate}
            />
            <IconAction
              icon={<Bell size={16} color={c.text} />}
              label={t('location.action.nudge')}
              onPress={onNudge}
            />
            {phone ? (
              <IconAction
                icon={<Phone size={16} color={c.text} />}
                label={t('location.action.call')}
                onPress={() => void Linking.openURL(`tel:${phone}`)}
              />
            ) : null}
          </View>
        </>
      ) : isMe ? (
        <>
          {/* Your own card has a full-width row going spare, so the battery is
              drawn as an actual battery filled to the charge rather than as a
              number with a caption. Falls back to the plain tile when the level
              is unknown — an empty shell would read as "flat", not "no idea". */}
          {live && live.battery != null ? (
            <BatteryGauge level={live.battery} />
          ) : live ? (
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <Stat label={t('location.stat.battery')} value={battText} />
            </View>
          ) : null}
          {/* Sharing has real switches and pause presets, so it stays its own
              sheet — this is the way in, matching the collapsed card's hint. */}
          <Pressable
            onPress={onManageSharing}
            accessibilityRole="button"
            style={({ pressed }) => [
              {
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                backgroundColor: c.accentSoft,
                borderRadius: radius.md,
                paddingVertical: 9,
                marginTop: 'auto',
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            <Settings2 size={15} color={c.accent} />
            <Txt
              style={{ fontFamily: fonts.semibold, fontSize: 12, lineHeight: 15, color: c.accent }}
              numberOfLines={1}
            >
              {t('location.card.manage')}
            </Txt>
          </Pressable>
        </>
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, paddingHorizontal: sp.sm }}>
          <Navigation size={20} color={c.textFaint} />
          <Txt style={{ fontFamily: fonts.semibold, fontSize: 12, color: c.text, textAlign: 'center' }}>
            {isPaused(location)
              ? t('location.member.pausedTitle', { name: profile.display_name })
              : t('location.member.offTitle', { name: profile.display_name })}
          </Txt>
          <Txt variant="faint" style={{ fontSize: 10, textAlign: 'center' }} numberOfLines={2}>
            {t('location.member.offBody')}
          </Txt>
        </View>
      )}
    </View>
  )
}
