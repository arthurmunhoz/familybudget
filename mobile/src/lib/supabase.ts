// Supabase client for React Native (Expo). Mirrors the PWA's client but uses
// AsyncStorage for session persistence and the URL polyfill RN needs.
// Follows Supabase's official Expo guide.
import 'react-native-url-polyfill/auto'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { AppState } from 'react-native'
import { createClient } from '@supabase/supabase-js'

const url = process.env.EXPO_PUBLIC_SUPABASE_URL
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

if (!url || !anon) {
  console.warn(
    '[supabase] Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY — copy .env.example to .env.local.',
  )
}

export const supabase = createClient(url ?? '', anon ?? '', {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // No URL-based session detection on native (that's a web OAuth concern).
    detectSessionInUrl: false,
  },
})

// Supabase recommends pausing token auto-refresh while the app is backgrounded
// and resuming it on foreground.
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh()
  else supabase.auth.stopAutoRefresh()
})
