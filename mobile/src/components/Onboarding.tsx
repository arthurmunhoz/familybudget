// First-login screen for a signed-in user with no household yet (index.tsx shows
// it when `profileLoaded && !profile`). Two paths: create a household (become its
// owner) or join one with a code. On success we refreshProfile() so index.tsx
// re-renders straight into the Hub. Backed by the SECURITY DEFINER RPCs
// create_household / join_household (migration 051).
import { useState } from 'react'
import { Alert, View } from 'react-native'

import { Btn, Card, Field, Screen, Txt } from './ui'
import { useAuth } from '../lib/auth'
import { useI18n } from '../hooks/useI18n'
import { supabase } from '../lib/supabase'
import { sp } from '../theme/theme'

export default function Onboarding() {
  const { t } = useI18n()
  const { refreshProfile, signOut } = useAuth()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<'create' | 'join' | null>(null)

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
    setBusy(null)
    if (error) {
      Alert.alert(mapError(error.message))
      return
    }
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
    setBusy(null)
    if (error) {
      Alert.alert(mapError(error.message))
      return
    }
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
      </View>
    </Screen>
  )
}
