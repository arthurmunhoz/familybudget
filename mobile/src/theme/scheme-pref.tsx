// Persisted colour-scheme choice (the accent + background wash of the glass
// skin). Stored in AsyncStorage, per device — same as the Light/Dark choice in
// theme-pref, which this deliberately mirrors. Language syncs to the account via
// user_settings; APPEARANCE doesn't, and a scheme is appearance.
//
// Only meaningful while GLASS is on: the Warm Hearth tokens have a single fixed
// accent, so Settings hides the picker when GLASS is false.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { DEFAULT_SCHEME, SCHEMES, type SchemeId } from './glass'

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
  const [scheme, setSchemeState] = useState<SchemeId>(DEFAULT_SCHEME)

  useEffect(() => {
    let active = true
    AsyncStorage.getItem(CACHE).then((v) => {
      // Guard against a scheme that was removed in a later build.
      if (active && v && v in SCHEMES) setSchemeState(v as SchemeId)
    })
    return () => {
      active = false
    }
  }, [])

  const setScheme = useCallback((s: SchemeId) => {
    setSchemeState(s)
    AsyncStorage.setItem(CACHE, s).catch(() => {})
  }, [])

  return (
    <SchemePrefContext.Provider value={{ scheme, setScheme }}>{children}</SchemePrefContext.Provider>
  )
}

export function useSchemePref(): SchemePrefState {
  return useContext(SchemePrefContext)
}
