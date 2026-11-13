// Face ID / fingerprint gate for the Document Vault (RN port of the PWA's
// VaultGate).
//
// The lock is OPT-IN, exactly like the PWA: it only engages when the user has
// turned on the lock for this device (toggle on the vault screen, stored per
// user+device via vaultLock.ts — OFF by default). Everyone else passes
// straight through; the account login + RLS still protect the data.
//
// Locked, it's a vault door (owner, 2026-11-13 — it was a padlock on a plain
// screen): `VaultDoor`, dark and full-bleed. A verified face/finger turns the
// wheel (dial clicks), draws the bolts (clunk), swings the door open on its
// hinge (the lit papers inside) and the whole scene zooms + fades into the
// documents, which are already mounted underneath. A failed check shakes the
// wheel. Reduce Motion: the lamp turns green and the scene just fades.
//
// iOS needs a user gesture to present Face ID, so the button is the reliable
// path; we still try once automatically. Re-locks whenever the screen loses
// focus (useFocusEffect cleanup), so returning requires a fresh check.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as LocalAuthentication from 'expo-local-authentication'
import { ChevronLeft, Fingerprint, ScanFace } from 'lucide-react-native'
import Animated, {
  Easing,
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Pressable } from '@/components/Pressable'
import { TintButton } from '@/components/TintButton'
import { AppHeader, Screen, Txt } from '@/components/ui'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useI18n } from '@/hooks/useI18n'
import { useAuth } from '@/lib/auth'
import { biometricAvailable, isVaultLockEnabled } from '@/lib/vaultLock'
import { fonts, sp } from '@/theme/theme'

import { VaultDoor } from './VaultDoor'
import { haptic, preloadVault, vaultSound } from './vaultFeedback'

type Status = 'checking' | 'locked' | 'opening' | 'unlocked'

const BRASS: [string, string] = ['#E3BC66', '#A87628']
const NEVER = { reduceMotion: ReduceMotion.Never }

export default function VaultGate({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const { profile } = useAuth()
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const bottomGap = useBottomGap(sp.lg)
  const reduced = useReducedMotion()
  const [status, setStatus] = useState<Status>('checking')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  // Guards the auto-attempt so it only fires once per focus.
  const autoTried = useRef(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  const wheel = useSharedValue(0)
  const bolts = useSharedValue(0)
  const door = useSharedValue(0)
  const lamp = useSharedValue(0)
  const leave = useSharedValue(0)

  const clearTimers = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }
  const later = (ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms))
  }

  const reset = useCallback(() => {
    clearTimers()
    cancelAnimation(lamp)
    wheel.set(0)
    bolts.set(0)
    door.set(0)
    lamp.set(0)
    leave.set(0)
  }, [wheel, bolts, door, lamp, leave])

  const open = useCallback(() => {
    setFailed(false)
    setStatus('opening')
    cancelAnimation(lamp)
    lamp.set(withTiming(2, { duration: 220, ...NEVER }))
    if (reduced) {
      leave.set(withTiming(1, { duration: 320, ...NEVER }))
      later(340, () => setStatus('unlocked'))
      return
    }
    haptic('light')
    vaultSound('dial')
    wheel.set(withTiming(-330, { duration: 760, easing: Easing.bezier(0.45, 0, 0.2, 1) }))
    later(760, () => {
      vaultSound('clunk')
      haptic('medium')
      bolts.set(withTiming(1, { duration: 220, easing: Easing.in(Easing.quad) }))
    })
    later(1010, () => {
      vaultSound('open')
      door.set(withTiming(1, { duration: 950, easing: Easing.bezier(0.3, 0, 0.1, 1) }))
    })
    later(1500, () => {
      haptic('success')
      leave.set(withTiming(1, { duration: 520, easing: Easing.bezier(0.4, 0, 0.6, 1) }))
    })
    later(2040, () => setStatus('unlocked'))
  }, [reduced, wheel, bolts, door, lamp, leave])

  const authenticate = useCallback(async () => {
    setBusy(true)
    setFailed(false)
    // Amber while the OS checks.
    lamp.set(withRepeat(withSequence(withTiming(1, { duration: 380, ...NEVER }), withTiming(0.55, { duration: 380, ...NEVER })), -1, true))
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: t('vault.unlock'),
        cancelLabel: t('common.cancel'),
        disableDeviceFallback: false,
      })
      if (result.success) {
        open()
      } else {
        setFailed(true)
        cancelAnimation(lamp)
        lamp.set(withTiming(0, { duration: 200, ...NEVER }))
        // Unless the person just cancelled: then nothing "failed" to shake about.
        if (result.error !== 'user_cancel' && result.error !== 'system_cancel' && result.error !== 'app_cancel') {
          haptic('error')
          wheel.set(withSequence(withTiming(16, { duration: 70 }), withTiming(-13, { duration: 80 }), withTiming(8, { duration: 70 }), withTiming(0, { duration: 80 })))
        }
      }
    } catch {
      setFailed(true)
      cancelAnimation(lamp)
      lamp.set(0)
    } finally {
      setBusy(false)
    }
  }, [t, open, lamp, wheel])

  // Run on every focus; cleanup re-locks when the screen is left.
  const email = profile?.email ?? null
  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      autoTried.current = false
      ;(async () => {
        // Opt-in: no lock enabled for this user+device → pass straight through.
        const enabled = email ? await isVaultLockEnabled(email) : false
        if (cancelled) return
        if (!enabled) {
          setStatus('unlocked')
          return
        }
        const available = await biometricAvailable()
        if (cancelled) return
        if (!available) {
          setStatus('unlocked') // lock on but biometric gone (unenrolled) → pass through
          return
        }
        preloadVault()
        reset()
        setStatus('locked')
        // Try once automatically; iOS still requires the button if this is
        // rejected for lack of user activation. A beat first, so the door is
        // on screen before the system sheet covers it.
        if (!autoTried.current) {
          autoTried.current = true
          later(350, () => {
            if (!cancelled) void authenticate()
          })
        }
      })()
      return () => {
        cancelled = true
        // Re-lock on leaving so re-entry demands a fresh check.
        clearTimers()
        setStatus('checking')
        setFailed(false)
      }
    }, [authenticate, email, reset]),
  )
  useEffect(() => () => clearTimers(), [])

  const sceneStyle = useAnimatedStyle(() => ({ opacity: 1 - leave.value }))
  const doorZoom = useAnimatedStyle(() => ({ transform: [{ scale: 1 + leave.value * 0.9 }] }))
  const textFade = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, door.value * 2 + leave.value * 2) }))

  if (status === 'unlocked') return <>{children}</>
  if (status === 'checking') {
    return (
      <Screen>
        <AppHeader title={t('docs.title')} />
        <View style={{ flex: 1 }} />
      </Screen>
    )
  }

  const doorSize = Math.min(width - 84, height * 0.4, 340)
  const BioIcon = Platform.OS === 'android' ? Fingerprint : ScanFace

  return (
    <View style={{ flex: 1 }}>
      {/* the documents wait underneath while the door opens */}
      {status === 'opening' ? <View style={StyleSheet.absoluteFill}>{children}</View> : null}

      <Animated.View style={[StyleSheet.absoluteFill, sceneStyle]} pointerEvents={status === 'opening' ? 'none' : 'auto'}>
        <StatusBar style="light" />
        <Backdrop width={width} height={height} />

        <View style={{ paddingTop: insets.top + sp.sm, paddingHorizontal: sp.lg }}>
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('common.back')} style={st.round}>
            <ChevronLeft size={22} color="#E8ECF2" />
          </Pressable>
        </View>

        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Animated.View style={doorZoom}>
            <VaultDoor size={doorSize} wheel={wheel} bolts={bolts} door={door} lamp={lamp} />
          </Animated.View>
        </View>

        <Animated.View style={[{ paddingHorizontal: sp.xl, alignItems: 'center', gap: 6 }, textFade]}>
          <Txt style={st.kicker}>{t('docs.title')}</Txt>
          <Txt style={st.title}>{status === 'opening' ? t('vault.opening') : t('vault.title')}</Txt>
          <Txt style={[st.sub, failed ? { color: '#FF9A8F' } : null]}>{failed ? t('vault.failed') : t('vault.locked')}</Txt>
        </Animated.View>

        <Animated.View style={[{ paddingHorizontal: sp.lg, paddingTop: sp.xl, paddingBottom: bottomGap + sp.sm }, textFade]}>
          <TintButton
            inline
            tint={BRASS[1]}
            colors={BRASS}
            disabled={busy || status === 'opening'}
            title={busy ? t('vault.unlocking') : t('vault.unlock')}
            icon={<BioIcon size={20} color="#fff" />}
            onPress={() => void authenticate()}
          />
        </Animated.View>
      </Animated.View>
    </View>
  )
}

/** Deep steel night with a soft pool of light where the door hangs. */
function Backdrop({ width, height }: { width: number; height: number }) {
  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
      <Defs>
        <RadialGradient id="vbg" cx="50%" cy="42%" r="75%">
          <Stop offset="0" stopColor="#2B3445" />
          <Stop offset="0.55" stopColor="#141922" />
          <Stop offset="1" stopColor="#07090D" />
        </RadialGradient>
      </Defs>
      <Rect width={width} height={height} fill="url(#vbg)" />
    </Svg>
  )
}

const st = StyleSheet.create({
  round: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  kicker: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 2.2, textTransform: 'uppercase', color: '#E3BC66' },
  title: { fontFamily: fonts.display, fontSize: 28, lineHeight: 34, color: '#F4F6FA', textAlign: 'center' },
  sub: { fontSize: 15.5, lineHeight: 21, color: 'rgba(232,236,242,0.62)', textAlign: 'center', maxWidth: 300 },
})
