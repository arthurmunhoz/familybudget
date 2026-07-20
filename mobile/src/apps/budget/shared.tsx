// Small shared pieces for the Money (budget) module: a native date-picker field,
// a segmented control (period / income-expense toggle), and a selectable pill.
// Mirrors the patterns used elsewhere in the RN app (pets/petUi, calc/shared).
import { useState, type ReactNode } from 'react'
import { Modal, Platform, Pressable, View, type ViewStyle } from 'react-native'
import DateTimePicker from '@react-native-community/datetimepicker'
import { CalendarDays, ChevronDown } from 'lucide-react-native'

import { Btn, Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
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
/** The calendar itself, in a MODAL rather than shoved inline into the form.
 *
 *  iOS gets a bottom sheet with the graphical calendar and a Done button, so it
 *  has room to breathe instead of pushing the rest of the form around — the
 *  inline version looked cramped. Android's `display="default"` IS a native
 *  modal dialog, so there we just mount the picker while `visible`.
 *
 *  Selection applies live (each calendar tap calls `onChange`), matching Pet
 *  Care's date field; Done just dismisses. */
export function DatePickerModal({
  visible,
  value,
  onChange,
  onClose,
}: {
  visible: boolean
  value: string
  onChange: (iso: string) => void
  onClose: () => void
}) {
  const { c, dark } = useTheme()
  const { t } = useI18n()

  if (Platform.OS === 'android') {
    return visible ? (
      <DateTimePicker
        mode="date"
        display="default"
        value={value ? fromISO(value) : new Date()}
        onChange={(event, date) => {
          onClose()
          if (event.type !== 'dismissed' && date) onChange(toISO(date))
        }}
      />
    ) : null
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
      >
        {/* Inner press-catcher so a tap on the sheet doesn't dismiss it. */}
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: c.sheet,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            paddingHorizontal: sp.lg,
            paddingTop: sp.md,
            paddingBottom: sp.xl,
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
          <Btn title={t('common.done')} onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  )
}

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
  const { c } = useTheme()
  const [open, setOpen] = useState(false)

  const shown = displayValue ?? (value ? formatDay(value) : '')

  return (
    <View style={[{ gap: 6, flex: 1 }, style]}>
      {label ? <Txt variant="label">{label}</Txt> : null}
      <Pressable
        onPress={() => setOpen(true)}
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
      <DatePickerModal visible={open} value={value} onChange={onChange} onClose={() => setOpen(false)} />
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
