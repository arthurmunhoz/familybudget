// The ask bar's offline parser — the phrasings it must get right without the
// server (lib/assistant.ts `localParse`).
jest.mock('@/lib/supabase', () => ({ supabase: {} }))

import { localParse } from '@/lib/assistant'

const TODAY = '2026-11-05'

describe('localParse — add to a list', () => {
  it.each([
    ['adicione leite e pão na lista do Walmart', ['Leite', 'Pão'], 'Walmart'],
    ['coloca ovos, café e detergente na lista do Costco', ['Ovos', 'Café', 'Detergente'], 'Costco'],
    ['add milk and bread to the Walmart list', ['Milk', 'Bread'], 'Walmart'],
    ['agrega leche y pan a la lista de Walmart', ['Leche', 'Pan'], 'Walmart'],
    ['adicione leite na lista', ['Leite'], ''],
    ['add eggs', ['Eggs'], ''],
  ])('%s', (text, items, store) => {
    expect(localParse(text, TODAY)).toEqual({ intent: 'add_items', items, store })
  })
})

describe('localParse — agenda', () => {
  it('today for me', () => {
    expect(localParse('o que tem pra hoje pra mim?', TODAY)).toEqual({
      intent: 'agenda',
      scope: 'me',
      person: '',
      date: TODAY,
    })
  })
  it('tomorrow for everyone', () => {
    expect(localParse('o que tem amanhã pra todos?', TODAY)).toMatchObject({ scope: 'all', date: '2026-11-06' })
    expect(localParse("what's on tomorrow for everyone?", TODAY)).toMatchObject({ scope: 'all', date: '2026-11-06' })
  })
  it('month rollover', () => {
    expect(localParse('agenda de amanhã', '2026-11-30')).toMatchObject({ date: '2026-12-01' })
  })
})

it('unknown requests stay unknown', () => {
  expect(localParse('qual a capital da França?', TODAY)).toBeNull()
})
