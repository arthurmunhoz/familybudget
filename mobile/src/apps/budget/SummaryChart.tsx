// Period summary for the Money module — RN port of the PWA's SummaryChart, with
// the Recharts pie replaced by plain Views. Shows the current balance (only
// past-dated entries count), received vs spent totals, an optional upcoming
// projection (coming in / due / expected), and a category breakdown of spending
// with proportional bars and a tap-to-expand subcategory drill-down.
import { useMemo, useState } from 'react'
import { Pressable, View } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import { Calendar, ChevronDown, ChevronRight, Hourglass } from 'lucide-react-native'

import { Card, Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { categoryById } from '@/lib/categories'
import { formatMoney, todayISO } from '@/lib/format'
import type { CustomCategory, Entry } from '@/lib/types'
import { radius, sp, useTheme } from '@/theme/theme'

export default function SummaryChart({
  entries,
  customCats = [],
}: {
  entries: Entry[]
  customCats?: CustomCategory[]
}) {
  const { t } = useI18n()
  const { c } = useTheme()
  const [expandedCat, setExpandedCat] = useState<string | null>(null)

  // Balance reflects only what has actually happened by today; future-dated
  // income/expenses surface in the "coming in" / "due" projection instead.
  const today = todayISO()

  const {
    income,
    spent,
    balance,
    comingIn,
    due,
    expected,
    hasUpcoming,
    categories,
    maxCat,
    bySub,
  } = useMemo(() => {
    const isPast = (e: Entry) => e.entry_date <= today
    let inc = 0
    let sp_ = 0
    let coming = 0
    let dueAmt = 0
    const byCategory = new Map<string, number>()
    const sub = new Map<string, Map<string, number>>()
    for (const e of entries) {
      const amt = Number(e.amount)
      const past = isPast(e)
      if (e.type === 'income') {
        if (past) inc += amt
        else coming += amt
        continue
      }
      // expense
      if (past) {
        sp_ += amt
        byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + amt)
        const key = e.subcategory?.trim() || ''
        if (!sub.has(e.category)) sub.set(e.category, new Map())
        const m = sub.get(e.category)!
        m.set(key, (m.get(key) ?? 0) + amt)
      } else {
        dueAmt += amt
      }
    }
    const bal = inc - sp_
    const cats = [...byCategory.entries()].sort((a, b) => b[1] - a[1])
    return {
      income: inc,
      spent: sp_,
      balance: bal,
      comingIn: coming,
      due: dueAmt,
      expected: bal + coming - dueAmt,
      hasUpcoming: coming > 0 || dueAmt > 0,
      categories: cats,
      maxCat: cats[0]?.[1] ?? 0,
      bySub: sub,
    }
  }, [entries, today])

  return (
    <Card style={{ gap: sp.md }}>
      {/* balance + received/spent donut */}
      <View style={{ flexDirection: 'row', gap: sp.lg, alignItems: 'center' }}>
        <View style={{ flex: 1, minWidth: 0, gap: sp.sm }}>
          <View>
            <Txt
              style={{
                fontSize: 11,
                fontWeight: '700',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                color: c.textFaint,
              }}
            >
              {t('chart.currentBalance')}
            </Txt>
            <Txt
              style={{
                marginTop: 2,
                fontSize: 26,
                fontWeight: '800',
                fontVariant: ['tabular-nums'],
                color: balance >= 0 ? c.income : c.expense,
              }}
            >
              {formatMoney(balance)}
            </Txt>
          </View>
          <View style={{ gap: 6 }}>
            <Legend color={c.income} label={t('chart.received')} value={formatMoney(income)} />
            <Legend color={c.expense} label={t('chart.spent')} value={formatMoney(spent)} />
          </View>
        </View>

        {(income > 0 || spent > 0) && (
          <Donut income={income} spent={spent} incomeColor={c.income} spentColor={c.expense} track={c.surface} />
        )}
      </View>

      {/* upcoming projection */}
      {hasUpcoming && (
        <View style={{ gap: 4, borderTopWidth: 1, borderTopColor: c.surface, paddingTop: sp.sm }}>
          {comingIn > 0 && (
            <ProjectionRow
              icon={<Hourglass size={14} color={c.textMuted} />}
              label={t('chart.comingIn')}
              value={`+${formatMoney(comingIn)}`}
              valueColor={c.income}
            />
          )}
          {due > 0 && (
            <ProjectionRow
              icon={<Calendar size={14} color={c.textMuted} />}
              label={t('chart.due')}
              value={`−${formatMoney(due)}`}
              valueColor={c.expense}
            />
          )}
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              borderTopWidth: 1,
              borderTopColor: c.surface,
              paddingTop: 4,
            }}
          >
            <Txt style={{ fontWeight: '700', fontSize: 13 }}>{t('chart.expected')}</Txt>
            <Txt
              style={{
                fontWeight: '700',
                fontSize: 13,
                fontVariant: ['tabular-nums'],
                color: expected >= 0 ? c.income : c.expense,
              }}
            >
              {formatMoney(expected)}
            </Txt>
          </View>
        </View>
      )}

      {/* category breakdown */}
      {categories.length > 0 && (
        <View style={{ gap: sp.sm, borderTopWidth: 1, borderTopColor: c.surface, paddingTop: sp.md }}>
          {categories.map(([catId, amount]) => {
            const cat = categoryById(catId, customCats)
            const subs = [...(bySub.get(catId)?.entries() ?? [])].sort((a, b) => b[1] - a[1])
            const hasSubs = subs.some(([k]) => k !== '')
            const expanded = expandedCat === catId
            const maxSub = subs[0]?.[1] ?? 0
            return (
              <View key={catId} style={{ gap: 6 }}>
                <Pressable
                  onPress={() => hasSubs && setExpandedCat(expanded ? null : catId)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}
                >
                  <Txt style={{ width: 24, textAlign: 'center', fontSize: 16 }}>{cat.icon}</Txt>
                  <View style={{ flex: 1, height: 8, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: c.surface }}>
                    <View
                      style={{
                        height: '100%',
                        borderRadius: radius.pill,
                        backgroundColor: c.accent,
                        width: `${maxCat > 0 ? (amount / maxCat) * 100 : 0}%`,
                      }}
                    />
                  </View>
                  <Txt
                    style={{
                      width: 78,
                      textAlign: 'right',
                      fontSize: 12,
                      fontVariant: ['tabular-nums'],
                      color: c.textMuted,
                    }}
                  >
                    {formatMoney(amount)}
                  </Txt>
                  <View style={{ width: 16, alignItems: 'center' }}>
                    {hasSubs ? (
                      expanded ? (
                        <ChevronDown size={14} color={c.textFaint} />
                      ) : (
                        <ChevronRight size={14} color={c.textFaint} />
                      )
                    ) : null}
                  </View>
                </Pressable>

                {expanded && (
                  <View style={{ marginLeft: 32, gap: 4, marginBottom: 4 }}>
                    {subs.map(([subName, subAmt]) => (
                      <View key={subName || '—'} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
                        <Txt
                          numberOfLines={1}
                          style={{ width: 84, fontSize: 11, color: c.textMuted }}
                        >
                          {subName || t('chart.unlabeled')}
                        </Txt>
                        <View style={{ flex: 1, height: 6, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: c.surface }}>
                          <View
                            style={{
                              height: '100%',
                              borderRadius: radius.pill,
                              backgroundColor: c.accent,
                              opacity: 0.6,
                              width: `${maxSub > 0 ? (subAmt / maxSub) * 100 : 0}%`,
                            }}
                          />
                        </View>
                        <Txt
                          style={{
                            width: 64,
                            textAlign: 'right',
                            fontSize: 11,
                            fontVariant: ['tabular-nums'],
                            color: c.textFaint,
                          }}
                        >
                          {formatMoney(subAmt)}
                        </Txt>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )
          })}
        </View>
      )}
    </Card>
  )
}

/** A 2-slice donut ring of received (income) vs spent — the RN equivalent of
 *  the PWA's Recharts pie. Income arc starts at 12 o'clock; spent follows it. */
function Donut({
  income,
  spent,
  incomeColor,
  spentColor,
  track,
}: {
  income: number
  spent: number
  incomeColor: string
  spentColor: string
  track: string
}) {
  const size = 76
  const stroke = 13
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const total = income + spent
  const incFrac = total > 0 ? income / total : 0
  const spFrac = total > 0 ? spent / total : 0
  const center = size / 2
  const rot = `rotate(-90 ${center} ${center})`
  return (
    <Svg width={size} height={size}>
      <Circle cx={center} cy={center} r={r} stroke={track} strokeWidth={stroke} fill="none" />
      {income > 0 && (
        <Circle
          cx={center}
          cy={center}
          r={r}
          stroke={incomeColor}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${incFrac * circ} ${circ}`}
          transform={rot}
        />
      )}
      {spent > 0 && (
        <Circle
          cx={center}
          cy={center}
          r={r}
          stroke={spentColor}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${spFrac * circ} ${circ}`}
          strokeDashoffset={-incFrac * circ}
          transform={rot}
        />
      )}
    </Svg>
  )
}

function Legend({ color, label, value }: { color: string; label: string; value: string }) {
  const { c } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Txt style={{ fontSize: 12, color: c.textMuted }}>{label}</Txt>
      <Txt
        style={{
          fontSize: 12,
          fontWeight: '700',
          fontVariant: ['tabular-nums'],
          color: c.text,
          marginLeft: 'auto',
          paddingLeft: sp.sm,
        }}
      >
        {value}
      </Txt>
    </View>
  )
}

function ProjectionRow({
  icon,
  label,
  value,
  valueColor,
}: {
  icon: React.ReactNode
  label: string
  value: string
  valueColor: string
}) {
  const { c } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {icon}
        <Txt style={{ fontSize: 12, color: c.textMuted }}>{label}</Txt>
      </View>
      <Txt style={{ fontSize: 12, fontVariant: ['tabular-nums'], color: valueColor }}>{value}</Txt>
    </View>
  )
}
