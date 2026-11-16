// The Modo Casa hero art (owner, 2026-11): "any device with internet will do".
// An old phone, a tablet and a laptop, each showing the same little family
// screen (clock, three agenda bars, a heart for photos), with Wi-Fi arcs above
// that light up in turn. Drawn in white on the Casa gradient. Calm motion only:
// the devices drift a few points out of step, the arcs fade in sequence;
// Reduce Motion holds everything still.
import { useEffect } from 'react'
import { View } from 'react-native'
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'
import Svg, { Circle, G, Path, Rect } from 'react-native-svg'

const APath = Animated.createAnimatedComponent(Path)

const W = 300
const H = 170
// The outer Wi-Fi arc curves above y = 0 and its 5pt stroke was cut off at
// the top of the box (owner, 2026-11-15): the box starts TOP points higher.
const TOP = 20
const VIEW = `0 ${-TOP} ${W} ${H + TOP}`
const INK = '#B9532F' // the gradient's deep end, for the screens' details

/** A small "family screen": clock line, three agenda bars, a photo heart. */
function Screen({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const pad = Math.max(5, w * 0.1)
  const bar = (i: number, len: number, col: string) => (
    <Rect key={i} x={x + pad} y={y + pad + h * 0.24 + i * h * 0.16} width={(w - pad * 2) * len} height={Math.max(3, h * 0.08)} rx={2} fill={col} />
  )
  return (
    <G>
      <Rect x={x} y={y} width={w} height={h} rx={Math.min(8, w * 0.1)} fill="#FFF8F3" />
      <Rect x={x + pad} y={y + pad} width={(w - pad * 2) * 0.42} height={Math.max(4, h * 0.11)} rx={2} fill={INK} opacity={0.85} />
      {bar(0, 0.9, '#F2A07B')}
      {bar(1, 0.7, '#8FB8F0')}
      {bar(2, 0.55, '#9ED9B5')}
      <Circle cx={x + w - pad - w * 0.06} cy={y + pad + h * 0.05} r={Math.max(2.5, w * 0.05)} fill="#F07A9A" />
    </G>
  )
}

function useDrift(delay: number, still: boolean) {
  const v = useSharedValue(0)
  useEffect(() => {
    if (still) return
    v.set(
      withDelay(
        delay,
        withRepeat(
          withSequence(
            withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.sin) }),
            withTiming(0, { duration: 2400, easing: Easing.inOut(Easing.sin) }),
          ),
          -1,
        ),
      ),
    )
  }, [v, delay, still])
  return useAnimatedStyle(() => ({ transform: [{ translateY: -4 * v.get() }] }))
}

function Arc({ d, t, i }: { d: string; t: SharedValue<number>; i: number }) {
  const props = useAnimatedProps(() => {
    // each arc peaks a third of the cycle after the one inside it
    const p = (t.get() * 3 - i + 3) % 3
    const o = p < 1 ? 0.35 + 0.65 * Math.sin(p * Math.PI) : 0.35
    return { opacity: o }
  })
  return <APath d={d} stroke="#fff" strokeWidth={5} strokeLinecap="round" fill="none" animatedProps={props} />
}

export function CasaDevicesArt() {
  const still = useReducedMotion()
  const phone = useDrift(0, still)
  const tablet = useDrift(700, still)
  const laptop = useDrift(1400, still)
  const t = useSharedValue(0)
  useEffect(() => {
    if (still) return
    t.set(withRepeat(withTiming(1, { duration: 2700, easing: Easing.linear }), -1))
  }, [t, still])

  const layer = { position: 'absolute' as const, left: 0, top: 0, width: '100%' as const, height: '100%' as const }
  return (
    <View style={{ width: '100%', aspectRatio: W / (H + TOP) }} accessible={false} importantForAccessibility="no-hide-descendants">
      {/* Wi-Fi */}
      <Svg viewBox={VIEW} style={layer}>
        <Circle cx={150} cy={44} r={4.5} fill="#fff" />
        <Arc d="M138 32 Q150 22 162 32" t={t} i={0} />
        <Arc d="M128 22 Q150 4 172 22" t={t} i={1} />
        <Arc d="M118 12 Q150 -14 182 12" t={t} i={2} />
      </Svg>
      {/* tablet, centre */}
      <Animated.View style={[layer, tablet]}>
        <Svg viewBox={VIEW} style={{ width: '100%', height: '100%' }}>
          <Rect x={95} y={62} width={110} height={78} rx={12} fill="#fff" />
          <Screen x={102} y={69} w={96} h={64} />
        </Svg>
      </Animated.View>
      {/* old phone, left, leaning */}
      <Animated.View style={[layer, phone]}>
        <Svg viewBox={VIEW} style={{ width: '100%', height: '100%' }}>
          <G rotation={-8} origin="52, 112">
            <Rect x={30} y={72} width={44} height={82} rx={9} fill="#fff" opacity={0.95} />
            <Screen x={35} y={80} w={34} h={62} />
            <Rect x={46} y={146} width={12} height={3} rx={1.5} fill={INK} opacity={0.4} />
          </G>
        </Svg>
      </Animated.View>
      {/* laptop, right */}
      <Animated.View style={[layer, laptop]}>
        <Svg viewBox={VIEW} style={{ width: '100%', height: '100%' }}>
          <Rect x={218} y={88} width={66} height={46} rx={6} fill="#fff" />
          <Screen x={222} y={92} w={58} h={38} />
          <Path d="M210 136 H292 L286 144 H216 Z" fill="#fff" opacity={0.95} />
        </Svg>
      </Animated.View>
    </View>
  )
}
