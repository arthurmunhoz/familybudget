export type EntryType = 'expense' | 'income'

export interface Profile {
  email: string
  display_name: string
  household_id: string
  is_admin: boolean
}

export interface Household {
  id: string
  name: string
  /** null = no backdrop · 'builtin:beach' = original beach scene ·
   *  anything else = uploaded image path in the documents bucket */
  backdrop_path: string | null
  created_at: string
}

export type Period = 'daily' | 'weekly' | 'monthly'

export interface Budget {
  id: string
  name: string
  period: Period
  created_at: string
}

/** One budget period (named "months" historically): monthly = 1st of month,
 *  weekly = week start (Sunday), daily = the day itself. */
export interface Month {
  id: string
  budget_id: string
  start_date: string
  created_at: string
}

export interface Entry {
  id: string
  month_id: string
  type: EntryType
  label: string
  amount: number
  category: string
  /** Optional free-text subcategory, e.g. Health → "supplements" */
  subcategory: string | null
  entry_date: string
  person_email: string
  recurring: boolean
  created_at: string
}

export interface CategoryRule {
  keyword: string
  category: string
}

export interface ShoppingItem {
  id: string
  label: string
  checked: boolean
  added_by: string
  created_at: string
  checked_at: string | null
  store_id: string | null
}

export interface ShoppingStore {
  id: string
  household_id: string
  name: string
  slug: string | null
  created_at: string
}

export type PetEventType = 'vet' | 'vaccine' | 'medication' | 'grooming' | 'other'

export interface Pet {
  id: string
  name: string
  emoji: string
  species: string | null
  breed: string | null
  birthday: string | null
  color: string | null
  color_secondary: string | null
  weight: string | null
  length: string | null
  microchip: string | null
  notes: string | null
  photo_path: string | null
  created_at: string
}

export interface PetEvent {
  id: string
  pet_id: string
  type: PetEventType
  title: string
  notes: string | null
  event_date: string
  next_due: string | null
  added_by: string
  created_at: string
}

export type DocCategory =
  | 'ids'
  | 'insurance'
  | 'medical'
  | 'pets'
  | 'home'
  | 'receipts'
  | 'other'

export interface FamilyDocument {
  id: string
  title: string
  category: DocCategory
  file_path: string
  mime_type: string
  size_bytes: number
  /** Who the document belongs to (person filter uses this) */
  owner_email: string
  /** Who uploaded it */
  added_by: string
  created_at: string
}

export interface MemberProfile {
  email: string
  household_id: string
  avatar_path: string | null
  birthday: string | null
  phone: string | null
  blood_type: string | null
  height: string | null
  weight: string | null
  shoe_size: string | null
  pants_size: string | null
  shirt_size: string | null
  allergies: string | null
  notes: string | null
  updated_at: string
}

export interface Signal {
  id: string
  household_id: string
  sender_email: string
  kind: string
  emoji: string
  message: string
  created_at: string
  expires_at: string
}

export interface SignalAck {
  signal_id: string
  user_email: string
  created_at: string
}

export type ImportantDateType = 'birthday' | 'anniversary' | 'renewal' | 'other'

export interface ImportantDate {
  id: string
  household_id: string
  title: string
  type: ImportantDateType
  event_date: string
  /** true = birthdays/anniversaries/yearly renewals; false = one-time deadline */
  repeats_annually: boolean
  notes: string | null
  created_at: string
}
