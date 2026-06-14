// Device-biometric gate (Face ID / Touch ID / fingerprint) via WebAuthn.
//
// This is a LOCAL privacy lock, not a second server-side auth factor: the
// documents are already protected by the Supabase session + RLS. The WebAuthn
// ceremony just proves the person holding the (already-signed-in) phone is its
// owner before the vault contents are shown. We verify only that the platform
// authenticator completed user verification — there's no server check.

const credKey = (email: string) => `vault-cred:${email}`

function toB64url(buf: ArrayBuffer): string {
  let s = ''
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(s: string): ArrayBuffer {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  const buf = new ArrayBuffer(bin.length)
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return buf
}

function strToBuf(s: string): ArrayBuffer {
  const enc = new TextEncoder().encode(s)
  const buf = new ArrayBuffer(enc.length)
  new Uint8Array(buf).set(enc)
  return buf
}

function challenge(): ArrayBuffer {
  const buf = new ArrayBuffer(32)
  crypto.getRandomValues(new Uint8Array(buf))
  return buf
}

/** True only when the device has a usable face/fingerprint authenticator. */
export async function biometricAvailable(): Promise<boolean> {
  try {
    return (
      typeof window.PublicKeyCredential !== 'undefined' &&
      (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
    )
  } catch {
    return false
  }
}

/** First-time enrollment: creates a platform passkey (one biometric prompt)
 *  and remembers its id on this device. */
async function enroll(email: string): Promise<boolean> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: challenge(),
      rp: { name: 'One Roof', id: location.hostname },
      user: { id: strToBuf(email), name: email, displayName: email },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 }, // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null
  if (!cred) return false
  localStorage.setItem(credKey(email), toB64url(cred.rawId))
  return true
}

/** Prompt for the device biometric. Enrolls on first use. Resolves true only
 *  if the user verification succeeds. Returns false on cancel/failure. */
export async function unlockVault(email: string): Promise<boolean> {
  const stored = localStorage.getItem(credKey(email))
  if (!stored) {
    try {
      return await enroll(email)
    } catch {
      return false
    }
  }
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: challenge(),
        allowCredentials: [{ type: 'public-key', id: fromB64url(stored) }],
        userVerification: 'required',
        timeout: 60_000,
      },
    })
    return Boolean(assertion)
  } catch {
    return false
  }
}

/** Forget this device's vault passkey (e.g. to re-enroll after a reset). */
export function resetVaultCredential(email: string) {
  localStorage.removeItem(credKey(email))
}
