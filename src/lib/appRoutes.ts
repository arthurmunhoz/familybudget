/**
 * Maps an analytics path root ('budget', 'shopping', …) to a display name +
 * Lucide icon, for the Admin usage/activity views. This is analytics-facing and
 * intentionally broader than APPS in apps.ts: it also covers route details that
 * roll up into an app ('month' → Money) and historical routes kept for old
 * events ('dates' was merged into the calendar). Keep in sync with apps.ts.
 */
import type { LucideIcon } from 'lucide-react'
import {
  Bell,
  Calculator,
  CalendarDays,
  CalendarHeart,
  FolderLock,
  Home,
  LayoutGrid,
  PawPrint,
  ShoppingCart,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react'

export const APP_META: Record<string, { name: string; icon: LucideIcon }> = {
  '': { name: 'Hub', icon: Home },
  budget: { name: 'Money', icon: Wallet },
  month: { name: 'Money', icon: Wallet },
  shopping: { name: 'Shopping', icon: ShoppingCart },
  pings: { name: 'Nudges', icon: Bell },
  pets: { name: 'Pets', icon: PawPrint },
  docs: { name: 'Documents', icon: FolderLock },
  calendar: { name: 'Calendar', icon: CalendarDays },
  // Kept for historical analytics: 'dates' was merged into the calendar.
  dates: { name: 'Dates', icon: CalendarHeart },
  family: { name: 'Family', icon: Users },
  calc: { name: 'Calculator', icon: Calculator },
  admin: { name: 'Admin', icon: Wrench },
}

/** Resolve a stored event path to its app name + icon (root = first segment). */
export function appForPath(path: string | null): { name: string; icon: LucideIcon } {
  const root = (path ?? '/').split('/')[1] ?? ''
  return APP_META[root] ?? { name: root || 'Hub', icon: LayoutGrid }
}
