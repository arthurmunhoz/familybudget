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
import { pickOn } from './contrast'

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
  // Overridden per colour scheme — see SCHEMES / glassTokens below.
  accent: '#E2683F',
  accentSoft: 'rgba(226,104,63,0.15)',
  onAccent: pickOn('#E2683F'),
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
  onAccent: pickOn('#F2884F'),
  income: '#54C088',
  expense: '#EF6B62',
  border: 'rgba(255,255,255,0.12)',
}

// ── Colour schemes ──────────────────────────────────────────────────────────
// A scheme repaints exactly two things: the ACCENT and the WASH. Everything
// else (neutrals, income green, expense red, the translucency itself) is shared,
// which is what keeps every scheme recognisably the same app.
//
// Two constraints every scheme here respects, learned from the original:
//  - The accent must not read as the expense red (#E4554A). The first accent
//    (#E2683F) was nearly the same hue AND lightness, so a primary button and a
//    negative amount were painted alike — bad in a budgeting app.
//  - It must not read as the income green (#1F9E68) either, which is why
//    there's no sage/olive option in this list.
// White-on-accent contrast is noted per scheme; 'sunset' is the weakest at
// 3.3:1 (large/bold text only) and is kept solely because it's what shipped.
// Two families:
//  - BRANDED (sunset…plum): a warm, tinted wash — the One Roof look.
//  - PALETTES (field…slateGreen): a near-NEUTRAL wash where the accent does all
//    the work. These read very differently and, usefully, give the accent more
//    room: against grey, a green accent no longer competes with the income
//    green the way it would against a warm wash.
export type SchemeId =
  | 'sunset'
  | 'clay'
  | 'honey'
  | 'harbor'
  | 'plum'
  | 'field'
  | 'mono'
  | 'slateOrange'
  | 'slateRed'
  | 'slateBlue'
  | 'slateGreen'

/** What existing installs get — i.e. no visible change unless they pick one. */
export const DEFAULT_SCHEME: SchemeId = 'sunset'

interface Wash {
  base: string
  /** Colour + opacity per blob; POSITIONS are shared (see BLOB_POS). */
  blobs: { color: string; o: number }[]
}
interface Scheme {
  accent: string
  accentSoft: string
  wash: Wash
  accentDark: string
  accentSoftDark: string
  washDark: Wash
}

export const SCHEMES: Record<SchemeId, Scheme> = {
  // 3.3:1 on white — the original.
  sunset: {
    accent: '#E2683F',
    accentSoft: 'rgba(226,104,63,0.15)',
    wash: { base: '#F7EFE6', blobs: [{ color: '#FFC489', o: 0.72 }, { color: '#FF9C80', o: 0.62 }, { color: '#FFD98C', o: 0.7 }] },
    accentDark: '#F2884F',
    accentSoftDark: 'rgba(242,136,79,0.20)',
    washDark: { base: '#121013', blobs: [{ color: '#6B4326', o: 0.6 }, { color: '#5E2F33', o: 0.55 }, { color: '#4A3D1E', o: 0.52 }] },
  },
  // 4.7:1 — Warm Hearth's original clay, same family as sunset but calmer.
  // Darkened ~6% from the brand #C2603F, which sat at 4.17:1 against BOTH white
  // and ink — the one accent no foreground choice could rescue.
  clay: {
    accent: '#B65A3B',
    accentSoft: 'rgba(182,90,59,0.15)',
    wash: { base: '#F8F1E8', blobs: [{ color: '#F5CDA0', o: 0.72 }, { color: '#EBA98F', o: 0.62 }, { color: '#F2D9A6', o: 0.7 }] },
    accentDark: '#DA7A5B',
    accentSoftDark: 'rgba(218,122,91,0.20)',
    washDark: { base: '#131110', blobs: [{ color: '#5E3A22', o: 0.6 }, { color: '#532E2A', o: 0.55 }, { color: '#46391C', o: 0.52 }] },
  },
  // 3.6:1 — warmest option, no salmon anywhere.
  honey: {
    accent: '#B87A2B',
    accentSoft: 'rgba(184,122,43,0.15)',
    wash: { base: '#FAF3E8', blobs: [{ color: '#F6D9A4', o: 0.72 }, { color: '#EFC98D', o: 0.62 }, { color: '#F3E3B8', o: 0.7 }] },
    accentDark: '#E0A54A',
    accentSoftDark: 'rgba(224,165,74,0.20)',
    washDark: { base: '#121010', blobs: [{ color: '#5C4520', o: 0.6 }, { color: '#4E3A1C', o: 0.55 }, { color: '#443A16', o: 0.52 }] },
  },
  // 5.6:1 — cool accent on warm paper; the biggest departure and the crispest.
  harbor: {
    accent: '#2C6E8F',
    accentSoft: 'rgba(44,110,143,0.15)',
    wash: { base: '#F4F1EC', blobs: [{ color: '#C6DBE2', o: 0.72 }, { color: '#9CC4D4', o: 0.62 }, { color: '#EFDCC2', o: 0.7 }] },
    accentDark: '#5AA8C8',
    accentSoftDark: 'rgba(90,168,200,0.20)',
    washDark: { base: '#0F1216', blobs: [{ color: '#1F3E4E', o: 0.6 }, { color: '#24485A', o: 0.55 }, { color: '#3D3A2C', o: 0.52 }] },
  },
  // 5.7:1 — the most legible filled buttons of the set.
  plum: {
    accent: '#8A5673',
    accentSoft: 'rgba(138,86,115,0.15)',
    wash: { base: '#F8F0EC', blobs: [{ color: '#E7C6CE', o: 0.72 }, { color: '#D9B3C4', o: 0.62 }, { color: '#F2DCC2', o: 0.7 }] },
    accentDark: '#C489A8',
    accentSoftDark: 'rgba(196,137,168,0.20)',
    washDark: { base: '#131015', blobs: [{ color: '#452A3B', o: 0.6 }, { color: '#3E2536', o: 0.55 }, { color: '#453521', o: 0.52 }] },
  },

  // ── Palettes (near-neutral wash) ──────────────────────────────────────────
  // A flat grey wash would kill the glass: the effect comes from VARIATION
  // behind a translucent card, so with no colour there's nothing to read
  // through and cards flatten into plain panels. Each of these therefore keeps
  // one blob tinted with the scheme's own hue — enough to stay glassy and to
  // tie the accent into the background, while still reading as grey.

  // 7.1:1 — olive drab. The one green that doesn't fight the income green:
  // it's far darker and much less saturated (2.1 lightness ratio apart).
  field: {
    accent: '#4E5D43',
    accentSoft: 'rgba(78,93,67,0.15)',
    wash: { base: '#EFEFE7', blobs: [{ color: '#CFD3B8', o: 0.7 }, { color: '#B9C2A4', o: 0.6 }, { color: '#E3E0C9', o: 0.68 }] },
    accentDark: '#94A882',
    accentSoftDark: 'rgba(148,168,130,0.20)',
    washDark: { base: '#101210', blobs: [{ color: '#2F3A28', o: 0.6 }, { color: '#38412C', o: 0.55 }, { color: '#2A3322', o: 0.52 }] },
  },
  // 13.5:1 — the most legible accent of the whole set. Income/expense stay
  // coloured, so money still reads semantically in an otherwise mono app.
  mono: {
    accent: '#2E2E33',
    accentSoft: 'rgba(46,46,51,0.13)',
    wash: { base: '#F2F2F3', blobs: [{ color: '#E3E3E5', o: 0.75 }, { color: '#D8D8DB', o: 0.6 }, { color: '#ECECEE', o: 0.7 }] },
    accentDark: '#9A9AA4',
    accentSoftDark: 'rgba(154,154,164,0.20)',
    washDark: { base: '#101012', blobs: [{ color: '#24242A', o: 0.6 }, { color: '#1C1C21', o: 0.55 }, { color: '#2A2A31', o: 0.52 }] },
  },
  // 5.0:1 — darkened ~6% from #C2571F, which landed at 4.49:1, a hair under AA.
  slateOrange: {
    accent: '#B6511D',
    accentSoft: 'rgba(182,81,29,0.15)',
    wash: { base: '#F0EFEE', blobs: [{ color: '#E4DFD9', o: 0.72 }, { color: '#F0C9A8', o: 0.55 }, { color: '#E0DEDB', o: 0.68 }] },
    accentDark: '#F09A5C',
    accentSoftDark: 'rgba(240,154,92,0.20)',
    washDark: { base: '#111112', blobs: [{ color: '#2A2724', o: 0.6 }, { color: '#3B2C1F', o: 0.55 }, { color: '#232326', o: 0.52 }] },
  },
  // 5.9:1 — deliberately a dark BRICK, not a bright red: it has to stay
  // distinguishable from the expense red (#E4554A) sitting next to it.
  slateRed: {
    accent: '#B23A2E',
    accentSoft: 'rgba(178,58,46,0.15)',
    wash: { base: '#F0EEEE', blobs: [{ color: '#E3DDDD', o: 0.72 }, { color: '#EFC3BC', o: 0.55 }, { color: '#DFDDDD', o: 0.68 }] },
    accentDark: '#EC7C70',
    accentSoftDark: 'rgba(236,124,112,0.20)',
    washDark: { base: '#111011', blobs: [{ color: '#2A2424', o: 0.6 }, { color: '#3A2422', o: 0.55 }, { color: '#232326', o: 0.52 }] },
  },
  // 6.6:1
  slateBlue: {
    accent: '#2F5D9E',
    accentSoft: 'rgba(47,93,158,0.15)',
    wash: { base: '#EEEFF1', blobs: [{ color: '#DCE0E6', o: 0.72 }, { color: '#BFD2EC', o: 0.55 }, { color: '#E0E2E5', o: 0.68 }] },
    accentDark: '#7BA7E8',
    accentSoftDark: 'rgba(123,167,232,0.20)',
    washDark: { base: '#0F1013', blobs: [{ color: '#22262E', o: 0.6 }, { color: '#1F2C3F', o: 0.55 }, { color: '#232326', o: 0.52 }] },
  },
  // 6.4:1 — a deep forest, well below the income green in lightness.
  slateGreen: {
    accent: '#2C6B4A',
    accentSoft: 'rgba(44,107,74,0.15)',
    wash: { base: '#EEF0EE', blobs: [{ color: '#DCE3DC', o: 0.72 }, { color: '#BEDCC7', o: 0.55 }, { color: '#E1E3E0', o: 0.68 }] },
    accentDark: '#67B98D',
    accentSoftDark: 'rgba(103,185,141,0.20)',
    washDark: { base: '#0F1210', blobs: [{ color: '#212A24', o: 0.6 }, { color: '#1E3227', o: 0.55 }, { color: '#232622', o: 0.52 }] },
  },
}

export const SCHEME_IDS = Object.keys(SCHEMES) as SchemeId[]

/** The active token set: the shared glass neutrals + the scheme's accent. */
export function glassTokens(dark: boolean, scheme: SchemeId): ThemeTokens {
  const s = SCHEMES[scheme] ?? SCHEMES[DEFAULT_SCHEME]
  const base = dark ? glassDark : glassLight
  return {
    ...base,
    accent: dark ? s.accentDark : s.accent,
    accentSoft: dark ? s.accentSoftDark : s.accentSoft,
    // Derived, never authored: a new scheme can't forget it and silently ship
    // white-on-a-pale-accent again.
    onAccent: pickOn(dark ? s.accentDark : s.accent),
  }
}

// The color wash: a base fill plus three big, soft, low-opacity color fields in
// the corners. No gradient library — overlapping translucent circles read as a
// gentle wash behind the (transparent) screens. Rendered once, at the app root.
const { width: W, height: H } = Dimensions.get('window')
const BLOB = Math.max(W, H) * 0.95

// Positions are LAYOUT, not colour, so every scheme shares them — a scheme only
// swaps the three colours + the base fill.
// Punchier than a flat tint on purpose: with see-through cards, this colour IS
// the glass effect — the more variation behind a card, the more it reads as
// glass rather than as a slightly-grey panel.
const BLOB_POS = [
  { top: -BLOB * 0.35, left: -BLOB * 0.28 },
  { top: -BLOB * 0.18, left: W - BLOB * 0.72 },
  { top: H - BLOB * 0.6, left: W * 0.1 },
]

/**
 * One dial on how loudly the wash reads. Blob opacities in SCHEMES are authored
 * at full strength; this scales all of them, so the relative weighting each
 * scheme was tuned with is preserved and there's a single number to turn.
 *
 * Why below 1: at full strength the background competed with the content. These
 * screens carry a lot of information (a budget period, a day's agenda, a
 * checklist), and a saturated wash behind all of it read as busy rather than
 * warm. Dialled back, the colour still tints the page — the app stays
 * recognisably itself — but it sits behind the content instead of alongside it.
 *
 * Light is cut hardest: its blobs are saturated colour on pale paper. Dark's are
 * already near-black on near-black, so the same cut would flatten it to grey and
 * kill the glass entirely.
 */
const WASH_INTENSITY = { light: 0.42, dark: 0.75 }

export function GlassWash({ dark, scheme }: { dark: boolean; scheme: SchemeId }) {
  const s = SCHEMES[scheme] ?? SCHEMES[DEFAULT_SCHEME]
  const w = dark ? s.washDark : s.wash
  const intensity = dark ? WASH_INTENSITY.dark : WASH_INTENSITY.light
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
            top: BLOB_POS[i].top,
            left: BLOB_POS[i].left,
            width: BLOB,
            height: BLOB,
            borderRadius: BLOB / 2,
            backgroundColor: b.color,
            opacity: b.o * intensity,
          }}
        />
      ))}
    </View>
  )
}
