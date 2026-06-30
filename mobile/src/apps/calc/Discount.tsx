// Discount: original price − pct → amount saved + final sale price.
import { useState } from 'react'
import { View } from 'react-native'

import { Card, Field, Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { formatMoney } from '@/lib/format'
import { sp, useTheme } from '@/theme/theme'

import { Divider, PercentPicker, ResultRow, num } from './shared'

export function Discount() {
  const { c } = useTheme()
  const { t } = useI18n()
  const [price, setPrice] = useState('')
  const [pct, setPct] = useState(20)

  const p = num(price)
  const save = (p * pct) / 100
  const final = p - save

  return (
    <View style={{ gap: sp.lg }}>
      <Field
        label={t('calc.original')}
        value={price}
        onChangeText={setPrice}
        keyboardType="decimal-pad"
        placeholder="0.00"
        autoFocus
      />
      <View>
        <Txt variant="label" style={{ color: c.textFaint }}>
          {t('calc.discountPct')} · {pct}%
        </Txt>
        <PercentPicker value={pct} onChange={setPct} presets={[10, 15, 20, 50]} />
      </View>
      <Card>
        <ResultRow label={t('calc.youSave')} value={`− ${formatMoney(save)}`} />
        <Divider />
        <ResultRow label={t('calc.finalPrice')} value={formatMoney(Math.max(0, final))} strong />
      </Card>
    </View>
  )
}
