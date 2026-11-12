// The photo frame's own art (pure SVG — react-native-svg is in the binary):
// a standing wooden frame holding a little sunset-and-roof "photo", the One
// Roof house in silhouette. Used as the manager's hero and the slideshow's
// empty state. It breathes slowly (a soft scale), like the frame is on.
import { useEffect, useState } from 'react'
import { AccessibilityInfo, Animated, Easing } from 'react-native'
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg'

import { FRAME_LOOK } from './look'

export function FrameArt({ size = 132 }: { size?: number }) {
  const [breathe] = useState(() => new Animated.Value(0))
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null
    let alive = true
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (!alive || reduce) return
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(breathe, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(breathe, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      )
      loop.start()
    })
    return () => {
      alive = false
      loop?.stop()
    }
  }, [breathe])
  const scale = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.035] })
  const glow = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] })

  return (
    <Animated.View style={{ width: size, height: size, transform: [{ scale }] }}>
      <Svg width={size} height={size} viewBox="0 0 120 120">
        <Defs>
          <LinearGradient id="frameWood" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#C98A5A" />
            <Stop offset="1" stopColor="#8E5634" />
          </LinearGradient>
          <LinearGradient id="frameSky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={FRAME_LOOK.colors[0]} />
            <Stop offset="0.7" stopColor={FRAME_LOOK.colors[1]} />
            <Stop offset="1" stopColor="#7A3C8C" />
          </LinearGradient>
        </Defs>
        {/* the easel leg behind */}
        <Path d="M60 92 L74 114" stroke="#7A4A2C" strokeWidth={5} strokeLinecap="round" />
        {/* soft shadow on the table */}
        <Rect x={22} y={110} width={76} height={5} rx={2.5} fill="#000" opacity={0.08} />
        {/* frame */}
        <Rect x={14} y={10} width={92} height={96} rx={10} fill="url(#frameWood)" />
        <Rect x={21} y={17} width={78} height={82} rx={5} fill="#FFF6EC" />
        {/* the photo */}
        <Rect x={26} y={22} width={68} height={72} rx={3} fill="url(#frameSky)" />
        <G>
          <Circle cx={74} cy={44} r={9} fill="#FFE29A" />
        </G>
        {/* hills */}
        <Path d="M26 78 Q44 64 62 74 T94 70 L94 94 L26 94 Z" fill="#5B2A6E" opacity={0.55} />
        {/* the roof house */}
        <Path d="M38 94 L38 72 L52 60 L66 72 L66 94 Z" fill="#2E1838" opacity={0.9} />
        <Rect x={48} y={80} width={8} height={14} rx={1.5} fill="#FFE29A" opacity={0.9} />
      </Svg>
      {/* a warm glow from the little window, breathing with the frame */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: size * 0.36,
          top: size * 0.62,
          width: size * 0.16,
          height: size * 0.16,
          borderRadius: size,
          backgroundColor: '#FFE29A',
          opacity: Animated.multiply(glow, 0.22),
        }}
      />
    </Animated.View>
  )
}
