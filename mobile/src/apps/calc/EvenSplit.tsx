// Split a bill evenly: bill amount + tip % + number of people → per-person total.
import { useState } from 'react'
import { TextInput, View } from 'react-native'

import { Card, Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { formatMoney } from '@/lib/format'
import { sp, useTheme } from '@/theme/theme'

import { Divider, PercentPicker, ResultRow, Stepper, num } from './shared'

export function EvenSplit() {
  const { c } = useTheme()
  const { t } = useI18n()
  const [bill, setBill] = useState('')
  const [tipPct, setTipPct] = useState(20)
  const [people, setPeople] = useState(2)

  const b = num(bill)
  const tip = (b * tipPct) / 100
  const total = b + tip
  const per = total / Math.max(1, people)

  return (
    <View style={{ gap: sp.lg }}>
      {/* Bill amount hero input */}
      <View style={{ alignItems: 'center', paddingBottom: sp.xs }}>
        <Txt
          variant="label"
          style={{ textTransform: 'uppercase', letterSpacing: 0.5, color: c.textFaint }}
        >
          {t('calc.bill')}
        </Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.xs, marginTop: sp.xs }}>
          {/* Match the amount's state so the symbol and number read as ONE
              figure — a grey $ beside a near-black number looked like the
              amount itself was greyed out. */}
          <Txt style={{ fontSize: 32, fontWeight: '600', color: bill ? c.text : c.textFaint }}>$</Txt>
          <TextInput
            value={bill}
            onChangeText={setBill}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={c.textFaint}
            autoFocus
            style={{
              minWidth: 140,
              fontSize: 44,
              fontWeight: '700',
              letterSpacing: -1,
              textAlign: 'center',
              color: c.text,
            }}
          />
        </View>
      </View>

      <View>
        <Txt variant="label" style={{ color: c.textFaint }}>
          {t('calc.tipPct')} · {tipPct}%
        </Txt>
        <PercentPicker value={tipPct} onChange={setTipPct} presets={[18, 20, 22]} />
      </View>

      <View>
        <Txt variant="label" style={{ color: c.textFaint }}>
          {t('calc.split')}
        </Txt>
        <Stepper
          label={t('calc.people', { count: people })}
          onDec={() => setPeople((p) => Math.max(1, p - 1))}
          onInc={() => setPeople((p) => p + 1)}
        />
      </View>

      <Card>
        <ResultRow label={t('calc.tipAmount')} value={formatMoney(tip)} />
        <ResultRow label={t('calc.total')} value={formatMoney(total)} />
        <Divider />
        <ResultRow label={t('calc.perPerson')} value={formatMoney(per)} strong />
      </Card>
    </View>
  )
}
