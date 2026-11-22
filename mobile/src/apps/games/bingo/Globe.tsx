// The bingo globe: a wire cage full of balls on a stand, seen along its axle,
// so it turns like a wheel with the crank on the front.
//
// The balls are a small PHYSICS simulation on the UI thread (owner,
// 2026-11-22: the first version moved them on fixed orbits and read as
// fake): gravity, bouncing off the cage, knocking into each other, and the
// turning cage dragging the ones that touch it — so at rest they lie in a
// pile that creeps and slumps, and when a ball is being drawn (`spinning`)
// they're carried up the side and tumble back over each other.
//
// Depth: every ball is a shaded sphere whose number face slides across it as
// it rolls; each drifts nearer / farther as it moves (bigger and in front, or
// smaller, dimmer and behind); the cage's back wires are drawn BEHIND the
// balls and its front wires over them; the glass has its own fixed light.
// Original art.
import { useEffect, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { useAnimatedStyle, useFrameCallback, useReducedMotion, useSharedValue, type SharedValue } from 'react-native-reanimated'
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg'

import { Shine, Sphere } from './Sphere'

const N = 14
/** Ball radius, as a fraction of the cage's inner radius. */
const BALL = 0.15
const HOOPS = 5

interface Sim {
  x: number[]
  y: number[]
  vx: number[]
  vy: number[]
  /** How far each ball has rolled (drives its face and its depth). */
  roll: number[]
}

/** Deterministic 0…1 noise, so render stays pure. */
function rand(n: number) {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

/** A loose pile at the bottom to start from (it settles in a moment). */
function pile(R: number): Sim {
  const r = R * BALL
  const x: number[] = []
  const y: number[] = []
  const rows = [5, 5, 4]
  let i = 0
  rows.forEach((n, row) => {
    for (let k = 0; k < n && i < N; k++, i++) {
      x.push((k - (n - 1) / 2) * r * 2.1 + (rand(i) - 0.5) * 2)
      y.push(R * 0.72 - row * r * 1.9)
    }
  })
  return { x, y, vx: x.map(() => 0), vy: x.map(() => 0), roll: x.map((_, k) => rand(k + 9) * 6) }
}

function GlobeBall({ i, d, sim }: { i: number; d: number; sim: SharedValue<Sim> }) {
  const col = i % 5
  const phase = useMemo(() => rand(i + 31) * Math.PI * 2, [i])
  const face = d * 0.5
  const body = useAnimatedStyle(() => {
    const s = sim.value
    // Nearer or farther, changing as the ball travels.
    const z = Math.sin(phase + s.roll[i] * 0.55)
    return {
      zIndex: Math.round(z * 20) + 20,
      opacity: 0.8 + 0.2 * (z * 0.5 + 0.5),
      transform: [{ translateX: s.x[i] }, { translateY: s.y[i] }, { scale: 0.86 + 0.16 * (z * 0.5 + 0.5) }],
    }
  })
  // The number face rides the surface: it slides toward the edge, narrows as
  // it goes round, and disappears onto the far side.
  const spot = useAnimatedStyle(() => {
    const a = sim.value.roll[i]
    const c = Math.cos(a)
    return {
      opacity: c > 0 ? 1 : 0,
      transform: [{ translateX: Math.sin(a) * d * 0.3 }, { translateY: Math.sin(a * 0.37 + phase) * d * 0.12 }, { scaleX: Math.max(0.05, c) }],
    }
  })
  return (
    <Animated.View style={[styles.ball, { width: d, height: d, marginLeft: -d / 2, marginTop: -d / 2 }, body]}>
      <Sphere col={col} size={d} />
      <Animated.View style={[styles.face, { width: face, height: face, borderRadius: face / 2, left: (d - face) / 2, top: (d - face) / 2 }, spot]} />
      <View style={StyleSheet.absoluteFill}>
        <Shine size={d} />
      </View>
    </Animated.View>
  )
}

/** Half of every hoop: `front` = the half nearer the viewer. Drawn in a view
 *  that turns with the cage. */
function Wires({ size, R, front }: { size: number; R: number; front: boolean }) {
  const c = size / 2
  return (
    <Svg width={size} height={size}>
      {Array.from({ length: HOOPS }, (_, k) => {
        const a = (k * 180) / HOOPS
        // A tilted great circle = a thin ellipse; its lower arc is the near half.
        const d = `M${c - R} ${c} A${R} ${R * 0.24} 0 0 ${front ? 0 : 1} ${c + R} ${c}`
        return (
          <Path
            key={k}
            d={d}
            transform={`rotate(${a} ${c} ${c})`}
            stroke={front ? '#FFFFFF' : '#DFFBF6'}
            strokeOpacity={front ? 0.85 : 0.34}
            strokeWidth={front ? 1.9 : 1.3}
            strokeLinecap="round"
            fill="none"
          />
        )
      })}
      {front ? (
        <G>
          {/* the crank: an arm off the hub with a knob, turning with the cage */}
          <Path d={`M${c} ${c} L${c + R * 0.46} ${c}`} stroke="#F4FFFD" strokeWidth={3.6} strokeLinecap="round" />
          <Circle cx={c + R * 0.46} cy={c} r={R * 0.1} fill="#FFFFFF" />
          <Circle cx={c + R * 0.44} cy={c - R * 0.03} r={R * 0.04} fill="#D9F3EE" />
        </G>
      ) : null}
    </Svg>
  )
}

/** `size` = the cage's diameter; the whole piece is size × size*1.26. */
export function Globe({ size, spinning }: { size: number; spinning: boolean }) {
  const reduce = useReducedMotion()
  const R = size / 2 - 3
  const inner = R - 2.5
  const d = inner * BALL * 2
  const cx = size / 2
  const cy = size / 2
  const H = size * 1.26
  const sim = useSharedValue<Sim>(pile(inner))
  const turn = useSharedValue(0)
  const omega = useSharedValue(0.4)
  const live = useSharedValue(0)
  useEffect(() => {
    live.set(spinning && !reduce ? 1 : 0)
  }, [live, spinning, reduce])

  useFrameCallback((f) => {
    const dt = Math.min(0.034, (f.timeSincePreviousFrame ?? 16) / 1000)
    const on = live.get()
    // The cage: a lazy turn at rest, a proper whirl for a draw. Slow enough
    // that the balls fall off the top instead of sticking to the wall.
    const want = on ? 4.3 : reduce ? 0 : 0.4
    const w = omega.get() + (want - omega.get()) * Math.min(1, dt * (on ? 4 : 1.6))
    omega.set(w)
    turn.set(turn.get() + w * dt)
    const g = inner * 19
    const r = inner * BALL
    const lim = inner - r
    const grip = 3 + Math.abs(w) * 3.2
    const SUB = 2
    const h = dt / SUB
    sim.modify((s) => {
      'worklet'
      for (let step = 0; step < SUB; step++) {
        for (let i = 0; i < N; i++) {
          s.vy[i] += g * h
          if (on) {
            // The cage's fins knock things about a little.
            s.vx[i] += (Math.random() - 0.5) * inner * 9 * h
            s.vy[i] += (Math.random() - 0.5) * inner * 9 * h
          }
          s.x[i] += s.vx[i] * h
          s.y[i] += s.vy[i] * h
          const dist = Math.hypot(s.x[i], s.y[i])
          if (dist > lim) {
            const nx = s.x[i] / dist
            const ny = s.y[i] / dist
            s.x[i] = nx * lim
            s.y[i] = ny * lim
            const vn = s.vx[i] * nx + s.vy[i] * ny
            if (vn > 0) {
              s.vx[i] -= 1.42 * vn * nx
              s.vy[i] -= 1.42 * vn * ny
            }
            // The turning wall drags the ball along with it.
            const tx = -ny
            const ty = nx
            const slip = w * lim - (s.vx[i] * tx + s.vy[i] * ty)
            const k = Math.min(1, grip * h)
            s.vx[i] += tx * slip * k
            s.vy[i] += ty * slip * k
          }
        }
        for (let i = 0; i < N; i++) {
          for (let j = i + 1; j < N; j++) {
            const dx = s.x[j] - s.x[i]
            const dy = s.y[j] - s.y[i]
            const dd = dx * dx + dy * dy
            const min = r * 2
            if (dd >= min * min || dd === 0) continue
            const dist = Math.sqrt(dd)
            const nx = dx / dist
            const ny = dy / dist
            const push = (min - dist) / 2
            s.x[i] -= nx * push
            s.y[i] -= ny * push
            s.x[j] += nx * push
            s.y[j] += ny * push
            const rel = (s.vx[j] - s.vx[i]) * nx + (s.vy[j] - s.vy[i]) * ny
            if (rel < 0) {
              const imp = rel * 0.78
              s.vx[i] += imp * nx
              s.vy[i] += imp * ny
              s.vx[j] -= imp * nx
              s.vy[j] -= imp * ny
            }
          }
        }
      }
      const drag = 1 - Math.min(0.5, dt * 0.9)
      for (let i = 0; i < N; i++) {
        s.vx[i] *= drag
        s.vy[i] *= drag
        // Rolling: how far it moved, signed by which way.
        s.roll[i] += ((s.vx[i] + s.vy[i] * 0.35) * dt) / r
      }
      return s
    })
  })

  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}rad` }] }))

  return (
    <View style={{ width: size, height: H }}>
      {/* behind everything: the floor shadow, the stand, the back of the glass */}
      <Svg width={size} height={H} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="gbMetal" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#FFFFFF" />
            <Stop offset="0.55" stopColor="#E6FBF7" />
            <Stop offset="1" stopColor="#A9DDD5" />
          </LinearGradient>
          <RadialGradient id="gbGlass" cx="36%" cy="30%" r="80%">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.34} />
            <Stop offset="0.55" stopColor="#FFFFFF" stopOpacity={0.1} />
            <Stop offset="1" stopColor="#003B36" stopOpacity={0.3} />
          </RadialGradient>
        </Defs>
        <Ellipse cx={cx} cy={H - 5} rx={R * 0.95} ry={5} fill="#00302B" opacity={0.28} />
        <Path d={`M${cx - R * 0.74} ${cy + R * 0.66} L${cx - R * 0.52} ${H - 10}`} stroke="url(#gbMetal)" strokeWidth={5.5} strokeLinecap="round" />
        <Path d={`M${cx + R * 0.74} ${cy + R * 0.66} L${cx + R * 0.52} ${H - 10}`} stroke="url(#gbMetal)" strokeWidth={5.5} strokeLinecap="round" />
        <Rect x={cx - R * 0.8} y={H - 14} width={R * 1.6} height={9} rx={4.5} fill="url(#gbMetal)" />
        {/* the chute the ball leaves by, with its dark mouth */}
        <Rect x={cx - R * 0.2} y={cy + R * 0.9} width={R * 0.4} height={R * 0.34} rx={6} fill="url(#gbMetal)" />
        <Ellipse cx={cx} cy={cy + R * 1.24} rx={R * 0.15} ry={R * 0.055} fill="#0A5C55" opacity={0.75} />
        <Circle cx={cx} cy={cy} r={R} fill="url(#gbGlass)" />
      </Svg>
      {/* the far half of the cage, turning */}
      <Animated.View pointerEvents="none" style={[styles.layer, { width: size, height: size }, spin]}>
        <Wires size={size} R={R} front={false} />
      </Animated.View>
      <View pointerEvents="none" style={{ position: 'absolute', left: cx, top: cy }}>
        {Array.from({ length: N }, (_, i) => (
          <GlobeBall key={i} i={i} d={d} sim={sim} />
        ))}
      </View>
      {/* the near half of the cage and the crank, turning */}
      <Animated.View pointerEvents="none" style={[styles.layer, { width: size, height: size }, spin]}>
        <Wires size={size} R={R} front />
      </Animated.View>
      {/* fixed light on the glass: rim, shade low right, highlights */}
      <Svg width={size} height={H} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <RadialGradient id="gbShade" cx="50%" cy="50%" r="50%">
            <Stop offset="0.72" stopColor="#002C28" stopOpacity={0} />
            <Stop offset="1" stopColor="#002C28" stopOpacity={0.3} />
          </RadialGradient>
          <LinearGradient id="gbRim" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#FFFFFF" />
            <Stop offset="1" stopColor="#BDEFE7" />
          </LinearGradient>
          <LinearGradient id="gbHub" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#FFFFFF" />
            <Stop offset="1" stopColor="#A9DDD5" />
          </LinearGradient>
        </Defs>
        <Circle cx={cx} cy={cy} r={R} fill="url(#gbShade)" />
        <Circle cx={cx} cy={cy} r={R} stroke="url(#gbRim)" strokeWidth={3.2} fill="none" />
        <Path
          d={`M${cx - R * 0.74} ${cy - R * 0.3} Q${cx - R * 0.56} ${cy - R * 0.78} ${cx - R * 0.06} ${cy - R * 0.84}`}
          stroke="#FFFFFF"
          strokeOpacity={0.85}
          strokeWidth={4.5}
          strokeLinecap="round"
          fill="none"
        />
        <Circle cx={cx - R * 0.8} cy={cy - R * 0.04} r={2.2} fill="#FFFFFF" opacity={0.8} />
        <Path d={`M${cx + R * 0.5} ${cy + R * 0.7} Q${cx + R * 0.7} ${cy + R * 0.54} ${cx + R * 0.8} ${cy + R * 0.28}`} stroke="#FFFFFF" strokeOpacity={0.3} strokeWidth={2.5} strokeLinecap="round" fill="none" />
        {/* the hub the crank turns on */}
        <Circle cx={cx} cy={cy} r={R * 0.1} fill="url(#gbHub)" />
        <Circle cx={cx - R * 0.025} cy={cy - R * 0.03} r={R * 0.04} fill="#FFFFFF" />
      </Svg>
    </View>
  )
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', left: 0, top: 0 },
  ball: { position: 'absolute' },
  face: { position: 'absolute', backgroundColor: '#FFFDF8' },
})
