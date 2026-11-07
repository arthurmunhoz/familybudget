// The docked primary button of the app's sheets, in the feature's own colour (a pet's, an event type's,
// the Calendar's…), its bottom corners following the screen's curve.
import type { ReactNode } from 'react'
import { StyleSheet } from 'react-native'

import { GradientBox } from '@/components/home/GradientBox'
import { shade, type Gradient } from '@/components/home/palette'
import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import { useScreenCorner } from '@/hooks/useScreenCorner'
import { useKeyboardHeight } from '@/hooks/useKeyboardHeight'
import { fonts, radius } from '@/theme/theme'

/** The docked primary button in the pet's colour, its bottom corners
 *  following the screen's curve (the NewItemButton geometry). */
export function TintButton({
  tint,
  title,
  icon,
  onPress,
  disabled,
  inline,
  colors,
}: {
  tint: string
  /** A full gradient instead of tint→darker (a budget's own look). */
  colors?: Gradient
  title: string
  icon?: ReactNode
  onPress: () => void
  disabled?: boolean
  /** Inside a card rather than docked at the screen's foot: a plain pill,
   *  no screen-curve corners (they read as a glitch away from the edge). */
  inline?: boolean
}) {
  const corner = useScreenCorner()
  // With the keyboard up a docked button floats above it, nowhere near the
  // screen's curved corners — so it becomes a plain pill, like `inline`.
  const kb = useKeyboardHeight()
  const floating = inline || kb > 0
  const pill = 27
  const topR = floating ? pill : radius.md
  const bottomR = floating ? pill : (corner?.radius ?? radius.md)
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => ({ opacity: disabled ? 0.45 : pressed ? 0.85 : 1 })}
    >
      <GradientBox
        colors={colors ?? [tint, shade(tint, -0.22)]}
        radius={topR}
        style={[s.btn, { borderRadius: topR, borderBottomLeftRadius: bottomR, borderBottomRightRadius: bottomR }]}
      >
        {icon}
        <Txt style={{ fontFamily: fonts.semibold, fontSize: 16, color: '#fff' }}>{title}</Txt>
      </GradientBox>
    </Pressable>
  )
}

const s = StyleSheet.create({
  btn: { height: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
})
