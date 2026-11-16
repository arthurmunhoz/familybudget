// Android home-screen widgets (react-native-android-widget, 2026-11-16).
// The widgets run in a HEADLESS JS context (no screen, no React tree), so the
// app mirrors what they need into AsyncStorage under `aw:<key>` — the same
// keys the iOS widgets read from the App Group (lib/widget.ts) — and the
// widgets fetch live data themselves from api/widget.ts with the per-device
// widget token, exactly like the iOS ones.
import AsyncStorage from '@react-native-async-storage/async-storage'

export const AW = (key: string) => `aw:${key}`
const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? ''

export async function awGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(AW(key))
    return raw == null ? null : (JSON.parse(raw) as T)
  } catch {
    return null
  }
}

export async function awSet(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(AW(key), JSON.stringify(value))
  } catch {
    /* storage unavailable — the widget just shows its empty state */
  }
}

export async function awRemove(keys: string[]): Promise<void> {
  try {
    await AsyncStorage.multiRemove(keys.map(AW))
  } catch {
    /* ignore */
  }
}

/** POST to api/widget.ts with the widget token. null = no token / offline. */
export async function widgetApi<T>(action: string, body: Record<string, unknown> = {}): Promise<T | null> {
  const token = await awGet<string>('widget_token')
  if (!token || !API_BASE) return null
  try {
    const res = await fetch(`${API_BASE}/api/widget?action=${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, ...body }),
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

export async function hasToken(): Promise<boolean> {
  return !!(await awGet<string>('widget_token'))
}

/** The phone's local day, YYYY-MM-DD (the server never guesses a timezone). */
export function localDay(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export type Lang = 'pt' | 'en' | 'es'
export async function widgetLang(): Promise<Lang> {
  try {
    const v = await AsyncStorage.getItem('oneroof-lang')
    if (v === 'pt' || v === 'en' || v === 'es') return v
  } catch {
    /* fall through to the device language */
  }
  const dev = Intl.DateTimeFormat().resolvedOptions().locale.slice(0, 2)
  return dev === 'pt' || dev === 'es' ? dev : 'en'
}
export async function widgetDark(): Promise<boolean> {
  return (await awGet<string>('widget_theme')) === 'dark'
}
