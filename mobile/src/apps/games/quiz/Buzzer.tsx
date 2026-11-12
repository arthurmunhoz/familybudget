// The big buzzer: a round game-show button on a base, the dome in your team's
// colour. Pressing it sinks the dome; while it's yours to press, a soft glow
// pulses around it. Locked (you missed this one) or busy (someone else is
// answering) it goes grey and still.
import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { Pressable } from '@/components/Pressable'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated'
import Svg, { Defs, Ellipse, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg'

import type { Gradient } from '@/components/home/palette'

export type BuzzerState = 'active' | 'locked' | 'busy'

export function Buzzer({ size, colors, state, onPress }: { size: number; colors: Gradient; state: BuzzerState; onPress: () => void }) {
  const active = state === 'active'
  const dome: Gradient = active ? colors : ['#C9CED6', '#9AA3B2']
  const press = useSharedValue(0)
  const glow = useSharedValue(0)
  useEffect(() => {
    glow.set(
      active
        ? withRepeat(withSequence(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.sin) }), withTiming(0, { duration: 900, easing: Easing.inOut(Easing.sin) })), -1)
        : withTiming(0, { duration: 200 }),
    )
  }, [active, glow])
  const domeStyle = useAnimatedStyle(() => ({ transform: [{ translateY: press.value * size * 0.06 }, { scaleY: 1 - press.value * 0.08 }] }))
  const glowStyle = useAnimatedStyle(() => ({ opacity: 0.18 + glow.value * 0.3, transform: [{ scale: 1 + glow.value * 0.06 }] }))
  const h = size * 0.8
  const id = `bz${dome[1].slice(1)}`

  return (
    <Pressable
      accessibilityRole="button"
      disabled={!active}
      onPressIn={() => press.set(withTiming(1, { duration: 70 }))}
      onPressOut={() => press.set(withTiming(0, { duration: 160 }))}
      onPress={onPress}
      style={{ width: size, height: h, alignItems: 'center', justifyContent: 'flex-end' }}
    >
      <Animated.View pointerEvents="none" style={[styles.glow, { width: size * 1.05, height: size * 0.7, borderRadius: size, backgroundColor: colors[1] }, glowStyle]} />
      {/* base + housing */}
      <Svg viewBox="0 0 200 160" width={size} height={h} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="bzBase" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#5E6470" />
            <Stop offset="1" stopColor="#3A3F49" />
          </LinearGradient>
        </Defs>
        <Ellipse cx={100} cy={140} rx={92} ry={18} fill="rgba(0,0,0,0.12)" />
        <Rect x={16} y={104} width={168} height={36} rx={18} fill="url(#bzBase)" />
        <Ellipse cx={100} cy={104} rx={84} ry={16} fill="#6C7380" />
      </Svg>
      {/* the dome, which sinks when pressed */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, domeStyle]}>
        <Svg viewBox="0 0 200 160" width={size} height={h}>
          <Defs>
            <RadialGradient id={id} cx="40%" cy="30%" r="80%">
              <Stop offset="0" stopColor={dome[0]} />
              <Stop offset="1" stopColor={dome[1]} />
            </RadialGradient>
          </Defs>
          <Ellipse cx={100} cy={100} rx={70} ry={14} fill="rgba(0,0,0,0.25)" />
          <Rect x={30} y={60} width={140} height={40} fill={dome[1]} />
          <Ellipse cx={100} cy={60} rx={70} ry={42} fill={`url(#${id})`} />
          <Ellipse cx={80} cy={44} rx={26} ry={10} fill="rgba(255,255,255,0.45)" />
        </Svg>
      </Animated.View>
    </Pressable>
  )
}

/** A countdown ring with the seconds in the middle. */
export function CountdownRing({ left, total, size, color, track }: { left: number; total: number; size: number; color: string; track: string }) {
  const r = size / 2 - 4
  const C = 2 * Math.PI * r
  const frac = Math.max(0, Math.min(1, left / total))
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Ellipse cx={size / 2} cy={size / 2} rx={r} ry={r} stroke={track} strokeWidth={5} fill="none" />
        <Ellipse
          cx={size / 2}
          cy={size / 2}
          rx={r}
          ry={r}
          stroke={left <= 3 ? '#E8506A' : color}
          strokeWidth={5}
          fill="none"
          strokeDasharray={`${C} ${C}`}
          strokeDashoffset={C * (1 - frac)}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <Animated.Text style={{ fontSize: size * 0.36, fontWeight: '800', color: left <= 3 ? '#E8506A' : color }}>{Math.ceil(left)}</Animated.Text>
    </View>
  )
}

const styles = StyleSheet.create({
  glow: { position: 'absolute', bottom: '6%' },
})
