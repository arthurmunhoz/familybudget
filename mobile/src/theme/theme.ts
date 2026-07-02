// "Warm Hearth" design tokens, ported from the PWA's index.css. Light = "Paper",
// dark = "Dusk" (warm espresso). useTheme() respects the saved appearance
// choice (Light/Dark, default Light) from theme-pref.
import { useThemePref } from './theme-pref';

export interface ThemeTokens {
  bg: string;
  card: string;
  cardActive: string;
  surface: string;
  surface2: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  accentSoft: string;
  income: string;
  expense: string;
  border: string;
}

export const light: ThemeTokens = {
  bg: '#fbf6f0',
  card: '#ffffff',
  cardActive: '#f4ecdf',
  surface: '#f1e8dc',
  surface2: '#ece3d6',
  text: '#2b2521',
  textMuted: '#8c8076',
  textFaint: '#b3a89b',
  accent: '#c2603f',
  accentSoft: 'rgba(194,96,63,0.14)',
  income: '#3c7d58',
  expense: '#cf5a4c',
  border: 'rgba(43,37,33,0.10)',
};

export const dark: ThemeTokens = {
  bg: '#1b1714',
  card: '#262019',
  cardActive: '#2f2820',
  surface: '#322a21',
  surface2: '#3a332b',
  text: '#f3ebe0',
  textMuted: '#a89c8e',
  textFaint: '#7c7165',
  accent: '#da7a5b',
  accentSoft: 'rgba(218,122,91,0.22)',
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
  const isDark = mode === 'dark';
  return { dark: isDark, c: isDark ? dark : light };
}

// Spacing + radius scale (keeps screens consistent).
export const sp = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

// Brand type — Fraunces (display serif) + Hanken Grotesk (UI sans). Loaded in
// _layout via @expo-google-fonts. Falls back to system if a name is missing.
export const fonts = {
  display: 'Fraunces_700Bold',
  displaySemi: 'Fraunces_600SemiBold',
  body: 'HankenGrotesk_400Regular',
  medium: 'HankenGrotesk_500Medium',
  semibold: 'HankenGrotesk_600SemiBold',
} as const;
