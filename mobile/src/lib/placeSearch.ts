// Place search (autocomplete) for saving a place you're NOT standing in —
// "LA Fitness", "Tampa Elementary School" — instead of having to walk there.
//
// Uses the MAPBOX SEARCH BOX API with the token the map already needs, so
// there's no second provider, key or billing account to set up. The entire
// provider surface is this one function: swapping to Google Places later means
// rewriting `searchPlaces` and nothing else.
//
// WHY SEARCH BOX AND NOT THE GEOCODING API: this first shipped against
// `geocoding/v5/mapbox.places`, which is a GEOCODER — it resolves addresses and
// place names, and has essentially no business/brand listings. Searching
// "Publix" from downtown Tampa (hundreds of stores within 10 miles) returned
// zero actual stores — just streets whose names contain the word, like "Publix
// Road", 28 miles out. "LA Fitness" returned "La Casa Condos" and a result 8800
// miles away. No amount of proximity biasing or re-sorting fixes that; the
// businesses simply aren't in that index. Search Box IS the POI/brand index and
// returns the real storefronts with street addresses. Don't "simplify" this
// back to the geocoding endpoint.
//
// NOTE on terms: like geocoding, Search Box results are "temporary" by default
// and we persist the chosen coordinates as a saved place. Fine in practice, but
// if that ever needs to be airtight Mapbox sells a permanent entitlement (and
// Google has its own caching rules). Flagged rather than buried.
import { haversineMeters } from './location'

export interface PlaceSuggestion {
  id: string
  /** Short name, e.g. "LA Fitness". */
  name: string
  /** Full address line, for telling two identically-named branches apart. */
  address: string
  lat: number
  lng: number
  /** Metres from the search origin, or null when we had no origin to measure from. */
  distanceM: number | null
}

const TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? ''

/** We ask for more than we show and then re-rank by distance, so the pool we
 *  sort is bigger than the list we display — otherwise the branch down the road
 *  never makes the cut when Mapbox happens to rank it 8th. */
const SHOW = 6
const FETCH = 10

interface SearchBoxFeature {
  geometry?: { coordinates?: number[] }
  properties?: {
    mapbox_id?: string
    name?: string
    full_address?: string
    place_formatted?: string
  }
}

/** Search places near the user.
 *
 *  `near` does two things, and both matter:
 *  1. `proximity` — biases the API toward you, which is what surfaces YOUR gym
 *     rather than the same chain in another state.
 *  2. The sort below — proximity is only a relevance hint, so results still
 *     arrive in Mapbox's own order (a real response for "Tampa Elementary
 *     School" came back 2.0 mi, 12.4 mi, 1.1 mi, 11.1 mi). We measure every
 *     result and order strictly by distance, because "closest first" is what
 *     someone scanning this list is actually looking for.
 *
 *  Returns [] on any failure — this is a convenience, never a blocker for
 *  saving a place. */
export async function searchPlaces(
  query: string,
  near?: { lat: number; lng: number } | null,
): Promise<PlaceSuggestion[]> {
  const q = query.trim()
  // Below 3 characters the results are noise and it's just wasted requests.
  if (!TOKEN || q.length < 3) return []
  const proximity = near ? `&proximity=${near.lng},${near.lat}` : ''
  const url =
    `https://api.mapbox.com/search/searchbox/v1/forward?q=${encodeURIComponent(q)}` +
    `&access_token=${TOKEN}&limit=${FETCH}${proximity}`
  try {
    const res = await fetch(url)
    if (!res.ok) return []
    const json = (await res.json()) as { features?: SearchBoxFeature[] }
    const list = (json.features ?? [])
      .filter((f) => Array.isArray(f.geometry?.coordinates) && f.geometry.coordinates.length === 2)
      .map((f, i) => {
        const [lng, lat] = f.geometry!.coordinates as number[]
        const p = f.properties ?? {}
        return {
          id: p.mapbox_id ?? `${i}`,
          name: p.name || p.full_address || q,
          address: p.full_address || p.place_formatted || '',
          lat,
          lng,
          distanceM: near ? haversineMeters(near, { lat, lng }) : null,
        }
      })
    // Closest first. With no origin we can't measure, so Mapbox's own order stands
    // (it still IP-biases, so results stay roughly local even then).
    if (near) list.sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity))
    return list.slice(0, SHOW)
  } catch {
    return []
  }
}
