// Answer controls for the wizard steps — big, thumb-sized versions of the old
// form widgets: a hero money field, a people counter, a tip grid, and the
// tappable "edit this" rows the summary steps are built from.
import { useState } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import { Minus, Pencil, Plus } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { formatMoney } from '@/lib/format'
import { fonts, radius, sp, useTheme } from '@/theme/theme'

import { num } from './shared'
import { tipAmount, type Tip } from './splitMath'

// ── Hero money field ─────────────────────────────────────────────────────────

export function MoneyHero({
  value,
  onChangeText,
  onSubmit,
}: {
  value: string
  onChangeText: (s: string) => void
  onSubmit?: () => void
}) {
  const { c } = useTheme()
  return (
    <View style={[styles.moneyBox, { backgroundColor: c.card, borderColor: c.border }]}>
      {/* The symbol follows the amount's state so the two read as ONE figure —
          a grey $ beside a dark number looked like the amount was greyed out. */}
      <Txt style={{ fontSize: 34, fontFamily: fonts.semibold, color: value ? c.text : c.textFaint }}>$</Txt>
      <TextInput
        value={value}
        onChangeText={(s) => onChangeText(s.replace(/[^0-9.,]/g, ''))}
        onSubmitEditing={onSubmit}
        keyboardType="decimal-pad"
        placeholder="0.00"
        placeholderTextColor={c.textFaint}
        autoFocus
        style={{
          minWidth: 150,
          fontSize: 48,
          fontFamily: fonts.display,
          letterSpacing: -1,
          textAlign: 'center',
          color: c.text,
          paddingVertical: 0,
        }}
      />
    </View>
  )
}

// ── People counter ───────────────────────────────────────────────────────────

const QUICK_PEOPLE = [2, 3, 4, 5, 6, 8]

export function PeopleCount({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const { c } = useTheme()
  const { t } = useI18n()
  return (
    <View style={{ gap: sp.xl }}>
      <View style={styles.counter}>
        <RoundBtn onPress={() => onChange(Math.max(1, value - 1))} disabled={value <= 1} label="−">
          <Minus size={26} color={c.text} />
        </RoundBtn>
        <View style={{ alignItems: 'center', minWidth: 110 }}>
          <Txt style={{ fontSize: 64, fontFamily: fonts.display, color: c.text, lineHeight: 72 }}>{value}</Txt>
          <Txt variant="muted">{t('calc.peopleWord', { count: value })}</Txt>
        </View>
        <RoundBtn onPress={() => onChange(Math.min(99, value + 1))} label="+">
          <Plus size={26} color={c.text} />
        </RoundBtn>
      </View>
      <View style={styles.quickRow}>
        {QUICK_PEOPLE.map((n) => {
          const on = n === value
          return (
            <Pressable
              key={n}
              onPress={() => onChange(n)}
              style={[styles.quick, { backgroundColor: on ? c.action : c.surface }]}
            >
              <Txt style={{ fontFamily: fonts.semibold, fontSize: 17, color: on ? c.onAction : c.text }}>{n}</Txt>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

function RoundBtn({
  onPress,
  disabled,
  label,
  children,
}: {
  onPress: () => void
  disabled?: boolean
  label: string
  children: React.ReactNode
}) {
  const { c } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={({ pressed }) => [
        styles.round,
        { backgroundColor: pressed ? c.cardActive : c.card, borderColor: c.border, opacity: disabled ? 0.4 : 1 },
      ]}
    >
      {children}
    </Pressable>
  )
}

// ── Tip grid ─────────────────────────────────────────────────────────────────

const TIP_PRESETS = [0, 10, 15, 18, 20, 22]

/** Tip options as big tiles, each showing what it comes to. `base` is the
 *  amount the percentage is taken from. `fromBill` adds a tile for a tip the
 *  scanned receipt already carried. */
export function TipGrid({
  base,
  value,
  onChange,
  fromBill,
}: {
  base: number
  value: Tip
  onChange: (t: Tip) => void
  fromBill?: number
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const isPreset = value.kind === 'pct' && TIP_PRESETS.includes(value.pct)
  const [custom, setCustom] = useState(
    value.kind === 'pct' && !isPreset ? String(value.pct) : '',
  )
  const customOn = value.kind === 'pct' && !isPreset

  const tile = (key: string, on: boolean, top: string, bottom: string, onPress: () => void) => (
    <Pressable
      key={key}
      onPress={onPress}
      style={[
        styles.tipTile,
        { backgroundColor: on ? c.action : c.card, borderColor: on ? c.action : c.border },
      ]}
    >
      <Txt style={{ fontSize: 20, fontFamily: fonts.semibold, color: on ? c.onAction : c.text }}>{top}</Txt>
      <Txt style={{ fontSize: 13, color: on ? c.onAction : c.textMuted, fontVariant: ['tabular-nums'] }}>
        {bottom}
      </Txt>
    </Pressable>
  )

  return (
    <View style={styles.tipGrid}>
      {fromBill != null && fromBill > 0
        ? tile(
            'bill',
            value.kind === 'amount' && value.amount === fromBill,
            t('calc.tipFromBill'),
            formatMoney(fromBill),
            () => {
              setCustom('')
              onChange({ kind: 'amount', amount: fromBill })
            },
          )
        : null}
      {TIP_PRESETS.map((p) =>
        tile(
          String(p),
          value.kind === 'pct' && value.pct === p && !customOn,
          p === 0 ? t('calc.noTip') : `${p}%`,
          formatMoney(tipAmount(base, { kind: 'pct', pct: p })),
          () => {
            setCustom('')
            onChange({ kind: 'pct', pct: p })
          },
        ),
      )}
      <View
        style={[
          styles.tipTile,
          { backgroundColor: customOn ? c.action : c.card, borderColor: customOn ? c.action : c.border },
        ]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
          <TextInput
            value={custom}
            onChangeText={(s) => {
              const clean = s.replace(/[^0-9.,]/g, '')
              setCustom(clean)
              onChange({ kind: 'pct', pct: clean ? num(clean) : 0 })
            }}
            keyboardType="decimal-pad"
            placeholder={t('calc.custom')}
            placeholderTextColor={customOn ? c.onAction : c.textMuted}
            style={{
              minWidth: 44,
              fontSize: 20,
              fontFamily: fonts.semibold,
              textAlign: 'center',
              color: customOn ? c.onAction : c.text,
              paddingVertical: 0,
            }}
          />
          {custom ? (
            <Txt style={{ fontSize: 20, fontFamily: fonts.semibold, color: c.onAction }}>%</Txt>
          ) : null}
        </View>
        <Txt style={{ fontSize: 13, color: customOn ? c.onAction : c.textMuted, fontVariant: ['tabular-nums'] }}>
          {customOn ? formatMoney(tipAmount(base, value)) : t('calc.customPct')}
        </Txt>
      </View>
    </View>
  )
}

// ── Summary rows ─────────────────────────────────────────────────────────────

/** A summary line you can tap to jump back to the step that set it. */
export function EditRow({
  label,
  value,
  onPress,
  first,
}: {
  label: string
  value: string
  onPress: () => void
  first?: boolean
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('common.editName', { name: label })}
      onPress={onPress}
      style={({ pressed }) => [
        styles.editRow,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
        pressed && { backgroundColor: c.cardActive },
      ]}
    >
      <Txt variant="muted" style={{ flex: 1 }}>
        {label}
      </Txt>
      <Txt style={{ fontFamily: fonts.semibold, color: c.text, fontVariant: ['tabular-nums'] }}>{value}</Txt>
      <Pencil size={16} color={c.accent} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  moneyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: sp.xs,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: sp.xl,
    paddingHorizontal: sp.lg,
  },
  counter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: sp.xl },
  round: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickRow: { flexDirection: 'row', gap: sp.sm, justifyContent: 'center' },
  quick: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  tipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm },
  tipTile: {
    width: '31.5%',
    flexGrow: 1,
    minHeight: 76,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: sp.xs,
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.sm,
    paddingHorizontal: sp.lg,
    paddingVertical: 14,
  },
})
