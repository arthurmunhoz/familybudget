// Small shared pieces for the Pet Care module: the per-type Lucide icon map,
// a date-picker field (opens the native @react-native-community/datetimepicker),
// and a pill button used for pet/type selection.
import { useState } from 'react'
import { Platform, Pressable, View } from 'react-native'
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker'
import {
  FileText,
  Pill,
  Scissors,
  Stethoscope,
  Syringe,
  type LucideIcon,
} from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { formatDay } from '@/lib/format'
import { radius, sp, useTheme } from '@/theme/theme'
import type { PetEventType } from '@/lib/types'

export const TYPE_ICON: Record<PetEventType, LucideIcon> = {
  vet: Stethoscope,
  vaccine: Syringe,
  medication: Pill,
  grooming: Scissors,
  other: FileText,
}
export const TYPES = Object.keys(TYPE_ICON) as PetEventType[]

/** A selectable rounded chip — accent when active, surface otherwise. */
export function Pill_({
  active,
  onPress,
  children,
}: {
  active: boolean
  onPress: () => void
  children: React.ReactNode
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

const toISO = (d: Date): string => {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

const fromISO = (iso: string): Date => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** A labelled date field that opens the native date picker. Stores ISO
 *  YYYY-MM-DD strings. `value === ''` means "not set" (shows the placeholder). */
export function DateField({
  label,
  value,
  placeholder,
  onChange,
  optional,
}: {
  label: string
  value: string
  placeholder: string
  onChange: (iso: string) => void
  optional?: boolean
}) {
  const { c, dark } = useTheme()
  const [open, setOpen] = useState(false)

  function handle(event: DateTimePickerEvent, date?: Date) {
    // Android closes on its own; iOS keeps the inline picker mounted.
    if (Platform.OS === 'android') setOpen(false)
    if (event.type === 'dismissed') return
    if (date) onChange(toISO(date))
  }

  return (
    <View style={{ gap: 6, flex: 1 }}>
      <Txt variant="label">{label}</Txt>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={{
          backgroundColor: c.card,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: c.border,
          paddingHorizontal: sp.md,
          paddingVertical: 12,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Txt style={{ color: value ? c.text : c.textFaint }}>
          {value ? formatDay(value) : placeholder}
        </Txt>
        {value && optional ? (
          <Pressable hitSlop={8} onPress={() => onChange('')}>
            <Txt variant="muted">✕</Txt>
          </Pressable>
        ) : null}
      </Pressable>
      {open && (
        <DateTimePicker
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          value={value ? fromISO(value) : new Date()}
          onChange={handle}
          themeVariant={dark ? 'dark' : 'light'}
        />
      )}
    </View>
  )
}
