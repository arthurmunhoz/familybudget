// Hand-drawn note (owner, 2026-11-15): the phone becomes a sheet of paper; a
// member writes or draws with a finger and sends it to the family like any
// nudge (migration 112: pings.image_path). The sheet slides in like paper on
// a desk, the pen buzzes softly as it lands, and on send the page flies off
// with a whoosh.
//
// Drawing is plain react-native-svg + gesture-handler (no native module), the
// picture is a PNG snapshot of the sheet (react-native-view-shot, loaded
// lazily like printables/printing.ts) uploaded to "<household>/notes/".
//
// The eraser removes whole strokes it touches (like Notes' object eraser) —
// painting paper colour would also wipe the ruled lines.
/* eslint-disable @typescript-eslint/no-require-imports -- lazily-loaded native module (see header) */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Animated, Easing, ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Svg, { Line, Path } from 'react-native-svg'
import { router } from 'expo-router'
import { Eraser, Send, Trash2, Undo2, X } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import { APP_GRADIENT } from '@/components/home/palette'
import { useI18n } from '@/hooks/useI18n'
import { useAuth } from '@/lib/auth'
import { emitNoteSent, sendPing } from '@/lib/pings'
import { supabase } from '@/lib/supabase'
import { haptic, sound } from '@/apps/games/feedback'
import { PersonChip } from '@/apps/pings/PingComposer'
import { fonts, sp, useTheme } from '@/theme/theme'

const PAPER = '#FFFBF2'
const RULE = '#E9DFCB'
const MARGIN = '#F1B9A6'
const RULE_GAP = 34
const INKS = ['#2B2521', '#C2562F', '#2F6FB5', '#3F8F6A', '#D9468F', '#E3A21A'] as const
const WIDTHS = [3, 6, 11] as const
/** A drawn note stays on the family's Home for a day (text nudges: 6 h). */
const NOTE_TTL_MS = 24 * 60 * 60 * 1000
/** Width of the PNG that's sent — sharp on any phone, small to upload. */
const OUT_WIDTH = 1080

type Pt = { x: number; y: number }
interface Stroke {
  color: string
  width: number
  pts: Pt[]
}

/** Smooth a run of points into an SVG path (quadratic curves through the
 *  midpoints). A single tap becomes a dot. */
function toPath(pts: Pt[]): string {
  if (pts.length === 0) return ''
  const [a] = pts
  if (pts.length === 1) return `M${a.x} ${a.y} L${a.x + 0.1} ${a.y}`
  let d = `M${a.x} ${a.y}`
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]
    const n = pts[i + 1]
    d += ` Q${p.x} ${p.y} ${(p.x + n.x) / 2} ${(p.y + n.y) / 2}`
  }
  const last = pts[pts.length - 1]
  return `${d} L${last.x} ${last.y}`
}

function touches(s: Stroke, p: Pt, radius: number): boolean {
  const r = radius + s.width / 2
  return s.pts.some((q) => (q.x - p.x) ** 2 + (q.y - p.y) ** 2 <= r * r)
}

/** Finished strokes don't re-render while the live one is being drawn. */
const Ink = memo(function Ink({ strokes }: { strokes: Stroke[] }) {
  return (
    <>
      {strokes.map((s, i) => (
        <Path key={i} d={toPath(s.pts)} stroke={s.color} strokeWidth={s.width} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      ))}
    </>
  )
})

/** The sheet's ruled lines and red margin, sized to the paper. */
const Ruling = memo(function Ruling({ w, h }: { w: number; h: number }) {
  const rows = Math.floor((h - 56) / RULE_GAP)
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <Line key={i} x1={0} x2={w} y1={56 + i * RULE_GAP} y2={56 + i * RULE_GAP} stroke={RULE} strokeWidth={1} />
      ))}
      <Line x1={40} x2={40} y1={0} y2={h} stroke={MARGIN} strokeWidth={1.4} />
    </>
  )
})

function loadViewShot(): typeof import('react-native-view-shot') | null {
  try {
    return require('react-native-view-shot')
  } catch {
    return null
  }
}

/** RN-safe base64 → bytes (no atob). */
function decodeBase64(b64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const lookup = new Uint8Array(256)
  for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i
  const len = b64.length
  const padding = (b64[len - 1] === '=' ? 1 : 0) + (b64[len - 2] === '=' ? 1 : 0)
  const out = new Uint8Array((len * 3) / 4 - padding)
  let p = 0
  for (let i = 0; i < len; i += 4) {
    const e1 = lookup[b64.charCodeAt(i)]
    const e2 = lookup[b64.charCodeAt(i + 1)]
    const e3 = lookup[b64.charCodeAt(i + 2)]
    const e4 = lookup[b64.charCodeAt(i + 3)]
    out[p++] = (e1 << 2) | (e2 >> 4)
    if (p < out.length) out[p++] = ((e2 & 15) << 4) | (e3 >> 2)
    if (p < out.length) out[p++] = ((e3 & 3) << 6) | (e4 & 63)
  }
  return out
}

function randomUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

export default function DrawNote({ initialTo }: { initialTo: string[] }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const insets = useSafeAreaInsets()
  const { profile, profiles } = useAuth()
  const myEmail = profile?.email
  const members = useMemo(() => profiles.filter((p) => p.email !== myEmail), [profiles, myEmail])

  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialTo.filter((e) => members.some((m) => m.email === e))))
  const everyone = selected.size === 0 || selected.size === members.length
  function toggle(email: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(email)) next.delete(email)
      else next.add(email)
      return next.size >= members.length ? new Set<string>() : next
    })
  }

  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [history, setHistory] = useState<Stroke[][]>([])
  const [live, setLive] = useState<Stroke | null>(null)
  const [ink, setInk] = useState<string>(INKS[0])
  const [width, setWidth] = useState<number>(WIDTHS[1])
  const [erasing, setErasing] = useState(false)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [sending, setSending] = useState(false)

  const liveRef = useRef<Stroke | null>(null)
  const strokesRef = useRef<Stroke[]>([])
  /** Every change to the ink goes through here, so the gesture callbacks
   *  (which run outside render) always see the current strokes. */
  const setInkStrokes = useCallback((next: Stroke[]) => {
    strokesRef.current = next
    setStrokes(next)
  }, [])
  const paperRef = useRef<View>(null)

  const commit = useCallback(
    (next: Stroke[]) => {
      const prev = strokesRef.current
      setHistory((h) => [...h.slice(-49), prev])
      setInkStrokes(next)
    },
    [setInkStrokes],
  )

  const eraseAt = useCallback(
    (p: Pt) => {
      const cur = strokesRef.current
      const keep = cur.filter((s) => !touches(s, p, 14))
      if (keep.length !== cur.length) {
        haptic('light')
        setInkStrokes(keep)
      }
    },
    [setInkStrokes],
  )

  const eraseStart = useRef<Stroke[] | null>(null)
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .maxPointers(1)
        .runOnJS(true)
        .onBegin((e) => {
          if (sending) return
          const p = { x: e.x, y: e.y }
          if (erasing) {
            eraseStart.current = strokesRef.current
            eraseAt(p)
            return
          }
          haptic('select')
          const s: Stroke = { color: ink, width, pts: [p] }
          liveRef.current = s
          setLive(s)
        })
        .onUpdate((e) => {
          const p = { x: e.x, y: e.y }
          if (erasing) {
            eraseAt(p)
            return
          }
          const s = liveRef.current
          if (!s) return
          const last = s.pts[s.pts.length - 1]
          if ((last.x - p.x) ** 2 + (last.y - p.y) ** 2 < 4) return
          const next = { ...s, pts: [...s.pts, p] }
          liveRef.current = next
          setLive(next)
        })
        .onFinalize(() => {
          if (erasing) {
            const before = eraseStart.current
            eraseStart.current = null
            if (before && before.length !== strokesRef.current.length) setHistory((h) => [...h.slice(-49), before])
            return
          }
          const s = liveRef.current
          liveRef.current = null
          setLive(null)
          if (s) commit([...strokesRef.current, s])
        }),
    [erasing, ink, width, sending, eraseAt, commit],
  )

  function undo() {
    if (!history.length) return
    haptic('light')
    setInkStrokes(history[history.length - 1])
    setHistory((h) => h.slice(0, -1))
  }
  function clear() {
    if (!strokes.length) return
    haptic('medium')
    commit([])
  }

  // The sheet slides up onto the "desk"; on send it flies off.
  const [enter] = useState(() => new Animated.Value(0))
  const [fly] = useState(() => new Animated.Value(0))
  useEffect(() => {
    Animated.spring(enter, {
      toValue: 1,
      useNativeDriver: true,
      damping: 16,
      stiffness: 140,
      mass: 0.9,
    }).start()
  }, [enter])

  async function send() {
    if (sending || !strokes.length || !size || !profile?.household_id) return
    setSending(true)
    try {
      const shot = loadViewShot()
      if (!shot || !paperRef.current) throw new Error('no view-shot')
      const b64 = await shot.captureRef(paperRef, {
        format: 'png',
        quality: 1,
        result: 'base64',
        width: OUT_WIDTH,
        height: Math.round((OUT_WIDTH * size.h) / size.w),
      })
      const path = `${profile.household_id}/notes/${randomUUID()}.png`
      const { error } = await supabase.storage.from('documents').upload(path, decodeBase64(b64), {
        contentType: 'image/png',
        cacheControl: '604800',
      })
      if (error) throw error
      await sendPing('drawing', '✏️', t('notes.pushText'), everyone ? null : [...selected], false, {
        source: 'drawing',
        imagePath: path,
        expiresAt: new Date(Date.now() + NOTE_TTL_MS).toISOString(),
      })
      emitNoteSent()
      sound('whoosh')
      haptic('success')
      Animated.timing(fly, {
        toValue: 1,
        duration: 520,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(() => (router.canGoBack() ? router.back() : router.replace('/pings')))
    } catch {
      setSending(false)
      Alert.alert(t('notes.failed'))
    }
  }

  const onPaperLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout
    if (!size || Math.abs(size.w - w) > 1 || Math.abs(size.h - h) > 1) setSize({ w, h })
  }

  const blue = APP_GRADIENT.pings[1]
  const initialsOf = (name: string) => {
    const parts = name.trim().split(/\s+/).filter(Boolean)
    return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?'
  }
  const empty = !strokes.length && !live

  const sheetStyle = {
    opacity: Animated.multiply(enter, fly.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0] })),
    transform: [
      {
        translateY: Animated.add(
          enter.interpolate({ inputRange: [0, 1], outputRange: [600, 0] }),
          fly.interpolate({ inputRange: [0, 1], outputRange: [0, -900] }),
        ),
      },
      {
        rotate: Animated.add(enter, fly).interpolate({
          inputRange: [0, 1, 2],
          outputRange: ['6deg', '0deg', '-14deg'],
        }),
      },
      {
        scale: fly.interpolate({ inputRange: [0, 1], outputRange: [1, 0.55] }),
      },
    ],
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top + 4 }}>
      {/* top bar */}
      <View style={styles.top}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/pings'))}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          style={[styles.round, { backgroundColor: c.card, borderColor: c.border }]}
        >
          <X size={20} color={c.text} />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Txt style={{ fontFamily: fonts.display, fontSize: 22, color: c.text }}>{t('notes.title')}</Txt>
        </View>
        <View style={{ width: 40 }} />
      </View>

      {/* who */}
      {members.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={{
            gap: 6,
            paddingHorizontal: sp.lg,
            paddingBottom: sp.sm,
          }}
        >
          <PersonChip label={t('pings.everyone')} initials={null} on={everyone} onPress={() => setSelected(new Set())} color={blue} />
          {members.map((m) => (
            <PersonChip
              key={m.email}
              label={m.display_name.split(' ')[0]}
              initials={initialsOf(m.display_name)}
              on={!everyone && selected.has(m.email)}
              onPress={() => toggle(m.email)}
              color={blue}
            />
          ))}
        </ScrollView>
      ) : null}

      {/* the sheet */}
      <View style={{ flex: 1, paddingHorizontal: sp.lg, paddingVertical: sp.sm }}>
        <Animated.View style={[styles.sheetWrap, sheetStyle]}>
          {/* washi tape holding the sheet down — decoration, outside the snapshot */}
          <View pointerEvents="none" style={styles.tape}>
            <GradientBox colors={APP_GRADIENT.pings} radius={3} style={{ flex: 1, opacity: 0.55 }} />
          </View>
          <GestureDetector gesture={pan}>
            <View ref={paperRef} collapsable={false} onLayout={onPaperLayout} style={styles.paper}>
              {size ? (
                <Svg width={size.w} height={size.h}>
                  <Ruling w={size.w} h={size.h} />
                  <Ink strokes={strokes} />
                  {live ? (
                    <Path
                      d={toPath(live.pts)}
                      stroke={live.color}
                      strokeWidth={live.width}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                    />
                  ) : null}
                </Svg>
              ) : null}
              {empty ? (
                <View pointerEvents="none" style={styles.hintWrap}>
                  <Txt style={styles.hint}>{t('notes.hint')}</Txt>
                </View>
              ) : null}
            </View>
          </GestureDetector>
        </Animated.View>
      </View>

      {/* tools */}
      <View style={[styles.tools, { borderColor: c.border, backgroundColor: c.card }]}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          {INKS.map((col) => {
            const on = !erasing && ink === col
            return (
              <Pressable
                key={col}
                onPress={() => {
                  haptic('select')
                  setInk(col)
                  setErasing(false)
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={t('notes.color')}
                style={[styles.swatchRing, { borderColor: on ? col : 'transparent' }]}
              >
                <View style={[styles.swatch, { backgroundColor: col }]} />
              </Pressable>
            )
          })}
        </View>
        <View style={[styles.sep, { backgroundColor: c.border }]} />
        <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
          {WIDTHS.map((w) => {
            const on = !erasing && width === w
            return (
              <Pressable
                key={w}
                onPress={() => {
                  haptic('select')
                  setWidth(w)
                  setErasing(false)
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={t('notes.size')}
                style={[styles.tool, on ? { backgroundColor: c.surface } : null]}
              >
                <View
                  style={{
                    width: w + 3,
                    height: w + 3,
                    borderRadius: 10,
                    backgroundColor: on ? ink : c.textFaint,
                  }}
                />
              </Pressable>
            )
          })}
        </View>
      </View>

      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, sp.md) }]}>
        <Pressable
          onPress={() => {
            haptic('select')
            setErasing((v) => !v)
          }}
          accessibilityRole="button"
          accessibilityState={{ selected: erasing }}
          accessibilityLabel={t('notes.eraser')}
          style={[
            styles.round,
            {
              backgroundColor: erasing ? blue : c.card,
              borderColor: erasing ? blue : c.border,
            },
          ]}
        >
          <Eraser size={19} color={erasing ? '#fff' : c.text} />
        </Pressable>
        <Pressable
          onPress={undo}
          disabled={!history.length}
          accessibilityRole="button"
          accessibilityLabel={t('notes.undo')}
          style={[
            styles.round,
            {
              backgroundColor: c.card,
              borderColor: c.border,
              opacity: history.length ? 1 : 0.4,
            },
          ]}
        >
          <Undo2 size={19} color={c.text} />
        </Pressable>
        <Pressable
          onPress={clear}
          disabled={!strokes.length}
          accessibilityRole="button"
          accessibilityLabel={t('notes.clear')}
          style={[
            styles.round,
            {
              backgroundColor: c.card,
              borderColor: c.border,
              opacity: strokes.length ? 1 : 0.4,
            },
          ]}
        >
          <Trash2 size={18} color={c.text} />
        </Pressable>
        <Pressable
          onPress={() => void send()}
          disabled={!strokes.length || sending}
          accessibilityRole="button"
          accessibilityLabel={t('notes.send')}
          style={{ flex: 1, opacity: strokes.length ? 1 : 0.45 }}
        >
          <GradientBox colors={APP_GRADIENT.pings} radius={22} style={styles.sendBtn}>
            {sending ? <ActivityIndicator color="#fff" /> : <Send size={18} strokeWidth={2.4} color="#fff" />}
            <Txt
              style={{
                color: '#fff',
                fontFamily: fonts.semibold,
                fontSize: 16.5,
              }}
            >
              {everyone ? t('notes.sendAll') : t('notes.send')}
            </Txt>
          </GradientBox>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: sp.lg,
    paddingBottom: sp.sm,
  },
  round: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetWrap: {
    flex: 1,
    borderRadius: 18,
    shadowColor: '#3b2a1a',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  paper: {
    flex: 1,
    backgroundColor: PAPER,
    borderRadius: 18,
    overflow: 'hidden',
  },
  tape: {
    position: 'absolute',
    top: -12,
    alignSelf: 'center',
    width: 120,
    height: 28,
    zIndex: 2,
    transform: [{ rotate: '-3deg' }],
  },
  hintWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 48,
  },
  hint: {
    fontFamily: fonts.display,
    fontSize: 22,
    lineHeight: 30,
    color: '#B8AB95',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  tools: {
    marginHorizontal: sp.lg,
    marginTop: sp.sm,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: sp.md,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  swatchRing: { padding: 2.5, borderRadius: 18, borderWidth: 2 },
  swatch: { width: 24, height: 24, borderRadius: 12 },
  sep: { width: StyleSheet.hairlineWidth, height: 28 },
  tool: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: sp.lg,
    paddingTop: sp.md,
  },
  sendBtn: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
})
