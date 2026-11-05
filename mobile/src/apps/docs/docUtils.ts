// Shared constants + helpers for the Document Vault module.
import {
  FileText,
  HeartPulse,
  House,
  IdCard,
  type LucideIcon,
  PawPrint,
  Receipt,
  ShieldCheck,
} from 'lucide-react-native'

import type { DocCategory } from '@/lib/types'

/** The document categories, in display order, each with an emoji + an outline
 *  icon (used for the per-document type glyph in the list). */
// The app draws `Icon` (Lucide), never `icon`: 🪪 is Emoji 14, missing from
// older Android emoji fonts, and on those a chip reading "🪪 IDs" rendered the
// glyph and then dropped the whole label after it (seen on a Galaxy S9+,
// Android 10). The emoji stays as data for parity with the PWA.
export const CATEGORIES: { id: DocCategory; icon: string; Icon: LucideIcon }[] = [
  { id: 'ids', icon: '🪪', Icon: IdCard },
  { id: 'insurance', icon: '🛡️', Icon: ShieldCheck },
  { id: 'medical', icon: '🏥', Icon: HeartPulse },
  { id: 'pets', icon: '🐾', Icon: PawPrint },
  { id: 'home', icon: '🏠', Icon: House },
  { id: 'receipts', icon: '🧾', Icon: Receipt },
  { id: 'other', icon: '📦', Icon: FileText },
]

/** A colour per category for its tile and group icon (2026-11 restyle). */
export const CAT_COLOR: Record<DocCategory, string> = {
  ids: '#4C7BF4',
  insurance: '#16A3A8',
  medical: '#E0609B',
  pets: '#F2603A',
  home: '#3D9B5C',
  receipts: '#8E6CF0',
  other: '#7C8597',
}

export const CAT_ICON = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.icon])) as Record<
  DocCategory,
  string
>
export const CAT_LUCIDE = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.Icon])) as Record<
  DocCategory,
  LucideIcon
>

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** UUID v4 without a crypto dependency (good enough for a storage filename). */
export function randomUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    const v = ch === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// ---- Thumbnails -------------------------------------------------------------
// A document's list thumbnail lives at a path DERIVED from its file path —
// `<household>/thumbs/<uuid>.jpg` — so it needs no `documents` column (no
// migration, and the PWA/older builds that never write one keep working: a
// missing thumb just falls back). Keyed on the file's uuid, not its category
// folder, so recategorising a document can't orphan it. The household prefix
// keeps it inside the bucket's storage policy.
export const THUMB_WIDTH = 320

export function thumbPathFor(filePath: string): string {
  const [household] = filePath.split('/')
  const base = (filePath.split('/').pop() ?? '').replace(/\.[^.]+$/, '')
  return `${household}/thumbs/${base}.jpg`
}

export function isImageDoc(mime: string | null | undefined, filePath: string): boolean {
  if (mime?.startsWith('image/')) return true
  const ext = (filePath.split('.').pop() ?? '').toLowerCase()
  return ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif'].includes(ext)
}
