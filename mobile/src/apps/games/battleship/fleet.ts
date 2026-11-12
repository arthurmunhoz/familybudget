// Pure fleet helpers — mirror the server's rules (bs_check_fleet, migration
// 093): ships in bounds, no overlaps. Random layouts also keep ships from
// touching (nicer boards), which the server doesn't require.
import type { Ship } from '@/lib/games'

export function cells(s: Ship): [number, number][] {
  return Array.from({ length: s.len }, (_, i) => [s.r + (s.dir === 'v' ? i : 0), s.c + (s.dir === 'v' ? 0 : i)])
}

const key = (r: number, c: number) => `${r}:${c}`

export function occupied(ships: Ship[], skip?: number): Set<string> {
  const set = new Set<string>()
  ships.forEach((s, i) => {
    if (i === skip) return
    for (const [r, c] of cells(s)) set.add(key(r, c))
  })
  return set
}

/** Does `ship` fit on the board among `ships` (ignoring index `skip`)? */
export function fits(ships: Ship[], ship: Ship, size: number, skip?: number): boolean {
  const taken = occupied(ships, skip)
  return cells(ship).every(([r, c]) => r >= 0 && c >= 0 && r < size && c < size && !taken.has(key(r, c)))
}

/** Where `ship` fits closest to where it is now (by centre distance), or null
 *  if it fits nowhere. Used when rotating in place is blocked by a neighbour
 *  or the edge: the ship turns AND slides to the nearest free spot. */
export function nearestFit(ships: Ship[], ship: Ship, size: number, skip?: number): Ship | null {
  if (fits(ships, ship, size, skip)) return ship
  const centre = (s: Ship) => [s.r + (s.dir === 'v' ? (s.len - 1) / 2 : 0), s.c + (s.dir === 'h' ? (s.len - 1) / 2 : 0)]
  const [cr, cc] = centre(ship)
  let best: Ship | null = null
  let bestD = Infinity
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++) {
      const cand = { ...ship, r, c }
      if (!fits(ships, cand, size, skip)) continue
      const [r2, c2] = centre(cand)
      const d = (r2 - cr) ** 2 + (c2 - cc) ** 2
      if (d < bestD) {
        bestD = d
        best = cand
      }
    }
  return best
}

export function shipAt(ships: Ship[], r: number, c: number): number {
  return ships.findIndex((s) => cells(s).some(([a, b]) => a === r && b === c))
}

/** Lengths still to place, given the fleet and what's on the board. */
export function remaining(fleet: number[], ships: Ship[]): number[] {
  const left = [...fleet]
  for (const s of ships) {
    const i = left.indexOf(s.len)
    if (i >= 0) left.splice(i, 1)
  }
  return left
}

/** A random legal fleet, ships not touching each other (retries until it fits). */
export function randomFleet(fleet: number[], size: number): Ship[] {
  for (let attempt = 0; attempt < 200; attempt++) {
    const ships: Ship[] = []
    const halo = new Set<string>()
    let ok = true
    for (const len of [...fleet].sort((a, b) => b - a)) {
      let placed = false
      for (let tries = 0; tries < 100 && !placed; tries++) {
        const dir: 'h' | 'v' = Math.random() < 0.5 ? 'h' : 'v'
        const r = Math.floor(Math.random() * (dir === 'v' ? size - len + 1 : size))
        const c = Math.floor(Math.random() * (dir === 'h' ? size - len + 1 : size))
        const ship = { r, c, len, dir }
        if (cells(ship).some(([a, b]) => halo.has(key(a, b)))) continue
        ships.push(ship)
        for (const [a, b] of cells(ship)) for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) halo.add(key(a + dr, b + dc))
        placed = true
      }
      if (!placed) {
        ok = false
        break
      }
    }
    if (ok) return ships
  }
  return []
}
