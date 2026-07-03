import type { CategoryRule, CustomCategory } from './types'

export interface Category {
  id: string
  name: string
  icon: string
}

export const CATEGORIES: Category[] = [
  { id: 'groceries', name: 'Groceries', icon: '🛒' },
  { id: 'dining', name: 'Dining', icon: '🍽️' },
  { id: 'transport', name: 'Transport', icon: '🚗' },
  { id: 'home', name: 'Home', icon: '🏠' },
  { id: 'utilities', name: 'Utilities', icon: '💡' },
  { id: 'health', name: 'Health', icon: '💊' },
  { id: 'entertainment', name: 'Fun', icon: '🎬' },
  { id: 'shopping', name: 'Shopping', icon: '🛍️' },
  { id: 'travel', name: 'Travel', icon: '✈️' },
  { id: 'subscriptions', name: 'Subscriptions', icon: '📺' },
  { id: 'gifts', name: 'Gifts', icon: '🎁' },
  { id: 'pets', name: 'Pets', icon: '🐾' },
  { id: 'salary', name: 'Salary', icon: '💼' },
  { id: 'other', name: 'Other', icon: '📦' },
]

/** Resolve built-in first, then the household's custom categories, then 'other'
 *  (so entries keep rendering if a custom category is deleted). */
export function categoryById(id: string, custom?: CustomCategory[]): Category {
  const builtin = CATEGORIES.find((c) => c.id === id)
  if (builtin) return builtin
  const c = custom?.find((cc) => cc.id === id)
  if (c) return { id: c.id, name: c.name, icon: c.icon }
  return CATEGORIES[CATEGORIES.length - 1]
}

export function isBuiltinCategory(id: string): boolean {
  return CATEGORIES.some((c) => c.id === id)
}

const KEYWORD_DEFAULTS: Record<string, string> = {
  uber: 'transport',
  lyft: 'transport',
  gas: 'transport',
  fuel: 'transport',
  parking: 'transport',
  toll: 'transport',
  grocery: 'groceries',
  groceries: 'groceries',
  market: 'groceries',
  safeway: 'groceries',
  'trader joe': 'groceries',
  costco: 'groceries',
  'whole foods': 'groceries',
  restaurant: 'dining',
  lunch: 'dining',
  dinner: 'dining',
  coffee: 'dining',
  starbucks: 'dining',
  doordash: 'dining',
  pizza: 'dining',
  rent: 'home',
  mortgage: 'home',
  furniture: 'home',
  cleaning: 'home',
  electric: 'utilities',
  electricity: 'utilities',
  water: 'utilities',
  internet: 'utilities',
  wifi: 'utilities',
  phone: 'utilities',
  pharmacy: 'health',
  doctor: 'health',
  dentist: 'health',
  gym: 'health',
  insurance: 'health',
  movie: 'entertainment',
  cinema: 'entertainment',
  concert: 'entertainment',
  game: 'entertainment',
  amazon: 'shopping',
  target: 'shopping',
  clothes: 'shopping',
  flight: 'travel',
  hotel: 'travel',
  airbnb: 'travel',
  netflix: 'subscriptions',
  spotify: 'subscriptions',
  hulu: 'subscriptions',
  disney: 'subscriptions',
  icloud: 'subscriptions',
  subscription: 'subscriptions',
  gift: 'gifts',
  birthday: 'gifts',
  dog: 'pets',
  vet: 'pets',
  chewy: 'pets',
  petco: 'pets',
  petsmart: 'pets',
  grooming: 'pets',
  lola: 'pets',
  aninha: 'pets',
  salary: 'salary',
  paycheck: 'salary',
  bonus: 'salary',
}

export function normalizeLabel(label: string): string {
  return label.trim().toLowerCase()
}

/**
 * Suggest a category for a label: learned rules (exact label match) win,
 * then built-in keyword substring matching, then 'other'.
 */
export function suggestCategory(label: string, learnedRules: CategoryRule[]): string {
  const normalized = normalizeLabel(label)
  if (!normalized) return 'other'

  const learned = learnedRules.find((r) => r.keyword === normalized)
  if (learned) return learned.category

  for (const [keyword, category] of Object.entries(KEYWORD_DEFAULTS)) {
    if (normalized.includes(keyword)) return category
  }
  return 'other'
}
