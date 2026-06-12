const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

export function formatMoney(amount: number): string {
  return usd.format(amount)
}

/** "06/26" for June 2026 */
export function monthLabel(year: number, month: number): string {
  return `${String(month).padStart(2, '0')}/${String(year).slice(2)}`
}

export function monthName(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })
}

/** "Jun 9" from "2026-06-09" */
export function formatDay(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

export function todayISO(): string {
  const now = new Date()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${m}-${d}`
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}
