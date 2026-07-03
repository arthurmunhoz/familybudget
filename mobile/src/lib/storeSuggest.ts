// Location-aware store suggestions for the shopping list's store picker.
// Calls /api/suggest-stores (Claude Haiku + Vercel IP-geo, so a household in
// São Paulo sees Pão de Açúcar/Carrefour while one in Miami sees Publix/Costco).
// The result is cached in AsyncStorage for a week — the AI call runs at most
// ~once per device per week. Falls back to [] (caller shows the built-in
// catalog) when offline/unconfigured.
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Localization from 'expo-localization'

import { supabase } from './supabase'

const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? ''
const CACHE_KEY = 'stores:suggestions'
const TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface SuggestedStore {
  name: string
  color: string | null
}

interface CachePayload {
  at: number
  stores: SuggestedStore[]
  location: string | null
}

export async function fetchStoreSuggestions(): Promise<SuggestedStore[]> {
  // Fresh-enough cache → no network, no AI spend.
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY)
    if (raw) {
      const cached = JSON.parse(raw) as CachePayload
      if (Date.now() - cached.at < TTL_MS && cached.stores.length > 0) return cached.stores
    }
  } catch {
    /* unreadable cache — refetch */
  }

  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token || !API_BASE) return []
    // Body region/city is only a fallback for when Vercel's IP-geo headers are
    // absent; the server prefers its own geo.
    const region = Localization.getLocales()[0]?.regionCode ?? null
    const res = await fetch(`${API_BASE}/api/suggest-stores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ country: region }),
    })
    if (!res.ok) return []
    const json = (await res.json()) as { stores?: SuggestedStore[]; location?: string | null }
    const stores = (json.stores ?? []).filter((s) => s && typeof s.name === 'string')
    if (stores.length > 0) {
      await AsyncStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ at: Date.now(), stores, location: json.location ?? null } satisfies CachePayload),
      ).catch(() => {})
    }
    return stores
  } catch {
    return []
  }
}
