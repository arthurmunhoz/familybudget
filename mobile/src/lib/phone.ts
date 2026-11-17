// Phone numbers for display (2026-11). People type them every which way —
// "4151231234", "(415) 123-1234", "+55 11 98765 4321", "011 98765-4321" — and
// a luggage tag in particular must print one a stranger in another country
// can dial. So: work out the country, then print it the way that country
// writes it, with the +code in front.
//
// Country, in order:
//   1. an explicit "+CC" (or "00CC") wins;
//   2. the SHAPE of the number: 11 digits starting with 1 is US/Canada with
//      its country code; 11 digits with a 9 in the third place is a Brazilian
//      mobile ("11 9xxxx-xxxx" — no NANP number looks like that);
//   3. the device's region (`region`, ISO like "US"/"BR") for the ambiguous
//      10-digit case, which is both a US number and a Brazilian landline;
//   4. otherwise it's left as typed, only tidied — never guessed into a
//      wrong country.
// Pure on purpose — `__tests__/phone.test.ts` pins every case above.

/** Calling codes that are 1 or 2 digits long; everything else is 3. */
const SHORT_CODES = new Set([
  '1', '7',
  '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44', '45', '46', '47', '48', '49',
  '51', '52', '53', '54', '55', '56', '57', '58', '60', '61', '62', '63', '64', '65', '66', '81', '82', '84',
  '86', '90', '91', '92', '93', '94', '95', '98',
])

function splitCountry(digits: string): { cc: string; national: string } {
  for (const len of [1, 2, 3]) {
    const cc = digits.slice(0, len)
    if (len === 3 || SHORT_CODES.has(cc)) return { cc, national: digits.slice(len) }
  }
  return { cc: '', national: digits }
}

/** A plausible NANP number: 10 digits, area code starting 2–9. */
const isNanp = (n: string) => /^[2-9]\d{9}$/.test(n)
/** A plausible Brazilian number: two-digit area code (11–99) + 8 or 9 digits. */
const isBrazil = (n: string) => (n.length === 10 || n.length === 11) && /^[1-9][1-9]/.test(n)

function guess(digits: string, region: string | null): { cc: string; national: string } | null {
  const r = (region ?? '').toUpperCase()
  if (digits.length === 11 && digits[0] === '1' && isNanp(digits.slice(1))) return { cc: '1', national: digits.slice(1) }
  // Brazilian trunk prefix: "0 11 98765-4321" / "011 3456-7890".
  if (digits[0] === '0' && isBrazil(digits.slice(1)) && (r === 'BR' || digits.length === 12)) {
    return { cc: '55', national: digits.slice(1) }
  }
  if (digits.length === 11 && digits[2] === '9' && isBrazil(digits)) return { cc: '55', national: digits }
  if (digits.length === 10) {
    if (r === 'BR' && isBrazil(digits)) return { cc: '55', national: digits }
    if (isNanp(digits) && (r === '' || r === 'US' || r === 'CA')) return { cc: '1', national: digits }
  }
  return null
}

/** Groups of 3 from the left, the last group 2–4 long: "20 7946 0958" style. */
function groups(n: string): string {
  if (n.length <= 4) return n
  const out: string[] = []
  let rest = n
  while (rest.length > 4) {
    const take = rest.length === 5 ? 2 : 3
    out.push(rest.slice(0, take))
    rest = rest.slice(take)
  }
  out.push(rest)
  return out.join(' ')
}

function national(cc: string, n: string): string {
  if (cc === '1' && n.length === 10) return `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`
  if (cc === '55' && n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`
  if (cc === '55' && n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`
  return groups(n)
}

/**
 * The number as it should be shown: "+1 (415) 123-1234", "+55 (11) 98765-4321",
 * "+44 207 946 0958". Text that isn't a phone number (too short, letters)
 * comes back trimmed and otherwise untouched.
 */
export function formatPhone(raw: string, region: string | null = null): string {
  const text = raw.trim()
  if (!text) return ''
  if (/[a-z]/i.test(text.replace(/\s*(ext\.?|x)\s*\d+$/i, ''))) return text
  const digits = text.replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 15) return text

  const intl = /^(\+|00)/.test(text)
  if (intl) {
    const d = text.startsWith('00') ? digits.slice(2) : digits
    const { cc, national: n } = splitCountry(d)
    return `+${cc} ${national(cc, n)}`
  }
  const g = guess(digits, region)
  if (g) return `+${g.cc} ${national(g.cc, g.national)}`
  return groups(digits)
}

// ── As you type (2026-11-14) ────────────────────────────────────────────────
// The field shows the number grouped while it's being typed ("(415) 123-12",
// "(11) 98765-4"), not a run of digits. Only digits and a leading "+" are
// kept; past what the country's format knows it falls back to plain groups.
// `formatPhone` still runs on blur to add the +code.

function partialNanp(n: string): string {
  if (n.length <= 3) return n
  if (n.length <= 6) return `(${n.slice(0, 3)}) ${n.slice(3)}`
  return `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`
}

function partialBrazil(n: string): string {
  if (n.length <= 2) return n
  if (n.length <= 6) return `(${n.slice(0, 2)}) ${n.slice(2)}`
  const cut = n[2] === '9' || n.length === 11 ? 7 : 6
  return `(${n.slice(0, 2)}) ${n.slice(2, cut)}-${n.slice(cut)}`
}

function partialNational(cc: string, n: string): string {
  if (cc === '1' && n.length <= 10) return partialNanp(n)
  if (cc === '55' && n.length <= 11) return partialBrazil(n)
  return groups(n)
}

/** Format what's in a phone field right now. `prev` is the field's previous
 *  value: deleting a bracket, space or dash removes the digit before it, or
 *  the reformat would put the separator straight back. */
export function formatPhoneTyping(next: string, prev = '', region: string | null = null): string {
  let digits = next.replace(/\D/g, '')
  const plus = /^\s*(\+|00)/.test(next)
  if (next.length < prev.length && digits === prev.replace(/\D/g, '')) digits = digits.slice(0, -1)
  if (!digits) return plus ? '+' : ''
  if (/[a-z]/i.test(next)) return next
  if (plus) {
    const d = next.trim().startsWith('00') ? digits.slice(2) : digits
    if (!d) return '+'
    const { cc, national: n } = splitCountry(d)
    return n ? `+${cc} ${partialNational(cc, n)}` : `+${cc}`
  }
  const r = (region ?? '').toUpperCase()
  if (r === 'BR') return digits[0] === '0' ? groups(digits) : partialBrazil(digits)
  const nanp = r === 'US' || r === 'CA' || r === ''
  if (nanp && digits[0] === '1') return digits.length === 1 ? '1' : `1 ${partialNanp(digits.slice(1))}`
  if (nanp) return digits.length <= 10 ? partialNanp(digits) : groups(digits)
  return groups(digits)
}

// ── Picked country (2026-11-16) ─────────────────────────────────────────────
// Neither the device region nor the app language says where a NUMBER is from
// (a Brazilian in the US with the app in Portuguese has a US number; her
// sister in Brazil has a Brazilian one). So the profile's phone field has a
// country pill in front, and the field holds only the national part.

/** `max`: the longest national number there, without a trunk 0 / leading 1. */
export type PhoneCountry = { id: string; cc: string; flag: string; max: number }
export const PHONE_COUNTRIES: PhoneCountry[] = [
  { id: 'US', cc: '1', flag: '🇺🇸', max: 10 },
  { id: 'BR', cc: '55', flag: '🇧🇷', max: 11 },
  { id: 'MX', cc: '52', flag: '🇲🇽', max: 10 },
  { id: 'ES', cc: '34', flag: '🇪🇸', max: 9 },
  { id: 'CA', cc: '1', flag: '🇨🇦', max: 10 },
  { id: 'PT', cc: '351', flag: '🇵🇹', max: 9 },
  { id: 'AR', cc: '54', flag: '🇦🇷', max: 11 },
  { id: 'CO', cc: '57', flag: '🇨🇴', max: 10 },
  { id: 'CL', cc: '56', flag: '🇨🇱', max: 9 },
  { id: 'PE', cc: '51', flag: '🇵🇪', max: 9 },
  { id: 'GB', cc: '44', flag: '🇬🇧', max: 10 },
]
const byId = (id: string) => PHONE_COUNTRIES.find((c) => c.id === id)

/** The country to start an empty field on: the device's region if we list it,
 *  else the app language's most likely one. */
export function defaultPhoneCountry(lang: string, deviceRegion: string | null): string {
  const r = (deviceRegion ?? '').toUpperCase()
  if (byId(r)) return r
  return lang === 'pt' ? 'BR' : lang === 'es' ? 'MX' : 'US'
}

/** A stored number → the country it's from + the national part to edit. */
export function splitStoredPhone(raw: string, fallback: string): { country: string; local: string } {
  let text = raw.trim()
  if (text && !/^(\+|00)/.test(text)) {
    const guessed = formatPhone(text, fallback === 'CA' ? 'US' : fallback)
    if (guessed.startsWith('+')) text = guessed
  }
  if (!/^(\+|00)/.test(text)) return { country: fallback, local: text }
  const digits = text.replace(/\D/g, '')
  const { cc, national: n } = splitCountry(text.startsWith('00') ? digits.slice(2) : digits)
  const fb = byId(fallback)
  const c = fb?.cc === cc ? fb : PHONE_COUNTRIES.find((x) => x.cc === cc)
  if (!c) return { country: fallback, local: text }
  return { country: c.id, local: national(cc, n) }
}

const typingRegion = (country: string) => (country === 'US' || country === 'CA' ? 'US' : country === 'BR' ? 'BR' : 'ZZ')

/** The national part as it's being typed, in the picked country's shape. */
export function formatLocalTyping(next: string, prev: string, country: string): string {
  const digits = next.replace(/\D/g, '')
  // Past the longest number the country has, the keystroke is refused (2026-11-16:
  // "it takes infinite digits"). A trunk 0 or a US leading 1 gets one more; a
  // number typed with its +code is capped at E.164's 15.
  if (/^\s*(\+|00)/.test(next)) {
    const d = next.trim().startsWith('00') ? digits.slice(2) : digits
    return d.length > 15 ? prev : formatPhoneTyping(next, prev, null)
  }
  const c = byId(country)
  const extra = digits[0] === '0' || (c?.cc === '1' && digits[0] === '1') ? 1 : 0
  if (c && digits.length > c.max + extra) return prev
  return formatPhoneTyping(next, prev, typingRegion(country))
}

/** Country + national part → the stored number, "+1 (415) 123-1234". A
 *  national part typed with its own +code keeps that code. */
export function composePhone(country: string, local: string): string {
  const text = local.trim()
  if (!text) return ''
  if (/^(\+|00)/.test(text)) return formatPhone(text)
  if (/[a-z]/i.test(text)) return text
  const c = byId(country)
  let n = text.replace(/\D/g, '')
  if (!c || n.length < 4) return text
  if (c.cc === '1' && n.length === 11 && n[0] === '1') n = n.slice(1)
  if (c.cc !== '1' && n[0] === '0') n = n.replace(/^0+/, '')
  return `+${c.cc} ${national(c.cc, n)}`
}
