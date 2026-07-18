// Add or edit a saved place. Two ways to set the spot: SEARCH it by name
// ("LA Fitness", "Tampa Elementary" — see lib/placeSearch.ts), or fall back to
// your current location. A new place defaults to where you are so the common
// "save my home" case is one tap, but you never have to travel to a place to
// save it. Radius is a small preset set: iOS enforces a ~100 m floor on
// geofences, so finer-grained control would be a lie.
import { useEffect, useMemo, useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Location from 'expo-location'
import { MapPin, Search } from 'lucide-react-native'

import { Btn, Field, Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { useKeyboardHeight } from '@/hooks/useKeyboardHeight'
import { nearestPreset, radiusPresets } from '@/lib/location'
import { searchPlaces, type PlaceSuggestion } from '@/lib/placeSearch'
import { createPlace, deletePlace, removePlaceWatch, updatePlace, upsertPlaceWatch } from '@/lib/places'
import type { Place, PlaceWatch, Profile } from '@/lib/types'
import { fonts, radius as R, sp, useTheme } from '@/theme/theme'

/** Small selectable pill (used for "whose crossings" in the watch section). */
function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const { c } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          paddingVertical: 7,
          paddingHorizontal: 13,
          borderRadius: R.pill,
          backgroundColor: on ? c.accent : c.sheet,
        },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Txt style={{ fontFamily: fonts.semibold, fontSize: 13, color: on ? '#fff' : c.text }}>
        {label}
      </Txt>
    </Pressable>
  )
}

export function PlaceForm({
  place,
  profiles,
  myEmail,
  watch,
  onClose,
  onSaved,
}: {
  /** null = creating a new place */
  place: Place | null
  profiles: Profile[]
  myEmail: string | null
  /** MY existing subscription to this place, if any. */
  watch: PlaceWatch | null
  onClose: () => void
  onSaved: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const insets = useSafeAreaInsets()
  const kb = useKeyboardHeight()

  const [icon, setIcon] = useState(place?.icon ?? '📍')
  const [name, setName] = useState(place?.name ?? '')
  // Familiar radii in the user's own units. Floor at 100 m — iOS geofences can't
  // reliably go smaller, so offering "250 ft" here would be a promise we can't keep.
  const presets = useMemo(() => radiusPresets(100), [])
  const [radiusM, setRadiusM] = useState(place?.radius_m ?? presets[0]?.meters ?? 150)
  const selectedRadius = nearestPreset(presets, radiusM)
  // MY notification settings for this place — personal, not part of the place.
  const [watchOn, setWatchOn] = useState(!!watch)
  const [watchedPicked, setWatchedPicked] = useState<string[]>(watch?.watched ?? [])
  const [arrivals, setArrivals] = useState(watch?.notify_arrivals ?? true)
  const [departures, setDepartures] = useState(watch?.notify_departures ?? false)
  const others = useMemo(() => profiles.filter((p) => p.email !== myEmail), [profiles, myEmail])
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    place ? { lat: place.lat, lng: place.lng } : null,
  )
  const [locating, setLocating] = useState(false)
  const [busy, setBusy] = useState(false)

  // Search-by-name, so you can save "LA Fitness" without driving to it.
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PlaceSuggestion[]>([])
  const [searching, setSearching] = useState(false)
  /** Address of a searched place we pinned to (vs "your current location"). */
  const [pinnedLabel, setPinnedLabel] = useState<string | null>(null)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 3) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    // Debounced: one request after typing settles, not one per keystroke.
    const id = setTimeout(() => {
      void searchPlaces(q, coords)
        .then(setResults)
        .finally(() => setSearching(false))
    }, 350)
    return () => clearTimeout(id)
    // `coords` only biases results toward you — re-searching when the pin moves
    // would fight the user mid-type.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const choose = (r: PlaceSuggestion) => {
    setCoords({ lat: r.lat, lng: r.lng })
    setPinnedLabel(r.address || r.name)
    // Only prefill the name if they haven't titled it themselves.
    if (!name.trim()) setName(r.name)
    setQuery('')
    setResults([])
  }

  // A brand new place pins to where you are right now.
  useEffect(() => {
    if (place) return
    let active = true
    setLocating(true)
    void (async () => {
      try {
        const current = await Location.getForegroundPermissionsAsync()
        const granted =
          current.granted || (await Location.requestForegroundPermissionsAsync()).granted
        if (!granted) return
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        })
        if (active) setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      } catch {
        // leave coords null → Save stays disabled with a hint
      } finally {
        if (active) setLocating(false)
      }
    })()
    return () => {
      active = false
    }
  }, [place])

  const repin = async () => {
    setLocating(true)
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      setPinnedLabel(null) // back to "your current location"
    } catch {
      // keep the previously saved spot
    } finally {
      setLocating(false)
    }
  }

  const save = async () => {
    if (!coords || !name.trim() || busy) return
    setBusy(true)
    try {
      const input = {
        name: name.trim(),
        icon: icon.trim() || '📍',
        lat: coords.lat,
        lng: coords.lng,
        radius_m: radiusM,
      }
      let id = place?.id ?? null
      if (place) await updatePlace(place.id, input)
      else id = await createPlace(input)
      // The place is shared; the subscription is mine alone.
      if (id) {
        if (watchOn) {
          await upsertPlaceWatch(id, {
            watched: watchedPicked,
            notify_arrivals: arrivals,
            notify_departures: departures,
          })
        } else {
          await removePlaceWatch(id)
        }
      }
      onSaved()
    } catch {
      Alert.alert(t('location.places.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const remove = () => {
    if (!place) return
    Alert.alert(t('location.places.delete'), t('location.places.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('location.places.delete'),
        style: 'destructive',
        onPress: () => {
          void deletePlace(place.id)
            .catch(() => {})
            .then(onSaved)
        },
      },
    ])
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' }}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('common.cancel')} />
        <View
          style={{
            // c.sheet, not c.card — the glass skin's card is translucent.
            backgroundColor: c.sheet,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            padding: sp.lg,
            // Lift the WHOLE drawer by the keyboard height. While the keyboard is
            // up the home-indicator inset sits behind it, so don't pad twice.
            paddingBottom: (kb > 0 ? 0 : insets.bottom) + sp.lg,
            marginBottom: kb,
            gap: sp.md,
            maxHeight: '88%',
          }}
        >
          <Txt style={{ fontFamily: fonts.displaySemi, fontSize: 22, color: c.text }}>
            {place ? t('location.places.edit') : t('location.places.new')}
          </Txt>

          <ScrollView keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }} contentContainerStyle={{ gap: sp.md }}>
            {/* Icon + name */}
            <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'flex-end' }}>
              <View style={{ width: 74 }}>
                <Field label={t('location.places.icon')} value={icon} onChangeText={setIcon} maxLength={2} style={{ textAlign: 'center', fontSize: 22 }} />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label={t('location.places.name')}
                  value={name}
                  onChangeText={setName}
                  placeholder={t('location.places.namePlaceholder')}
                  autoCapitalize="words"
                />
              </View>
            </View>

            {/* Radius presets */}
            <View style={{ gap: 6 }}>
              <Txt variant="label">{t('location.places.radius')}</Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                {presets.map((p) => {
                  const on = selectedRadius === p.meters
                  return (
                    <Pressable
                      key={p.meters}
                      onPress={() => setRadiusM(p.meters)}
                      style={{
                        paddingVertical: 8,
                        paddingHorizontal: 14,
                        borderRadius: R.pill,
                        backgroundColor: on ? c.accent : c.surface,
                      }}
                    >
                      <Txt style={{ fontFamily: fonts.semibold, fontSize: 13, color: on ? '#fff' : c.text }}>
                        {p.label}
                      </Txt>
                    </Pressable>
                  )
                })}
              </View>
            </View>

            {/* MY notifications. The place is shared with the household; this
                subscription is personal — saving a place signs up nobody else. */}
            <View style={{ backgroundColor: c.surface, borderRadius: R.md, paddingHorizontal: sp.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 11 }}>
                <Txt style={{ fontFamily: fonts.medium, fontSize: 15, color: c.text, flex: 1 }}>
                  {t('location.places.watchTitle')}
                </Txt>
                <Switch value={watchOn} onValueChange={setWatchOn} trackColor={{ true: c.accent, false: c.surface2 }} thumbColor="#ffffff" />
              </View>

              {watchOn ? (
                <>
                  <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 11 }}>
                    <Txt style={{ fontFamily: fonts.medium, fontSize: 15, color: c.text, flex: 1 }}>
                      {t('location.places.notifyArrivals')}
                    </Txt>
                    <Switch value={arrivals} onValueChange={setArrivals} trackColor={{ true: c.accent, false: c.surface2 }} thumbColor="#ffffff" />
                  </View>
                  <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 11 }}>
                    <Txt style={{ fontFamily: fonts.medium, fontSize: 15, color: c.text, flex: 1 }}>
                      {t('location.places.notifyDepartures')}
                    </Txt>
                    <Switch value={departures} onValueChange={setDepartures} trackColor={{ true: c.accent, false: c.surface2 }} thumbColor="#ffffff" />
                  </View>
                  <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />
                  {/* Whose crossings I care about. None picked = everyone. */}
                  <View style={{ paddingVertical: 11, gap: 8 }}>
                    <Txt variant="label">{t('location.places.watchWho')}</Txt>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                      <Chip
                        label={t('location.places.watchAll')}
                        on={watchedPicked.length === 0}
                        onPress={() => setWatchedPicked([])}
                      />
                      {others.map((p) => (
                        <Chip
                          key={p.email}
                          label={p.display_name}
                          on={watchedPicked.includes(p.email)}
                          onPress={() =>
                            setWatchedPicked((cur) =>
                              cur.includes(p.email)
                                ? cur.filter((e) => e !== p.email)
                                : [...cur, p.email],
                            )
                          }
                        />
                      ))}
                    </View>
                  </View>
                </>
              ) : null}
            </View>

            {/* Find it by name — you shouldn't have to stand in a place to save it */}
            <View style={{ gap: 6 }}>
              <Field
                label={t('location.places.search')}
                value={query}
                onChangeText={setQuery}
                placeholder={t('location.places.searchPlaceholder')}
                autoCapitalize="words"
                autoCorrect={false}
              />
              {searching ? (
                <Txt variant="faint" style={{ fontSize: 12 }}>
                  {t('location.places.searching')}
                </Txt>
              ) : null}
              {results.map((r) => (
                <Pressable
                  key={r.id}
                  onPress={() => choose(r)}
                  style={({ pressed }) => [
                    {
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: sp.sm,
                      backgroundColor: c.surface,
                      borderRadius: R.md,
                      padding: sp.md,
                    },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Search size={15} color={c.textMuted} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt style={{ fontFamily: fonts.semibold, fontSize: 14, color: c.text }} numberOfLines={1}>
                      {r.name}
                    </Txt>
                    {r.address ? (
                      <Txt variant="faint" style={{ fontSize: 11 }} numberOfLines={1}>
                        {r.address}
                      </Txt>
                    ) : null}
                  </View>
                </Pressable>
              ))}
              {query.trim().length >= 3 && !searching && !results.length ? (
                <Txt variant="faint" style={{ fontSize: 12 }}>
                  {t('location.places.noResults')}
                </Txt>
              ) : null}
            </View>

            {/* Location — ONE unambiguous statement of where this place is.
                Picking a search result replaces it outright. The "use my
                location" action only appears when it's genuinely an ALTERNATIVE
                to what's selected, so it can never be misread as the state. */}
            <View style={{ gap: 6 }}>
              <Txt variant="label">{t('location.places.location')}</Txt>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  backgroundColor: c.surface,
                  borderRadius: R.md,
                  padding: sp.md,
                }}
              >
                <MapPin size={16} color={c.accent} />
                <Txt style={{ flex: 1, fontSize: 13, color: c.text }} numberOfLines={2}>
                  {locating
                    ? t('location.locating')
                    : pinnedLabel
                      ? pinnedLabel
                      : coords
                        ? t('location.places.currentLocation')
                        : t('location.places.needLocation')}
                </Txt>
              </View>
              {pinnedLabel ? (
                <Pressable onPress={repin} hitSlop={6}>
                  <Txt style={{ fontFamily: fonts.semibold, fontSize: 13, color: c.accent }}>
                    {t('location.places.useMyLocation')}
                  </Txt>
                </Pressable>
              ) : null}
            </View>
          </ScrollView>

          <Btn title={t('common.save')} onPress={save} disabled={!coords || !name.trim()} loading={busy} />
          {place ? <Btn title={t('location.places.delete')} variant="ghost" onPress={remove} /> : null}
        </View>
      </View>
    </Modal>
  )
}
