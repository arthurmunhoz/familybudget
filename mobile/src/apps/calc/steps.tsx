// Answer controls for the wizard steps — big, thumb-sized versions of the old
// form widgets: a hero money field, a people counter, a tip grid, and the
// tappable "edit this" rows the summary steps are built from.
import { useState, type ReactNode } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import Animated, { Easing, FadeInDown, ZoomIn } from 'react-native-reanimated'
import { Minus, Pencil, Plus, type LucideIcon } from 'lucide-react-native'

import { RowIcon } from '@/components/form'
import { GradientBox } from '@/components/home/GradientBox'
import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { formatMoney } from '@/lib/format'
import { fonts, sp, useTheme } from '@/theme/theme'

import { useToolLook } from './look'
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
  const { look } = useToolLook()
  return (
    <View
      style={[
        styles.moneyBox,
        // Typed = outlined in the tool's colour, the frame's "selected" look.
        value
          ? { backgroundColor: look.tint + '12', borderColor: look.tint, borderWidth: 1.5 }
          : { backgroundColor: c.card, borderColor: c.border, borderWidth: StyleSheet.hairlineWidth },
      ]}
    >
      {/* The symbol follows the amount's state so the two read as ONE figure —
          a grey $ beside a dark number looked like the amount was greyed out. */}
      <Txt style={{ fontSize: 34, fontFamily: fonts.display, color: value ? look.tint : c.textFaint }}>$</Txt>
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
          fontSize: 52,
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
  const { look } = useToolLook()
  return (
    <View style={{ gap: sp.xl }}>
      <View style={[styles.counterCard, { backgroundColor: c.card, borderColor: c.border }]}>
        <RoundBtn onPress={() => onChange(Math.max(1, value - 1))} disabled={value <= 1} label="−">
          <Minus size={26} color={look.tint} />
        </RoundBtn>
        <View style={{ alignItems: 'center', minWidth: 110 }}>
          {/* the number re-enters on every change: a small zoom, not a jump */}
          <Animated.View key={value} entering={ZoomIn.duration(220).easing(Easing.bezier(0.2, 0, 0, 1))}>
            <Txt style={{ fontSize: 72, fontFamily: fonts.display, color: look.tint, lineHeight: 80 }}>{value}</Txt>
          </Animated.View>
          <Txt style={{ fontFamily: fonts.display, fontSize: 18, color: c.textFaint }}>{t('calc.peopleWord', { count: value })}</Txt>
        </View>
        <RoundBtn onPress={() => onChange(Math.min(99, value + 1))} label="+">
          <Plus size={26} color={look.tint} />
        </RoundBtn>
      </View>
      <View style={styles.quickRow}>
        {QUICK_PEOPLE.map((n) => {
          const on = n === value
          return (
            <Pressable
              key={n}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => onChange(n)}
              style={[
                styles.quick,
                on
                  ? { backgroundColor: look.tint + '1F', borderColor: look.tint, borderWidth: 1.5 }
                  : { backgroundColor: c.card, borderColor: c.border, borderWidth: StyleSheet.hairlineWidth },
              ]}
            >
              <Txt style={{ fontFamily: fonts.semibold, fontSize: 17, color: on ? look.tint : c.text }}>{n}</Txt>
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
        { backgroundColor: pressed ? c.cardActive : c.surface2, opacity: disabled ? 0.4 : 1 },
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
  const { look } = useToolLook()
  const onBg = look.tint + '1F'
  const isPreset = value.kind === 'pct' && TIP_PRESETS.includes(value.pct)
  const [custom, setCustom] = useState(
    value.kind === 'pct' && !isPreset ? String(value.pct) : '',
  )
  const customOn = value.kind === 'pct' && !isPreset

  const tile = (key: string, on: boolean, top: string, bottom: string, onPress: () => void) => (
    <Pressable
      key={key}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      style={[
        styles.tipTile,
        on
          ? { backgroundColor: onBg, borderColor: look.tint, borderWidth: 1.5 }
          : { backgroundColor: c.card, borderColor: c.border, borderWidth: StyleSheet.hairlineWidth },
      ]}
    >
      <Txt style={{ fontSize: 22, fontFamily: fonts.display, color: on ? look.tint : c.text }}>{top}</Txt>
      <Txt style={{ fontSize: 13, color: on ? look.tint : c.textMuted, fontVariant: ['tabular-nums'] }}>
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
          customOn
            ? { backgroundColor: onBg, borderColor: look.tint, borderWidth: 1.5 }
            : { backgroundColor: c.card, borderColor: c.border, borderWidth: StyleSheet.hairlineWidth },
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
            placeholderTextColor={c.textMuted}
            style={{
              minWidth: 44,
              fontSize: 22,
              fontFamily: fonts.display,
              textAlign: 'center',
              color: customOn ? look.tint : c.text,
              paddingVertical: 0,
            }}
          />
          {custom ? (
            <Txt style={{ fontSize: 22, fontFamily: fonts.display, color: customOn ? look.tint : c.text }}>%</Txt>
          ) : null}
        </View>
        <Txt style={{ fontSize: 13, color: customOn ? look.tint : c.textMuted, fontVariant: ['tabular-nums'] }}>
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
  icon,
}: {
  label: string
  value: string
  onPress: () => void
  first?: boolean
  /** The row's tile, tinted in the tool's colour. */
  icon?: LucideIcon
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const { look } = useToolLook()
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
      {icon ? <RowIcon Icon={icon} tint={look.tint} /> : null}
      <Txt style={{ flex: 1, fontSize: 15, color: c.text }}>{label}</Txt>
      <Txt style={{ fontFamily: fonts.semibold, color: c.text, fontVariant: ['tabular-nums'] }}>{value}</Txt>
      <Pencil size={15} color={look.tint} />
    </Pressable>
  )
}

// ── Result hero ──────────────────────────────────────────────────────────────

/** The answer, the way the app shows a headline number: a gradient card in
 *  the tool's colours, white type. It rises in once when the result screen
 *  opens (Reanimated's entering skips itself under Reduce Motion). */
export function ResultHero({
  kicker,
  amount,
  children,
}: {
  kicker: string
  amount: string
  children?: ReactNode
}) {
  const { look } = useToolLook()
  return (
    <Animated.View entering={FadeInDown.duration(420).easing(Easing.bezier(0.2, 0, 0, 1))}>
      <GradientBox colors={look.colors} radius={24} style={styles.hero}>
        <Txt style={styles.heroKicker}>{kicker}</Txt>
        <Animated.View entering={ZoomIn.delay(160).duration(380).easing(Easing.bezier(0.2, 0, 0, 1))}>
          <Txt style={styles.heroAmount}>{amount}</Txt>
        </Animated.View>
        {children}
      </GradientBox>
    </Animated.View>
  )
}

/** A white line on the result hero. */
export function HeroLine({ children, faint }: { children: string; faint?: boolean }) {
  return (
    <Txt style={{ color: '#fff', opacity: faint ? 0.75 : 0.92, fontSize: faint ? 13 : 15, textAlign: 'center' }}>{children}</Txt>
  )
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingVertical: sp.xl, paddingHorizontal: sp.lg, gap: 4 },
  heroKicker: { color: '#fff', opacity: 0.85, fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase' },
  heroAmount: { color: '#fff', fontFamily: fonts.display, fontSize: 56, lineHeight: 64, letterSpacing: -1, fontVariant: ['tabular-nums'] },
  counterCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: sp.lg,
    paddingHorizontal: sp.lg,
  },
  moneyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: sp.xs,
    borderRadius: 24,
    paddingVertical: sp.xl,
    paddingHorizontal: sp.lg,
  },
  round: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickRow: { flexDirection: 'row', gap: sp.sm, justifyContent: 'center' },
  quick: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  tipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm },
  tipTile: {
    width: '31.5%',
    flexGrow: 1,
    minHeight: 78,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: sp.xs,
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.md,
    paddingHorizontal: sp.md,
    minHeight: 54,
  },
})
