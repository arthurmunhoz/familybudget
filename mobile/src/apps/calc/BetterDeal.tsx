// Better deal: compare two options by price-per-unit; highlight the cheaper one.
//
// UX note: the unit is ONLY a label. The winner is decided by price ÷ amount for
// each side (both assumed in the same unit), so switching kg↔lb never changes
// which is cheaper. To make that obvious we (1) attach the unit to the amount
// input as a suffix (it reads as part of the quantity, not a calc input),
// (2) reframe the selector as "Compare price per", and (3) say outright it won't
// change the result. The per-unit prices are on the shelf illustration
// (ProductShelf), the answer on DealVerdict, the inputs in the two cards.
//
// 2026-11 restyle after the photo frame: hero head + art, the unit as ONE
// SelectRow (seven options were a wall of chips), the tool's teal throughout,
// and a real "winner" moment (see ProductShelf + DealVerdict).
import { useState } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import { Ruler } from 'lucide-react-native'

import { FormSection, RowIcon, SelectRow } from '@/components/form'
import { GradientBox } from '@/components/home/GradientBox'
import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { fonts, sp, useTheme } from '@/theme/theme'

import { DealPending, DealVerdict } from './DealVerdict'
import { TOOL_LOOK } from './look'
import { formatPerUnit, num } from './shared'
import { ProductShelf } from './ProductShelf'
import { SectionLabel, ToolHero } from './ToolHead'

const UNITS = ['kg', 'g', 'lb', 'oz', 'L', 'mL', 'each'] as const
type Unit = (typeof UNITS)[number]
const LOOK = TOOL_LOOK.deal

// One offer as a column under its container on the shelf: "Offer A" with
// its badge (the tool's gradient when it wins), then Price and Amount, each
// labelled with the number centred. Columns rather than rows so A and B line
// up with the two containers above.
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
        // Same 1.5pt border either way, so the winner doesn't grow taller than its pair.
        isWinner
          ? { backgroundColor: LOOK.tint + '14', borderColor: LOOK.tint }
          : { backgroundColor: c.card, borderColor: c.border },
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        {isWinner ? (
          <GradientBox colors={LOOK.colors} radius={11} style={styles.letter}>
            <Txt style={{ fontFamily: fonts.semibold, fontSize: 12, color: '#fff' }}>{side}</Txt>
          </GradientBox>
        ) : (
          <View style={[styles.letter, { backgroundColor: c.surface2 }]}>
            <Txt style={{ fontFamily: fonts.semibold, fontSize: 12, color: c.textMuted }}>{side}</Txt>
          </View>
        )}
        <Txt style={{ fontFamily: fonts.semibold, fontSize: 15, color: isWinner ? LOOK.tint : c.text }}>
          {t('calc.offer', { side })}
        </Txt>
      </View>

      <View style={{ gap: 4 }}>
        <Txt style={[styles.fieldLabel, { color: c.textMuted }]}>{t('calc.price')}</Txt>
        <View style={[styles.field, { backgroundColor: c.surface2 }]}>
          <Txt style={{ color: price ? c.text : c.textFaint, fontFamily: fonts.display, fontSize: 18 }}>$</Txt>
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
        <View style={[styles.field, { backgroundColor: c.surface2 }]}>
          <TextInput
            value={qty}
            onChangeText={setQty}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={c.textFaint}
            style={[styles.fieldInput, { color: c.text }]}
          />
          <Txt style={{ color: LOOK.tint, fontSize: 14, fontFamily: fonts.semibold }}>{unitLabel}</Txt>
        </View>
      </View>
    </View>
  )
}

export function BetterDeal() {
  const { t } = useI18n()
  const [unit, setUnit] = useState<Unit>('kg')
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
  const per = (u: number) => `${formatPerUnit(u)} / ${unitLabel}`

  return (
    <View>
      <ToolHero kind="deal" title={t('calc.tool.unit')} subtitle={t('calc.deal.sub')} />

      {/* unit — a shared label, not a calc input */}
      <FormSection footer={t('calc.unitNote')}>
        <SelectRow
          label={t('calc.perUnit')}
          icon={<RowIcon Icon={Ruler} tint={LOOK.tint} />}
          value={unit}
          options={UNITS.map((u) => ({ value: u, label: u === 'each' ? t('calc.unitEach') : u }))}
          onChange={(v) => v && setUnit(v)}
        />
      </FormSection>

      {/* The same product, small vs big container, resizing as amounts are
          typed; the cheaper-per-unit one rises and takes the ribbon. */}
      <View style={{ marginTop: sp.xl }}>
        <ProductShelf
          unit={unit}
          qtyA={num(qA)}
          qtyB={num(qB)}
          winner={winner}
          perUnitA={Number.isFinite(uA) ? per(uA) : null}
          perUnitB={Number.isFinite(uB) ? per(uB) : null}
        />
      </View>

      <View style={{ marginTop: sp.md }}>
        {both && winner ? (
          <DealVerdict
            winner={winner}
            perUnit={{ A: uA, B: uB }}
            label={{ A: per(uA), B: per(uB) }}
            pct={pct}
            saving={formatPerUnit(Math.abs(uA - uB))}
            unitLabel={unitLabel}
          />
        ) : (
          <DealPending />
        )}
      </View>

      <SectionLabel style={{ marginTop: sp.xl }}>{t('calc.deal.offers')}</SectionLabel>
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
    borderRadius: 20,
    borderWidth: 1.5,
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
    borderRadius: 14,
    paddingHorizontal: sp.sm,
  },
  fieldInput: {
    flexShrink: 1,
    minWidth: 40,
    textAlign: 'center',
    paddingVertical: 11,
    fontSize: 22,
    fontFamily: fonts.display,
  },
})
