// The Home's colour language (2026-11 "Comando" redesign). Each app owns a
// vivid two-stop gradient, the same in light and dark — icons are identity,
// like a phone's home screen, and they're what lets the grid be scanned by
// colour. Everything AROUND them follows the theme, so light (the default) and
// dark both work.
export type Gradient = readonly [string, string]

export const APP_GRADIENT: Record<string, Gradient> = {
  calendar: ['#FF5F6D', '#FF2E63'],
  shopping: ['#FFC93C', '#FF9A1F'],
  budget: ['#2BD99A', '#0FA37F'],
  pets: ['#FF9B6A', '#F2603A'],
  pings: ['#6E8BFF', '#4A5BF5'],
  location: ['#38D1F5', '#1E8EF0'],
  family: ['#C083FF', '#8B4DF2'],
  docs: ['#8E9AAF', '#5B667A'],
  calc: ['#5AD1C8', '#2A9D9F'],
  admin: ['#7C7C86', '#45454D'],
}

/** "Today" cards: deeper versions, since white text sits on them at length. */
export const CARD_GRADIENT = {
  event: ['#F0566A', '#C9356A'] as Gradient,
  birthday: ['#B06CF5', '#7A3FE0'] as Gradient,
  pet: ['#F98345', '#DD4B3D'] as Gradient,
  weather: ['#3E7BFA', '#5B4CF0'] as Gradient,
}

/** Money: each budget card gets its own deep gradient (by position), so two
 *  budgets read as two things at a glance. Deep enough for white text. The
 *  third stop is the ink used for text on a white button sitting on it. */
// No greens, reds or oranges: those mean received/spent inside the card.
export const BUDGET_GRADIENTS: readonly { colors: Gradient; ink: string }[] = [
  { colors: ['#4C7BF4', '#4A4FD8'], ink: '#3A42B8' },
  { colors: ['#A065F0', '#7140D6'], ink: '#5E33B8' },
  { colors: ['#1FA9C9', '#1A73B8'], ink: '#165F99' },
  { colors: ['#3D4FB8', '#26307E'], ink: '#26307E' },
  { colors: ['#9A4FC0', '#62308E'], ink: '#62308E' },
]

/** A budget's gradient, stable for its id — the same on the Money list, the
 *  period list and the period itself, however the budgets are ordered. */
export function budgetLook(id: string): (typeof BUDGET_GRADIENTS)[number] {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return BUDGET_GRADIENTS[h % BUDGET_GRADIENTS.length]
}

/** Darken (amt < 0) or lighten (amt > 0) a #rrggbb colour — for a gradient's
 *  second stop from one brand colour (a pet's tag colour, say). */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16)
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)))
  const r = ch((n >> 16) & 255)
  const g = ch((n >> 8) & 255)
  const b = ch(n & 255)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}
