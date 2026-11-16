/* eslint-disable react-refresh/only-export-components -- rendered in a headless widget context, never Fast-Refreshed */
// Look shared by every Android widget — the same soft look as the iOS ones
// (targets/widgets/Kit.swift): the card colour with the app's gradient laid
// over it at low strength, ink text, the app colour for marks and kickers.
import { FlexWidget, TextWidget } from 'react-native-android-widget'
import type { ColorProp, HexColor } from 'react-native-android-widget'

export type Grad = readonly [string, string]
export const G = {
  calendar: ['#FF5F6D', '#FF2E63'],
  shopping: ['#FFC93C', '#FF9A1F'],
  budget: ['#2BD99A', '#0FA37F'],
  pets: ['#FF9B6A', '#F2603A'],
  pings: ['#6E8BFF', '#4A5BF5'],
  kraft: ['#F8EBD6', '#EDD7B4'],
} as const satisfies Record<string, Grad>

export type Look = { dark: boolean; ink: HexColor; soft: HexColor; card: string }
export const look = (dark: boolean): Look =>
  dark
    ? { dark, ink: '#F2F2F4', soft: '#A1A1A8', card: '#222226' }
    : { dark, ink: '#1E1E22', soft: '#66666D', card: '#FFFFFF' }

function hex(c: string): [number, number, number] {
  const h = c.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
/** a → b by t (0..1), as #RRGGBB. */
export function mix(a: string, b: string, t: number): HexColor {
  const [r1, g1, b1] = hex(a)
  const [r2, g2, b2] = hex(b)
  const f = (x: number, y: number) =>
    Math.round(x + (y - x) * t)
      .toString(16)
      .padStart(2, '0')
  return `#${f(r1, r2)}${f(g1, g2)}${f(b1, b2)}`
}
/** The app colour used for marks: the lighter stop in dark, the deeper in light. */
export const accent = (g: Grad, L: Look): HexColor => (L.dark ? g[0] : g[1]) as HexColor
/** A tile / chip on the wash: one step stronger. */
export const tile = (g: Grad, L: Look): HexColor => mix(L.card, g[1], L.dark ? 0.3 : 0.14)

/** The whole widget: the soft wash, rounded, padded, tappable. */
export function Shell({
  g,
  L,
  uri,
  children,
  padding = 14,
  solid,
}: {
  g: Grad
  L: Look
  uri?: string
  children: unknown
  padding?: number
  /** Paint the gradient itself (the kraft note), not the wash. */
  solid?: boolean
}) {
  const a = L.dark ? 0.22 : 0.16
  const from: ColorProp = solid ? (g[0] as HexColor) : mix(L.card, g[0], a)
  const to: ColorProp = solid ? (g[1] as HexColor) : mix(L.card, g[1], a)
  return (
    <FlexWidget
      clickAction={uri ? 'OPEN_URI' : 'OPEN_APP'}
      clickActionData={uri ? { uri } : undefined}
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'column',
        padding,
        borderRadius: 22,
        backgroundGradient: { from, to, orientation: 'TL_BR' },
      }}
    >
      {children}
    </FlexWidget>
  )
}

export function Kicker({ text, color }: { text: string; color: HexColor }) {
  return (
    <TextWidget
      text={text.toUpperCase()}
      maxLines={1}
      truncate="END"
      style={{ fontSize: 11, fontWeight: '700', color, letterSpacing: 0.08 }}
    />
  )
}

export function Line({
  text,
  color,
  size = 14,
  bold,
  maxLines = 1,
}: {
  text: string
  color: HexColor
  size?: number
  bold?: boolean
  maxLines?: number
}) {
  return (
    <TextWidget
      text={text}
      maxLines={maxLines}
      truncate="END"
      style={{ fontSize: size, color, fontWeight: bold ? '700' : 'normal' }}
    />
  )
}

/** Centred message for empty / not-connected states. */
export function Message({ text, L }: { text: string; L: Look }) {
  return (
    <FlexWidget style={{ flex: 1, width: 'match_parent', justifyContent: 'center' }}>
      <Line text={text} color={L.soft} size={14} maxLines={3} />
    </FlexWidget>
  )
}

/** A round tick: filled in the app colour when done, a ring when not. */
export function Check({ done, g, L }: { done: boolean; g: Grad; L: Look }) {
  const a = accent(g, L)
  return (
    <FlexWidget
      style={{
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: done ? 0 : 2,
        borderColor: a,
        backgroundColor: done ? a : '#00000000',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      {done ? <TextWidget text="✓" style={{ fontSize: 13, color: '#FFFFFF', fontWeight: '700' }} /> : null}
    </FlexWidget>
  )
}
