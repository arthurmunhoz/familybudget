// Shared helpers + field config for the Family module (member profiles).
import type { MemberProfile } from '@/lib/types'
import type { TKey } from '@/lib/i18n'

/** A household member = an allowed_users row joined to its member_profiles row. */
export interface Member {
  email: string
  display_name: string
  is_admin: boolean
}

export const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']

/** Plain text profile fields, in display order (birthday handled separately). */
export const FIELDS: [keyof MemberProfile, TKey][] = [
  ['phone', 'family.phone'],
  ['blood_type', 'family.bloodType'],
  ['height', 'family.height'],
  ['weight', 'family.weight'],
  ['shoe_size', 'family.shoeSize'],
  ['pants_size', 'family.pantsSize'],
  ['shirt_size', 'family.shirtSize'],
  ['allergies', 'family.allergies'],
  ['notes', 'family.notes'],
]

/** Editable text fields shown in the edit sheet (birthday + blood_type are
 *  rendered separately with their own controls). */
export const EDIT_FIELDS: [keyof MemberProfile, TKey][] = [
  ['phone', 'family.phone'],
  ['height', 'family.height'],
  ['weight', 'family.weight'],
  ['shoe_size', 'family.shoeSize'],
  ['pants_size', 'family.pantsSize'],
  ['shirt_size', 'family.shirtSize'],
  ['allergies', 'family.allergies'],
  ['notes', 'family.notes'],
]

/** Whole-year age from a birthday ISO (YYYY-MM-DD), or null if invalid. */
export function ageOf(birthday: string | null, today: string): number | null {
  if (!birthday) return null
  const [by, bm, bd] = birthday.split('-').map(Number)
  const [ty, tm, td] = today.split('-').map(Number)
  let age = ty - by
  if (tm < bm || (tm === bm && td < bd)) age--
  return age >= 0 && age <= 130 ? age : null
}

/** First character of a name, uppercased, for the initials avatar fallback. */
export function initial(name: string): string {
  return (name.trim().charAt(0) || '?').toUpperCase()
}
