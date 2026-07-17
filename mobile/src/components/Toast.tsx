// A small, self-dismissing confirmation that slides up from the bottom. Render
// it as a sibling of the screen body (NOT inside a ScrollView) so it floats over
// the whole screen. Feed it a NEW `data` object each time you want it to show —
// the effect keys on the object reference, so sending the same thing twice in a
// row re-triggers it. pointerEvents=none so it never blocks a tap underneath.
import { useEffect, useRef, useState } from 'react'
import { Animated } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Txt } from './ui'
import { radius, sp, useTheme } from '../theme/theme'

export interface ToastData {
  emoji?: string
  text: string
}

export function Toast({ data, duration = 1900 }: { data: ToastData | null; duration?: number }) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const anim = useRef(new Animated.Value(0)).current
  const [shown, setShown] = useState<ToastData | null>(null)

  useEffect(() => {
    if (!data) return
    setShown(data)
    anim.setValue(0)
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, friction: 8, tension: 90 }).start()
    const timer = setTimeout(() => {
      Animated.timing(anim, { toValue: 0, duration: 200, useNativeDriver: true }).start(
        ({ finished }) => finished && setShown(null),
      )
    }, duration)
    return () => clearTimeout(timer)
  }, [data, duration, anim])

  if (!shown) return null

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: insets.bottom + sp.xl,
        alignItems: 'center',
        opacity: anim,
        transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }],
      }}
    >
      <Animated.View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: sp.sm,
          maxWidth: '88%',
          backgroundColor: c.text,
          paddingHorizontal: sp.lg,
          paddingVertical: 12,
          borderRadius: radius.lg,
          shadowColor: '#000',
          shadowOpacity: 0.28,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 8 },
          elevation: 10,
        }}
      >
        {shown.emoji ? <Txt style={{ fontSize: 16 }}>{shown.emoji}</Txt> : null}
        <Txt style={{ color: c.bg, fontWeight: '600', fontSize: 14 }} numberOfLines={1}>
          {shown.text}
        </Txt>
      </Animated.View>
    </Animated.View>
  )
}
