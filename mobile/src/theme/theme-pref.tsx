// Persisted appearance override: Light / Dark / System (follow the device).
// Re-adds the theme choice the PWA had. Stored in AsyncStorage so it survives
// restarts. Mirrors the useI18n provider pattern.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

export type ThemeMode = 'system' | 'light' | 'dark'

interface ThemePrefState {
  mode: ThemeMode
  setMode: (m: ThemeMode) => void
}

// Default 'system' so an unwrapped useTheme() still resolves (before hydration).
const ThemePrefContext = createContext<ThemePrefState>({ mode: 'system', setMode: () => {} })
const CACHE = 'oneroof-theme'

export function ThemePrefProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('system')

  useEffect(() => {
    let active = true
    AsyncStorage.getItem(CACHE).then((v) => {
      if (active && (v === 'light' || v === 'dark' || v === 'system')) setModeState(v)
    })
    return () => {
      active = false
    }
  }, [])

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m)
    AsyncStorage.setItem(CACHE, m).catch(() => {})
  }, [])

  return <ThemePrefContext.Provider value={{ mode, setMode }}>{children}</ThemePrefContext.Provider>
}

export function useThemePref(): ThemePrefState {
  return useContext(ThemePrefContext)
}
