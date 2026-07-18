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
import { LocateFixed, MapPin, Search, Trash2, X } from 'lucide-react-native'

import { Btn, Field, Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { useKeyboardHeight } from '@/hooks/useKeyboardHeight'
import { formatDistance, nearestPreset, radiusPresets } from '@/lib/location'
import { searchPlaces, type PlaceSuggestion } from '@/lib/placeSearch'
import { createPlace, deletePlace, removePlaceWatch, updatePlace, upsertPlaceWatch } from '@/lib/places'
import type { Place, PlaceWatch, Profile } from '@/lib/types'
import { fonts, radius as R, sp, useTheme } from '@/theme/theme'
import { Section } from './locationUi'

/** Both inputs on the icon+name row are pinned to this height. `Field` sizes
 *  itself from its fontSize, so the icon input's 22pt emoji made it visibly
 *  TALLER than the name beside it — fixing the height decouples the two. */
const FIELD_H = 46

/** Full-width action inside a Section — reads as part of the group rather than
 *  as a stray link under it. */
function SectionAction({
  icon,
  label,
  onPress,
}: {
  icon: React.ReactNode
  label: string
  onPress: () => void
}) {
  const { c } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 7,
          backgroundColor: c.accentSoft,
          borderRadius: R.md,
          paddingVertical: 11,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      {icon}
      <Txt style={{ fontFamily: fonts.semibold, fontSize: 13, color: c.accent }} numberOfLines={1}>
        {label}
      </Txt>
    </Pressable>
  )
}

/** One labelled switch inside a Section. */
function ToggleRow({
  label,
  value,
  onValueChange,
}: {
  label: string
  value: boolean
  onValueChange: (v: boolean) => void
}) {
  const { c } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: sp.md }}>
      <Txt style={{ fontFamily: fonts.medium, fontSize: 14, color: c.text, flex: 1 }}>{label}</Txt>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ true: c.accent, false: c.surface2 }}
        thumbColor="#ffffff"
      />
    </View>
  )
}

function Divider() {
  const { c } = useTheme()
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />
}

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
  // Where "near me" means for search. Deliberately SEPARATE from `coords`:
  // picking a result moves the pin, and if search biased off the pin then the
  // next search would be anchored to wherever you last tapped instead of to you.
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(
    place ? { lat: place.lat, lng: place.lng } : null,
  )
  const [locating, setLocating] = useState(false)
  const [busy, setBusy] = useState(false)

  // Search-by-name, so you can save "LA Fitness" without driving to it.
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PlaceSuggestion[]>([])
  const [searching, setSearching] = useState(false)
  /** A place chosen from search. Non-null hides the search box and shows a ✕. */
  const [picked, setPicked] = useState<PlaceSuggestion | null>(null)
  /** Street address of an EXISTING place's saved coordinates. Without this the
   *  form fell back to "Your current location" while editing, which was simply
   *  untrue — it described where the phone is, not where the place is. */
  const [savedLabel, setSavedLabel] = useState<string | null>(null)
  /** Still showing the place's ORIGINAL saved spot. Goes false the moment they
   *  pick, re-pin or remove — `savedLabel` describes that original spot, so
   *  leaving it on screen afterwards would describe the old location while
   *  saving the new one. */
  const [usingSaved, setUsingSaved] = useState(!!place)
  /** A named place is chosen — searched, or the saved one we're editing. Drives
   *  the whole Location section: bin instead of search, and different wording on
   *  the current-location action. */
  const hasPlace = !!picked || usingSaved

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
      void searchPlaces(q, origin)
        .then(setResults)
        .finally(() => setSearching(false))
    }, 350)
    return () => clearTimeout(id)
    // `origin` IS a dependency on purpose: it arrives asynchronously (GPS), so a
    // query typed before the fix lands would otherwise be stuck with the
    // unbiased, nationwide results it was first issued with. It only ever
    // transitions null → a fix, so this re-runs once, not on every pin change.
  }, [query, origin])

  const choose = (r: PlaceSuggestion) => {
    setCoords({ lat: r.lat, lng: r.lng })
    setPicked(r)
    setUsingSaved(false)
    // Only prefill the name if they haven't titled it themselves.
    if (!name.trim()) setName(r.name)
    setQuery('')
    setResults([])
  }

  /** Bin the chosen place outright, leaving the form with NO location — the
   *  search box comes back and Save stays disabled until they pick something.
   *  Deliberately not an undo: a trash icon that quietly restored a previous
   *  spot would be lying about what it does. */
  const clearPlace = () => {
    setPicked(null)
    setUsingSaved(false)
    setCoords(null)
  }

  // An existing place's coordinates mean nothing on screen, so turn them into a
  // street address. This describes the place's ORIGINAL spot; whether it's the
  // one on show is decided at render, not here.
  useEffect(() => {
    if (!place) return
    let active = true
    Location.reverseGeocodeAsync({ latitude: place.lat, longitude: place.lng })
      .then((res) => {
        if (!active) return
        const a = res[0]
        if (!a) return
        const line = [a.name || a.street, a.city].filter(Boolean).join(', ')
        if (line) setSavedLabel(line)
      })
      .catch(() => {
        // no geocoder / no permission — the section falls back to "Saved location"
      })
    return () => {
      active = false
    }
  }, [place])

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
        if (active) {
          const here = { lat: pos.coords.latitude, lng: pos.coords.longitude }
          setCoords(here)
          setOrigin(here) // now search can rank by "closest to me"
        }
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
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude }
      setCoords(here)
      setOrigin(here)
      setPicked(null) // back to "your current location"
      setUsingSaved(false)
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
          {/* Title + an explicit way out. Tapping the backdrop already closed
              the sheet, but that isn't discoverable on a form this tall. */}
          <View
            style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginBottom: sp.sm }}
          >
            <Txt style={{ flex: 1, fontFamily: fonts.displaySemi, fontSize: 22, color: c.text }}>
              {place ? t('location.places.edit') : t('location.places.new')}
            </Txt>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
            >
              <X size={20} color={c.textMuted} />
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }} contentContainerStyle={{ gap: sp.lg }}>
            <Section title={t('location.places.details')}>
              {/* Icon + name. Both inputs are pinned to FIELD_H so the emoji's
                  larger type can't make its box taller than the name's. */}
              <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'flex-end' }}>
                <View style={{ width: 68 }}>
                  <Field
                    label={t('location.places.icon')}
                    value={icon}
                    onChangeText={setIcon}
                    maxLength={2}
                    style={{
                      textAlign: 'center',
                      fontSize: 22,
                      height: FIELD_H,
                      paddingVertical: 0,
                      // iOS centres a single line in a fixed height; Android needs telling.
                      textAlignVertical: 'center',
                    }}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Field
                    label={t('location.places.name')}
                    value={name}
                    onChangeText={setName}
                    placeholder={t('location.places.namePlaceholder')}
                    autoCapitalize="words"
                    style={{ height: FIELD_H, paddingVertical: 0, textAlignVertical: 'center' }}
                  />
                </View>
              </View>

              <Divider />

              {/* Radius presets */}
              <View style={{ gap: 8 }}>
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
                          backgroundColor: on ? c.accent : c.surface2,
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
            </Section>


            <Section title={t('location.places.location')}>
              {/* ONE unambiguous statement of where this place is:
                    - a chosen place  → its address (searched, or the saved one
                      we're editing), with a bin to remove it
                    - otherwise       → your current location, or nothing yet  */}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  backgroundColor: c.surface2,
                  borderRadius: R.md,
                  paddingVertical: 10,
                  paddingHorizontal: sp.md,
                }}
              >
                <MapPin size={16} color={hasPlace || coords ? c.accent : c.textFaint} />
                <Txt style={{ flex: 1, fontSize: 13, color: c.text }} numberOfLines={2}>
                  {locating
                    ? t('location.locating')
                    : picked
                      ? picked.address || picked.name
                      : usingSaved
                        ? (savedLabel ?? t('location.places.savedLocation'))
                        : coords
                          ? t('location.places.currentLocation')
                          : t('location.places.noLocation')}
                </Txt>
                {hasPlace ? (
                  <Pressable
                    onPress={clearPlace}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={t('location.places.clearLocation')}
                  >
                    <Trash2 size={16} color={c.expense} />
                  </Pressable>
                ) : null}
              </View>

              {/* Search is offered only when no place is chosen — once one is,
                  the bin above is the way to change it. */}
              {hasPlace ? null : (
                <>
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
                      backgroundColor: c.surface2,
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
                  {/* How far it is from you — the list is sorted by this, so it
                      also explains the ordering rather than leaving it a mystery. */}
                  {r.distanceM != null ? (
                    <Txt
                      style={{ fontFamily: fonts.semibold, fontSize: 12, color: c.textMuted }}
                      numberOfLines={1}
                    >
                      {formatDistance(r.distanceM)}
                    </Txt>
                  ) : null}
                </Pressable>
              ))}
              {query.trim().length >= 3 && !searching && !results.length ? (
                <Txt variant="faint" style={{ fontSize: 12 }}>
                  {t('location.places.noResults')}
                </Txt>
              ) : null}
                </>
              )}

              {/* Pin to where I'm standing. Hidden in the one case where it
                  would change nothing — no place chosen and we're ALREADY on the
                  current location — so it never reads as a description of the
                  state instead of an action. The wording says which it is: it
                  SWITCHES away from a chosen place, or sets one when there's
                  none. */}
              {hasPlace || !coords ? (
                <SectionAction
                  icon={<LocateFixed size={15} color={c.accent} />}
                  label={
                    hasPlace
                      ? t('location.places.switchToCurrent')
                      : t('location.places.useMyLocation')
                  }
                  onPress={repin}
                />
              ) : null}
            </Section>

            {/* MY notifications. The place is shared with the household; this
                subscription is personal — saving a place signs up nobody else. */}
            <Section title={t('location.places.notify')}>
              <ToggleRow
                label={t('location.places.watchTitle')}
                value={watchOn}
                onValueChange={setWatchOn}
              />
              {watchOn ? (
                <>
                  <Divider />
                  <ToggleRow
                    label={t('location.places.notifyArrivals')}
                    value={arrivals}
                    onValueChange={setArrivals}
                  />
                  <Divider />
                  <ToggleRow
                    label={t('location.places.notifyDepartures')}
                    value={departures}
                    onValueChange={setDepartures}
                  />
                  <Divider />
                  {/* Whose crossings I care about. None picked = everyone. */}
                  <View style={{ gap: 8 }}>
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
            </Section>
          </ScrollView>

          <Btn title={t('common.save')} onPress={save} disabled={!coords || !name.trim()} loading={busy} />
          {place ? <Btn title={t('location.places.delete')} variant="ghost" onPress={remove} /> : null}
        </View>
      </View>
    </Modal>
  )
}
