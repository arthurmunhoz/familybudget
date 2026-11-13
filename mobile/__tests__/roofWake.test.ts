import { afterWake, isGoodbye, meaningfulRequest, soundsLikeCalling } from '../src/lib/roofWake'
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

describe('afterWake: a Brazilian "Rúfi"', () => {
  it('takes what sounds like Roof after a clear greeting', () => {
    expect(afterWake('Ei, Rúfi, o que tem hoje?')).toBe('o que tem hoje?')
    expect(afterWake('ei rubi')).toBe('')
    expect(afterWake('hey rufie põe pão')).toBe('põe pão')
    expect(afterWake('ei hufi')).toBe('')
  })
  it('but not after a bare "e"/"a", nor ordinary words', () => {
    expect(afterWake('e rouba a cena')).toBe(null)
    expect(afterWake('ei rua da escola')).toBe(null)
    expect(afterWake('ei ovo')).toBe(null)
  })
})

describe('fillers are not requests', () => {
  it('a call followed by a hesitation is a bare call', () => {
    expect(afterWake('hey roof er')).toBe('')
    expect(afterWake('Ei Roof, é…')).toBe('')
    expect(afterWake('ei roof uh hum')).toBe('')
  })
  it('real words still go through', () => {
    expect(afterWake('ei roof é dia de lixo?')).toBe('é dia de lixo?')
    expect(meaningfulRequest('er')).toBe('')
    expect(meaningfulRequest('ER')).toBe('')
    expect(meaningfulRequest('o que tem hoje')).toBe('o que tem hoje')
  })
})

describe('soundsLikeCalling (the dock dots)', () => {
  it('lights for a call starting', () => {
    expect(soundsLikeCalling('ei')).toBe(true)
    expect(soundsLikeCalling('Hey')).toBe(true)
    expect(soundsLikeCalling('ei ru')).toBe(true)
  })
  it('stays off for ordinary talk', () => {
    expect(soundsLikeCalling('vou lavar a roupa')).toBe(false)
    expect(soundsLikeCalling('ei amor tudo bem')).toBe(false)
  })
})

describe('isGoodbye', () => {
  it('thanks and goodbyes end the conversation', () => {
    for (const t of ['Fechou', 'Maravilha', 'maravilha, valeu', 'ok', 'Ok, obrigado', 'tá bom, brigadão', 'Obrigado!', 'obrigada, até mais', 'Valeu, Roof', 'tchau', 'é só isso, obrigado', 'Thanks!', 'thank you so much', "that's all, bye", 'gracias, adiós', 'eso es todo']) {
      expect([t, isGoodbye(t)]).toEqual([t, true])
    }
  })
  it('a real request with thanks in it is still a request', () => {
    for (const t of ['ok, põe leite na lista', 'maravilha de dia hoje, vai chover?', 'obrigado, põe leite na lista', 'thanks, what is on tomorrow?', 'o que tem até amanhã?', 'tudo bem?', 'mais leite']) {
      expect([t, isGoodbye(t)]).toEqual([t, false])
    }
  })
})
