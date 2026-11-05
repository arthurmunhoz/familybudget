// Pure money maths behind the two bill-split wizards. Kept free of React so it
// can be pinned by tests (__tests__/splitMath.test.ts).
//
// Everything is done in whole CENTS. A bill never divides evenly in general
// ($100 / 3), and showing three people "$33.33" for a $100 bill silently loses
// a cent — so the remainder is handed out one cent at a time and the shares
// always add back up to the exact total.

export const toCents = (n: number) => Math.round(n * 100)
export const fromCents = (c: number) => c / 100

/** Split `totalCents` into `n` shares proportional to `weights` (equal when
 *  omitted) that sum EXACTLY to the total — largest-remainder rounding, ties
 *  broken by position so the result is stable between renders. */
export function apportion(totalCents: number, n: number, weights?: number[]): number[] {
  if (n <= 0) return []
  const w = weights ?? Array.from({ length: n }, () => 1)
  const sum = w.reduce((s, x) => s + x, 0)
  if (sum <= 0) return Array.from({ length: n }, () => 0)
  const raw = w.map((x) => (totalCents * x) / sum)
  const out = raw.map(Math.floor)
  let left = totalCents - out.reduce((s, x) => s + x, 0)
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k].i] += 1
  return out
}

// ── Split evenly ─────────────────────────────────────────────────────────────

export interface EvenResult {
  tip: number
  total: number
  /** What most people pay. */
  per: number
  /** When the cents don't divide, this many people pay `per + 0.01`. */
  extraCentCount: number
}

export function evenSplit(bill: number, people: number, tipPct: number): EvenResult {
  const n = Math.max(1, Math.floor(people))
  const billC = toCents(bill)
  const tipC = Math.round((billC * tipPct) / 100)
  const totalC = billC + tipC
  const base = Math.floor(totalC / n)
  return {
    tip: fromCents(tipC),
    total: fromCents(totalC),
    per: fromCents(base),
    extraCentCount: totalC - base * n,
  }
}

// ── Split by item ────────────────────────────────────────────────────────────

export interface SplitItem {
  id: string
  name: string
  price: number
  /** Names of the people sharing this item; empty = nobody yet. */
  people: string[]
}

export type Tip = { kind: 'pct'; pct: number } | { kind: 'amount'; amount: number }

export function tipAmount(subtotal: number, tip: Tip): number {
  return tip.kind === 'pct' ? fromCents(Math.round((toCents(subtotal) * tip.pct) / 100)) : tip.amount
}

export interface PersonShare {
  name: string
  items: { id: string; name: string; share: number; ways: number }[]
  /** Their items, before tax and tip. */
  base: number
  /** Their part of tax + tip, proportional to `base`. */
  extras: number
  total: number
}

export interface ItemSplitResult {
  subtotal: number
  tax: number
  tip: number
  total: number
  /** Items nobody has claimed — they're not charged to anyone. */
  unassigned: SplitItem[]
  people: PersonShare[]
}

/** Each item is shared equally by the people who had it; tax and tip are then
 *  shared in proportion to what each person ordered. Every split happens in
 *  cents with exact apportioning, so the people's totals add up to the bill
 *  (less any unassigned items). */
export function itemSplit(items: SplitItem[], people: string[], tax: number, tip: Tip): ItemSplitResult {
  const subtotalC = items.reduce((s, it) => s + toCents(it.price), 0)
  const taxC = toCents(tax)
  const tipC = toCents(tipAmount(fromCents(subtotalC), tip))

  const baseC = new Map<string, number>(people.map((p) => [p, 0]))
  const lines = new Map<string, PersonShare['items']>(people.map((p) => [p, []]))
  const unassigned: SplitItem[] = []
  for (const it of items) {
    const who = it.people.filter((p) => baseC.has(p))
    if (who.length === 0) {
      if (toCents(it.price) !== 0) unassigned.push(it)
      continue
    }
    const shares = apportion(toCents(it.price), who.length)
    who.forEach((p, i) => {
      baseC.set(p, (baseC.get(p) ?? 0) + shares[i])
      lines.get(p)!.push({ id: it.id, name: it.name, share: fromCents(shares[i]), ways: who.length })
    })
  }

  const bases = people.map((p) => baseC.get(p) ?? 0)
  const assignedC = bases.reduce((s, x) => s + x, 0)
  // Tax and tip belong to the whole bill; when part of it is unassigned, only
  // the assigned share of the extras is handed out.
  const extrasC =
    subtotalC > 0 ? Math.round(((taxC + tipC) * assignedC) / subtotalC) : 0
  const extras = assignedC > 0 ? apportion(extrasC, people.length, bases) : people.map(() => 0)

  return {
    subtotal: fromCents(subtotalC),
    tax: fromCents(taxC),
    tip: fromCents(tipC),
    total: fromCents(subtotalC + taxC + tipC),
    unassigned,
    people: people.map((name, i) => ({
      name,
      items: lines.get(name) ?? [],
      base: fromCents(bases[i]),
      extras: fromCents(extras[i]),
      total: fromCents(bases[i] + extras[i]),
    })),
  }
}
