// Prominent disclosure for background location.
//
// Google Play REQUIRES this screen to appear *before* expo-location's background
// permission request (see mobile/PLAY-STORE-RELEASE.md §3.1) — a distinct in-app
// screen that names the app, states that location is collected in the background
// even when the app is closed, and says what it is used for. Neither the OS
// prompt nor the privacy policy satisfies that requirement; reviewers check for
// this screen specifically and it's the highest rejection risk for the Android
// launch. It's also what the Play demo video has to show first.
//
// Rules if you touch this:
//   • It is rendered by SharingControls, which gates BOTH paths into
//     ensureBackgroundPermission() (turn on, and resume from a pause). Any new
//     caller of that helper must go through this screen too.
//   • "Continue" must lead to the permission request, never to sharing being
//     turned on by itself — accepting a disclosure is not a grant.
//   • The copy is load-bearing compliance text; reword it in en/es/pt together
//     and keep the "even when the app is closed or not in use" clause.
//
// Shown on iOS as well as Android: one code path, and a plain-language
// explainer ahead of the Always-authorization prompt reads well there too.
import { Modal, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MapPin, Moon, PauseCircle, Users, type LucideIcon } from 'lucide-react-native'

import { Btn, Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { fonts, radius, sp, useTheme } from '@/theme/theme'

function Point({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  const { c } = useTheme()
  return (
    <View style={{ flexDirection: 'row', gap: sp.md }}>
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: radius.pill,
          backgroundColor: c.accentSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon size={18} color={c.accent} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt style={{ fontFamily: fonts.semibold, fontSize: 15, color: c.text }}>{title}</Txt>
        <Txt variant="muted" style={{ lineHeight: 20 }}>
          {body}
        </Txt>
      </View>
    </View>
  )
}

export function LocationDisclosure({
  onAccept,
  onDecline,
}: {
  /** Proceed to the OS permission request. */
  onAccept: () => void
  /** Back out — sharing stays off and no permission is requested. */
  onDecline: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const insets = useSafeAreaInsets()

  return (
    <Modal visible animationType="slide" onRequestClose={onDecline}>
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <ScrollView
          contentContainerStyle={{
            padding: sp.lg,
            paddingTop: insets.top + sp.xl,
            gap: sp.lg,
          }}
        >
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: radius.pill,
              backgroundColor: c.accentSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <MapPin size={26} color={c.accent} />
          </View>

          <View style={{ gap: sp.sm }}>
            <Txt variant="title">{t('location.disclosure.title')}</Txt>
            <Txt variant="muted" style={{ lineHeight: 21 }}>
              {t('location.disclosure.intro')}
            </Txt>
          </View>

          <View
            style={{
              backgroundColor: c.card,
              borderRadius: radius.lg,
              padding: sp.lg,
              gap: sp.lg,
            }}
          >
            <Point
              icon={Moon}
              title={t('location.disclosure.bgTitle')}
              body={t('location.disclosure.bgBody')}
            />
            <Point
              icon={Users}
              title={t('location.disclosure.whoTitle')}
              body={t('location.disclosure.whoBody')}
            />
            <Point
              icon={PauseCircle}
              title={t('location.disclosure.controlTitle')}
              body={t('location.disclosure.controlBody')}
            />
          </View>
        </ScrollView>

        <View
          style={{
            padding: sp.lg,
            paddingBottom: insets.bottom + sp.lg,
            gap: sp.md,
            borderTopWidth: 1,
            borderTopColor: c.border,
            backgroundColor: c.bg,
          }}
        >
          <Txt variant="faint" style={{ textAlign: 'center' }}>
            {t('location.disclosure.next')}
          </Txt>
          <Btn title={t('location.disclosure.accept')} onPress={onAccept} />
          <Btn title={t('location.disclosure.decline')} variant="ghost" onPress={onDecline} />
        </View>
      </View>
    </Modal>
  )
}
