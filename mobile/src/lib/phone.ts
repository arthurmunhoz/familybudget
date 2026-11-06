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
    if (isNanp(digits)) return { cc: '1', national: digits }
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
