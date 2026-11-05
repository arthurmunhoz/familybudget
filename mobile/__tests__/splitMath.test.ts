/**
 * Bill-split maths (apps/calc/splitMath.ts). The property that matters: the
 * shares always add back up to the bill, to the cent — no lost or invented
 * pennies — however unevenly it divides.
 */
import { apportion, evenSplit, itemSplit, tipAmount, type SplitItem } from '@/apps/calc/splitMath'

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0)
const cents = (n: number) => Math.round(n * 100)

describe('apportion', () => {
  it('hands out the leftover cents one at a time', () => {
    expect(apportion(10000, 3)).toEqual([3334, 3333, 3333])
    expect(apportion(1, 4)).toEqual([1, 0, 0, 0])
    expect(sum(apportion(98765, 7))).toBe(98765)
  })
  it('follows weights', () => {
    expect(apportion(1000, 2, [3, 1])).toEqual([750, 250])
    expect(sum(apportion(1001, 3, [1, 2, 4]))).toBe(1001)
  })
  it('degrades to zeros on no weight', () => {
    expect(apportion(500, 2, [0, 0])).toEqual([0, 0])
    expect(apportion(500, 0)).toEqual([])
  })
})

describe('evenSplit', () => {
  it('adds the tip and divides', () => {
    const r = evenSplit(90, 3, 20)
    expect(r.tip).toBe(18)
    expect(r.total).toBe(108)
    expect(r.per).toBe(36)
    expect(r.extraCentCount).toBe(0)
  })
  it('reports the people who pay an extra cent', () => {
    const r = evenSplit(100, 3, 0)
    expect(r.per).toBe(33.33)
    expect(r.extraCentCount).toBe(1)
    expect(cents(r.per) * 3 + r.extraCentCount).toBe(10000)
  })
  it('treats fewer than one person as one', () => {
    expect(evenSplit(50, 0, 10).per).toBe(55)
  })
})

describe('itemSplit', () => {
  const items: SplitItem[] = [
    { id: '1', name: 'Burger', price: 15, people: ['Ana'] },
    { id: '2', name: 'Salad', price: 12, people: ['Bia'] },
    { id: '3', name: 'Fries', price: 7, people: ['Ana', 'Bia', 'Caio'] },
  ]

  it('shares items equally and extras by what each ordered', () => {
    const r = itemSplit(items, ['Ana', 'Bia', 'Caio'], 3.4, { kind: 'pct', pct: 20 })
    expect(r.subtotal).toBe(34)
    expect(r.tip).toBe(6.8)
    expect(r.total).toBe(44.2)
    expect(cents(sum(r.people.map((p) => p.total)))).toBe(4420)
    const ana = r.people.find((p) => p.name === 'Ana')!
    expect(ana.items.map((i) => i.ways)).toEqual([1, 3])
    expect(ana.base).toBeCloseTo(17.34, 2)
  })

  it('leaves unassigned items (and their part of the extras) out', () => {
    const r = itemSplit(
      [...items, { id: '4', name: 'Wine', price: 30, people: [] }],
      ['Ana', 'Bia', 'Caio'],
      0,
      { kind: 'amount', amount: 12.8 },
    )
    expect(r.unassigned.map((i) => i.id)).toEqual(['4'])
    // 34 of 64 assigned → 34/64 of the 12.80 tip is handed out.
    expect(cents(sum(r.people.map((p) => p.total)))).toBe(3400 + 680)
  })

  it('ignores people who were removed but still tagged on an item', () => {
    const r = itemSplit(items, ['Ana', 'Bia'], 0, { kind: 'pct', pct: 0 })
    expect(cents(sum(r.people.map((p) => p.total)))).toBe(3400)
  })

  it('computes a percentage tip on the subtotal', () => {
    expect(tipAmount(33.33, { kind: 'pct', pct: 18 })).toBe(6)
    expect(tipAmount(10, { kind: 'amount', amount: 2.5 })).toBe(2.5)
  })
})

describe('num (typed amounts)', () => {
  // Imported lazily: shared.tsx pulls in React Native UI.
  const { num } = require('@/apps/calc/shared') as typeof import('@/apps/calc/shared')
  it('reads a lone comma as the decimal separator (pt/es keypads)', () => {
    expect(num('12,50')).toBe(12.5)
    expect(num('0,5')).toBe(0.5)
  })
  it('reads commas beside a dot as thousands separators', () => {
    expect(num('1,234.50')).toBe(1234.5)
    expect(num('1,234,567')).toBe(1234567)
  })
  it('treats blank or garbage as zero', () => {
    expect(num('')).toBe(0)
    expect(num('abc')).toBe(0)
  })
})
