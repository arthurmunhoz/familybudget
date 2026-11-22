// Bingo's colours: one per column (B I N G O), used by the balls, the card's
// header and the dabs. Fixed in both themes, like every game's identity.
export const BALL_COLOR = ['#3B82F6', '#EF4B5A', '#F5A300', '#22B07D', '#8B5CF6'] as const
/** The lit and the shadowed side of each colour: what makes a ball a sphere. */
export const BALL_LIGHT = ['#9CC2FF', '#FFA3AB', '#FFD877', '#7BE6BD', '#C9B0FF'] as const
export const BALL_DARK = ['#1B49B4', '#B01C31', '#B06E00', '#0C6E4B', '#5329BD'] as const
/** The winning line / the BINGO button: gold. */
export const GOLD: readonly [string, string] = ['#FFCB45', '#F08A00']
