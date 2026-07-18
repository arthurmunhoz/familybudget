// ── "Glass" skin (experimental restyle) ─────────────────────────────────────
// A reversible re-skin of the app: same layouts, new paint. Flip GLASS to false
// (or delete the `glass-skin` branch) to return 100% to Warm Hearth — nothing
// else references these tokens directly; theme.ts swaps them in when GLASS is on.
//
// It's NOT true frosted glass (that needs expo-blur, a native module + a
// prebuild — deliberately avoided so this stays flip-a-boolean reversible).
// Instead: a soft color wash painted behind everything with plain Views, plus
// translucent card tokens, so cards let the wash bleed through and read glassy.
import { Dimensions, View } from 'react-native'

import type { ThemeTokens } from './theme'

/** Master on/off. false = the app is exactly Warm Hearth again. */
export const GLASS = true

// Translucent surfaces (bg is transparent so the wash shows through). Kept in
// the same ThemeTokens shape so every screen picks them up with no edits.
export const glassLight: ThemeTokens = {
  bg: 'transparent',
  // Properly see-through — the wash's colour reads through the card, which is
  // what actually makes this look like glass. Panels that sit over DETAILED
  // content (a sheet on the map) use `sheet` instead, so they stay legible.
  card: 'rgba(255,255,255,0.66)',
  sheet: '#FBF4EC',
  cardActive: 'rgba(255,255,255,0.86)',
  surface: 'rgba(255,255,255,0.5)',
  surface2: 'rgba(255,255,255,0.36)',
  text: '#241F1B',
  textMuted: '#6B615A',
  // Darker than a "faint" grey normally would be: this text lands on a
  // translucent card over a warm wash, so the old #9A908A only reached 2.7:1.
  // 4.6:1 clears WCAG AA. (Applies to hints, placeholders and timestamps too.)
  textFaint: '#73695F',
  accent: '#E2683F',
  accentSoft: 'rgba(226,104,63,0.15)',
  income: '#1F9E68',
  expense: '#E4554A',
  border: 'rgba(60,45,38,0.12)',
}

export const glassDark: ThemeTokens = {
  bg: 'transparent',
  // See glassLight.card.
  card: 'rgba(32,33,42,0.62)',
  sheet: '#1B1C23',
  cardActive: 'rgba(46,48,60,0.82)',
  surface: 'rgba(255,255,255,0.10)',
  surface2: 'rgba(255,255,255,0.16)',
  text: '#F3EFEA',
  textMuted: '#A7A199',
  // See glassLight.textFaint — the old #726C64 only reached 3.1:1 on the dark
  // wash; this clears AA at 4.9:1.
  textFaint: '#948D84',
  accent: '#F2884F',
  accentSoft: 'rgba(242,136,79,0.20)',
  income: '#54C088',
  expense: '#EF6B62',
  border: 'rgba(255,255,255,0.12)',
}

// The color wash: a base fill plus three big, soft, low-opacity color fields in
// the corners. No gradient library — overlapping translucent circles read as a
// gentle wash behind the (transparent) screens. Rendered once, at the app root.
const { width: W, height: H } = Dimensions.get('window')
const BLOB = Math.max(W, H) * 0.95

// Punchier than a flat tint on purpose: with see-through cards, this colour IS
// the glass effect — the more variation behind a card, the more it reads as
// glass rather than as a slightly-grey panel.
const WASH = {
  light: {
    base: '#F7EFE6',
    blobs: [
      { color: '#FFC489', top: -BLOB * 0.35, left: -BLOB * 0.28, o: 0.72 },
      { color: '#FF9C80', top: -BLOB * 0.18, left: W - BLOB * 0.72, o: 0.62 },
      { color: '#FFD98C', top: H - BLOB * 0.6, left: W * 0.1, o: 0.7 },
    ],
  },
  dark: {
    base: '#121013',
    blobs: [
      { color: '#6B4326', top: -BLOB * 0.35, left: -BLOB * 0.28, o: 0.6 },
      { color: '#5E2F33', top: -BLOB * 0.18, left: W - BLOB * 0.72, o: 0.55 },
      { color: '#4A3D1E', top: H - BLOB * 0.6, left: W * 0.1, o: 0.52 },
    ],
  },
}

export function GlassWash({ dark }: { dark: boolean }) {
  const w = dark ? WASH.dark : WASH.light
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: w.base }}
    >
      {w.blobs.map((b, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            top: b.top,
            left: b.left,
            width: BLOB,
            height: BLOB,
            borderRadius: BLOB / 2,
            backgroundColor: b.color,
            opacity: b.o,
          }}
        />
      ))}
    </View>
  )
}
