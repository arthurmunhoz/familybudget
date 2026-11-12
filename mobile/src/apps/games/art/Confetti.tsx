// A burst of confetti for wins. Pieces are plain views animated by Reanimated
// (fall + sway + spin), drawn over everything and untouchable. Re-fires each
// time `fire` changes to a new truthy value.
import { useEffect, useMemo } from 'react'
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated'

/** Deterministic 0…1 noise (render must stay pure): a scattered look that's
 *  the same every time, which nobody can tell apart from random. */
function rand(n: number) {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

const COLORS = ['#FF8A5B', '#FFD166', '#6E8BFF', '#2BD99A', '#D9466F', '#C083FF', '#ffffff']

function Bit({ x, delay, color, w, h, drift, spin, fall, fire }: {
  x: number; delay: number; color: string; w: number; h: number; drift: number; spin: number; fall: number; fire: number
}) {
  const t = useSharedValue(0)
  useEffect(() => {
    if (!fire) return
    t.set(0)
    t.set(withDelay(delay, withTiming(1, { duration: 2300, easing: Easing.out(Easing.quad) })))
  }, [fire, delay, t])
  const style = useAnimatedStyle(() => ({
    opacity: t.value === 0 ? 0 : t.value > 0.85 ? (1 - t.value) / 0.15 : 1,
    transform: [
      { translateX: x + Math.sin(t.value * 6) * drift },
      { translateY: -40 + t.value * fall },
      { rotate: `${t.value * spin}deg` },
    ],
  }))
  return <Animated.View style={[styles.bit, { width: w, height: h, backgroundColor: color, borderRadius: h > w ? 2 : w / 2 }, style]} />
}

export function Confetti({ fire, colors = COLORS }: { fire: number; colors?: string[] }) {
  const { width, height } = useWindowDimensions()
  const bits = useMemo(
    () =>
      Array.from({ length: 70 }, (_, i) => {
        const r = (k: number) => rand(i * 7 + k)
        return {
          key: i,
          x: r(1) * width,
          delay: r(2) * 350,
          color: colors[i % colors.length],
          w: 6 + r(3) * 6,
          h: r(4) > 0.5 ? 10 + r(5) * 6 : 7,
          drift: 10 + r(6) * 26,
          spin: (r(7) > 0.5 ? 1 : -1) * (240 + r(8) * 480),
          fall: height * (0.65 + r(9) * 0.45),
        }
      }),
    [width, height, colors],
  )
  if (!fire) return null
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {bits.map(({ key, ...b }) => (
        <Bit key={key} {...b} fire={fire} />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({ bit: { position: 'absolute', top: 0, left: 0 } })
