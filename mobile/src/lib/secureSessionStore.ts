// Keychain-backed storage adapter for the Supabase auth session.
//
// WHY: the session carries a long-lived refresh token. AsyncStorage keeps it in
// a plaintext file inside the app sandbox that is also swept into device
// backups. SecureStore puts it in the iOS Keychain instead.
//
// Three things this adapter has to get right:
//
//  1. NO STATIC IMPORT of expo-secure-store. Its module scope calls
//     requireNativeModule('ExpoSecureStore'), which THROWS when the native
//     binary predates the dependency (Expo Go, or any build made before it was
//     added). A top-level import therefore doesn't just disable the feature —
//     it takes down every route, because this module is reached from
//     supabase → analytics → AnalyticsBridge → _layout, and expo-router then
//     reports every screen as "missing the required default export". Same trap,
//     and same fix, as react-native-document-scanner-plugin: guarded require,
//     null when absent. Never make this a static import.
//     When the module is missing we fall back to AsyncStorage — exactly the
//     previous behaviour, so the app runs; a native rebuild silently upgrades
//     it to the Keychain.
//
//  2. SIZE. A Keychain entry is only reliably good for ~2KB, and a Supabase
//     session JSON exceeds that as soon as it carries provider tokens. So the
//     value is split across numbered entries with a small count manifest.
//
//  3. MIGRATION. Existing installs already have their session sitting in
//     AsyncStorage. A cold switch would sign every current user out on upgrade,
//     so the first read of a key falls back to AsyncStorage, moves whatever it
//     finds into the Keychain, and clears the plaintext copy. Nobody notices.
//
// Accessibility is AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY, deliberately:
//   - AFTER_FIRST_UNLOCK (not WHEN_UNLOCKED) because background geofencing,
//     the location task, and silent push handlers all need to read the session
//     while the phone is locked. WHEN_UNLOCKED would break Whereabouts.
//   - THIS_DEVICE_ONLY so the token is excluded from encrypted backups and
//     never syncs to iCloud Keychain.
import AsyncStorage from '@react-native-async-storage/async-storage'

// Type-only imports: erased at compile time, so they emit no runtime require
// and cannot trigger the native-module throw described above.
type SecureStoreModule = typeof import('expo-secure-store')
type SecureStoreOptions = import('expo-secure-store').SecureStoreOptions

/** undefined = not resolved yet, null = native module absent. */
let cached: SecureStoreModule | null | undefined

/** The expo-secure-store module, or null when the native side isn't in this
 *  binary. Resolved once and memoized. */
function secureStore(): SecureStoreModule | null {
  if (cached !== undefined) return cached
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-secure-store') as SecureStoreModule
    // The require can resolve while the native module is still missing, so
    // confirm the API is really there before trusting it.
    cached = typeof mod?.getItemAsync === 'function' ? mod : null
  } catch {
    cached = null
  }
  return cached
}

/** Comfortably under the Keychain's practical per-entry ceiling. */
const CHUNK_SIZE = 1800

function opts(mod: SecureStoreModule): SecureStoreOptions {
  return { keychainAccessible: mod.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }
}

const countKey = (key: string) => `${key}.chunks`
const chunkKey = (key: string, i: number) => `${key}.${i}`

/** Delete every chunk currently stored under `key` (no-op if there are none). */
async function clearChunks(mod: SecureStoreModule, key: string): Promise<void> {
  const o = opts(mod)
  const raw = await mod.getItemAsync(countKey(key), o)
  const n = raw ? parseInt(raw, 10) : 0
  if (!Number.isFinite(n) || n <= 0) return
  for (let i = 0; i < n; i++) {
    await mod.deleteItemAsync(chunkKey(key, i), o)
  }
  await mod.deleteItemAsync(countKey(key), o)
}

async function writeChunks(mod: SecureStoreModule, key: string, value: string): Promise<void> {
  await clearChunks(mod, key)
  const o = opts(mod)
  const parts: string[] = []
  for (let i = 0; i < value.length; i += CHUNK_SIZE) {
    parts.push(value.slice(i, i + CHUNK_SIZE))
  }
  for (let i = 0; i < parts.length; i++) {
    await mod.setItemAsync(chunkKey(key, i), parts[i], o)
  }
  await mod.setItemAsync(countKey(key), String(parts.length), o)
}

async function readChunks(mod: SecureStoreModule, key: string): Promise<string | null> {
  const o = opts(mod)
  const raw = await mod.getItemAsync(countKey(key), o)
  if (!raw) return null
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return null
  let out = ''
  for (let i = 0; i < n; i++) {
    const part = await mod.getItemAsync(chunkKey(key, i), o)
    // A missing chunk means a torn write — treat the whole value as absent
    // rather than handing Supabase a truncated, unparseable session.
    if (part == null) return null
    out += part
  }
  return out
}

export const secureSessionStore = {
  async getItem(key: string): Promise<string | null> {
    const mod = secureStore()
    if (!mod) return AsyncStorage.getItem(key)
    try {
      const stored = await readChunks(mod, key)
      if (stored != null) return stored
      // One-time migration off AsyncStorage so upgrades don't sign users out.
      const legacy = await AsyncStorage.getItem(key)
      if (legacy == null) return null
      try {
        await writeChunks(mod, key, legacy)
        await AsyncStorage.removeItem(key)
      } catch {
        // Keychain unavailable — still return the session so the user stays
        // signed in; the next write will try the migration again.
      }
      return legacy
    } catch {
      // Never strand the user on a Keychain fault: fall back to whatever the
      // plaintext store still holds rather than reporting "signed out".
      return AsyncStorage.getItem(key)
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    const mod = secureStore()
    if (!mod) {
      await AsyncStorage.setItem(key, value)
      return
    }
    try {
      await writeChunks(mod, key, value)
      // Drop any plaintext leftover from a pre-migration install.
      await AsyncStorage.removeItem(key).catch(() => {})
    } catch {
      // A session we can't persist would silently sign the user out on next
      // launch, so fall back to AsyncStorage rather than losing it.
      await AsyncStorage.setItem(key, value).catch(() => {})
    }
  },

  async removeItem(key: string): Promise<void> {
    const mod = secureStore()
    if (mod) {
      try {
        await clearChunks(mod, key)
      } catch {
        /* ignore */
      }
    }
    try {
      await AsyncStorage.removeItem(key)
    } catch {
      /* ignore */
    }
  },
}
