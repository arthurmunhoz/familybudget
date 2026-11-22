// One bingo ball: a shaded sphere in its column's colour with the white face
// (letter over number) and a highlight on top. `blank` = the face is still
// turned away.
import { StyleSheet, View } from 'react-native'

import { Txt } from '@/components/ui'
import { fonts } from '@/theme/theme'
import { columnOf, letterOf } from './logic'
import { BALL_COLOR } from './look'
import { Shine, Sphere } from './Sphere'

export function Ball({ n, size, blank = false }: { n: number; size: number; blank?: boolean }) {
  const col = columnOf(n)
  const face = size * 0.64
  const big = size >= 44
  return (
    <View style={[styles.ball, { width: size, height: size, borderRadius: size / 2, shadowRadius: size * 0.09, shadowOffset: { width: 0, height: size * 0.07 } }]}>
      <View style={StyleSheet.absoluteFill}>
        <Sphere col={col} size={size} />
      </View>
      {blank ? null : (
        <View style={[styles.face, { width: face, height: face, borderRadius: face / 2 }]}>
          {big ? <Txt style={{ color: BALL_COLOR[col], fontFamily: fonts.semibold, fontSize: size * 0.15, lineHeight: size * 0.17, letterSpacing: 0.5 }}>{letterOf(n)}</Txt> : null}
          <Txt style={{ color: '#1E1E22', fontFamily: fonts.display, fontSize: size * (big ? 0.31 : 0.37), lineHeight: size * (big ? 0.33 : 0.43) }}>{n}</Txt>
        </View>
      )}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Shine size={size} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  ball: { alignItems: 'center', justifyContent: 'center', shadowColor: '#00201C', shadowOpacity: 0.35 },
  // The face sits a touch off-centre, lit like the rest of the ball.
  face: { backgroundColor: '#FFFDF8', alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.12)' },
})
