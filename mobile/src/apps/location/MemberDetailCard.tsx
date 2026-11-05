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
import { Linking, Pressable, StyleSheet, View } from 'react-native'
import * as Location from 'expo-location'
import { BatteryFull, BatteryLow, BatteryMedium, BatteryWarning, Bell, Navigation, Phone, X } from 'lucide-react-native'

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
import { fonts, radius, sp } from '@/theme/theme'
import { ON_CARD } from './onCard'
import {
  CARD_H,
  CARD_W_EXPANDED,
  MemberAvatar,
  MemberCardShell,
  WatchingChip,
  timeAgo,
} from './locationUi'

/** One stat, set straight on the gradient — no tile (owner, 2026-11: boxed
 *  stats looked like the action buttons under them). Columns are split by
 *  thin vertical rules instead. The ETA is `primary`: a size up. */
function Stat({ label, value, primary, icon }: { label: string; value: string; primary?: boolean; icon?: React.ReactNode }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      {/* Explicit lineHeights: the card is a FIXED 168pt (see the budget at
          the top) and the display font's natural line box would overflow it. */}
      <Txt
        style={{ fontFamily: fonts.display, fontSize: primary ? 21 : 17, lineHeight: primary ? 25 : 21, color: ON_CARD.text }}
        numberOfLines={1}
      >
        {value}
      </Txt>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
        {icon}
        <Txt
          style={{
            fontFamily: fonts.semibold,
            fontSize: 8.5,
            lineHeight: 11,
            color: ON_CARD.muted,
            textTransform: 'uppercase',
            letterSpacing: 0.6,
          }}
        >
          {label}
        </Txt>
      </View>
    </View>
  )
}

/** A tiny battery beside the BATTERY label (owner, 2026-11): the drawing
 *  follows the level, white like the rest of the card, a soft red when low. */
function BatteryGlyph({ level }: { level: number }) {
  const color = level <= 15 ? '#FFB4A8' : ON_CARD.muted
  const Icon = level <= 15 ? BatteryWarning : level <= 40 ? BatteryLow : level <= 75 ? BatteryMedium : BatteryFull
  return <Icon size={11} color={color} strokeWidth={2.4} />
}

/** The subtle vertical rule between stats. */
function Rule() {
  return <View style={{ width: StyleSheet.hairlineWidth * 2, alignSelf: 'stretch', marginVertical: 6, backgroundColor: 'rgba(255,255,255,0.35)' }} />
}

/** One action pill on the gradient: icon + label side by side. */
function IconAction({
  icon,
  label,
  onPress,
}: {
  icon: React.ReactNode
  label: string
  onPress: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        {
          flex: 1,
          flexDirection: 'row',
          backgroundColor: ON_CARD.soft,
          borderRadius: radius.pill,
          height: 36,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 5,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      {icon}
      <Txt style={{ fontFamily: fonts.semibold, fontSize: 12, lineHeight: 15, color: ON_CARD.text }} numberOfLines={1}>
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
  /** Our x within the roster's content, once laid out — the parent uses it to
   *  scroll this card fully into view. Reported from onLayout rather than
   *  computed by the parent, because the parent would have to guess at our
   *  width before we've grown into it. */
  onLaidOut?: (x: number) => void
}) {
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
    <View onLayout={(e) => onLaidOut?.(e.nativeEvent.layout.x)}>
      {/* The same gradient card as the collapsed one, only wider — the person's
          colour carries over from their pin and their small card. */}
      <MemberCardShell color={color} width={CARD_W_EXPANDED} height={CARD_H} style={{ padding: sp.md, gap: sp.sm }}>
        {/* Header: who, where, and a way back to the compact card. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
          <MemberAvatar name={profile.display_name} avatarPath={avatarPath} color={color} size={40} ringColor={ON_CARD.ring} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Txt
                style={{ fontFamily: fonts.display, fontSize: 16, lineHeight: 19, color: ON_CARD.text, flexShrink: 1 }}
                numberOfLines={1}
              >
                {isMe ? t('location.you') : profile.display_name}
              </Txt>
              {watched ? <WatchingChip light /> : null}
            </View>
            <Txt style={{ fontSize: 11.5, lineHeight: 14, color: ON_CARD.muted }} numberOfLines={1}>
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
            // Top corner, not centred on the 40pt avatar row — centring read
            // as sagging. A soft round button so it reads on any member colour.
            style={{
              alignSelf: 'flex-start',
              width: 26,
              height: 26,
              borderRadius: 13,
              backgroundColor: ON_CARD.soft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={14} color={ON_CARD.text} />
          </Pressable>
        </View>

        {live && !isMe ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', height: 43 }}>
              {/* ETA leads — Arthur's call, and it's the thing you open this for. */}
              <Stat label={t('location.stat.eta')} value={etaText} primary />
              <Rule />
              <Stat label={t('location.stat.distance')} value={distText} />
              <Rule />
              <Stat
                label={t('location.stat.battery')}
                value={battText}
                icon={live?.battery != null ? <BatteryGlyph level={live.battery} /> : null}
              />
            </View>
            {/* Three actions, not five: the map apps live behind "Navigate" so
                these keep enough width for a readable label. */}
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 'auto' }}>
              <IconAction
                icon={<Navigation size={14} color={ON_CARD.text} />}
                label={t('location.action.navigate')}
                onPress={onNavigate}
              />
              <IconAction
                icon={<Bell size={14} color={ON_CARD.text} />}
                label={t('location.action.nudge')}
                onPress={onNudge}
              />
              {phone ? (
                <IconAction
                  icon={<Phone size={14} color={ON_CARD.text} />}
                  label={t('location.action.call')}
                  onPress={() => void Linking.openURL(`tel:${phone}`)}
                />
              ) : null}
            </View>
          </>
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, paddingHorizontal: sp.sm }}>
            <Navigation size={20} color={ON_CARD.muted} />
            <Txt style={{ fontFamily: fonts.semibold, fontSize: 12.5, color: ON_CARD.text, textAlign: 'center' }}>
              {isPaused(location)
                ? t('location.member.pausedTitle', { name: profile.display_name })
                : t('location.member.offTitle', { name: profile.display_name })}
            </Txt>
            <Txt style={{ fontSize: 10.5, color: ON_CARD.muted, textAlign: 'center' }} numberOfLines={2}>
              {t('location.member.offBody')}
            </Txt>
          </View>
        )}
      </MemberCardShell>
    </View>
  )
}
