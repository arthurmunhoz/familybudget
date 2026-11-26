// Rows the shared form kit (`@/components/form`) doesn't have yet, used by the
// calendar event form and by Pet Care's forms:
//
//   • InputRow    — a full-width text input with only a placeholder (title,
//                   location, notes), so a field whose placeholder already
//                   says what it is doesn't need a label beside it.
//   • DateTimeRow — "Starts   Nov 4, 2026   10:00 AM": the date and (when
//                   timed) the time as two small chips, each opening its own
//                   PickerSheet.
//   • DayRow      — one date, opened on TODAY when unset (form's DateRow opens
//                   30 years back — it's built for birthdays) and clearable
//                   only when the field is optional.
//   • DangerRow   — a centred destructive action on its own card (Delete).
//
// Pickers open in their own sheet, never inline (PickerSheet), and every
// sheet is rendered inside the row's tree so it NESTS in the open form modal
// instead of sitting beside it (a sibling Modal fails to present on iOS).
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { TextInput, View, type TextInputProps } from 'react-native'
import { X } from 'lucide-react-native'

import { FormRow, RowValue } from '@/components/form'
import { useRevealOnFocus } from '@/components/KeyboardScroll'
import { PickerSheet } from '@/components/PickerSheet'
import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { formatTime } from '@/lib/calendar'
import { formatDay } from '@/lib/format'
import { fonts, radius, sp, useTheme } from '@/theme/theme'

const toISO = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const fromISO = (iso: string): Date | null => {
  const [y, m, d] = iso.split('-').map(Number)
  return y && m && d ? new Date(y, m - 1, d) : null
}

const parseTime = (hhmm: string): Date => {
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(2000, 0, 1, h || 0, m || 0)
}
const toHHMM = (d: Date): string =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

/** Full-width text input in a FormSection, placeholder only. `title` makes it
 *  the form's headline field (larger, semibold). */
export function InputRow({ title, icon, ...input }: TextInputProps & { title?: boolean; icon?: ReactNode }) {
  const { c } = useTheme()
  const reveal = useRevealOnFocus()
  const row = useRef<View>(null)
  return (
    <View
      ref={row}
      style={{ paddingHorizontal: sp.md, minHeight: 50, flexDirection: 'row', alignItems: input.multiline ? 'flex-start' : 'center', gap: sp.md }}
    >
      {icon ? <View style={{ paddingTop: input.multiline ? 8 : 0 }}>{icon}</View> : null}
      <TextInput
        placeholderTextColor={c.textFaint}
        {...input}
        onFocus={(e) => {
          reveal(row.current)
          input.onFocus?.(e)
        }}
        style={{
          flex: 1,
          fontSize: title ? 17 : 15,
          fontFamily: title ? fonts.semibold : fonts.body,
          color: c.text,
          paddingVertical: input.multiline ? 12 : 13,
          minHeight: input.multiline ? 44 : undefined,
        }}
      />
    </View>
  )
}

/** A tappable value chip inside a row (a date or a time). Accent text while
 *  its picker is open, so you can see which one you're changing. */
function ValueChip({ label, active, onPress, tint }: { label: string; active: boolean; onPress: () => void; tint?: string }) {
  const { c } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      hitSlop={4}
      style={({ pressed }) => ({
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: radius.sm,
        backgroundColor: c.surface2,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Txt style={{ fontSize: 15, color: active ? tint ?? c.accent : c.text, fontFamily: active ? fonts.semibold : fonts.body }}>
        {label}
      </Txt>
    </Pressable>
  )
}

/** A date plus, when `time` is given, a time — each its own chip and picker. */
export function DateTimeRow({
  label,
  date,
  time,
  locale,
  onDate,
  onTime,
  minimumDate,
  tint,
  icon,
}: {
  /** The app's colour for the pickers (Done, the picked day). */
  tint?: string
  /** Leading RowIcon (2026-11 sheets). */
  icon?: ReactNode
  label: string
  /** ISO YYYY-MM-DD. */
  date: string
  /** "HH:MM", or null for an all-day row (no time chip). */
  time: string | null
  locale: string
  onDate: (iso: string) => void
  onTime: (hhmm: string) => void
  minimumDate?: Date
}) {
  const [open, setOpen] = useState<'date' | 'time' | null>(null)
  return (
    <>
      <FormRow label={label} icon={icon}>
        <ValueChip tint={tint} label={date ? formatDay(date) : '–'} active={open === 'date'} onPress={() => setOpen('date')} />
        {time !== null ? (
          <ValueChip tint={tint} label={formatTime(time, locale)} active={open === 'time'} onPress={() => setOpen('time')} />
        ) : null}
      </FormRow>
      <PickerSheet
        title={label}
        tint={tint}
        visible={open === 'date'}
        mode="date"
        value={fromISO(date) ?? new Date()}
        minimumDate={minimumDate}
        onChange={(d) => onDate(toISO(d))}
        onClose={() => setOpen(null)}
      />
      {time !== null ? (
        <PickerSheet
          title={label}
          tint={tint}
          visible={open === 'time'}
          mode="time"
          value={parseTime(time)}
          onChange={(d) => onTime(toHHMM(d))}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  )
}

/** One date in a row. Unset shows `placeholder`; `optional` adds the × that
 *  clears it (that's how a next-due date is removed). */
export function DayRow({
  label,
  tint,
  value,
  placeholder,
  onChange,
  optional,
  maximumDate,
  wheels,
  icon,
}: {
  /** The app's colour for the picker. */
  tint?: string
  /** Leading RowIcon (2026-11 sheets). */
  icon?: ReactNode
  label: string
  /** ISO YYYY-MM-DD, or '' when unset. */
  value: string
  placeholder?: string
  onChange: (iso: string) => void
  optional?: boolean
  maximumDate?: Date
  /** Wheels instead of a calendar grid — for dates far from today. */
  wheels?: boolean
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  return (
    <>
      <FormRow label={label} icon={icon} onPress={() => setOpen(true)}>
        <RowValue value={value ? formatDay(value) : null} placeholder={placeholder ?? t('family.notSet')} />
        {value && optional ? (
          <Pressable
            onPress={() => {
              onChange('')
              setOpen(false)
            }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('form.clear')}
            style={{
              width: 20,
              height: 20,
              borderRadius: 10,
              backgroundColor: c.surface2,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={12} color={c.textMuted} />
          </Pressable>
        ) : null}
      </FormRow>
      <PickerSheet
        title={label}
        tint={tint}
        visible={open}
        mode="date"
        iosDisplay={wheels ? 'spinner' : 'inline'}
        value={fromISO(value) ?? new Date()}
        maximumDate={maximumDate}
        onChange={(d) => onChange(toISO(d))}
        onClose={() => setOpen(false)}
      />
    </>
  )
}

/** A destructive action as a centred row (put it in its own FormSection at
 *  the end of the form, iOS-style, so the docked button stays the only CTA). */
export function DangerRow({ label, onPress }: { label: string; onPress: () => void }) {
  // Two taps in the SAME place (owner, 2026-11-25): the first turns the row
  // into a solid red "Tap again to delete", the second does it. A stray touch
  // while scrolling a form used to delete an event outright. Disarms by itself.
  const { c } = useTheme()
  const { t } = useI18n()
  const [armed, setArmed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return (
    <Pressable
      onPress={() => {
        if (timer.current) clearTimeout(timer.current)
        if (armed) { setArmed(false); onPress(); return }
        setArmed(true)
        timer.current = setTimeout(() => setArmed(false), 4000)
      }}
      accessibilityRole="button"
      accessibilityLabel={armed ? t('common.tapAgainToDelete') : label}
      style={({ pressed }) => ({
        minHeight: 50, alignItems: 'center', justifyContent: 'center',
        backgroundColor: armed ? c.expense : 'transparent',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Txt style={{ fontSize: 15, color: armed ? '#fff' : c.expense, fontFamily: fonts.semibold }}>
        {armed ? t('common.tapAgainToDelete') : label}
      </Txt>
    </Pressable>
  )
}
