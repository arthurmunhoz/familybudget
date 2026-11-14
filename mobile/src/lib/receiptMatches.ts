// Receipt scan ↔ shopping lists (2026-11). Pure helpers: what the scan sends
// to /api/scan-receipt (`listItems`) and how the ids the model matched become
// the rows of the "remove them from the lists?" sheet. Pinned by
// __tests__/receiptMatches.test.ts.
import type { ShoppingItem, ShoppingStore } from './types'

/** The server reads at most this many (api/scan-receipt.ts MAX_LIST_ITEMS). */
export const MAX_SCAN_LIST_ITEMS = 150

export interface ScanListItem {
  id: string
  name: string
  list: string
}

/** Open items as the scan request's `listItems`: trimmed names, the list's
 *  name ("General" for no store), capped. Checked items never go. */
export function scanListPayload(open: ShoppingItem[], stores: ShoppingStore[], anywhere: string): ScanListItem[] {
  const byId = new Map(stores.map((s) => [s.id, s.name]))
  const out: ScanListItem[] = []
  for (const i of open) {
    if (out.length >= MAX_SCAN_LIST_ITEMS) break
    const name = i.label.replace(/\s+/g, ' ').trim()
    if (i.checked || !name) continue
    out.push({ id: i.id, name, list: (i.store_id && byId.get(i.store_id)) || anywhere })
  }
  return out
}

export interface MatchGroup {
  /** null = the "General" list (no store, or a store that's gone). */
  store: ShoppingStore | null
  items: ShoppingItem[]
}

/** The matched ids that are STILL open, grouped by list in the household's
 *  store order ("General" last). Ids no longer open (bought or deleted on
 *  another phone while the form was up) and unknown ids drop out. */
export function matchGroups(matchedIds: string[], open: ShoppingItem[], stores: ShoppingStore[]): MatchGroup[] {
  const wanted = new Set(matchedIds)
  const hits = open.filter((i) => !i.checked && wanted.has(i.id))
  const known = new Set(stores.map((s) => s.id))
  const groups: MatchGroup[] = []
  for (const s of stores) {
    const items = hits.filter((i) => i.store_id === s.id)
    if (items.length) groups.push({ store: s, items })
  }
  const anywhere = hits.filter((i) => !i.store_id || !known.has(i.store_id))
  if (anywhere.length) groups.push({ store: null, items: anywhere })
  return groups
}

/** Every item id in the groups, in display order. */
export function groupIds(groups: MatchGroup[]): string[] {
  return groups.flatMap((g) => g.items.map((i) => i.id))
}
