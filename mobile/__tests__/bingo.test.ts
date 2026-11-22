import { canCall, covered, finishedLine, leftForFull, leftForLine, leftNow, letterOf, LINES } from '@/apps/games/bingo/logic'

// A fixed card: column c holds c*15+1 … c*15+5 top to bottom, centre free.
const card = Array.from({ length: 25 }, (_, i) => (i === 12 ? 0 : (i % 5) * 15 + Math.floor(i / 5) + 1))

describe('bingo rules', () => {
  it('letters by column', () => {
    expect([1, 15, 16, 30, 31, 45, 46, 60, 61, 75].map(letterOf).join('')).toBe('BBIINNGGOO')
  })
  it('twelve lines of five, each cell index valid', () => {
    expect(LINES).toHaveLength(12)
    for (const l of LINES) expect(l.every((i) => i >= 0 && i < 25) && new Set(l).size === 5).toBe(true)
  })
  it('only the free centre is covered at the start', () => {
    expect(covered(card, []).filter(Boolean)).toHaveLength(1)
    expect(leftForFull(card, [])).toBe(24)
    // The lines through the centre need four.
    expect(leftForLine(card, [])).toBe(4)
    expect(finishedLine(card, [])).toBeNull()
  })
  it('a row, a column and a diagonal', () => {
    const row0 = [0, 1, 2, 3, 4].map((i) => card[i])
    expect(finishedLine(card, row0)).toEqual([0, 1, 2, 3, 4])
    const col2 = [2, 7, 17, 22].map((i) => card[i]) // the centre is free
    expect(finishedLine(card, col2)).toEqual([2, 7, 12, 17, 22])
    const diag = [0, 6, 18, 24].map((i) => card[i])
    expect(finishedLine(card, diag)).toEqual([0, 6, 12, 18, 24])
    expect(leftForLine(card, diag.slice(0, 3))).toBe(1)
  })
  it('a number that is not on the card covers nothing', () => {
    expect(leftForFull(card, [75, 74, 73])).toBe(24)
  })
  it('what may be called', () => {
    const row0 = [0, 1, 2, 3, 4].map((i) => card[i])
    const all = card.filter((n) => n)
    expect(canCall(card, [], 'line', false)).toBeNull()
    expect(canCall(card, row0, 'line', false)).toBe('line')
    // Playing for the whole card: the first line is called once…
    expect(canCall(card, row0, 'full', false)).toBe('line')
    // …and after someone took it, only the whole card counts.
    expect(canCall(card, row0, 'full', true)).toBeNull()
    expect(canCall(card, all, 'full', true)).toBe('full')
    expect(canCall(card, all, 'line', false)).toBe('full')
    expect(canCall([], [], 'line', false)).toBeNull()
  })
  it('how far a player is from what they chase', () => {
    const row0 = [0, 1, 2, 3].map((i) => card[i])
    expect(leftNow(card, row0, 'line', false)).toBe(1)
    expect(leftNow(card, row0, 'full', false)).toBe(1)
    expect(leftNow(card, row0, 'full', true)).toBe(20)
  })
})
