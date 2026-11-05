// Safety Radius / "event mode" — the Plus feature. Two states:
//   • no watch  → pick who to watch + a radius, centred on you, then Start.
//   • watching  → live status per member (Inside / Outside + distance) and Stop.
// Breach alerts themselves are raised by the Whereabouts screen, which already
// has the live member_locations feed.
//
// 2026-11 redesign (components/form): people are rows of one section with a
// check on the right, the radius is a SelectRow of the three presets + Custom
// (Custom adds one "value + unit ⌄" row), and the primary action is docked.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Modal, StyleSheet, View } from 'react-native'
import { Pressable } from '@/components/Pressable'
import { router } from 'expo-router'
import { Check, ShieldCheck, Sparkles } from 'lucide-react-native'

import { Btn, DismissKeyboard, Txt } from '@/components/ui'
import { KeyboardScroll } from '@/components/KeyboardScroll'
import { NumberBox, UnitButton } from '@/components/form'
import { useI18n } from '@/hooks/useI18n'
import { usePlus } from '@/lib/plus'
import { useSheetLift } from '@/hooks/useSheetLift'
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
import { useBottomGap } from '@/hooks/useBottomGap'
import { fonts, radius as R, sp, useTheme } from '@/theme/theme'
import { pickOn } from '@/theme/contrast'
import { MemberAvatar, Pulse } from './locationUi'
import { FeatureButton, GroupLabel, SheetHead } from './sheetParts'
import { FEATURE } from './onCard'
import { GradientBox } from '@/components/home/GradientBox'
import { shade } from '@/components/home/palette'

const CUSTOM = 'custom'

/** One watched member while a watch runs: who, how far from the centre, and
 *  Inside / Outside. */
function StatusRow({
  name,
  avatarPath,
  color,
  dist,
  out,
}: {
  name: string
  avatarPath?: string | null
  color: string
  dist: string
  out: boolean
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const fill = out ? c.expense : c.income
  return (
    <View style={styles.personRow}>
      <MemberAvatar name={name} avatarPath={avatarPath} color={color} size={34} />
      <Txt style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: c.text }} numberOfLines={1}>
        {name}
      </Txt>
      <Txt variant="faint" style={{ fontSize: 12 }}>
        {dist}
      </Txt>
      <View style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: R.pill, backgroundColor: fill }}>
        {/* Not an accent fill, but the identical failure: white on the
            DARK-mode income green measures 2.43:1, so "Inside" was washing
            out in Dusk. */}
        <Txt style={{ fontFamily: fonts.semibold, fontSize: 11, color: pickOn(fill) }}>
          {out ? t('location.safety.outside') : t('location.safety.inside')}
        </Txt>
      </View>
    </View>
  )
}

/** A member to pick for the watch: a big avatar and name, ringed and
 *  checked in the Safety colour when picked. Tiles, not rows (2026-11) —
 *  choosing people is the heart of this sheet. */
function PersonTile({
  name,
  avatarPath,
  color,
  on,
  onPress,
}: {
  name: string
  avatarPath?: string | null
  color: string
  on: boolean
  onPress: () => void
}) {
  const { c } = useTheme()
  const tint = FEATURE.safety
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={name}
      style={({ pressed }) => [styles.personTile, pressed && { opacity: 0.6 }]}
    >
      <View style={[styles.ring, { borderColor: on ? tint : 'transparent' }]}>
        <MemberAvatar name={name} avatarPath={avatarPath} color={color} size={56} ring={false} />
        {on ? (
          <View style={[styles.badge, { backgroundColor: tint, borderColor: c.sheet }]}>
            <Check size={12} color="#fff" strokeWidth={3.2} />
          </View>
        ) : null}
      </View>
      <Txt
        style={{ fontFamily: on ? fonts.semibold : fonts.body, fontSize: 13, color: on ? c.text : c.textMuted, textAlign: 'center' }}
        numberOfLines={1}
      >
        {name.split(' ')[0]}
      </Txt>
    </Pressable>
  )
}

/** The free-plan note: a tinted card (accent as a tint, not a fill). */
function PlanNote({ title, body, onPress }: { title: string; body: string; onPress?: () => void }) {
  const { c } = useTheme()
  const content = (
    <>
      <Sparkles size={16} color={c.accent} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={{ fontFamily: fonts.semibold, fontSize: 13, color: c.text }}>{title}</Txt>
        <Txt variant="faint" style={{ fontSize: 12 }}>
          {body}
        </Txt>
      </View>
    </>
  )
  const box = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: sp.sm,
    backgroundColor: c.accentSoft,
    borderRadius: R.lg,
    padding: sp.md,
  }
  if (!onPress) return <View style={box}>{content}</View>
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [box, pressed && { opacity: 0.75 }]}>
      {content}
    </Pressable>
  )
}

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
  const { c, dark } = useTheme()
  const bottomGap = useBottomGap(sp.xs)
  const { t } = useI18n()
  const { lift, room, clearOfBars, onRootLayout } = useSheetLift()

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

  const radiusOptions = [
    ...presets.map((p) => ({ value: String(p.meters), label: p.label })),
    { value: CUSTOM, label: t('location.safety.custom') },
  ]
  const toPaywall = () => {
    onClose()
    router.push('/paywall')
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop} onLayout={onRootLayout}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('common.done')} />
        <DismissKeyboard
          style={[
            styles.sheet,
            // c.sheet (not c.card): the glass skin makes `card` translucent,
            // which would let the map bleed through this panel's text. Fits
            // its content — a 1-member watch list is a short sheet — capped
            // so it never swallows the whole screen (the body scrolls).
            { backgroundColor: c.sheet, maxHeight: room * 0.92, marginBottom: lift },
          ]}
        >
          <View style={{ paddingHorizontal: sp.lg, paddingBottom: sp.md }}>
            <SheetHead
              title={t('location.safety.title')}
              sub={watch ? endsInLabel : t('location.safety.subtitle')}
              tint={FEATURE.safety}
              icon={<ShieldCheck size={24} color="#fff" />}
              onClose={onClose}
            />
          </View>

          <KeyboardScroll
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ gap: sp.lg, paddingHorizontal: sp.lg, paddingBottom: sp.lg }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {watch ? (
              /* ── Active: a teal hero (who and how long), then each person ── */
              <>
                <GradientBox colors={[FEATURE.safety, shade(FEATURE.safety, -0.25)]} radius={22} style={styles.hero}>
                  <Pulse>
                    <ShieldCheck size={26} color="#fff" />
                  </Pulse>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt style={{ fontFamily: fonts.display, fontSize: 20, lineHeight: 25, color: '#fff' }}>
                      {t('location.safety.active', { count: watch.watched.length })}
                    </Txt>
                    <Txt style={{ fontSize: 13.5, color: 'rgba(255,255,255,0.88)' }}>
                      {formatDistance(watch.radius_m)} · {endsInLabel}
                    </Txt>
                  </View>
                </GradientBox>
                <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
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
                      <View key={email} style={{ borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderColor: c.border }}>
                        <StatusRow
                          name={p?.display_name ?? email.split('@')[0]}
                          avatarPath={avatars[email]}
                          color={colors[email] ?? c.accent}
                          dist={dist}
                          out={out}
                        />
                      </View>
                    )
                  })}
                </View>
              </>
            ) : (
              /* ── Setup: pick people + radius, centred on me ── */
              <>
                {!myLive ? <Txt variant="muted">{t('location.safety.needLocation')}</Txt> : null}

                <View>
                  <GroupLabel>{t('location.safety.pickPeople')}</GroupLabel>
                  <View style={[styles.card, styles.tiles, { backgroundColor: c.card, borderColor: c.border }]}>
                    {others.map((p) => (
                      <PersonTile
                        key={p.email}
                        name={p.display_name}
                        avatarPath={avatars[p.email]}
                        color={colors[p.email] ?? c.accent}
                        on={picked.includes(p.email)}
                        onPress={() => toggle(p.email)}
                      />
                    ))}
                  </View>
                </View>

                <View>
                  <GroupLabel>{t('location.safety.radius')}</GroupLabel>
                  <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border, padding: sp.md, gap: sp.md }]}>
                    {/* The round presets + Custom as chips in the Safety colour. */}
                    <View style={styles.chips}>
                      {radiusOptions.map((o) => {
                        const on = o.value === CUSTOM ? custom : !custom && Number(o.value) === radiusM
                        return (
                          <Pressable
                            key={o.value}
                            onPress={() => {
                              if (o.value === CUSTOM) setCustom(true)
                              else {
                                setCustom(false)
                                setRadiusM(Number(o.value))
                              }
                            }}
                            accessibilityRole="button"
                            accessibilityState={{ selected: on }}
                            style={({ pressed }) => [
                              styles.chip,
                              { backgroundColor: on ? FEATURE.safety : FEATURE.safety + (dark ? '2E' : '1A'), opacity: pressed ? 0.7 : 1 },
                            ]}
                          >
                            <Txt style={{ fontSize: 14, fontFamily: fonts.semibold, color: on ? '#fff' : FEATURE.safety }}>{o.label}</Txt>
                          </Pressable>
                        )
                      })}
                    </View>
                    {custom ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
                        <NumberBox value={customValue} onChangeText={setCustomValue} width={80} />
                        <UnitButton
                          title={t('family.unit')}
                          value={unitId}
                          options={units.map((u) => ({ value: u.id, label: u.label }))}
                          onChange={setUnitId}
                        />
                      </View>
                    ) : null}
                  </View>
                </View>

                {/* Their allowance is already gone: say so here rather than
                    letting them pick people and a radius and then bouncing them
                    off a server error — the answer is knowable before they
                    start. Otherwise the free limit is stated BEFORE committing,
                    not after the sheet has closed, and it's tappable, so "Plus
                    gives you more" is an action rather than a claim. */}
                {spent ? (
                  <PlanNote title={t('location.safety.usedToday')} body={t('location.safety.usedTodayBody')} />
                ) : isFree ? (
                  <PlanNote
                    title={t('location.safety.freeRemaining', { mins: remainingMins })}
                    body={t('location.safety.freeNoteBody')}
                    onPress={toPaywall}
                  />
                ) : null}
              </>
            )}
          </KeyboardScroll>

          {/* The primary action — docked, same slot in every state. */}
          <View
            style={[
              styles.footer,
              { paddingBottom: clearOfBars ? sp.md : bottomGap, borderTopColor: c.border },
            ]}
          >
            {watch ? (
              <Btn title={t('location.safety.stop')} variant="danger" onPress={stop} loading={busy} curveBottom />
            ) : spent ? (
              <Btn title={t('location.safety.getPlus')} onPress={toPaywall} curveBottom />
            ) : (
              <FeatureButton
                tint={FEATURE.safety}
                title={t('location.safety.start')}
                icon={<ShieldCheck size={18} color="#fff" />}
                onPress={start}
                disabled={!myLive || !picked.length || !effectiveRadius}
                busy={busy}
              />
            )}
          </View>
        </DismissKeyboard>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: sp.lg },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: sp.lg,
    paddingBottom: sp.md,
  },
  close: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.md,
    minHeight: 54,
    paddingHorizontal: sp.md,
    paddingVertical: 8,
  },
  footer: { paddingHorizontal: sp.lg, paddingTop: sp.sm },
  card: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  hero: { flexDirection: 'row', alignItems: 'center', gap: sp.md, padding: sp.lg },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', paddingVertical: sp.md, paddingHorizontal: sp.sm },
  personTile: { width: '25%', alignItems: 'center', gap: 6, paddingVertical: 4 },
  ring: { padding: 3, borderRadius: 34, borderWidth: 2.5 },
  badge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm },
  chip: { paddingHorizontal: 14, height: 36, borderRadius: R.pill, justifyContent: 'center' },
})
