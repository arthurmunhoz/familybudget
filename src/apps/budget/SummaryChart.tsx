import { useState } from 'react'
import { Cell, Pie, PieChart } from 'recharts'
import { categoryById } from '../../lib/categories'
import { formatMoney } from '../../lib/format'
import { useI18n } from '../../hooks/useI18n'
import { useTheme } from '../../hooks/useTheme'
import type { Entry } from '../../lib/types'

export default function SummaryChart({ entries }: { entries: Entry[] }) {
  const { t } = useI18n()
  const { theme } = useTheme()
  // Which category is drilled down to show its subcategory breakdown.
  const [expandedCat, setExpandedCat] = useState<string | null>(null)
  const incomeColor = theme === 'dark' ? '#34d399' : '#059669'
  const expenseColor = theme === 'dark' ? '#fb7185' : '#e11d48'
  const emptyColor = theme === 'dark' ? '#44403c' : '#e7e5e4'

  const income = entries
    .filter((e) => e.type === 'income')
    .reduce((s, e) => s + Number(e.amount), 0)
  const spent = entries
    .filter((e) => e.type === 'expense')
    .reduce((s, e) => s + Number(e.amount), 0)
  const balance = income - spent

  const hasData = income > 0 || spent > 0
  const pieData = hasData
    ? [
        { name: 'Received', value: income, color: incomeColor },
        { name: 'Spent', value: spent, color: expenseColor },
      ].filter((d) => d.value > 0)
    : [{ name: 'No entries', value: 1, color: emptyColor }]

  const byCategory = new Map<string, number>()
  // category → subcategory ('' = unlabeled) → amount, for the drill-down
  const bySub = new Map<string, Map<string, number>>()
  for (const e of entries) {
    if (e.type !== 'expense') continue
    byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + Number(e.amount))
    const sub = e.subcategory?.trim() || ''
    if (!bySub.has(e.category)) bySub.set(e.category, new Map())
    const m = bySub.get(e.category)!
    m.set(sub, (m.get(sub) ?? 0) + Number(e.amount))
  }
  const categories = [...byCategory.entries()].sort((a, b) => b[1] - a[1])
  const maxCat = categories[0]?.[1] ?? 0

  return (
    <div className="rounded-2xl bg-(--card) p-4">
      <div className="flex items-center gap-4">
        {/* balance */}
        <div className="flex flex-1 flex-col items-center justify-center">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-(--text-faint)">
            {t('common.balance')}
          </div>
          <div
            className={`mt-1 text-2xl font-bold tabular-nums ${
              balance >= 0 ? 'text-(--income)' : 'text-(--expense)'
            }`}
          >
            {formatMoney(balance)}
          </div>
        </div>

        {/* received vs spent pie with legend */}
        <div className="flex shrink-0 flex-col items-center">
          <PieChart width={88} height={88}>
            <Pie
              data={pieData}
              dataKey="value"
              cx="50%"
              cy="50%"
              outerRadius={42}
              strokeWidth={0}
              isAnimationActive={false}
            >
              {pieData.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
          </PieChart>
          <div className="mt-1.5 space-y-0.5 text-[11px] text-(--text-muted)">
            <div className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ background: incomeColor }}
              />
              {t('chart.received')}
              <span className="ml-auto pl-2 font-semibold tabular-nums">
                {formatMoney(income)}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ background: expenseColor }}
              />
              {t('chart.spent')}
              <span className="ml-auto pl-2 font-semibold tabular-nums">
                {formatMoney(spent)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {categories.length > 0 && (
        <hr className="mt-4 border-t border-(--surface)" />
      )}

      {categories.length > 0 && (
        <div className="mt-4 space-y-2">
          {categories.map(([catId, amount]) => {
            const cat = categoryById(catId)
            const subs = [...(bySub.get(catId)?.entries() ?? [])].sort(
              (a, b) => b[1] - a[1],
            )
            const hasSubs = subs.some(([k]) => k !== '')
            const expanded = expandedCat === catId
            const maxSub = subs[0]?.[1] ?? 0
            return (
              <div key={catId}>
                <button
                  onClick={() => hasSubs && setExpandedCat(expanded ? null : catId)}
                  className={`flex w-full items-center gap-2 ${
                    hasSubs ? 'active:opacity-70' : 'cursor-default'
                  }`}
                >
                  <span className="w-6 text-center">{cat.icon}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-(--surface)">
                    <div
                      className="h-full rounded-full bg-(--accent)"
                      style={{ width: `${(amount / maxCat) * 100}%` }}
                    />
                  </div>
                  <span className="w-20 text-right text-xs tabular-nums text-(--text-muted)">
                    {formatMoney(amount)}
                  </span>
                  <span className="w-3 text-[10px] text-(--text-faint)">
                    {hasSubs ? (expanded ? '▾' : '▸') : ''}
                  </span>
                </button>

                {expanded && (
                  <div className="mt-1.5 mb-1 ml-8 space-y-1">
                    {subs.map(([sub, subAmt]) => (
                      <div key={sub || '—'} className="flex items-center gap-2">
                        <span className="w-20 shrink-0 truncate text-[11px] text-(--text-muted)">
                          {sub || t('chart.unlabeled')}
                        </span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-(--surface)">
                          <div
                            className="h-full rounded-full bg-(--accent) opacity-60"
                            style={{ width: `${maxSub > 0 ? (subAmt / maxSub) * 100 : 0}%` }}
                          />
                        </div>
                        <span className="w-16 text-right text-[11px] tabular-nums text-(--text-faint)">
                          {formatMoney(subAmt)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
