// One of today's things on the Hub, styled by WHAT it is (lib/agendaKind):
// its own gradient (AGENDA_GRADIENT), a lucide glyph in a frosted chip, the
// same glyph drawn large and faint in the corner as the card's art, and — when
// we know who it's about — a round avatar of that pet (its photo, else its
// species emoji) or that member (photo, else the initial in their colour).
// Same 236×132 footprint as before so the Home doesn't jump.
//
// Motion is calm and one-shot: the card fades/rises in (staggered by index)
// and the chip glyph settles from a slight tilt — timing curves, no springs,
// and nothing at all under Reduce Motion.
import { useEffect, useState } from 'react'
import { Animated, Easing, Pressable, View } from 'react-native'
import { useReducedMotion } from 'react-native-reanimated'
import { Image } from 'expo-image'
import {
  Briefcase,
  Cake,
  CalendarDays,
  Check,
  Dumbbell,
  GraduationCap,
  Heart,
  PawPrint,
  Pill,
  Plane,
  RefreshCw,
  Scissors,
  Stethoscope,
  Syringe,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react-native'

import { Txt } from '../ui'
import { GradientBox } from './GradientBox'
import type { Gradient } from './palette'
import { MemberAvatar } from '../../apps/location/locationUi'
import { getSignedUrl } from '../../lib/signedUrls'
import type { AgendaIcon } from '../../lib/agendaKind'
import { fonts } from '../../theme/theme'

export const CARD_W = 236
export const CARD_H = 132
const AVATAR = 40
const RING = 'rgba(255,255,255,0.9)'

const ICONS: Record<AgendaIcon, LucideIcon> = {
  paw: PawPrint,
  stethoscope: Stethoscope,
  syringe: Syringe,
  scissors: Scissors,
  pill: Pill,
  cake: Cake,
  heart: Heart,
  renew: RefreshCw,
  school: GraduationCap,
  sport: Dumbbell,
  plane: Plane,
  meal: UtensilsCrossed,
  work: Briefcase,
  calendar: CalendarDays,
}

/** Who the card is about — drawn as a round avatar bottom-right. */
export type AgendaFace =
  | { type: 'pet'; name: string; photoPath: string | null; emoji: string; color: string | null }
  | { type: 'member'; name: string; avatarPath: string | null; color: string }

/** A pet's round photo (signed URL, cached), falling back to its emoji. */
export function PetAvatar({
  photoPath,
  emoji,
  color,
  size = AVATAR,
  ring = true,
}: {
  photoPath: string | null
  emoji: string
  color: string | null
  size?: number
  ring?: boolean
}) {
  // Keyed by path so a changed / removed photo never shows the old one.
  const [signed, setSigned] = useState<{ path: string; url: string | null } | null>(null)
  const url = photoPath && signed?.path === photoPath ? signed.url : null
  useEffect(() => {
    if (!photoPath) return
    let active = true
    getSignedUrl(photoPath).then((u) => {
      if (active) setSigned({ path: photoPath, url: u })
    })
    return () => {
      active = false
    }
  }, [photoPath])
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: ring ? 2 : 0,
        borderColor: RING,
        backgroundColor: color ?? 'rgba(255,255,255,0.25)',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {url ? (
        <Image source={{ uri: url }} style={{ width: size, height: size }} contentFit="cover" transition={160} />
      ) : (
        <Txt style={{ fontSize: size / 2, lineHeight: size * 0.6 }}>{emoji}</Txt>
      )}
    </View>
  )
}

export function AgendaCard({
  colors,
  icon,
  label,
  time,
  title,
  sub,
  face,
  index,
  ended,
  onPress,
}: {
  colors: Gradient
  icon: AgendaIcon
  label: string
  time: string
  title: string
  sub: string
  face: AgendaFace | null
  /** Position in the row — staggers the entrance. */
  index: number
  /** Set when it's already over (2026-11-25, owner): the card fades back and
   *  its time becomes a "✓ Ended" tag — sorted last, it otherwise read as
   *  still to come. The text is the tag. */
  ended?: string
  onPress: () => void
}) {
  const reduce = useReducedMotion()
  const [enter] = useState(() => new Animated.Value(reduce ? 1 : 0))
  const [settle] = useState(() => new Animated.Value(reduce ? 1 : 0))

  useEffect(() => {
    if (reduce) {
      enter.setValue(1)
      settle.setValue(1)
      return
    }
    const anim = Animated.sequence([
      Animated.delay(Math.min(index, 5) * 70),
      Animated.parallel([
        Animated.timing(enter, { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(settle, {
          toValue: 1,
          duration: 640,
          delay: 120,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    ])
    anim.start()
    return () => anim.stop()
    // One-shot on mount; `index` changing later shouldn't replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce])

  const Icon = ICONS[icon]
  const tilt = settle.interpolate({ inputRange: [0, 1], outputRange: ['-14deg', '0deg'] })
  const artTilt = settle.interpolate({ inputRange: [0, 1], outputRange: ['-4deg', '-12deg'] })
  const rise = enter.interpolate({ inputRange: [0, 1], outputRange: [10, 0] })

  return (
    <Animated.View style={{ opacity: enter, transform: [{ translateY: rise }] }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={[label, ended ?? time, title, sub].filter(Boolean).join(', ')}
        style={({ pressed }) => ({ opacity: (ended ? 0.45 : 1) * (pressed ? 0.85 : 1) })}
      >
        <GradientBox
          colors={colors}
          radius={24}
          style={{ width: CARD_W, height: CARD_H, padding: 16, justifyContent: 'space-between' }}
        >
          {/* the card's art: its glyph, large and faint, tucked in the corner */}
          <Animated.View
            pointerEvents="none"
            style={{ position: 'absolute', right: -20, bottom: -24, opacity: 0.16, transform: [{ rotate: artTilt }] }}
          >
            <Icon size={112} color="#fff" strokeWidth={1.4} />
          </Animated.View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Animated.View
              style={{
                width: 26,
                height: 26,
                borderRadius: 13,
                backgroundColor: 'rgba(255,255,255,0.22)',
                alignItems: 'center',
                justifyContent: 'center',
                transform: [{ rotate: tilt }],
              }}
            >
              <Icon size={15} color="#fff" strokeWidth={2.3} />
            </Animated.View>
            <Txt
              style={{ flex: 1, color: 'rgba(255,255,255,0.9)', fontSize: 12.5, fontFamily: fonts.semibold }}
              numberOfLines={1}
            >
              {label}
            </Txt>
            {ended ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingHorizontal: 8,
                  height: 22,
                  borderRadius: 11,
                  backgroundColor: 'rgba(0,0,0,0.22)',
                }}
              >
                <Check size={12} color="#fff" strokeWidth={3} />
                <Txt style={{ color: '#fff', fontSize: 12, fontFamily: fonts.semibold }}>{ended}</Txt>
              </View>
            ) : (
              <Txt
                style={{
                  color: 'rgba(255,255,255,0.95)',
                  fontSize: 12.5,
                  fontFamily: fonts.semibold,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {time}
              </Txt>
            )}
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt style={{ color: '#fff', fontFamily: fonts.display, fontSize: 19, lineHeight: 23 }} numberOfLines={2}>
                {title}
              </Txt>
              {sub ? (
                <Txt style={{ color: 'rgba(255,255,255,0.88)', fontSize: 13, marginTop: 2 }} numberOfLines={1}>
                  {sub}
                </Txt>
              ) : null}
            </View>
            {face?.type === 'pet' ? (
              <PetAvatar photoPath={face.photoPath} emoji={face.emoji} color={face.color} />
            ) : face?.type === 'member' ? (
              <MemberAvatar
                name={face.name}
                avatarPath={face.avatarPath}
                color={face.color}
                size={AVATAR}
                ringColor={RING}
              />
            ) : null}
          </View>
        </GradientBox>
      </Pressable>
    </Animated.View>
  )
}
