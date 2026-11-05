// Shared pieces for the Whereabouts sheets (2026-11 restyle, the Home's
// language): a header with a big display title and its state faded under it,
// a round close button, and the docked primary action as a gradient in the
// feature's own colour whose bottom corners follow the screen.
import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { X } from 'lucide-react-native'

import { GradientBox } from '@/components/home/GradientBox'
import { shade } from '@/components/home/palette'
import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { useScreenCorner } from '@/hooks/useScreenCorner'
import { fonts, radius, sp, useTheme } from '@/theme/theme'

/** Title + faded state line + round ✕, with an optional tinted icon tile. */
export function SheetHead({
  title,
  sub,
  icon,
  tint,
  onClose,
}: {
  title: string
  sub?: string | null
  /** A glyph shown on a tile in `tint` (the feature's colour). */
  icon?: ReactNode
  tint?: string
  onClose: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  return (
    <View style={s.head}>
      {icon && tint ? (
        <GradientBox colors={[tint, shade(tint, -0.22)]} radius={16} style={s.tile}>
          {icon}
        </GradientBox>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={{ fontFamily: fonts.display, fontSize: 28, lineHeight: 33, color: c.text }} numberOfLines={1}>
          {title}
        </Txt>
        {sub ? (
          <Txt style={{ fontFamily: fonts.display, fontSize: 16.5, lineHeight: 21, color: c.textFaint }} numberOfLines={2}>
            {sub}
          </Txt>
        ) : null}
      </View>
      <Pressable
        onPress={onClose}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
        style={[s.close, { backgroundColor: c.surface }]}
      >
        <X size={16} color={c.textMuted} />
      </Pressable>
    </View>
  )
}

/** The docked primary action: a gradient in the feature's colour, its bottom
 *  corners following the display's (the NewItemButton geometry). */
export function FeatureButton({
  tint,
  title,
  icon,
  onPress,
  disabled,
  busy,
}: {
  tint: string
  title: string
  icon?: ReactNode
  onPress: () => void
  disabled?: boolean
  busy?: boolean
}) {
  const corner = useScreenCorner()
  const bottomR = corner?.radius ?? radius.md
  const off = disabled || busy
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      style={({ pressed }) => ({ opacity: disabled ? 0.45 : pressed || busy ? 0.8 : 1 })}
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

/** Uppercase tracked label above a group, like the Home's section heads. */
export function GroupLabel({ children }: { children: string }) {
  const { c } = useTheme()
  return <Txt style={[s.label, { color: c.textMuted }]}>{children}</Txt>
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: sp.md },
  tile: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  close: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  btn: { height: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  label: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase', marginBottom: sp.sm },
})
