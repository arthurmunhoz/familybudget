// The Documents vault door, v2 (owner, 2026-11-13: v1 read as a cartoon —
// "make it professional": a polished bank-vault door lit like a studio shot).
// Pure SVG + Reanimated, no images, original art.
//
// Layers, back to front:
//   the chamber behind (dark, warm light, folders on a shelf)
//   the wall's soft shadow + the chrome frame ring set into it
//   the DOOR (one view, pivoting on the hinge pin at its LEFT edge):
//     brushed-steel face, hinge plate + arm, rim brackets, the locking rods
//     (they draw back toward the hub), the spoked wheel, the handle slot and
//     a small status lamp
//   the hinge housing on the wall (over the arm's pin)
// The host drives:
//   wheel — degrees the wheel has turned
//   bolts — 0 locked, 1 rods drawn back (the door also unseats a hair)
//   door  — 0 shut, 1 swung open (rotateY about the pin)
//   lamp  — 0 red (locked), 1 amber (checking), 2 green (open)
import { StyleSheet, View } from 'react-native'
import Animated, { interpolate, interpolateColor, useAnimatedStyle, type SharedValue } from 'react-native-reanimated'
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg'

/** Chrome: bright bands and dark bands, lit from the top left. */
function Chrome({ id, x2 = 1, y2 = 1 }: { id: string; x2?: number; y2?: number }) {
  return (
    <LinearGradient id={id} x1="0" y1="0" x2={x2} y2={y2}>
      <Stop offset="0" stopColor="#FFFFFF" />
      <Stop offset="0.22" stopColor="#DCE0E6" />
      <Stop offset="0.48" stopColor="#8E959F" />
      <Stop offset="0.62" stopColor="#E9ECF0" />
      <Stop offset="0.82" stopColor="#B4BAC3" />
      <Stop offset="1" stopColor="#6E757F" />
    </LinearGradient>
  )
}

/** A rod or bar seen side on: light along its middle, dark at the edges. */
function Cylinder({ id, vertical }: { id: string; vertical?: boolean }) {
  return (
    <LinearGradient id={id} x1="0" y1="0" x2={vertical ? 1 : 0} y2={vertical ? 0 : 1}>
      <Stop offset="0" stopColor="#5E656F" />
      <Stop offset="0.35" stopColor="#F4F6F8" />
      <Stop offset="0.55" stopColor="#C9CED5" />
      <Stop offset="1" stopColor="#4C525B" />
    </LinearGradient>
  )
}

function Bolt({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <G>
      <Circle cx={x + s * 0.25} cy={y + s * 0.3} r={s} fill="#000" opacity={0.22} />
      <Circle cx={x} cy={y} r={s} fill="url(#vBolt)" />
      <Circle cx={x - s * 0.3} cy={y - s * 0.3} r={s * 0.35} fill="#FFF" opacity={0.7} />
    </G>
  )
}

export function VaultDoor({
  size,
  wheel,
  bolts,
  door,
  lamp,
}: {
  /** Diameter of the door itself. */
  size: number
  wheel: SharedValue<number>
  bolts: SharedValue<number>
  door: SharedValue<number>
  lamp: SharedValue<number>
}) {
  const D = size
  const r = D / 2
  const T = D * 0.085 // frame ring
  const R = r + T
  // Room around for the wall shadow, which falls down-right.
  const W = Math.round(2 * R + D * 0.42)
  const H = Math.round(2 * R + D * 0.26)
  const cx = W - R - D * 0.12
  const cy = H / 2 - D * 0.04
  const pinX = cx - R - D * 0.075
  // The door view: from the pin to the door's right edge.
  const ox = cx - pinX // door centre inside its view
  const dW = cx + r - pinX

  const doorStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 1200 },
      { rotateY: `${-100 * door.value}deg` },
      // Unseats from the frame a hair as the rods let go.
      { scale: 1 + interpolate(bolts.value, [0, 1], [0, 0.012]) },
    ],
  }))
  const shadeStyle = useAnimatedStyle(() => ({ opacity: interpolate(door.value, [0, 1], [0, 0.55]) }))
  const wheelStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${wheel.value}deg` }] }))
  const glowStyle = useAnimatedStyle(() => ({ opacity: interpolate(door.value, [0, 0.12, 1], [0.15, 0.6, 1]) }))
  const lampStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(lamp.value, [0, 1, 2], ['#FF4B3E', '#FFB938', '#36D97B']),
    shadowColor: interpolateColor(lamp.value, [0, 1, 2], ['#FF4B3E', '#FFB938', '#36D97B']),
  }))

  // Rim brackets the diagonal rods lock into, and the plate the third one meets.
  const BRACKETS = [-38, 38]
  const plateX = ox - r * 0.62 // plate's right edge (inside the door view)
  const rodW = r * 0.05
  const rods = [
    ...BRACKETS.map((deg) => ({ deg, len: r * 0.8 })),
    { deg: 180, len: ox - plateX - r * 0.02 },
  ]

  return (
    <View style={{ width: W, height: H }}>
      {/* the chamber, seen once the door moves */}
      <View style={{ position: 'absolute', left: cx - r, top: cy - r, width: D, height: D, borderRadius: r, overflow: 'hidden', backgroundColor: '#0D0B09' }}>
        <Animated.View style={[StyleSheet.absoluteFill, glowStyle]}>
          <Svg width={D} height={D}>
            <Defs>
              <RadialGradient id="vIn" cx="50%" cy="38%" r="70%">
                <Stop offset="0" stopColor="#FFE9BE" />
                <Stop offset="0.35" stopColor="#C8914A" />
                <Stop offset="0.75" stopColor="#3B2814" />
                <Stop offset="1" stopColor="#0D0B09" />
              </RadialGradient>
              <LinearGradient id="vShelf" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#7A5A33" />
                <Stop offset="1" stopColor="#2A1D10" />
              </LinearGradient>
            </Defs>
            <Circle cx={r} cy={r} r={r} fill="url(#vIn)" />
            {/* a shelf of folders and papers */}
            {[
              { x: 0.24, w: 0.07, h: 0.3, c: '#E9DCC2' },
              { x: 0.32, w: 0.06, h: 0.27, c: '#C9A46A' },
              { x: 0.39, w: 0.08, h: 0.32, c: '#F4ECDC' },
              { x: 0.48, w: 0.05, h: 0.25, c: '#A9845A' },
              { x: 0.54, w: 0.07, h: 0.3, c: '#EFE4CF' },
              { x: 0.62, w: 0.06, h: 0.28, c: '#D5B786' },
            ].map((f, i) => (
              <Rect key={i} x={D * f.x} y={D * (0.62 - f.h)} width={D * f.w} height={D * f.h} rx={D * 0.008} fill={f.c} opacity={0.92} />
            ))}
            <Rect x={D * 0.12} y={D * 0.62} width={D * 0.76} height={D * 0.035} fill="url(#vShelf)" />
            <Rect x={D * 0.3} y={D * 0.7} width={D * 0.4} height={D * 0.13} rx={D * 0.01} fill="#F3EBDD" opacity={0.85} />
            <Rect x={D * 0.33} y={D * 0.68} width={D * 0.38} height={D * 0.13} rx={D * 0.01} fill="#FFFAF0" opacity={0.9} transform={`rotate(-4 ${r} ${D * 0.75})`} />
          </Svg>
        </Animated.View>
      </View>

      {/* the wall: contact shadow + the chrome frame ring */}
      <Svg width={W} height={H} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="vWallSh" cx="50%" cy="50%" r="50%">
            <Stop offset="0.8" stopColor="#000" stopOpacity={0.3} />
            <Stop offset="1" stopColor="#000" stopOpacity={0} />
          </RadialGradient>
          <Chrome id="vRing" />
          <LinearGradient id="vRingIn" x1="1" y1="1" x2="0" y2="0">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.9} />
            <Stop offset="1" stopColor="#3C424A" stopOpacity={0.9} />
          </LinearGradient>
        </Defs>
        <Ellipse cx={cx + D * 0.035} cy={cy + D * 0.05} rx={R * 1.1} ry={R * 1.1} fill="url(#vWallSh)" />
        <Circle cx={cx} cy={cy} r={R - T / 2} stroke="url(#vRing)" strokeWidth={T} fill="none" />
        <Circle cx={cx} cy={cy} r={R - 0.5} stroke="#FFFFFF" strokeOpacity={0.55} strokeWidth={1} fill="none" />
        {/* the inner lip catches light on the bottom right (it faces up-left) */}
        <Circle cx={cx} cy={cy} r={r + T * 0.18} stroke="url(#vRingIn)" strokeWidth={T * 0.22} fill="none" />
        <Circle cx={cx} cy={cy} r={r + 0.6} stroke="#0B0D10" strokeOpacity={0.85} strokeWidth={2.2} fill="none" />
      </Svg>

      {/* the door */}
      <Animated.View style={[{ position: 'absolute', left: pinX, top: cy - r, width: dW, height: D, transformOrigin: 'left' }, doorStyle]}>
        <Svg width={dW} height={D}>
          <Defs>
            <RadialGradient id="vFace" cx="34%" cy="28%" r="85%">
              <Stop offset="0" stopColor="#F7F8FA" />
              <Stop offset="0.45" stopColor="#CDD2D9" />
              <Stop offset="1" stopColor="#8D949E" />
            </RadialGradient>
            <LinearGradient id="vEdge" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#FFFFFF" />
              <Stop offset="0.5" stopColor="#AEB4BC" />
              <Stop offset="1" stopColor="#5D646D" />
            </LinearGradient>
            <Chrome id="vPlate" x2={1} y2={0.3} />
            <Cylinder id="vArm" />
            <RadialGradient id="vBolt" cx="35%" cy="35%" r="70%">
              <Stop offset="0" stopColor="#FFFFFF" />
              <Stop offset="0.6" stopColor="#B9BFC7" />
              <Stop offset="1" stopColor="#6A717A" />
            </RadialGradient>
            <LinearGradient id="vSlot" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#1A1D22" />
              <Stop offset="0.7" stopColor="#3B4048" />
              <Stop offset="1" stopColor="#D7DBE0" />
            </LinearGradient>
          </Defs>

          {/* the face */}
          <Circle cx={ox} cy={r} r={r} fill="url(#vFace)" />
          {/* brushed: fine concentric strokes */}
          {Array.from({ length: 16 }, (_, i) => (
            <Circle
              key={i}
              cx={ox}
              cy={r}
              r={r * (0.2 + i * 0.048)}
              stroke={i % 2 ? '#FFFFFF' : '#5A616B'}
              strokeOpacity={i % 2 ? 0.16 : 0.06}
              strokeWidth={0.8}
              fill="none"
            />
          ))}
          {/* bevelled edge + a raised inner disc */}
          <Circle cx={ox} cy={r} r={r - D * 0.012} stroke="url(#vEdge)" strokeWidth={D * 0.024} fill="none" />
          <Circle cx={ox} cy={r} r={r * 0.87} stroke="#4A5058" strokeOpacity={0.35} strokeWidth={1.6} fill="none" />
          <Circle cx={ox} cy={r + 1.2} r={r * 0.87} stroke="#FFFFFF" strokeOpacity={0.55} strokeWidth={1} fill="none" />

          {/* rim brackets */}
          {BRACKETS.map((deg) => {
            const a = (deg * Math.PI) / 180
            const bx = ox + Math.cos(a) * r * 0.84
            const by = r + Math.sin(a) * r * 0.84
            const bw = r * 0.2
            const bh = r * 0.13
            return (
              <G key={deg} transform={`rotate(${deg} ${bx} ${by})`}>
                <Rect x={bx - bw / 2 + 1.5} y={by - bh / 2 + 2} width={bw} height={bh} rx={r * 0.02} fill="#000" opacity={0.2} />
                <Rect x={bx - bw / 2} y={by - bh / 2} width={bw} height={bh} rx={r * 0.02} fill="url(#vPlate)" stroke="#6B727B" strokeWidth={0.8} />
                <Bolt x={bx - bw * 0.28} y={by} s={r * 0.022} />
                <Bolt x={bx + bw * 0.28} y={by} s={r * 0.022} />
              </G>
            )
          })}

          {/* hinge arm (to the pin) + the plate on the door */}
          <Rect x={0} y={r - r * 0.1 + 3} width={plateX} height={r * 0.2} rx={r * 0.05} fill="#000" opacity={0.18} />
          <Rect x={0} y={r - r * 0.1} width={plateX} height={r * 0.2} rx={r * 0.05} fill="url(#vArm)" />
          {[-1, 1].map((sgn) => (
            <G key={sgn}>
              <Rect x={plateX - r * 0.34 + 2} y={r + sgn * r * 0.5 - r * 0.13 + 3} width={r * 0.34} height={r * 0.26} rx={r * 0.04} fill="#000" opacity={0.2} />
              <Rect x={plateX - r * 0.34} y={r + sgn * r * 0.5 - r * 0.13} width={r * 0.34} height={r * 0.26} rx={r * 0.04} fill="url(#vPlate)" stroke="#6B727B" strokeWidth={0.8} />
              {[0.25, 0.75].map((kx) =>
                [0.28, 0.72].map((ky) => (
                  <Bolt key={`${kx}${ky}`} x={plateX - r * 0.34 + r * 0.34 * kx} y={r + sgn * r * 0.5 - r * 0.13 + r * 0.26 * ky} s={r * 0.02} />
                )),
              )}
            </G>
          ))}
          <Rect x={plateX - r * 0.26 + 2.5} y={r - r * 0.62 + 3} width={r * 0.24} height={r * 1.24} rx={r * 0.06} fill="#000" opacity={0.2} />
          <Rect x={plateX - r * 0.26} y={r - r * 0.62} width={r * 0.24} height={r * 1.24} rx={r * 0.06} fill="url(#vPlate)" stroke="#6B727B" strokeWidth={0.8} />
          <Rect x={plateX - r * 0.22} y={r - r * 0.58} width={r * 0.04} height={r * 1.16} rx={r * 0.02} fill="#FFFFFF" opacity={0.5} />

          {/* handle slot */}
          <G transform={`rotate(8 ${ox + r * 0.63} ${r})`}>
            <Rect x={ox + r * 0.6} y={r - r * 0.17} width={r * 0.075} height={r * 0.34} rx={r * 0.037} fill="url(#vSlot)" />
          </G>
        </Svg>

        {/* the locking rods: from the hub out to a bracket / the plate */}
        {rods.map((rod) => (
          <Rod key={rod.deg} x={ox} y={r} len={rod.len} w={rodW} deg={rod.deg} bolts={bolts} />
        ))}

        {/* the wheel */}
        <Animated.View style={[{ position: 'absolute', left: ox - r * 0.44, top: r - r * 0.44, width: r * 0.88, height: r * 0.88 }, wheelStyle]}>
          <Wheel size={r * 0.88} />
        </Animated.View>

        {/* status lamp, in a small chrome bezel by the handle */}
        <View style={{ position: 'absolute', left: ox + r * 0.6, top: r - r * 0.42, width: r * 0.09, height: r * 0.09, borderRadius: r * 0.045, backgroundColor: '#C3C8CF', borderWidth: 1, borderColor: '#6E757E', alignItems: 'center', justifyContent: 'center' }}>
          <Animated.View
            style={[
              { width: r * 0.055, height: r * 0.055, borderRadius: r * 0.0275, shadowOpacity: 0.95, shadowRadius: 5, shadowOffset: { width: 0, height: 0 } },
              lampStyle,
            ]}
          />
        </View>

        {/* the face darkens as it turns away from the light */}
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: ox - r, top: 0, width: D, height: D, borderRadius: r, backgroundColor: '#000' }, shadeStyle]} />
      </Animated.View>

      {/* hinge housing on the wall, over the arm's end */}
      <Svg width={W} height={H} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <Chrome id="vHouse" x2={1} y2={0.2} />
          <Cylinder id="vKnuckle" vertical />
          <RadialGradient id="vBolt2" cx="35%" cy="35%" r="70%">
            <Stop offset="0" stopColor="#FFFFFF" />
            <Stop offset="0.6" stopColor="#B9BFC7" />
            <Stop offset="1" stopColor="#6A717A" />
          </RadialGradient>
        </Defs>
        <Rect x={pinX - D * 0.075 + 3} y={cy - r * 0.42 + 4} width={D * 0.15} height={r * 0.84} rx={D * 0.02} fill="#000" opacity={0.22} />
        <Rect x={pinX - D * 0.075} y={cy - r * 0.42} width={D * 0.15} height={r * 0.84} rx={D * 0.02} fill="url(#vHouse)" stroke="#6B727B" strokeWidth={0.8} />
        {[-1, 1].map((sgn) => (
          <Rect key={sgn} x={pinX - D * 0.03} y={cy + sgn * r * 0.2 - r * 0.11} width={D * 0.06} height={r * 0.22} rx={D * 0.012} fill="url(#vKnuckle)" stroke="#4E555E" strokeWidth={0.6} />
        ))}
        <Rect x={pinX - D * 0.03} y={cy - r * 0.06} width={D * 0.06} height={r * 0.12} rx={D * 0.012} fill="url(#vKnuckle)" stroke="#4E555E" strokeWidth={0.6} />
        {[-0.33, 0.33].map((k) => (
          <G key={k}>
            <Circle cx={pinX - D * 0.05} cy={cy + r * k} r={D * 0.01} fill="url(#vBolt2)" />
            <Circle cx={pinX + D * 0.05} cy={cy + r * k} r={D * 0.01} fill="url(#vBolt2)" />
          </G>
        ))}
      </Svg>
    </View>
  )
}

/** One locking rod, anchored at the hub; drawn back it shortens toward it. */
function Rod({ x, y, len, w, deg, bolts }: { x: number; y: number; len: number; w: number; deg: number; bolts: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${deg}deg` }, { scaleX: interpolate(bolts.value, [0, 1], [1, 0.42]) }],
  }))
  return (
    <Animated.View style={[{ position: 'absolute', left: x, top: y - w / 2, width: len, height: w, transformOrigin: 'left' }, style]}>
      <Svg width={len} height={w + 3}>
        <Defs>
          <Cylinder id={`vRod${deg}`} />
        </Defs>
        <Rect x={0} y={2.5} width={len} height={w} rx={w / 2} fill="#000" opacity={0.2} />
        <Rect x={0} y={0} width={len} height={w} rx={w / 2} fill={`url(#vRod${deg})`} />
      </Svg>
    </Animated.View>
  )
}

/** The wheel: a thin chrome rim, eight spokes, a bolted hub with a dome. */
function Wheel({ size }: { size: number }) {
  const c = size / 2
  const rimR = c * 0.9
  const sw = size * 0.032
  return (
    <Svg width={size} height={size}>
      <Defs>
        <Chrome id="vRim" />
        <Cylinder id="vSpoke" />
        <RadialGradient id="vHub" cx="35%" cy="30%" r="75%">
          <Stop offset="0" stopColor="#FFFFFF" />
          <Stop offset="0.5" stopColor="#C5CAD1" />
          <Stop offset="1" stopColor="#70777F" />
        </RadialGradient>
        <RadialGradient id="vDome" cx="35%" cy="30%" r="70%">
          <Stop offset="0" stopColor="#FFFFFF" />
          <Stop offset="0.55" stopColor="#AEB4BC" />
          <Stop offset="1" stopColor="#5C636C" />
        </RadialGradient>
      </Defs>
      {/* shadow of the whole wheel on the door */}
      <Circle cx={c + 2} cy={c + 3} r={rimR} stroke="#000" strokeOpacity={0.2} strokeWidth={sw * 1.4} fill="none" />
      {Array.from({ length: 8 }, (_, i) => (
        <G key={i} transform={`rotate(${i * 45} ${c} ${c})`}>
          <Rect x={c} y={c - sw * 0.45 + 2.5} width={rimR} height={sw * 0.9} rx={sw * 0.45} fill="#000" opacity={0.16} />
          <Rect x={c} y={c - sw * 0.45} width={rimR} height={sw * 0.9} rx={sw * 0.45} fill="url(#vSpoke)" />
        </G>
      ))}
      <Circle cx={c} cy={c} r={rimR} stroke="url(#vRim)" strokeWidth={sw * 1.5} fill="none" />
      <Circle cx={c} cy={c} r={rimR - sw * 0.35} stroke="#FFFFFF" strokeOpacity={0.6} strokeWidth={0.8} fill="none" />
      {/* hub */}
      <Circle cx={c + 1.5} cy={c + 2.5} r={c * 0.36} fill="#000" opacity={0.22} />
      <Circle cx={c} cy={c} r={c * 0.36} fill="url(#vHub)" stroke="#6B727B" strokeWidth={0.8} />
      {Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * Math.PI * 2
        return <Circle key={i} cx={c + Math.cos(a) * c * 0.27} cy={c + Math.sin(a) * c * 0.27} r={c * 0.028} fill="#7E858E" />
      })}
      <Circle cx={c} cy={c} r={c * 0.17} fill="url(#vDome)" stroke="#5E656E" strokeWidth={0.8} />
      <Circle cx={c - c * 0.06} cy={c - c * 0.07} r={c * 0.05} fill="#FFFFFF" opacity={0.85} />
    </Svg>
  )
}
