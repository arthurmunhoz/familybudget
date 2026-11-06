// The docked primary button of the app's sheets, in the feature's own colour (a pet's, an event type's,
// the Calendar's…), its bottom corners following the screen's curve.
import type { ReactNode } from 'react'
import { StyleSheet } from 'react-native'

import { GradientBox } from '@/components/home/GradientBox'
import { shade } from '@/components/home/palette'
import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import { useScreenCorner } from '@/hooks/useScreenCorner'
import { fonts, radius } from '@/theme/theme'

/** The docked primary button in the pet's colour, its bottom corners
 *  following the screen's curve (the NewItemButton geometry). */
export function TintButton({
  tint,
  title,
  icon,
  onPress,
  disabled,
}: {
  tint: string
  title: string
  icon?: ReactNode
  onPress: () => void
  disabled?: boolean
}) {
  const corner = useScreenCorner()
  const bottomR = corner?.radius ?? radius.md
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => ({ opacity: disabled ? 0.45 : pressed ? 0.85 : 1 })}
    >
      <GradientBox
        colors={[tint, shade(tint, -0.22)]}
        radius={radius.md}
        style={[s.btn, { borderBottomLeftRadius: bottomR, borderBottomRightRadius: bottomR }]}
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
