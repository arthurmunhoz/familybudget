// Better deal's illustration: the two options as the SAME product on a shelf,
// one in a small container and one in a big one. As the amounts are typed the
// containers swap and resize to match — whichever option holds more becomes
// the big container, scaled by how much more — and the cheaper-per-unit one
// gets the green "better deal" tag. The product follows the unit: a bottle
// and a jug for L / mL, a jar and a sack for weights, a pack and a crate for
// "each".
import { useEffect, useRef } from 'react'
import { Animated, StyleSheet, View } from 'react-native'
import Svg, { Circle, G, Path, Rect, Text as SvgText } from 'react-native-svg'
import { Check } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { fonts, radius, sp, useTheme } from '@/theme/theme'

type ProductKind = 'liquid' | 'weight' | 'count'

function productKind(unit: string): ProductKind {
  if (unit === 'L' || unit === 'mL') return 'liquid'
  if (unit === 'each') return 'count'
  return 'weight'
}

const ART = 110 // drawn size of a full-scale container

/** One container, drawn in a 100×120 box standing on its base. */
function Container({ kind, big, label }: { kind: ProductKind; big: boolean; label: string }) {
  const { c, dark } = useTheme()
  const body = dark ? '#F3E3D3' : '#FFF8F0'
  const shade = dark ? '#E2CDB8' : '#F1E2D2'
  const band = c.accent
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

/** One shelf slot: the container (animated size), its winner tag, and the
 *  per-unit price under it. */
function Slot({
  side,
  kind,
  big,
  scale,
  winner,
  perUnit,
}: {
  side: 'A' | 'B'
  kind: ProductKind
  big: boolean
  scale: number
  winner: boolean
  perUnit: string | null
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const s = useRef(new Animated.Value(scale)).current
  const lift = useRef(new Animated.Value(winner ? 1 : 0)).current
  useEffect(() => {
    Animated.spring(s, { toValue: scale, useNativeDriver: true, friction: 6, tension: 80 }).start()
  }, [scale, s])
  useEffect(() => {
    Animated.spring(lift, { toValue: winner ? 1 : 0, useNativeDriver: true, friction: 5 }).start()
  }, [winner, lift])
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <View style={{ height: 22, justifyContent: 'center' }}>
        <Animated.View
          style={[
            styles.tag,
            {
              backgroundColor: c.income,
              opacity: lift,
              transform: [{ scale: lift.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
            },
          ]}
        >
          <Check size={11} color="#fff" strokeWidth={3} />
          <Txt style={{ color: '#fff', fontSize: 11, fontFamily: fonts.semibold }}>{t('calc.betterDeal')}</Txt>
        </Animated.View>
      </View>
      <View style={{ width: ART, height: ART, justifyContent: 'flex-end', alignItems: 'center' }}>
        <Animated.View
          style={{
            width: ART,
            height: ART,
            // Scale from the BOTTOM so containers stay standing on the shelf.
            transform: [{ translateY: Animated.multiply(Animated.subtract(1, s), ART / 2) }, { scale: s }],
          }}
        >
          <Container kind={kind} big={big} label={side} />
        </Animated.View>
      </View>
      <Txt
        style={{
          marginTop: 6,
          fontSize: 13,
          fontFamily: fonts.semibold,
          color: winner ? c.income : perUnit ? c.textMuted : c.textFaint,
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
  verdict,
}: {
  unit: string
  qtyA: number
  qtyB: number
  winner: 'A' | 'B' | 'tie' | null
  perUnitA: string | null
  perUnitB: string | null
  /** "Option A is 20% cheaper" — the shelf's footer once both are filled. */
  verdict: string | null
}) {
  const { c } = useTheme()
  const kind = productKind(unit)
  // Who's the big container: the larger amount. Until both are typed, A small
  // and B big — the picture explains the tool before any input.
  const known = qtyA > 0 && qtyB > 0
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
        <Slot side="A" kind={kind} big={aBig} scale={scaleOf(qtyA, 0.72)} winner={winner === 'A'} perUnit={perUnitA} />
        <Slot side="B" kind={kind} big={bBig} scale={scaleOf(qtyB, 1)} winner={winner === 'B'} perUnit={perUnitB} />
      </View>
      {verdict ? (
        <Txt
          style={{
            marginTop: sp.sm,
            textAlign: 'center',
            fontFamily: fonts.semibold,
            fontSize: 14,
            color: winner === 'tie' ? c.textMuted : c.income,
          }}
        >
          {verdict}
        </Txt>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  stage: {
    borderRadius: radius.lg,
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
    top: sp.sm + 22 + ART - 3,
    height: 3,
    borderRadius: 2,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
})
