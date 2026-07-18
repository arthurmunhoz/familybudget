// Map style for Whereabouts — plain map, satellite or terrain.
//
// Laid out like Settings' Appearance picker: a row of bordered option cards,
// each SHOWING what it does, with a check under the chosen one. A list of three
// words couldn't tell you what "terrain" would actually look like.
//
// The previews are real Mapbox static images of the area you're looking at, so
// you're choosing between pictures of YOUR neighbourhood rather than three
// generic swatches. That's the one thing a hand-drawn mock (which is what the
// Appearance picker uses, because a colour scheme IS its colours) can't do for a
// map style.
import { useState } from 'react'
import { Modal, Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { Check, X } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'
import { fonts, radius, sp, useTheme } from '@/theme/theme'
import type { MapMode } from './mapMode'

const TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? ''

/** Mapbox style ids for the thumbnails — the same styles resolveStyleURL picks,
 *  minus the mapbox:// prefix that the static endpoint doesn't take. `standard`
 *  previews as the light street map rather than the household's custom Studio
 *  style: a custom style isn't guaranteed to be public, and a 404 tile would be
 *  a worse preview than a representative one. */
const PREVIEW_STYLE: Record<MapMode, string> = {
  standard: 'streets-v11',
  satellite: 'satellite-streets-v11',
  terrain: 'outdoors-v11',
}

const MODES: { mode: MapMode; label: TKey }[] = [
  { mode: 'standard', label: 'location.mapMode.standard' },
  { mode: 'satellite', label: 'location.mapMode.satellite' },
  { mode: 'terrain', label: 'location.mapMode.terrain' },
]

const PREVIEW_ZOOM = 14

function previewUrl(mode: MapMode, center: { lat: number; lng: number } | null): string | null {
  if (!TOKEN || !center) return null
  const { lat, lng } = center
  return (
    `https://api.mapbox.com/styles/v1/mapbox/${PREVIEW_STYLE[mode]}/static/` +
    `${lng.toFixed(5)},${lat.toFixed(5)},${PREVIEW_ZOOM},0/240x150@2x` +
    // Attribution is printed under the row instead: baked into a 120pt-wide
    // thumbnail it's illegible, which serves nobody. Mapbox allows this exactly
    // when the credit appears elsewhere in the UI.
    `?access_token=${TOKEN}&logo=false&attribution=false`
  )
}

/** One style as a tile that shows itself. Mirrors Settings' OptionCard. */
function ModeCard({
  label,
  url,
  selected,
  onPress,
}: {
  label: string
  url: string | null
  selected: boolean
  onPress: () => void
}) {
  const { c } = useTheme()
  const [failed, setFailed] = useState(false)
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={{
        flex: 1,
        gap: 6,
        padding: 6,
        borderRadius: radius.md + 2,
        borderWidth: 2,
        borderColor: selected ? c.accent : c.border,
        backgroundColor: c.card,
      }}
    >
      {/* The surface underneath doubles as the fallback: no token, no fix yet,
          or simply offline, and the tile is a calm blank rather than a hole. */}
      <View
        style={{
          height: 74,
          borderRadius: 10,
          backgroundColor: c.surface,
          overflow: 'hidden',
        }}
      >
        {url && !failed ? (
          <Image
            source={{ uri: url }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            transition={140}
            cachePolicy="memory-disk"
            onError={() => setFailed(true)}
          />
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
        {selected ? <Check size={14} color={c.accent} strokeWidth={3} /> : null}
        <Txt
          variant={selected ? 'body' : 'muted'}
          style={{ fontSize: 13, fontFamily: selected ? fonts.semibold : fonts.body }}
          numberOfLines={1}
        >
          {label}
        </Txt>
      </View>
    </Pressable>
  )
}

export function MapModePicker({
  mode,
  center,
  onPick,
  onClose,
}: {
  mode: MapMode
  /** Where to render the previews — the map's own centre, so you're comparing
   *  styles on ground you recognise. */
  center: { lat: number; lng: number } | null
  onPick: (mode: MapMode) => void
  onClose: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const insets = useSafeAreaInsets()

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' }}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('common.cancel')} />
        <View
          style={{
            backgroundColor: c.sheet,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            padding: sp.lg,
            paddingBottom: insets.bottom + sp.lg,
            gap: sp.md,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
            <Txt style={{ flex: 1, fontFamily: fonts.displaySemi, fontSize: 20, color: c.text }} numberOfLines={1}>
              {t('location.mapMode.title')}
            </Txt>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.close')}>
              <X size={20} color={c.textMuted} />
            </Pressable>
          </View>

          <View style={{ flexDirection: 'row', gap: sp.sm }}>
            {MODES.map((m) => (
              <ModeCard
                key={m.mode}
                label={t(m.label)}
                url={previewUrl(m.mode, center)}
                selected={m.mode === mode}
                onPress={() => {
                  onPick(m.mode)
                  onClose()
                }}
              />
            ))}
          </View>

          {/* Required because the thumbnails themselves carry no credit. */}
          <Txt variant="faint" style={{ fontSize: 10, textAlign: 'center' }}>
            {t('location.mapMode.credit')}
          </Txt>
        </View>
      </View>
    </Modal>
  )
}
