// Shared UI primitives for the One Roof RN app — themed Screen, header, card,
// button, text, and text field. Every module screen builds from these so the
// "Warm Hearth" look stays consistent.
import { type ReactNode, type Ref } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type TextProps,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native'
import type { ScrollViewProps } from 'react-native'
import { SafeAreaView, useSafeAreaInsets, type Edge } from 'react-native-safe-area-context'
import { ChevronLeft, Sparkles } from 'lucide-react-native'
import { router } from 'expo-router'

import { fonts, radius, sp, useTheme } from '../theme/theme'
import { pickOn } from '../theme/contrast'
import { KEYBOARD_DONE_ID } from './keyboardDoneId'

type TxtVariant = 'display' | 'title' | 'h2' | 'body' | 'muted' | 'faint' | 'label'

export function Txt({
  variant = 'body',
  style,
  ...rest
}: TextProps & { variant?: TxtVariant }) {
  const { c } = useTheme()
  const map: Record<TxtVariant, object> = {
    display: { fontSize: 30, fontFamily: fonts.display, color: c.text, letterSpacing: -0.3 },
    title: { fontSize: 24, fontFamily: fonts.displaySemi, color: c.text, letterSpacing: -0.2 },
    h2: { fontSize: 18, fontFamily: fonts.semibold, color: c.text },
    body: { fontSize: 16, fontFamily: fonts.body, color: c.text },
    muted: { fontSize: 14, fontFamily: fonts.body, color: c.textMuted },
    faint: { fontSize: 13, fontFamily: fonts.body, color: c.textFaint },
    label: { fontSize: 13, fontFamily: fonts.semibold, color: c.textMuted },
  }
  return <Text {...rest} style={[map[variant], style]} />
}

export function Screen({
  children,
  scroll = false,
  pad = true,
  edges = ['top', 'left', 'right'],
  header,
  scrollRef,
  onScroll,
}: {
  children: ReactNode
  scroll?: boolean
  pad?: boolean
  edges?: Edge[]
  /** Rendered fixed above the scroll area — stays put while `children` scroll.
   *  Pass an <AppHeader/> here instead of as the first child so it doesn't
   *  scroll away. */
  header?: ReactNode
  /** Optional ref to the inner ScrollView (only when `scroll`) — for
   *  programmatic scroll-to, e.g. deep-linking to a section. */
  scrollRef?: Ref<ScrollView>
  /** Scroll handler for the inner ScrollView (only when `scroll`) — e.g. an
   *  `Animated.event` driving a collapsing header. */
  onScroll?: ScrollViewProps['onScroll']
}) {
  const { c } = useTheme()
  const inner = pad ? { paddingHorizontal: sp.lg } : undefined
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={edges}>
      {header ? <View style={inner}>{header}</View> : null}
      {scroll ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            contentContainerStyle={[{ paddingBottom: sp.xxl }, inner]}
            keyboardShouldPersistTaps="handled"
            onScroll={onScroll}
            scrollEventThrottle={16}
          >
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      ) : (
        <View style={[{ flex: 1 }, inner]}>{children}</View>
      )}
    </SafeAreaView>
  )
}

export function AppHeader({
  title,
  onBack,
  right,
  icon,
}: {
  title: string
  onBack?: () => void
  right?: ReactNode
  /** App/section icon shown between the back arrow and the title (PWA standard).
   *  Use this for the screen's identity icon; keep `right` for action buttons. */
  icon?: ReactNode
}) {
  const { c } = useTheme()
  const back = onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')))
  return (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={back}
          hitSlop={10}
          style={styles.backBtn}
        >
          <ChevronLeft size={26} color={c.text} />
        </Pressable>
        {icon ? <View style={{ marginRight: 2 }}>{icon}</View> : null}
        <Txt variant="title">{title}</Txt>
      </View>
      {right}
    </View>
  )
}

export function Card({
  children,
  style,
  onPress,
}: {
  children: ReactNode
  style?: ViewStyle
  onPress?: () => void
}) {
  const { c } = useTheme()
  const base: ViewStyle = {
    backgroundColor: c.card,
    borderRadius: radius.md,
    padding: sp.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
  }
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [base, pressed && { backgroundColor: c.cardActive }, style]}>
        {children}
      </Pressable>
    )
  }
  return <View style={[base, style]}>{children}</View>
}

export function Btn({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
  curveBottom = false,
}: {
  title: string
  onPress: () => void
  /** `danger` = a destructive/stop action, filled RED. Deliberately a fill and
   *  not the app's usual red-label-on-plain (Disconnect, Delete account): that
   *  measures 3.3:1 in light mode, under AA for this 16pt label. A fill with
   *  pickOn() lands at 4.7–5.8:1 in both shipping modes, the same way the
   *  primary button derives c.onAccent. The label colour has to live here —
   *  callers can restyle the box via `style`, but not the text. */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  disabled?: boolean
  loading?: boolean
  style?: ViewStyle
  /** Screen-curve rounded bottom corners (top stays radius.md) — for a button
   *  docked to the bottom of a sheet/screen, matching NewItemButton. */
  curveBottom?: boolean
}) {
  const { c } = useTheme()
  const bg =
    variant === 'primary'
      ? c.accent
      : variant === 'danger'
        ? c.expense
        : variant === 'secondary'
          ? c.surface
          : 'transparent'
  const fg =
    variant === 'primary' ? c.onAccent : variant === 'danger' ? pickOn(c.expense) : c.text
  const corners = curveBottom
    ? {
        borderTopLeftRadius: radius.md,
        borderTopRightRadius: radius.md,
        borderBottomLeftRadius: CURVE_RADIUS,
        borderBottomRightRadius: CURVE_RADIUS,
      }
    : { borderRadius: radius.md }
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        {
          backgroundColor: bg,
          ...corners,
          paddingVertical: 14,
          paddingHorizontal: sp.lg,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={{ color: fg, fontSize: 16, fontFamily: fonts.semibold }}>{title}</Text>
      )}
    </Pressable>
  )
}

export function Field({
  label,
  style,
  ...rest
}: TextInputProps & { label?: string }) {
  const { c } = useTheme()
  return (
    <View style={{ gap: 6 }}>
      {label ? <Txt variant="label">{label}</Txt> : null}
      <TextInput
        // Every Field gets the keyboard "Done" bar; a caller can still override.
        inputAccessoryViewID={KEYBOARD_DONE_ID}
        placeholderTextColor={c.textFaint}
        style={[
          {
            backgroundColor: c.card,
            borderRadius: radius.md,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: c.border,
            paddingHorizontal: sp.md,
            paddingVertical: 12,
            fontSize: 16,
            color: c.text,
          },
          style,
        ]}
        {...rest}
      />
    </View>
  )
}

export function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', flex: 1, gap: 6, padding: sp.xl }}>
      <Txt variant="h2" style={{ textAlign: 'center' }}>
        {title}
      </Txt>
      {subtitle ? (
        <Txt variant="muted" style={{ textAlign: 'center' }}>
          {subtitle}
        </Txt>
      ) : null}
    </View>
  )
}

export function Loader() {
  const { c } = useTheme()
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={c.accent} />
    </View>
  )
}

// iPhones get screen-corner-like rounding on the bottom-bar button.
const CURVE_RADIUS = Platform.OS === 'ios' ? 40 : 12

/**
 * The dashed "＋ New …" action pinned to the bottom of a list screen — Budgets
 * ("New budget"), Months ("New month/week/day"), Calendar ("New event"). One
 * component so the identical gesture reads the same everywhere instead of a
 * filled button here and a dashed one there.
 *
 * Drop it straight inside a bottom-anchored container (a plain `View` at
 * `bottom: 0`, NOT a bottom `SafeAreaView`): it carries its own margins AND a
 * trimmed bottom inset, so it hugs the screen's own curved corner instead of
 * floating above the full home-indicator inset.
 */
export function NewItemButton({
  label,
  onPress,
  disabled,
  loading,
  plus,
}: {
  label: string
  onPress: () => void
  disabled?: boolean
  /** Swap the label for a spinner (e.g. while a file picker or a create call is
   *  in flight). Also blocks taps, like `disabled`. */
  loading?: boolean
  /** Mark this as a Plus-gated action with a Sparkles glyph, so people can see
   *  it costs money BEFORE tapping and landing on the paywall. The button stays
   *  enabled — tapping is what opens the upsell. */
  plus?: boolean
}) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  // Half the inset still clears the home indicator; the sp.xs floor covers
  // home-button devices (inset 0) so it never sits flush on the bezel.
  const bottom = Math.max(Math.round(insets.bottom / 2), sp.xs)
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: 'center',
        justifyContent: 'center',
        // Hold the label's height so swapping to the spinner doesn't reflow the
        // row (the spinner is shorter than the 16pt text line).
        minHeight: 16,
        marginHorizontal: sp.lg,
        marginTop: sp.sm,
        marginBottom: bottom,
        paddingVertical: 16,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: c.textFaint,
        // Bottom corners follow the iPhone screen curve (normal on Android).
        borderTopLeftRadius: radius.md,
        borderTopRightRadius: radius.md,
        borderBottomLeftRadius: CURVE_RADIUS,
        borderBottomRightRadius: CURVE_RADIUS,
        opacity: disabled ? 0.5 : pressed ? 0.6 : 1,
      })}
    >
      {loading ? (
        <ActivityIndicator color={c.accent} />
      ) : (
        <Txt style={{ color: c.accent, fontFamily: fonts.semibold, fontSize: 16 }}>{label}</Txt>
      )}
      {/* Sits on the top border near the right corner, rather than inside next
          to the label — it marks the button without competing with its text.
          Pulled in from the corner (right: 3) so it straddles the straight run
          of the border instead of the 12pt corner radius. */}
      {plus ? (
        <View style={{ position: 'absolute', top: -7, right: 3 }}>
          <Sparkles size={14} color={c.accent} />
        </View>
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: sp.sm,
    paddingBottom: sp.md,
    minHeight: 44,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  backBtn: { marginLeft: -6, padding: 2 },
})
