/**
 * lib/birthYear.ts reads the bundled birthYears.json (built by
 * scripts/build-birth-years.py). What it must get right: the user's language
 * first, English when that language's wiki doesn't cover a person or a year,
 * and article links in the language actually used.
 */
jest.mock(
  '../src/data/birthYears.json',
  () => ({
    '1989': {
      p: [
        {
          q: 'Q26876',
          n: { en: 'Taylor Swift', es: 'Taylor Swift', pt: 'Taylor Swift' },
          d: { en: 'American singer-songwriter', pt: 'cantora e compositora estadunidense' },
          w: { en: 'Taylor Swift', pt: 'Taylor Swift' },
          i: 'https://commons.wikimedia.org/wiki/Special:FilePath/Taylor.jpg?width=160',
          f: 179,
        },
        { q: 'Q1', n: { en: 'Only English' }, d: {}, w: { en: 'Only English' }, i: null, f: 50 },
      ],
      e: {
        en: [{ t: 'November 9 – The Berlin Wall falls.', u: 'https://en.m.wikipedia.org/wiki/Berlin_Wall', i: 'https://upload.wikimedia.org/wall.jpg' }],
        pt: [{ t: '9 de novembro – Queda do Muro de Berlim.', u: null }],
      },
    },
  }),
  { virtual: true },
)

import { birthYearFacts } from '@/lib/birthYear'

describe('birth year facts', () => {
  it('uses the user’s language, with that wiki’s article', () => {
    const { people, events } = birthYearFacts(1989, 'pt')
    expect(people[0]).toMatchObject({
      name: 'Taylor Swift',
      desc: 'cantora e compositora estadunidense',
      url: 'https://pt.m.wikipedia.org/wiki/Taylor_Swift',
    })
    expect(events.map((e) => e.text)).toEqual(['9 de novembro – Queda do Muro de Berlim.'])
  })

  it('falls back to English per person and per year', () => {
    const { people, events } = birthYearFacts(1989, 'es')
    expect(people[0].desc).toBe('American singer-songwriter')
    expect(people[1]).toMatchObject({ name: 'Only English', url: 'https://en.m.wikipedia.org/wiki/Only_English' })
    expect(events[0]).toEqual({
      text: 'November 9 – The Berlin Wall falls.',
      url: 'https://en.m.wikipedia.org/wiki/Berlin_Wall',
      photo: 'https://upload.wikimedia.org/wall.jpg',
    })
  })

  it('is empty for a year it has no data for', () => {
    expect(birthYearFacts(1850, 'en')).toEqual({ people: [], events: [] })
  })
})
