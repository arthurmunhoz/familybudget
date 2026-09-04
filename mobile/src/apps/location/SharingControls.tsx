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
import { ActivityIndicator, Linking, Modal, Pressable, StyleSheet, Switch, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChevronRight } from 'lucide-react-native'

import { Btn, Txt } from '@/components/ui'
import type { ToastData } from '@/components/Toast'
import { useAuth } from '@/lib/auth'
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

/** Local 12-hour clock without depending on Intl being present on Android. */
function clock(d: Date): string {
  let h = d.getHours()
  const m = d.getMinutes().toString().padStart(2, '0')
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${m} ${ampm}`
}

function PauseRow({ label, onPress }: { label: string; onPress: () => void }) {
  const { c } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
        pressed && { opacity: 0.6 },
      ]}
    >
      <Txt style={{ fontFamily: fonts.medium, fontSize: 15, color: c.text }}>{label}</Txt>
      <ChevronRight size={18} color={c.textFaint} />
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
  onChanged: () => void
  onToast: (t: ToastData) => void
  onClose: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const insets = useSafeAreaInsets()
  const { profiles } = useAuth()

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
    void fn().finally(() => {
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
    onChanged()
    primeFirstFix()
  }

  const disable = async () => {
    setOn(false)
    setPausedUntil(null)
    await setSharing(false)
    await stopBackgroundUpdates().catch(() => {})
    toast(t('location.toast.off'))
    onChanged()
  }

  const doPause = async (until: Date) => {
    setPausedUntil(until)
    await pauseSharing(until)
    await stopBackgroundUpdates().catch(() => {})
    toast(t('location.toast.paused'))
    onChanged()
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
    onChanged()
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
      // The OS will not prompt again — showing the disclosure would put the
      // user in a loop: accept, no dialog appears, the switch snaps back, and
      // the only way forward (Settings) is hidden behind the very screen they
      // keep re-accepting. Go straight to the Settings hint instead.
      if (!(await canAskBackgroundPermission())) {
        if (action === 'enable') setOn(false)
        setPermDenied(true)
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
          <View>
            <Txt style={{ fontFamily: fonts.displaySemi, fontSize: 22, color: c.text }}>{t('location.share.title')}</Txt>
            <Txt variant="muted">{t('location.share.subtitle')}</Txt>
          </View>

          {/* Master toggle */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: c.surface,
              borderRadius: radius.md,
              padding: sp.md,
            }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt style={{ fontFamily: fonts.semibold, fontSize: 15, color: c.text }}>
                {on ? t('location.share.toggle') : t('location.share.off')}
              </Txt>
              {/* While an action runs, say so where the reassurance line goes —
                  turning sharing on can wait on an OS prompt and a network
                  write, and silence there is what made people tap twice. */}
              {busy ? (
                <Txt variant="muted" style={{ fontSize: 12 }}>
                  {on ? t('location.share.turningOn') : t('location.share.turningOff')}
                </Txt>
              ) : on && householdName ? (
                <Txt variant="muted" style={{ fontSize: 12 }}>
                  {t('location.share.visibleTo', { name: householdName })}
                </Txt>
              ) : null}
            </View>
            {busy ? <ActivityIndicator color={c.accent} style={{ marginRight: sp.sm }} /> : null}
            <Switch
              value={on}
              onValueChange={onToggle}
              disabled={busy}
              trackColor={{ true: c.accent, false: c.surface2 }}
              thumbColor="#ffffff"
            />
          </View>

          {permDenied ? (
            <View style={{ backgroundColor: c.accentSoft, borderRadius: radius.md, padding: sp.md, gap: 6 }}>
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
              <View style={{ backgroundColor: c.surface, borderRadius: radius.md, padding: sp.md, gap: sp.sm }}>
                <Txt style={{ fontFamily: fonts.semibold, fontSize: 15, color: c.text }}>
                  {t('location.share.pausedUntil', { time: clock(pausedUntil) })}
                </Txt>
                <Btn
                  title={t('location.share.resume')}
                  variant="secondary"
                  onPress={() => gate('resume')}
                  loading={busy}
                  disabled={busy}
                />
              </View>
            ) : (
              <>
                <Txt variant="label">{t('location.share.break')}</Txt>
                <View style={{ backgroundColor: c.surface, borderRadius: radius.md, paddingHorizontal: sp.md }}>
                  <PauseRow label={t('location.share.pause1h')} onPress={() => run(() => doPause(in1h()))} />
                  <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />
                  <PauseRow label={t('location.share.pauseTonight')} onPress={() => run(() => doPause(endOfToday()))} />
                </View>
              </>
            )
          ) : null}

          <Txt variant="faint" style={{ lineHeight: 18 }}>
            {t('location.share.note')}
          </Txt>

          <Btn title={t('common.done')} onPress={onClose} />
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
