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

/** A household-defined budget category (entries store its uuid in `category`). */
export interface CustomCategory {
  id: string
  name: string
  icon: string
  created_at: string
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
  /** Custom tile color (#rrggbb); null = catalog color (by slug) or neutral. */
  color: string | null
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

export interface Ping {
  id: string
  household_id: string
  sender_email: string
  kind: string
  emoji: string
  message: string
  /** Targeted recipient emails; null = the whole household. */
  recipients: string[] | null
  created_at: string
  expires_at: string
}

export interface PingAck {
  ping_id: string
  user_email: string
  created_at: string
}

export type EventRecurrence = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'

/** A plain event, or a special dated type carried over from Important Dates. */
export type EventKind = 'event' | 'birthday' | 'anniversary' | 'renewal' | 'other'

export interface CalendarEvent {
  id: string
  household_id: string
  title: string
  /** ISO YYYY-MM-DD. end_date = start_date for a single-day event, later for
   *  a multi-day span (inclusive). Compare these lexicographically. */
  start_date: string
  end_date: string
  all_day: boolean
  /** 'HH:MM:SS' wall-clock when timed; null when all_day. */
  start_time: string | null
  end_time: string | null
  location: string | null
  notes: string | null
  /** Whom the event belongs to (drives color-by-member). null = whole household. */
  owner_email: string | null
  /** Explicit color override (hex); null = derived from the owner. */
  color: string | null
  recurrence: EventRecurrence
  recurrence_until: string | null
  /** Special date type (birthday/anniversary/renewal/other) or a plain 'event'. */
  kind: EventKind
  /** Minutes-before to remind; null = no reminder. */
  reminder_minutes: number | null
  /** Where the event came from: created in-app, pulled from Google, or pulled
   *  from the device's Apple/iCloud calendar (on-device EventKit sync). */
  source: 'oneroof' | 'google' | 'apple'
  google_event_id: string | null
  google_calendar_id: string | null
  /** The device (EventKit) event id for source='apple' rows — dedups re-imports. */
  apple_event_id: string | null
  synced_at: string | null
  created_by: string | null
  created_at: string
}
