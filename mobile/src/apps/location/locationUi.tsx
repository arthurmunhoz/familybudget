// Shared bits for the Whereabouts screens: a stable per-member color, a ringed
// avatar (photo or initials) used both as a map pin and in lists, a small
// battery chip, and a localized "time ago" helper.
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { Image } from 'expo-image'

import { getSignedUrl } from '@/lib/signedUrls'
import { fonts, useTheme } from '@/theme/theme'
import { Txt } from '@/components/ui'
import type { TKey } from '@/lib/i18n'

// Distinct, warm-leaning member colors that read on both Paper and Dusk.
export const MEMBER_PALETTE = [
  '#c2603f', // clay (brand)
  '#4f7fa6', // steel blue
  '#3f9a84', // teal
  '#c68a2b', // amber
  '#97688b', // plum
  '#5f9e4d', // moss
  '#b5524e', // rust
  '#3f7fa0', // ocean
] as const

/** Assign each email a stable color by its position in the sorted member list,
 *  so a household's colors don't reshuffle between renders. */
export function buildMemberColors(emails: string[]): Record<string, string> {
  const sorted = [...emails].sort()
  const out: Record<string, string> = {}
  sorted.forEach((e, i) => {
    out[e] = MEMBER_PALETTE[i % MEMBER_PALETTE.length]
  })
  return out
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Round avatar with a colored identity: the member's photo when set, else their
 *  initials on their color. `ring` adds a card-colored border so a pin reads
 *  clearly on top of the map. */
export function MemberAvatar({
  name,
  avatarPath,
  color,
  size = 44,
  ring = true,
}: {
  name: string
  avatarPath?: string | null
  color: string
  size?: number
  ring?: boolean
}) {
  const { c } = useTheme()
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    if (!avatarPath) {
      setUrl(null)
      return
    }
    getSignedUrl(avatarPath).then((u) => {
      if (active) setUrl(u)
    })
    return () => {
      active = false
    }
  }, [avatarPath])

  const border = ring ? Math.max(2, Math.round(size * 0.07)) : 0
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        borderWidth: border,
        borderColor: c.card,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {url ? (
        <Image source={{ uri: url }} style={{ width: size, height: size }} contentFit="cover" transition={120} />
      ) : (
        <Txt style={{ fontFamily: fonts.semibold, color: '#ffffff', fontSize: size * 0.4 }}>
          {initials(name)}
        </Txt>
      )}
    </View>
  )
}

/** Small battery gauge + percentage; green / amber / red by level. */
export function BatteryChip({ level }: { level: number }) {
  const { c } = useTheme()
  const color = level <= 15 ? c.expense : level <= 30 ? '#c8862a' : c.income
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <View
        style={{
          width: 20,
          height: 11,
          borderWidth: 1.5,
          borderColor: color,
          borderRadius: 3,
          padding: 1.5,
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            height: '100%',
            width: `${Math.max(6, Math.min(100, level))}%`,
            backgroundColor: color,
            borderRadius: 1,
          }}
        />
      </View>
      <Txt style={{ fontFamily: fonts.semibold, fontSize: 11, color: c.textMuted }}>{level}%</Txt>
    </View>
  )
}

/** Localized relative time from an ISO timestamp, e.g. "just now", "5 min ago". */
export function timeAgo(iso: string, t: (key: TKey, vars?: Record<string, string | number>) => string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return t('location.ago.now')
  const mins = Math.floor(secs / 60)
  if (mins < 60) return t('location.ago.min', { count: mins })
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return t('location.ago.hr', { count: hrs })
  return t('location.ago.day', { count: Math.floor(hrs / 24) })
}
