// Received / spent on a Money gradient card (budget card, period hero): label,
// amount and a bar against the larger of the two — in GREEN and RED (owner,
// 2026-11: the colours are the fastest read in the whole app, keep them). The
// chip is a solid panel ON the gradient so green/red stay legible on any
// budget's colour: white in light mode, a dark glass in dark mode.
import { StyleSheet, View } from 'react-native'

import { Txt } from '@/components/ui'
import { formatMoney } from '@/lib/format'
import { fonts, useTheme } from '@/theme/theme'

export function StatChip({ label, value, max, up }: { label: string; value: number; max: number; up?: boolean }) {
  const { c, dark } = useTheme()
  const tone = up ? c.income : c.expense
  return (
    <View style={[s.stat, { backgroundColor: dark ? 'rgba(12,13,17,0.42)' : '#FFFFFF' }]}>
      <Txt style={{ fontSize: 12, color: c.textMuted }} numberOfLines={1}>
        <Txt style={{ fontSize: 12, color: tone, fontFamily: fonts.semibold }}>{up ? '↑ ' : '↓ '}</Txt>
        {label}
      </Txt>
      <Txt
        adjustsFontSizeToFit
        numberOfLines={1}
        style={{ fontSize: 18, fontFamily: fonts.display, color: tone, fontVariant: ['tabular-nums'], marginTop: 2 }}
      >
        {formatMoney(value)}
      </Txt>
      <View style={[s.track, { backgroundColor: tone + '22' }]}>
        <View style={[s.fill, { backgroundColor: tone, width: `${Math.min(100, (value / Math.max(max, 1)) * 100)}%` }]} />
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  stat: { flex: 1, borderRadius: 16, padding: 12 },
  track: { height: 5, borderRadius: 3, marginTop: 8, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
})
