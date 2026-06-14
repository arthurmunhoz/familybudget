import { categoryById } from '../../lib/categories'
import { formatMoney } from '../../lib/format'
import { useI18n } from '../../hooks/useI18n'
import type { TKey } from '../../lib/i18n'
import type { Entry, Profile } from '../../lib/types'

// Distinct, saturated hues that read well on both the dark and light card.
// Up to 6 members (the household cap) each get a stable color.
const MEMBER_COLORS = ['#2563eb', '#f59e0b', '#10b981', '#ec4899', '#8b5cf6', '#ef4444']

/** Compact money for tiny bar labels: "$120" / "$1.2k". */
function compactMoney(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`
  return `$${Math.round(n)}`
}

/**
 * Per-category spending broken down by family member. Each category is a row;
 * within it a vertical bar per member shows how much they spent. Bar heights
 * share one global scale so they're comparable across categories. Replaces the
 * old two-column "Split" view, which didn't scale past two members.
 */
export default function MemberCategoryChart({
  entries,
  profiles,
}: {
  entries: Entry[]
  profiles: Profile[]
}) {
  const { t } = useI18n()
  // Stable color assignment regardless of the order profiles arrive in.
  const members = [...profiles].sort((a, b) => a.email.localeCompare(b.email))
  const colorOf = (email: string) => {
    const i = members.findIndex((m) => m.email === email)
    return MEMBER_COLORS[(i < 0 ? 0 : i) % MEMBER_COLORS.length]
  }

  // category -> (member -> amount), plus per-member grand totals.
  const byCat = new Map<string, Map<string, number>>()
  const memberTotals = new Map<string, number>()
  for (const e of entries) {
    if (e.type !== 'expense') continue
    if (!byCat.has(e.category)) byCat.set(e.category, new Map())
    const m = byCat.get(e.category)!
    m.set(e.person_email, (m.get(e.person_email) ?? 0) + Number(e.amount))
    memberTotals.set(e.person_email, (memberTotals.get(e.person_email) ?? 0) + Number(e.amount))
  }

  const cats = [...byCat.entries()]
    .map(([catId, m]) => ({
      catId,
      members: m,
      total: [...m.values()].reduce((s, v) => s + v, 0),
    }))
    .sort((a, b) => b.total - a.total)

  // Largest single member-category amount: the 100%-height reference.
  let globalMax = 0
  for (const c of cats) for (const v of c.members.values()) globalMax = Math.max(globalMax, v)

  if (cats.length === 0) {
    return (
      <p className="mt-6 text-center text-sm text-(--text-faint)">
        {t('detail.noCompare')}
      </p>
    )
  }

  const BAR_AREA = 56 // px — the height a 100% bar fills

  return (
    <div className="mt-3 space-y-3">
      {/* legend: who is which color, with their grand total */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-2xl bg-(--card) p-3">
        {members.map((m) => (
          <div key={m.email} className="flex items-center gap-1.5 text-xs">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: colorOf(m.email) }}
            />
            <span className="font-medium text-(--text)">{m.display_name}</span>
            <span className="tabular-nums text-(--text-faint)">
              {formatMoney(memberTotals.get(m.email) ?? 0)}
            </span>
          </div>
        ))}
      </div>

      {/* one row per category, sorted by total spend */}
      <div className="space-y-2">
        {cats.map(({ catId, members: catMembers, total }) => {
          const cat = categoryById(catId)
          return (
            <div key={catId} className="rounded-2xl bg-(--card) p-3">
              <div className="flex items-center gap-2">
                <span className="text-base">{cat.icon}</span>
                <span className="flex-1 text-sm font-semibold text-(--text)">
                  {t(`cat.${cat.id}` as TKey)}
                </span>
                <span className="text-xs tabular-nums text-(--text-muted)">
                  {formatMoney(total)}
                </span>
              </div>
              <div className="mt-2 flex items-end justify-around gap-1.5" style={{ height: BAR_AREA + 14 }}>
                {members.map((m) => {
                  const amt = catMembers.get(m.email) ?? 0
                  const barH = amt > 0 ? Math.max(4, (amt / globalMax) * BAR_AREA) : 2
                  return (
                    <div
                      key={m.email}
                      className="flex flex-1 flex-col items-center justify-end gap-0.5"
                    >
                      {amt > 0 && (
                        <span className="text-[9px] leading-none tabular-nums text-(--text-faint)">
                          {compactMoney(amt)}
                        </span>
                      )}
                      <div
                        className="w-full max-w-10 rounded-t"
                        style={{
                          height: barH,
                          background: amt > 0 ? colorOf(m.email) : 'var(--surface)',
                        }}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
