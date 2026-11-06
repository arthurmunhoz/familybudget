// The luggage tag artwork. It's PRINTED, so every colour here is fixed (paper
// white, ink text) instead of coming from the theme — a dark-mode tag would
// print as a black slab. Everything is laid out on a 300-wide design grid and
// scaled by `width`, so the preview and the 300 dpi snapshot are the same
// drawing at two sizes.
import { StyleSheet, Text, View } from 'react-native'
import { Plane } from 'lucide-react-native'
import * as Localization from 'expo-localization'

import { formatPhone } from '@/lib/phone'

import { pickOn } from '@/theme/contrast'
import { fonts } from '@/theme/theme'

import type { PrintableCardProps } from './templates'

const W = 300
const RATIO = 4.75 / 2.75
const INK = '#1B1A18'
const MUTED = '#8A8580'

export function LuggageTagCard({ values, color, width, label }: PrintableCardProps) {
  const s = width / W
  const on = pickOn(color)
  const v = (k: string) => (values[k] ?? '').trim()

  const rows: { key: string; lines: number }[] = [
    { key: 'phone', lines: 1 },
    { key: 'email', lines: 1 },
    { key: 'address', lines: 3 },
    { key: 'destination', lines: 2 },
    { key: 'flight', lines: 1 },
  ].filter((r) => v(r.key))

  return (
    <View
      collapsable={false}
      style={{
        width,
        height: width * RATIO,
        backgroundColor: '#FFFFFF',
        borderRadius: 18 * s,
        overflow: 'hidden',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: '#E4DED6',
      }}
    >
      <View style={{ backgroundColor: color, height: 128 * s, alignItems: 'center', paddingTop: 18 * s }}>
        {/* Punch guide */}
        <View
          style={{
            width: 30 * s,
            height: 30 * s,
            borderRadius: 15 * s,
            backgroundColor: '#FFFFFF',
            borderWidth: 2 * s,
            borderColor: on === '#FFFFFF' ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.25)',
          }}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 * s, marginTop: 20 * s }}>
          <Plane size={20 * s} color={on} strokeWidth={2.2} />
          <Text
            style={{
              color: on,
              fontFamily: fonts.display,
              fontSize: 15 * s,
              letterSpacing: 1.8 * s,
              textTransform: 'uppercase',
            }}
          >
            {label('tag.heading')}
          </Text>
        </View>
      </View>

      <View style={{ flex: 1, paddingHorizontal: 22 * s, paddingTop: 18 * s }}>
        <Text style={labelStyle(s)}>{label('tag.name')}</Text>
        <Text
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
          style={{ color: INK, fontFamily: fonts.display, fontSize: 26 * s, lineHeight: 30 * s, marginTop: 2 * s }}
        >
          {v('name') || ' '}
        </Text>
        <View style={{ height: 2 * s, backgroundColor: color, width: 44 * s, marginVertical: 12 * s, borderRadius: s }} />
        <View style={{ gap: 10 * s }}>
          {rows.map((r) => (
            <View key={r.key}>
              <Text style={labelStyle(s)}>{label(`tag.${r.key}` as Parameters<typeof label>[0])}</Text>
              <Text
                numberOfLines={r.lines}
                style={{ color: INK, fontFamily: fonts.medium, fontSize: 14 * s, lineHeight: 18 * s, marginTop: 1 * s }}
              >
                {/* Always printed formatted, with its +country code: whoever finds
                    the bag may be dialling from another country. */}
                {r.key === 'phone' ? formatPhone(v('phone'), Localization.getLocales()[0]?.regionCode ?? null) : v(r.key)}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <View style={{ paddingHorizontal: 22 * s, paddingBottom: 16 * s }}>
        <Text style={{ color: MUTED, fontFamily: fonts.body, fontSize: 10 * s, lineHeight: 13 * s, textAlign: 'center' }}>
          {label('tag.ifFound')}
        </Text>
      </View>
    </View>
  )
}

const labelStyle = (s: number) => ({
  color: MUTED,
  fontFamily: fonts.semibold,
  fontSize: 8.5 * s,
  letterSpacing: 1.2 * s,
  textTransform: 'uppercase' as const,
})
