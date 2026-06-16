// Shared pet-profile helpers: species list (id → emoji) and age from birthday.

export const SPECIES = [
  { id: 'dog', emoji: '🐶' },
  { id: 'cat', emoji: '🐱' },
  { id: 'bird', emoji: '🐦' },
  { id: 'rabbit', emoji: '🐰' },
  { id: 'fish', emoji: '🐠' },
  { id: 'reptile', emoji: '🦎' },
  { id: 'small', emoji: '🐹' },
  { id: 'horse', emoji: '🐴' },
  { id: 'other', emoji: '🐾' },
] as const

export function speciesEmoji(id: string | null): string {
  return SPECIES.find((s) => s.id === id)?.emoji ?? '🐾'
}

/** Whole months between a birthday and today (ISO YYYY-MM-DD). */
export function ageInMonths(birthday: string, today: string): number {
  const [by, bm, bd] = birthday.split('-').map(Number)
  const [ty, tm, td] = today.split('-').map(Number)
  let months = (ty - by) * 12 + (tm - bm)
  if (td < bd) months--
  return months
}
