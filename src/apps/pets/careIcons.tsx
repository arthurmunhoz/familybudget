import {
  Bath,
  Bone,
  Cookie,
  Footprints,
  PawPrint,
  Pill,
  Scissors,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import type { PetTaskIcon } from '../../lib/types'

/** Routine-task icon ids → Lucide. The iOS app maps the SAME ids in
 *  `mobile/src/apps/pets/petUi.tsx` (and its widget to SF Symbols) — the ids are
 *  stored in the shared `pet_care_tasks.icon` column, so keep all three in sync. */
export const CARE_ICONS: Record<PetTaskIcon, LucideIcon> = {
  bowl: Bone,
  walk: Footprints,
  treat: Cookie,
  pill: Pill,
  bath: Bath,
  nails: Scissors,
  teeth: Sparkles,
  paw: PawPrint,
}

export const CARE_ICON_IDS = Object.keys(CARE_ICONS) as PetTaskIcon[]
