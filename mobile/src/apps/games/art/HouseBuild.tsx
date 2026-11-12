// The hangman's drawing, One Roof style: the house of the team that picked the
// word. Every wrong guess is one piece, and what you SEE depends on your side
// (owner, 2026-11):
//   build   — the team that picked the word watches its house go UP, a piece
//             per wrong guess, dust puffing as each one lands. Finished house =
//             their point (smoke from the chimney).
//   destroy — the team guessing sees the house standing and watches it FALL
//             APART, a piece tumbling off per wrong guess. Nothing left =
//             they lost the round.
// Same count either way (`wrong`), so both phones always agree on the score.
//
// The ground is always there, so the very first wrong guess already moves a
// real piece (a wall), not a hard-to-see strip of grass. The scene is a clean
// card outlined in the house owner's team colour, with that colour on the roof.
//
// Each piece is its own <Svg> on the same viewBox, stacked in absolutely
// positioned Animated.Views — Reanimated animates plain views, which stays
// smooth on both platforms. Motion is deliberately calm: short eased timings,
// no wobbly springs (owner asked to tone the bounce down).
import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg'

import type { Gradient } from '@/components/home/palette'
import { useTheme } from '@/theme/theme'

const VB = '0 0 300 260'
const WALL = '#FFF8F1'
const WALL_2 = '#F4E6D8'
const LINE = '#E2D2C2'

type ArtProps = { tint: Gradient }

function Ground() {
  return (
    <Svg viewBox={VB} style={StyleSheet.absoluteFill}>
      <Path d="M-10 246 Q150 218 310 246 L310 270 L-10 270 Z" fill="#EAF3E6" />
      <Path d="M-10 254 Q150 234 310 254 L310 270 L-10 270 Z" fill="#DCEBD5" />
      <Ellipse cx={150} cy={233} rx={92} ry={6} fill="rgba(60,40,20,0.10)" />
      {/* the plot, marked out — where the house stands (or stood) */}
      <Path d="M76 232 H224" stroke={LINE} strokeWidth={3} strokeDasharray="6 6" strokeLinecap="round" />
    </Svg>
  )
}

function WallLeft() {
  return (
    <Svg viewBox={VB} style={StyleSheet.absoluteFill}>
      <Path d="M76 124 H151 V231 H90 Q76 231 76 217 Z" fill={WALL} stroke={LINE} strokeWidth={2} />
    </Svg>
  )
}

function WallRight() {
  return (
    <Svg viewBox={VB} style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id="hbWall" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={WALL} />
          <Stop offset="1" stopColor={WALL_2} />
        </LinearGradient>
      </Defs>
      <Path d="M149 124 H224 V217 Q224 231 210 231 H149 Z" fill="url(#hbWall)" stroke={LINE} strokeWidth={2} />
    </Svg>
  )
}

function Door() {
  return (
    <Svg viewBox={VB} style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id="hbDoor" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFD38A" />
          <Stop offset="1" stopColor="#FFA040" />
        </LinearGradient>
      </Defs>
      <Rect x={134} y={170} width={32} height={61} rx={16} fill="url(#hbDoor)" />
      <Circle cx={158} cy={203} r={2.2} fill="rgba(120,60,10,0.45)" />
    </Svg>
  )
}

function Window() {
  return (
    <Svg viewBox={VB} style={StyleSheet.absoluteFill}>
      <Rect x={183} y={145} width={26} height={24} rx={6} fill="#FFD48A" stroke="#F2B451" strokeWidth={1.5} />
      <Path d="M196 145 V169 M183 157 H209" stroke="#fff" strokeWidth={2} />
      <Rect x={92} y={145} width={26} height={24} rx={6} fill="#FFD48A" stroke="#F2B451" strokeWidth={1.5} />
      <Path d="M105 145 V169 M92 157 H118" stroke="#fff" strokeWidth={2} />
    </Svg>
  )
}

function RoofLeft({ tint }: ArtProps) {
  return (
    <Svg viewBox={VB} style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id="hbRoofL" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={tint[0]} />
          <Stop offset="1" stopColor={tint[1]} />
        </LinearGradient>
      </Defs>
      <Path d="M150 34 L150 130 L60 130 Q49 130 57 121 Z" fill="url(#hbRoofL)" />
    </Svg>
  )
}

function RoofRight({ tint }: ArtProps) {
  return (
    <Svg viewBox={VB} style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id="hbRoofR" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={tint[0]} />
          <Stop offset="1" stopColor={tint[1]} />
        </LinearGradient>
      </Defs>
      <Path d="M150 34 L243 121 Q251 130 240 130 L150 130 Z" fill="url(#hbRoofR)" />
      {/* the icon's glint along the roof edge */}
      <Path d="M157 50 L226 114" stroke="rgba(255,255,255,0.75)" strokeWidth={5} strokeLinecap="round" />
    </Svg>
  )
}

function Chimney({ tint }: ArtProps) {
  return (
    <Svg viewBox={VB} style={StyleSheet.absoluteFill}>
      <Path d="M190 64 H210 V104 L190 86 Z" fill={WALL_2} stroke={LINE} strokeWidth={2} />
      <Rect x={186} y={57} width={28} height={10} rx={4} fill={tint[1]} />
    </Svg>
  )
}

/** Build order (and, reversed, the order they fall off). Seven = max_wrong. */
const PIECES: ((p: ArtProps) => React.ReactElement)[] = [WallLeft, WallRight, Door, Window, RoofLeft, RoofRight, Chimney]
/** Which way each piece tumbles when the house falls apart (−1 left, 1 right). */
const FALL_DIR = [-1, 1, 1, -1, -1, 1, 1]

function Piece({ index, on, mode, tint }: { index: number; on: boolean; mode: 'build' | 'destroy'; tint: Gradient }) {
  // p: 1 = in place, 0 = gone. Gone means "not placed yet" when building
  // (fades in from a little above) and "fallen off" when destroying (drops,
  // tilts and fades).
  const p = useSharedValue(on ? 1 : 0)
  useEffect(() => {
    p.set(withTiming(on ? 1 : 0, { duration: on ? 420 : 560, easing: on ? Easing.out(Easing.cubic) : Easing.in(Easing.quad) }))
  }, [on, p])
  const dir = FALL_DIR[index]
  const style = useAnimatedStyle(() => {
    const gone = 1 - p.value
    if (mode === 'destroy') {
      return {
        opacity: p.value,
        transform: [{ translateY: gone * 90 }, { translateX: gone * dir * 24 }, { rotate: `${gone * dir * 18}deg` }],
      }
    }
    return { opacity: p.value, transform: [{ translateY: gone * -28 }] }
  })
  const Art = PIECES[index]
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <Art tint={tint} />
    </Animated.View>
  )
}

/** A puff of dust at the foot of the house — a piece landed or fell. Mounted
 *  fresh (keyed) for each wrong guess, so it plays once. */
function DustBurst() {
  const t = useSharedValue(0)
  useEffect(() => {
    t.set(withTiming(1, { duration: 700, easing: Easing.out(Easing.quad) }))
  }, [t])
  return (
    <View pointerEvents="none" style={styles.dustRow}>
      {[-1, -0.4, 0.4, 1].map((d) => (
        <DustPuff key={d} t={t} d={d} />
      ))}
    </View>
  )
}

function DustPuff({ t, d }: { t: ReturnType<typeof useSharedValue<number>>; d: number }) {
  const style = useAnimatedStyle(() => ({
    opacity: (1 - t.value) * 0.7,
    transform: [{ translateX: d * 40 * t.value }, { translateY: -10 * t.value }, { scale: 0.5 + t.value }],
  }))
  return <Animated.View style={[styles.dust, style]} />
}

/** Smoke puffs drifting up from the chimney once the house is complete. */
function Smoke({ on }: { on: boolean }) {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <Puff key={i} delay={i * 650} on={on} />
      ))}
    </>
  )
}

function Puff({ delay, on }: { delay: number; on: boolean }) {
  const t = useSharedValue(0)
  useEffect(() => {
    t.set(
      on
        ? withDelay(delay, withRepeat(withTiming(1, { duration: 1950, easing: Easing.out(Easing.quad) }), -1, false))
        : withTiming(0, { duration: 200 }),
    )
  }, [on, delay, t])
  const style = useAnimatedStyle(() => ({
    opacity: on ? (t.value < 0.15 ? t.value / 0.15 : 1 - t.value) * 0.8 : 0,
    transform: [{ translateY: -t.value * 46 }, { translateX: t.value * 14 }, { scale: 0.6 + t.value * 0.9 }],
  }))
  return (
    <Animated.View pointerEvents="none" style={[styles.puffBox, style]}>
      <Svg viewBox="0 0 30 30" style={{ width: '100%', height: '100%' }}>
        <Circle cx={15} cy={15} r={11} fill="#D9CFC5" />
      </Svg>
    </Animated.View>
  )
}

/** Soft clouds in the team's colour drifting across, always on — the scene
 *  feels alive even between turns. */
function Clouds({ color }: { color: string }) {
  const t = useSharedValue(0)
  useEffect(() => {
    t.set(
      withRepeat(
        withSequence(
          withTiming(1, { duration: 9000, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration: 9000, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
      ),
    )
  }, [t])
  const a = useAnimatedStyle(() => ({ transform: [{ translateX: -12 + t.value * 24 }] }))
  const b = useAnimatedStyle(() => ({ transform: [{ translateX: 10 - t.value * 20 }] }))
  return (
    <>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, a]}>
        <Svg viewBox={VB} style={StyleSheet.absoluteFill}>
          <G opacity={0.16} fill={color}>
            <Ellipse cx={46} cy={50} rx={26} ry={10} />
            <Ellipse cx={62} cy={43} rx={16} ry={11} />
          </G>
        </Svg>
      </Animated.View>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, b]}>
        <Svg viewBox={VB} style={StyleSheet.absoluteFill}>
          <G opacity={0.12} fill={color}>
            <Ellipse cx={252} cy={70} rx={30} ry={10} />
            <Ellipse cx={236} cy={63} rx={15} ry={10} />
          </G>
        </Svg>
      </Animated.View>
    </>
  )
}


/**
 * @param wrong  wrong guesses so far (0…7)
 * @param mode   'build' for the team that picked the word, 'destroy' for the
 *               team guessing it
 * @param tint   gradient of the team whose house it is (outline, roof)
 */
export function HouseBuild({
  wrong,
  mode,
  tint,
  height = 240,
  children,
}: {
  wrong: number
  mode: 'build' | 'destroy'
  tint: Gradient
  height?: number
  children?: React.ReactNode
}) {
  const { c } = useTheme()
  const n = PIECES.length
  const standing = mode === 'build' ? Math.min(wrong, n) : Math.max(n - wrong, 0)
  const complete = mode === 'build' && wrong >= n

  // A small nudge of the whole scene when a piece lands or falls.
  const s = useSharedValue(0)
  useEffect(() => {
    if (!wrong) return
    s.set(withSequence(withTiming(mode === 'destroy' ? 4 : -3, { duration: 90 }), withTiming(0, { duration: 160 })))
  }, [wrong, mode, s])
  const nudge = useAnimatedStyle(() => ({ transform: [{ translateY: s.value }] }))

  return (
    <View style={[styles.card, { height, backgroundColor: c.card, borderColor: tint[1] }]}>
      <Clouds color={tint[1]} />
      <Animated.View style={[styles.stage, nudge]}>
        <View style={styles.square}>
          <Ground />
          {PIECES.map((_, i) => (
            <Piece key={i} index={i} on={i < standing} mode={mode} tint={tint} />
          ))}
          <View style={styles.smokeAnchor} pointerEvents="none">
            <Smoke on={complete} />
          </View>
          {wrong ? <DustBurst key={wrong} /> : null}
        </View>
      </Animated.View>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderRadius: 28, borderWidth: 2.5, overflow: 'hidden' },
  stage: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'flex-end' },
  // Keeps the 300×260 artwork's proportions at any card width.
  square: { height: '100%', aspectRatio: 300 / 260 },
  smokeAnchor: { position: 'absolute', left: '64%', top: '12%', width: '12%', aspectRatio: 1 },
  puffBox: { position: 'absolute', width: '100%', height: '100%' },
  dustRow: { position: 'absolute', left: 0, right: 0, bottom: '9%', height: 20, alignItems: 'center', justifyContent: 'center' },
  dust: { position: 'absolute', width: 22, height: 22, borderRadius: 11, backgroundColor: '#D9CFC5' },
})
