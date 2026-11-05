// A subtly-pulsing placeholder block for loading states. Shape it like the
// content that's coming (same width/height/radius) so nothing jumps when the
// real thing lands — prefer this to a spinner wherever the layout is known.
// First used for the Home weather/alert area (TodaySection), then the Family
// Birthday page.
import { useEffect, useRef } from 'react'
import { Animated, type StyleProp, type ViewStyle } from 'react-native'

import { useTheme } from '@/theme/theme'

export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme()
  const o = useRef(new Animated.Value(0.5)).current
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(o, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(o, { toValue: 0.5, duration: 650, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [o])
  return <Animated.View style={[{ backgroundColor: c.surface2, borderRadius: 6, opacity: o }, style]} />
}
