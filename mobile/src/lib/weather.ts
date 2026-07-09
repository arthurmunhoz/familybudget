// Weather for the Hub's "Today" section. Uses Open-Meteo — free, no API key, no
// signup (fits the app's no-secrets / privacy-light stance). The household's
// "home city" is set in Settings and stored per-device in AsyncStorage (no
// device-location permission is requested). Geocoding turns the typed city into
// coordinates once; the current temperature + condition are fetched on demand.
import { useCallback, useEffect, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Sun,
  type LucideIcon,
} from 'lucide-react-native'

export interface HomeLocation {
  /** Display label, e.g. "Austin, Texas, US". */
  city: string
  lat: number
  lon: number
}

export interface CurrentWeather {
  temperature: number
  /** WMO weather-interpretation code. */
  code: number
  /** Unit suffix as returned by the API, e.g. "°F". */
  unit: string
}

export type TempUnit = 'fahrenheit' | 'celsius'

/** A noteworthy condition in today's forecast (drives the home alert banner). */
export type WeatherAlertKind = 'thunder' | 'snow' | 'heat' | 'cold' | 'wind' | 'rain'

const KEY = 'weather-home'

export async function loadHomeLocation(): Promise<HomeLocation | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as HomeLocation) : null
  } catch {
    return null
  }
}

export async function saveHomeLocation(loc: HomeLocation | null): Promise<void> {
  try {
    if (loc) await AsyncStorage.setItem(KEY, JSON.stringify(loc))
    else await AsyncStorage.removeItem(KEY)
  } catch {
    /* best effort */
  }
}

/** Resolve a typed city name to its first match (Open-Meteo geocoding). */
export async function geocodeCity(name: string): Promise<HomeLocation | null> {
  const q = name.trim()
  if (!q) return null
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
      q,
    )}&count=1&language=en&format=json`
    const res = await fetch(url)
    if (!res.ok) return null
    const json = (await res.json()) as {
      results?: { name: string; admin1?: string; country_code?: string; latitude: number; longitude: number }[]
    }
    const r = json.results?.[0]
    if (!r) return null
    const label = [r.name, r.admin1, r.country_code].filter(Boolean).join(', ')
    return { city: label, lat: r.latitude, lon: r.longitude }
  } catch {
    return null
  }
}

/** Up to `limit` city matches for a typed query (Open-Meteo geocoding) — powers
 *  the Settings autocomplete. Returns [] for short/empty queries or on failure. */
export async function searchCities(name: string, limit = 5): Promise<HomeLocation[]> {
  const q = name.trim()
  if (q.length < 2) return []
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
      q,
    )}&count=${limit}&language=en&format=json`
    const res = await fetch(url)
    if (!res.ok) return []
    const json = (await res.json()) as {
      results?: { name: string; admin1?: string; country_code?: string; latitude: number; longitude: number }[]
    }
    return (json.results ?? []).map((r) => ({
      city: [r.name, r.admin1, r.country_code].filter(Boolean).join(', '),
      lat: r.latitude,
      lon: r.longitude,
    }))
  } catch {
    return []
  }
}

/** Inspect TODAY's forecast and return the single most-notable alert, or null.
 *  Priority: thunderstorm > heavy snow > extreme heat > extreme cold > wind >
 *  rain. Thresholds are evaluated in the requested unit; wind uses km/h gusts. */
export async function fetchDayAlert(
  lat: number,
  lon: number,
  unit: TempUnit = 'fahrenheit',
): Promise<WeatherAlertKind | null> {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&daily=weather_code,apparent_temperature_max,apparent_temperature_min,precipitation_probability_max,wind_gusts_10m_max` +
      `&temperature_unit=${unit}&wind_speed_unit=kmh&timezone=auto&forecast_days=1`
    const res = await fetch(url)
    if (!res.ok) return null
    const json = (await res.json()) as {
      daily?: {
        weather_code?: number[]
        apparent_temperature_max?: number[]
        apparent_temperature_min?: number[]
        precipitation_probability_max?: number[]
        wind_gusts_10m_max?: number[]
      }
    }
    const d = json.daily
    if (!d) return null
    const code = d.weather_code?.[0] ?? 0
    const tHi = d.apparent_temperature_max?.[0]
    const tLo = d.apparent_temperature_min?.[0]
    const pop = d.precipitation_probability_max?.[0] ?? 0
    const gust = d.wind_gusts_10m_max?.[0] ?? 0 // km/h
    const hot = unit === 'celsius' ? 37 : 99
    const cold = unit === 'celsius' ? 0 : 32
    if (code >= 95) return 'thunder'
    if (code === 75 || code === 77 || code === 86) return 'snow' // heavy snow / grains / heavy showers
    if (tHi != null && tHi >= hot) return 'heat'
    if (tLo != null && tLo <= cold) return 'cold'
    if (gust >= 55) return 'wind' // ~34 mph gusts
    if (pop >= 60) return 'rain'
    return null
  } catch {
    return null
  }
}

/** Current temperature + condition code for a coordinate. */
export async function fetchCurrentWeather(
  lat: number,
  lon: number,
  unit: TempUnit = 'fahrenheit',
): Promise<CurrentWeather | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&temperature_unit=${unit}`
    const res = await fetch(url)
    if (!res.ok) return null
    const json = (await res.json()) as {
      current?: { temperature_2m: number; weather_code: number }
      current_units?: { temperature_2m?: string }
    }
    const cur = json.current
    if (!cur) return null
    return {
      temperature: Math.round(cur.temperature_2m),
      code: cur.weather_code,
      unit: json.current_units?.temperature_2m ?? (unit === 'celsius' ? '°C' : '°F'),
    }
  } catch {
    return null
  }
}

/** Map a WMO weather code to an outline weather icon. */
export function weatherIcon(code: number): LucideIcon {
  if (code === 0) return Sun
  if (code <= 2) return CloudSun
  if (code === 3) return Cloud
  if (code === 45 || code === 48) return CloudFog
  if (code >= 51 && code <= 57) return CloudDrizzle
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return CloudRain
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return CloudSnow
  if (code >= 95) return CloudLightning
  return Cloud
}

/** Home location + its current weather + today's alert, reloadable (e.g. on
 *  screen focus). */
export function useHomeWeather(unit: TempUnit) {
  const [location, setLocation] = useState<HomeLocation | null>(null)
  const [weather, setWeather] = useState<CurrentWeather | null>(null)
  const [alert, setAlert] = useState<WeatherAlertKind | null>(null)
  const [ready, setReady] = useState(false)

  const reload = useCallback(async () => {
    const loc = await loadHomeLocation()
    setLocation(loc)
    setReady(true)
    if (!loc) {
      setWeather(null)
      setAlert(null)
      return
    }
    const [w, a] = await Promise.all([
      fetchCurrentWeather(loc.lat, loc.lon, unit),
      fetchDayAlert(loc.lat, loc.lon, unit),
    ])
    setWeather(w)
    setAlert(a)
  }, [unit])

  useEffect(() => {
    void reload()
  }, [reload])

  return { location, weather, alert, ready, reload }
}
