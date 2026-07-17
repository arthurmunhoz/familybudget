// Member detail — a bottom sheet that opens when you tap a pin or a row. Leads
// with the drive-time ETA (Mapbox Directions), then distance + battery, the
// resolved address, one-tap navigation (Apple Maps / Google / Waze), and quick
// Nudge / Call actions. For a member who isn't sharing it shows a calm empty
// state instead. For yourself it just shows your status.
import { useEffect, useState } from 'react'
import { Linking, Modal, Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import * as Location from 'expo-location'
import { MapPin, Navigation, Bell, Phone } from 'lucide-react-native'

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
import type { MemberLocation, Profile } from '@/lib/types'
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

function NavButton({ label, onPress, primary }: { label: string; onPress: () => void; primary?: boolean }) {
  const { c } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        {
          flex: 1,
          backgroundColor: primary ? c.accent : c.surface,
          borderRadius: radius.md,
          paddingVertical: 11,
          alignItems: 'center',
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Txt style={{ fontFamily: fonts.semibold, fontSize: 13, color: primary ? '#fff' : c.text }}>{label}</Txt>
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
          backgroundColor: c.card,
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
}: {
  profile: Profile
  location: MemberLocation | null
  isMe: boolean
  color: string
  avatarPath?: string | null
  phone?: string
  myLive: (MemberLocation & { lat: number; lng: number }) | null
  onClose: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const insets = useSafeAreaInsets()

  const live = isSharingLive(location) ? location : null
  const [eta, setEta] = useState<{ minutes: number } | null>(null)
  const [etaLoading, setEtaLoading] = useState(false)
  const [address, setAddress] = useState<string | null>(null)

  // Drive-time ETA from me → them (only when both of us are live and it's not me).
  useEffect(() => {
    let active = true
    setEta(null)
    if (!live || isMe || !myLive) return
    setEtaLoading(true)
    driveEta(myLive, { lat: live.lat, lng: live.lng })
      .then((r) => {
        if (active) setEta(r)
      })
      .finally(() => {
        if (active) setEtaLoading(false)
      })
    return () => {
      active = false
    }
  }, [live, isMe, myLive])

  // Human address via the on-device geocoder (no extra key needed).
  useEffect(() => {
    let active = true
    setAddress(null)
    if (!live) return
    Location.reverseGeocodeAsync({ latitude: live.lat, longitude: live.lng })
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
  }, [live])

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
            backgroundColor: c.card,
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
              <Txt style={{ fontFamily: fonts.displaySemi, fontSize: 20, color: c.text }} numberOfLines={1}>
                {isMe ? `${profile.display_name} · ${t('location.you')}` : profile.display_name}
              </Txt>
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
                <NavButton label={t('location.maps.apple')} primary onPress={() => nav('apple')} />
                <NavButton label={t('location.maps.google')} onPress={() => nav('google')} />
                <NavButton label={t('location.maps.waze')} onPress={() => nav('waze')} />
              </View>

              <View style={{ flexDirection: 'row', gap: sp.sm }}>
                <ActionButton
                  icon={<Bell size={17} color={c.text} />}
                  label={t('location.action.nudge')}
                  onPress={() => {
                    onClose()
                    router.push('/pings')
                  }}
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
      </View>
    </Modal>
  )
}
