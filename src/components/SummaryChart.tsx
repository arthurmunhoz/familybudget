import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import { categoryById } from '../lib/categories'
import { formatMoney } from '../lib/format'
import { useTheme } from '../hooks/useTheme'
import type { Entry } from '../lib/types'

export default function SummaryChart({ entries }: { entries: Entry[] }) {
  const { theme } = useTheme()
  const incomeColor = theme === 'dark' ? '#34d399' : '#059669'
  const expenseColor = theme === 'dark' ? '#fb7185' : '#e11d48'
  const barLabelColor = theme === 'dark' ? '#0c0a09' : '#ffffff'
  const tickColor = theme === 'dark' ? '#a8a29e' : '#57534e'
  const income = entries
    .filter((e) => e.type === 'income')
    .reduce((s, e) => s + Number(e.amount), 0)
  const spent = entries
    .filter((e) => e.type === 'expense')
    .reduce((s, e) => s + Number(e.amount), 0)
  const balance = income - spent

  const data = [
    { name: 'Received', value: income, color: incomeColor },
    { name: 'Spent', value: spent, color: expenseColor },
  ]

  const byCategory = new Map<string, number>()
  for (const e of entries) {
    if (e.type !== 'expense') continue
    byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + Number(e.amount))
  }
  const categories = [...byCategory.entries()].sort((a, b) => b[1] - a[1])
  const maxCat = categories[0]?.[1] ?? 0

  return (
    <div className="rounded-2xl bg-(--card) p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-(--text-muted)">Balance</span>
        <span
          className={`text-2xl font-bold tabular-nums ${
            balance >= 0 ? 'text-(--income)' : 'text-(--expense)'
          }`}
        >
          {formatMoney(balance)}
        </span>
      </div>

      <div className="mt-2 h-32">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 0, right: 8 }}>
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="name"
              width={72}
              axisLine={false}
              tickLine={false}
              tick={{ fill: tickColor, fontSize: 13 }}
            />
            <Bar dataKey="value" radius={[6, 6, 6, 6]} barSize={26} isAnimationActive={false}
              label={{
                position: 'insideRight',
                fill: barLabelColor,
                fontSize: 12,
                fontWeight: 700,
                formatter: (v) => (Number(v) > 0 ? formatMoney(Number(v)) : ''),
              }}
            >
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {categories.length > 0 && (
        <div className="mt-3 space-y-2">
          {categories.map(([catId, amount]) => {
            const cat = categoryById(catId)
            return (
              <div key={catId} className="flex items-center gap-2">
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
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
