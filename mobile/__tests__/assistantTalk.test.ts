import { readFileSync } from 'fs'
import { join } from 'path'

import { clockAsk, durationSaid, isNo, isRepeatAsk, isUndoAsk, isYes, pickByVoice } from '@/lib/assistantTalk'

const root = join(__dirname, '..', '..')

describe('phone and Modo Casa stay in step', () => {
  it('talk.ts is a copy of assistantTalk.ts', () => {
    expect(readFileSync(join(root, 'src/casa/talk.ts'), 'utf8')).toBe(readFileSync(join(root, 'mobile/src/lib/assistantTalk.ts'), 'utf8'))
  })
  it('both know the same intents', () => {
    const known = (file: string) => {
      const src = readFileSync(join(root, file), 'utf8')
      const block = src.slice(src.indexOf('KNOWN_INTENTS = new Set(['), src.indexOf('])', src.indexOf('KNOWN_INTENTS = new Set([')))
      return [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
    }
    expect(known('src/casa/intent.ts')).toEqual(known('mobile/src/lib/assistant.ts'))
  })
})

describe('yes / no', () => {
  it.each(['sim', 'Sim!', 'pode mandar', 'manda', 'isso mesmo', 'yes', 'go ahead', 'sí', 'dale', 'ok, pode', 'sim, por favor'])('%s is yes', (x) => {
    expect(isYes(x)).toBe(true)
    expect(isNo(x)).toBe(false)
  })
  it.each(['não', 'cancela', 'deixa pra lá', 'never mind', 'no', 'não precisa', 'esquece'])('%s is no', (x) => {
    expect(isNo(x)).toBe(true)
    expect(isYes(x)).toBe(false)
  })
  it.each(['sim, e põe leite na lista', 'manda um aviso pra Ana', 'cancela o dentista', 'não esquece do leite'])('%s is a request', (x) => {
    expect(isYes(x)).toBe(false)
    expect(isNo(x)).toBe(false)
  })
})

describe('pickByVoice', () => {
  const lists = ['Criar “Viagem”', 'Costco', 'Walmart', 'Tarefas', 'Geral']
  it.each([
    ['Costco', 1],
    ['no Costco', 1],
    ['na lista do walmart', 2],
    ['o segundo', 1],
    ['a primeira', 0],
    ['o último', 4],
    ['tarefas por favor', 3],
    ['the third one', 2],
    ['cost', 1],
    ['geral', 4],
    ['coloca na geral', 4],
    ['na lista geral', 4],
    ['põe no Costco', 1],
  ])('%s → %i', (said, i) => expect(pickByVoice(said, lists)).toBe(i))
  it.each(['põe leite e ovos no Costco e no Walmart', 'o sexto', 'padaria', '', 'o que tem na agenda amanhã'])('%s → none', (said) =>
    expect(pickByVoice(said, lists)).toBe(-1),
  )
  it('people', () => {
    expect(pickByVoice('a Ana', ['Arthur', 'Ana', 'Todos'])).toBe(1)
    expect(pickByVoice('todos', ['Arthur', 'Ana', 'Todos'])).toBe(2)
    expect(pickByVoice('a', ['Arthur', 'Ana'])).toBe(-1)
  })
  it('a number that is a label wins over the position', () => {
    expect(pickByVoice('2', ['Lista 2', 'Lista 1'])).toBe(0)
  })
})

describe('undo, repeat, clock', () => {
  it.each(['desfaz isso', 'Desfaz', 'undo that', 'deshaz eso', 'oi casa, desfaz isso por favor', 'desfaz o que você fez', 'desfaz a última', 'volta atrás'])('%s undoes', (x) =>
    expect(isUndoAsk(x)).toBe(true),
  )
  it.each(['desfaz a lista do Walmart', 'volta a lista do Walmart', 'cancela a natação'])('%s does not', (x) => expect(isUndoAsk(x)).toBe(false))
  it.each(['repete', 'fala de novo', 'como?', 'say that again', 'repite', 'o quê?'])('%s repeats', (x) => expect(isRepeatAsk(x)).toBe(true))
  it.each(['repete o evento toda semana', 'como está o tempo'])('%s does not', (x) => expect(isRepeatAsk(x)).toBe(false))
  it.each([
    ['que horas são?', 'time'],
    ['what time is it', 'time'],
    ['qué hora es', 'time'],
    ['que dia é hoje?', 'date'],
    ["what's the date", 'date'],
    ['bom dia', 'morning'],
    ['Bom dia, Roof', 'morning'],
    ['que horas é o dentista', null],
    ['bom dia, põe leite na lista', null],
  ])('%s → %s', (x, k) => expect(clockAsk(x)).toBe(k))
})

describe('durationSaid', () => {
  it.each([
    ['2 horas', 120],
    ['duas horas', 120],
    ['uma hora', 60],
    ['1 hora', 60],
    ['uma hora e meia', 90],
    ['hora e meia', 90],
    ['2 horas e meia', 150],
    ['meia hora', 30],
    ['45 minutos', 45],
    ['1h30', 90],
    ['1 hora e 20 minutos', 80],
    ['umas 3 horas', 180],
    ['vai durar duas horas', 120],
    ['1,5 hora', 90],
    ['two hours', 120],
    ['an hour and a half', 90],
    ['half an hour', 30],
    ['2 and a half hours', 150],
    ['dos horas', 120],
    ['hora y media', 90],
  ])('%s → %i', (said, m) => expect(durationSaid(said)).toBe(m))
  it.each(['duas', 'o segundo', 'sim', 'cancela', 'às 5 horas da tarde', 'marca dentista amanhã às 3', '', '900 horas'])('%s → none', (said) =>
    expect(durationSaid(said)).toBeNull(),
  )
  it('a bare number is hours only when asked how long', () => {
    expect(durationSaid('duas', true)).toBe(120)
    expect(durationSaid('3', true)).toBe(180)
  })
})
