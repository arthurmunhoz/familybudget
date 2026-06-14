import { useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useBack } from '../hooks/useBack'
import { useI18n } from '../hooks/useI18n'
import { biometricAvailable, isVaultLockEnabled, unlockVault } from '../lib/biometric'

type Status = 'checking' | 'locked' | 'unlocked'

/**
 * Biometric privacy gate for the Document Vault. Re-mounts on every navigation
 * into the route, so the vault locks the moment you leave and requires a fresh
 * face/fingerprint check to reopen. On devices without a platform authenticator
 * it passes straight through (the account login still protects the data).
 */
export default function VaultGate({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const { t } = useI18n()
  const back = useBack()
  const [status, setStatus] = useState<Status>('checking')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    // Only lock when the user has opted in on this device AND it can do
    // biometrics; otherwise open straight through.
    if (!profile || !isVaultLockEnabled(profile.email)) {
      setStatus('unlocked')
      return
    }
    let cancelled = false
    biometricAvailable().then((ok) => {
      if (!cancelled) setStatus(ok ? 'locked' : 'unlocked')
    })
    return () => {
      cancelled = true
    }
  }, [profile])

  // WebAuthn needs a user gesture, so unlocking is driven by the button tap.
  async function tryUnlock() {
    if (!profile || busy) return
    setBusy(true)
    setFailed(false)
    const ok = await unlockVault(profile.email)
    setBusy(false)
    if (ok) setStatus('unlocked')
    else setFailed(true)
  }

  if (status === 'unlocked') return <>{children}</>

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4">
      <header className="flex items-center gap-2 pt-6 pb-4">
        <button
          onClick={() => back('/')}
          className="rounded-lg px-2 py-1 text-xl text-(--text-muted) active:text-(--text)"
        >
          ‹
        </button>
        <h1 className="flex-1 text-2xl font-bold text-(--text)">📄 {t('docs.title')}</h1>
      </header>

      {status === 'checking' ? (
        <p className="mt-16 text-center text-(--text-faint) animate-pulse">
          {t('common.loading')}
        </p>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center pb-24 text-center">
          <div className="text-6xl">🔒</div>
          <p className="mt-5 max-w-xs text-(--text-muted)">{t('vault.locked')}</p>
          {failed && (
            <p className="mt-3 text-sm font-medium text-(--expense)">{t('vault.failed')}</p>
          )}
          <button
            onClick={tryUnlock}
            disabled={busy}
            className="mt-7 rounded-2xl bg-(--accent) px-8 py-4 text-lg font-bold text-white shadow-lg active:scale-[0.98] transition-transform disabled:opacity-60"
          >
            {busy ? t('vault.unlocking') : t('vault.unlock')}
          </button>
        </div>
      )}
    </div>
  )
}
