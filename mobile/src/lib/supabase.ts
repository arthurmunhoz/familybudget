// Supabase client for React Native (Expo). Mirrors the PWA's client but uses
// Keychain-backed session persistence and the URL polyfill RN needs.
// Follows Supabase's official Expo guide.
import 'react-native-url-polyfill/auto'
import { AppState } from 'react-native'
import { createClient } from '@supabase/supabase-js'

import { secureSessionStore } from './secureSessionStore'

const url = process.env.EXPO_PUBLIC_SUPABASE_URL
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

if (!url || !anon) {
  console.warn(
    '[supabase] Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY — copy .env.example to .env.local.',
  )
}

export const supabase = createClient(url ?? '', anon ?? '', {
  auth: {
    // Keychain, not AsyncStorage — the refresh token is long-lived and
    // AsyncStorage is plaintext in the sandbox and swept into backups.
    // Migrates existing sessions across on first read, so nobody is signed out.
    storage: secureSessionStore,
    autoRefreshToken: true,
    persistSession: true,
    // Authorization-code + PKCE rather than the implicit flow, so tokens are
    // never carried in the oneroof:// redirect URL (custom schemes can be
    // claimed by other installed apps). The OAuth callers exchange the `code`.
    flowType: 'pkce',
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
