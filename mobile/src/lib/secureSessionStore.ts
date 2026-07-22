// Keychain-backed storage adapter for the Supabase auth session.
//
// WHY: the session carries a long-lived refresh token. AsyncStorage keeps it in
// a plaintext file inside the app sandbox that is also swept into device
// backups. SecureStore puts it in the iOS Keychain instead.
//
// Two things this adapter has to get right:
//
//  1. SIZE. A Keychain entry is only reliably good for ~2KB, and a Supabase
//     session JSON exceeds that as soon as it carries provider tokens. So the
//     value is split across numbered entries with a small count manifest.
//
//  2. MIGRATION. Existing installs already have their session sitting in
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
import * as SecureStore from 'expo-secure-store'

/** Comfortably under the Keychain's practical per-entry ceiling. */
const CHUNK_SIZE = 1800

const OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
}

const countKey = (key: string) => `${key}.chunks`
const chunkKey = (key: string, i: number) => `${key}.${i}`

/** Delete every chunk currently stored under `key` (no-op if there are none). */
async function clearChunks(key: string): Promise<void> {
  const raw = await SecureStore.getItemAsync(countKey(key), OPTS)
  const n = raw ? parseInt(raw, 10) : 0
  if (!Number.isFinite(n) || n <= 0) return
  for (let i = 0; i < n; i++) {
    await SecureStore.deleteItemAsync(chunkKey(key, i), OPTS)
  }
  await SecureStore.deleteItemAsync(countKey(key), OPTS)
}

async function writeChunks(key: string, value: string): Promise<void> {
  await clearChunks(key)
  const parts: string[] = []
  for (let i = 0; i < value.length; i += CHUNK_SIZE) {
    parts.push(value.slice(i, i + CHUNK_SIZE))
  }
  for (let i = 0; i < parts.length; i++) {
    await SecureStore.setItemAsync(chunkKey(key, i), parts[i], OPTS)
  }
  await SecureStore.setItemAsync(countKey(key), String(parts.length), OPTS)
}

async function readChunks(key: string): Promise<string | null> {
  const raw = await SecureStore.getItemAsync(countKey(key), OPTS)
  if (!raw) return null
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return null
  let out = ''
  for (let i = 0; i < n; i++) {
    const part = await SecureStore.getItemAsync(chunkKey(key, i), OPTS)
    // A missing chunk means a torn write — treat the whole value as absent
    // rather than handing Supabase a truncated, unparseable session.
    if (part == null) return null
    out += part
  }
  return out
}

export const secureSessionStore = {
  async getItem(key: string): Promise<string | null> {
    try {
      const stored = await readChunks(key)
      if (stored != null) return stored
      // One-time migration off AsyncStorage so upgrades don't sign users out.
      const legacy = await AsyncStorage.getItem(key)
      if (legacy == null) return null
      try {
        await writeChunks(key, legacy)
        await AsyncStorage.removeItem(key)
      } catch {
        // Keychain unavailable — still return the session so the user stays
        // signed in; the next write will try the migration again.
      }
      return legacy
    } catch {
      return null
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    try {
      await writeChunks(key, value)
      // Drop any plaintext leftover from a pre-migration install.
      await AsyncStorage.removeItem(key).catch(() => {})
    } catch {
      /* best effort — never break sign-in on a Keychain hiccup */
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      await clearChunks(key)
    } catch {
      /* ignore */
    }
    try {
      await AsyncStorage.removeItem(key)
    } catch {
      /* ignore */
    }
  },
}
