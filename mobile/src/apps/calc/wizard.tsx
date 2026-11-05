// The step-by-step frame shared by the Utilities wizards (split evenly, split
// by item). One question per screen instead of one big form: a progress bar,
// a big question, the answer control, and ONE primary button docked at the
// bottom that rides above the keyboard.
//
// Why the docked button matters here: the amount steps use a decimal pad,
// which has no return key, and this app deliberately has no "Done" bar (see
// mobile/CLAUDE.md, "Dismissing the keyboard"). With the KeyboardAvoidingView
// around body + footer, "Continue" sits right on top of the pad, so the way
// forward is always one tap away and you never have to dismiss anything.
//
// Navigation: the header back arrow (and Android's back button) steps BACK
// through the wizard, and only leaves it from the first step. The iOS
// swipe-back gesture is turned off past the first step — a stray edge swipe
// would otherwise drop everything you'd entered (on the by-item split, that's
// a metered photo scan).
import { useEffect, type ReactNode } from 'react'
import { BackHandler, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Stack } from 'expo-router'
import Animated, { FadeInLeft, FadeInRight } from 'react-native-reanimated'

import { AppHeader, Btn, DismissKeyboard, Txt } from '@/components/ui'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useI18n } from '@/hooks/useI18n'
import { radius, sp, useTheme } from '@/theme/theme'

export interface WizardAction {
  label: string
  onPress: () => void
  disabled?: boolean
  loading?: boolean
}

export function WizardScreen({
  title,
  steps,
  index,
  onBack,
  direction = 1,
  children,
  primary,
  secondary,
  hideProgress,
  swipeBack,
}: {
  title: string
  /** Total number of steps shown in the progress bar. */
  steps: number
  /** 0-based position of the current step. */
  index: number
  onBack: () => void
  /** +1 when the user moved forward, −1 when back — picks the slide direction. */
  direction?: 1 | -1
  children: ReactNode
  primary?: WizardAction
  secondary?: WizardAction
  hideProgress?: boolean
  /** Allow the iOS edge swipe to leave the wizard. Defaults to the first step
   *  only; result screens (whose back arrow exits) turn it on too. */
  swipeBack?: boolean
}) {
  const { c } = useTheme()
  const bottom = useBottomGap(sp.md)

  // Android's back button walks the wizard like the header arrow does.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack()
      return true
    })
    return () => sub.remove()
  }, [onBack])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      <Stack.Screen options={{ gestureEnabled: swipeBack ?? index === 0 }} />
      <DismissKeyboard style={{ paddingHorizontal: sp.lg }}>
        <AppHeader title={title} onBack={onBack} />
        {hideProgress ? null : <Progress steps={steps} index={index} />}
      </DismissKeyboard>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: sp.xl, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
        >
          <Animated.View
            key={index}
            entering={(direction === 1 ? FadeInRight : FadeInLeft).duration(220)}
            style={{ flexGrow: 1 }}
          >
            {children}
          </Animated.View>
        </ScrollView>
        {primary || secondary ? (
          <View style={[styles.footer, { paddingBottom: bottom }]}>
            {primary ? (
              <Btn
                title={primary.label}
                onPress={primary.onPress}
                disabled={primary.disabled}
                loading={primary.loading}
              />
            ) : null}
            {secondary ? (
              <Btn
                title={secondary.label}
                onPress={secondary.onPress}
                disabled={secondary.disabled}
                variant="ghost"
              />
            ) : null}
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function Progress({ steps, index }: { steps: number; index: number }) {
  const { c } = useTheme()
  return (
    <View style={styles.progress} accessibilityRole="progressbar">
      {Array.from({ length: steps }, (_, i) => (
        <View
          key={i}
          style={[styles.progressSeg, { backgroundColor: i <= index ? c.action : c.surface2 }]}
        />
      ))}
    </View>
  )
}

/** "STEP 2 OF 4" + the question + an optional hint under it. */
export function StepTitle({
  step,
  steps,
  title,
  hint,
}: {
  step?: number
  steps?: number
  title: string
  hint?: string
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  return (
    <View style={{ marginTop: sp.lg, marginBottom: sp.xl, gap: 6 }}>
      {step != null && steps != null ? (
        <Txt variant="label" style={{ color: c.textFaint, textTransform: 'uppercase', letterSpacing: 0.6 }}>
          {t('calc.stepOf', { step, total: steps })}
        </Txt>
      ) : null}
      <Txt variant="display">{title}</Txt>
      {hint ? <Txt variant="muted">{hint}</Txt> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  progress: { flexDirection: 'row', gap: 6, marginTop: sp.xs },
  progressSeg: { flex: 1, height: 4, borderRadius: radius.pill },
  footer: { paddingHorizontal: sp.lg, paddingTop: sp.sm, gap: sp.xs },
})
