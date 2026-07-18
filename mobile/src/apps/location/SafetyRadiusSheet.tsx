// Safety Radius / "event mode" — the Plus feature. Two states:
//   • no watch  → pick who to watch + a radius, centred on you, then Start.
//   • watching  → live status per member (Inside / Outside + distance) and Stop.
// Breach alerts themselves are raised by the Whereabouts screen, which already
// has the live member_locations feed.
import { useMemo, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ShieldCheck } from 'lucide-react-native'

import { Btn, Field, Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { useKeyboardHeight } from '@/hooks/useKeyboardHeight'
import {
  clampRadius,
  formatDistance,
  haversineMeters,
  isSharingLive,
  radiusUnitOptions,
  safetyRadiusPresets,
} from '@/lib/location'
import { isOutside, startWatch, stopWatch, WATCH_HOURS } from '@/lib/safetyRadius'
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
  const kb = useKeyboardHeight()

  const others = useMemo(() => profiles.filter((p) => p.email !== myEmail), [profiles, myEmail])
  // Three round choices in the user's own units, plus Custom.
  const presets = useMemo(() => safetyRadiusPresets(), [])
  const units = useMemo(() => radiusUnitOptions(), [])
  const [picked, setPicked] = useState<string[]>(watch?.watched ?? [])
  const [radiusM, setRadiusM] = useState(watch?.radius_m ?? presets[1]?.meters ?? 150)

  // A saved radius that isn't one of the presets means it was set by hand.
  const startedCustom = watch ? !presets.some((p) => p.meters === watch.radius_m) : false
  const [custom, setCustom] = useState(startedCustom)
  const [unitId, setUnitId] = useState(units[0]?.id ?? 'm')
  const [customValue, setCustomValue] = useState(() => {
    const u = units[0]
    if (!startedCustom || !watch || !u) return ''
    return String(Math.round((watch.radius_m / u.meters) * 10) / 10)
  })
  const [busy, setBusy] = useState(false)

  // Custom value → metres (clamped to the DB's 50–5000 range). null = unusable.
  const customMeters = (() => {
    const v = parseFloat(customValue.replace(',', '.'))
    if (!isFinite(v) || v <= 0) return null
    const u = units.find((x) => x.id === unitId)
    return u ? clampRadius(v * u.meters) : null
  })()
  const effectiveRadius = custom ? customMeters : radiusM

  const toggle = (email: string) =>
    setPicked((cur) => (cur.includes(email) ? cur.filter((e) => e !== email) : [...cur, email]))

  const start = async () => {
    if (!myLive || !picked.length || busy || !effectiveRadius) return
    setBusy(true)
    try {
      await startWatch({
        center: { lat: myLive.lat, lng: myLive.lng },
        radius_m: effectiveRadius,
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
            // c.sheet (not c.card): the glass skin makes `card` translucent, which
            // would let the map bleed through this panel's text.
            backgroundColor: c.sheet,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            padding: sp.lg,
            // Lift the WHOLE drawer by the keyboard height. While the keyboard is
            // up the home-indicator inset sits behind it, so don't pad twice.
            paddingBottom: (kb > 0 ? 0 : insets.bottom) + sp.lg,
            marginBottom: kb,
            gap: sp.md,
            // Fit the content: a 1-member watch list should be a short sheet, a
            // 6-member one taller — capped so it never swallows the whole screen.
            // (The lists below use flexShrink so they yield once we hit the cap;
            // RN defaults flexShrink to 0, so it has to be explicit.)
            maxHeight: '90%',
          }}
        >
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

              <ScrollView style={{ flexShrink: 1 }}>
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
              {!myLive ? <Txt variant="muted">{t('location.safety.needLocation')}</Txt> : null}

              <Txt variant="label">{t('location.safety.pickPeople')}</Txt>
              <ScrollView style={{ flexShrink: 1 }}>
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
                {presets.map((p) => {
                  const on = !custom && radiusM === p.meters
                  return (
                    <Pressable
                      key={p.meters}
                      onPress={() => {
                        setCustom(false)
                        setRadiusM(p.meters)
                      }}
                      style={{
                        paddingVertical: 8,
                        paddingHorizontal: 14,
                        borderRadius: R.pill,
                        backgroundColor: on ? c.accent : c.surface,
                      }}
                    >
                      <Txt style={{ fontFamily: fonts.semibold, fontSize: 13, color: on ? '#fff' : c.text }}>
                        {p.label}
                      </Txt>
                    </Pressable>
                  )
                })}
                <Pressable
                  onPress={() => setCustom(true)}
                  style={{
                    paddingVertical: 8,
                    paddingHorizontal: 14,
                    borderRadius: R.pill,
                    backgroundColor: custom ? c.accent : c.surface,
                  }}
                >
                  <Txt style={{ fontFamily: fonts.semibold, fontSize: 13, color: custom ? '#fff' : c.text }}>
                    {t('location.safety.custom')}
                  </Txt>
                </Pressable>
              </View>

              {custom ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
                  <View style={{ flex: 1 }}>
                    <Field
                      value={customValue}
                      onChangeText={setCustomValue}
                      keyboardType="numeric"
                      placeholder="0"
                    />
                  </View>
                  {units.map((u) => {
                    const on = unitId === u.id
                    return (
                      <Pressable
                        key={u.id}
                        onPress={() => setUnitId(u.id)}
                        style={{
                          paddingVertical: 10,
                          paddingHorizontal: 16,
                          borderRadius: R.pill,
                          backgroundColor: on ? c.accent : c.surface,
                        }}
                      >
                        <Txt style={{ fontFamily: fonts.semibold, fontSize: 13, color: on ? '#fff' : c.text }}>
                          {u.label}
                        </Txt>
                      </Pressable>
                    )
                  })}
                </View>
              ) : null}

              <Btn
                title={t('location.safety.start')}
                onPress={start}
                disabled={!myLive || !picked.length || !effectiveRadius}
                loading={busy}
              />
            </>
          )}
        </View>
      </View>
    </Modal>
  )
}
