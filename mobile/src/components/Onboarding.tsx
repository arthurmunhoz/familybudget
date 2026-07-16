// First-login screen for a signed-in user with no household yet (index.tsx shows
// it when `profileLoaded && !profile`). Two steps: say what you'd like to be
// called, then create a household (become its owner) or join one with a code. On
// success we refreshProfile() so index.tsx re-renders straight into the Hub.
// Backed by the SECURITY DEFINER RPCs create_household / join_household
// (migration 051) + set_display_name (057).
//
// The name step exists because create_household/join_household stamp
// display_name from jwt_display_name(), which falls back to the email's
// local-part when the JWT has no name claim — and Apple NEVER puts a name in the
// token, so "Hide My Email" users were landing in their family's app called
// things like "z5khzgh5ff". We can only apply the name AFTER create/join, since
// that's what creates the allowed_users row to update.
import { useEffect, useState } from 'react'
import { Alert, View } from 'react-native'

import { Btn, Card, Field, Screen, Txt } from './ui'
import { takePendingDisplayName, useAuth } from '../lib/auth'
import { useI18n } from '../hooks/useI18n'
import { supabase } from '../lib/supabase'
import { sp } from '../theme/theme'

export default function Onboarding() {
  const { t } = useI18n()
  const { refreshProfile, signOut } = useAuth()
  const [step, setStep] = useState<'name' | 'household'>('name')
  const [myName, setMyName] = useState('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<'create' | 'join' | null>(null)

  // Apple gives us the real name exactly once, at sign-in — use it as the
  // default. Don't clobber anything already typed if this resolves late.
  useEffect(() => {
    void takePendingDisplayName().then((n) => {
      if (n) setMyName((cur) => cur || n)
    })
  }, [])

  function toHousehold() {
    if (!myName.trim()) {
      Alert.alert(t('onboarding.errYourNameRequired'))
      return
    }
    setStep('household')
  }

  /** Apply the chosen name once the allowed_users row exists. Best-effort: they
   *  are already in the household by now, so a failure here must not trap them
   *  on this screen — it's fixable in Family → Edit my info. */
  async function applyName() {
    const n = myName.trim()
    if (!n) return
    await supabase.rpc('set_display_name', { p_name: n })
  }

  // Map the RPC's raised messages (see migration 051) to friendly, localized text.
  function mapError(msg: string): string {
    const m = msg.toLowerCase()
    if (m.includes('already in a household')) return t('onboarding.errAlready')
    if (m.includes('invalid code')) return t('onboarding.errInvalidCode')
    if (m.includes('too many')) return t('onboarding.errTooMany')
    if (m.includes('household name required')) return t('onboarding.errNameRequired')
    return t('onboarding.errGeneric')
  }

  async function create() {
    const n = name.trim()
    if (!n) {
      Alert.alert(t('onboarding.errNameRequired'))
      return
    }
    if (busy) return
    setBusy('create')
    const { error } = await supabase.rpc('create_household', { p_name: n })
    if (error) {
      setBusy(null)
      Alert.alert(mapError(error.message))
      return
    }
    await applyName()
    setBusy(null)
    await refreshProfile()
  }

  async function join() {
    const cd = code.trim()
    if (!cd) {
      Alert.alert(t('onboarding.errCodeRequired'))
      return
    }
    if (busy) return
    setBusy('join')
    const { error } = await supabase.rpc('join_household', { p_code: cd })
    if (error) {
      setBusy(null)
      Alert.alert(mapError(error.message))
      return
    }
    await applyName()
    setBusy(null)
    await refreshProfile()
  }

  return (
    <Screen scroll>
      <View style={{ gap: sp.lg, paddingVertical: sp.xl }}>
        <View style={{ alignItems: 'center', gap: 6 }}>
          <Txt variant="display" style={{ fontSize: 34 }}>
            One Roof
          </Txt>
          <Txt variant="muted" style={{ textAlign: 'center' }}>
            {t('onboarding.subtitle')}
          </Txt>
        </View>

        {step === 'name' ? (
          <>
            <Card style={{ gap: sp.md }}>
              <View style={{ gap: 2 }}>
                <Txt variant="h2">{t('onboarding.nameTitle')}</Txt>
                <Txt variant="faint">{t('onboarding.nameDesc')}</Txt>
              </View>
              <Field
                value={myName}
                onChangeText={setMyName}
                placeholder={t('onboarding.yourNamePlaceholder')}
                autoCapitalize="words"
                autoCorrect={false}
                maxLength={40}
                returnKeyType="done"
                onSubmitEditing={toHousehold}
              />
              <Btn
                title={t('onboarding.continue')}
                onPress={toHousehold}
                disabled={!myName.trim()}
              />
            </Card>
            <Btn title={t('settings.signOut')} onPress={signOut} variant="ghost" />
          </>
        ) : (
          <>
            <View style={{ alignItems: 'center' }}>
              <Txt variant="faint">{t('onboarding.appearAs', { name: myName.trim() })}</Txt>
              <Btn
                title={t('onboarding.changeName')}
                onPress={() => setStep('name')}
                variant="ghost"
              />
            </View>

            <Card style={{ gap: sp.md }}>
              <View style={{ gap: 2 }}>
                <Txt variant="h2">{t('onboarding.createTitle')}</Txt>
                <Txt variant="faint">{t('onboarding.createDesc')}</Txt>
              </View>
              <Field
                value={name}
                onChangeText={setName}
                placeholder={t('onboarding.namePlaceholder')}
                autoCapitalize="words"
                maxLength={40}
                returnKeyType="done"
                onSubmitEditing={create}
              />
              <Btn
                title={t('onboarding.createBtn')}
                onPress={create}
                loading={busy === 'create'}
                disabled={busy !== null}
              />
            </Card>

            <Card style={{ gap: sp.md }}>
              <View style={{ gap: 2 }}>
                <Txt variant="h2">{t('onboarding.joinTitle')}</Txt>
                <Txt variant="faint">{t('onboarding.joinDesc')}</Txt>
              </View>
              <Field
                value={code}
                onChangeText={(v) => setCode(v.toUpperCase())}
                placeholder={t('onboarding.codePlaceholder')}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={8}
                returnKeyType="done"
                onSubmitEditing={join}
                style={{ letterSpacing: 2 }}
              />
              <Btn
                title={t('onboarding.joinBtn')}
                onPress={join}
                variant="secondary"
                loading={busy === 'join'}
                disabled={busy !== null}
              />
            </Card>

            <Btn title={t('settings.signOut')} onPress={signOut} variant="ghost" />
          </>
        )}
      </View>
    </Screen>
  )
}
