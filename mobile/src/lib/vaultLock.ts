// Opt-in Face ID lock for the Document Vault — the RN port of the PWA's
// biometric.ts flag (the WebAuthn half isn't needed here; expo-local-
// authentication talks to Face ID directly).
//
// This is a LOCAL privacy lock, not a second server-side auth factor: the
// documents are already protected by the Supabase session + RLS. The flag is
// per user AND per device (like the PWA's localStorage flag) and OFF by
// default — the lock is opt-in from the vault screen.
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as LocalAuthentication from 'expo-local-authentication'

const lockKey = (email: string) => `vault-lock:${email}`

/** Whether this user turned on the Face ID lock on THIS device. Off by default. */
export async function isVaultLockEnabled(email: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(lockKey(email))) === '1'
  } catch {
    return false
  }
}

export async function setVaultLockEnabled(email: string, on: boolean): Promise<void> {
  try {
    if (on) await AsyncStorage.setItem(lockKey(email), '1')
    else await AsyncStorage.removeItem(lockKey(email))
  } catch {
    /* storage unavailable — the in-memory toggle still works this session */
  }
}

/** True only when the device has a usable biometric (hardware + enrollment). */
export async function biometricAvailable(): Promise<boolean> {
  try {
    const [hw, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ])
    return hw && enrolled
  } catch {
    return false
  }
}
