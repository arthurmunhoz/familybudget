import { duelFirstLeg, type GameSession } from '@/lib/games'

const s = (id: string, from: string, to: string, at: string) =>
  ({ id, mode: 'async', game: 'hangman', status: 'done', host_email: from, created_at: at, state: { guesser: to } }) as unknown as GameSession

describe('duelFirstLeg', () => {
  const a1 = s('1', 'a', 'b', '2026-11-01')
  const b1 = s('2', 'b', 'a', '2026-11-02')
  const a2 = s('3', 'a', 'b', '2026-11-03')
  const a3 = s('4', 'a', 'b', '2026-11-04')
  const b2 = s('5', 'b', 'a', '2026-11-05')
  const all = [a1, b1, a2, a3, b2]
  it('the reply closes the duel', () => expect(duelFirstLeg(all, b1)?.id).toBe('1'))
  it('the first leg does not', () => expect(duelFirstLeg(all, a1)).toBeNull())
  it('resets after a duel', () => expect(duelFirstLeg(all, a2)).toBeNull())
  it('same direction twice: the latest one opens', () => expect(duelFirstLeg(all, b2)?.id).toBe('4'))
  it('works before the list has the current game', () => expect(duelFirstLeg([a1], b1)?.id).toBe('1'))
})
