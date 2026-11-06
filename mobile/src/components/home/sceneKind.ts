// Which sky the Home's header paints (WeatherScene), from the WMO code and
// day/night. Kept apart from the component so Fast Refresh stays happy.
export type SceneKind = 'clear' | 'partly' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'storm' | 'night' | 'nightCloudy'

export function sceneFor(code: number, isDay = true): SceneKind {
  const night = !isDay
  if (code >= 95) return 'storm'
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return 'snow'
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain'
  if (code === 45 || code === 48) return 'fog'
  if (code === 3) return night ? 'nightCloudy' : 'cloudy'
  if (code === 1 || code === 2) return night ? 'nightCloudy' : 'partly'
  return night ? 'night' : 'clear'
}
