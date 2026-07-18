// Member detail — a bottom sheet that opens when you tap a pin or a row. Leads
// with the drive-time ETA (Mapbox Directions), then distance + battery, the
// resolved address, one-tap navigation (Apple Maps / Google / Waze), and quick
// Nudge / Call actions. For a member who isn't sharing it shows a calm empty
// state instead. For yourself it just shows your status.
import { useEffect, useRef, useState } from 'react'
import { Linking, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Location from 'expo-location'
import { Map, MapPin, Navigation, Bell, Phone, X } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import {
  driveEta,
  formatDistance,
  formatEta,
  haversineMeters,
  isPaused,
  isSharingLive,
  openNavigation,
  type NavApp,
} from '@/lib/location'
import { useWatchLive } from '@/lib/liveLocation'
import { fetchPingPresets, presetText, sendPing } from '@/lib/pings'
import type { MemberLocation, PingPreset, Profile } from '@/lib/types'
import { fonts, radius, sp, useTheme } from '@/theme/theme'
import { MemberAvatar } from './locationUi'

function StatTile({
  label,
  value,
  primary,
}: {
  label: string
  value: string
  primary?: boolean
}) {
  const { c } = useTheme()
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: primary ? c.accentSoft : c.surface,
        borderRadius: radius.md,
        paddingVertical: 12,
        paddingHorizontal: 8,
        alignItems: 'center',
        gap: 2,
      }}
    >
      <Txt style={{ fontFamily: fonts.display, fontSize: 20, color: primary ? c.accent : c.text }}>
        {value}
      </Txt>
      <Txt style={{ fontFamily: fonts.semibold, fontSize: 10, color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </Txt>
    </View>
  )
}

/** One map-app hand-off. Each carries its own glyph tinted in that service's
 *  brand colour so they're distinguishable at a glance (we don't ship their
 *  actual trademarked logos). */
function NavButton({
  label,
  icon,
  onPress,
}: {
  label: string
  icon: React.ReactNode
  onPress: () => void
}) {
  const { c } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        {
          flex: 1,
          backgroundColor: c.surface,
          borderRadius: radius.md,
          paddingVertical: 10,
          alignItems: 'center',
          gap: 4,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      {icon}
      <Txt style={{ fontFamily: fonts.semibold, fontSize: 12, color: c.text }}>{label}</Txt>
    </Pressable>
  )
}

function ActionButton({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  const { c } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        {
          flex: 1,
          backgroundColor: c.sheet,
          borderWidth: 1,
          borderColor: c.border,
          borderRadius: radius.md,
          paddingVertical: 10,
          alignItems: 'center',
          gap: 3,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      {icon}
      <Txt style={{ fontFamily: fonts.semibold, fontSize: 12, color: c.text }}>{label}</Txt>
    </Pressable>
  )
}

export function MemberSheet({
  profile,
  location,
  isMe,
  color,
  avatarPath,
  phone,
  myLive,
  onClose,
  onNudged,
}: {
  profile: Profile
  location: MemberLocation | null
  isMe: boolean
  color: string
  avatarPath?: string | null
  phone?: string
  myLive: (MemberLocation & { lat: number; lng: number }) | null
  onClose: () => void
  /** Confirmation text after a nudge is sent (the parent shows the toast). */
  onNudged?: (text: string) => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const insets = useSafeAreaInsets()

  const live = isSharingLive(location) ? location : null
  const [eta, setEta] = useState<{ minutes: number } | null>(null)
  const [etaLoading, setEtaLoading] = useState(false)
  const [address, setAddress] = useState<string | null>(null)

  // Nudge picker — kept in-place so the user never leaves the map to send one.
  const [nudgeOpen, setNudgeOpen] = useState(false)
  const [presets, setPresets] = useState<PingPreset[]>([])
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!nudgeOpen || presets.length) return
    void fetchPingPresets()
      .then(setPresets)
      .catch(() => {})
  }, [nudgeOpen, presets.length])

  const sendNudge = async (p: PingPreset) => {
    if (sending) return
    setSending(true)
    try {
      await sendPing(p.preset_key ?? 'custom', p.emoji, presetText(p, t), [profile.email])
      onNudged?.(t('location.nudge.sent', { name: profile.display_name }))
    } catch {
      // swallow — the picker closes either way
    } finally {
      setSending(false)
      setNudgeOpen(false)
    }
  }

  // Keep the latest coords in refs so the ETA/address effects can read them
  // without re-running on every tiny move — they key on a coarse ~100 m grid.
  const liveRef = useRef(live)
  liveRef.current = live
  const myLiveRef = useRef(myLive)
  myLiveRef.current = myLive
  const targetKey = live ? `${live.lat.toFixed(3)},${live.lng.toFixed(3)}` : null
  const myKey = myLive ? `${myLive.lat.toFixed(3)},${myLive.lng.toFixed(3)}` : null

  // Live mode: while this sheet is open on a sharing member (not me), ask their
  // device to ramp up to high-frequency GPS so their pin moves in near real time.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey])

  const distText = live && myLive ? formatDistance(haversineMeters(myLive, live)) : '—'
  const etaText = etaLoading ? '…' : eta ? formatEta(eta.minutes) : '—'
  const battText = live && live.battery != null ? `${live.battery}%` : '—'

  const nav = (app: NavApp) => {
    if (live) void openNavigation(app, { lat: live.lat, lng: live.lng }, profile.display_name)
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' }}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('common.done')} />
        <View
          style={{
            backgroundColor: c.sheet,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            padding: sp.lg,
            paddingBottom: insets.bottom + sp.lg,
            gap: sp.md,
          }}
        >
          <View style={{ width: 38, height: 5, borderRadius: 3, backgroundColor: c.border, alignSelf: 'center' }} />

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
            <MemberAvatar name={profile.display_name} avatarPath={avatarPath} color={color} size={54} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Txt
                  style={{ fontFamily: fonts.displaySemi, fontSize: 20, color: c.text, flexShrink: 1 }}
                  numberOfLines={1}
                >
                  {isMe ? `${profile.display_name} · ${t('location.you')}` : profile.display_name}
                </Txt>
                {live && !isMe ? (
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      backgroundColor: c.income,
                      borderRadius: radius.pill,
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                    }}
                  >
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' }} />
                    <Txt style={{ fontFamily: fonts.semibold, fontSize: 10, color: '#fff', letterSpacing: 0.5 }}>
                      {t('location.live').toUpperCase()}
                    </Txt>
                  </View>
                ) : null}
              </View>
              {live ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <MapPin size={13} color={c.textMuted} />
                  <Txt variant="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {address ?? t('location.locating')}
                  </Txt>
                </View>
              ) : (
                <Txt variant="muted">
                  {isPaused(location) ? t('location.status.paused') : t('location.status.off')}
                </Txt>
              )}
            </View>
          </View>

          {live && !isMe ? (
            <>
              {/* ETA leads — it's the first, emphasized tile. */}
              <View style={{ flexDirection: 'row', gap: sp.sm }}>
                <StatTile label={t('location.stat.eta')} value={etaText} primary />
                <StatTile label={t('location.stat.distance')} value={distText} />
                <StatTile label={t('location.stat.battery')} value={battText} />
              </View>

              <Txt variant="label">{t('location.navigate')}</Txt>
              <View style={{ flexDirection: 'row', gap: sp.sm }}>
                <NavButton
                  label={t('location.maps.apple')}
                  icon={<Map size={18} color="#007AFF" />}
                  onPress={() => nav('apple')}
                />
                <NavButton
                  label={t('location.maps.google')}
                  icon={<MapPin size={18} color="#34A853" />}
                  onPress={() => nav('google')}
                />
                <NavButton
                  label={t('location.maps.waze')}
                  icon={<Navigation size={18} color="#05C8F7" />}
                  onPress={() => nav('waze')}
                />
              </View>

              <View style={{ flexDirection: 'row', gap: sp.sm }}>
                <ActionButton
                  icon={<Bell size={17} color={c.text} />}
                  label={t('location.action.nudge')}
                  onPress={() => setNudgeOpen(true)}
                />
                {phone ? (
                  <ActionButton
                    icon={<Phone size={17} color={c.text} />}
                    label={t('location.action.call')}
                    onPress={() => void Linking.openURL(`tel:${phone}`)}
                  />
                ) : null}
              </View>
            </>
          ) : live && isMe ? (
            <View style={{ flexDirection: 'row', gap: sp.sm }}>
              <StatTile label={t('location.stat.battery')} value={battText} />
            </View>
          ) : (
            <View style={{ alignItems: 'center', gap: 4, paddingVertical: sp.md }}>
              <Navigation size={26} color={c.textFaint} />
              <Txt variant="h2" style={{ textAlign: 'center' }}>
                {isPaused(location)
                  ? t('location.member.pausedTitle', { name: profile.display_name })
                  : t('location.member.offTitle', { name: profile.display_name })}
              </Txt>
              <Txt variant="muted" style={{ textAlign: 'center' }}>
                {t('location.member.offBody')}
              </Txt>
            </View>
          )}
        </View>

        {/* Nudge picker — an overlay INSIDE this Modal (a sibling <Modal> would
            silently fail to present on iOS), so sending a nudge never takes the
            user off the map. */}
        {nudgeOpen ? (
          <View style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end' }]}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setNudgeOpen(false)}
              accessibilityLabel={t('common.cancel')}
            />
            <View
              style={{
                backgroundColor: c.sheet,
                borderTopLeftRadius: 22,
                borderTopRightRadius: 22,
                padding: sp.lg,
                paddingBottom: insets.bottom + sp.lg,
                gap: sp.md,
                maxHeight: '72%',
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
                <Txt
                  style={{ flex: 1, fontFamily: fonts.displaySemi, fontSize: 20, color: c.text }}
                  numberOfLines={1}
                >
                  {t('location.nudge.title', { name: profile.display_name })}
                </Txt>
                <Pressable onPress={() => setNudgeOpen(false)} hitSlop={10} accessibilityRole="button">
                  <X size={20} color={c.textMuted} />
                </Pressable>
              </View>
              <ScrollView contentContainerStyle={{ gap: sp.sm }}>
                {presets.map((p) => (
                  <Pressable
                    key={p.id}
                    disabled={sending}
                    onPress={() => void sendNudge(p)}
                    style={({ pressed }) => [
                      {
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: sp.md,
                        backgroundColor: c.surface,
                        borderRadius: radius.md,
                        padding: sp.md,
                        opacity: sending ? 0.5 : 1,
                      },
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <Txt style={{ fontSize: 20 }}>{p.emoji}</Txt>
                    <Txt
                      style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: c.text }}
                      numberOfLines={1}
                    >
                      {presetText(p, t)}
                    </Txt>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  )
}
