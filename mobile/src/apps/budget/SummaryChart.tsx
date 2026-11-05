// Period summary for the Money module — RN port of the PWA's SummaryChart, with
// the Recharts pie replaced by plain Views. Shows the current balance (only
// past-dated entries count) as a gradient hero in the budget's colours with
// received/spent chips, then an optional upcoming
// projection (coming in / due / expected), and a category breakdown of spending
// with proportional bars and a tap-to-expand subcategory drill-down.
import { useMemo, useState } from 'react'
import { Pressable, View } from 'react-native'
import { Calendar, ChevronDown, ChevronRight, Hourglass } from 'lucide-react-native'

import { Card, Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import type { Gradient } from '@/components/home/palette'
import { StatChip } from './StatChip'
import { useI18n } from '@/hooks/useI18n'
import { categoryById } from '@/lib/categories'
import { formatMoney, todayISO } from '@/lib/format'
import type { CategoryOverride, CustomCategory, Entry } from '@/lib/types'
import { fonts, radius, sp, useTheme } from '@/theme/theme'

export default function SummaryChart({
  entries,
  customCats = [],
  overrides = [],
  look,
}: {
  entries: Entry[]
  customCats?: CustomCategory[]
  overrides?: CategoryOverride[]
  /** The budget's gradient (budgetLook) for the balance hero. */
  look: Gradient
}) {
  const { t } = useI18n()
  const { c } = useTheme()
  const [expandedCat, setExpandedCat] = useState<string | null>(null)
  // The top few categories carry the story; the long tail waits behind a tap
  // so the entries aren't pushed off the screen.
  const [allCats, setAllCats] = useState(false)

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
    <>
    {/* balance hero, in the budget's colours (2026-11 Comando restyle) */}
    <GradientBox colors={look} radius={28} style={{ padding: 18, gap: 14 }}>
      <View>
        <Txt style={{ fontSize: 13, color: 'rgba(255,255,255,0.78)' }}>{t('chart.currentBalance')}</Txt>
        <Txt
          adjustsFontSizeToFit
          numberOfLines={1}
          style={{ fontSize: 40, lineHeight: 46, fontFamily: fonts.display, color: '#fff', fontVariant: ['tabular-nums'], letterSpacing: -0.6 }}
        >
          {formatMoney(balance)}
        </Txt>
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <StatChip label={t('chart.received')} value={income} max={Math.max(income, spent)} up />
        <StatChip label={t('chart.spent')} value={spent} max={Math.max(income, spent)} />
      </View>
    </GradientBox>

    {/* what's still coming this period */}
    {hasUpcoming ? (
      <Card style={{ gap: sp.sm }}>
        <View style={{ gap: 4 }}>
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
      </Card>
    ) : null}

    {/* where it went: one stacked bar, then each category with its share */}
    {categories.length > 0 ? (
      <Card style={{ gap: sp.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
          <Txt style={{ flex: 1, fontFamily: fonts.display, fontSize: 20 }}>{t('detail.whereItWent')}</Txt>
          <Txt style={{ fontFamily: fonts.semibold, fontSize: 15, color: c.expense, fontVariant: ['tabular-nums'] }}>
            {formatMoney(spent)}
          </Txt>
        </View>
        <View style={{ flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', gap: 2 }}>
          {categories.map(([catId, amount], i) => (
            <View key={catId} style={{ flex: amount, backgroundColor: catColor(i) }} />
          ))}
        </View>
        <View style={{ gap: 2 }}>
          {(allCats ? categories : categories.slice(0, TOP_CATS)).map(([catId, amount], i) => {
            const cat = categoryById(catId, customCats, overrides)
            const subs = [...(bySub.get(catId)?.entries() ?? [])].sort((x, y) => y[1] - x[1])
            const hasSubs = subs.some(([k]) => k !== '')
            const expanded = expandedCat === catId
            const maxSub = subs[0]?.[1] ?? 0
            const pct = spent > 0 ? Math.round((amount / spent) * 100) : 0
            return (
              <View key={catId}>
                <Pressable
                  onPress={() => hasSubs && setExpandedCat(expanded ? null : catId)}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: sp.md,
                    paddingVertical: 9,
                    opacity: pressed && hasSubs ? 0.6 : 1,
                  })}
                >
                  <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: catColor(i) + '24', alignItems: 'center', justifyContent: 'center' }}>
                    <Txt style={{ fontSize: 17 }}>{cat.icon}</Txt>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt style={{ fontFamily: fonts.medium, fontSize: 15 }} numberOfLines={1}>
                      {cat.name}
                    </Txt>
                    <View style={{ height: 4, borderRadius: 2, backgroundColor: c.surface, marginTop: 5, overflow: 'hidden' }}>
                      <View style={{ height: '100%', width: `${maxCat > 0 ? (amount / maxCat) * 100 : 0}%`, backgroundColor: catColor(i), borderRadius: 2 }} />
                    </View>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Txt style={{ fontFamily: fonts.semibold, fontSize: 15, fontVariant: ['tabular-nums'] }}>
                      {formatMoney(amount)}
                    </Txt>
                    <Txt variant="faint" style={{ fontSize: 12 }}>
                      {pct}%
                    </Txt>
                  </View>
                  <View style={{ width: 14, alignItems: 'center' }}>
                    {hasSubs ? (
                      expanded ? <ChevronDown size={14} color={c.textFaint} /> : <ChevronRight size={14} color={c.textFaint} />
                    ) : null}
                  </View>
                </Pressable>

                {expanded && (
                  <View style={{ marginLeft: 48, gap: 6, marginBottom: 8 }}>
                    {subs.map(([subName, subAmt]) => (
                      <View key={subName || '—'} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
                        <Txt numberOfLines={1} style={{ width: 96, fontSize: 12.5, color: c.textMuted }}>
                          {subName || t('chart.unlabeled')}
                        </Txt>
                        <View style={{ flex: 1, height: 5, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: c.surface }}>
                          <View
                            style={{
                              height: '100%',
                              borderRadius: radius.pill,
                              backgroundColor: catColor(i),
                              opacity: 0.7,
                              width: `${maxSub > 0 ? (subAmt / maxSub) * 100 : 0}%`,
                            }}
                          />
                        </View>
                        <Txt style={{ width: 70, textAlign: 'right', fontSize: 12, fontVariant: ['tabular-nums'], color: c.textMuted }}>
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
        {categories.length > TOP_CATS ? (
          <Pressable onPress={() => setAllCats((v) => !v)} hitSlop={6} style={{ alignSelf: 'center' }}>
            <Txt style={{ color: c.accent, fontFamily: fonts.semibold, fontSize: 14 }}>
              {allCats ? t('detail.showLess') : t('detail.showAllCats', { n: categories.length })}
            </Txt>
          </Pressable>
        ) : null}
      </Card>
    ) : null}
    </>
  )
}

/** Category colours for "where it went" — no greens or reds, which mean
 *  received/spent everywhere else in Money. */
const TOP_CATS = 5
const CAT_COLORS = ['#5B6CF0', '#F2A93B', '#2BB3C0', '#E0609B', '#8E6CF0', '#3D9BE9', '#B07A4F', '#7C8597']
function catColor(i: number): string {
  return CAT_COLORS[i % CAT_COLORS.length]
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
