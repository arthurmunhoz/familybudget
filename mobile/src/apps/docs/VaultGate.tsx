// Face ID privacy gate for the Document Vault (RN port of the PWA's VaultGate).
//
// On entry it checks for a platform biometric (Face ID / Touch ID). When the
// device has hardware AND an enrollment, it shows a locked screen with an
// "Unlock" button — iOS needs a user gesture to present Face ID, so we can't
// silently authenticate on mount and rely on it; we DO try once automatically,
// but the button is the reliable path. On success the vault children render.
// Devices without biometric hardware/enrollment pass straight through (the
// account login still protects the data).
//
// Re-locks whenever the screen loses focus (useFocusEffect cleanup), so leaving
// and returning requires a fresh face/fingerprint check.
import { useCallback, useRef, useState, type ReactNode } from 'react'
import { View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import * as LocalAuthentication from 'expo-local-authentication'
import { Lock } from 'lucide-react-native'

import { AppHeader, Btn, Screen, Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { sp, useTheme } from '@/theme/theme'

type Status = 'checking' | 'locked' | 'unlocked'

export default function VaultGate({ children }: { children: ReactNode }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const [status, setStatus] = useState<Status>('checking')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  // Guards the auto-attempt so it only fires once per focus.
  const autoTried = useRef(false)

  const authenticate = useCallback(async () => {
    setBusy(true)
    setFailed(false)
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: t('vault.unlock'),
        cancelLabel: t('common.cancel'),
        disableDeviceFallback: false,
      })
      if (result.success) {
        setStatus('unlocked')
      } else {
        setFailed(true)
      }
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }, [t])

  // Run on every focus; cleanup re-locks when the screen is left.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      autoTried.current = false
      ;(async () => {
        const [hasHardware, isEnrolled] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
        ])
        if (cancelled) return
        if (!hasHardware || !isEnrolled) {
          setStatus('unlocked') // no biometric → pass through
          return
        }
        setStatus('locked')
        // Try once automatically; iOS still requires the button if this is
        // rejected for lack of user activation.
        if (!autoTried.current) {
          autoTried.current = true
          void authenticate()
        }
      })()
      return () => {
        cancelled = true
        // Re-lock on leaving so re-entry demands a fresh check.
        setStatus('checking')
        setFailed(false)
      }
    }, [authenticate]),
  )

  if (status === 'unlocked') return <>{children}</>

  return (
    <Screen>
      <AppHeader title={t('docs.title')} />
      {status === 'checking' ? (
        <View style={{ flex: 1 }} />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: sp.md, paddingBottom: sp.xxl }}>
          <View
            style={{
              height: 72,
              width: 72,
              borderRadius: 36,
              backgroundColor: c.surface,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Lock size={36} color={c.accent} />
          </View>
          <Txt variant="muted" style={{ textAlign: 'center', maxWidth: 260 }}>
            {t('vault.locked')}
          </Txt>
          {failed ? (
            <Txt variant="body" style={{ color: c.expense, fontWeight: '600' }}>
              {t('vault.failed')}
            </Txt>
          ) : null}
          <Btn
            title={busy ? t('vault.unlocking') : t('vault.unlock')}
            onPress={authenticate}
            loading={busy}
            style={{ marginTop: sp.md, paddingHorizontal: sp.xxl }}
          />
        </View>
      )}
    </Screen>
  )
}
