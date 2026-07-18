// Place search (autocomplete) for saving a place you're NOT standing in —
// "LA Fitness", "Tampa Elementary School" — instead of having to walk there.
//
// Uses the MAPBOX Geocoding API with the token the map already needs, so there's
// no second provider, key or billing account to set up. The entire provider
// surface is this one function: swapping to Google Places later means rewriting
// `searchPlaces` and nothing else.
//
// NOTE on terms: Mapbox's standard geocoding endpoint is the "temporary" one.
// We persist the chosen coordinates as a saved place — if that ever needs to be
// airtight, Mapbox sells a permanent-geocoding entitlement (and Google has its
// own caching rules). Flagged rather than buried.
export interface PlaceSuggestion {
  id: string
  /** Short name, e.g. "LA Fitness". */
  name: string
  /** Full address line, for telling two identically-named results apart. */
  address: string
  lat: number
  lng: number
}

const TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? ''

/** Search POIs/addresses. `near` biases results toward the user so "the gym"
 *  finds theirs, not one three states away. Returns [] on any failure — this is
 *  a convenience, never a blocker for saving a place. */
export async function searchPlaces(
  query: string,
  near?: { lat: number; lng: number } | null,
): Promise<PlaceSuggestion[]> {
  const q = query.trim()
  // Below 3 characters the results are noise and it's just wasted requests.
  if (!TOKEN || q.length < 3) return []
  const proximity = near ? `&proximity=${near.lng},${near.lat}` : ''
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json` +
    `?access_token=${TOKEN}&autocomplete=true&limit=6&types=poi,address,place${proximity}`
  try {
    const res = await fetch(url)
    if (!res.ok) return []
    const json = (await res.json()) as {
      features?: { id?: string; text?: string; place_name?: string; center?: number[] }[]
    }
    return (json.features ?? [])
      .filter((f) => Array.isArray(f.center) && f.center.length === 2)
      .map((f, i) => ({
        id: f.id ?? `${i}`,
        name: f.text || f.place_name || q,
        address: f.place_name || '',
        lat: (f.center as number[])[1],
        lng: (f.center as number[])[0],
      }))
  } catch {
    return []
  }
}
