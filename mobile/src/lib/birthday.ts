// Birthday facts for the Family "Birthday" page — everything here is computed
// on the device from the date alone (no network, no personal data leaves the
// phone). The Wikipedia half of that page lives in lib/birthYear.ts.
//
// All dates are ISO `YYYY-MM-DD` strings, like the rest of the app; the maths
// goes through UTC so a DST change can't shift a day count by one.

const DAY_MS = 86_400_000

function utc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

/** Whole days from `birth` to `today` (0 on the day of birth). */
export function daysAlive(birth: string, today: string): number {
  return Math.round((utc(today) - utc(birth)) / DAY_MS)
}

/** The next birthday on or after `today`: its date, how many days away (0 =
 *  today) and the age being turned. A Feb 29 birthday is celebrated on Feb 28
 *  in common years — the usual convention, and it keeps the countdown honest
 *  instead of skipping three years. */
export function nextBirthday(birth: string, today: string): { date: string; inDays: number; turning: number } {
  const [by, bm, bd] = birth.split('-').map(Number)
  const ty = Number(today.slice(0, 4))
  const on = (y: number) => {
    const day = bm === 2 && bd === 29 && !isLeap(y) ? 28 : bd
    return `${y}-${String(bm).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  let year = ty
  if (on(year) < today) year += 1
  const date = on(year)
  return { date, inDays: Math.round((utc(date) - utc(today)) / DAY_MS), turning: year - by }
}

/** The next round "N,000 days old" after today, and when it lands. */
export function nextMilestone(birth: string, today: string, step = 1000): { days: number; date: string } {
  const alive = daysAlive(birth, today)
  const days = (Math.floor(alive / step) + 1) * step
  return { days, date: iso(utc(birth) + days * DAY_MS) }
}

export type ZodiacSign =
  | 'capricorn' | 'aquarius' | 'pisces' | 'aries' | 'taurus' | 'gemini'
  | 'cancer' | 'leo' | 'virgo' | 'libra' | 'scorpio' | 'sagittarius'

/** [first month, first day, sign] — each sign starts on that date. */
const ZODIAC: [number, number, ZodiacSign][] = [
  [1, 20, 'aquarius'], [2, 19, 'pisces'], [3, 21, 'aries'], [4, 20, 'taurus'],
  [5, 21, 'gemini'], [6, 21, 'cancer'], [7, 23, 'leo'], [8, 23, 'virgo'],
  [9, 23, 'libra'], [10, 23, 'scorpio'], [11, 22, 'sagittarius'], [12, 22, 'capricorn'],
]

export const ZODIAC_EMOJI: Record<ZodiacSign, string> = {
  aries: '♈', taurus: '♉', gemini: '♊', cancer: '♋', leo: '♌', virgo: '♍',
  libra: '♎', scorpio: '♏', sagittarius: '♐', capricorn: '♑', aquarius: '♒', pisces: '♓',
}

export function zodiacSign(birth: string): ZodiacSign {
  const [, m, d] = birth.split('-').map(Number)
  let sign: ZodiacSign = 'capricorn' // Jan 1–19 belongs to December's sign
  for (const [sm, sd, s] of ZODIAC) if (m > sm || (m === sm && d >= sd)) sign = s
  return sign
}

/** Moon phase on a date as one of 8 named phases, 0 = new … 4 = full. Uses
 *  the mean synodic month from a known new moon (2000-01-06 18:14 UTC); good
 *  to within about a day, which is all an 8-way name needs. Evaluated at
 *  local-ish evening (20:00 UTC) since the question is "the night they were
 *  born". */
export function moonPhase(date: string): number {
  const SYNODIC = 29.530588853
  const knownNew = Date.UTC(2000, 0, 6, 18, 14)
  const days = (utc(date) + 20 * 3600_000 - knownNew) / DAY_MS
  const age = ((days % SYNODIC) + SYNODIC) % SYNODIC
  return Math.floor((age / SYNODIC) * 8 + 0.5) % 8
}

export const MOON_EMOJI = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘']

export type Generation = 'greatest' | 'silent' | 'boomer' | 'genx' | 'millennial' | 'genz' | 'alpha' | 'beta'

/** Pew Research's generation cut-offs (Alpha/Beta per McCrindle). */
export function generation(year: number): Generation {
  if (year < 1928) return 'greatest'
  if (year <= 1945) return 'silent'
  if (year <= 1964) return 'boomer'
  if (year <= 1980) return 'genx'
  if (year <= 1996) return 'millennial'
  if (year <= 2012) return 'genz'
  if (year <= 2024) return 'alpha'
  return 'beta'
}

/** Is the next birthday (today included) still within the current calendar
 *  month? Drives the Home birthday card: shown for the month of someone's
 *  birthday, gone once the day has passed. */
export function birthdayThisMonth(birth: string, today: string): boolean {
  return nextBirthday(birth, today).date.slice(0, 7) === today.slice(0, 7)
}
