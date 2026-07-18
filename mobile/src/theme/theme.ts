// "Warm Hearth" design tokens, ported from the PWA's index.css. Light = "Paper",
// dark = "Dusk" (warm espresso). useTheme() respects the saved appearance
// choice (Light/Dark, default Light) from theme-pref.
import { Platform } from 'react-native';

import { useThemePref } from './theme-pref';
import { useSchemePref } from './scheme-pref';
import { pickOnAccent } from './contrast';
import { GLASS, glassLight, glassDark, glassTokens } from './glass';

export interface ThemeTokens {
  bg: string;
  card: string;
  /** An OPAQUE card, for panels that float over detailed content (a sheet on the
   *  Whereabouts map) where a translucent `card` would let the background show
   *  through the text. Identical to `card` outside the glass skin. */
  sheet: string;
  cardActive: string;
  surface: string;
  surface2: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  accentSoft: string;
  /** Text/icon colour to use ON an accent-filled surface. NEVER hardcode a
   *  literal white on `accent` — the light, vivid accents used in dark mode need
   *  dark ink instead. See theme/contrast.ts. */
  onAccent: string;
  income: string;
  expense: string;
  border: string;
}

export const light: ThemeTokens = {
  bg: '#fbf6f0',
  card: '#ffffff',
  sheet: '#ffffff',
  cardActive: '#f4ecdf',
  surface: '#f1e8dc',
  surface2: '#ece3d6',
  text: '#2b2521',
  textMuted: '#8c8076',
  textFaint: '#b3a89b',
  accent: '#c2603f',
  accentSoft: 'rgba(194,96,63,0.14)',
  onAccent: pickOnAccent('#c2603f'),
  income: '#3c7d58',
  expense: '#cf5a4c',
  border: 'rgba(43,37,33,0.10)',
};

export const dark: ThemeTokens = {
  bg: '#1b1714',
  card: '#262019',
  sheet: '#262019',
  cardActive: '#2f2820',
  surface: '#322a21',
  surface2: '#3a332b',
  text: '#f3ebe0',
  textMuted: '#a89c8e',
  textFaint: '#7c7165',
  accent: '#da7a5b',
  accentSoft: 'rgba(218,122,91,0.22)',
  onAccent: pickOnAccent('#da7a5b'),
  income: '#6fb58a',
  expense: '#e07a6a',
  border: 'rgba(243,235,224,0.12)',
};

export interface Theme {
  dark: boolean;
  c: ThemeTokens;
}

export function useTheme(): Theme {
  const { mode } = useThemePref();
  const { scheme } = useSchemePref();
  const isDark = mode === 'dark';
  // GLASS skin (experimental, reversible) swaps in translucent tokens; see
  // theme/glass.tsx. Flip GLASS to false there to restore Warm Hearth exactly.
  // The user's colour scheme repaints only accent/accentSoft on top of those.
  if (GLASS) return { dark: isDark, c: glassTokens(isDark, scheme) };
  return { dark: isDark, c: isDark ? dark : light };
}

// Spacing + radius scale (keeps screens consistent).
export const sp = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

/** Radius for an edge that meets the iPhone's own screen curve — a sheet's top
 *  corners, or the bottom corners of a button sitting at the foot of one.
 *  iOS gives no API for the display's real radius and it varies by device
 *  (~39pt on X/11 Pro, ~47 on 12–14, ~55 on the Pros), so this is a middle
 *  value; under-shooting is the safe direction, since a radius larger than the
 *  screen's visibly bulges past the curve. Android screens are square, so it
 *  falls back to the normal large radius there. */
export const sheetRadius = Platform.OS === 'ios' ? 40 : radius.lg;

// Brand type — Fraunces (display serif) + Hanken Grotesk (UI sans). Loaded in
// _layout via @expo-google-fonts. Falls back to system if a name is missing.
// GLASS skin swaps the serif display for rounded Nunito (titles/greetings/hero
// numbers); body stays Hanken Grotesk. Both font sets are loaded in _layout.
export const fonts = GLASS
  ? ({
      display: 'Nunito_800ExtraBold',
      displaySemi: 'Nunito_700Bold',
      body: 'HankenGrotesk_400Regular',
      medium: 'HankenGrotesk_500Medium',
      semibold: 'HankenGrotesk_600SemiBold',
    } as const)
  : ({
      display: 'Fraunces_700Bold',
      displaySemi: 'Fraunces_600SemiBold',
      body: 'HankenGrotesk_400Regular',
      medium: 'HankenGrotesk_500Medium',
      semibold: 'HankenGrotesk_600SemiBold',
    } as const);
