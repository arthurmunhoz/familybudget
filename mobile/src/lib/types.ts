export type EntryType = 'expense' | 'income'

export interface Profile {
  email: string
  display_name: string
  household_id: string
  is_admin: boolean
  /** Household-scoped role (migration 051). Distinct from the global is_admin.
   *  Optional because some queries don't select it. */
  role?: 'owner' | 'member'
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
  /** 'household' = everyone in the household sees it (the default, and every
   *  budget that predates migration 058). 'private' = only the owner and the
   *  people they've shared it with — enforced by RLS, not by this field. */
  visibility?: 'household' | 'private'
  /** Who created it and controls its access list. Null on pre-058 rows (all of
   *  which are 'household', where it's never consulted). */
  owner_email?: string | null
}

/** A person a private budget has been shared with (migration 058). */
export interface BudgetMember {
  budget_id: string
  email: string
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

/** Per-household override of a built-in preset category (migration 056).
 *  name/icon are null when that field keeps the default. */
export interface CategoryOverride {
  base_id: string
  name: string | null
  icon: string | null
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
  /** Per-pet calendar dot color (hex); null = a palette color by pet order. */
  tag_color: string | null
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

/** Icon ids for pet care tasks — rendered as Lucide in-app, SF Symbols in the
 *  widget (see CARE_ICONS / the Swift symbol map). */
export type PetTaskIcon = 'bowl' | 'walk' | 'treat' | 'pill' | 'bath' | 'nails' | 'teeth' | 'paw'

/** One item of a pet’s configurable routine (migration 069). 'daily' = resets
 *  each day, ordered by sort_order; 'interval' = due every interval_days from
 *  the latest completion. */
export interface PetCareTask {
  id: string
  pet_id: string
  kind: 'daily' | 'interval'
  title: string
  icon: PetTaskIcon
  interval_days: number | null
  sort_order: number
  created_at: string
}

/** A completion of a task on a day; unique per (task, day). */
export interface PetTaskDone {
  id: string
  task_id: string
  done_on: string
  done_by: string
  created_at: string
}

export interface PetWeight {
  id: string
  pet_id: string
  weight: number
  measured_on: string
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
  /** Urgent nudge (Need-Help-style): red UI, sound/vibration, Call CTA. */
  high_priority: boolean
  created_at: string
  expires_at: string
}

/** An editable per-household nudge preset (from ping_presets). */
export interface PingPreset {
  id: string
  emoji: string
  /** Custom text; overrides preset_key localization when set. */
  label: string | null
  /** i18n suffix (pings.preset.<key>) for a seeded default; null for custom. */
  preset_key: string | null
  high_priority: boolean
  sort_order: number
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

/** A household member's live position + sharing state (migration 065), one row
 *  per member. `lat`/`lng` are null before the first fix, or while sharing is
 *  off/paused (we null the coordinates then so no stale location leaks). Use
 *  `isSharingLive()` in `@/lib/location` to decide whether to plot a pin — a row
 *  can exist purely to carry `sharing: false`. */
/** A temporary Safety Radius / "event mode" watch (migration 068, One Roof Plus).
 *  One per owner. Breach detection runs on the OWNER's device against the live
 *  member_locations feed — there's no server job. */
export interface SafetyWatch {
  owner_email: string
  household_id: string
  center_lat: number
  center_lng: number
  radius_m: number
  /** Emails of the members being watched. */
  watched: string[]
  expires_at: string
  created_at: string
}

/** A saved household place (migration 067) monitored as a native geofence.
 *  `radius_m` is the geofence radius; iOS quietly enforces a floor around 100 m,
 *  so very small radii behave like ~100 m in practice. */
export interface Place {
  id: string
  household_id: string
  name: string
  icon: string
  lat: number
  lng: number
  radius_m: number
  notify_arrivals: boolean
  notify_departures: boolean
  created_by: string
  created_at: string
}

/** A member crossing a place's geofence (migration 067) — drives the activity
 *  feed and the "Emma arrived at School" push. */
export interface PlaceEvent {
  id: string
  household_id: string
  place_id: string
  user_email: string
  type: 'arrive' | 'leave'
  at: string
}

export interface MemberLocation {
  user_email: string
  household_id: string
  lat: number | null
  lng: number | null
  /** Horizontal accuracy in meters, if reported. */
  accuracy: number | null
  /** Ground speed in m/s, if reported (drives the "Driving" hint). */
  speed: number | null
  /** Battery level 0–100, if reported. */
  battery: number | null
  sharing: boolean
  /** ISO timestamp; while in the future, this member has paused sharing. */
  paused_until: string | null
  updated_at: string
}
