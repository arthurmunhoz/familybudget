// Four bars bouncing out of step — "I'm listening" on the ask sheet's button
// (owner, 2026-11: while Roof listens the button should show it, not a mic).
// Tapping the button still stops the listen and sends what was heard.
import { useEffect, useState } from 'react'
import { Animated, Easing, View } from 'react-native'

const DELAYS = [0, 180, 90, 260]

export function ListeningBars({ color = '#fff', height = 20 }: { color?: string; height?: number }) {
  const [vals] = useState(() => DELAYS.map(() => new Animated.Value(0.3)))
  useEffect(() => {
    const loops = vals.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(DELAYS[i]),
          Animated.timing(v, { toValue: 1, duration: 320, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.3, duration: 320, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
      ),
    )
    loops.forEach((l) => l.start())
    return () => loops.forEach((l) => l.stop())
  }, [vals])
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, height }}>
      {vals.map((v, i) => (
        <Animated.View key={i} style={{ width: 3.5, height, borderRadius: 2, backgroundColor: color, transform: [{ scaleY: v }] }} />
      ))}
    </View>
  )
}
