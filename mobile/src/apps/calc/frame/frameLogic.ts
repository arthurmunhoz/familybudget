// Photo frame — the pure parts (no React, no native modules), pinned by
// __tests__/frame.test.ts: album caps, the order slides play in (birthdays
// first), night hours, how a photo is fitted, and the resize target.

/** Mirrors frame_photo_cap() in migration 100. The trigger is the real limit;
 *  these are for the "12 of 30" line and the upsell only. */
export const FRAME_LIMIT_FREE = 30
export const FRAME_LIMIT_PLUS = 500
export const frameLimit = (isPlus: boolean) => (isPlus ? FRAME_LIMIT_PLUS : FRAME_LIMIT_FREE)

/** Long side of an uploaded album photo, and its JPEG quality (~300–400 KB). */
export const UPLOAD_LONG_SIDE = 1600
export const UPLOAD_QUALITY = 0.8

/** One photo the slideshow can show, from either source. `uri` is LOCAL. */
export interface Slide {
  id: string
  uri: string
  source: 'family' | 'device'
  /** Email of whoever added it (family album only) — shown as their avatar. */
  addedBy?: string | null
  /** Optional member tag (family album only). */
  memberEmail?: string | null
  width?: number | null
  height?: number | null
}

/** What the server error means for the app. */
export type FrameLimitKind = 'free' | 'plus' | null
export function limitKind(message: string | undefined | null): FrameLimitKind {
  if (!message) return null
  if (message.includes('free_plan_frame_limit')) return 'free'
  if (message.includes('frame_photo_limit')) return 'plus'
  return null
}

/** Size to hand ImageManipulator.resize so the LONG side is `max` — or null
 *  when the photo is already small enough (never upscale). */
export function resizeTarget(width: number, height: number, max = UPLOAD_LONG_SIDE): { width: number } | { height: number } | null {
  if (!width || !height || Math.max(width, height) <= max) return null
  return width >= height ? { width: max } : { height: max }
}

/** Fisher–Yates with an injectable random (tests pass a seeded one). */
export function shuffle<T>(items: readonly T[], rand: () => number = Math.random): T[] {
  const a = items.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** The order one pass of the slideshow plays in. Shuffled (or, with
 *  `random` off, in the order given — newest first); on someone's
 *  birthday the photos tagged with them lead and then come back every other
 *  slide, so the day is theirs without hiding everyone else. */
export function buildDeck(
  slides: readonly Slide[],
  birthdayEmails: readonly string[],
  rand: () => number = Math.random,
  random = true,
): Slide[] {
  const mix = (items: readonly Slide[]) => (random ? shuffle(items, rand) : items.slice())
  const bday = new Set(birthdayEmails.map((e) => e.toLowerCase()))
  if (!bday.size) return mix(slides)
  const theirs = mix(slides.filter((s) => s.memberEmail && bday.has(s.memberEmail.toLowerCase())))
  if (!theirs.length) return mix(slides)
  const others = mix(slides.filter((s) => !(s.memberEmail && bday.has(s.memberEmail.toLowerCase()))))
  const out: Slide[] = []
  const n = Math.max(theirs.length, others.length)
  for (let i = 0; i < n; i++) {
    if (i < theirs.length) out.push(theirs[i])
    if (i < others.length) out.push(others[i])
  }
  return out
}

/** Is `minutes` (minutes since local midnight) inside the night window
 *  [start, end)? A window that crosses midnight (22 → 7) wraps; start == end
 *  means "never". */
export function isNight(minutes: number, startHour: number, endHour: number): boolean {
  const s = startHour * 60
  const e = endHour * 60
  if (s === e) return false
  return s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e
}

/** cover = fill the screen (crop a little); contain = show it whole over a
 *  blurred copy of itself. A photo whose shape fights the screen's (a
 *  portrait shot on a landscape frame) would lose too much to a crop. */
export function fitFor(photoW: number | null | undefined, photoH: number | null | undefined, screenW: number, screenH: number): 'cover' | 'contain' {
  if (!photoW || !photoH || !screenW || !screenH) return 'cover'
  const photo = photoW / photoH
  const screen = screenW / screenH
  const ratio = photo > screen ? photo / screen : screen / photo
  return ratio > 1.35 ? 'contain' : 'cover'
}

/** The slow Ken Burns move for one slide: zoom from `from` to `to` while
 *  drifting toward a corner. Deterministic per slide id so a re-render
 *  doesn't change direction mid-move. */
export function kenBurns(id: string): { from: number; to: number; dx: number; dy: number } {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  const dir = Math.abs(h) % 4
  const zoomIn = (Math.abs(h) >> 2) % 3 !== 0 // mostly in, sometimes out
  const dx = dir % 2 === 0 ? 1 : -1
  const dy = dir < 2 ? 1 : -1
  return zoomIn ? { from: 1.02, to: 1.14, dx, dy } : { from: 1.14, to: 1.02, dx: -dx, dy: -dy }
}

/** `items` in the saved order: ids the list doesn't know yet (just added)
 *  lead, in their given order; then the rest as saved. */
export function applyOrder<T extends { id: string }>(items: readonly T[], ids: readonly string[]): T[] {
  const at = new Map(ids.map((id, i) => [id, i]))
  const fresh = items.filter((x) => !at.has(x.id))
  const known = items.filter((x) => at.has(x.id)).sort((a, b) => at.get(a.id)! - at.get(b.id)!)
  return [...fresh, ...known]
}
