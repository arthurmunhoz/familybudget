import {
  applyOrder,
  buildDeck,
  fitFor,
  frameLimit,
  isNight,
  kenBurns,
  limitKind,
  resizeTarget,
  type Slide,
} from '../src/apps/calc/frame/frameLogic'

/** Small deterministic PRNG so the shuffles are repeatable. */
function seeded(seed: number) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

const slide = (id: string, memberEmail: string | null = null): Slide => ({ id, uri: `file:///${id}.jpg`, source: 'family', memberEmail })

describe('photo frame logic', () => {
  test('limits mirror migration 100', () => {
    expect(frameLimit(false)).toBe(30)
    expect(frameLimit(true)).toBe(500)
  })

  test('server errors map to the right upsell', () => {
    expect(limitKind('new row violates … free_plan_frame_limit')).toBe('free')
    expect(limitKind('frame_photo_limit')).toBe('plus')
    expect(limitKind('permission denied')).toBeNull()
    expect(limitKind(undefined)).toBeNull()
  })

  test('resize keeps the long side at 1600 and never upscales', () => {
    expect(resizeTarget(4032, 3024)).toEqual({ width: 1600 })
    expect(resizeTarget(3024, 4032)).toEqual({ height: 1600 })
    expect(resizeTarget(1200, 900)).toBeNull()
    expect(resizeTarget(1600, 1600)).toBeNull()
  })

  test('night window, including one that crosses midnight', () => {
    const at = (h: number, m = 0) => h * 60 + m
    expect(isNight(at(23), 22, 7)).toBe(true)
    expect(isNight(at(3), 22, 7)).toBe(true)
    expect(isNight(at(7), 22, 7)).toBe(false)
    expect(isNight(at(21, 59), 22, 7)).toBe(false)
    expect(isNight(at(14), 13, 15)).toBe(true)
    expect(isNight(at(15), 13, 15)).toBe(false)
    expect(isNight(at(10), 8, 8)).toBe(false) // same hour = off
  })

  test('the deck plays every photo once per pass', () => {
    const all = ['a', 'b', 'c', 'd', 'e'].map((id) => slide(id))
    const deck = buildDeck(all, [], seeded(7))
    expect(deck.map((s) => s.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  test('saved order: new photos lead, the rest as dragged', () => {
    const all = ['n', 'a', 'b', 'c'].map((id) => slide(id))
    expect(applyOrder(all, ['c', 'a', 'gone', 'b']).map((s) => s.id)).toEqual(['n', 'c', 'a', 'b'])
  })

  test('random off keeps the given order', () => {
    const all = ['a', 'b', 'c', 'd'].map((id) => slide(id))
    expect(buildDeck(all, [], seeded(7), false).map((s) => s.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  test("on a birthday that member's photos lead and alternate", () => {
    const all = [slide('a'), slide('b', 'sam@x'), slide('c'), slide('d', 'SAM@x'), slide('e'), slide('f')]
    const deck = buildDeck(all, ['sam@x'], seeded(3))
    expect(deck).toHaveLength(6)
    expect(deck[0].memberEmail?.toLowerCase()).toBe('sam@x')
    expect(deck[2].memberEmail?.toLowerCase()).toBe('sam@x')
    expect(deck.slice(4).every((s) => !s.memberEmail)).toBe(true)
  })

  test('a birthday with no tagged photos is just a shuffle', () => {
    const all = [slide('a'), slide('b')]
    expect(buildDeck(all, ['ana@x'], seeded(1))).toHaveLength(2)
  })

  test('fit: cover when shapes agree, contain when they fight', () => {
    expect(fitFor(4000, 3000, 1024, 768)).toBe('cover')
    expect(fitFor(3000, 4000, 1024, 768)).toBe('contain')
    expect(fitFor(1080, 1920, 390, 844)).toBe('cover')
    expect(fitFor(3000, 4000, 390, 844)).toBe('contain') // 3:4 on a tall phone would lose too much
    expect(fitFor(null, null, 390, 844)).toBe('cover')
  })

  test('Ken Burns is stable per photo', () => {
    expect(kenBurns('abc')).toEqual(kenBurns('abc'))
    const k = kenBurns('xyz')
    expect(Math.abs(k.to - k.from)).toBeGreaterThan(0.05)
  })
})
