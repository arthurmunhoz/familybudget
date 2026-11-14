import { groupIds, matchGroups, MAX_SCAN_LIST_ITEMS, scanListPayload } from '../src/lib/receiptMatches'
import type { ShoppingItem, ShoppingStore } from '../src/lib/types'

const store = (id: string, name: string): ShoppingStore => ({
  id,
  household_id: 'h',
  name,
  slug: null,
  color: null,
  created_at: '2026-01-01',
})
const item = (id: string, label: string, store_id: string | null, checked = false): ShoppingItem => ({
  id,
  label,
  checked,
  added_by: 'a@x',
  created_at: '2026-01-01',
  checked_at: checked ? '2026-01-02' : null,
  store_id,
})

const stores = [store('s1', 'Publix'), store('s2', 'Target')]

describe('scanListPayload', () => {
  it('names each item with its list, General for none or a deleted store', () => {
    const open = [item('a', '  leite  integral ', 's1'), item('b', 'camisetas', null), item('c', 'pilhas', 'gone')]
    expect(scanListPayload(open, stores, 'General')).toEqual([
      { id: 'a', name: 'leite integral', list: 'Publix' },
      { id: 'b', name: 'camisetas', list: 'General' },
      { id: 'c', name: 'pilhas', list: 'General' },
    ])
  })
  it('skips checked and blank items and caps the size', () => {
    expect(scanListPayload([item('a', 'x', null, true), item('b', '   ', null)], stores, 'G')).toEqual([])
    const many = Array.from({ length: 200 }, (_, i) => item(`i${i}`, `thing ${i}`, null))
    expect(scanListPayload(many, stores, 'G')).toHaveLength(MAX_SCAN_LIST_ITEMS)
  })
})

describe('matchGroups', () => {
  const open = [
    item('milk', 'leite', 's1'),
    item('shirts', 'camisetas', 's2'),
    item('fruit', 'frutas', null),
    item('bread', 'pão', 's1'),
    item('glue', 'cola', 'gone'),
  ]
  it('groups by list in store order, General last', () => {
    const g = matchGroups(['fruit', 'shirts', 'milk', 'bread', 'glue'], open, stores)
    expect(g.map((x) => x.store?.name ?? null)).toEqual(['Publix', 'Target', null])
    expect(g[0].items.map((i) => i.id)).toEqual(['milk', 'bread'])
    expect(g[2].items.map((i) => i.id)).toEqual(['fruit', 'glue'])
    expect(groupIds(g)).toEqual(['milk', 'bread', 'shirts', 'fruit', 'glue'])
  })
  it('drops ids that are no longer open or never existed', () => {
    const now = open.map((i) => (i.id === 'milk' ? { ...i, checked: true } : i)).filter((i) => i.id !== 'shirts')
    const g = matchGroups(['milk', 'shirts', 'nope', 'bread'], now, stores)
    expect(groupIds(g)).toEqual(['bread'])
  })
  it('is empty when nothing matched', () => {
    expect(matchGroups([], open, stores)).toEqual([])
    expect(matchGroups(['x'], [], stores)).toEqual([])
  })
})
