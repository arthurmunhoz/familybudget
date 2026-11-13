// Several families per account (migrations 099/104): the cap and who may
// create another one right now. Shared by Settings' Family card and /families.
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { useAuth } from '@/lib/auth'
import { fetchMyHouseholds, type MyHousehold } from '@/lib/households'
import { usePlus } from '@/lib/plus'

/** Mirrors the server's cap (migration 104 `max_households_per_account`). */
export const MAX_FAMILIES = 3

/** Who may create another family right now (migration 104): the OWNER of the
 *  active family, and it must have a PAID Plus (the signup trial doesn't count). */
export type CreateGate = 'ok' | 'owner' | 'trial' | 'plus' | 'full'

export function useFamilies() {
  const { profile } = useAuth()
  const { isPlus, isTrial } = usePlus()
  const { data: list = [], revalidate } = useCachedQuery<MyHousehold[]>('settings:households', fetchMyHouseholds)
  const count = Math.max(list.length, 1)
  const full = list.length >= MAX_FAMILIES
  const gate: CreateGate = full
    ? 'full'
    : profile?.role !== 'owner'
      ? 'owner'
      : isPlus && !isTrial
        ? 'ok'
        : isTrial
          ? 'trial'
          : 'plus'
  return { list, count, full, gate, revalidate }
}

