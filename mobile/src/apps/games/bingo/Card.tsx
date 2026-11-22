// A player's card: B I N G O over a 5×5 grid, the centre free. Nothing is ever
// marked FOR the player — they tap a number once it has come out, and it gets
// a dab of ink in its column's colour. A number that hasn't come out shakes.
import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming, ZoomIn } from 'react-native-reanimated'
import { Star } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import { fonts, useTheme } from '@/theme/theme'
import { LETTERS } from './logic'
import { BALL_COLOR, GOLD } from './look'

function Cell({
  n,
  col,
  size,
  marked,
  win,
  shake,
  onPress,
}: {
  n: number
  col: number
  size: number
  marked: boolean
  win: boolean
  /** Bumped to shake this cell ("that one hasn't come out"). */
  shake: number
  onPress?: () => void
}) {
  const { c } = useTheme()
  const x = useSharedValue(0)
  useEffect(() => {
    if (!shake) return
    x.set(withSequence(...[-5, 5, -4, 4, 0].map((v) => withTiming(v, { duration: 55, easing: Easing.out(Easing.quad) }))))
  }, [shake, x])
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }))
  const free = n === 0
  const color = BALL_COLOR[col]
  const dab = size * 0.82
  return (
    <Animated.View style={style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={free ? '★' : `${LETTERS[col]} ${n}`}
        accessibilityState={{ selected: marked || free }}
        disabled={!onPress || free || marked}
        onPress={onPress}
        style={[
          styles.cell,
          { width: size, height: size, borderRadius: size * 0.24, backgroundColor: c.sheet, borderColor: win ? GOLD[1] : c.border, borderWidth: win ? 2.5 : StyleSheet.hairlineWidth },
        ]}
      >
        {marked || free ? (
          <Animated.View
            entering={free ? undefined : ZoomIn.duration(180)}
            style={{ position: 'absolute', width: dab, height: dab, borderRadius: dab / 2, backgroundColor: color, opacity: free ? 0.9 : 0.34 }}
          />
        ) : null}
        {free ? (
          <Star size={size * 0.42} color="#fff" fill="#fff" />
        ) : (
          <Txt style={{ fontFamily: fonts.display, fontSize: size * 0.42, lineHeight: size * 0.5, color: c.text }}>{n}</Txt>
        )}
      </Pressable>
    </Animated.View>
  )
}

export function Card({
  card,
  marks,
  cell,
  gap,
  win,
  shake,
  onCell,
}: {
  card: number[]
  marks: Set<number>
  /** One cell's side, in points. */
  cell: number
  gap: number
  /** Cells to ring in gold (the line that was called). */
  win?: number[]
  shake?: { n: number; k: number }
  onCell?: (n: number) => void
}) {
  return (
    <View style={{ gap }}>
      <View style={{ flexDirection: 'row', gap }}>
        {LETTERS.map((l, i) => (
          <View key={l} style={{ width: cell, height: cell * 0.5, borderRadius: cell * 0.2, backgroundColor: BALL_COLOR[i], alignItems: 'center', justifyContent: 'center' }}>
            <Txt style={{ color: '#fff', fontFamily: fonts.display, fontSize: cell * 0.3, lineHeight: cell * 0.36 }}>{l}</Txt>
          </View>
        ))}
      </View>
      {[0, 1, 2, 3, 4].map((r) => (
        <View key={r} style={{ flexDirection: 'row', gap }}>
          {[0, 1, 2, 3, 4].map((col) => {
            const i = r * 5 + col
            const n = card[i] ?? 0
            return (
              <Cell
                key={i}
                n={n}
                col={col}
                size={cell}
                marked={marks.has(n)}
                win={!!win?.includes(i)}
                shake={shake && shake.n === n ? shake.k : 0}
                onPress={onCell ? () => onCell(n) : undefined}
              />
            )
          })}
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  cell: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
})
