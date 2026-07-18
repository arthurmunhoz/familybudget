// Your-location controls: the master sharing toggle, temporary pause (1 hour /
// until tonight), and resume — plus the "pausing is visible, never a silent gap"
// reassurance. Turning sharing on requests Always-permission and starts the
// background task; off/pause stops it. All writes go through @/lib/location.
import { useEffect, useState } from 'react'
import { Linking, Modal, Pressable, StyleSheet, Switch, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChevronRight } from 'lucide-react-native'

import { Btn, Txt } from '@/components/ui'
import type { ToastData } from '@/components/Toast'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/hooks/useI18n'
import { supabase } from '@/lib/supabase'
import { captureAndUpload, isPaused, pauseSharing, resumeSharing, setSharing } from '@/lib/location'
import { ensureBackgroundPermission, startBackgroundUpdates, stopBackgroundUpdates } from '@/lib/locationTask'
import type { MemberLocation } from '@/lib/types'
import { fonts, radius, sp, useTheme } from '@/theme/theme'

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

  const enable = async () => {
    setBusy(true)
    const ok = await ensureBackgroundPermission()
    if (!ok) {
      setPermDenied(true)
      setBusy(false)
      return
    }
    setPermDenied(false)
    await setSharing(true)
    await startBackgroundUpdates(fgLabels).catch(() => {})
    await captureAndUpload().catch(() => {})
    setOn(true)
    setPausedUntil(null)
    toast(t('location.toast.on'))
    onChanged()
    setBusy(false)
  }

  const disable = async () => {
    setBusy(true)
    await setSharing(false)
    await stopBackgroundUpdates().catch(() => {})
    setOn(false)
    setPausedUntil(null)
    toast(t('location.toast.off'))
    onChanged()
    setBusy(false)
  }

  const doPause = async (until: Date) => {
    setBusy(true)
    await pauseSharing(until)
    await stopBackgroundUpdates().catch(() => {})
    setPausedUntil(until)
    toast(t('location.toast.paused'))
    onChanged()
    setBusy(false)
  }

  const resume = async () => {
    setBusy(true)
    const ok = await ensureBackgroundPermission()
    if (!ok) {
      setPermDenied(true)
      setBusy(false)
      return
    }
    await resumeSharing()
    await startBackgroundUpdates(fgLabels).catch(() => {})
    await captureAndUpload().catch(() => {})
    setPausedUntil(null)
    setOn(true)
    toast(t('location.toast.on'))
    onChanged()
    setBusy(false)
  }

  const onToggle = (v: boolean) => {
    if (busy) return
    void (v ? enable() : disable())
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
              {on && householdName ? (
                <Txt variant="muted" style={{ fontSize: 12 }}>
                  {t('location.share.visibleTo', { name: householdName })}
                </Txt>
              ) : null}
            </View>
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
                <Btn title={t('location.share.resume')} variant="secondary" onPress={resume} />
              </View>
            ) : (
              <>
                <Txt variant="label">{t('location.share.break')}</Txt>
                <View style={{ backgroundColor: c.surface, borderRadius: radius.md, paddingHorizontal: sp.md }}>
                  <PauseRow label={t('location.share.pause1h')} onPress={() => void doPause(in1h())} />
                  <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />
                  <PauseRow label={t('location.share.pauseTonight')} onPress={() => void doPause(endOfToday())} />
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
    </Modal>
  )
}
