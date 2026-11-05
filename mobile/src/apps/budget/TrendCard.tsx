// A budget's history at a glance (2026-11 Money rethink): received (green) vs
// spent (red) for its latest periods, oldest → newest, as paired bars. Tapping
// a pair opens that period. Under it, the average spent per period — the one
// number that says whether this month is normal.
import { Pressable, StyleSheet, View } from 'react-native'

import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { formatMoney } from '@/lib/format'
import { fonts, radius, sp, useTheme } from '@/theme/theme'

export interface TrendPoint {
  id: string
  /** Short axis label: "Jul", "12 Jul". */
  short: string
  income: number
  spent: number
  current: boolean
}

const BAR_H = 120

export function TrendCard({ points, onOpen }: { points: TrendPoint[]; onOpen: (id: string) => void }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const max = Math.max(1, ...points.flatMap((p) => [p.income, p.spent]))
  const avg = points.length ? points.reduce((sum, p) => sum + p.spent, 0) / points.length : 0
  return (
    <View style={[s.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
        <Txt style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 16 }}>{t('months.trendTitle')}</Txt>
        <Legend color={c.income} label={t('chart.received')} />
        <Legend color={c.expense} label={t('chart.spent')} />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: BAR_H + 22, marginTop: sp.lg }}>
        {points.map((p) => (
          <Pressable
            key={p.id}
            onPress={() => onOpen(p.id)}
            accessibilityRole="button"
            accessibilityLabel={p.short}
            style={({ pressed }) => [s.col, { opacity: pressed ? 0.6 : 1 }]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: BAR_H }}>
              <View style={[s.bar, { height: Math.max(3, (p.income / max) * BAR_H), backgroundColor: c.income }]} />
              <View style={[s.bar, { height: Math.max(3, (p.spent / max) * BAR_H), backgroundColor: c.expense }]} />
            </View>
            <Txt
              style={{
                marginTop: 6,
                fontSize: 12,
                color: p.current ? c.text : c.textFaint,
                fontFamily: p.current ? fonts.semibold : fonts.body,
              }}
              numberOfLines={1}
            >
              {p.short}
            </Txt>
          </Pressable>
        ))}
      </View>

      <View style={[s.avg, { borderTopColor: c.border }]}>
        <Txt variant="muted" style={{ flex: 1, fontSize: 13.5 }}>
          {t('months.avgSpent')}
        </Txt>
        <Txt style={{ fontFamily: fonts.semibold, fontSize: 15, color: c.expense, fontVariant: ['tabular-nums'] }}>
          {formatMoney(avg)}
        </Txt>
      </View>
    </View>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  const { c } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Txt style={{ fontSize: 12, color: c.textMuted }}>{label}</Txt>
    </View>
  )
}

const s = StyleSheet.create({
  card: { borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, padding: sp.lg },
  col: { flex: 1, alignItems: 'center' },
  bar: { width: 12, borderRadius: radius.sm / 2 },
  avg: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: sp.md,
    paddingTop: sp.md,
  },
})
