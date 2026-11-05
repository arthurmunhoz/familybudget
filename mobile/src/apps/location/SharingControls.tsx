// Your-location controls: the master sharing toggle, temporary pause (1 hour /
// until tonight), and resume — plus the "pausing is visible, never a silent gap"
// reassurance. Turning sharing on requests Always-permission and starts the
// background task; off/pause stops it. All writes go through @/lib/location.
//
// Turning on and resuming both go through `gate()` first, which shows the
// LocationDisclosure screen before the OS background-location prompt — a Google
// Play requirement (PLAY-STORE-RELEASE.md §3.1), not a nicety. Don't call
// ensureBackgroundPermission() from here without it.
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Linking, Modal, Pressable, StyleSheet, View } from 'react-native'
import { Toggle } from '@/components/Toggle'
import { useBottomGap } from '@/hooks/useBottomGap'
import { Clock, EyeOff, Lock, Moon, Pause, Radio } from 'lucide-react-native'

import { Btn, Txt } from '@/components/ui'
import type { ToastData } from '@/components/Toast'
import { useI18n } from '@/hooks/useI18n'
import { supabase } from '@/lib/supabase'
import { captureAndUpload, isPaused, pauseSharing, resumeSharing, setSharing } from '@/lib/location'
import {
  canAskBackgroundPermission,
  ensureBackgroundPermission,
  hasBackgroundPermission,
  startBackgroundUpdates,
  stopBackgroundUpdates,
} from '@/lib/locationTask'
import type { MemberLocation } from '@/lib/types'
import { fonts, radius, sp, useTheme } from '@/theme/theme'
import { LocationDisclosure } from './LocationDisclosure'
import { GroupLabel, SheetHead } from './sheetParts'
import { FEATURE } from './onCard'

/** Local 12-hour clock without depending on Intl being present on Android. */
function clock(d: Date): string {
  let h = d.getHours()
  const m = d.getMinutes().toString().padStart(2, '0')
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${m} ${ampm}`
}

/** A pause choice as a tile (icon + label), two side by side. */
function PauseTile({ label, icon, onPress }: { label: string; icon: React.ReactNode; onPress: () => void }) {
  const { c, dark } = useTheme()
  const tint = FEATURE.sharing
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        {
          flex: 1,
          borderRadius: 20,
          padding: sp.md,
          gap: sp.sm,
          backgroundColor: tint + (dark ? '26' : '14'),
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: tint + '40',
        },
        pressed && { opacity: 0.6 },
      ]}
    >
      <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }}>
        {icon}
      </View>
      <Txt style={{ fontFamily: fonts.display, fontSize: 16, lineHeight: 20, color: c.text }}>{label}</Txt>
    </Pressable>
  )
}

export function SharingControls({
  myLocation,
  onChanged,
  onToast,
  onClose,
}: {
  myLocation: MemberLocation | null
  /** `patch` is applied to MY roster row immediately, so the card over the map
   *  shows the new state on the same tap instead of after a refetch. */
  onChanged: (patch?: Partial<MemberLocation>) => void
  onToast: (t: ToastData) => void
  onClose: () => void
}) {
  const { c, dark } = useTheme()
  const { t } = useI18n()
  const bottomGap = useBottomGap(sp.xs)

  const [on, setOn] = useState(!!myLocation?.sharing)
  const [pausedUntil, setPausedUntil] = useState<Date | null>(
    isPaused(myLocation) && myLocation?.paused_until ? new Date(myLocation.paused_until) : null,
  )
  const [permDenied, setPermDenied] = useState(false)
  const [householdName, setHouseholdName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Which action is waiting behind the prominent disclosure (see `gate` below).
  const [pending, setPending] = useState<'enable' | 'resume' | null>(null)
  /** A ref as well as `busy`, because state is set asynchronously: two taps in
   *  the same frame both read `busy === false` and both start an action. The
   *  ref flips synchronously, so the second tap loses. */
  const inFlight = useRef(false)

  /** Run one sharing action at a time, with the switch showing progress for the
   *  WHOLE of it — including the permission check, which used to run before
   *  anything was marked busy. */
  const run = (fn: () => Promise<void>) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    void fn()
      .catch(() => {
        // A write that failed used to reject into `void` and vanish, leaving the
        // switch showing a state the household cannot actually see. Say so, and
        // put the switch back where the server still has it.
        setOn(!!myLocation?.sharing)
        toast(t('location.toast.failed'))
      })
      .finally(() => {
      inFlight.current = false
      setBusy(false)
    })
  }

  useEffect(() => {
    let active = true
    supabase
      .from('households')
      .select('name')
      .maybeSingle()
      .then(({ data }) => {
        if (active) setHouseholdName((data as { name?: string } | null)?.name ?? null)
      })
    return () => {
      active = false
    }
  }, [])

  const fgLabels = { title: t('location.fg.title'), body: t('location.fg.body') }
  const toast = (text: string) => onToast({ emoji: '📍', text })

  /** Put the first fix on the map WITHOUT holding the UI open for it.
   *
   *  `captureAndUpload` asks for a fresh GPS position, and a cold GPS fix on
   *  Android is seconds — tens of them indoors. Awaiting it before flipping the
   *  switch is what made turning sharing on feel broken: the toggle sprang back,
   *  nothing happened, and people tapped again. The background task is already
   *  running by this point and reports fixes on its own, so this only makes the
   *  dot appear sooner; `onChanged` re-runs when it lands. */
  const primeFirstFix = () => {
    void captureAndUpload()
      .then(() => onChanged())
      .catch(() => {})
  }

  const enable = async () => {
    // Optimistic: the switch moves on touch. Reverted below if the OS prompt is
    // declined, which is the only way this fails visibly.
    setOn(true)
    const ok = await ensureBackgroundPermission()
    if (!ok) {
      setOn(false)
      setPermDenied(true)
      return
    }
    setPermDenied(false)
    await setSharing(true)
    await startBackgroundUpdates(fgLabels).catch(() => {})
    setPausedUntil(null)
    toast(t('location.toast.on'))
    onChanged({ sharing: true, paused_until: null })
    primeFirstFix()
  }

  const disable = async () => {
    setOn(false)
    setPausedUntil(null)
    await setSharing(false)
    await stopBackgroundUpdates().catch(() => {})
    toast(t('location.toast.off'))
    onChanged({ sharing: false, paused_until: null, lat: null, lng: null })
  }

  const doPause = async (until: Date) => {
    setPausedUntil(until)
    await pauseSharing(until)
    await stopBackgroundUpdates().catch(() => {})
    toast(t('location.toast.paused'))
    onChanged({ sharing: true, paused_until: until.toISOString(), lat: null, lng: null })
  }

  const resume = async () => {
    setPausedUntil(null)
    setOn(true)
    const ok = await ensureBackgroundPermission()
    if (!ok) {
      setPermDenied(true)
      return
    }
    await resumeSharing()
    await startBackgroundUpdates(fgLabels).catch(() => {})
    toast(t('location.toast.on'))
    onChanged({ sharing: true, paused_until: null })
    primeFirstFix()
  }

  /** Google Play requires the prominent disclosure to be on screen BEFORE the
   *  background-location prompt (PLAY-STORE-RELEASE.md §3.1), so every path that
   *  can reach ensureBackgroundPermission() runs through here first. When
   *  permission is already granted no prompt will appear, so the disclosure is
   *  skipped and the action runs straight away. */
  const gate = (action: 'enable' | 'resume') => {
    run(async () => {
      if (await hasBackgroundPermission()) {
        await (action === 'enable' ? enable() : resume())
        return
      }
      // Only trust Android's "the OS won't prompt" signals AFTER an attempt
      // has actually failed (permDenied). Pre-checking on the first try is
      // how sharing went completely dead on a fresh/revoked install
      // (2026-09-22): Android reports denied + !canAskAgain for a permission
      // a request WOULD happily prompt for — a Settings revoke resets to
      // exactly that combo — so the disclosure and the dialog never appeared
      // at all. Once an attempt HAS failed, the check earns its keep: it
      // stops the loop of re-accepting the disclosure with no dialog behind
      // it (the Settings hint is already on screen at that point).
      if (permDenied && !(await canAskBackgroundPermission())) {
        if (action === 'enable') setOn(false)
        return
      }
      setPending(action)
    })
  }

  const onToggle = (v: boolean) => {
    if (v) gate('enable')
    else run(disable)
  }

  const in1h = () => new Date(Date.now() + 60 * 60 * 1000)
  const endOfToday = () => {
    const d = new Date()
    d.setHours(23, 59, 0, 0)
    return d
  }

  const tint = FEATURE.sharing
  const stateLine = busy
    ? on
      ? t('location.share.turningOn')
      : t('location.share.turningOff')
    : !on
      ? t('location.share.off')
      : pausedUntil
        ? t('location.share.pausedUntil', { time: clock(pausedUntil) })
        : householdName
          ? t('location.share.visibleTo', { name: householdName })
          : t('location.share.toggle')

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('common.done')} />
        <View
          style={{
            backgroundColor: c.sheet,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            padding: sp.lg,
            // Half of iOS's inset (Done's curve meets the screen's), all of
            // Android's navigation bar.
            paddingBottom: bottomGap,
            gap: sp.md,
          }}
        >
          <SheetHead
            title={t('location.share.title')}
            sub={stateLine}
            tint={on ? tint : '#8A8F98'}
            icon={on ? <Radio size={24} color="#fff" /> : <EyeOff size={24} color="#fff" />}
            onClose={onClose}
          />

          {/* The master switch, as the sheet's main card: the state in big
              type, the switch beside it. */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: sp.md,
              backgroundColor: on ? tint + (dark ? '2E' : '17') : c.card,
              borderRadius: 22,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: on ? tint + '55' : c.border,
              padding: sp.lg,
            }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt style={{ fontFamily: fonts.display, fontSize: 19, lineHeight: 24, color: c.text }}>
                {on ? t('location.share.toggle') : t('location.share.off')}
              </Txt>
              <Txt variant="muted" style={{ fontSize: 13, marginTop: 2 }}>
                {t('location.share.subtitle')}
              </Txt>
            </View>
            {busy ? <ActivityIndicator color={tint} /> : null}
            <Toggle value={on} onValueChange={onToggle} disabled={busy} />
          </View>

          {permDenied ? (
            <View style={{ backgroundColor: c.accentSoft, borderRadius: 18, padding: sp.md, gap: 6 }}>
              <Txt variant="muted" style={{ fontSize: 13 }}>
                {t('location.share.permBody')}
              </Txt>
              <Pressable onPress={() => void Linking.openSettings()}>
                <Txt style={{ fontFamily: fonts.semibold, fontSize: 14, color: c.accent }}>
                  {t('location.share.openSettings')}
                </Txt>
              </Pressable>
            </View>
          ) : null}

          {/* Pause / resume — only meaningful while sharing is on */}
          {on ? (
            pausedUntil ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: sp.md,
                  backgroundColor: '#F2A93B' + (dark ? '26' : '1F'),
                  borderRadius: 22,
                  padding: sp.md,
                }}
              >
                <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }}>
                  <Pause size={18} color="#C8862A" />
                </View>
                <Txt style={{ flex: 1, fontFamily: fonts.display, fontSize: 16, lineHeight: 21, color: c.text }}>
                  {t('location.share.pausedUntil', { time: clock(pausedUntil) })}
                </Txt>
                <Pressable
                  onPress={() => gate('resume')}
                  disabled={busy}
                  accessibilityRole="button"
                  style={({ pressed }) => ({
                    paddingHorizontal: 14,
                    height: 36,
                    borderRadius: radius.pill,
                    backgroundColor: tint,
                    justifyContent: 'center',
                    opacity: pressed || busy ? 0.7 : 1,
                  })}
                >
                  <Txt style={{ fontFamily: fonts.semibold, fontSize: 13.5, color: '#fff' }}>{t('location.share.resume')}</Txt>
                </Pressable>
              </View>
            ) : (
              <View>
                <GroupLabel>{t('location.share.break')}</GroupLabel>
                <View style={{ flexDirection: 'row', gap: sp.sm }}>
                  <PauseTile
                    label={t('location.share.pause1h')}
                    icon={<Clock size={18} color={tint} />}
                    onPress={() => run(() => doPause(in1h()))}
                  />
                  <PauseTile
                    label={t('location.share.pauseTonight')}
                    icon={<Moon size={18} color={tint} />}
                    onPress={() => run(() => doPause(endOfToday()))}
                  />
                </View>
              </View>
            )
          ) : null}

          <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'flex-start' }}>
            <Lock size={14} color={c.textFaint} style={{ marginTop: 2 }} />
            <Txt variant="faint" style={{ flex: 1, lineHeight: 18 }}>
              {t('location.share.note')}
            </Txt>
          </View>

          <Btn title={t('common.done')} onPress={onClose} curveBottom />
        </View>
      </View>

      {/* Prominent disclosure — must be on screen BEFORE the OS background
          prompt. Rendered INSIDE this Modal on purpose: a second Modal
          presented as a sibling of an open one silently fails to appear on iOS
          (same pattern as PlacesSheet → PlaceForm). */}
      {pending ? (
        <LocationDisclosure
          onAccept={() => {
            const action = pending
            setPending(null)
            // Through run(), like every other entry point: this is the SLOWEST
            // path — an OS prompt, a write and a task start — so it is the one
            // that most needs the switch to show progress.
            run(action === 'enable' ? enable : resume)
          }}
          onDecline={() => {
            const action = pending
            setPending(null)
            // Nothing was requested and nothing changed — snap the switch back
            // off. (Declining a resume leaves the paused state as it was.)
            if (action === 'enable') setOn(false)
          }}
        />
      ) : null}
    </Modal>
  )
}
