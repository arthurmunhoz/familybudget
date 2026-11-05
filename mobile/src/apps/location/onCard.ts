// Colours for content sitting on a member's gradient card (MemberCardShell).
// Kept out of the component files so Fast Refresh stays happy.
export const ON_CARD = {
  /** tiles and buttons */
  soft: 'rgba(255,255,255,0.18)',
  text: '#fff',
  muted: 'rgba(255,255,255,0.86)',
  /** the avatar's ring */
  ring: 'rgba(255,255,255,0.9)',
} as const

/** Each Whereabouts feature's own colour — its header chip, its sheet's
 *  accents and its docked button share it, so a feature is recognisable
 *  wherever it shows up. */
export const FEATURE = {
  places: '#E2683F',
  safety: '#14857A',
  sharing: '#6A4BD0',
} as const
