// The ask bar's offline parser — the phrasings it must get right without the
// server (lib/assistant.ts `localParse`).
jest.mock('@/lib/supabase', () => ({ supabase: {} }))

import { localParse } from '@/lib/assistant'
import { compareDeals } from '@/lib/assistantActions'

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

import { fromServer, moneyRange, periodForBudget, petQuestion, petsAsked, pickBudget } from '@/lib/assistant'

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

import { sceneFor } from '@/components/home/sceneKind'
describe('sceneFor', () => {
  it('maps WMO codes and day/night to a sky', () => {
    expect(sceneFor(0)).toBe('clear')
    expect(sceneFor(0, false)).toBe('night')
    expect(sceneFor(2)).toBe('partly')
    expect(sceneFor(3, false)).toBe('nightCloudy')
    expect(sceneFor(45)).toBe('fog')
    expect(sceneFor(61)).toBe('rain')
    expect(sceneFor(73)).toBe('snow')
    expect(sceneFor(95)).toBe('storm')
  })
})

describe('money: which budget, which period', () => {
  const B = (id: string, name: string, period = 'monthly') => ({ id, name, period }) as never
  const home = B('h', 'Household')
  const trip = B('t', 'Beach Trip')
  it('asks (null) when there are several budgets and none is named', () => {
    expect(pickBudget([home, trip], '')).toBeNull()
    expect(pickBudget([home, trip], 'Walmart')).toBeNull()
  })
  it('takes the named budget, loosely, or the only one', () => {
    expect(pickBudget([home, trip], 'beach trip')).toBe(trip)
    expect(pickBudget([home, trip], 'trip')).toBe(trip)
    expect(pickBudget([home], '')).toBe(home)
  })
  it('uses the period holding the date, else the latest one', () => {
    const months = [
      { id: 'oct', budget_id: 'h', start_date: '2026-10-01' },
      { id: 'sep', budget_id: 'h', start_date: '2026-09-01' },
      { id: 'other', budget_id: 't', start_date: '2026-11-01' },
    ] as never[]
    expect((periodForBudget(home, months, '2026-10-15') as { id: string }).id).toBe('oct')
    // November not opened yet → the latest period, October
    expect((periodForBudget(home, months, '2026-11-05') as { id: string }).id).toBe('oct')
    expect(periodForBudget(B('x', 'Empty'), months, '2026-11-05')).toBeNull()
  })
})

describe('fromServer — the newer intents (2026-11)', () => {
  it('add_event keeps the extras that were said', () => {
    expect(
      fromServer(
        { intent: 'add_event', title: 'Natação', date: '2026-11-10', time: '18:00', end_time: '19:00', recurrence: 'weekly', event_kind: 'event', reminder: 60, location: '', notes: '' },
        TODAY,
      ),
    ).toEqual({
      intent: 'add_event',
      title: 'Natação',
      date: '2026-11-10',
      time: '18:00',
      person: '',
      opts: { end: undefined, endTime: '19:00', recurrence: 'weekly', kind: 'event', location: '', notes: '', reminder: 60 },
    })
  })
  it('a birthday repeats every year even when the model said none', () => {
    const r = fromServer({ intent: 'add_event', title: 'Aniversário da Ana', date: '2027-03-12', event_kind: 'birthday', recurrence: 'none', reminder: -1 }, TODAY)
    expect(r).toMatchObject({ opts: { kind: 'birthday', recurrence: 'yearly', reminder: null } })
  })
  it('remove / edit / find keep "" when no day was said', () => {
    expect(fromServer({ intent: 'remove_event', title: 'Unha', date: '' }, TODAY)).toEqual({ intent: 'remove_event', title: 'Unha', date: '' })
    expect(fromServer({ intent: 'find_event', title: 'Dentista', date: '' }, TODAY)).toEqual({ intent: 'find_event', title: 'Dentista', date: '' })
    expect(fromServer({ intent: 'edit_event', title: 'Dentista', date: '', reminder: 60 }, TODAY)).toMatchObject({ intent: 'edit_event', date: '', reminder: 60 })
    // An edit that changes nothing is not usable.
    expect(fromServer({ intent: 'edit_event', title: 'Dentista', reminder: -1 }, TODAY)).toBeNull()
  })
  it('money corrections and per-category totals', () => {
    expect(fromServer({ intent: 'fix_money', title: '', amount: 45 }, TODAY)).toEqual({ intent: 'fix_money', title: '', amount: 45, newTitle: '', delta: 0, tipPct: 0 })
    expect(fromServer({ intent: 'fix_money', title: '', delta: 12 }, TODAY)).toEqual({ intent: 'fix_money', title: '', amount: 0, newTitle: '', delta: 12, tipPct: 0 })
    expect(fromServer({ intent: 'fix_money', title: 'Ford', tip_pct: 10 }, TODAY)).toEqual({ intent: 'fix_money', title: 'Ford', amount: 0, newTitle: '', delta: 0, tipPct: 10 })
    expect(fromServer({ intent: 'fix_money', title: '' }, TODAY)).toBeNull()
    expect(fromServer({ intent: 'money_summary', budget: '', category: 'groceries' }, TODAY)).toEqual({ intent: 'money_summary', budget: '', category: 'groceries', title: '' })
  })
  it('pets', () => {
    expect(fromServer({ intent: 'pet_done', pet: 'Lola', items: ['Comida'] }, TODAY)).toEqual({ intent: 'pet_done', pet: 'Lola', tasks: ['Comida'] })
    expect(fromServer({ intent: 'pet_log', pet: 'Chloe', pet_event_type: 'vaccine', title: 'Antirrábica', date: TODAY, new_date: '2027-11-05' }, TODAY)).toEqual({
      intent: 'pet_log',
      pet: 'Chloe',
      type: 'vaccine',
      title: 'Antirrábica',
      date: TODAY,
      next: '2027-11-05',
    })
    expect(fromServer({ intent: 'pet_weight', pet: 'Lola', amount: 8 }, TODAY)).toEqual({ intent: 'pet_weight', pet: 'Lola', weight: 8 })
    expect(fromServer({ intent: 'pet_weight', pet: 'Lola', amount: 0 }, TODAY)).toBeNull()
  })
  it('urgent nudges, better deals, documents', () => {
    expect(fromServer({ intent: 'send_nudge', title: 'Preciso de ajuda', person: '', urgent: true }, TODAY)).toMatchObject({ urgent: true })
    expect(fromServer({ intent: 'better_deal', deals: [{ price: 8, size: 2, label: '2 L' }] }, TODAY)).toBeNull()
    expect(fromServer({ intent: 'better_deal', deals: [{ price: 8, size: 2, label: 'a' }, { price: 11, size: 3, label: 'b' }] }, TODAY)).toMatchObject({ intent: 'better_deal' })
    expect(fromServer({ intent: 'open_document', title: 'Passaporte', person: 'Léo' }, TODAY)).toEqual({ intent: 'open_document', title: 'Passaporte', person: 'Léo' })
  })
})

describe('compareDeals', () => {
  it('marks the cheapest per unit and how much cheaper it is', () => {
    const { rows, savingPct } = compareDeals([
      { price: 8, size: 2, label: '2 L por 8' },
      { price: 11, size: 3, label: '3 L por 11' },
    ])
    expect(rows.find((r) => r.best)?.label).toBe('3 L por 11')
    expect(savingPct).toBe(8) // 3.67 vs 4.00 per litre
  })
})

describe('money / calendar words never become list items (owner report 2026-11)', () => {
  it('leaves "apaga o gasto do Ford\'s Garage" to the server', () => {
    expect(localParse("apaga o gasto do Ford's Garage", TODAY)).toBeNull()
    expect(localParse('remove o evento unha do calendário', TODAY)).toBeNull()
    expect(localParse('delete the last expense', TODAY)).toBeNull()
  })
  it('still removes real list items', () => {
    expect(localParse('tira o leite da lista', TODAY)).toEqual({ intent: 'remove_items', items: ['leite'] })
  })
})

describe('refs from the server', () => {
  it('carries the row the model pointed at', () => {
    expect(fromServer({ intent: 'remove_money', title: '', ref: 'e1' }, TODAY)).toEqual({ intent: 'remove_money', title: '', ref: 'e1' })
    expect(fromServer({ intent: 'remove_event', title: '', date: '', ref: 'v3' }, TODAY)).toEqual({ intent: 'remove_event', title: '', date: '', ref: 'v3' })
    expect(fromServer({ intent: 'remove_money', title: 'Uber', ref: 'x9' }, TODAY)).toEqual({ intent: 'remove_money', title: 'Uber' })
  })
})

describe('money questions about an earlier period', () => {
  it('carries a past day as `at`, never today', () => {
    expect(fromServer({ intent: 'money_summary', budget: '', category: '', title: 'Uber', date: '2026-10-05' }, TODAY)).toEqual({
      intent: 'money_summary', budget: '', category: '', title: 'Uber', at: '2026-10-05',
    })
    expect(fromServer({ intent: 'list_money', budget: '', category: '', title: '', date: TODAY }, TODAY)).toEqual({
      intent: 'list_money', budget: '', category: '', title: '',
    })
  })
  it('finds the period that held the day, with no stand-in when strict', () => {
    const b = { id: 'b', name: 'Casa', period: 'monthly' } as any
    const months = [{ id: 'm10', budget_id: 'b', start_date: '2026-10-01' }, { id: 'm11', budget_id: 'b', start_date: '2026-11-01' }] as any
    expect(periodForBudget(b, months, '2026-10-05', true)?.id).toBe('m10')
    expect(periodForBudget(b, months, '2026-08-05', true)).toBeNull()
    expect(periodForBudget(b, months, '2026-08-05')?.id).toBe('m11')
  })
})

describe('whose money, and which kind (owner report 2026-11)', () => {
  it('"meus gastos" keeps the person and expenses only', () => {
    expect(fromServer({ intent: 'list_money', budget: '', category: '', title: '', person: 'Arthur Munhoz', money_type: 'expense' }, TODAY)).toEqual({
      intent: 'list_money', budget: '', category: '', title: '', person: 'Arthur Munhoz', kind: 'expense',
    })
    expect(fromServer({ intent: 'list_money', budget: '', category: '', title: '', person: '', money_type: 'all' }, TODAY)).toEqual({
      intent: 'list_money', budget: '', category: '', title: '',
    })
  })
})

describe('money over an explicit day / week / month (owner report 2026-11)', () => {
  it('"meus gastos hoje" filters to that day', () => {
    expect(fromServer({ intent: 'list_money', budget: '', category: '', title: '', person: 'Arthur', money_type: 'expense', money_range: 'day', date: TODAY }, TODAY)).toEqual({
      intent: 'list_money', budget: '', category: '', title: '', person: 'Arthur', kind: 'expense', range: { span: 'day', from: TODAY, to: TODAY },
    })
  })
  it('weeks run Monday to Sunday, months to their last day', () => {
    expect(moneyRange('week', '2026-11-05')).toEqual({ span: 'week', from: '2026-11-02', to: '2026-11-08' })
    expect(moneyRange('month', '2026-02-10')).toEqual({ span: 'month', from: '2026-02-01', to: '2026-02-28' })
  })
})

describe('routine questions naming several pets (owner report 2026-11)', () => {
  it('keeps every pet named', () => {
    expect(petsAsked('como está a rotina da Lola e da Aninha hoje?', ['Lola', 'Aninha'])).toEqual(['Lola', 'Aninha'])
    expect(petQuestion('como está a rotina da Lola e da Aninha hoje?', ['Lola', 'Aninha'])).toBe('Lola')
  })
})

import { pickOccurrence, type EventWho } from '@/lib/assistant'
import { cutWrite, looksCut } from '@/lib/assistantGuard'
import type { CalendarEvent } from '@/lib/types'

describe('events tied to a person (owner report 2026-11)', () => {
  const ev = (id: string, title: string, start: string, owner: string | null = null) => ({
    event: { id, title, owner_email: owner, start_date: start, end_date: start } as CalendarEvent,
    start,
    end: start,
  })
  const ana: EventWho = { name: 'Ana', email: 'ana@x' }
  const pedro: EventWho = { name: 'Pedro' } // a child without an account
  const pool = [
    ev('a', 'Dentista', '2026-11-10', 'ana@x'),
    ev('n', 'Natação', '2026-11-11', 'leo@x'),
    ev('p', 'Dentista Pedro', '2026-11-12', 'arthur@x'),
    ev('n', 'Natação', '2026-11-18', 'leo@x'),
  ]

  it("two people's dentists and no one named: asks, never the first", () => {
    const r = pickOccurrence(pool, 'dentista', false)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toBe('ambiguous')
    expect(!r.ok && r.options.map((o) => o.event.id)).toEqual(['a', 'p'])
  })
  it('the person named picks theirs — by owner, or by the name in the title', () => {
    expect(pickOccurrence(pool, 'Dentista', false, pedro)).toMatchObject({ ok: true, occ: { event: { id: 'p' } } })
    expect(pickOccurrence(pool, 'Dentista', false, ana)).toMatchObject({ ok: true, occ: { event: { id: 'a' } } })
    // The model left the name in the title as well.
    expect(pickOccurrence(pool, 'dentista do Pedro', false, pedro)).toMatchObject({ ok: true, occ: { event: { id: 'p' } } })
  })
  it('"dentista do Pedro" with no person slot never lands on Ana\'s', () => {
    expect(pickOccurrence(pool, 'dentista do Pedro', false)).toMatchObject({ ok: true, occ: { event: { id: 'p' } } })
  })
  it('a person none of them belongs to: asks with what there is', () => {
    const r = pickOccurrence(pool, 'dentista', false, { name: 'Sam', email: 'sam@x' })
    expect(!r.ok && r.reason).toBe('ambiguous')
  })
  it('the occurrences of one series are not a question: the soonest', () => {
    expect(pickOccurrence(pool, 'natação', false)).toMatchObject({ ok: true, occ: { start: '2026-11-11' } })
  })
  it('fromServer keeps whose event it is', () => {
    expect(fromServer({ intent: 'move_event', title: 'Dentista', person: 'Pedro', date: TODAY, new_date: '2026-11-06' }, TODAY)).toMatchObject({ person: 'Pedro' })
    expect(fromServer({ intent: 'remove_event', title: 'Consulta', person: 'Ana', date: '' }, TODAY)).toMatchObject({ person: 'Ana' })
    expect(fromServer({ intent: 'move_event', title: 'Dentista', person: '', date: TODAY, new_date: '2026-11-06' }, TODAY)).not.toHaveProperty('person')
  })
})

describe('pets: routine and overdue views', () => {
  it('pet_view comes through on pets_due', () => {
    expect(fromServer({ intent: 'pets_due', pet: 'Lola', pet_view: 'routine' }, TODAY)).toEqual({ intent: 'pets_due', pet: 'Lola', view: 'routine' })
    expect(fromServer({ intent: 'pets_due', pet: '', pet_view: 'overdue' }, TODAY)).toEqual({ intent: 'pets_due', pet: '', view: 'overdue' })
    expect(fromServer({ intent: 'pets_due', pet: '', pet_view: 'due' }, TODAY)).toEqual({ intent: 'pets_due', pet: '' })
  })
})

describe('a request cut off mid-phrase never writes (owner report 2026-11)', () => {
  it.each(['marca uma consulta da', 'add milk to the', 'muda o dentista para', 'põe leite e', 'cancela la cita de'])('%s', (text) => {
    expect(looksCut(text)).toBe(true)
  })
  it.each(['marca uma consulta da Aninha hoje', 'a Lola tomou vacina hoje', 'add milk', 'o que falta para os pets hoje?'])('%s is whole', (text) => {
    expect(looksCut(text)).toBe(false)
  })
  it('only writes are stopped', () => {
    expect(cutWrite('add_event', 'marca uma consulta da')).toBe(true)
    expect(cutWrite('pets_due', 'o que falta para a')).toBe(false)
  })
})
