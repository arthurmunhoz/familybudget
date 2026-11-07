import { useState, type ReactNode } from 'react'
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'

import type { Gradient } from './palette'

/** A view with a diagonal gradient behind its children. react-native-svg is
 *  already in the binary, so no new native module (expo-linear-gradient would
 *  need a rebuild).
 *
 *  The Svg is sized from onLayout in real pixels, NOT `absoluteFill` + 100%:
 *  in release builds the percentage canvas kept its FIRST size, so a card that
 *  grew after its data arrived (Admin's overview: KPIs first, the week chart a
 *  beat later) had its gradient stop halfway down, with the white bars left on
 *  the page background (2026-11, seen on device, not in the simulator). */
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
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)

  function onLayout(e: LayoutChangeEvent) {
    const { width: w, height: h } = e.nativeEvent.layout
    if (!size || Math.abs(size.w - w) > 0.5 || Math.abs(size.h - h) > 0.5) setSize({ w, h })
  }

  return (
    <View
      onLayout={onLayout}
      // Fallback fill until the first layout so it never flashes blank.
      style={[{ borderRadius: radius, overflow: 'hidden', backgroundColor: colors[1] }, style]}
    >
      {size ? (
        <Svg
          width={size.w}
          height={size.h}
          style={[StyleSheet.absoluteFill, { width: size.w, height: size.h }]}
          pointerEvents="none"
        >
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={colors[0]} />
              <Stop offset="1" stopColor={colors[1]} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width={size.w} height={size.h} fill={`url(#${id})`} />
        </Svg>
      ) : null}
      {children}
    </View>
  )
}
