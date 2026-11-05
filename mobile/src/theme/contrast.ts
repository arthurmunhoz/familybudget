// Foreground-on-a-coloured-fill contrast. Its own module (no imports) on
// purpose: both theme.ts and glass.tsx need it, and glass.tsx already takes a
// TYPE from theme.ts — importing a VALUE back the other way would make that
// cycle real.

/** Warm near-black used as the ink on a coloured fill. Matches the app's text
 *  tone rather than pure #000, which reads harsh on a saturated fill. */
export const INK = '#1B1A18'

function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h
  const parts = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
  const [r, g, b] = parts.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function ratio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * Which foreground actually reads on a given fill — white or the ink, whichever
 * has more contrast.
 *
 * This exists because white was hardcoded on every accent-filled control, which
 * is fine for the dark accents used in LIGHT mode but fails badly for the light,
 * vivid accents used in DARK mode: every dark accent landed at 2.2–3.0:1, below
 * AA even for large text. Flipping to ink lifts those to 5.7–8.0:1.
 *
 * Accent fills are pre-resolved as `c.onAccent` — anything painting text or
 * icons on `c.accent` must use that, never a literal, or a new scheme silently
 * reintroduces the bug. Call this directly only for fills the palette doesn't
 * pre-resolve: `c.income` / `c.expense` and the per-member colours both hit the
 * same failure (white is 2.4:1 on the dark-mode income green).
 */
export function pickOn(fill: string): string {
  try {
    return ratio(fill, '#FFFFFF') >= ratio(fill, INK) ? '#FFFFFF' : INK
  } catch {
    return '#FFFFFF'
  }
}

/**
 * The FILL for primary action buttons and selected controls: the accent,
 * darkened just enough that WHITE text on it clears AA (4.5:1). Pair it with
 * `c.onAction` (always white).
 *
 * Why not `accent` + `onAccent`: the brand accents are bright (sunset
 * #E2683F is 3.3:1 against white), so `pickOn` chose the dark ink and every
 * primary button read as brown-on-orange (user feedback, 2026-11). Deepening
 * the fill keeps the hue — it's still clearly the scheme's colour — and gets a
 * crisp white label in both modes.
 */
export function actionFill(accent: string): string {
  try {
    const h = accent.replace('#', '')
    let [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
    const hex = () => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
    for (let i = 0; i < 40 && ratio(hex(), '#FFFFFF') < 4.6; i++) {
      r *= 0.96
      g *= 0.96
      b *= 0.96
    }
    return hex().toUpperCase()
  } catch {
    return accent
  }
}
