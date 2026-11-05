// Better deal: compare two options by price-per-unit; highlight the cheaper one.
//
// UX note: the unit is ONLY a label. The winner is decided by price ÷ amount for
// each side (both assumed in the same unit), so switching kg↔lb never changes
// which is cheaper. To make that obvious we (1) attach the unit to the amount
// input as a suffix (it reads as part of the quantity, not a calc input),
// (2) reframe the selector as "Compare price per", and (3) say outright it won't
// change the result. The per-unit prices and the verdict are on the shelf
// illustration (ProductShelf); the card below holds only the inputs.
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'

import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { fonts, radius, sp, useTheme } from '@/theme/theme'

import { formatPerUnit, num } from './shared'
import { ProductShelf } from './ProductShelf'

const UNITS = ['kg', 'g', 'lb', 'oz', 'L', 'mL', 'each']

// One offer as a column under its container on the shelf: "Offer A" with
// its badge (green when it wins), then Price and Amount, each labelled with
// the number centred. Columns rather than rows so A and B line up with the
// two containers above (2026-11: a row per option, uncentred and unlabelled,
// read as a spreadsheet the user had to decode).
//
// Hoisted to module scope: defined inside BetterDeal's render it would be a
// new component type on every keystroke, remounting the TextInputs and
// dropping keyboard focus mid-type.
function OfferColumn({
  side,
  price,
  setPrice,
  qty,
  setQty,
  unitLabel,
  isWinner,
}: {
  side: 'A' | 'B'
  price: string
  setPrice: (s: string) => void
  qty: string
  setQty: (s: string) => void
  unitLabel: string
  isWinner: boolean
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  return (
    <View
      style={[
        styles.offer,
        // Same 2pt border either way, so the winner doesn't grow taller than its pair.
        { backgroundColor: c.card, borderColor: isWinner ? c.income : 'transparent', borderWidth: 2 },
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        <View style={[styles.letter, { backgroundColor: isWinner ? c.income : c.accentSoft }]}>
          <Txt style={{ fontFamily: fonts.semibold, fontSize: 12, color: isWinner ? '#ffffff' : c.accent }}>{side}</Txt>
        </View>
        <Txt style={{ fontFamily: fonts.semibold, fontSize: 15, color: c.text }}>
          {t('calc.offer', { side })}
        </Txt>
      </View>

      <View style={{ gap: 4 }}>
        <Txt style={[styles.fieldLabel, { color: c.textMuted }]}>{t('calc.price')}</Txt>
        <View style={[styles.field, { backgroundColor: c.surface }]}>
          <Txt style={{ color: price ? c.text : c.textFaint, fontFamily: fonts.semibold, fontSize: 17 }}>$</Txt>
          <TextInput
            value={price}
            onChangeText={setPrice}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={c.textFaint}
            style={[styles.fieldInput, { color: c.text }]}
          />
        </View>
      </View>

      <View style={{ gap: 4 }}>
        <Txt style={[styles.fieldLabel, { color: c.textMuted }]}>{t('calc.amount')}</Txt>
        <View style={[styles.field, { backgroundColor: c.surface }]}>
          <TextInput
            value={qty}
            onChangeText={setQty}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={c.textFaint}
            style={[styles.fieldInput, { color: c.text }]}
          />
          <Txt style={{ color: c.textMuted, fontSize: 14, fontFamily: fonts.semibold }}>{unitLabel}</Txt>
        </View>
      </View>
    </View>
  )
}

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

  return (
    <View style={{ gap: sp.md }}>
      {/* What this tool is, in one line — the screen used to start straight
          at "Compare price per" and left people guessing. */}
      <Txt style={{ fontSize: 16, lineHeight: 22, color: c.textMuted }}>{t('calc.dealIntro')}</Txt>

      {/* unit — a shared label, not a calc input */}
      <View>
        <Txt variant="label" style={{ color: c.textFaint }}>
          {t('calc.perUnit')}
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
                style={[styles.unitChip, { backgroundColor: active ? c.action : c.surface }]}
              >
                <Txt style={{ fontSize: 14, fontWeight: '700', color: active ? c.onAction : c.textMuted }}>
                  {u === 'each' ? t('calc.unitEach') : u}
                </Txt>
              </Pressable>
            )
          })}
        </ScrollView>
        <Txt variant="faint" style={{ marginTop: sp.sm }}>
          {t('calc.unitNote')}
        </Txt>
      </View>

      {/* The same product, small vs big container, resizing as amounts are
          typed; the cheaper-per-unit one gets the tag. */}
      <ProductShelf
        unit={unit}
        qtyA={num(qA)}
        qtyB={num(qB)}
        winner={winner}
        perUnitA={Number.isFinite(uA) ? `${formatPerUnit(uA)} / ${unitLabel}` : null}
        perUnitB={Number.isFinite(uB) ? `${formatPerUnit(uB)} / ${unitLabel}` : null}
        verdict={
          winner === 'tie'
            ? t('calc.tie')
            : both
              ? t('calc.cheaperBy', { side: winner === 'A' ? 'A' : 'B', pct })
              : null
        }
      />

      <View style={{ flexDirection: 'row', gap: sp.md }}>
        <OfferColumn side="A" price={pA} setPrice={setPA} qty={qA} setQty={setQA} unitLabel={unitLabel} isWinner={winner === 'A'} />
        <OfferColumn side="B" price={pB} setPrice={setPB} qty={qB} setQty={setQB} unitLabel={unitLabel} isWinner={winner === 'B'} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  offer: {
    flex: 1,
    borderRadius: radius.lg,
    padding: sp.md,
    gap: sp.md,
  },
  letter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldLabel: { fontSize: 12, textAlign: 'center' },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: radius.md,
    paddingHorizontal: sp.sm,
  },
  fieldInput: {
    flexShrink: 1,
    minWidth: 40,
    textAlign: 'center',
    paddingVertical: 11,
    fontSize: 20,
    fontFamily: fonts.semibold,
  },
  unitChip: {
    borderRadius: radius.sm,
    paddingHorizontal: sp.md,
    paddingVertical: 8,
  },
})
