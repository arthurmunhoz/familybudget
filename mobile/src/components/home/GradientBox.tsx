import { type ReactNode } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'

import type { Gradient } from './palette'

/** A view with a diagonal gradient behind its children. react-native-svg is
 *  already in the binary, so no new native module (expo-linear-gradient would
 *  need a rebuild). */
export function GradientBox({
  colors,
  radius,
  style,
  children,
}: {
  colors: Gradient
  radius: number
  style?: StyleProp<ViewStyle>
  children?: ReactNode
}) {
  const id = `g${colors[0].slice(1)}${colors[1].slice(1)}`
  return (
    <View style={[{ borderRadius: radius, overflow: 'hidden' }, style]}>
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors[0]} />
            <Stop offset="1" stopColor={colors[1]} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
      {children}
    </View>
  )
}
