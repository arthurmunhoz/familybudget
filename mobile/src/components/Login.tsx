// Pre-auth screen. Sign in with Apple (required by Apple when other social
// logins are offered), Google OAuth, and a DEV-only email/password login.
import { useState } from 'react'
import { Platform, View } from 'react-native'
import * as AppleAuthentication from 'expo-apple-authentication'

import { Btn, Screen, Txt } from './ui'
import { appleAuthSupported, useAuth } from '../lib/auth'
import { useI18n } from '../hooks/useI18n'
import { sp, useTheme } from '../theme/theme'

export default function Login() {
  const { c, dark } = useTheme()
  const { t } = useI18n()
  const { signInWithApple, signInWithGoogle, devSignIn } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Sign-in failed'
      // The user cancelling the Apple sheet isn't an error worth showing.
      if (!/cancel/i.test(msg)) setError(msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center', gap: sp.lg }}>
        <View style={{ alignItems: 'center', gap: 6, marginBottom: sp.lg }}>
          <Txt variant="display" style={{ fontSize: 40 }}>
            One Roof
          </Txt>
          <Txt variant="muted">Your whole home, in one app</Txt>
        </View>

        {appleAuthSupported ? (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={
              dark
                ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
            }
            cornerRadius={12}
            style={{ height: 50 }}
            onPress={() => run(signInWithApple)}
          />
        ) : null}

        <Btn title={t('login.continueGoogle')} variant="secondary" onPress={() => run(signInWithGoogle)} />

        {__DEV__ ? (
          <Btn
            title={t('login.devSignIn')}
            variant="ghost"
            loading={busy}
            onPress={() =>
              run(async () => {
                const { error } = await devSignIn()
                if (error) throw new Error(error)
              })
            }
          />
        ) : null}

        {error ? (
          <Txt variant="muted" style={{ color: c.expense, textAlign: 'center' }}>
            {error}
          </Txt>
        ) : null}
      </View>
    </Screen>
  )
}
