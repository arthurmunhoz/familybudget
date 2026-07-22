// Small shared pieces for the Pet Care module: the per-type Lucide icon map,
// a date-picker field (opens the native @react-native-community/datetimepicker),
// and a pill button used for pet/type selection.
import { useState } from 'react'
import { Modal, Platform, Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import DateTimePicker from '@react-native-community/datetimepicker'
import {
  Bath,
  Bone,
  Cookie,
  FileText,
  Footprints,
  PawPrint,
  Pill,
  Scissors,
  Sparkles,
  Stethoscope,
  Syringe,
  type LucideIcon,
} from 'lucide-react-native'

import { Btn, Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { formatDay } from '@/lib/format'
import { radius, sheetRadius, sp, useTheme } from '@/theme/theme'
import type { PetEventType, PetTaskIcon } from '@/lib/types'

export const TYPE_ICON: Record<PetEventType, LucideIcon> = {
  vet: Stethoscope,
  vaccine: Syringe,
  medication: Pill,
  grooming: Scissors,
  other: FileText,
}
export const TYPES = Object.keys(TYPE_ICON) as PetEventType[]

/** Routine-task icon ids → Lucide. The widget maps the SAME ids to SF Symbols
 *  (PetCareWidget.swift) — keep the two in sync. */
export const CARE_ICONS: Record<PetTaskIcon, LucideIcon> = {
  bowl: Bone,
  walk: Footprints,
  treat: Cookie,
  pill: Pill,
  bath: Bath,
  nails: Scissors,
  teeth: Sparkles,
  paw: PawPrint,
}
export const CARE_ICON_IDS = Object.keys(CARE_ICONS) as PetTaskIcon[]

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
  const { t } = useI18n()
  const insets = useSafeAreaInsets()
  const [open, setOpen] = useState(false)

  return (
    <View style={{ gap: 6, flex: 1 }}>
      <Txt variant="label">{label}</Txt>
      {/* The open-picker target and the clear (✕) are SEPARATE siblings — not
          nested — so tapping ✕ reliably clears without also toggling the
          picker. Clearing an optional field is how you remove a next-due date. */}
      <View
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
          gap: sp.sm,
        }}
      >
        <Pressable onPress={() => setOpen(true)} style={{ flex: 1 }}>
          <Txt style={{ color: value ? c.text : c.textFaint }}>
            {value ? formatDay(value) : placeholder}
          </Txt>
        </Pressable>
        {value && optional ? (
          <Pressable
            hitSlop={10}
            onPress={() => {
              onChange('')
              setOpen(false)
            }}
            accessibilityRole="button"
            accessibilityLabel="Clear"
            style={{ paddingLeft: sp.sm }}
          >
            <Txt variant="muted">✕</Txt>
          </Pressable>
        ) : null}
      </View>

      {/* Android: the native dialog fires and closes on its own. */}
      {Platform.OS === 'android' && open ? (
        <DateTimePicker
          mode="date"
          display="default"
          value={value ? fromISO(value) : new Date()}
          onChange={(event, date) => {
            setOpen(false)
            if (event.type !== 'dismissed' && date) onChange(toISO(date))
          }}
        />
      ) : null}

      {/* iOS: present the calendar in an overlay sheet (so it doesn't push the
          form and two fields can't show pickers at once). */}
      {Platform.OS === 'ios' ? (
        <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <Pressable
            onPress={() => setOpen(false)}
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
          >
            <Pressable
              onPress={() => {}}
              style={{
                backgroundColor: c.sheet,
                borderTopLeftRadius: radius.lg,
                borderTopRightRadius: radius.lg,
                paddingHorizontal: sp.lg,
                paddingTop: sp.md,
                // Half the inset hugs the bottom edge while clearing the home
                // indicator, so Done's curve echoes the phone's own corner
                // (same treatment as the pet EventForm's Save).
                paddingBottom: Math.max(Math.round(insets.bottom / 2), sp.xs),
                gap: sp.md,
              }}
            >
              <DateTimePicker
                mode="date"
                display="inline"
                value={value ? fromISO(value) : new Date()}
                onChange={(_event, date) => {
                  if (date) onChange(toISO(date))
                }}
                themeVariant={dark ? 'dark' : 'light'}
              />
              <Btn
                title={t('common.done')}
                onPress={() => setOpen(false)}
                style={{
                  borderBottomLeftRadius: sheetRadius,
                  borderBottomRightRadius: sheetRadius,
                }}
              />
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  )
}
