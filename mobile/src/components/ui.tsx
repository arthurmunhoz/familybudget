// Shared UI primitives for the One Roof RN app — themed Screen, header, card,
// button, text, and text field. Every module screen builds from these so the
// "Warm Hearth" look stays consistent.
import { type ReactNode } from 'react'
import {
  ActivityIndicator,
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
import { SafeAreaView, type Edge } from 'react-native-safe-area-context'
import { ChevronLeft } from 'lucide-react-native'
import { router } from 'expo-router'

import { fonts, radius, sp, useTheme } from '../theme/theme'

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
}: {
  children: ReactNode
  scroll?: boolean
  pad?: boolean
  edges?: Edge[]
}) {
  const { c } = useTheme()
  const inner = pad ? { paddingHorizontal: sp.lg } : undefined
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={edges}>
      {scroll ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[{ paddingBottom: sp.xxl }, inner]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
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
}: {
  title: string
  onBack?: () => void
  right?: ReactNode
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
}: {
  title: string
  onPress: () => void
  variant?: 'primary' | 'secondary' | 'ghost'
  disabled?: boolean
  loading?: boolean
  style?: ViewStyle
}) {
  const { c } = useTheme()
  const bg = variant === 'primary' ? c.accent : variant === 'secondary' ? c.surface : 'transparent'
  const fg = variant === 'primary' ? '#ffffff' : c.text
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        {
          backgroundColor: bg,
          borderRadius: radius.md,
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
