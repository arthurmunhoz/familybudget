/**
 * Registry of the apps available in One Roof. Adding a new app is one
 * entry here plus a folder under src/apps/ and a route in App.tsx.
 *
 * Display names + descriptions are localized via i18n (`app.<id>.name` /
 * `app.<id>.desc`); the strings here are English fallbacks only. Icons are
 * Lucide components (one cohesive outline set — see the Warm Hearth refresh).
 */
import type { LucideIcon } from 'lucide-react'
import {
  Bell,
  Wallet,
  ShoppingCart,
  PawPrint,
  FolderLock,
  CalendarDays,
  Users,
  Calculator,
  Wrench,
} from 'lucide-react'

export interface HubApp {
  id: string
  name: string
  icon: LucideIcon
  route: string
  description: string
}

export const APPS: HubApp[] = [
  {
    id: 'pings',
    name: 'Nudges',
    icon: Bell,
    route: '/pings',
    description: 'A quick nudge to the family',
  },
  {
    id: 'calendar',
    name: 'Calendar',
    icon: CalendarDays,
    route: '/calendar',
    description: 'Shared family schedule',
  },
  {
    id: 'budget',
    name: 'Money',
    icon: Wallet,
    route: '/budget',
    description: 'Income & spending by period',
  },
  {
    id: 'shopping',
    name: 'Shopping',
    icon: ShoppingCart,
    route: '/shopping',
    description: 'Shared list, live sync',
  },
  {
    id: 'pets',
    name: 'Pets',
    icon: PawPrint,
    route: '/pets',
    description: 'Vet visits, meds & due dates',
  },
  {
    id: 'docs',
    name: 'Documents',
    icon: FolderLock,
    route: '/docs',
    description: 'IDs, insurance & records',
  },
  {
    id: 'family',
    name: 'Family',
    icon: Users,
    route: '/family',
    description: 'Everyone’s info at a glance',
  },
  {
    id: 'calc',
    name: 'Calculator',
    icon: Calculator,
    route: '/calc',
    description: 'Split bills, tips & deals',
  },
]

/** Shown on the hub only for admins (profile.is_admin). */
export const ADMIN_APP: HubApp = {
  id: 'admin',
  name: 'Admin',
  icon: Wrench,
  route: '/admin',
  description: 'Households & members',
}
