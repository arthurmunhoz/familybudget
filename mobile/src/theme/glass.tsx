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
  // Mostly-opaque: `card` also backs every modal/sheet panel, which float over a
  // dim backdrop (or the Whereabouts map), not the wash — so a see-through card
  // there mixes with whatever's behind. High opacity stays legible everywhere;
  // the wash showing BETWEEN and around cards is what carries the glass feel.
  card: 'rgba(255,255,255,0.92)',
  cardActive: 'rgba(255,255,255,0.98)',
  surface: 'rgba(247,240,233,0.66)',
  surface2: 'rgba(247,240,233,0.52)',
  text: '#241F1B',
  textMuted: '#6B615A',
  textFaint: '#9A908A',
  accent: '#E2683F',
  accentSoft: 'rgba(226,104,63,0.15)',
  income: '#1F9E68',
  expense: '#E4554A',
  border: 'rgba(60,45,38,0.12)',
}

export const glassDark: ThemeTokens = {
  bg: 'transparent',
  // See glassLight.card — kept mostly-opaque so sheets/modals stay legible over
  // the backdrop (and the map) rather than mixing with what's behind.
  card: 'rgba(30,31,40,0.92)',
  cardActive: 'rgba(44,46,58,0.97)',
  surface: 'rgba(255,255,255,0.09)',
  surface2: 'rgba(255,255,255,0.14)',
  text: '#F3EFEA',
  textMuted: '#A7A199',
  textFaint: '#726C64',
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

const WASH = {
  light: {
    base: '#F5ECE4',
    blobs: [
      { color: '#FFD3A6', top: -BLOB * 0.35, left: -BLOB * 0.28, o: 0.55 },
      { color: '#FFB199', top: -BLOB * 0.18, left: W - BLOB * 0.72, o: 0.5 },
      { color: '#FFE3AE', top: H - BLOB * 0.6, left: W * 0.1, o: 0.55 },
    ],
  },
  dark: {
    base: '#131110',
    blobs: [
      { color: '#4A3326', top: -BLOB * 0.35, left: -BLOB * 0.28, o: 0.55 },
      { color: '#4A2C28', top: -BLOB * 0.18, left: W - BLOB * 0.72, o: 0.5 },
      { color: '#3A3320', top: H - BLOB * 0.6, left: W * 0.1, o: 0.5 },
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
