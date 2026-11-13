// Modo Casa — small shared helpers (no React).
import type { Lang } from '../lib/i18n'

/** Same origin in production; a full URL in dev (VITE_API_BASE). */
export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''

/** localStorage key holding this device's `home_devices.id`. */
export const DEVICE_KEY = 'casa.device'

export const LOCALE: Record<Lang, string> = { en: 'en-US', es: 'es-ES', pt: 'pt-BR' }

/** The app's identity gradients (mirrors mobile/src/components/home/palette.ts). */
export const GRAD = {
  calendar: ['#FF5F6D', '#FF2E63'],
  lists: ['#FFC93C', '#FF9A1F'],
  money: ['#2BD99A', '#0FA37F'],
  pets: ['#FF9B6A', '#F2603A'],
  event: ['#F0566A', '#C9356A'],
  birthday: ['#B06CF5', '#7A3FE0'],
  pet: ['#F98345', '#DD4B3D'],
  orb: ['#8B6CFF', '#20C3A6'],
  frame: ['#FF8A5B', '#E2507E'],
} as const

export const BUDGET_GRADIENTS: readonly (readonly [string, string])[] = [
  ['#4C7BF4', '#4A4FD8'],
  ['#A065F0', '#7140D6'],
  ['#1FA9C9', '#1A73B8'],
  ['#3D4FB8', '#26307E'],
  ['#9A4FC0', '#62308E'],
]
export function budgetGradient(id: string): readonly [string, string] {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return BUDGET_GRADIENTS[h % BUDGET_GRADIENTS.length]
}

export const grad = (g: readonly string[], angle = 135) => `linear-gradient(${angle}deg, ${g[0]}, ${g[1]})`

/** Accent-insensitive, lower-case, trimmed. */
export const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

export function firstName(name: string): string {
  return (name || '').trim().split(/\s+/)[0] ?? ''
}

/** sha256 hex of a string (Web Crypto — needs a secure context). */
export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
export function lsSet(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* private mode */
  }
}

/** "K7P · 4QX" from "K7P4QX". */
export function prettyCode(code: string): string {
  const c = code.toUpperCase()
  return c.length === 6 ? `${c.slice(0, 3)} · ${c.slice(3)}` : c
}

/** Local ISO date (YYYY-MM-DD) for a Date. */
export function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function dateOf(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** First letter upper-case (pt/es dates come lower-case). */
export const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
