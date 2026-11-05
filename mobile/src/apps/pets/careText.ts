// Plain-text helpers shared by Pet Care's cards and sheets (kept out of the
// component files so Fast Refresh stays happy).
import type { useI18n } from '@/hooks/useI18n'

type T = ReturnType<typeof useI18n>['t']

/** "every 7d" for short cycles; months and years for long ones ("every 6
 *  months", "every year") — 183d reads as nothing. */
export function everyLabel(days: number, t: T): string {
  const years = days / 365
  if (days >= 330 && Math.abs(years - Math.round(years)) < 0.08) {
    const n = Math.round(years)
    return n === 1 ? t('petcare.everyYear') : t('petcare.everyYears', { n })
  }
  if (days >= 28) {
    const n = Math.round(days / 30.44)
    return n <= 1 ? t('petcare.everyMonth') : t('petcare.everyMonths', { n })
  }
  return t('petcare.every', { days })
}

/** Quick cadence choices in the task editor (days). */
export const CADENCE_PRESETS = [
  { days: 7, key: 'petcare.preset.1w' },
  { days: 14, key: 'petcare.preset.2w' },
  { days: 30, key: 'petcare.preset.1m' },
  { days: 90, key: 'petcare.preset.3m' },
  { days: 182, key: 'petcare.preset.6m' },
  { days: 365, key: 'petcare.preset.1y' },
] as const
