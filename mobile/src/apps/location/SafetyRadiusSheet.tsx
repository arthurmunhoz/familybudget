// Safety Radius / "event mode" — the Plus feature. Two states:
//   • no watch  → pick who to watch + a radius, centred on you, then Start.
//   • watching  → live status per member (Inside / Outside + distance) and Stop.
// Breach alerts themselves are raised by the Whereabouts screen, which already
// has the live member_locations feed.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { router } from 'expo-router'
import { ShieldCheck, Sparkles } from 'lucide-react-native'

import { Btn, Field, Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { usePlus } from '@/lib/plus'
import { useKeyboardHeight } from '@/hooks/useKeyboardHeight'
import {
  clampRadius,
  formatDistance,
  haversineMeters,
  isSharingLive,
  radiusUnitOptions,
  safetyRadiusPresets,
} from '@/lib/location'
import {
  fetchFreeWatchRemaining,
  FREE_WATCH_MINUTES,
  isOutside,
  scheduleWatchEndedNotice,
  startWatch,
  stopWatch,
  WATCH_HOURS,
  WATCH_LIMIT_ERROR,
} from '@/lib/safetyRadius'
import type { MemberLocation, Profile, SafetyWatch } from '@/lib/types'
import { fonts, radius as R, sheetRadius, sp, useTheme } from '@/theme/theme'
import { pickOn } from '@/theme/contrast'
import { MemberAvatar, Section } from './locationUi'

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
  const { isPlus, isFree } = usePlus()
  /** Free plan only: seconds of watching left in the rolling 24h, so the sheet
   *  can say how much is left BEFORE they configure a radius — and tell them
   *  it's gone rather than letting the server bounce them. */
  const [remainingSecs, setRemainingSecs] = useState<number | null>(null)
  const loadRemaining = useCallback(() => {
    if (isPlus) return
    void fetchFreeWatchRemaining()
      .then(setRemainingSecs)
      .catch(() => {})
  }, [isPlus])
  useEffect(() => {
    loadRemaining()
  }, [loadRemaining])
  const spent = isFree && remainingSecs !== null && remainingSecs <= 0
  // Round UP: 90s left should read "2 min", never "1 min" and then cut short.
  const remainingMins = remainingSecs === null
    ? FREE_WATCH_MINUTES
    : Math.max(1, Math.ceil(remainingSecs / 60))

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
      const row = await startWatch({
        center: { lat: myLive.lat, lng: myLive.lng },
        radius_m: effectiveRadius,
        watched: picked,
      })
      // A free watch is ended BY THE SERVER after 30 minutes, so say so at the
      // moment it happens — and say why. Being quietly un-watched at the event
      // you set this up for is the one outcome worth a notification.
      // isFree, not !isPlus: a paying user who starts a watch before the
      // entitlement resolves would otherwise get a "your free watch ended"
      // notice scheduled for a cap that doesn't apply to them.
      if (row && isFree) {
        await scheduleWatchEndedNotice(
          row.expires_at,
          t('location.safety.endedTitle'),
          t('location.safety.endedBody', { mins: FREE_WATCH_MINUTES }),
        )
        // The sheet closes on start, so the countdown it shows goes with it.
        // Confirm how long they actually got, from the SERVER's expiry rather
        // than the constant, so the number can't drift from what's enforced.
        const mins = Math.max(
          1,
          Math.round((new Date(row.expires_at).getTime() - Date.now()) / 60_000),
        )
        // A blocking alert, not a toast: the 30-minute cap is the one thing a
        // free user must actually register (a watch that ends early during the
        // event they set it up for is the bad surprise), and it doubles as the
        // moment Plus is worth reading about. Dismissing needs a tap.
        Alert.alert(
          t('location.safety.startedFreeTitle', { mins }),
          t('location.safety.startedFreeBody'),
          [
            { text: t('common.notNow'), style: 'cancel' },
            { text: t('location.safety.getPlus'), onPress: () => router.push('/paywall') },
          ],
        )
      }
      onChanged()
      onClose()
    } catch (e) {
      if (String((e as { message?: string } | null)?.message ?? '').includes(WATCH_LIMIT_ERROR)) {
        onClose()
        router.push('/paywall')
        return
      }
      // anything else surfaces via the caller's toast on next refresh
    } finally {
      setBusy(false)
    }
  }

  // Turning off does NOT close the sheet: the watch drops away and the setup
  // view takes its place, so it can be turned straight back on — and a free
  // user sees how much of today's allowance the stopped session left them.
  const stop = async () => {
    setBusy(true)
    await stopWatch().catch(() => {})
    onChanged()
    loadRemaining()
    setBusy(false)
  }

  // A free session is 30 minutes, so "Ends in about 1h" would be a lie for most
  // of its life. Under an hour, count in minutes.
  const msLeft = watch ? new Date(watch.expires_at).getTime() - Date.now() : 0
  const endsInLabel = watch
    ? msLeft < 3_600_000
      ? t('location.safety.endsInMin', { mins: Math.max(1, Math.round(msLeft / 60_000)) })
      : t('location.safety.endsIn', { hours: Math.round(msLeft / 3_600_000) })
    : t('location.safety.endsIn', { hours: WATCH_HOURS })

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
            // A plain gap, NOT the safe-area inset: the bottom button's curve is
            // meant to sit down in the screen's corner, and insets.bottom (34pt)
            // would float it well clear of it. Less again while the keyboard is
            // up, since marginBottom below has already lifted the whole drawer
            // (the home-indicator inset sits behind the keyboard anyway).
            paddingBottom: kb > 0 ? sp.lg : sp.xl,
            marginBottom: kb,
            // sp.lg between sections, same rhythm as the place form — sp.md had
            // everything packed together.
            gap: sp.lg,
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
                <Txt variant="faint">{endsInLabel}</Txt>
              </View>

              <Section shrink>
                <ScrollView style={{ flexShrink: 1 }}>
                  {watch.watched.map((email, i) => {
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
                          // No rule above the first row — inside a section card it
                          // would sit right under the card's own edge.
                          borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                          borderColor: c.border,
                        }}
                      >
                        <MemberAvatar
                          name={p?.display_name ?? email}
                          avatarPath={avatars[email]}
                          color={colors[email] ?? c.accent}
                          size={36}
                        />
                        <Txt
                          style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 14, color: c.text }}
                          numberOfLines={1}
                        >
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
                          {/* Not an accent fill, but the identical failure: white
                              on the DARK-mode income green measures 2.43:1, so
                              "Inside" was washing out in Dusk. */}
                          <Txt
                            style={{
                              fontFamily: fonts.semibold,
                              fontSize: 11,
                              color: pickOn(out ? c.expense : c.income),
                            }}
                          >
                            {out ? t('location.safety.outside') : t('location.safety.inside')}
                          </Txt>
                        </View>
                      </View>
                    )
                  })}
                </ScrollView>
              </Section>

              {/* Same slot as "Start watching" below, so it gets the same curve
                  — the sheet's bottom control shouldn't change shape with state. */}
              <Btn
                title={t('location.safety.stop')}
                variant="danger"
                onPress={stop}
                loading={busy}
                style={{
                  borderBottomLeftRadius: sheetRadius,
                  borderBottomRightRadius: sheetRadius,
                }}
              />
            </>
          ) : (
            /* ── Setup: pick people + radius, centred on me ── */
            <>
              {!myLive ? <Txt variant="muted">{t('location.safety.needLocation')}</Txt> : null}

              <Section title={t('location.safety.pickPeople')} shrink>
                <ScrollView style={{ flexShrink: 1 }}>
                  {others.map((p, i) => {
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
                            borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
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
                        <Txt
                          style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 14, color: c.text }}
                          numberOfLines={1}
                        >
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
                            <Txt style={{ color: c.onAccent, fontSize: 13, fontFamily: fonts.semibold }}>✓</Txt>
                          ) : null}
                        </View>
                      </Pressable>
                    )
                  })}
                </ScrollView>
              </Section>

              <Section title={t('location.safety.radius')}>
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
                        <Txt
                          style={{ fontFamily: fonts.semibold, fontSize: 13, color: on ? c.onAccent : c.text }}
                        >
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
                    <Txt
                      style={{ fontFamily: fonts.semibold, fontSize: 13, color: custom ? c.onAccent : c.text }}
                    >
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
                          <Txt
                            style={{ fontFamily: fonts.semibold, fontSize: 13, color: on ? c.onAccent : c.text }}
                          >
                            {u.label}
                          </Txt>
                        </Pressable>
                      )
                    })}
                  </View>
                ) : null}
              </Section>

              {/* Bottom corners follow the iPhone's screen curve, so the sheet's
                  final control sits down in the corner instead of cutting square
                  across it. Same treatment as Pet Care's "Add task" and the
                  Places footer — this one keeps its filled style, though: it's
                  the primary commit action, not an "add another" affordance. */}
              {spent ? (
                /* Their one watch is already gone. Say so here rather than
                   letting them pick people and a radius and then bouncing them
                   off a server error — the answer is knowable before they
                   start. */
                <View style={{ gap: sp.sm }}>
                  <View
                    style={{
                      flexDirection: 'row',
                      gap: sp.sm,
                      backgroundColor: c.surface,
                      borderRadius: R.md,
                      borderWidth: StyleSheet.hairlineWidth,
                      borderColor: c.border,
                      padding: sp.md,
                    }}
                  >
                    <Sparkles size={16} color={c.accent} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Txt style={{ fontFamily: fonts.semibold, fontSize: 13, color: c.text }}>
                        {t('location.safety.usedToday')}
                      </Txt>
                      <Txt variant="faint" style={{ fontSize: 11 }}>
                        {t('location.safety.usedTodayBody')}
                      </Txt>
                    </View>
                  </View>
                  <Btn
                    title={t('location.safety.getPlus')}
                    onPress={() => {
                      onClose()
                      router.push('/paywall')
                    }}
                    style={{
                      borderBottomLeftRadius: sheetRadius,
                      borderBottomRightRadius: sheetRadius,
                    }}
                  />
                </View>
              ) : (
                <>
                  {/* The free limit stated BEFORE committing, not after the
                      sheet has closed — a faint one-liner here was too easy to
                      miss, and being silently un-watched later is the bad
                      outcome. Tappable, so "Plus gives you more" is an action
                      rather than a claim. */}
                  {isFree ? (
                    <Pressable
                      onPress={() => {
                        onClose()
                        router.push('/paywall')
                      }}
                      accessibilityRole="button"
                      style={({ pressed }) => [
                        {
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: sp.sm,
                          backgroundColor: c.accentSoft,
                          borderRadius: R.md,
                          padding: sp.md,
                        },
                        pressed && { opacity: 0.75 },
                      ]}
                    >
                      <Sparkles size={16} color={c.accent} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Txt style={{ fontFamily: fonts.semibold, fontSize: 13, color: c.text }}>
                          {t('location.safety.freeRemaining', { mins: remainingMins })}
                        </Txt>
                        <Txt variant="faint" style={{ fontSize: 11 }}>
                          {t('location.safety.freeNoteBody')}
                        </Txt>
                      </View>
                    </Pressable>
                  ) : null}
                  <Btn
                    title={t('location.safety.start')}
                    onPress={start}
                    disabled={!myLive || !picked.length || !effectiveRadius}
                    loading={busy}
                    style={{
                      borderBottomLeftRadius: sheetRadius,
                      borderBottomRightRadius: sheetRadius,
                    }}
                  />
                </>
              )}
            </>
          )}
        </View>
      </View>
    </Modal>
  )
}
