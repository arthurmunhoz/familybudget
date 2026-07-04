// Persisted hub tile density: 'large' (icon + name + description, 2 columns) or
// 'compact' (icon + name, 3 columns) — the PWA's tile_style, per device here.
// Stored in AsyncStorage so it survives restarts. Mirrors useThemePref.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

export type TileStyle = 'large' | 'compact'

interface TilePrefState {
  tile: TileStyle
  setTile: (t: TileStyle) => void
}

const TilePrefContext = createContext<TilePrefState>({ tile: 'large', setTile: () => {} })
const CACHE = 'oneroof-tile'

export function TilePrefProvider({ children }: { children: ReactNode }) {
  const [tile, setTileState] = useState<TileStyle>('large')

  useEffect(() => {
    let active = true
    AsyncStorage.getItem(CACHE).then((v) => {
      if (active && (v === 'large' || v === 'compact')) setTileState(v)
    })
    return () => {
      active = false
    }
  }, [])

  const setTile = useCallback((t: TileStyle) => {
    setTileState(t)
    AsyncStorage.setItem(CACHE, t).catch(() => {})
  }, [])

  return <TilePrefContext.Provider value={{ tile, setTile }}>{children}</TilePrefContext.Provider>
}

export function useTilePref(): TilePrefState {
  return useContext(TilePrefContext)
}
