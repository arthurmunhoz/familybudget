// The Documents vault door (owner, 2026-11-13: "a safe with a spinning wheel
// that opens its door", instead of a plain padlock screen). Pure SVG +
// Reanimated, no images.
//
// Layers, back to front: the lit interior (documents waiting inside), the
// steel frame, four brass bolts, the door (face + spoked wheel + status lamp)
// and the hinges. The host drives four values:
//   wheel  — degrees the wheel has turned
//   bolts  — 0 out, 1 drawn back under the door
//   door   — 0 shut, 1 swung open (rotateY about its left edge)
//   lamp   — 0 red (locked), 1 amber (checking), 2 green (open)
import { StyleSheet, View } from 'react-native'
import Animated, { interpolate, interpolateColor, useAnimatedStyle, type SharedValue } from 'react-native-reanimated'
import Svg, { Circle, Defs, G, Line, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg'

const BRASS: [string, string] = ['#F1D58E', '#A87A2C']

export function VaultDoor({
  size,
  wheel,
  bolts,
  door,
  lamp,
}: {
  /** Diameter of the door; the frame is 1.16× that. */
  size: number
  wheel: SharedValue<number>
  bolts: SharedValue<number>
  door: SharedValue<number>
  lamp: SharedValue<number>
}) {
  const D = size
  const S = Math.round(D * 1.16)
  const off = (S - D) / 2
  const r = D / 2

  const doorStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1100 }, { rotateY: `${-96 * door.value}deg` }],
  }))
  // The face darkens as it turns away from the light.
  const shadeStyle = useAnimatedStyle(() => ({ opacity: interpolate(door.value, [0, 1], [0, 0.65]) }))
  const wheelStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${wheel.value}deg` }] }))
  // Light floods out of the vault as the door swings.
  const glowStyle = useAnimatedStyle(() => ({ opacity: interpolate(door.value, [0, 0.15, 1], [0, 0.55, 1]) }))
  const lampStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(lamp.value, [0, 1, 2], ['#FF5A4E', '#FFC24A', '#46E08A']),
    shadowColor: interpolateColor(lamp.value, [0, 1, 2], ['#FF5A4E', '#FFC24A', '#46E08A']),
  }))

  const boltLen = D * 0.17
  const boltW = D * 0.075
  // A bolt pokes out past the door edge into the frame; drawn back, it slides
  // under the door and out of sight.
  const bolt = (angle: number) => {
    const rad = (angle * Math.PI) / 180
    const cx = S / 2 + Math.cos(rad) * (r + boltLen * 0.18)
    const cy = S / 2 + Math.sin(rad) * (r + boltLen * 0.18)
    return { angle, rad, cx, cy }
  }
  const BOLTS = [0, 90, 180, 270].map(bolt)

  return (
    <View style={{ width: S, height: S }}>
      {/* the interior, seen once the door moves */}
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <View style={{ width: D, height: D, borderRadius: r, overflow: 'hidden', backgroundColor: '#120E09' }}>
          <Animated.View style={[StyleSheet.absoluteFill, glowStyle]}>
            <Svg width={D} height={D}>
              <Defs>
                <RadialGradient id="vin" cx="50%" cy="46%" r="60%">
                  <Stop offset="0" stopColor="#FFF1CC" />
                  <Stop offset="0.45" stopColor="#E7B867" />
                  <Stop offset="1" stopColor="#3A2710" />
                </RadialGradient>
              </Defs>
              <Circle cx={r} cy={r} r={r} fill="url(#vin)" />
              {/* papers stacked inside */}
              <G opacity={0.92}>
                <Rect x={r - D * 0.2} y={r - D * 0.17} width={D * 0.3} height={D * 0.38} rx={D * 0.02} fill="#FFFDF7" transform={`rotate(-9 ${r} ${r})`} />
                <Rect x={r - D * 0.1} y={r - D * 0.2} width={D * 0.3} height={D * 0.38} rx={D * 0.02} fill="#FFF8E8" transform={`rotate(7 ${r} ${r})`} />
                {[0, 1, 2, 3].map((i) => (
                  <Rect
                    key={i}
                    x={r - D * 0.05}
                    y={r - D * 0.13 + i * D * 0.055}
                    width={D * (i === 3 ? 0.12 : 0.19)}
                    height={D * 0.016}
                    rx={D * 0.008}
                    fill="#D8C49C"
                    transform={`rotate(7 ${r} ${r})`}
                  />
                ))}
              </G>
            </Svg>
          </Animated.View>
        </View>
      </View>

      {/* the frame */}
      <Svg width={S} height={S} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="vfr" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#5A6475" />
            <Stop offset="0.5" stopColor="#2C3340" />
            <Stop offset="1" stopColor="#171B23" />
          </LinearGradient>
        </Defs>
        <Circle cx={S / 2} cy={S / 2} r={(S + D) / 4} stroke="url(#vfr)" strokeWidth={off + 1} fill="none" />
        <Circle cx={S / 2} cy={S / 2} r={S / 2 - 1} stroke="#7C8698" strokeOpacity={0.5} strokeWidth={1.2} fill="none" />
        <Circle cx={S / 2} cy={S / 2} r={r + 0.5} stroke="#05070A" strokeOpacity={0.9} strokeWidth={2} fill="none" />
        {Array.from({ length: 20 }, (_, i) => {
          const a = (i / 20) * Math.PI * 2
          const rr = (S + D) / 4
          return <Circle key={i} cx={S / 2 + Math.cos(a) * rr} cy={S / 2 + Math.sin(a) * rr} r={D * 0.012} fill="#9AA4B5" opacity={0.55} />
        })}
      </Svg>

      {/* the bolts */}
      {BOLTS.map((b) => (
        <Bolt key={b.angle} b={b} len={boltLen} w={boltW} bolts={bolts} travel={boltLen * 0.85} />
      ))}

      {/* the door */}
      <Animated.View
        style={[
          { position: 'absolute', left: off, top: off, width: D, height: D, borderRadius: r, transformOrigin: 'left' },
          doorStyle,
        ]}
      >
        <Svg width={D} height={D}>
          <Defs>
            <RadialGradient id="vdf" cx="38%" cy="32%" r="80%">
              <Stop offset="0" stopColor="#8592A6" />
              <Stop offset="0.55" stopColor="#4A5466" />
              <Stop offset="1" stopColor="#262C37" />
            </RadialGradient>
            <LinearGradient id="vgl" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.35} />
              <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Circle cx={r} cy={r} r={r} fill="url(#vdf)" />
          {/* machined rings: a dark groove with a light lip */}
          {[0.9, 0.74].map((k) => (
            <G key={k}>
              <Circle cx={r} cy={r} r={r * k} stroke="#151920" strokeOpacity={0.55} strokeWidth={2.5} fill="none" />
              <Circle cx={r} cy={r + 1.5} r={r * k} stroke="#C9D2DF" strokeOpacity={0.22} strokeWidth={1.2} fill="none" />
            </G>
          ))}
          {/* bolt heads around the face */}
          {Array.from({ length: 12 }, (_, i) => {
            const a = (i / 12) * Math.PI * 2 + Math.PI / 12
            const rr = r * 0.82
            return (
              <G key={i}>
                <Circle cx={r + Math.cos(a) * rr} cy={r + Math.sin(a) * rr + 1} r={D * 0.022} fill="#11151B" opacity={0.6} />
                <Circle cx={r + Math.cos(a) * rr} cy={r + Math.sin(a) * rr} r={D * 0.02} fill="#A9B3C2" />
              </G>
            )
          })}
          {/* dial ticks around the wheel */}
          {Array.from({ length: 36 }, (_, i) => {
            const a = (i / 36) * Math.PI * 2
            const r1 = r * 0.62
            const r2 = r * (i % 3 === 0 ? 0.56 : 0.59)
            return (
              <Line
                key={i}
                x1={r + Math.cos(a) * r1}
                y1={r + Math.sin(a) * r1}
                x2={r + Math.cos(a) * r2}
                y2={r + Math.sin(a) * r2}
                stroke="#DDE3EC"
                strokeOpacity={i % 3 === 0 ? 0.55 : 0.25}
                strokeWidth={i % 3 === 0 ? 1.6 : 1}
              />
            )
          })}
          <Circle cx={r} cy={r} r={r} fill="url(#vgl)" />
        </Svg>

        {/* the wheel */}
        <Animated.View style={[{ position: 'absolute', left: r - D * 0.27, top: r - D * 0.27, width: D * 0.54, height: D * 0.54 }, wheelStyle]}>
          <Wheel size={D * 0.54} />
        </Animated.View>

        {/* status lamp */}
        <Animated.View
          style={[
            {
              position: 'absolute',
              left: r - D * 0.025,
              top: D * 0.115,
              width: D * 0.05,
              height: D * 0.05,
              borderRadius: D * 0.025,
              borderWidth: 1.5,
              borderColor: '#1B1F27',
              shadowOpacity: 0.9,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 0 },
            },
            lampStyle,
          ]}
        />

        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: r, backgroundColor: '#000' }, shadeStyle]} />
      </Animated.View>

      {/* hinges, on the frame over the door's left edge */}
      {[0.3, 0.7].map((k) => (
        <View
          key={k}
          style={{
            position: 'absolute',
            left: off - D * 0.045,
            top: off + D * k - D * 0.06,
            width: D * 0.09,
            height: D * 0.12,
            borderRadius: D * 0.025,
            backgroundColor: '#3A4250',
            borderWidth: 1,
            borderColor: '#7D8798',
          }}
        />
      ))}
    </View>
  )
}

function Bolt({
  b,
  len,
  w,
  bolts,
  travel,
}: {
  b: { angle: number; rad: number; cx: number; cy: number }
  len: number
  w: number
  bolts: SharedValue<number>
  travel: number
}) {
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(bolts.value, [0, 0.8, 1], [1, 1, 0]),
    transform: [
      { translateX: -Math.cos(b.rad) * travel * bolts.value },
      { translateY: -Math.sin(b.rad) * travel * bolts.value },
      { rotate: `${b.angle}deg` },
    ],
  }))
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: b.cx - len / 2,
          top: b.cy - w / 2,
          width: len,
          height: w,
          borderRadius: w / 2,
          backgroundColor: BRASS[1],
          borderTopWidth: w * 0.35,
          borderTopColor: BRASS[0],
        },
        style,
      ]}
    />
  )
}

/** The spoked wheel: hub, three bars (six arms) with round grips. */
function Wheel({ size }: { size: number }) {
  const c = size / 2
  const arm = c * 0.86
  return (
    <Svg width={size} height={size}>
      <Defs>
        <LinearGradient id="vwb" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={BRASS[0]} />
          <Stop offset="1" stopColor={BRASS[1]} />
        </LinearGradient>
      </Defs>
      <Circle cx={c} cy={c + 2} r={c * 0.36} fill="#000" opacity={0.3} />
      {[0, 60, 120].map((deg) => (
        <G key={deg} transform={`rotate(${deg} ${c} ${c})`}>
          <Rect x={c - arm} y={c - size * 0.035 + 2} width={arm * 2} height={size * 0.07} rx={size * 0.035} fill="#000" opacity={0.25} />
          <Rect x={c - arm} y={c - size * 0.035} width={arm * 2} height={size * 0.07} rx={size * 0.035} fill="url(#vwb)" />
          <Circle cx={c - arm} cy={c} r={size * 0.062} fill="url(#vwb)" stroke="#7A5820" strokeWidth={1} />
          <Circle cx={c + arm} cy={c} r={size * 0.062} fill="url(#vwb)" stroke="#7A5820" strokeWidth={1} />
        </G>
      ))}
      <Circle cx={c} cy={c} r={c * 0.34} fill="url(#vwb)" stroke="#7A5820" strokeWidth={1.2} />
      <Circle cx={c} cy={c} r={c * 0.2} fill="#5C6678" stroke="#2A2F38" strokeWidth={1.2} />
      <Circle cx={c - c * 0.06} cy={c - c * 0.06} r={c * 0.07} fill="#FFFFFF" opacity={0.35} />
    </Svg>
  )
}
