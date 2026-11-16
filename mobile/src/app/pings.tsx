// Nudges screen — the composer: preset list + recipient picker + the AI
// "just type it" box. Sending inserts directly under RLS and pushes via
// api/send-ping.
//
// There is no history of TEXT nudges here (drawn notes have their wall,
// /notes): an incoming nudge surfaces on the Hub through
// NudgesBanner (which owns its own Supabase Realtime subscription and carries
// the Got it / Call actions), and it drops off once acknowledged or expired.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Keyboard, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { router } from 'expo-router'
import { ChevronLeft, ChevronRight, Images, Settings2 } from 'lucide-react-native'

import { Screen, Txt } from '@/components/ui'
import { RoofExamples } from '@/components/RoofExamples'
import { Toast, type ToastData } from '@/components/Toast'
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { useI18n } from '@/hooks/useI18n'
import { fetchPingPresets, onNoteSent } from '@/lib/pings'
import type { PingPreset } from '@/lib/types'
import { fonts, sp, useTheme } from '@/theme/theme'
import PingComposer from '@/apps/pings/PingComposer'
import { NudgeSettings } from '@/apps/pings/NudgeSettings'

export default function NudgesScreen() {
  const { c } = useTheme()
  const { t } = useI18n()

  const [settingsOpen, setSettingsOpen] = useState(false)
  // A NEW object each send so the toast re-triggers even for the same nudge.
  const [toast, setToast] = useState<ToastData | null>(null)
  useEffect(() => onNoteSent(() => setToast({ emoji: '✏️', text: t('notes.sent') })), [t])

  // "Write your own" is the last thing on the page, so the keyboard would sit
  // right over it (owner, 2026-11: you couldn't see what you were typing).
  // Screen's scroll mode shrinks the page to the space above the keyboard;
  // this then brings the field up into that space once the keyboard is in
  // (or straight away, when it already was).
  const scrollRef = useRef<ScrollView>(null)
  const onWriteFocus = useCallback(() => {
    const toEnd = () => scrollRef.current?.scrollToEnd({ animated: true })
    if (Keyboard.isVisible()) {
      toEnd()
      return
    }
    // After the keyboard is up AND the page has shrunk for it: the shrink is
    // laid out after keyboardDidShow, and scrolling first leaves the field
    // half under the keyboard (seen on Android).
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      sub.remove()
      setTimeout(toEnd, 180)
    })
    setTimeout(() => sub.remove(), 1500)
  }, [])

  // Presets are owned here so the composer and the settings modal share one
  // source of truth — editing in settings reflects in the composer without a
  // stale-cache round-trip.
  const { data: presets = [], revalidate: reloadPresets } = useCachedQuery<PingPreset[]>(
    'ping:presets',
    fetchPingPresets,
  )

  return (
    <>
      <Screen
        scroll
        scrollRef={scrollRef}
        header={
          // Home-style top bar: round back, round settings.
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: sp.sm }}>
            <Pressable
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('common.back')}
              style={({ pressed }) => [roundBtn, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}
            >
              <ChevronLeft size={22} color={c.text} />
            </Pressable>
            <View style={{ flexDirection: 'row', gap: sp.sm }}>
              <RoofExamples variant="pill" examples={['roofEx.nudge.1', 'roofEx.nudge.2', 'roofEx.nudge.3']} />
              <Pressable
                onPress={() => setSettingsOpen(true)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('pings.settings')}
                style={({ pressed }) => [roundBtn, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}
              >
                <Settings2 size={19} color={c.text} />
              </Pressable>
            </View>
          </View>
        }
      >
        <View style={{ paddingBottom: sp.xxl, gap: sp.xl }}>
          {/* big title, what it's for faded under it */}
          <View>
            <Txt style={{ fontFamily: fonts.display, fontSize: 36, lineHeight: 42, letterSpacing: -0.8, color: c.text }}>
              {t('app.nudges')}
            </Txt>
            <Txt style={{ fontFamily: fonts.display, fontSize: 20, lineHeight: 26, color: c.textFaint }}>
              {t('pings.tagline')}
            </Txt>
          </View>
          <PingComposer presets={presets} onSent={setToast} onWriteFocus={onWriteFocus} />
          {/* Where drawn notes live after they leave the Home (migration 113). */}
          <Pressable
            onPress={() => router.push('/notes' as never)}
            accessibilityRole="button"
            accessibilityLabel={t('notes.wall.title')}
            style={({ pressed }) => [wallRow, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.75 : 1 }]}
          >
            <View style={wallTile}>
              <Images size={20} color="#8A5A2B" strokeWidth={2.2} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt style={{ fontFamily: fonts.semibold, fontSize: 16, color: c.text }}>{t('notes.wall.title')}</Txt>
              <Txt variant="faint" style={{ fontSize: 13 }} numberOfLines={1}>
                {t('notes.wall.entrySub')}
              </Txt>
            </View>
            <ChevronRight size={18} color={c.textMuted} />
          </Pressable>
        </View>
      </Screen>

      <Toast data={toast} />

      {settingsOpen ? (
        <NudgeSettings
          presets={presets}
          reloadPresets={reloadPresets}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </>
  )
}

const wallRow = {
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  gap: sp.md,
  padding: sp.md,
  borderRadius: 20,
  borderWidth: StyleSheet.hairlineWidth,
}
const wallTile = {
  width: 44,
  height: 44,
  borderRadius: 14,
  backgroundColor: '#F3E2C6',
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
}

const roundBtn = {
  width: 40,
  height: 40,
  borderRadius: 20,
  borderWidth: StyleSheet.hairlineWidth,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
}
