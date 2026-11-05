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
      end: TODAY,
      label: '',
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

import { fromServer, petQuestion } from '@/lib/assistant'

describe('generic lists are not stores (owner report 2026-11)', () => {
  it('"lista de compras" asks instead of creating a store called "compras"', () => {
    expect(localParse('adicione óleo de cozinha na lista de compras', TODAY)).toEqual({
      intent: 'add_items',
      items: ['Óleo de cozinha'],
      store: '',
    })
    expect(localParse('add milk to the shopping list', TODAY)).toMatchObject({ store: '' })
  })
})

describe('localParse — reading the list', () => {
  it('whole list', () => {
    expect(localParse('o que tem na minha lista de compras?', TODAY)).toEqual({ intent: 'list_items', store: '' })
  })
  it('one store', () => {
    expect(localParse('o que tem na lista do Walmart?', TODAY)).toEqual({ intent: 'list_items', store: 'walmart' })
  })
})

describe('fromServer', () => {
  it('maps money, events and nudges', () => {
    expect(
      fromServer({ intent: 'add_money', title: 'Mercado', amount: 50, money_type: 'expense', date: '2026-11-05', budget: '' }, TODAY),
    ).toEqual({ intent: 'add_money', title: 'Mercado', amount: 50, type: 'expense', date: '2026-11-05', budget: '' })
    expect(fromServer({ intent: 'add_event', title: 'Dentista', date: '2026-11-07', time: '15:00', person: '' }, TODAY)).toEqual({
      intent: 'add_event',
      title: 'Dentista',
      date: '2026-11-07',
      time: '15:00',
      person: '',
    })
    expect(fromServer({ intent: 'send_nudge', title: 'Chego às 19h', person: 'Léo' }, TODAY)).toEqual({
      intent: 'send_nudge',
      message: 'Chego às 19h',
      person: 'Léo',
    })
  })
  it('rejects unusable answers (an old deploy, a zero amount)', () => {
    expect(fromServer({ kind: 'custom', emoji: '📣', message: 'x' }, TODAY)).toBeNull()
    expect(fromServer({ intent: 'add_money', amount: 0 }, TODAY)).toBeNull()
  })
})

describe('asking whether something is on the list', () => {
  it('local phrasing', () => {
    expect(localParse('tem leite na lista?', TODAY)).toEqual({ intent: 'find_items', items: ['leite'], reply: '' })
    expect(localParse('Is there coconut water on the shopping list?', TODAY)).toEqual({
      intent: 'find_items',
      items: ['coconut water'],
      reply: '',
    })
  })
  it('the server answering "no" is still an answer', () => {
    expect(fromServer({ intent: 'find_items', items: [], reply: 'Não — não tem.' }, TODAY)).toEqual({
      intent: 'find_items',
      items: [],
      reply: 'Não — não tem.',
    })
  })
})

import { stitch } from '@/lib/voice'

describe('voice: stitching recogniser resets (iOS 18)', () => {
  it('keeps what was said before a pause', () => {
    const seg = { done: '', current: '' }
    stitch(seg, 'What')
    stitch(seg, 'What is')
    stitch(seg, 'What is on')
    // pause → the recogniser starts over with only the new words
    stitch(seg, 'my')
    expect(stitch(seg, 'my shopping list')).toBe('What is on my shopping list')
  })
  it('a growing or revised partial is not a new stretch', () => {
    const seg = { done: '', current: '' }
    stitch(seg, 'add milk')
    expect(stitch(seg, 'add milk and bread')).toBe('add milk and bread')
    expect(stitch(seg, 'Add milk and bread')).toBe('Add milk and bread')
  })
})

it('voice: a reworded partial replaces, not appends', () => {
  const seg = { done: '', current: '' }
  stitch(seg, "What's on")
  expect(stitch(seg, 'What is on my')).toBe('What is on my')
})

describe('localParse — removing and buying', () => {
  it.each([
    ['tira o leite da lista', ['leite']],
    ['apaga pão e ovos da lista de compras', ['pão', 'ovos']],
    ['deleta o óleo de cozinha', ['óleo de cozinha']],
    ['remove milk from the shopping list', ['milk']],
    ['take the eggs off the list', ['eggs']],
    ['quita la leche de la lista', ['leche']],
  ])('%s', (text, items) => {
    expect(localParse(text, TODAY)).toEqual({ intent: 'remove_items', items })
  })
  it('bought', () => {
    expect(localParse('já comprei o leite e o pão', TODAY)).toEqual({ intent: 'check_items', items: ['leite', 'pão'] })
    expect(localParse('I bought milk', TODAY)).toEqual({ intent: 'check_items', items: ['milk'] })
  })
})


describe('agenda over a period', () => {
  it('this month → today through the last day', () => {
    expect(localParse('o que tem no calendário esse mês?', TODAY)).toMatchObject({ intent: 'agenda', date: TODAY, end: '2026-11-30' })
    expect(localParse("what's on the calendar this month for everyone", TODAY)).toMatchObject({ scope: 'all', end: '2026-11-30' })
  })
  it('this week → through Sunday', () => {
    // 2026-11-05 is a Thursday
    expect(localParse('agenda da semana', TODAY)).toMatchObject({ date: TODAY, end: '2026-11-08' })
  })
  it('next weeks → three weeks out', () => {
    expect(localParse('o que tem na agenda nas próximas semanas', TODAY)).toMatchObject({ end: '2026-11-26' })
  })
  it('server range and label pass through; an end before the start collapses', () => {
    expect(
      fromServer({ intent: 'agenda', scope: 'me', person: '', date: TODAY, date_end: '2026-11-30', reply: 'este mês' }, TODAY),
    ).toMatchObject({ end: '2026-11-30', label: 'este mês' })
    expect(fromServer({ intent: 'agenda', date: TODAY, date_end: '2026-11-01' }, TODAY)).toMatchObject({ end: TODAY })
  })
})

describe('utilities', () => {
  it('split a bill — asks how when not said', () => {
    expect(localParse('você consegue dividir uma conta de 58 dólares e 71 centavos em 3 pessoas?', TODAY)).toMatchObject({
      intent: 'split_bill',
      amount: 58.71,
      people: 3,
      mode: '',
    })
    expect(localParse('divide 58,71 em 3', TODAY)).toEqual({ intent: 'split_bill', amount: 58.71, people: 3, mode: '', tip: 0 })
    expect(localParse('split $58.71 between 3 equally', TODAY)).toMatchObject({ amount: 58.71, people: 3, mode: 'even' })
    expect(localParse('dividir 120 entre 4 por item com 20% de gorjeta', TODAY)).toMatchObject({ mode: 'items', tip: 20 })
  })
  it('discount', () => {
    expect(localParse('quanto fica 80 com 30% de desconto', TODAY)).toEqual({ intent: 'discount', amount: 80, percent: 30 })
    expect(localParse('30% off 120', TODAY)).toEqual({ intent: 'discount', amount: 120, percent: 30 })
  })
})

describe('pets_due', () => {
  it('carries the pet named (empty = all pets)', () => {
    expect(fromServer({ intent: 'pets_due', pet: 'Lola' }, TODAY)).toEqual({ intent: 'pets_due', pet: 'Lola' })
    // An older server sends no `pet` field at all.
    expect(fromServer({ intent: 'pets_due' }, TODAY)).toEqual({ intent: 'pets_due', pet: '' })
  })
})

describe('petQuestion', () => {
  const PETS = ['Lola', 'Chloe']
  it('a named pet + what it needs → that pet', () => {
    expect(petQuestion('What does Lola need next today?', PETS)).toBe('Lola')
    expect(petQuestion("what's next for lola", PETS)).toBe('Lola')
    expect(petQuestion('o que a Chloe precisa hoje?', PETS)).toBe('Chloe')
    expect(petQuestion('qual o próximo da Lola', PETS)).toBe('Lola')
    expect(petQuestion('a Lola já comeu?', PETS)).toBe('Lola')
  })
  it('forgives one slip in the name (autocorrect / dictation)', () => {
    expect(petQuestion("what's next for Cole today", ['Cloe'])).toBe('Cloe')
    expect(petQuestion('what does Lolla need', PETS)).toBe('Lola')
    // …unless that word is a family member
    expect(petQuestion("what's next for Cole today", ['Cloe'], ['Cole Smith'])).toBe('')
  })
  it('not a pet question', () => {
    expect(petQuestion('add dog treats to the list', PETS)).toBe('')
    expect(petQuestion('what does Sam need next today', PETS)).toBe('')
    expect(petQuestion('Lola birthday', PETS)).toBe('')
  })
})
