// Form building blocks — the "inset grouped list" style (2026-11 redesign).
//
// Before this, every form was a vertical stack of labelled boxes: a label, a
// bordered input, a label, a row of eight accent-filled chips… Heavy, tall and
// loud. Forms are now SECTIONS of compact ROWS: label on the left, value on the
// right, one hairline between rows, the accent kept for what's actionable.
// Long option lists (blood type, units, shirt size) are a SelectRow — the
// current value in the row, the list in a sheet — instead of a wall of chips.
//
//   <FormSection title="About you" footer="How your family sees you">
//     <TextRow label="Name" value={…} onChangeText={…} />
//     <SelectRow label="Blood type" value={…} options={…} onChange={…} />
//   </FormSection>
//
// Also: ToggleRow (switch in a row) and Segmented (2–4 short options, a
// neutral mode switch — not an accent fill).
//
// Rows inside a <Modal> render a nested sheet (SelectSheet / PickerSheet) in
// their own tree, never as a sibling of the open modal (that fails on iOS).
import { Children, isValidElement, useRef, useState, type ReactNode } from 'react'
import { Modal, ScrollView, StyleSheet, TextInput, View, type TextInputProps } from 'react-native'
import { Check, ChevronRight, ChevronsUpDown, X } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { Toggle } from '@/components/Toggle'
import { Txt } from '@/components/ui'
import { useRevealOnFocus } from '@/components/KeyboardScroll'
import { PickerSheet } from '@/components/PickerSheet'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useI18n } from '@/hooks/useI18n'
import { fonts, radius, sp, useTheme } from '@/theme/theme'

const ROW_MIN_H = 50

/** A titled group of rows on one rounded card, hairlines between rows. */
export function FormSection({
  title,
  footer,
  children,
}: {
  title?: string
  footer?: string
  children: ReactNode
}) {
  const { c } = useTheme()
  const rows = Children.toArray(children).filter(isValidElement)
  return (
    <View style={{ gap: 6 }}>
      {title ? (
        <Txt
          style={{
            fontSize: 12,
            fontFamily: fonts.semibold,
            color: c.textMuted,
            textTransform: 'uppercase',
            letterSpacing: 0.6,
            marginLeft: sp.md,
          }}
        >
          {title}
        </Txt>
      ) : null}
      <View
        style={{
          backgroundColor: c.card,
          borderRadius: radius.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: c.border,
          overflow: 'hidden',
        }}
      >
        {rows.map((row, i) => (
          <View key={i}>
            {i > 0 ? (
              <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: sp.md }} />
            ) : null}
            {row}
          </View>
        ))}
      </View>
      {footer ? (
        <Txt variant="faint" style={{ fontSize: 12, marginHorizontal: sp.md }}>
          {footer}
        </Txt>
      ) : null}
    </View>
  )
}

/** The shell every row shares: label left, content right. Pressable when
 *  `onPress` is given. */
export function FormRow({
  label,
  children,
  onPress,
  chevron,
}: {
  label: string
  children?: ReactNode
  onPress?: () => void
  chevron?: boolean
}) {
  const { c } = useTheme()
  const body = (
    <>
      <Txt style={{ fontSize: 15, color: c.text }} numberOfLines={1}>
        {label}
      </Txt>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
        {children}
      </View>
      {chevron ? <ChevronRight size={16} color={c.textFaint} /> : null}
    </>
  )
  const style = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: sp.md,
    minHeight: ROW_MIN_H,
    paddingHorizontal: sp.md,
  }
  if (!onPress) return <View style={style}>{body}</View>
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [style, pressed && { opacity: 0.6 }]}>
      {body}
    </Pressable>
  )
}

/** Value text on the right of a row: real value, or a faint placeholder. */
export function RowValue({ value, placeholder }: { value?: string | null; placeholder: string }) {
  const { c } = useTheme()
  return (
    <Txt style={{ fontSize: 15, color: value ? c.text : c.textFaint, flexShrink: 1 }} numberOfLines={1}>
      {value || placeholder}
    </Txt>
  )
}

/** One-line text input, right-aligned in the row. */
export function TextRow({
  label,
  placeholder,
  ...input
}: TextInputProps & { label: string }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const reveal = useRevealOnFocus()
  const row = useRef<View>(null)
  return (
    <View ref={row}>
      <FormRow label={label}>
        <TextInput
          placeholder={placeholder ?? t('form.add')}
          placeholderTextColor={c.textFaint}
          {...input}
          onFocus={(e) => {
            reveal(row.current)
            input.onFocus?.(e)
          }}
          style={{
            flex: 1,
            textAlign: 'right',
            fontSize: 15,
            color: c.text,
            fontFamily: fonts.body,
            paddingVertical: 12,
          }}
        />
      </FormRow>
    </View>
  )
}

/** Multi-line text: label on top, the text under it, full width. */
export function NoteRow({ label, placeholder, ...input }: TextInputProps & { label: string }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const reveal = useRevealOnFocus()
  const row = useRef<View>(null)
  return (
    <View ref={row} style={{ paddingHorizontal: sp.md, paddingTop: 12, paddingBottom: 10, gap: 4 }}>
      <Txt style={{ fontSize: 13, color: c.textMuted }}>{label}</Txt>
      <TextInput
        multiline
        placeholder={placeholder ?? t('form.add')}
        placeholderTextColor={c.textFaint}
        {...input}
        onFocus={(e) => {
          reveal(row.current)
          input.onFocus?.(e)
        }}
        style={{ fontSize: 15, color: c.text, fontFamily: fonts.body, minHeight: 22, paddingVertical: 2 }}
      />
    </View>
  )
}

export type Option<T extends string> = { value: T; label: string; hint?: string }

/** A value picked from a list: the row shows the choice, the list opens in a
 *  sheet. Replaces long chip rows. `allowNone` adds a "Not set" option. */
export function SelectRow<T extends string>({
  label,
  value,
  options,
  onChange,
  allowNone,
  placeholder,
}: {
  label: string
  value: T | '' | null
  options: Option<T>[]
  onChange: (v: T | '') => void
  allowNone?: boolean
  placeholder?: string
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)
  return (
    <>
      <FormRow label={label} onPress={() => setOpen(true)}>
        <RowValue value={current?.label} placeholder={placeholder ?? t('family.notSet')} />
        <ChevronsUpDown size={15} color={c.textFaint} />
      </FormRow>
      <SelectSheet
        visible={open}
        title={label}
        value={value ?? ''}
        options={allowNone ? [{ value: '' as T, label: t('family.notSet') }, ...options] : options}
        onPick={(v) => {
          onChange(v)
          setOpen(false)
        }}
        onClose={() => setOpen(false)}
      />
    </>
  )
}

/** The bottom sheet behind SelectRow (and unit buttons): a checked list. */
export function SelectSheet<T extends string>({
  visible,
  title,
  value,
  options,
  onPick,
  onClose,
}: {
  visible: boolean
  title: string
  value: T | ''
  options: Option<T | ''>[]
  onPick: (v: T | '') => void
  onClose: () => void
}) {
  const { c } = useTheme()
  const bottomGap = useBottomGap(sp.lg)
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: c.sheet,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            paddingTop: sp.sm,
            paddingBottom: bottomGap,
            maxHeight: '70%',
          }}
        >
          <View style={{ alignItems: 'center', paddingBottom: sp.sm }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: c.border }} />
          </View>
          <Txt style={{ fontFamily: fonts.semibold, fontSize: 16, textAlign: 'center', paddingBottom: sp.sm }}>
            {title}
          </Txt>
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: sp.lg }}>
            {options.map((o, i) => {
              const on = o.value === value
              return (
                <Pressable
                  key={o.value || '__none'}
                  onPress={() => onPick(o.value)}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    minHeight: ROW_MIN_H,
                    borderTopWidth: i ? StyleSheet.hairlineWidth : 0,
                    borderTopColor: c.border,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <View style={{ flex: 1 }}>
                    <Txt style={{ fontSize: 16, color: on ? c.accent : c.text, fontFamily: on ? fonts.semibold : fonts.body }}>
                      {o.label}
                    </Txt>
                    {o.hint ? (
                      <Txt variant="faint" style={{ fontSize: 12 }}>
                        {o.hint}
                      </Txt>
                    ) : null}
                  </View>
                  {on ? <Check size={18} color={c.accent} strokeWidth={2.5} /> : null}
                </Pressable>
              )
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

/** A date, picked in the platform's own date pop-up; × clears it. */
export function DateRow({
  label,
  value,
  display,
  onChange,
  maximumDate,
  wheels,
}: {
  label: string
  /** ISO YYYY-MM-DD, or '' when unset. */
  value: string
  /** Formatted value for the row. */
  display: string
  onChange: (iso: string) => void
  maximumDate?: Date
  /** Wheels instead of a calendar grid — for dates far from today. */
  wheels?: boolean
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const date = (() => {
    if (value) {
      const [y, m, d] = value.split('-').map(Number)
      if (y && m && d) return new Date(y, m - 1, d)
    }
    const now = new Date()
    return new Date(now.getFullYear() - 30, now.getMonth(), now.getDate())
  })()
  return (
    <>
      <FormRow label={label} onPress={() => setOpen(true)}>
        <RowValue value={value ? display : null} placeholder={t('family.notSet')} />
        {value ? (
          <Pressable
            onPress={() => onChange('')}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('form.clear')}
            style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}
          >
            <X size={12} color={c.textMuted} />
          </Pressable>
        ) : null}
      </FormRow>
      <PickerSheet
        title={label}
        visible={open}
        mode="date"
        iosDisplay={wheels ? 'spinner' : 'inline'}
        value={date}
        maximumDate={maximumDate}
        onChange={(d) =>
          onChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
        }
        onClose={() => setOpen(false)}
      />
    </>
  )
}

/** Compact numeric input for a row (measurements). */
export function NumberBox({
  value,
  onChangeText,
  width = 56,
  suffix,
}: {
  value: string
  onChangeText: (v: string) => void
  width?: number
  suffix?: string
}) {
  const { c } = useTheme()
  const reveal = useRevealOnFocus()
  const box = useRef<View>(null)
  return (
    <View ref={box} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType="decimal-pad"
        placeholder="–"
        placeholderTextColor={c.textFaint}
        onFocus={() => reveal(box.current)}
        style={{
          width,
          textAlign: 'right',
          fontSize: 15,
          color: c.text,
          fontFamily: fonts.body,
          paddingVertical: 8,
          paddingHorizontal: 8,
          borderRadius: radius.sm,
          backgroundColor: c.surface,
        }}
      />
      {suffix ? <Txt style={{ fontSize: 13, color: c.textMuted }}>{suffix}</Txt> : null}
    </View>
  )
}

/** The unit beside a measurement, as a small tappable chip that opens a
 *  checked list — "lb ⌄" instead of a permanently-visible segmented pill. */
export function UnitButton<T extends string>({
  title,
  value,
  options,
  onChange,
}: {
  title: string
  value: T
  options: Option<T>[]
  onChange: (v: T) => void
}) {
  const { c } = useTheme()
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={6}
        accessibilityRole="button"
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 2,
          paddingHorizontal: 8,
          paddingVertical: 6,
          borderRadius: radius.pill,
          backgroundColor: c.accentSoft,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Txt style={{ fontSize: 13, color: c.accent, fontFamily: fonts.semibold }}>{current?.label ?? value}</Txt>
        <ChevronsUpDown size={12} color={c.accent} />
      </Pressable>
      <SelectSheet
        visible={open}
        title={title}
        value={value}
        options={options}
        onPick={(v) => {
          if (v) onChange(v as T)
          setOpen(false)
        }}
        onClose={() => setOpen(false)}
      />
    </>
  )
}

/** A switch in a row: label (+ optional hint under it), Toggle on the right. */
export function ToggleRow({
  label,
  hint,
  value,
  onValueChange,
}: {
  label: string
  hint?: string
  value: boolean
  onValueChange: (v: boolean) => void
}) {
  const { c } = useTheme()
  // The WHOLE row toggles (2026-11): inside a sheet's scroller a tap aimed at
  // the small native switch could be taken as the start of a scroll and
  // never reach it — the owner couldn't flip All day / Remind me. A row tap
  // is also what iOS Settings does.
  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: sp.md,
        minHeight: ROW_MIN_H,
        paddingHorizontal: sp.md,
        paddingVertical: 8,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={{ fontSize: 15, color: c.text }}>{label}</Txt>
        {hint ? (
          <Txt variant="faint" style={{ fontSize: 12 }}>
            {hint}
          </Txt>
        ) : null}
      </View>
      <Toggle value={value} onValueChange={onValueChange} accessible={false} />
    </Pressable>
  )
}

/** iOS-style segmented control for 2–4 short options (Expense / Income,
 *  Month / Week / Day). Neutral track, the selected segment a raised card —
 *  not an accent fill: it's a mode switch, not an action. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Option<T>[]
  onChange: (v: T) => void
}) {
  const { c, dark } = useTheme()
  return (
    <View style={{ flexDirection: 'row', backgroundColor: c.surface2, borderRadius: radius.md, padding: 3 }}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: 8,
              borderRadius: radius.md - 3,
              backgroundColor: on ? (dark ? 'rgba(255,255,255,0.16)' : '#FFFFFF') : 'transparent',
              shadowColor: '#000',
              shadowOpacity: on && !dark ? 0.08 : 0,
              shadowRadius: 3,
              shadowOffset: { width: 0, height: 1 },
            }}
          >
            <Txt style={{ fontSize: 14, fontFamily: on ? fonts.semibold : fonts.medium, color: on ? c.text : c.textMuted }}>
              {o.label}
            </Txt>
          </Pressable>
        )
      })}
    </View>
  )
}
