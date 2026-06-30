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
export const CATEGORIES: { id: DocCategory; icon: string; Icon: LucideIcon }[] = [
  { id: 'ids', icon: '🪪', Icon: IdCard },
  { id: 'insurance', icon: '🛡️', Icon: ShieldCheck },
  { id: 'medical', icon: '🏥', Icon: HeartPulse },
  { id: 'pets', icon: '🐾', Icon: PawPrint },
  { id: 'home', icon: '🏠', Icon: House },
  { id: 'receipts', icon: '🧾', Icon: Receipt },
  { id: 'other', icon: '📦', Icon: FileText },
]

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
