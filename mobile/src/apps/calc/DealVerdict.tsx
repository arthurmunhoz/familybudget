// Better deal's answer card (2026-11): once both offers are filled in, a
// gradient card in the tool's teal says who wins and SHOWS why — one bar per
// offer, its length the price per unit (shorter = cheaper), the winner's bar
// solid with a check. Motion, all timed curves (no springs):
//   • the card rises in;
//   • the bars grow to their lengths (and glide when a number changes);
//   • the winner's name lands like a stamp, its check pops, and a sheen
//     sweeps across the card — replayed each time the winner CHANGES.
// Reduce Motion: no rise, stamp or sheen; the bars and text just appear.
import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { Check, Scale } from 'lucide-react-native'

import { GradientBox } from '@/components/home/GradientBox'
import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { fonts, sp, useTheme } from '@/theme/theme'

import { TOOL_LOOK } from './look'

const LOOK = TOOL_LOOK.deal
const EASE = Easing.bezier(0.2, 0, 0, 1)

export type Side = 'A' | 'B'

/** What's still missing: a quiet dashed card in the tool's tint. */
export function DealPending() {
  const { c } = useTheme()
  const { t } = useI18n()
  return (
    <View style={[styles.pending, { borderColor: LOOK.tint + '66', backgroundColor: LOOK.tint + '0D' }]}>
      <Scale size={20} color={LOOK.tint} />
      <Txt style={{ flex: 1, fontSize: 14, lineHeight: 19, color: c.textMuted }}>{t('calc.deal.fillBoth')}</Txt>
    </View>
  )
}

export function DealVerdict({
  winner,
  perUnit,
  label,
  pct,
  saving,
  unitLabel,
}: {
  winner: Side | 'tie'
  /** Price per unit of each offer (both finite). */
  perUnit: { A: number; B: number }
  /** Formatted per-unit price, e.g. "$1.25 / kg". */
  label: { A: string; B: string }
  pct: number
  /** Formatted difference per unit ("$0.25"). */
  saving: string
  unitLabel: string
}) {
  const { t } = useI18n()
  const reduce = useReducedMotion()
  const [w, setW] = useState(0)
  const max = Math.max(perUnit.A, perUnit.B) || 1
  const tie = winner === 'tie'

  // Sheen: a soft white band crossing the card, once per new winner.
  const sheen = useSharedValue(-1)
  useEffect(() => {
    if (reduce || tie) return
    sheen.set(-1)
    sheen.set(withDelay(260, withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) })))
  }, [winner, reduce, tie, sheen])
  const sheenStyle = useAnimatedStyle(() => ({ transform: [{ translateX: sheen.get() * (w + 140) - 70 }, { rotate: '18deg' }] }))

  return (
    <Animated.View entering={reduce ? undefined : FadeInDown.duration(420).easing(EASE)}>
      <GradientBox colors={LOOK.colors} radius={24} style={styles.card}>
        <View style={StyleSheet.absoluteFill} onLayout={(e) => setW(e.nativeEvent.layout.width)} pointerEvents="none">
          {w && !tie ? (
            <Animated.View style={[styles.sheen, sheenStyle]}>
              <Svg width={70} height={360}>
                <Defs>
                  <LinearGradient id="dealSheen" x1="0" y1="0" x2="1" y2="0">
                    <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0} />
                    <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity={0.32} />
                    <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
                  </LinearGradient>
                </Defs>
                <Rect x={0} y={0} width={70} height={360} fill="url(#dealSheen)" />
              </Svg>
            </Animated.View>
          ) : null}
        </View>

        <Txt style={styles.kicker}>{tie ? t('calc.deal.tieKicker') : t('calc.deal.winnerKicker')}</Txt>
        {/* keyed by the winner: a new winner re-lands */}
        <Animated.View
          key={winner}
          entering={reduce ? undefined : landIn}
          style={styles.headRow}
        >
          <Stamp key={winner} on={!tie} reduce={reduce} />
          <Txt style={styles.headline} numberOfLines={2}>
            {tie ? t('calc.tie') : t('calc.offer', { side: winner })}
          </Txt>
        </Animated.View>
        {!tie ? (
          <Txt style={styles.sub}>
            {t('calc.deal.cheaperPer', { pct, unit: unitLabel })} · {t('calc.deal.savePer', { amount: saving, unit: unitLabel })}
          </Txt>
        ) : null}

        <View style={{ gap: 10, marginTop: sp.md }}>
          {(['A', 'B'] as const).map((s, i) => (
            <Bar key={s} side={s} ratio={perUnit[s] / max} text={label[s]} win={winner === s} delay={i * 90} reduce={reduce} />
          ))}
        </View>
      </GradientBox>
    </Animated.View>
  )
}

/** The headline lands like a stamp: from a touch larger, settling in. */
function landIn() {
  'worklet'
  return {
    initialValues: { opacity: 0, transform: [{ scale: 1.3 }] },
    animations: {
      opacity: withTiming(1, { duration: 200 }),
      transform: [{ scale: withTiming(1, { duration: 340, easing: EASE }) }],
    },
  }
}

/** The winner's round check: pops in a beat after the card. */
function Stamp({ on, reduce }: { on: boolean; reduce: boolean }) {
  const pop = useSharedValue(reduce ? 1 : 0)
  useEffect(() => {
    if (reduce) return
    pop.set(withDelay(200, withSequence(withTiming(1.18, { duration: 220, easing: EASE }), withTiming(1, { duration: 180, easing: EASE }))))
  }, [pop, reduce])
  const style = useAnimatedStyle(() => ({ opacity: Math.min(1, pop.get()), transform: [{ scale: pop.get() }] }))
  if (!on) return null
  return (
    <Animated.View style={[styles.stamp, style]}>
      <Check size={20} color={LOOK.colors[1]} strokeWidth={3.2} />
    </Animated.View>
  )
}

/** One offer's bar: letter, the bar (length = price per unit), the price. */
function Bar({ side, ratio, text, win, delay, reduce }: { side: Side; ratio: number; text: string; win: boolean; delay: number; reduce: boolean }) {
  const len = useSharedValue(reduce ? ratio : 0)
  useEffect(() => {
    len.set(reduce ? ratio : withDelay(delay, withTiming(ratio, { duration: 640, easing: EASE })))
    // only `ratio` should restart it; the delay is for the first grow
  }, [ratio, reduce, delay, len])
  const fill = useAnimatedStyle(() => ({ width: `${Math.max(6, len.get() * 100)}%` }))
  return (
    <View style={styles.barRow}>
      <View style={[styles.letter, { backgroundColor: win ? '#fff' : 'rgba(255,255,255,0.22)' }]}>
        <Txt style={{ fontFamily: fonts.semibold, fontSize: 12, color: win ? LOOK.colors[1] : '#fff' }}>{side}</Txt>
      </View>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, { backgroundColor: win ? '#fff' : 'rgba(255,255,255,0.45)' }, fill]} />
      </View>
      <Txt style={[styles.barText, { opacity: win ? 1 : 0.8, fontFamily: win ? fonts.semibold : fonts.medium }]} numberOfLines={1}>
        {text}
      </Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { padding: sp.lg, overflow: 'hidden' },
  sheen: { position: 'absolute', top: -80, left: 0 },
  kicker: { color: '#fff', opacity: 0.85, fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase' },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  headline: { flexShrink: 1, color: '#fff', fontFamily: fonts.display, fontSize: 34, lineHeight: 40, letterSpacing: -0.8 },
  stamp: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  sub: { color: '#fff', opacity: 0.92, fontSize: 14, lineHeight: 19, marginTop: 2 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  letter: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  track: { flex: 1, height: 12, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.18)', overflow: 'hidden' },
  fill: { height: 12, borderRadius: 6 },
  barText: { color: '#fff', fontSize: 13, minWidth: 92, textAlign: 'right', fontVariant: ['tabular-nums'] },
  pending: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.md,
    padding: sp.md,
    borderRadius: 20,
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
})
