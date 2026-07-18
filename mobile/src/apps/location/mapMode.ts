// Which map style Whereabouts is showing, and remembering it between launches.
//
// Split out of MapModePicker so that file exports only its component: mixing
// hooks/helpers with a component breaks Fast Refresh (react-refresh warns about
// exactly this). Lives under apps/ rather than lib/ because it touches
// @rnmapbox/maps, which the lib layer deliberately doesn't import.
import { useEffect, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Mapbox from '@rnmapbox/maps'

export type MapMode = 'standard' | 'satellite' | 'terrain'

const STORAGE_KEY = 'oneroof-map-mode'

/** The style URL for a mode.
 *
 *  `standard` is the one that still follows the app's theme and any custom
 *  Mapbox Studio style — that's the house look, and switching to Dusk should
 *  keep it. Satellite and terrain are imagery: they look the same in either
 *  theme, because there is no dark version of a photograph of the ground.
 *
 *  Satellite deliberately uses satellite-STREETS: bare satellite carries no road
 *  or place labels, which makes "where is she exactly" harder, not easier. */
export function resolveStyleURL(
  mode: MapMode,
  dark: boolean,
  customLight: string,
  customDark: string,
): string {
  if (mode === 'satellite') return Mapbox.StyleURL.SatelliteStreet
  if (mode === 'terrain') return Mapbox.StyleURL.Outdoors
  return dark
    ? customDark || customLight || Mapbox.StyleURL.Dark
    : customLight || Mapbox.StyleURL.Light
}

/** Remembered across launches — a map style is a preference, not a per-visit
 *  choice. Failures are swallowed: the default is a perfectly good map. */
export function useStoredMapMode(): [MapMode, (m: MapMode) => void] {
  const [mode, setMode] = useState<MapMode>('standard')
  useEffect(() => {
    let active = true
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => {
        if (active && (v === 'satellite' || v === 'terrain' || v === 'standard')) setMode(v)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])
  const choose = (m: MapMode) => {
    setMode(m)
    void AsyncStorage.setItem(STORAGE_KEY, m).catch(() => {})
  }
  return [mode, choose]
}
