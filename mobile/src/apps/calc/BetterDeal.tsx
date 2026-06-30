// Better deal: compare two options by price per unit; highlight the cheaper one.
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { Check } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { radius, sp, useTheme } from '@/theme/theme'

import { formatPerUnit, num } from './shared'

const UNITS = ['kg', 'g', 'lb', 'oz', 'L', 'mL', 'each']

export function BetterDeal() {
  const { c } = useTheme()
  const { t } = useI18n()
  const [unit, setUnit] = useState('kg')
  const [pA, setPA] = useState('')
  const [qA, setQA] = useState('')
  const [pB, setPB] = useState('')
  const [qB, setQB] = useState('')

  const uA = num(qA) > 0 ? num(pA) / num(qA) : NaN
  const uB = num(qB) > 0 ? num(pB) / num(qB) : NaN
  const unitLabel = unit === 'each' ? t('calc.unitEach') : unit

  const both = Number.isFinite(uA) && Number.isFinite(uB)
  const winner = both ? (uA < uB ? 'A' : uB < uA ? 'B' : 'tie') : null
  const pct =
    both && winner !== 'tie' ? Math.round((Math.abs(uA - uB) / Math.max(uA, uB)) * 100) : 0

  const inputStyle = {
    flex: 1,
    backgroundColor: c.surface,
    borderRadius: radius.md,
    paddingHorizontal: sp.md,
    paddingVertical: 12,
    fontSize: 16,
    color: c.text,
  }

  function OptionCard({
    side,
    price,
    setPrice,
    qty,
    setQty,
    unitPrice,
  }: {
    side: 'A' | 'B'
    price: string
    setPrice: (s: string) => void
    qty: string
    setQty: (s: string) => void
    unitPrice: number
  }) {
    const isWinner = winner === side
    return (
      <View
        style={[
          styles.card,
          {
            backgroundColor: c.card,
            borderColor: isWinner ? c.income : 'transparent',
          },
        ]}
      >
        <View style={styles.cardHead}>
          <Txt style={{ fontSize: 14, fontWeight: '700', color: c.text }}>
            {side === 'A' ? t('calc.optionA') : t('calc.optionB')}
          </Txt>
          {isWinner && (
            <View style={[styles.badge, { backgroundColor: c.income }]}>
              <Check size={12} color="#ffffff" strokeWidth={2.5} />
              <Txt style={{ color: '#ffffff', fontSize: 11, fontWeight: '700' }}>
                {t('calc.betterDeal')}
              </Txt>
            </View>
          )}
        </View>
        <View style={{ flexDirection: 'row', gap: sp.sm }}>
          <TextInput
            value={price}
            onChangeText={setPrice}
            keyboardType="decimal-pad"
            placeholder={t('calc.price')}
            placeholderTextColor={c.textFaint}
            style={inputStyle}
          />
          <TextInput
            value={qty}
            onChangeText={setQty}
            keyboardType="decimal-pad"
            placeholder={t('calc.amount')}
            placeholderTextColor={c.textFaint}
            style={inputStyle}
          />
        </View>
        <Txt variant="muted" style={{ marginTop: sp.sm }}>
          {Number.isFinite(unitPrice) ? (
            <Txt style={{ fontWeight: '700', color: c.text }}>
              {formatPerUnit(unitPrice)} / {unitLabel}
            </Txt>
          ) : (
            '—'
          )}
        </Txt>
      </View>
    )
  }

  return (
    <View style={{ gap: sp.md }}>
      <View>
        <Txt variant="label" style={{ color: c.textFaint }}>
          {t('calc.unit')}
        </Txt>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: sp.sm, paddingTop: sp.sm, paddingRight: sp.lg }}
        >
          {UNITS.map((u) => {
            const active = unit === u
            return (
              <Pressable
                key={u}
                onPress={() => setUnit(u)}
                style={[styles.unitChip, { backgroundColor: active ? c.accent : c.surface }]}
              >
                <Txt style={{ fontSize: 14, fontWeight: '700', color: active ? '#ffffff' : c.textMuted }}>
                  {u === 'each' ? t('calc.unitEach') : u}
                </Txt>
              </Pressable>
            )
          })}
        </ScrollView>
      </View>

      <OptionCard side="A" price={pA} setPrice={setPA} qty={qA} setQty={setQA} unitPrice={uA} />
      <OptionCard side="B" price={pB} setPrice={setPB} qty={qB} setQty={setQB} unitPrice={uB} />

      {winner === 'tie' ? (
        <Txt variant="muted" style={{ textAlign: 'center', fontWeight: '600' }}>
          {t('calc.tie')}
        </Txt>
      ) : both ? (
        <Txt style={{ textAlign: 'center', fontWeight: '700', color: c.income }}>
          {t('calc.cheaperBy', { side: winner === 'A' ? 'A' : 'B', pct })}
        </Txt>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 2,
    padding: sp.md,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: sp.sm,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.pill,
    paddingHorizontal: sp.sm,
    paddingVertical: 2,
  },
  unitChip: {
    borderRadius: radius.sm,
    paddingHorizontal: sp.md,
    paddingVertical: 8,
  },
})
