// Maps an analytics path root ('budget', 'shopping', …) to a display name +
// Lucide icon, for the Admin usage/activity views. Broader than the hub apps: it
// also covers route details that roll up into an app ('month' → Money) and
// historical routes kept for old events ('dates' → the calendar). Mirrors the
// PWA's src/lib/appRoutes.ts (same map, native icons) — keep the two in sync.
import type { LucideIcon } from 'lucide-react-native'
import {
  Bell,
  Calculator,
  CalendarDays,
  CalendarHeart,
  FolderLock,
  Gamepad2,
  Home,
  LayoutGrid,
  MapPin,
  PawPrint,
  ListChecks,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react-native'

export const APP_META: Record<string, { name: string; icon: LucideIcon }> = {
  '': { name: 'Hub', icon: Home },
  budget: { name: 'Money', icon: Wallet },
  month: { name: 'Money', icon: Wallet },
  shopping: { name: 'Lists', icon: ListChecks },
  pings: { name: 'Nudges', icon: Bell },
  location: { name: 'Whereabouts', icon: MapPin },
  pets: { name: 'Pets', icon: PawPrint },
  docs: { name: 'Documents', icon: FolderLock },
  calendar: { name: 'Calendar', icon: CalendarDays },
  // Kept for historical analytics: 'dates' was merged into the calendar.
  dates: { name: 'Dates', icon: CalendarHeart },
  family: { name: 'Family', icon: Users },
  calc: { name: 'Calculator', icon: Calculator },
  games: { name: 'Games', icon: Gamepad2 },
  admin: { name: 'Admin', icon: Wrench },
}

/** Resolve a stored event path to its app name + icon (root = first segment). */
export function appForPath(path: string | null): { name: string; icon: LucideIcon } {
  const root = (path ?? '/').split('/')[1] ?? ''
  return APP_META[root] ?? { name: root || 'Hub', icon: LayoutGrid }
}
