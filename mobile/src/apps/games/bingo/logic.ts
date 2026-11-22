// Bingo's pure rules (75-ball, 5×5, free centre) — the same checks the server
// makes in bingo_call (migration 121), used here only to light things up: the
// server decides who won. Pinned by __tests__/bingo.test.ts.

export const LETTERS = ['B', 'I', 'N', 'G', 'O'] as const

/** 1–15 → B, 16–30 → I, … 61–75 → O. */
export const letterOf = (n: number) => LETTERS[Math.min(4, Math.max(0, Math.floor((n - 1) / 15)))]
export const columnOf = (n: number) => Math.min(4, Math.max(0, Math.floor((n - 1) / 15)))

/** The 12 lines of a card, as cell indexes (row-major). */
export const LINES: number[][] = [
  [0, 1, 2, 3, 4],
  [5, 6, 7, 8, 9],
  [10, 11, 12, 13, 14],
  [15, 16, 17, 18, 19],
  [20, 21, 22, 23, 24],
  [0, 5, 10, 15, 20],
  [1, 6, 11, 16, 21],
  [2, 7, 12, 17, 22],
  [3, 8, 13, 18, 23],
  [4, 9, 14, 19, 24],
  [0, 6, 12, 18, 24],
  [4, 8, 12, 16, 20],
]

/** Which cells are covered: the free centre and every MARKED number. */
export function covered(card: number[], marks: number[]): boolean[] {
  const m = new Set(marks)
  return card.map((n) => n === 0 || m.has(n))
}

/** The first finished line, or null. */
export function finishedLine(card: number[], marks: number[]): number[] | null {
  const ok = covered(card, marks)
  return LINES.find((l) => l.every((i) => ok[i])) ?? null
}

/** How many numbers the closest line still needs (0 = a line is done). */
export function leftForLine(card: number[], marks: number[]): number {
  const ok = covered(card, marks)
  return Math.min(...LINES.map((l) => l.filter((i) => !ok[i]).length))
}

/** How many numbers the whole card still needs. */
export function leftForFull(card: number[], marks: number[]): number {
  return covered(card, marks).filter((x) => !x).length
}

/** What a player may call right now — mirrors bingo_call. */
export function canCall(card: number[], marks: number[], goal: 'line' | 'full', lineTaken: boolean): 'full' | 'line' | null {
  if (!card.length) return null
  if (leftForFull(card, marks) === 0) return 'full'
  if (finishedLine(card, marks) && (goal === 'line' || !lineTaken)) return 'line'
  return null
}

/** What the player is chasing now, and how far they are. */
export function leftNow(card: number[], marks: number[], goal: 'line' | 'full', lineTaken: boolean): number {
  if (!card.length) return 99
  return goal === 'line' || !lineTaken ? Math.min(leftForLine(card, marks), leftForFull(card, marks)) : leftForFull(card, marks)
}
