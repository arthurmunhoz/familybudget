// Inviting someone into the household (owner, 2026-11-15). One place for the
// invite LINK, the share sheet and the "arrived from a link" code, so the
// onboarding step, the Home banner, the family strip's "+" and Settings all
// send the same message and count the same events.
//
// The link is a static page (public/join.html on the web project) with the
// store buttons and an "Open in the app" button → oneroof://join?code=…
// (app/join.tsx), which lands on the join step with the code filled in. The
// code rides in the URL FRAGMENT, so it never reaches a server log.
import { Share } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { track } from './analytics'
import { supabase } from './supabase'

const INVITE_BASE = 'https://one-roof-app.vercel.app/join'
const PENDING_JOIN_KEY = 'pending-join-code'

export type InviteSource = 'onboarding' | 'banner' | 'strip' | 'settings'

export const inviteLink = (code: string) => `${INVITE_BASE}#${encodeURIComponent(code)}`

/** The active household's join code — null for anyone but its owner. */
export async function fetchJoinCode(): Promise<string | null> {
  const { data } = await supabase.rpc('get_join_code')
  return typeof data === 'string' ? data : null
}

/** Open the system share sheet with the invite. Resolves true when the person
 *  actually picked somewhere to send it (iOS reports that; Android always
 *  reports "shared", so there it means "the sheet was opened"). */
export async function shareInvite(
  t: (key: 'household.shareMessage', vars: Record<string, string>) => string,
  code: string,
  source: InviteSource,
): Promise<boolean> {
  try {
    const res = await Share.share({ message: t('household.shareMessage', { code, link: inviteLink(code) }) })
    if (res.action === Share.dismissedAction) return false
    track('invite.shared', { source })
    return true
  } catch {
    return false
  }
}

/** A code that arrived through an invite link before the person had a
 *  household: kept until the join step reads it. */
export async function setPendingJoinCode(code: string): Promise<void> {
  const c = code.trim().toUpperCase().slice(0, 8)
  if (c) await AsyncStorage.setItem(PENDING_JOIN_KEY, c).catch(() => {})
}

export async function takePendingJoinCode(): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(PENDING_JOIN_KEY)
    if (v) await AsyncStorage.removeItem(PENDING_JOIN_KEY)
    return v
  } catch {
    return null
  }
}
