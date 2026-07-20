// Small shared pieces for the Money (budget) module: a native date-picker field,
// a segmented control (period / income-expense toggle), and a selectable pill.
// Mirrors the patterns used elsewhere in the RN app (pets/petUi, calc/shared).
import { useState, type ReactNode } from 'react'
import { Platform, Pressable, View, type ViewStyle } from 'react-native'
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker'
import { CalendarDays, ChevronDown } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Txt } from '@/components/ui'
import { formatDay } from '@/lib/format'
import { fonts, radius, sp, useTheme } from '@/theme/theme'

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
  displayValue,
  withPicker = false,
}: {
  label?: string
  value: string
  placeholder?: string
  onChange: (iso: string) => void
  style?: ViewStyle
  /** Override the shown text (defaults to formatDay(value)). Lets callers show a
   *  period label like "Jul 2026" instead of a specific day. */
  displayValue?: string
  /** Show a leading calendar glyph + trailing chevron so the field reads as a
   *  date PICKER, not an editable text input. */
  withPicker?: boolean
}) {
  const { c, dark } = useTheme()
  const [open, setOpen] = useState(false)

  function handle(event: DateTimePickerEvent, date?: Date) {
    // Android closes on its own; iOS keeps the inline picker mounted.
    if (Platform.OS === 'android') setOpen(false)
    if (event.type === 'dismissed') return
    if (date) onChange(toISO(date))
  }

  const shown = displayValue ?? (value ? formatDay(value) : '')

  return (
    <View style={[{ gap: 6, flex: 1 }, style]}>
      {label ? <Txt variant="label">{label}</Txt> : null}
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={{
          backgroundColor: c.card,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: open ? c.accent : c.border,
          paddingHorizontal: sp.md,
          paddingVertical: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: sp.sm,
        }}
      >
        {withPicker ? <CalendarDays size={18} color={c.textMuted} /> : null}
        <Txt style={{ flex: 1, color: shown ? c.text : c.textFaint }} numberOfLines={1}>
          {shown || placeholder || ''}
        </Txt>
        {withPicker ? (
          <ChevronDown size={18} color={c.textMuted} style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }} />
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

// iPhones get screen-corner-like rounding on the bottom bar button.
const CURVE_RADIUS = Platform.OS === 'ios' ? 40 : 12

/**
 * The dashed "＋ New …" action pinned to the bottom of a budget screen.
 *
 * Shared by Budgets ("New budget") and Months ("New month/week/day") so the two
 * can't drift apart — Months used to be a filled primary `Btn`, which read as a
 * different kind of action than the identical one a screen above it. Sits
 * directly inside the bottom `SafeAreaView`; it carries its own margins.
 */
export function NewItemButton({
  label,
  onPress,
  disabled,
}: {
  label: string
  onPress: () => void
  disabled?: boolean
}) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  // Sit CLOSER to the bottom edge than a full safe-area inset would allow — the
  // screen-curve corners are meant to hug the screen's own corner. Half the
  // inset still clears the home indicator; the sp.xs floor covers home-button
  // devices (inset 0) so it never sits flush on the bezel.
  const bottom = Math.max(Math.round(insets.bottom / 2), sp.xs)
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: 'center',
        justifyContent: 'center',
        marginHorizontal: sp.lg,
        marginTop: sp.sm,
        marginBottom: bottom,
        paddingVertical: 16,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: c.textFaint,
        // Bottom corners follow the iPhone screen curve (normal on Android).
        borderTopLeftRadius: radius.md,
        borderTopRightRadius: radius.md,
        borderBottomLeftRadius: CURVE_RADIUS,
        borderBottomRightRadius: CURVE_RADIUS,
        opacity: disabled ? 0.5 : pressed ? 0.6 : 1,
      })}
    >
      <Txt style={{ color: c.accent, fontFamily: fonts.semibold, fontSize: 16 }}>{label}</Txt>
    </Pressable>
  )
}
