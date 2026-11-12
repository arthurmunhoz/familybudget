// Several households per account (migration 099): list them, switch the
// ACTIVE one, join another by invite code, leave one.
//
// The active household is per ACCOUNT (allowed_users.household_id, read by
// current_household() in every RLS policy), so a switch changes what the
// database answers for every query at once. After any change we notify
// `onHouseholdChange` listeners — AuthProvider re-reads the profile and the
// member list, and when the household id actually moves it clears the query
// cache and refetches every mounted screen (see auth.tsx).
import { supabase } from './supabase'

export interface MyHousehold {
  household_id: string
  name: string
  role: 'owner' | 'member'
  joined_at: string
  member_count: number
  is_active: boolean
}

type Listener = () => void | Promise<void>
const listeners = new Set<Listener>()

/** Subscribe to "the active household (or the list of households) changed". */
export function onHouseholdChange(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

async function changed(): Promise<void> {
  await Promise.all([...listeners].map((fn) => Promise.resolve(fn()).catch(() => {})))
}

/** My households, the active one flagged. Empty when the server predates 099
 *  (the RPC is missing) — callers treat that as "one household, no switcher". */
export async function fetchMyHouseholds(): Promise<MyHousehold[]> {
  const { data, error } = await supabase.rpc('my_households')
  if (error) return []
  return (data as MyHousehold[]) ?? []
}

export async function setActiveHousehold(id: string): Promise<void> {
  const { error } = await supabase.rpc('set_active_household', { p_household: id })
  if (error) throw error
  await changed()
}

/** Join (and switch to) the household behind an invite code. */
export async function joinHousehold(code: string): Promise<void> {
  const { error } = await supabase.rpc('join_household', { p_code: code.trim().toUpperCase() })
  if (error) throw error
  await changed()
}

/** Create (and switch to) a new household. For someone who already has one
 *  the server requires them to OWN the active household and it to have a PAID
 *  Plus; the new family rides on that Plus, and an account stops at 3 families
 *  (migration 104) — see `householdError`. */
export async function createHousehold(name: string): Promise<void> {
  const { error } = await supabase.rpc('create_household', { p_name: name.trim() })
  if (error) throw error
  await changed()
}

/** Leave a household. An only owner of a household that has other members
 *  must name `newOwner`; leaving a household you're alone in deletes it. */
export async function leaveHousehold(id: string, newOwner?: string): Promise<void> {
  const { error } = await supabase.rpc('leave_household', {
    p_household: id,
    p_new_owner: newOwner ?? null,
  })
  if (error) throw error
  await changed()
}

/** Error text from the RPCs → which message to show. */
export type HouseholdError =
  | 'invalidCode'
  | 'alreadyMember'
  | 'full'
  | 'tooMany'
  | 'lastOwner'
  | 'lastHousehold'
  | 'plusRequired'
  | 'plusOwnerRequired'
  | 'payerOwner'
  | 'familyLimit'
  | 'generic'

export function householdError(e: unknown): HouseholdError {
  const m = String((e as { message?: string } | null)?.message ?? e ?? '')
  if (m.includes('invalid code')) return 'invalidCode'
  if (m.includes('already a member')) return 'alreadyMember'
  if (m.includes('household_member_limit')) return 'full'
  if (m.includes('too many')) return 'tooMany'
  if (m.includes('last_owner')) return 'lastOwner'
  if (m.includes('last_household')) return 'lastHousehold'
  if (m.includes('plus_owner_required')) return 'plusOwnerRequired'
  if (m.includes('plus_required')) return 'plusRequired'
  if (m.includes('plus_owner')) return 'payerOwner'
  if (m.includes('household_limit') && !m.includes('member_limit')) return 'familyLimit'
  return 'generic'
}

/** A push from another household (api/ puts `household` in its data): switch
 *  to it before the tap lands on its screen, so "Bob added milk" opens the list
 *  it's about. Silent no-op if it's already active or we're not a member. */
export async function switchForNotification(householdId: string): Promise<void> {
  try {
    const { data: s } = await supabase.auth.getSession()
    const email = s.session?.user.email
    if (!email) return
    const { data } = await supabase
      .from('allowed_users')
      .select('household_id')
      .eq('email', email)
      .maybeSingle()
    const current = (data as { household_id?: string } | null)?.household_id
    if (!current || current === householdId) return
    await setActiveHousehold(householdId)
  } catch {
    /* not a member any more, or offline: open the screen in the current one */
  }
}
