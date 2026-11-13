// Better deal's illustration: the two options as the SAME product on a shelf,
// one in a small container and one in a big one. As the amounts are typed the
// containers swap and resize to match — whichever option holds more becomes
// the big container, scaled by how much more — and the cheaper-per-unit one
// gets the green "better deal" tag. The product follows the unit: a bottle
// and a jug for L / mL, a jar and a sack for weights, a pack and a crate for
// "each".
//
// 2026-11 restyle (the photo frame's language): the containers wear the
// tool's teal, and the verdict PLAYS on the shelf — the winner rises a little
// on a glow of its colour with a gradient "best deal" ribbon dropping onto
// it, the other one steps back (dims, its label band goes grey). Timed
// curves only; Reduce Motion lands on the end state.
import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated'
import Svg, { Circle, Defs, Ellipse, G, Path, RadialGradient, Rect, Stop, Text as SvgText } from 'react-native-svg'
import { Check } from 'lucide-react-native'

import { GradientBox } from '@/components/home/GradientBox'
import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { fonts, sp, useTheme } from '@/theme/theme'

import { TOOL_LOOK } from './look'

const LOOK = TOOL_LOOK.deal
const EASE = Easing.bezier(0.2, 0, 0, 1)

type ProductKind = 'liquid' | 'weight' | 'count'

function productKind(unit: string): ProductKind {
  if (unit === 'L' || unit === 'mL') return 'liquid'
  if (unit === 'each') return 'count'
  return 'weight'
}

const ART = 110 // drawn size of a full-scale container

/** One container, drawn in a 100×120 box standing on its base. */
function Container({ kind, big, label, band }: { kind: ProductKind; big: boolean; label: string; band: string }) {
  const { dark } = useTheme()
  const body = dark ? '#EEF3F2' : '#FFFFFF'
  const shade = dark ? '#CFDAD8' : '#DCE6E4'
  const ink = '#FFFFFF'
  if (kind === 'liquid') {
    return big ? (
      // jug with a handle
      <Svg width="100%" height="100%" viewBox="0 0 100 120">
        <Path d="M38 8 H58 V20 Q78 26 80 46 V108 Q80 116 72 116 H24 Q16 116 16 108 V46 Q18 26 38 20 Z" fill={body} stroke={shade} strokeWidth={2} />
        <Path d="M80 52 Q96 54 96 72 Q96 90 80 92" fill="none" stroke={shade} strokeWidth={7} strokeLinecap="round" />
        <Rect x={36} y={2} width={24} height={9} rx={3} fill={band} />
        <Rect x={16} y={64} width={64} height={30} fill={band} />
        <Path d="M16 100 H80" stroke={shade} strokeWidth={2} />
        <Txtish label={label} color={ink} />
      </Svg>
    ) : (
      // bottle
      <Svg width="100%" height="100%" viewBox="0 0 100 120">
        <Path d="M42 6 H58 V28 Q72 36 72 54 V108 Q72 116 64 116 H36 Q28 116 28 108 V54 Q28 36 42 28 Z" fill={body} stroke={shade} strokeWidth={2} />
        <Rect x={40} y={0} width={20} height={9} rx={3} fill={band} />
        <Rect x={28} y={66} width={44} height={28} fill={band} />
        <Txtish label={label} color={ink} />
      </Svg>
    )
  }
  if (kind === 'count') {
    return big ? (
      // crate
      <Svg width="100%" height="100%" viewBox="0 0 100 120">
        <Rect x={6} y={30} width={88} height={86} rx={8} fill={body} stroke={shade} strokeWidth={2} />
        <Path d="M6 52 H94 M6 74 H94 M6 96 H94" stroke={shade} strokeWidth={2} />
        {[22, 50, 78].map((x) => (
          <G key={x}>
            <Circle cx={x} cy={22} r={12} fill={band} />
            <Circle cx={x - 4} cy={18} r={3} fill={ink} opacity={0.5} />
          </G>
        ))}
        <Rect x={6} y={56} width={88} height={30} fill={band} />
        <Txtish label={label} color={ink} y={71} />
      </Svg>
    ) : (
      // small pack
      <Svg width="100%" height="100%" viewBox="0 0 100 120">
        <Rect x={22} y={48} width={56} height={68} rx={7} fill={body} stroke={shade} strokeWidth={2} />
        {[36, 64].map((x) => (
          <G key={x}>
            <Circle cx={x} cy={40} r={11} fill={band} />
            <Circle cx={x - 3} cy={36} r={3} fill={ink} opacity={0.5} />
          </G>
        ))}
        <Rect x={22} y={70} width={56} height={26} fill={band} />
        <Txtish label={label} color={ink} y={83} />
      </Svg>
    )
  }
  // weight
  return big ? (
    // sack with a folded, tied top
    <Svg width="100%" height="100%" viewBox="0 0 100 120">
      <Path d="M24 26 Q20 70 12 104 Q10 116 24 116 H76 Q90 116 88 104 Q80 70 76 26 Z" fill={body} stroke={shade} strokeWidth={2} />
      <Path d="M24 26 L34 10 L50 18 L66 10 L76 26 Z" fill={shade} />
      <Rect x={30} y={22} width={40} height={7} rx={3} fill={band} />
      <Path d="M16 66 H84 L86 96 H14 Z" fill={band} />
      <Txtish label={label} color={ink} y={81} />
    </Svg>
  ) : (
    // jar with a lid
    <Svg width="100%" height="100%" viewBox="0 0 100 120">
      <Rect x={28} y={36} width={44} height={80} rx={10} fill={body} stroke={shade} strokeWidth={2} />
      <Rect x={26} y={26} width={48} height={14} rx={4} fill={band} />
      <Rect x={28} y={64} width={44} height={30} fill={band} />
      <Txtish label={label} color={ink} y={79} />
    </Svg>
  )
}

/** The A / B letter on the container's label band. */
function Txtish({ label, color, y = 80 }: { label: string; color: string; y?: number }) {
  return (
    <SvgText x={50} y={y + 6} fill={color} fontSize={18} fontWeight="800" textAnchor="middle">
      {label}
    </SvgText>
  )
}

/** One shelf slot: the container (its size follows the amount), the
 *  winner's glow + ribbon, and the per-unit price under it. */
function Slot({
  side,
  kind,
  big,
  scale,
  state,
  perUnit,
}: {
  side: 'A' | 'B'
  kind: ProductKind
  big: boolean
  scale: number
  /** 'win' / 'lose' once both are known, else 'idle'. */
  state: 'win' | 'lose' | 'idle'
  perUnit: string | null
}) {
  const { c, dark } = useTheme()
  const { t } = useI18n()
  const reduce = useReducedMotion()
  const s = useSharedValue(scale)
  const win = useSharedValue(state === 'win' ? 1 : 0)
  const lose = useSharedValue(state === 'lose' ? 1 : 0)
  useEffect(() => {
    s.set(reduce ? scale : withTiming(scale, { duration: 520, easing: EASE }))
  }, [scale, reduce, s])
  useEffect(() => {
    const to = (v: number, d: number) => (reduce ? v : withTiming(v, { duration: d, easing: EASE }))
    win.set(to(state === 'win' ? 1 : 0, 560))
    lose.set(to(state === 'lose' ? 1 : 0, 420))
  }, [state, reduce, win, lose])

  // Scale from the BOTTOM so containers stay standing on the shelf; the
  // winner also rises 8pt off it.
  const art = useAnimatedStyle(() => ({
    opacity: 1 - lose.get() * 0.5,
    transform: [
      { translateY: (1 - s.get()) * (ART / 2) - win.get() * 8 },
      { scale: s.get() * (1 - lose.get() * 0.04) },
    ],
  }))
  const glow = useAnimatedStyle(() => ({ opacity: win.get(), transform: [{ scaleX: 0.6 + win.get() * 0.4 }] }))
  const ribbon = useAnimatedStyle(() => ({
    opacity: win.get(),
    transform: [{ translateY: (1 - win.get()) * -14 }, { scale: 0.7 + win.get() * 0.3 }],
  }))
  const band = state === 'lose' ? (dark ? '#7D8785' : '#B4BEBC') : LOOK.tint

  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <View style={{ height: 32, justifyContent: 'flex-start', zIndex: 2 }}>
        <Animated.View style={ribbon}>
          <GradientBox colors={LOOK.colors} radius={999} style={styles.tag}>
            <Check size={12} color="#fff" strokeWidth={3} />
            <Txt style={{ color: '#fff', fontSize: 11.5, fontFamily: fonts.semibold }}>{t('calc.betterDeal')}</Txt>
          </GradientBox>
        </Animated.View>
      </View>
      <View style={{ width: ART, height: ART, justifyContent: 'flex-end', alignItems: 'center' }}>
        {/* the winner's spotlight on the shelf */}
        <Animated.View pointerEvents="none" style={[styles.glow, glow]}>
          <Svg width={ART + 20} height={40}>
            <Defs>
              <RadialGradient id={`dealGlow${side}`} cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor={LOOK.colors[0]} stopOpacity={0.55} />
                <Stop offset="1" stopColor={LOOK.colors[0]} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Ellipse cx={(ART + 20) / 2} cy={20} rx={(ART + 20) / 2} ry={18} fill={`url(#dealGlow${side})`} />
          </Svg>
        </Animated.View>
        <Animated.View style={[{ width: ART, height: ART }, art]}>
          <Container kind={kind} big={big} label={side} band={band} />
        </Animated.View>
      </View>
      <Txt
        style={{
          marginTop: 8,
          fontSize: 13,
          fontFamily: fonts.semibold,
          color: state === 'win' ? LOOK.tint : perUnit ? c.textMuted : c.textFaint,
          fontVariant: ['tabular-nums'],
        }}
        numberOfLines={1}
      >
        {perUnit ?? '—'}
      </Txt>
    </View>
  )
}

/** The shelf: A and B side by side, sized from the amounts. */
export function ProductShelf({
  unit,
  qtyA,
  qtyB,
  winner,
  perUnitA,
  perUnitB,
}: {
  unit: string
  qtyA: number
  qtyB: number
  winner: 'A' | 'B' | 'tie' | null
  perUnitA: string | null
  perUnitB: string | null
}) {
  const { c } = useTheme()
  const kind = productKind(unit)
  // Who's the big container: the larger amount. Until both are typed, A small
  // and B big — the picture explains the tool before any input.
  const known = qtyA > 0 && qtyB > 0
  const stateOf = (side: 'A' | 'B') =>
    winner === 'A' || winner === 'B' ? (winner === side ? 'win' : 'lose') : 'idle'
  const aBig = known ? qtyA >= qtyB : false
  const bBig = known ? qtyB >= qtyA : true
  // Size by how much more: area ∝ amount, so scale ∝ √ratio, kept readable.
  const max = Math.max(qtyA, qtyB)
  const scaleOf = (q: number, fallback: number) =>
    known ? Math.max(0.55, Math.min(1, Math.sqrt(q / max))) : fallback
  return (
    <View style={[styles.stage, { backgroundColor: c.card, borderColor: c.border }]}>
      {/* the shelf, behind the containers' bases */}
      <View style={[styles.shelf, { backgroundColor: c.border }]} pointerEvents="none" />
      <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
        <Slot side="A" kind={kind} big={aBig} scale={scaleOf(qtyA, 0.72)} state={stateOf('A')} perUnit={perUnitA} />
        <Slot side="B" kind={kind} big={bBig} scale={scaleOf(qtyB, 1)} state={stateOf('B')} perUnit={perUnitB} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  stage: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: sp.sm,
    paddingBottom: sp.md,
    paddingHorizontal: sp.md,
    overflow: 'hidden',
  },
  shelf: {
    // From the TOP: stage padding + the tag row + the container box, so the
    // line stays under the bases whatever sits below (per-unit, verdict).
    position: 'absolute',
    left: sp.lg,
    right: sp.lg,
    top: sp.sm + 32 + ART - 3,
    height: 3,
    borderRadius: 2,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  glow: { position: 'absolute', bottom: -18, left: -10 },
})
