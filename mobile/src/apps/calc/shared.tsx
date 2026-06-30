// Shared bits for the Calculator tools — number parsing, the per-unit money
// formatter, a result row, a percentage chip picker, and small color/avatar
// helpers for the by-item split. RN port of the PWA's calc/Calculator.tsx.
import { useState } from 'react'
import { Pressable, StyleSheet, TextInput, View } from 'react-native'

import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { radius, sp, useTheme } from '@/theme/theme'

// Currency with extra precision for tiny per-unit prices.
const perUnitFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 4,
})
export const formatPerUnit = (n: number) => perUnitFmt.format(n)

/** Parse a user-typed amount; blank/garbage → 0. */
export function num(s: string): number {
  const n = parseFloat(s.replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

// ── Result row (label left, value right) ─────────────────────────────────────

export function ResultRow({
  label,
  value,
  strong,
}: {
  label: string
  value: string
  strong?: boolean
}) {
  const { c } = useTheme()
  return (
    <View style={styles.resultRow}>
      <Txt variant="muted">{label}</Txt>
      <Txt
        style={{
          fontVariant: ['tabular-nums'],
          color: c.text,
          fontSize: strong ? 22 : 16,
          fontWeight: strong ? '800' : '600',
        }}
      >
        {value}
      </Txt>
    </View>
  )
}

export function Divider() {
  const { c } = useTheme()
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.surface2, marginVertical: sp.xs }} />
}

// ── Percentage chips + a free-form "custom" field ────────────────────────────
// The custom input keeps its own raw string so partial entries like "12." type
// cleanly; picking a preset clears it.

export function PercentPicker({
  value,
  onChange,
  presets,
}: {
  value: number
  onChange: (n: number) => void
  presets: number[]
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const [custom, setCustom] = useState('')
  const usingCustom = custom !== ''

  return (
    <View style={styles.chipRow}>
      {presets.map((v) => {
        const active = value === v && !usingCustom
        return (
          <Pressable
            key={v}
            onPress={() => {
              setCustom('')
              onChange(v)
            }}
            style={[
              styles.chip,
              { backgroundColor: active ? c.accent : c.surface },
            ]}
          >
            <Txt style={{ fontWeight: '700', fontSize: 14, color: active ? '#ffffff' : c.textMuted }}>
              {v}%
            </Txt>
          </Pressable>
        )
      })}
      <TextInput
        value={custom}
        onChangeText={(txt) => {
          setCustom(txt)
          onChange(num(txt))
        }}
        keyboardType="decimal-pad"
        placeholder={t('calc.custom')}
        placeholderTextColor={usingCustom ? 'rgba(255,255,255,0.7)' : c.textFaint}
        style={[
          styles.customInput,
          {
            backgroundColor: usingCustom ? c.accent : c.surface,
            color: usingCustom ? '#ffffff' : c.text,
          },
        ]}
      />
    </View>
  )
}

// ── Stepper (− count +) ──────────────────────────────────────────────────────

export function Stepper({
  label,
  onDec,
  onInc,
}: {
  label: string
  onDec: () => void
  onInc: () => void
}) {
  const { c } = useTheme()
  return (
    <View style={styles.stepperRow}>
      <Pressable onPress={onDec} style={[styles.stepBtn, { backgroundColor: c.surface }]}>
        <Txt style={{ fontSize: 22, fontWeight: '700', color: c.textMuted }}>−</Txt>
      </Pressable>
      <Txt style={{ flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', color: c.text }}>
        {label}
      </Txt>
      <Pressable onPress={onInc} style={[styles.stepBtn, { backgroundColor: c.surface }]}>
        <Txt style={{ fontSize: 22, fontWeight: '700', color: c.textMuted }}>+</Txt>
      </Pressable>
    </View>
  )
}

// ── Small inline amount input (right-aligned, used in by-item rows) ───────────

export function MiniInput({
  value,
  onChangeText,
  placeholder,
  width = 96,
  ...rest
}: {
  value: string
  onChangeText: (s: string) => void
  placeholder?: string
  width?: number
} & React.ComponentProps<typeof TextInput>) {
  const { c } = useTheme()
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={c.textFaint}
      keyboardType="decimal-pad"
      style={{
        width,
        backgroundColor: c.surface,
        borderRadius: radius.sm,
        paddingHorizontal: sp.sm,
        paddingVertical: 6,
        textAlign: 'right',
        fontVariant: ['tabular-nums'],
        fontSize: 15,
        color: c.text,
      }}
      {...rest}
    />
  )
}

// ── Color / avatar helpers for the by-item split ─────────────────────────────
// Each person gets a stable color hashed from their name so it doesn't shift
// when someone is removed.

const PALETTE = ['#2563eb', '#059669', '#d97706', '#db2777', '#7c3aed', '#0891b2', '#dc2626', '#4f46e5']
export function colorFor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
export const firstName = (name: string) => name.trim().split(/\s+/)[0]

export function Avatar({ name, sm }: { name: string; sm?: boolean }) {
  const size = sm ? 24 : 36
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colorFor(name),
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Txt style={{ color: '#ffffff', fontWeight: '700', fontSize: sm ? 10 : 12 }}>
        {initials(name)}
      </Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  resultRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: sp.sm,
    marginTop: sp.sm,
  },
  chip: {
    flexGrow: 1,
    minWidth: 56,
    borderRadius: radius.sm,
    paddingVertical: 8,
    alignItems: 'center',
  },
  customInput: {
    width: 80,
    borderRadius: radius.sm,
    paddingVertical: 8,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '700',
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.md,
    marginTop: sp.sm,
  },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
