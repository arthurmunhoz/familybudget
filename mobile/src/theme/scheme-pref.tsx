// Persisted colour-scheme choice (the accent + background wash of the glass
// skin). Stored in AsyncStorage, per device — same as the Light/Dark choice in
// theme-pref, which this deliberately mirrors. Language syncs to the account via
// user_settings; APPEARANCE doesn't, and a scheme is appearance.
//
// Only meaningful while GLASS is on: the Warm Hearth tokens have a single fixed
// accent, so Settings hides the picker when GLASS is false.
import { createContext, useCallback, useContext, useEffect, type ReactNode } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { DEFAULT_SCHEME, type SchemeId } from './glass'

interface SchemePrefState {
  scheme: SchemeId
  setScheme: (s: SchemeId) => void
}

// Default matches DEFAULT_SCHEME so an unwrapped useTheme() still resolves to
// the shipped look before hydration (and so upgrading installs see no change).
const SchemePrefContext = createContext<SchemePrefState>({
  scheme: DEFAULT_SCHEME,
  setScheme: () => {},
})
const CACHE = 'oneroof-scheme'

export function SchemePrefProvider({ children }: { children: ReactNode }) {
  // The accent is no longer a user choice (owner, 2026-11): every app has its
  // own gradient now, and a global accent picked in Settings clashed with it
  // (a green Done inside the pink Calendar). Everyone gets DEFAULT_SCHEME; a
  // choice saved by an older build is ignored and cleared.
  useEffect(() => {
    AsyncStorage.removeItem(CACHE).catch(() => {})
  }, [])
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const setScheme = useCallback((_s: SchemeId) => {}, [])
  return (
    <SchemePrefContext.Provider value={{ scheme: DEFAULT_SCHEME, setScheme }}>{children}</SchemePrefContext.Provider>
  )
}

export function useSchemePref(): SchemePrefState {
  return useContext(SchemePrefContext)
}
