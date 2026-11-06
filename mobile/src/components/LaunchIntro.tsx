// The opening of the app (owner, 2026-11): one continuous, branded moment
// instead of "native splash → a different One Roof screen → app".
//
// It starts PIXEL-IDENTICAL to the native splash — same cream (#FBF6F0, both
// appearances, see expo-splash-screen in app.json), same splash-icon.png at
// the same 150pt, centred on the whole screen — and only then is the native
// splash hidden (on our first layout), so the handoff can't be seen. Then:
// the icon gives a small pop, "One Roof" and the tagline rise in under it,
// and once the session has resolved (at least MIN_MS, at most MAX_MS) the
// whole layer fades out while the icon grows a touch — straight into the app.
// It runs once per cold start and unmounts itself.
import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, Image, StyleSheet } from 'react-native'
import * as SplashScreen from 'expo-splash-screen'

import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { useAuth } from '@/lib/auth'
import { fonts } from '@/theme/theme'

// eslint-disable-next-line @typescript-eslint/no-require-imports -- a bundled asset
const SPLASH_ICON = require('../../assets/images/splash-icon.png')
const BG = '#FBF6F0'
const ICON = 150
const MIN_MS = 900
const MAX_MS = 6000

export function LaunchIntro() {
  const { t } = useI18n()
  const { loading, session, profileLoaded } = useAuth()
  const ready = !loading && (!session || profileLoaded)
  const [gone, setGone] = useState(false)
  const shown = useRef(false)
  const started = useRef(0)
  const exiting = useRef(false)

  const [pop] = useState(() => new Animated.Value(1))
  const [words] = useState(() => new Animated.Value(0))
  const [fade] = useState(() => new Animated.Value(1))

  // First layout: we now look exactly like the native splash — swap them.
  function onLayout() {
    if (shown.current) return
    shown.current = true
    started.current = Date.now()
    SplashScreen.hideAsync().catch(() => {})
    Animated.parallel([
      Animated.sequence([
        Animated.timing(pop, { toValue: 1.07, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.spring(pop, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }),
      ]),
      Animated.timing(words, { toValue: 1, duration: 420, delay: 160, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start()
  }

  // Leave once the app behind us has something to show (or after MAX_MS).
  useEffect(() => {
    function exit() {
      if (exiting.current) return
      exiting.current = true
      Animated.parallel([
        Animated.timing(fade, { toValue: 0, duration: 300, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.timing(pop, { toValue: 1.25, duration: 300, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]).start(() => setGone(true))
    }
    const wait = started.current ? Math.max(0, MIN_MS - (Date.now() - started.current)) : MIN_MS
    const id = ready ? setTimeout(exit, wait) : setTimeout(exit, MAX_MS)
    return () => clearTimeout(id)
  }, [ready, fade, pop])

  if (gone) return null

  return (
    <Animated.View
      onLayout={onLayout}
      pointerEvents={ready ? 'none' : 'auto'}
      style={[StyleSheet.absoluteFill, s.root, { opacity: fade }]}
    >
      <Animated.View style={{ transform: [{ scale: pop }] }}>
        <Image source={SPLASH_ICON} style={{ width: ICON, height: ICON }} />
      </Animated.View>
      {/* Absolutely placed under the icon so it never moves the icon off the
          native splash's exact centre. */}
      <Animated.View
        style={[
          s.words,
          {
            opacity: words,
            transform: [{ translateY: words.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
          },
        ]}
      >
        <Txt style={s.name}>One Roof</Txt>
        <Txt style={s.tagline}>{t('login.tagline')}</Txt>
      </Animated.View>
    </Animated.View>
  )
}

const s = StyleSheet.create({
  root: { backgroundColor: BG, alignItems: 'center', justifyContent: 'center', zIndex: 1000, elevation: 1000 },
  words: { position: 'absolute', top: '50%', marginTop: ICON / 2 + 18, alignItems: 'center', gap: 4 },
  name: { fontFamily: fonts.display, fontSize: 34, lineHeight: 40, color: '#2A2420', letterSpacing: -0.5 },
  tagline: { fontSize: 15, color: '#8A7F76' },
})
