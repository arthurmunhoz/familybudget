// Small shared pieces for the Calendar module: a selectable pill chip, an
// owner chip (color dot + label), and a time field that opens the native time
// picker in a PickerSheet (its own pop-up, never inline in the form). Date
// entry reuses the pets module's DateField so the look stays consistent.
import { useState, type ReactNode } from 'react'
import { Pressable, View } from 'react-native'

import { PickerSheet } from '@/components/PickerSheet'
import { Txt } from '@/components/ui'
import { formatTime } from '@/lib/calendar'
import { radius, sp, useTheme } from '@/theme/theme'

/** A selectable rounded chip — accent when active, surface otherwise. */
export function Pill({
  active,
  onPress,
  children,
}: {
  active: boolean
  onPress: () => void
  children: ReactNode
}) {
  const { c } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: radius.pill,
        backgroundColor: active ? c.accent : c.surface,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {children}
    </Pressable>
  )
}

/** Owner picker chip: a color dot + member name (or "Everyone"). */
export function OwnerChip({
  label,
  color,
  active,
  onPress,
}: {
  label: string
  color: string
  active: boolean
  onPress: () => void
}) {
  const { c } = useTheme()
  return (
    <Pill active={active} onPress={onPress}>
      <View style={{ height: 10, width: 10, borderRadius: 5, backgroundColor: color }} />
      <Txt style={{ color: active ? '#fff' : c.textMuted, fontWeight: '600' }}>{label}</Txt>
    </Pill>
  )
}

const parseTime = (hhmm: string): Date => {
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(2000, 0, 1, h || 0, m || 0)
}
const toHHMM = (d: Date): string =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

/** A labelled time field that opens the native time picker. Stores "HH:MM". */
export function TimeField({
  label,
  value,
  locale,
  onChange,
}: {
  label: string
  value: string
  locale: string
  onChange: (hhmm: string) => void
}) {
  const { c } = useTheme()
  const [open, setOpen] = useState(false)

  return (
    <View style={{ gap: 6, flex: 1 }}>
      <Txt variant="label">{label}</Txt>
      <Pressable
        onPress={() => setOpen(true)}
        style={{
          backgroundColor: c.card,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: open ? c.accent : c.border,
          paddingHorizontal: sp.md,
          paddingVertical: 12,
        }}
      >
        <Txt style={{ color: c.text }}>{formatTime(value, locale)}</Txt>
      </Pressable>
      <PickerSheet
        visible={open}
        mode="time"
        value={parseTime(value)}
        onChange={(d) => onChange(toHHMM(d))}
        onClose={() => setOpen(false)}
      />
    </View>
  )
}
