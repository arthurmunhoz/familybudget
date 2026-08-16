// Persisted hub tile density: 'large' (icon + name + description, 2 columns) or
// 'compact' (icon + name, 3 columns) — the PWA's tile_style, per device here.
// Stored in AsyncStorage so it survives restarts. Mirrors useThemePref.
//
// COMPACT is the default. The descriptions on the large tiles explain the apps
// once and then cost a column forever; at three across the whole hub fits above
// the fold with the Today card and any banners still visible, which is what the
// home screen is for. Anyone who has actually chosen a density keeps it — the
// stored value always wins over this default — but an install that never
// touched the setting gets compact.
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

const TilePrefContext = createContext<TilePrefState>({ tile: 'compact', setTile: () => {} })
const CACHE = 'oneroof-tile'

export function TilePrefProvider({ children }: { children: ReactNode }) {
  const [tile, setTileState] = useState<TileStyle>('compact')

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
