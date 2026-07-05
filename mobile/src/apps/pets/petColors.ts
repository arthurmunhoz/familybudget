// Per-pet calendar colors for Pet Care. A pet's dot color is its saved
// `tag_color` (chosen from PET_PALETTE), else a stable palette color by the
// pet's position in the household's alphabetical roster — so each pet keeps a
// consistent color across the calendar and the upcoming list even before anyone
// picks one.
import type { Pet } from '@/lib/types'

export const PET_PALETTE = [
  '#c2603f', // clay (brand)
  '#3c7d58', // green
  '#3f6ea5', // blue
  '#a3568c', // plum
  '#c99a2e', // amber
  '#4f9d9d', // teal
  '#b5503f', // rust
  '#6d6aa8', // violet
]

export function defaultPetColor(index: number): string {
  return PET_PALETTE[((index % PET_PALETTE.length) + PET_PALETTE.length) % PET_PALETTE.length]
}

/** The color for a pet given its index in the sorted roster. */
export function petColor(pet: Pet | undefined, index: number): string {
  return pet?.tag_color || defaultPetColor(index)
}

/** Build a petId → color map from the sorted roster (tag_color, else palette). */
export function petColorMap(sortedPets: Pet[]): Record<string, string> {
  const out: Record<string, string> = {}
  sortedPets.forEach((p, i) => {
    out[p.id] = petColor(p, i)
  })
  return out
}
