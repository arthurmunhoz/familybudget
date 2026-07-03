// Built-in catalog of common stores. Each entry's `slug` is also the logo
// filename: drop the official logo at `public/store-logos/<slug>.svg` and it
// renders automatically; until a file exists, StoreLogo falls back to a
// brand-colored monogram tile (using `color` below). Custom stores added by
// the user have no slug and render a neutral monogram.
//
// `color` is the brand color, used only for the fallback tile — keep it close
// to the real brand so the list still reads right before logos are added.

export interface StoreCatalogEntry {
  slug: string
  name: string
  color: string
}

export const STORE_CATALOG: StoreCatalogEntry[] = [
  { slug: 'publix', name: 'Publix', color: '#007A33' },
  { slug: 'walmart', name: 'Walmart', color: '#0071CE' },
  { slug: 'target', name: 'Target', color: '#CC0000' },
  { slug: 'costco', name: 'Costco', color: '#E31837' },
  { slug: 'samsclub', name: "Sam's Club", color: '#0067A0' },
  { slug: 'bjs', name: "BJ's Wholesale", color: '#D6001C' },
  { slug: 'kroger', name: 'Kroger', color: '#0F4B8F' },
  { slug: 'wholefoods', name: 'Whole Foods Market', color: '#00674B' },
  { slug: 'traderjoes', name: "Trader Joe's", color: '#C8102E' },
  { slug: 'aldi', name: 'Aldi', color: '#1B3F8B' },
  { slug: 'sprouts', name: 'Sprouts', color: '#4B9B3C' },
  { slug: 'winndixie', name: 'Winn-Dixie', color: '#E11B22' },
  { slug: 'freshmarket', name: 'The Fresh Market', color: '#6A1B3D' },
  { slug: 'heb', name: 'H-E-B', color: '#E1251B' },
  { slug: 'safeway', name: 'Safeway', color: '#C8102E' },
  { slug: 'albertsons', name: 'Albertsons', color: '#00529B' },
  { slug: 'wegmans', name: 'Wegmans', color: '#C8102E' },
  { slug: 'foodlion', name: 'Food Lion', color: '#00853E' },
  { slug: 'harristeeter', name: 'Harris Teeter', color: '#00746B' },
  { slug: 'meijer', name: 'Meijer', color: '#C8102E' },
  { slug: 'giant', name: 'Giant', color: '#C8102E' },
  { slug: 'stopandshop', name: 'Stop & Shop', color: '#E03C31' },
  { slug: 'walgreens', name: 'Walgreens', color: '#E31837' },
  { slug: 'cvs', name: 'CVS', color: '#CC0000' },
  { slug: 'amazon', name: 'Amazon', color: '#FF9900' },
  { slug: 'instacart', name: 'Instacart', color: '#0AAD0A' },
]

const BY_SLUG = new Map(STORE_CATALOG.map((s) => [s.slug, s]))

export function catalogBySlug(slug: string | null | undefined): StoreCatalogEntry | undefined {
  return slug ? BY_SLUG.get(slug) : undefined
}

/** First letter, for the monogram fallback tile. */
export function monogram(name: string): string {
  const c = name.trim()[0]
  return c ? c.toUpperCase() : '?'
}

/** Preset palette for custom store tiles (edit sheet color picker). */
export const STORE_COLORS = [
  '#C8102E', // red
  '#E86A33', // clay orange
  '#D97706', // amber
  '#007A33', // green
  '#00746B', // teal
  '#0071CE', // blue
  '#0F4B8F', // navy
  '#6D28D9', // purple
  '#BE185D', // magenta
  '#7C4A2D', // brown
]
