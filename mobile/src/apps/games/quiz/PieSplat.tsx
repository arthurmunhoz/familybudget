// A cream pie to the face (owner, 2026-11-13): when YOUR team answers wrong,
// or the OTHER team gets it right, a pie flies at the screen, hits, and cream
// covers it — blobs, strawberry bits and crust crumbs — then drips and slides
// away. Original art (SVG), timed motion, a splat sound + a heavy buzz.
// Never takes a touch. Reduce Motion: the splat just fades in and out.
import { useEffect, useMemo } from 'react'
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import Animated, {
  Easing,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg'

import { haptic, sound } from '../feedback'

const NEVER = { reduceMotion: ReduceMotion.Never }

/** A soft irregular blob around (cx, cy): `n` lobes, radius r ± jitter. */
function blob(cx: number, cy: number, r: number, n: number, seed: number, jitter = 0.28): string {
  let s = seed
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2
    const rr = r * (1 - jitter / 2 + rnd() * jitter)
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]
  })
  const mid = (p: number[], q: number[]) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
  let d = `M ${mid(pts[n - 1], pts[0]).join(' ')}`
  for (let i = 0; i < n; i++) {
    const p = pts[i]
    const m = mid(p, pts[(i + 1) % n])
    d += ` Q ${p[0]} ${p[1]} ${m[0]} ${m[1]}`
  }
  return d + ' Z'
}

/** The pie as it flies in: tin, crust rim, whipped dome, a strawberry. */
function Pie({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200">
      <Defs>
        <LinearGradient id="pTin" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#E8EDF2" />
          <Stop offset="1" stopColor="#9AA5B1" />
        </LinearGradient>
        <RadialGradient id="pCream" cx="40%" cy="35%" r="70%">
          <Stop offset="0" stopColor="#FFFFFF" />
          <Stop offset="1" stopColor="#F4E9DA" />
        </RadialGradient>
      </Defs>
      <Path d="M30 120 L170 120 L158 160 Q100 172 42 160 Z" fill="url(#pTin)" />
      <Ellipse cx={100} cy={120} rx={74} ry={18} fill="#D9A15B" />
      <Ellipse cx={100} cy={116} rx={68} ry={14} fill="#C7873F" />
      <Path d={blob(100, 92, 60, 9, 7, 0.22)} fill="url(#pCream)" />
      <Path d="M62 96 Q80 80 98 94 Q116 80 136 96" stroke="#EADBC6" strokeWidth={5} fill="none" strokeLinecap="round" />
      <Circle cx={100} cy={58} r={13} fill="#E8384F" />
      <Path d="M94 47 Q100 40 106 47" stroke="#3DAA5B" strokeWidth={5} fill="none" strokeLinecap="round" />
    </Svg>
  )
}

export function PieSplat({ onDone }: { onDone?: () => void }) {
  const { width: W, height: H } = useWindowDimensions()
  const reduced = useReducedMotion()
  const fly = useSharedValue(0) // 0 far → 1 hit
  const hit = useSharedValue(0) // splat grows in
  const drip = useSharedValue(0) // drips slide
  const fade = useSharedValue(1)

  useEffect(() => {
    const finish = () => onDone?.()
    if (reduced) {
      hit.set(1)
      fade.set(withSequence(withTiming(1, { duration: 200, ...NEVER }), withDelay(1200, withTiming(0, { duration: 400, ...NEVER }, (f) => f && onDone && runOnJS(finish)()))))
      return
    }
    sound('whoosh')
    fly.set(withTiming(1, { duration: 420, easing: Easing.in(Easing.cubic) }))
    const t = setTimeout(() => {
      sound('splat')
      haptic('medium')
    }, 400)
    hit.set(withDelay(400, withTiming(1, { duration: 160, easing: Easing.out(Easing.back(2)) })))
    drip.set(withDelay(650, withTiming(1, { duration: 1700, easing: Easing.inOut(Easing.quad) })))
    fade.set(withDelay(1900, withTiming(0, { duration: 600 }, (f) => f && onDone && runOnJS(finish)())))
    return () => clearTimeout(t)
  }, [reduced, fly, hit, drip, fade, onDone])

  const pieSize = Math.min(W, H) * 0.42
  const pieStyle = useAnimatedStyle(() => ({
    opacity: fly.value > 0 && hit.value < 0.3 ? 1 : 0,
    transform: [
      { translateY: (1 - fly.value) * H * 0.45 },
      { scale: 0.35 + fly.value * 2.6 },
      { rotate: `${(1 - fly.value) * -18}deg` },
    ],
  }))
  const splatStyle = useAnimatedStyle(() => ({ opacity: hit.value * fade.value, transform: [{ scale: 0.7 + hit.value * 0.3 }] }))
  const dripStyle = useAnimatedStyle(() => ({ transform: [{ translateY: drip.value * H * 0.35 }], opacity: fade.value }))

  // The mess, laid out once for this screen size.
  const mess = useMemo(() => {
    const cx = W / 2
    const cy = H * 0.46
    const R = Math.max(W, H) * 0.42
    const drops = Array.from({ length: 14 }, (_, i) => {
      const a = (i / 14) * Math.PI * 2 + (i % 3) * 0.3
      const d = R * (0.95 + ((i * 37) % 10) / 18)
      return { x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, r: 10 + ((i * 53) % 22) }
    })
    const bits = Array.from({ length: 16 }, (_, i) => {
      const a = i * 2.39996
      const d = R * (0.2 + ((i * 29) % 70) / 100)
      return { x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, red: i % 3 === 0, r: i % 3 === 0 ? 9 + (i % 4) * 2 : 4 + (i % 3) }
    })
    const dripsAt = [0.18, 0.34, 0.52, 0.66, 0.82].map((k, i) => ({ x: W * k, len: 60 + ((i * 47) % 70), w: 22 + ((i * 13) % 14) }))
    return { cx, cy, R, drops, bits, dripsAt }
  }, [W, H])

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }, pieStyle]}>
        <Pie size={pieSize} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, splatStyle]}>
        <Svg width={W} height={H}>
          <Defs>
            <RadialGradient id="sCream" cx="50%" cy="45%" r="60%">
              <Stop offset="0" stopColor="#FFFFFF" />
              <Stop offset="0.7" stopColor="#FBF4EA" />
              <Stop offset="1" stopColor="#EFE1CC" />
            </RadialGradient>
          </Defs>
          <Path d={blob(mess.cx, mess.cy, mess.R, 13, 3, 0.34)} fill="url(#sCream)" />
          <Path d={blob(mess.cx + mess.R * 0.15, mess.cy - mess.R * 0.1, mess.R * 0.55, 9, 11, 0.3)} fill="#FFFFFF" opacity={0.75} />
          {mess.drops.map((d, i) => (
            <Path key={i} d={blob(d.x, d.y, d.r, 7, i + 20, 0.4)} fill="#FBF4EA" />
          ))}
          <G>
            {mess.bits.map((b, i) => (
              <Circle key={i} cx={b.x} cy={b.y} r={b.r} fill={b.red ? '#E8384F' : '#C7873F'} opacity={b.red ? 0.95 : 0.85} />
            ))}
          </G>
          {/* a few shiny highlights so it reads as cream, not paper */}
          <Ellipse cx={mess.cx - mess.R * 0.3} cy={mess.cy - mess.R * 0.35} rx={mess.R * 0.18} ry={mess.R * 0.07} fill="#FFFFFF" opacity={0.9} />
          <Ellipse cx={mess.cx + mess.R * 0.35} cy={mess.cy + mess.R * 0.2} rx={mess.R * 0.1} ry={mess.R * 0.04} fill="#FFFFFF" opacity={0.8} />
        </Svg>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, dripStyle]}>
        <Svg width={W} height={H}>
          {mess.dripsAt.map((d, i) => (
            <Path
              key={i}
              d={`M ${d.x - d.w / 2} ${mess.cy + mess.R * 0.55} L ${d.x - d.w / 2} ${mess.cy + mess.R * 0.55 + d.len} Q ${d.x} ${mess.cy + mess.R * 0.55 + d.len + d.w} ${d.x + d.w / 2} ${mess.cy + mess.R * 0.55 + d.len} L ${d.x + d.w / 2} ${mess.cy + mess.R * 0.55} Z`}
              fill="#FBF4EA"
            />
          ))}
        </Svg>
      </Animated.View>
    </View>
  )
}
