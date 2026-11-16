// Pre-auth screen. Sign in with Apple (required by Apple when other social
// logins are offered), Google OAuth, and a DEV-only email/password login.
// 2026-11-15 restyle: the Home's language (icon, big display name, faded
// tagline, the apps' gradient tiles) with the sign-in buttons docked low.
import { useState } from 'react'
import { Image, Pressable, StyleSheet, View } from 'react-native'
import * as AppleAuthentication from 'expo-apple-authentication'

import { Bell, CalendarDays, ListChecks, PawPrint, Wallet } from 'lucide-react-native'

import { Btn, Screen, Txt } from './ui'
import { GradientBox } from './home/GradientBox'
import { APP_GRADIENT } from './home/palette'
import { appleAuthSupported, useAuth } from '../lib/auth'
import { useI18n } from '../hooks/useI18n'
import { fonts, sp, useTheme } from '../theme/theme'

// eslint-disable-next-line @typescript-eslint/no-require-imports -- a bundled image
const ICON = require('../../assets/images/icon.png')
const TILES = [
  { id: 'calendar', Icon: CalendarDays },
  { id: 'shopping', Icon: ListChecks },
  { id: 'pings', Icon: Bell },
  { id: 'pets', Icon: PawPrint },
  { id: 'budget', Icon: Wallet },
] as const

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
      <View style={{ flex: 1, paddingBottom: sp.xl }}>
        {/* Who we are: the app icon, the name large, the tagline faded under
            it — the Home's type — and the apps' own gradient tiles. */}
        <View style={{ flex: 1, justifyContent: 'center', gap: sp.lg }}>
          <Image source={ICON} style={styles.icon} accessibilityIgnoresInvertColors />
          <View>
            <Txt style={{ fontFamily: fonts.display, fontSize: 44, lineHeight: 50, letterSpacing: -1, color: c.text }}>One Roof</Txt>
            <Txt style={{ fontFamily: fonts.display, fontSize: 22, lineHeight: 28, color: c.textFaint }}>{t('login.tagline')}</Txt>
          </View>
          <View style={{ gap: sp.sm }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {TILES.map(({ id, Icon }) => (
                <GradientBox key={id} colors={APP_GRADIENT[id]} radius={15} style={styles.tile}>
                  <Icon size={22} color="#fff" strokeWidth={2} />
                </GradientBox>
              ))}
            </View>
            <Txt variant="muted" style={{ fontSize: 15, lineHeight: 21 }}>
              {t('login.what')}
            </Txt>
          </View>
        </View>

        <View style={{ gap: sp.md }}>
          {appleAuthSupported ? (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
              buttonStyle={
                dark
                  ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                  : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
              }
              cornerRadius={27}
              style={{ height: 54 }}
              onPress={() => run(signInWithApple)}
            />
          ) : null}

          <Pressable
            onPress={() => run(signInWithGoogle)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.google, { backgroundColor: c.sheet, borderColor: c.border, opacity: pressed ? 0.75 : 1 }]}
          >
            <Txt style={{ fontFamily: fonts.display, fontSize: 18, color: '#4285F4' }}>G</Txt>
            <Txt style={{ fontFamily: fonts.semibold, fontSize: 16.5, color: c.text }}>{t('login.continueGoogle')}</Txt>
          </Pressable>

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
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  icon: { width: 88, height: 88, borderRadius: 22 },
  tile: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  google: { height: 54, borderRadius: 27, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
})
