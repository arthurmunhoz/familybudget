// Discount: original price − pct → the sale price you pay, with the original
// struck through and a green "Save $X · N%" badge. The discount is a big "N%
// OFF" readout with quick chips, a Custom field, and − / + fine-tuning.
import { useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { Tag } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { formatMoney } from '@/lib/format'
import { fonts, radius, sp, useTheme } from '@/theme/theme'

import { num } from './shared'

const CHIPS = [10, 15, 20, 50]

export function Discount() {
  const { c, dark } = useTheme()
  const { t } = useI18n()
  const [price, setPrice] = useState('')
  const [pct, setPct] = useState(20)
  const [custom, setCustom] = useState('')

  const p = num(price)
  const save = (p * pct) / 100
  const final = Math.max(0, p - save)
  const hasDeal = p > 0 && save > 0

  function pickChip(v: number) {
    setPct(v)
    setCustom('')
  }
  function onCustom(txt: string) {
    setCustom(txt)
    setPct(num(txt))
  }
  function adjust(delta: number) {
    setCustom('')
    setPct((cur) => Math.min(100, Math.max(0, Math.round(cur) + delta)))
  }

  const saveGreenBg = dark ? 'rgba(111,181,138,0.18)' : 'rgba(60,125,88,0.12)'

  return (
    <View style={{ gap: sp.lg }}>
      {/* Original price */}
      <View style={{ gap: 6 }}>
        <Txt variant="label">{t('calc.original')}</Txt>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: c.card,
            borderWidth: 1,
            borderColor: c.border,
            borderRadius: radius.md,
            paddingHorizontal: sp.md,
          }}
        >
          <Txt style={{ fontSize: 18, color: price ? c.text : c.textFaint }}>$</Txt>
          <TextInput
            value={price}
            onChangeText={setPrice}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={c.textFaint}
            autoFocus
            style={{
              flex: 1,
              paddingVertical: 12,
              paddingHorizontal: 8,
              fontSize: 18,
              color: c.text,
            }}
          />
          {price ? (
            <Pressable onPress={() => setPrice('')} hitSlop={8} accessibilityLabel={t('common.remove')}>
              <Txt variant="muted">✕</Txt>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Discount % — big readout + fine-tune, quick chips, custom */}
      <View style={{ gap: sp.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Txt style={{ fontFamily: fonts.display, fontSize: 22, color: c.accent }}>
            {pct}%{' '}
            <Txt style={{ fontSize: 13, color: c.accent, letterSpacing: 1 }}>{t('calc.off')}</Txt>
          </Txt>
          <View style={{ flexDirection: 'row', gap: sp.sm }}>
            <Pressable
              onPress={() => adjust(-1)}
              accessibilityLabel="−1%"
              style={{
                width: 34,
                height: 34,
                borderRadius: 17,
                backgroundColor: c.surface,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Txt style={{ fontSize: 20, fontWeight: '700', color: c.textMuted }}>−</Txt>
            </Pressable>
            <Pressable
              onPress={() => adjust(1)}
              accessibilityLabel="+1%"
              style={{
                width: 34,
                height: 34,
                borderRadius: 17,
                backgroundColor: c.surface,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Txt style={{ fontSize: 20, fontWeight: '700', color: c.textMuted }}>+</Txt>
            </Pressable>
          </View>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
          {CHIPS.map((v) => {
            const active = pct === v && custom === ''
            return (
              <Pressable
                key={v}
                onPress={() => pickChip(v)}
                style={{
                  flexGrow: 1,
                  minWidth: 56,
                  borderRadius: radius.sm,
                  paddingVertical: 8,
                  alignItems: 'center',
                  backgroundColor: active ? c.accent : c.surface,
                }}
              >
                <Txt style={{ fontWeight: '700', fontSize: 14, color: active ? '#ffffff' : c.textMuted }}>
                  {v}%
                </Txt>
              </Pressable>
            )
          })}
          <TextInput
            value={custom}
            onChangeText={onCustom}
            keyboardType="decimal-pad"
            placeholder={t('calc.custom')}
            placeholderTextColor={custom !== '' ? 'rgba(255,255,255,0.7)' : c.textFaint}
            style={{
              width: 80,
              borderRadius: radius.sm,
              paddingVertical: 8,
              textAlign: 'center',
              fontSize: 14,
              fontWeight: '700',
              backgroundColor: custom !== '' ? c.accent : c.surface,
              color: custom !== '' ? '#ffffff' : c.text,
            }}
          />
        </View>
      </View>

      {/* Result — the sale price is the hero */}
      <View style={{ backgroundColor: c.card, borderRadius: 16, padding: sp.lg, gap: sp.sm }}>
        <Txt
          variant="label"
          style={{ textTransform: 'uppercase', letterSpacing: 0.5, color: c.textFaint }}
        >
          {t('calc.youPay')}
        </Txt>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: sp.md, flexWrap: 'wrap' }}>
          <Txt
            style={{
              fontFamily: fonts.display,
              fontSize: 40,
              color: c.text,
              fontVariant: ['tabular-nums'],
            }}
          >
            {formatMoney(final)}
          </Txt>
          {hasDeal ? (
            <Txt
              style={{ fontSize: 16, color: c.textFaint, textDecorationLine: 'line-through' }}
            >
              {formatMoney(p)}
            </Txt>
          ) : null}
        </View>
        {hasDeal ? (
          <View
            style={{
              alignSelf: 'flex-start',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 5,
              backgroundColor: saveGreenBg,
              borderRadius: radius.pill,
              paddingHorizontal: 11,
              paddingVertical: 4,
            }}
          >
            <Tag size={14} color={c.income} />
            <Txt style={{ fontSize: 13, fontWeight: '600', color: c.income }}>
              {t('calc.savePill', { amount: formatMoney(save), pct })}
            </Txt>
          </View>
        ) : null}
      </View>
    </View>
  )
}
