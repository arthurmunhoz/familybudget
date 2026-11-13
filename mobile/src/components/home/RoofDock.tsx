// The Home's bottom dock is Roof (owner, 2026-11): the assistant lives where
// the thumb is. Kept small on purpose — the orb with a status dot (green and
// breathing while "Ei Roof" listens, grey when it doesn't), the name, a mute
// button that turns listening on / off, and an up arrow. The arrow (or a tap
// anywhere on it) expands Roof into the ask sheet, already listening AND with
// the keyboard up, so you can talk or type. While it listens, a faint
// 'Diga “Ei Roof”' under the name says how to call it.
import { useEffect, useState } from 'react'
import { Animated, Easing, StyleSheet, View } from 'react-native'
import { ArrowUp, Mic, MicOff } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import type { WakeState } from '@/lib/roofWake'
import { fonts, useTheme } from '@/theme/theme'
import { Orb } from './AnswerViews'

export const ROOF_DOCK_H = 60
const GREEN = '#3f8f6a'
// Gap between the arrow button and the dock's right / bottom edges.
const GO_INSET = (ROOF_DOCK_H - 44) / 2

export type RoofDockState = WakeState | 'paused' | 'needsPlus'

export function RoofDock({
  wake,
  onOpen,
  onWakeTap,
  shape,
}: {
  /** off = "Ei Roof" turned off; needsPlus = free plan (no mute button). */
  wake: RoofDockState
  onOpen: () => void
  /** The mute button: pause / resume, or turn "Ei Roof" on. */
  onWakeTap: () => void
  /** On a Face ID iPhone the dock follows the screen's bottom curve. */
  shape?: { radius: number } | null
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const live = wake === 'waiting'
  const [breath] = useState(() => new Animated.Value(0))
  useEffect(() => {
    if (!live) return
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [live, breath])

  const canMute = wake === 'waiting' || wake === 'paused' || wake === 'off'
  const muteLabel = live ? t('roof.pause') : wake === 'paused' ? t('roof.resume') : t('roof.chipOff')

  return (
    <View
      style={[
        s.dock,
        { backgroundColor: c.sheet, borderColor: c.border },
        shape ? { borderBottomLeftRadius: shape.radius, borderBottomRightRadius: shape.radius } : null,
      ]}
    >
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={t('ask.title')}
        style={({ pressed }) => [s.body, { opacity: pressed ? 0.6 : 1 }]}
      >
        <View>
          <Orb size={34} />
          {wake !== 'needsPlus' && wake !== 'unsupported' ? (
            <View style={[s.dotWrap, { backgroundColor: c.sheet }]}>
              {live ? (
                <Animated.View
                  style={[
                    s.halo,
                    {
                      opacity: breath.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.4] }),
                      transform: [{ scale: breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] }) }],
                    },
                  ]}
                />
              ) : null}
              <View style={[s.dot, { backgroundColor: live ? GREEN : c.textFaint }]} />
            </View>
          ) : null}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt style={{ fontFamily: fonts.display, fontSize: 18, lineHeight: 22, color: c.text }}>Roof</Txt>
          {/* While it listens: how to call it, quietly (owner, 2026-11). */}
          {live ? (
            <Txt numberOfLines={1} style={{ fontSize: 12.5, lineHeight: 16, color: c.textFaint }}>
              {t('roof.sayIt')}
            </Txt>
          ) : null}
        </View>
      </Pressable>
      {canMute ? (
        <Pressable
          onPress={onWakeTap}
          accessibilityRole="button"
          accessibilityLabel={muteLabel}
          hitSlop={6}
          style={({ pressed }) => [s.round, { backgroundColor: c.surface, opacity: pressed ? 0.6 : 1 }]}
        >
          {live ? <Mic size={18} color={GREEN} /> : <MicOff size={18} color={c.textMuted} />}
        </Pressable>
      ) : null}
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={t('ask.title')}
        style={({ pressed }) => [
          s.go,
          // Concentric with the dock's bottom-right curve (the button sits
          // GO_INSET in from both edges), so the two corners nest.
          { backgroundColor: c.action, opacity: pressed ? 0.85 : 1 },
          shape ? { borderBottomRightRadius: Math.max(16, shape.radius - GO_INSET) } : null,
        ]}
      >
        <ArrowUp size={21} color={c.onAction} strokeWidth={2.6} />
      </Pressable>
    </View>
  )
}

const s = StyleSheet.create({
  dock: {
    height: ROOF_DOCK_H,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 12,
    paddingRight: GO_INSET,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  body: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, height: '100%' },
  dotWrap: { position: 'absolute', right: -3, bottom: -3, width: 15, height: 15, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 9, height: 9, borderRadius: 5 },
  halo: { position: 'absolute', width: 9, height: 9, borderRadius: 5, backgroundColor: GREEN },
  round: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  go: { width: 44, height: 44, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
})
