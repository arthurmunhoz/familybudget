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
import { useEffect, type ReactNode, type RefObject } from 'react'
import { ActivityIndicator, BackHandler, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Stack, router } from 'expo-router'
import Animated, {
  Easing,
  FadeInLeft,
  FadeInRight,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'

import { ChevronLeft } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { TintButton } from '@/components/TintButton'
import { GradientBox } from '@/components/home/GradientBox'
import { DismissKeyboard, Txt } from '@/components/ui'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useI18n } from '@/hooks/useI18n'
import { fonts, radius, sp, useTheme } from '@/theme/theme'

import { TOOL_LOOK, ToolLookContext, useToolLook } from './look'
import { ToolArt, type ToolArtKind } from './ToolArt'

export interface WizardAction {
  label: string
  onPress: () => void
  disabled?: boolean
  loading?: boolean
  /** Leading icon on the primary (white). */
  icon?: ReactNode
}

const EASE = Easing.bezier(0.2, 0, 0, 1)

export function WizardScreen({
  kind,
  steps,
  index,
  onBack,
  direction = 1,
  children,
  primary,
  secondary,
  hideProgress,
  swipeBack,
  sideBySide = false,
  scrollRef,
  onScroll,
}: {
  /** Which tool — its colour runs through the whole flow (look.ts). */
  kind: ToolArtKind
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
  /** Primary and secondary as two equal buttons in one row (the luggage tag's
   *  Print / Save — owner, 2026-11), a little shorter than the docked one. */
  sideBySide?: boolean
  /** The page's scroller, for a screen that scrolls itself (the luggage tag's
   *  "Edit details ↓"). */
  scrollRef?: RefObject<ScrollView | null>
  onScroll?: (y: number) => void
  /** Allow the iOS edge swipe to leave the wizard. Defaults to the first step
   *  only; result screens (whose back arrow exits) turn it on too. */
  swipeBack?: boolean
}) {
  const { c, dark } = useTheme()
  const look = TOOL_LOOK[kind]
  // Half the home-indicator inset, like NewItemButton: the docked button's
  // curved bottom corners then sit on the display's own curve.
  const bottom = useBottomGap(sp.xs)

  // Android's back button walks the wizard like the header arrow does.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack()
      return true
    })
    return () => sub.remove()
  }, [onBack])

  return (
    <ToolLookContext.Provider value={{ kind, look }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
        <Stack.Screen options={{ gestureEnabled: swipeBack ?? index === 0 }} />
        <DismissKeyboard style={styles.column}>
          {/* The frame's top bar: round back, no title (the page's display
              title says it) — here the progress rides in the same row and the
              tool's little art closes it, so you always know where you are. */}
          <ToolTopBar
            title=""
            onBack={onBack}
            center={hideProgress ? null : <Progress steps={steps} index={index} />}
            right={hideProgress ? null : <ToolArt kind={kind} colors={look.colors} dark={dark} size={30} />}
          />
        </DismissKeyboard>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            contentContainerStyle={[styles.column, { paddingBottom: sp.xl, flexGrow: 1 }]}
            keyboardShouldPersistTaps="handled"
            onScroll={onScroll ? (e) => onScroll(e.nativeEvent.contentOffset.y) : undefined}
            scrollEventThrottle={onScroll ? 32 : undefined}
          >
            <Animated.View
              key={index}
              entering={(direction === 1 ? FadeInRight : FadeInLeft).duration(300).easing(EASE)}
              style={{ flexGrow: 1 }}
            >
              {children}
            </Animated.View>
          </ScrollView>
          {sideBySide && primary && secondary ? (
            <View style={[styles.column, styles.footer, styles.pairRow, { paddingBottom: bottom }]}>
              <Pressable
                accessibilityRole="button"
                onPress={primary.onPress}
                disabled={primary.disabled || primary.loading}
                style={({ pressed }) => [{ flex: 1, opacity: primary.disabled ? 0.45 : pressed ? 0.85 : 1 }]}
              >
                <GradientBox colors={look.colors} radius={radius.pill} style={styles.pairBtn}>
                  {primary.loading ? <ActivityIndicator color="#fff" /> : primary.icon}
                  <Txt numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 15.5, color: '#fff' }}>
                    {primary.label}
                  </Txt>
                </GradientBox>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={secondary.onPress}
                disabled={secondary.disabled}
                style={({ pressed }) => [
                  styles.pairBtn,
                  { flex: 1, borderRadius: radius.pill, borderWidth: 1.5, borderColor: look.tint, opacity: secondary.disabled ? 0.45 : pressed ? 0.6 : 1 },
                ]}
              >
                {secondary.icon}
                <Txt numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 15.5, color: look.tint }}>
                  {secondary.label}
                </Txt>
              </Pressable>
            </View>
          ) : primary || secondary ? (
            <View style={[styles.column, styles.footer, { paddingBottom: bottom }]}>
              {/* secondary above: the primary follows the screen's curve at the bottom */}
              {secondary ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={secondary.onPress}
                  disabled={secondary.disabled}
                  style={({ pressed }) => [styles.secondary, { opacity: secondary.disabled ? 0.45 : pressed ? 0.6 : 1 }]}
                >
                  {secondary.icon}
                  <Txt style={{ fontFamily: fonts.semibold, fontSize: 15, color: look.tint }}>{secondary.label}</Txt>
                </Pressable>
              ) : null}
              {primary ? (
                <TintButton
                  tint={look.tint}
                  colors={look.colors}
                  title={primary.label}
                  icon={primary.loading ? <ActivityIndicator color="#fff" /> : primary.icon}
                  onPress={primary.onPress}
                  disabled={primary.disabled || primary.loading}
                />
              ) : null}
            </View>
          ) : null}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ToolLookContext.Provider>
  )
}

/** The Utilities tools' top bar, in the Home's style: a round back button,
 *  then an optional title / middle piece and something on the right. */
export function ToolTopBar({
  title,
  onBack,
  center,
  right,
}: {
  title: string
  onBack?: () => void
  center?: ReactNode
  right?: ReactNode
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const back = onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/calc')))
  return (
    <View style={styles.topBar}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.back')}
        onPress={back}
        hitSlop={8}
        style={[styles.round, { backgroundColor: c.card, borderColor: c.border }]}
      >
        <ChevronLeft size={22} color={c.text} />
      </Pressable>
      {center ?? (
        <Txt style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 16 }} numberOfLines={1}>
          {title}
        </Txt>
      )}
      {right}
    </View>
  )
}

/** Segments that fill in the tool's colour, sliding in from the left. */
function Progress({ steps, index }: { steps: number; index: number }) {
  return (
    <View style={styles.progress} accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: steps, now: index + 1 }}>
      {Array.from({ length: steps }, (_, i) => (
        <Segment key={i} on={i <= index} />
      ))}
    </View>
  )
}

function Segment({ on }: { on: boolean }) {
  const { c } = useTheme()
  const { look } = useToolLook()
  const reduce = useReducedMotion()
  const fill = useSharedValue(on ? 1 : 0)
  useEffect(() => {
    fill.set(reduce ? (on ? 1 : 0) : withTiming(on ? 1 : 0, { duration: 420, easing: EASE }))
  }, [on, reduce, fill])
  const style = useAnimatedStyle(() => ({ transform: [{ scaleX: fill.get() }] }))
  return (
    <View style={[styles.progressSeg, { backgroundColor: c.surface2 }]}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: look.tint, transformOrigin: 'left' }, style]} />
    </View>
  )
}

/** "STEP 2 OF 4" in the tool's colour, the question large, and the hint in
 *  the faded display type under it (the frame's title / subtitle pair). */
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
  const { look } = useToolLook()
  return (
    <View style={{ marginTop: sp.md, marginBottom: sp.xl, gap: 4 }}>
      {step != null && steps != null ? (
        <Txt style={[styles.kicker, { color: look.tint }]}>{t('calc.stepOf', { step, total: steps })}</Txt>
      ) : null}
      <Txt style={styles.question}>{title}</Txt>
      {hint ? <Txt style={[styles.hint, { color: c.textFaint }]}>{hint}</Txt> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  column: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: sp.lg },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.sm, minHeight: 56 },
  round: { width: 40, height: 40, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  progress: { flex: 1, flexDirection: 'row', gap: 5 },
  progressSeg: { flex: 1, height: 5, borderRadius: radius.pill, overflow: 'hidden' },
  kicker: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase' },
  question: { fontFamily: fonts.display, fontSize: 34, lineHeight: 40, letterSpacing: -0.8 },
  hint: { fontFamily: fonts.display, fontSize: 19, lineHeight: 25, letterSpacing: -0.3, marginTop: 2 },
  footer: { paddingTop: sp.sm, gap: 2 },
  pairRow: { flexDirection: 'row', gap: sp.sm },
  pairBtn: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: sp.sm },
  secondary: { height: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
})
