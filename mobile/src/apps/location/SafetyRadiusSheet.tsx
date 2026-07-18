// Safety Radius / "event mode" — the Plus feature. Two states:
//   • no watch  → pick who to watch + a radius, centred on you, then Start.
//   • watching  → live status per member (Inside / Outside + distance) and Stop.
// Breach alerts themselves are raised by the Whereabouts screen, which already
// has the live member_locations feed.
import { useMemo, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ShieldCheck } from 'lucide-react-native'

import { Btn, Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { formatDistance, haversineMeters, isSharingLive } from '@/lib/location'
import { RADIUS_PRESETS, isOutside, startWatch, stopWatch, WATCH_HOURS } from '@/lib/safetyRadius'
import type { MemberLocation, Profile, SafetyWatch } from '@/lib/types'
import { fonts, radius as R, sp, useTheme } from '@/theme/theme'
import { MemberAvatar } from './locationUi'

export function SafetyRadiusSheet({
  watch,
  profiles,
  colors,
  locByEmail,
  myEmail,
  myLive,
  avatars,
  onChanged,
  onClose,
}: {
  watch: SafetyWatch | null
  profiles: Profile[]
  colors: Record<string, string>
  locByEmail: Map<string, MemberLocation>
  myEmail: string | null
  myLive: (MemberLocation & { lat: number; lng: number }) | null
  avatars: Record<string, string | null>
  onChanged: () => void
  onClose: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const insets = useSafeAreaInsets()

  const others = useMemo(() => profiles.filter((p) => p.email !== myEmail), [profiles, myEmail])
  const [picked, setPicked] = useState<string[]>(watch?.watched ?? [])
  const [radiusM, setRadiusM] = useState(watch?.radius_m ?? 150)
  const [busy, setBusy] = useState(false)

  const toggle = (email: string) =>
    setPicked((cur) => (cur.includes(email) ? cur.filter((e) => e !== email) : [...cur, email]))

  const start = async () => {
    if (!myLive || !picked.length || busy) return
    setBusy(true)
    try {
      await startWatch({
        center: { lat: myLive.lat, lng: myLive.lng },
        radius_m: radiusM,
        watched: picked,
      })
      onChanged()
      onClose()
    } catch {
      // surfaced by the caller's toast on next refresh
    } finally {
      setBusy(false)
    }
  }

  const stop = async () => {
    setBusy(true)
    await stopWatch().catch(() => {})
    onChanged()
    setBusy(false)
    onClose()
  }

  const hoursLeft = watch
    ? Math.max(1, Math.round((new Date(watch.expires_at).getTime() - Date.now()) / 3_600_000))
    : WATCH_HOURS

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
            maxHeight: '85%',
          }}
        >
          <View style={{ width: 38, height: 5, borderRadius: 3, backgroundColor: c.border, alignSelf: 'center' }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <ShieldCheck size={22} color={c.accent} />
            <View style={{ flex: 1 }}>
              <Txt style={{ fontFamily: fonts.displaySemi, fontSize: 22, color: c.text }}>
                {t('location.safety.title')}
              </Txt>
              <Txt variant="muted">{t('location.safety.subtitle')}</Txt>
            </View>
          </View>

          {watch ? (
            /* ── Active: live status per watched member ── */
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Txt style={{ fontFamily: fonts.semibold, fontSize: 15, color: c.text }}>
                  {t('location.safety.active', { count: watch.watched.length })}
                </Txt>
                <Txt variant="faint">{t('location.safety.endsIn', { hours: hoursLeft })}</Txt>
              </View>

              <ScrollView style={{ flexGrow: 0 }}>
                {watch.watched.map((email) => {
                  const p = profiles.find((x) => x.email === email)
                  const loc = locByEmail.get(email)
                  const live = isSharingLive(loc) ? loc : null
                  const out = live ? isOutside(watch, { lat: live.lat, lng: live.lng }) : false
                  const dist = live
                    ? formatDistance(
                        haversineMeters(
                          { lat: watch.center_lat, lng: watch.center_lng },
                          { lat: live.lat, lng: live.lng },
                        ),
                      )
                    : '—'
                  return (
                    <View
                      key={email}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: sp.md,
                        paddingVertical: 10,
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderColor: c.border,
                      }}
                    >
                      <MemberAvatar
                        name={p?.display_name ?? email}
                        avatarPath={avatars[email]}
                        color={colors[email] ?? c.accent}
                        size={36}
                      />
                      <Txt style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 14, color: c.text }} numberOfLines={1}>
                        {p?.display_name ?? email.split('@')[0]}
                      </Txt>
                      <Txt variant="faint" style={{ fontSize: 12 }}>
                        {dist}
                      </Txt>
                      <View
                        style={{
                          paddingHorizontal: 9,
                          paddingVertical: 3,
                          borderRadius: R.pill,
                          backgroundColor: out ? c.expense : c.income,
                        }}
                      >
                        <Txt style={{ fontFamily: fonts.semibold, fontSize: 11, color: '#fff' }}>
                          {out ? t('location.safety.outside') : t('location.safety.inside')}
                        </Txt>
                      </View>
                    </View>
                  )
                })}
              </ScrollView>

              <Btn title={t('location.safety.stop')} variant="secondary" onPress={stop} loading={busy} />
            </>
          ) : (
            /* ── Setup: pick people + radius, centred on me ── */
            <>
              {!myLive ? (
                <Txt variant="muted">{t('location.safety.needLocation')}</Txt>
              ) : (
                <Txt variant="muted" style={{ fontSize: 13 }}>
                  {t('location.safety.center')}
                </Txt>
              )}

              <Txt variant="label">{t('location.safety.pickPeople')}</Txt>
              <ScrollView style={{ flexGrow: 0 }}>
                {others.map((p) => {
                  const on = picked.includes(p.email)
                  return (
                    <Pressable
                      key={p.email}
                      onPress={() => toggle(p.email)}
                      style={({ pressed }) => [
                        {
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: sp.md,
                          paddingVertical: 10,
                          borderTopWidth: StyleSheet.hairlineWidth,
                          borderColor: c.border,
                        },
                        pressed && { opacity: 0.6 },
                      ]}
                    >
                      <MemberAvatar
                        name={p.display_name}
                        avatarPath={avatars[p.email]}
                        color={colors[p.email] ?? c.accent}
                        size={36}
                      />
                      <Txt style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 14, color: c.text }} numberOfLines={1}>
                        {p.display_name}
                      </Txt>
                      <View
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 12,
                          borderWidth: 2,
                          borderColor: on ? c.accent : c.border,
                          backgroundColor: on ? c.accent : 'transparent',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {on ? (
                          <Txt style={{ color: '#fff', fontSize: 13, fontFamily: fonts.semibold }}>✓</Txt>
                        ) : null}
                      </View>
                    </Pressable>
                  )
                })}
              </ScrollView>

              <Txt variant="label">{t('location.safety.radius')}</Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                {RADIUS_PRESETS.map((m) => {
                  const on = radiusM === m
                  return (
                    <Pressable
                      key={m}
                      onPress={() => setRadiusM(m)}
                      style={{
                        paddingVertical: 8,
                        paddingHorizontal: 14,
                        borderRadius: R.pill,
                        backgroundColor: on ? c.accent : c.surface,
                      }}
                    >
                      <Txt style={{ fontFamily: fonts.semibold, fontSize: 13, color: on ? '#fff' : c.text }}>
                        {formatDistance(m)}
                      </Txt>
                    </Pressable>
                  )
                })}
              </View>

              <Btn
                title={t('location.safety.start')}
                onPress={start}
                disabled={!myLive || !picked.length}
                loading={busy}
              />
            </>
          )}
        </View>
      </View>
    </Modal>
  )
}
