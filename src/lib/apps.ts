/**
 * Registry of the apps available in the Family Hub. Adding a new app is one
 * entry here plus a folder under src/apps/ and a route in App.tsx.
 */
export interface HubApp {
  id: string
  name: string
  icon: string
  route: string
  description: string
}

export const APPS: HubApp[] = [
  {
    id: 'budget',
    name: 'Budget',
    icon: '💰',
    route: '/budget',
    description: 'Income & spending by period',
  },
  {
    id: 'shopping',
    name: 'Shopping List',
    icon: '🛒',
    route: '/shopping',
    description: 'Shared grocery list, live sync',
  },
  {
    id: 'pets',
    name: 'Pet Care',
    icon: '🐕',
    route: '/pets',
    description: 'Vet visits, meds & due dates',
  },
  {
    id: 'docs',
    name: 'Documents',
    icon: '📄',
    route: '/docs',
    description: 'IDs, insurance & records',
  },
]
