// What the Scan receipt button shows while the AI reads the photo (owner,
// 2026-11: a spinner next to "Scan receipt" read as stuck). A soft beam in the
// budget's colour sweeps across the button like a scanner, the sparkle
// breathes, and the label walks through stages ("Reading the receipt…" →
// "Finding the amount…" → "Almost there…") — paced on a timer, the API is one
// request. Reduce Motion: no sweep, the stages still change.
import { useEffect, useState } from 'react'
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native'
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'

import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'

const STAGES: TKey[] = ['detail.scanning1', 'detail.scanning2', 'detail.scanning3']
const BEAM = 70

/** The moving beam; fills its parent (the button), clipped by it. */
export function ScanBeam({ color }: { color: string }) {
  const still = useReducedMotion()
  const [w, setW] = useState(0)
  const x = useSharedValue(0)
  useEffect(() => {
    if (still || !w) return
    x.set(0)
    x.set(withRepeat(withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.cubic) }), -1, true))
    return () => cancelAnimation(x)
  }, [x, w, still])
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: -BEAM + x.get() * (w + BEAM) }] }))
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
      {still ? null : (
        <Animated.View style={[{ position: 'absolute', top: 0, bottom: 0, width: BEAM }, style]}>
          <Svg width={BEAM} height="100%">
            <Defs>
              <LinearGradient id="beam" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={color} stopOpacity={0} />
                <Stop offset="0.5" stopColor={color} stopOpacity={0.32} />
                <Stop offset="1" stopColor={color} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Rect x={0} y={0} width={BEAM} height="100%" fill="url(#beam)" />
            <Rect x={BEAM / 2 - 1} y={0} width={2} height="100%" fill={color} opacity={0.55} />
          </Svg>
        </Animated.View>
      )}
    </View>
  )
}

/** The label while scanning: the stages, one after another, holding the last. */
export function ScanLabel({ color, style }: { color: string; style?: object }) {
  const { t } = useI18n()
  const [i, setI] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setI((n) => Math.min(n + 1, STAGES.length - 1)), 1800)
    return () => clearInterval(id)
  }, [])
  return (
    <Txt style={[style, { color }]} numberOfLines={1}>
      {t(STAGES[i])}
    </Txt>
  )
}
