// The Home's quiet "Roof is listening" seal (owner, 2026-11-12): a breathing
// green dot + "Diga “Ei Roof”". Tap to pause until tapped again (or the app
// reopens). When the phone can't recognise on-device it says so instead.
import { useEffect, useState } from 'react'
import { Animated, Easing, StyleSheet, View } from 'react-native'
import { Mic, MicOff } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import type { WakeState } from '@/lib/roofWake'
import { fonts, radius, sp, useTheme } from '@/theme/theme'

export function RoofPill({ state, onToggle }: { state: WakeState | 'paused'; onToggle: () => void }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const [breath] = useState(() => new Animated.Value(0))
  const live = state === 'waiting'
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

  if (state === 'off') return null
  const label =
    state === 'unsupported' ? t('roof.unsupported') : state === 'paused' ? t('roof.paused') : t('roof.sayIt')
  const green = '#3f8f6a'
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={state === 'unsupported' ? undefined : onToggle}
      style={[styles.pill, { backgroundColor: c.card, borderColor: c.border }]}
    >
      <View style={styles.dotWrap}>
        {live ? (
          <Animated.View
            style={[
              styles.halo,
              { backgroundColor: green, opacity: breath.interpolate({ inputRange: [0, 1], outputRange: [0.12, 0.32] }), transform: [{ scale: breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] }) }] },
            ]}
          />
        ) : null}
        <View style={[styles.dot, { backgroundColor: live ? green : c.textFaint }]} />
      </View>
      <Txt style={{ flexShrink: 1, fontFamily: fonts.medium, fontSize: 13.5, color: live ? c.text : c.textMuted }} numberOfLines={1}>
        {label}
      </Txt>
      {state === 'unsupported' ? null : state === 'paused' ? <Mic size={15} color={c.accent} /> : <MicOff size={15} color={c.textFaint} />}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.sm,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: sp.md,
  },
  dotWrap: { width: 14, height: 14, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  halo: { position: 'absolute', width: 14, height: 14, borderRadius: 7 },
})
