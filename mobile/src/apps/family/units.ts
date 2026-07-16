// Unit parsing / conversion for the Family measured fields (height, weight,
// shoe) plus blood-type compatibility. Values are stored in the existing text
// columns AS the member entered them, unit included (e.g. "181 lb", "5'11\"",
// "US M 10.5") — so there is NO schema change and legacy free-text still shows.
// Anything unparseable simply can't be converted (canConvert → false).

export type ConvertKind = 'height' | 'weight' | 'shoe' | 'blood'

export interface ConvRow {
  value: string
  /** The unit the member actually entered — highlighted in the sheet. */
  primary?: boolean
}

const CM_PER_IN = 2.54
const LB_PER_KG = 2.2046226218

const round1 = (n: number) => Math.round(n * 10) / 10
const fmtSize = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

// ── Height ───────────────────────────────────────────────────────────────────
export type HeightUnit = 'cm' | 'ftin'

export function parseHeight(raw: string): { cm: number; unit: HeightUnit } | null {
  const s = raw.trim()
  if (/cm/i.test(s)) {
    const n = parseFloat(s)
    return isFinite(n) ? { cm: n, unit: 'cm' } : null
  }
  // 5'11"  ·  5' 11  ·  5ft 11in  ·  5'
  const m = s.match(/(\d+(?:\.\d+)?)\s*(?:['’]|ft)\s*(\d+(?:\.\d+)?)?/i)
  if (m) {
    const ft = parseFloat(m[1])
    const inch = m[2] ? parseFloat(m[2]) : 0
    if (isFinite(ft)) return { cm: (ft * 12 + inch) * CM_PER_IN, unit: 'ftin' }
  }
  return null
}

export function cmToFtIn(cm: number): { ft: number; inch: number } {
  const totalIn = cm / CM_PER_IN
  let ft = Math.floor(totalIn / 12)
  let inch = Math.round(totalIn - ft * 12)
  if (inch === 12) {
    ft += 1
    inch = 0
  }
  return { ft, inch }
}

export const ftInToCm = (ft: number, inch: number) => (ft * 12 + inch) * CM_PER_IN

export function composeHeight(unit: HeightUnit, a: string, b?: string): string {
  if (unit === 'cm') {
    const n = parseFloat(a)
    return isFinite(n) ? `${Math.round(n)} cm` : ''
  }
  const ft = parseFloat(a)
  const inch = b ? parseFloat(b) : 0
  if (!isFinite(ft)) return ''
  return `${ft}'${isFinite(inch) ? inch : 0}"`
}

function heightRows(cm: number, unit: HeightUnit): ConvRow[] {
  const { ft, inch } = cmToFtIn(cm)
  return [
    { value: `${ft}'${inch}"`, primary: unit === 'ftin' },
    { value: `${Math.round(cm)} cm`, primary: unit === 'cm' },
    { value: `${(cm / 100).toFixed(2)} m` },
    { value: `${round1(cm / CM_PER_IN)} in` },
  ]
}

// ── Weight ───────────────────────────────────────────────────────────────────
export type WeightUnit = 'kg' | 'lb'

export function parseWeight(raw: string): { kg: number; unit: WeightUnit } | null {
  const s = raw.trim()
  const n = parseFloat(s)
  if (!isFinite(n)) return null
  if (/kg/i.test(s)) return { kg: n, unit: 'kg' }
  if (/lb/i.test(s)) return { kg: n / LB_PER_KG, unit: 'lb' }
  return null
}

export function composeWeight(unit: WeightUnit, v: string): string {
  const n = parseFloat(v)
  return isFinite(n) ? `${round1(n)} ${unit}` : ''
}

/** Convert a typed number between kg/lb (for the unit-toggle in the editor). */
export function weightConvert(n: number, from: WeightUnit, to: WeightUnit): number {
  if (from === to) return n
  return round1(to === 'kg' ? n / LB_PER_KG : n * LB_PER_KG)
}

function weightRows(kg: number, unit: WeightUnit): ConvRow[] {
  const lb = kg * LB_PER_KG
  const st = Math.floor(lb / 14)
  const stLb = Math.round(lb - st * 14)
  return [
    { value: `${round1(kg)} kg`, primary: unit === 'kg' },
    { value: `${round1(lb)} lb`, primary: unit === 'lb' },
    { value: `${st} st ${stLb} lb` },
  ]
}

// ── Shoe ─────────────────────────────────────────────────────────────────────
export type ShoeSystem = 'US' | 'EU' | 'UK'
export type ShoeGender = 'M' | 'W'
interface ShoeRow {
  us: number
  eu: number
  uk: number
  cm: number
}

// Standard (Brannock-based) approximations. Shoe sizing varies by brand, so the
// conversion sheet is labelled approximate.
const SHOE_M: ShoeRow[] = [
  { us: 6, eu: 38.5, uk: 5.5, cm: 24.0 },
  { us: 6.5, eu: 39, uk: 6, cm: 24.5 },
  { us: 7, eu: 40, uk: 6, cm: 25.0 },
  { us: 7.5, eu: 40.5, uk: 7, cm: 25.5 },
  { us: 8, eu: 41, uk: 7, cm: 26.0 },
  { us: 8.5, eu: 41.5, uk: 8, cm: 26.5 },
  { us: 9, eu: 42, uk: 8, cm: 27.0 },
  { us: 9.5, eu: 42.5, uk: 9, cm: 27.5 },
  { us: 10, eu: 43, uk: 9, cm: 28.0 },
  { us: 10.5, eu: 43.5, uk: 9.5, cm: 28.5 },
  { us: 11, eu: 44, uk: 10, cm: 29.0 },
  { us: 11.5, eu: 44.5, uk: 10.5, cm: 29.5 },
  { us: 12, eu: 45, uk: 11, cm: 30.0 },
  { us: 13, eu: 46.5, uk: 12, cm: 31.0 },
  { us: 14, eu: 47.5, uk: 13, cm: 32.0 },
]
const SHOE_W: ShoeRow[] = [
  { us: 5, eu: 35.5, uk: 2.5, cm: 22.0 },
  { us: 5.5, eu: 36, uk: 3, cm: 22.5 },
  { us: 6, eu: 36.5, uk: 3.5, cm: 23.0 },
  { us: 6.5, eu: 37, uk: 4, cm: 23.5 },
  { us: 7, eu: 37.5, uk: 4.5, cm: 24.0 },
  { us: 7.5, eu: 38, uk: 5, cm: 24.5 },
  { us: 8, eu: 38.5, uk: 5.5, cm: 25.0 },
  { us: 8.5, eu: 39, uk: 6, cm: 25.5 },
  { us: 9, eu: 40, uk: 6.5, cm: 26.0 },
  { us: 9.5, eu: 40.5, uk: 7, cm: 26.5 },
  { us: 10, eu: 41, uk: 7.5, cm: 27.0 },
  { us: 11, eu: 42, uk: 8.5, cm: 28.0 },
]

const shoeKey = (s: ShoeSystem): keyof ShoeRow =>
  s === 'US' ? 'us' : s === 'EU' ? 'eu' : 'uk'

function nearestShoe(gender: ShoeGender, system: ShoeSystem, value: number): ShoeRow | null {
  const table = gender === 'W' ? SHOE_W : SHOE_M
  const key = shoeKey(system)
  let best: ShoeRow | null = null
  let bestD = Infinity
  for (const row of table) {
    const d = Math.abs(row[key] - value)
    if (d < bestD) {
      bestD = d
      best = row
    }
  }
  return best
}

export function parseShoe(
  raw: string,
): { system: ShoeSystem; gender: ShoeGender; value: number } | null {
  const s = raw.trim()
  const sys = s.match(/\b(US|EU|UK)\b/i)
  const num = s.match(/(\d+(?:\.\d+)?)/)
  if (!sys || !num) return null
  const gen = s.match(/\b(M|W)\b/i)
  return {
    system: sys[1].toUpperCase() as ShoeSystem,
    gender: (gen ? gen[1].toUpperCase() : 'M') as ShoeGender,
    value: parseFloat(num[1]),
  }
}

export function composeShoe(system: ShoeSystem, gender: ShoeGender, v: string): string {
  const n = parseFloat(v)
  return isFinite(n) ? `${system} ${gender} ${fmtSize(n)}` : ''
}

/** Convert a typed size between US/EU/UK (for the editor's system toggle). */
export function shoeConvert(
  n: number,
  gender: ShoeGender,
  from: ShoeSystem,
  to: ShoeSystem,
): number | null {
  if (from === to) return n
  const row = nearestShoe(gender, from, n)
  return row ? row[shoeKey(to)] : null
}

function shoeRows(p: { system: ShoeSystem; gender: ShoeGender; value: number }): ConvRow[] | null {
  const row = nearestShoe(p.gender, p.system, p.value)
  if (!row) return null
  return [
    { value: `US ${fmtSize(row.us)}`, primary: p.system === 'US' },
    { value: `EU ${fmtSize(row.eu)}`, primary: p.system === 'EU' },
    { value: `UK ${fmtSize(row.uk)}`, primary: p.system === 'UK' },
    { value: `${row.cm.toFixed(1)} cm` },
  ]
}

// ── Blood-type compatibility ────────────────────────────────────────────────
// Keys use the ASCII '-' stored in BLOOD_TYPES.
export interface BloodCompat {
  give: string[]
  get: string[]
  universalDonor?: boolean
  universalRecipient?: boolean
}
const ALL_BLOOD = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+']
const BLOOD_COMPAT: Record<string, BloodCompat> = {
  'O-': { give: ALL_BLOOD, get: ['O-'], universalDonor: true },
  'O+': { give: ['O+', 'A+', 'B+', 'AB+'], get: ['O+', 'O-'] },
  'A-': { give: ['A-', 'A+', 'AB-', 'AB+'], get: ['A-', 'O-'] },
  'A+': { give: ['A+', 'AB+'], get: ['A+', 'A-', 'O+', 'O-'] },
  'B-': { give: ['B-', 'B+', 'AB-', 'AB+'], get: ['B-', 'O-'] },
  'B+': { give: ['B+', 'AB+'], get: ['B+', 'B-', 'O+', 'O-'] },
  'AB-': { give: ['AB-', 'AB+'], get: ['AB-', 'A-', 'B-', 'O-'] },
  'AB+': { give: ['AB+'], get: ALL_BLOOD, universalRecipient: true },
}

export function bloodCompat(type: string): BloodCompat | null {
  return BLOOD_COMPAT[type.trim().toUpperCase()] ?? null
}

// ── Public: display + conversion ────────────────────────────────────────────
/** The card value shown for a stored string (hides the shoe gender tag). */
export function displayValue(kind: ConvertKind, raw: string): string {
  if (kind === 'shoe') {
    const p = parseShoe(raw)
    if (p) return `${p.system} ${fmtSize(p.value)}`
  }
  return raw
}

export function canConvert(kind: ConvertKind, raw: string | null | undefined): boolean {
  if (!raw) return false
  switch (kind) {
    case 'height':
      return parseHeight(raw) != null
    case 'weight':
      return parseWeight(raw) != null
    case 'shoe':
      return parseShoe(raw) != null
    case 'blood':
      return bloodCompat(raw) != null
  }
}

/** Rows for the conversion sheet (null for blood — use bloodCompat instead). */
export function convertRows(kind: ConvertKind, raw: string): ConvRow[] | null {
  switch (kind) {
    case 'height': {
      const p = parseHeight(raw)
      return p ? heightRows(p.cm, p.unit) : null
    }
    case 'weight': {
      const p = parseWeight(raw)
      return p ? weightRows(p.kg, p.unit) : null
    }
    case 'shoe': {
      const p = parseShoe(raw)
      return p ? shoeRows(p) : null
    }
    default:
      return null
  }
}

/** The big headline value at the top of the conversion sheet. */
export function primaryLabel(kind: ConvertKind, raw: string): string {
  return kind === 'shoe' ? displayValue(kind, raw) : raw.trim()
}
