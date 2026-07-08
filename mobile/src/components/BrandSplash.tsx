// Branded loading screen shown while the session resolves on launch. Mirrors the
// Login hero (the "One Roof" wordmark + tagline) so opening the app flows
// straight from the native splash into a warm, on-brand screen instead of a bare
// spinner. Its background is `c.bg` — the same paper/espresso the native splash
// uses — so the handoff has no color flash.
import { ActivityIndicator, View } from 'react-native'

import { Txt } from './ui'
import { useI18n } from '../hooks/useI18n'
import { sp, useTheme } from '../theme/theme'

export default function BrandSplash() {
  const { c } = useTheme()
  const { t } = useI18n()
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: c.bg,
        alignItems: 'center',
        justifyContent: 'center',
        gap: sp.xl,
      }}
    >
      <View style={{ alignItems: 'center', gap: 6 }}>
        <Txt variant="display" style={{ fontSize: 40 }}>
          One Roof
        </Txt>
        <Txt variant="muted">{t('login.tagline')}</Txt>
      </View>
      <ActivityIndicator color={c.accent} />
    </View>
  )
}
