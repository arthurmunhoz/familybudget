import { afterWake } from '../src/lib/roofWake'
import { speakable, voiceKey } from '../src/lib/roof'

describe('afterWake ("Ei Roof")', () => {
  it('finds the call and returns the request after it, accents kept', () => {
    expect(afterWake('Ei Roof, põe café na lista')).toBe('põe café na lista')
    expect(afterWake('hey roof what is on my list')).toBe('what is on my list')
    expect(afterWake('Oye Roof añade leche')).toBe('añade leche')
  })
  it('accepts how recognisers spell Roof', () => {
    expect(afterWake('ei rufe que horas é o dentista')).toBe('que horas é o dentista')
    expect(afterWake('Ei Ruth, lista de compras')).toBe('lista de compras')
    expect(afterWake('Hey, roof.')).toBe('')
  })
  it('a bare call is an empty request', () => {
    expect(afterWake('Ei Roof')).toBe('')
    expect(afterWake('ok ei roof')).toBe('')
  })
  it('ignores ordinary speech', () => {
    expect(afterWake('o telhado do roof top')).toBe(null)
    expect(afterWake('vou lavar a roupa')).toBe(null)
    expect(afterWake('')).toBe(null)
  })
})

describe('speakable / voiceKey', () => {
  it('drops emoji and squeezes space', () => {
    expect(speakable('Pronto!  ☕ Café   na lista 🛒')).toBe('Pronto! Café na lista')
  })
  it('same text → same cache key; different lang → different', () => {
    expect(voiceKey('pt', 'Pronto')).toBe(voiceKey('pt', 'Pronto'))
    expect(voiceKey('pt', 'Pronto')).not.toBe(voiceKey('en', 'Pronto'))
  })
})

describe('afterWake: an American "roof" inside Portuguese', () => {
  it('takes the spellings pt-BR gives it', () => {
    expect(afterWake('ei rough põe café na lista')).toBe('põe café na lista')
    expect(afterWake('Ei, rof. O que tem hoje?')).toBe('O que tem hoje?')
    expect(afterWake('hey ru')).toBe('')
  })
  it('still ignores ordinary words that start the same', () => {
    expect(afterWake('ei rua da escola')).toBe(null)
    expect(afterWake('a roupa está no varal')).toBe(null)
  })
})

describe('afterWake: Brazilian R and a bare English call', () => {
  it('takes the h-sound spellings', () => {
    expect(afterWake('ei hufe põe leite')).toBe('põe leite')
    expect(afterWake('Ei, Rute')).toBe('')
  })
  it('a transcript that starts with "roof" is a call', () => {
    expect(afterWake('roof what is on today')).toBe('what is on today')
    expect(afterWake('o roof da casa')).toBe(null)
  })
})
