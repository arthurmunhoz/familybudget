// Google sign-in with the SYSTEM's own account sheet instead of a web page
// (owner, 2026-11-16: the in-app browser showed the Supabase project's
// technical address, "murtukhmajyvovwputrx.supabase.co", which nobody trusts).
//
// The native SDK hands back an ID token; Supabase accepts it directly
// (`signInWithIdToken`), so no browser and no redirect are involved. For the
// calendar it hands back a one-time SERVER AUTH CODE, which
// api/google-calendar-connect exchanges for the refresh token (the client
// never sees it).
//
// Everything here is guarded: a binary without the native module, or a
// platform whose client id isn't configured yet, reports `available() ===
// false` and the callers keep the old web flow. Client ids are public
// identifiers, not secrets — they ship in every app that uses Google.
//
// Console set-up this needs (Google Cloud project 528369183381, the one that
// owns the web client Supabase uses):
//   · iOS OAuth client for bundle com.oneroof.app → GOOGLE_IOS_CLIENT_ID below
//     AND `GOOGLE_IOS_CLIENT_ID` in app.config.js (its reversed form is the
//     URL scheme the SDK returns through).
//   · Android OAuth clients for package one.roof.family.organizer, one per
//     signing certificate SHA-1 (Play app signing AND the EAS upload/preview
//     keystore). Android needs no id in code: it signs with the web client.
//   · Supabase › Auth › Providers › Google: add the iOS client id to "Client
//     IDs" and turn on "Skip nonce checks" (the iOS SDK adds a nonce the app
//     can't read).
import { Platform } from 'react-native'

import { supabase } from './supabase'

export const GOOGLE_WEB_CLIENT_ID = '528369183381-9iaforlv3sjg909t9q5ji9ar10s86bfv.apps.googleusercontent.com'
/** Empty until the iOS OAuth client exists — then iOS switches to native. */
export const GOOGLE_IOS_CLIENT_ID = '528369183381-mji8rj24o4lavrksftdgntrmoakubej6.apps.googleusercontent.com'
/** false until the Android OAuth clients exist for BOTH signing certificates
 *  (Play app signing + the EAS keystore, SHA-1 20:D5:D4:41:09:59:EB:31:0D:8F:
 *  73:38:63:42:09:88:D1:40:3C:92). Without them Google shows the account
 *  chooser and THEN fails (DEVELOPER_ERROR), so the person would be asked twice. */
export const GOOGLE_ANDROID_READY = true

type Lib = typeof import('@react-native-google-signin/google-signin')
let lib: Lib | null | undefined
function load(): Lib | null {
  if (lib !== undefined) return lib
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- absent from older binaries
    lib = require('@react-native-google-signin/google-signin') as Lib
  } catch {
    lib = null
  }
  return lib
}

/** The native sheet can be used on this binary and platform. */
export function nativeGoogleAvailable(): boolean {
  if (Platform.OS === 'ios' && !GOOGLE_IOS_CLIENT_ID) return false
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return false
  if (Platform.OS === 'android' && !GOOGLE_ANDROID_READY) return false
  return load() !== null
}

export class NativeGoogleUnavailable extends Error {}

async function pick(scopes?: string[]) {
  const g = load()
  if (!g) throw new NativeGoogleUnavailable('module')
  g.GoogleSignin.configure({
    webClientId: GOOGLE_WEB_CLIENT_ID,
    ...(Platform.OS === 'ios' ? { iosClientId: GOOGLE_IOS_CLIENT_ID } : {}),
    ...(scopes ? { scopes, offlineAccess: true, forceCodeForRefreshToken: true } : {}),
  })
  try {
    if (Platform.OS === 'android') await g.GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true })
    // With scopes we always want the account chooser and a fresh code.
    if (scopes) await g.GoogleSignin.signOut().catch(() => {})
    const res = await g.GoogleSignin.signIn()
    if (res.type !== 'success') return null
    return res.data
  } catch (e) {
    const code = (e as { code?: string })?.code
    if (code === g.statusCodes.SIGN_IN_CANCELLED || code === g.statusCodes.IN_PROGRESS) return null
    // A set-up problem (no Android client for this signing key = DEVELOPER_ERROR,
    // no Play Services): let the caller fall back to the web flow.
    throw new NativeGoogleUnavailable(code ?? 'unknown')
  }
}

/** Sign in to One Roof. Resolves false when the person closed the sheet. */
export async function nativeGoogleSignIn(): Promise<boolean> {
  const data = await pick()
  if (!data) return false
  if (!data.idToken) throw new NativeGoogleUnavailable('no-id-token')
  const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: data.idToken })
  if (error) throw error
  return true
}

/** Ask for the calendar scope. Returns the one-time code the SERVER exchanges
 *  (and the Google account's email), or null when the person closed the sheet. */
export async function nativeGoogleCalendarCode(scope: string): Promise<{ code: string; email: string } | null> {
  const data = await pick([scope])
  if (!data) return null
  if (!data.serverAuthCode) throw new NativeGoogleUnavailable('no-server-code')
  return { code: data.serverAuthCode, email: data.user.email }
}

/** Forget the Google account on this device (sign-out). Best effort. */
export async function nativeGoogleSignOut(): Promise<void> {
  const g = load()
  if (!g) return
  await g.GoogleSignin.signOut().catch(() => {})
}
