// A full-bleed photo header, paged sideways — shared by Pet Care (one page per
// pet) and Family (one page per member). Replaced the coverflows of small
// round photos (2026-11): the photo is the most recognisable thing on those
// screens, and a ~80pt circle threw most of it away.
//
//   • Runs under the status bar (the host's SafeAreaView must NOT take the top
//     edge); the controls pad themselves by the inset, and the status bar goes
//     light while the screen is focused.
//   • Swipe the photo, or tap a side arrow, to change item. Each arrow carries a
//     tiny avatar of the item it leads to, and dots show where you are.
//   • The name sits on the photo (bottom-left), with an optional `badge` beside
//     it (Pet Care: overdue dot; Family: "You").
//   • `collapse` (0→1, from the host's scroll) shrinks the hero. It sits ABOVE
//     the host's ScrollView, so animating its height can't disturb that scroll's
//     content offset — see CLAUDE.md "Collapsing headers".
//
// Controls over a photo can't use theme colours (the photo is any colour), so
// they're white on translucent black, with gradient scrims behind the text.
import { useEffect, useRef, type ReactNode } from 'react'
import { Animated, ScrollView, View, useWindowDimensions } from 'react-native'
import { Pressable } from '@/components/Pressable'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useIsFocused } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { Image } from 'expo-image'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { fonts, useTheme } from '@/theme/theme'

/** Hero height BELOW the status bar, expanded and collapsed. */
const HERO_OPEN = 250
const HERO_SHUT = 104
const RADIUS = 28
const GLASS_BTN = 'rgba(0,0,0,0.32)'

export type HeroItem = {
  id: string
  name: string
  /** Signed photo URL; without one the page is `color` with `glyph` large. */
  photo?: string | null
  color: string
  /** Emoji or initial for the no-photo page and the arrows' tiny avatars. */
  glyph: string
  /** Drawn beside the name (overdue dot, "You" chip…). */
  badge?: ReactNode
}

const STILL = new Animated.Value(0)

type Props = {
  items: HeroItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  /** Tap on the photo itself (Pet Care opens the pet's profile). */
  onPressItem?: (id: string) => void
  /** Shows a "+" button top-right when given. */
  onAdd?: () => void
  addLabel?: string
  /** 0 = host scrolled to the top (hero open), 1 = collapsed. Optional. */
  collapse?: Animated.AnimatedInterpolation<number> | Animated.Value
}

export function PhotoHero({ items, selectedId, onSelect, onPressItem, onAdd, addLabel, collapse = STILL }: Props) {
  const { c } = useTheme()
  const { t } = useI18n()
  const { width } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const focused = useIsFocused()
  const pager = useRef<ScrollView>(null)

  const index = Math.max(0, items.findIndex((p) => p.id === selectedId))
  const prev = index > 0 ? items[index - 1] : null
  const next = index < items.length - 1 ? items[index + 1] : null
  const item = items[index]

  const height = collapse.interpolate({
    inputRange: [0, 1],
    outputRange: [insets.top + HERO_OPEN, insets.top + HERO_SHUT],
    extrapolate: 'clamp',
  })
  const nameSize = collapse.interpolate({ inputRange: [0, 1], outputRange: [32, 22], extrapolate: 'clamp' })
  // Arrows fade as the hero shuts: at 104pt they'd crowd the name.
  const arrowsOpacity = collapse.interpolate({ inputRange: [0, 0.6, 1], outputRange: [1, 0.4, 0], extrapolate: 'clamp' })

  // Where the pager actually is (from onScroll), and the page an arrow tap is
  // gliding to. Both refs, not state: they change every frame of a scroll.
  // Seeded with the starting page so the first sync below is a no-op.
  const offsetX = useRef(index * width)
  const target = useRef<number | null>(null)
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keep the pager on the selected item when the selection changes from
  // OUTSIDE (an item added/renamed reorders an alphabetical list). Only jumps
  // when the pager isn't already there — an unconditional jump is what used to
  // cut an arrow's glide short: the arrow selected first, this effect then
  // snapped the page instantly, and it read as a jump rather than a swipe.
  useEffect(() => {
    if (target.current !== null) return // an arrow glide is in flight
    if (Math.round(offsetX.current / width) === index) return
    pager.current?.scrollTo({ x: index * width, animated: false })
  }, [index, width, items.length])

  useEffect(
    () => () => {
      if (settle.current) clearTimeout(settle.current)
    },
    [],
  )

  /** Commit the page the pager has come to rest on (swipe or arrow). */
  const landOn = (page: number) => {
    target.current = null
    if (settle.current) clearTimeout(settle.current)
    settle.current = null
    const p = items[page]
    if (p && p.id !== selectedId) onSelect(p.id)
  }

  /** Arrow tap = the same swipe, animated by us. The selection changes when the
   *  glide ARRIVES (seen in onScroll), so name, dots and the content below
   *  switch together with the photo, exactly like a finger swipe. Arrival can't
   *  come from onMomentumScrollEnd: Android never fires it for a programmatic
   *  scroll and iOS doesn't reliably. The timer is the fallback if the glide is
   *  interrupted before it reaches the page. */
  const go = (p: HeroItem | null) => {
    if (!p) return
    const i = items.findIndex((x) => x.id === p.id)
    if (i < 0) return
    target.current = i
    pager.current?.scrollTo({ x: i * width, animated: true })
    if (settle.current) clearTimeout(settle.current)
    settle.current = setTimeout(() => {
      if (target.current === i) {
        pager.current?.scrollTo({ x: i * width, animated: false })
        landOn(i)
      }
    }, 600)
  }

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'))

  return (
    <Animated.View
      style={{
        height,
        borderBottomLeftRadius: RADIUS,
        borderBottomRightRadius: RADIUS,
        overflow: 'hidden',
        backgroundColor: c.surface,
      }}
    >
      {/* Light status bar while the photo is under it — only while this
          screen is focused, or it would leak onto the screens pushed on top. */}
      {focused ? <StatusBar style="light" /> : null}

      <ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        // Start on the selected page — otherwise the first frame shows page 0
        // and then jumps (Family opens on YOUR card, not the first member's).
        contentOffset={{ x: index * width, y: 0 }}
        style={{ flex: 1 }}
        scrollEventThrottle={16}
        onScroll={(e) => {
          const x = e.nativeEvent.contentOffset.x
          offsetX.current = x
          const tgt = target.current
          if (tgt !== null && Math.abs(x - tgt * width) < 1) landOn(tgt)
        }}
        onMomentumScrollEnd={(e) => landOn(Math.round(e.nativeEvent.contentOffset.x / width))}
      >
        {items.map((p) => (
          <Pressable
            key={p.id}
            onPress={onPressItem ? () => onPressItem(p.id) : undefined}
            disabled={!onPressItem}
            accessibilityRole={onPressItem ? 'button' : 'image'}
            accessibilityLabel={p.name}
            style={{ width, height: '100%', backgroundColor: p.color }}
          >
            {p.photo ? (
              <Image
                source={{ uri: p.photo }}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
                // Photos are square crops; the hero is wide, so only a band
                // shows. Bias it upward — a centred band cut faces off at the top.
                contentPosition={{ top: '22%' }}
                transition={200}
              />
            ) : (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <Txt style={{ fontFamily: fonts.display, fontSize: 88, lineHeight: 110, color: '#fff' }}>{p.glyph}</Txt>
              </View>
            )}
          </Pressable>
        ))}
      </ScrollView>

      {/* Scrims: dark at the top (status bar + buttons) and the bottom (name). */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: insets.top + 72,
          experimental_backgroundImage: 'linear-gradient(180deg, rgba(0,0,0,0.42), rgba(0,0,0,0))',
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 120,
          experimental_backgroundImage: 'linear-gradient(180deg, rgba(0,0,0,0), rgba(0,0,0,0.55))',
        }}
      />

      {/* Top bar: back (+ add), as glass buttons over the photo. */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          top: insets.top + 6,
          left: 12,
          right: 12,
          flexDirection: 'row',
          justifyContent: 'space-between',
        }}
      >
        <GlassButton onPress={back} label={t('common.back')}>
          <ChevronLeft size={24} color="#fff" />
        </GlassButton>
        {onAdd ? (
          <GlassButton onPress={onAdd} label={addLabel ?? ''}>
            <Plus size={22} color="#fff" />
          </GlassButton>
        ) : null}
      </View>

      {/* Side arrows, each with a tiny avatar of where it leads. */}
      {items.length > 1 ? (
        <Animated.View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            top: insets.top,
            bottom: 0,
            left: 10,
            right: 10,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            opacity: arrowsOpacity,
          }}
        >
          <SideArrow item={prev} dir="prev" onPress={() => go(prev)} label={prev ? t('hero.prev', { name: prev.name }) : ''} />
          <SideArrow item={next} dir="next" onPress={() => go(next)} label={next ? t('hero.next', { name: next.name }) : ''} />
        </Animated.View>
      ) : null}

      {/* Name (+ badge) bottom-left, page dots bottom-right. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 20,
          right: 20,
          bottom: 16,
          flexDirection: 'row',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
          <Animated.Text
            numberOfLines={1}
            style={{
              flexShrink: 1,
              fontFamily: fonts.display,
              fontSize: nameSize,
              color: '#fff',
              textShadowColor: 'rgba(0,0,0,0.35)',
              textShadowRadius: 8,
            }}
          >
            {item?.name ?? ''}
          </Animated.Text>
          {item?.badge ?? null}
        </View>
        {items.length > 1 ? (
          <View style={{ flexDirection: 'row', gap: 5, paddingBottom: 8 }}>
            {items.map((p, i) => (
              <View
                key={p.id}
                style={{
                  width: i === index ? 16 : 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: i === index ? '#fff' : 'rgba(255,255,255,0.5)',
                }}
              />
            ))}
          </View>
        ) : null}
      </View>
    </Animated.View>
  )
}

function GlassButton({ onPress, label, children }: { onPress: () => void; label: string; children: ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: GLASS_BTN,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {children}
    </Pressable>
  )
}

/** A side arrow: chevron + a 24pt avatar of the item it leads to. Renders an
 *  empty slot at the ends so the other arrow keeps its side. */
function SideArrow({
  item,
  dir,
  onPress,
  label,
}: {
  item: HeroItem | null
  dir: 'prev' | 'next'
  onPress: () => void
  label: string
}) {
  if (!item) return <View />
  const avatar = (
    <View
      style={{
        width: 24,
        height: 24,
        borderRadius: 12,
        overflow: 'hidden',
        borderWidth: 1.5,
        borderColor: '#fff',
        backgroundColor: item.color,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {item.photo ? (
        <Image source={{ uri: item.photo }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
      ) : (
        <Txt style={{ fontSize: 12, color: '#fff', fontWeight: '700' }}>{item.glyph}</Txt>
      )}
    </View>
  )
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        padding: 5,
        borderRadius: 20,
        backgroundColor: GLASS_BTN,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {dir === 'prev' ? <ChevronLeft size={20} color="#fff" /> : avatar}
      {dir === 'prev' ? avatar : <ChevronRight size={20} color="#fff" />}
    </Pressable>
  )
}
