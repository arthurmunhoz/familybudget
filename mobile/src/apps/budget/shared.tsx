// Small shared pieces for the Money (budget) module: a native date-picker field,
// a segmented control (period / income-expense toggle), and a selectable pill.
// Mirrors the patterns used elsewhere in the RN app (pets/petUi, calc/shared).
import { useState, type ReactNode } from 'react'
import { Platform, Pressable, View, type ViewStyle } from 'react-native'
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker'

import { Txt } from '@/components/ui'
import { formatDay } from '@/lib/format'
import { radius, sp, useTheme } from '@/theme/theme'

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
 *  YYYY-MM-DD strings. `value === ''` shows the placeholder. */
export function DateField({
  label,
  value,
  placeholder,
  onChange,
  style,
}: {
  label?: string
  value: string
  placeholder?: string
  onChange: (iso: string) => void
  style?: ViewStyle
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
    <View style={[{ gap: 6, flex: 1 }, style]}>
      {label ? <Txt variant="label">{label}</Txt> : null}
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
        }}
      >
        <Txt style={{ color: value ? c.text : c.textFaint }}>
          {value ? formatDay(value) : (placeholder ?? '')}
        </Txt>
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

/** Generic segmented control: an equal-width row of options, accent-highlighting
 *  the selected one. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  activeColor,
}: {
  /** `badge` (when > 0) renders a small count pill after the label. */
  options: { id: T; label: string; badge?: number }[]
  value: T
  onChange: (id: T) => void
  activeColor?: string
}) {
  const { c } = useTheme()
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: c.surface,
        borderRadius: radius.md,
        padding: 4,
        gap: 4,
      }}
    >
      {options.map((o) => {
        const active = value === o.id
        const accent = activeColor ?? c.accent
        return (
          <Pressable
            key={o.id}
            onPress={() => onChange(o.id)}
            style={{
              flex: 1,
              flexDirection: 'row',
              gap: 6,
              borderRadius: radius.sm,
              paddingVertical: 9,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: active ? accent : 'transparent',
            }}
          >
            <Txt
              style={{
                fontWeight: '700',
                fontSize: 14,
                color: active ? '#fff' : c.textMuted,
              }}
            >
              {o.label}
            </Txt>
            {o.badge && o.badge > 0 ? (
              <View
                style={{
                  minWidth: 18,
                  height: 18,
                  borderRadius: 9,
                  paddingHorizontal: 5,
                  alignItems: 'center',
                  justifyContent: 'center',
                  // On the active (filled) segment invert; otherwise the usual red.
                  backgroundColor: active ? '#fff' : c.expense,
                }}
              >
                <Txt style={{ fontSize: 11, fontWeight: '700', color: active ? accent : '#fff' }}>
                  {o.badge}
                </Txt>
              </View>
            ) : null}
          </Pressable>
        )
      })}
    </View>
  )
}

/** A selectable rounded chip — accent when active, surface otherwise. */
export function Chip({
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
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: radius.pill,
        backgroundColor: active ? c.accent : c.surface,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {children}
    </Pressable>
  )
}
