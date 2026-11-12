// The games' colours. Gradients are identity (fixed in both themes, like the
// Home's app icons); everything around them uses theme tokens.
import type { Gradient } from '@/components/home/palette'
import type { Team } from '@/lib/games'

/** The Games app itself — coral into berry, the One Roof icon's own sky. */
export const GAMES_GRADIENT: Gradient = ['#FF8A5B', '#D9466F']

export const TEAM_GRADIENT: Record<Team, Gradient> = {
  A: ['#FFB24D', '#F0700F'], // orange
  B: ['#B57CFF', '#7340E0'], // purple
}
export const TEAM_SOLID: Record<Team, string> = { A: '#F07A12', B: '#8048EA' }
/** Very light tints for washes and soft fills. */
export const TEAM_SOFT: Record<Team, string> = { A: 'rgba(240,122,18,0.14)', B: 'rgba(128,72,234,0.14)' }
/** Confetti in a team's own colours (plus white sparkle). */
export const TEAM_CONFETTI: Record<Team, string[]> = {
  A: ['#FFB24D', '#F0700F', '#FFD08A', '#FF9A3C', '#ffffff'],
  B: ['#B57CFF', '#7340E0', '#D9B8FF', '#9A5CF5', '#ffffff'],
}

export const COVER = {
  hangman: ['#FF9B6A', '#D9466F'] as Gradient,
  battleship: ['#38C6F5', '#2563D9'] as Gradient,
  quiz: ['#B57CFF', '#6E3FD8'] as Gradient,
}

/** Pieces of the hangman house = wrong guesses allowed (server: max_wrong). */
export const HOUSE_PIECES = 7

export const other = (t: Team): Team => (t === 'A' ? 'B' : 'A')

/** Quiz category → its colours (question card strip, chips). */
export const QUIZ_CAT: Record<string, Gradient> = {
  general: ['#B57CFF', '#7140D6'],
  geography: ['#5B9BFF', '#2563D9'],
  science: ['#3EC2C8', '#127F86'],
  animals: ['#FFB45C', '#F2862A'],
  sports: ['#FFCB4D', '#E39A00'],
  food: ['#FF8A8A', '#E8506A'],
  brazil: ['#3FD3A0', '#0FA37F'],
}

/** Game ACTIONS (start, play again, next, create room…): cyan → blue. Never
 *  orange or purple — those are the teams, and an action in a team's colour
 *  read as "theirs" (owner, 2026-11: the old clay buttons looked brown). */
export const GAME_ACTION: readonly [string, string] = ['#1FB5CC', '#1A62D6']
export const GAME_ACTION_SOLID = '#1C7FD8'
