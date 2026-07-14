// Persisted appearance choice: Light / Dark (default Light, like the PWA).
// Stored in AsyncStorage so it survives restarts. Mirrors the useI18n pattern.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { syncWidgetTheme } from '@/lib/widget'

export type ThemeMode = 'light' | 'dark'

interface ThemePrefState {
  mode: ThemeMode
  setMode: (m: ThemeMode) => void
}

// Default 'light' so an unwrapped useTheme() still resolves (before hydration).
const ThemePrefContext = createContext<ThemePrefState>({ mode: 'light', setMode: () => {} })
const CACHE = 'oneroof-theme'

export function ThemePrefProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('light')

  useEffect(() => {
    let active = true
    AsyncStorage.getItem(CACHE).then((v) => {
      if (active && (v === 'light' || v === 'dark')) {
        setModeState(v)
        syncWidgetTheme(v)
      }
    })
    return () => {
      active = false
    }
  }, [])

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m)
    AsyncStorage.setItem(CACHE, m).catch(() => {})
    syncWidgetTheme(m)
  }, [])

  return <ThemePrefContext.Provider value={{ mode, setMode }}>{children}</ThemePrefContext.Provider>
}

export function useThemePref(): ThemePrefState {
  return useContext(ThemePrefContext)
}
