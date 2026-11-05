// Add or edit a saved place. Two ways to set the spot: SEARCH it by name
// ("LA Fitness", "Tampa Elementary" — see lib/placeSearch.ts), or fall back to
// your current location. A new place defaults to where you are so the common
// "save my home" case is one tap, but you never have to travel to a place to
// save it. Radius is a small preset set: iOS enforces a ~100 m floor on
// geofences, so finer-grained control would be a lie.
//
// 2026-11 redesign (components/form): grouped rows instead of labelled boxes.
// Icon + name share one row, the radius presets are a SelectRow instead of a
// chip wall, the notify options are ToggleRows, and "whose comings and goings"
// is a multi-select row whose checked list opens in a nested sheet.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Modal, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { Pressable } from '@/components/Pressable'
import * as Location from 'expo-location'
import { router } from 'expo-router'
import { Check, ChevronsUpDown, LocateFixed, MapPin, Search, Trash2, X } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { KeyboardScroll, useRevealOnFocus } from '@/components/KeyboardScroll'
import { FormRow, FormSection, RowValue, SelectRow, ToggleRow } from '@/components/form'
import { useI18n } from '@/hooks/useI18n'
import { useSheetLift } from '@/hooks/useSheetLift'
import { formatDistance, nearestPreset, radiusPresets } from '@/lib/location'
import { searchPlaces, type PlaceSuggestion } from '@/lib/placeSearch'
import {
  createPlace,
  deletePlace,
  PLACE_LIMIT_ERROR,
  removePlaceWatch,
  updatePlace,
  upsertPlaceWatch,
} from '@/lib/places'
import type { Place, PlaceWatch, Profile } from '@/lib/types'
import { useBottomGap } from '@/hooks/useBottomGap'
import { fonts, radius as R, sp, useTheme } from '@/theme/theme'
import { FeatureButton } from './sheetParts'
import { FEATURE } from './onCard'

const ROW_MIN_H = 50

/** The Location section's one statement of where this place is, with the bin
 *  when a named place is chosen. */
function LocationStatusRow({
  text,
  active,
  onClear,
}: {
  text: string
  active: boolean
  onClear?: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: ROW_MIN_H, paddingHorizontal: sp.md, paddingVertical: 10 }}>
      <MapPin size={17} color={active ? c.accent : c.textFaint} />
      <Txt style={{ flex: 1, fontSize: 15, color: c.text }} numberOfLines={2}>
        {text}
      </Txt>
      {onClear ? (
        <Pressable
          onPress={onClear}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('location.places.clearLocation')}
        >
          <Trash2 size={17} color={c.expense} />
        </Pressable>
      ) : null}
    </View>
  )
}

/** Inline search box as a row: magnifier, then the query. */
function SearchRow({ value, onChangeText }: { value: string; onChangeText: (v: string) => void }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const reveal = useRevealOnFocus()
  const row = useRef<View>(null)
  return (
    <View ref={row} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: ROW_MIN_H, paddingHorizontal: sp.md }}>
      <Search size={17} color={c.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={t('location.places.searchPlaceholder')}
        placeholderTextColor={c.textFaint}
        accessibilityLabel={t('location.places.search')}
        autoCapitalize="words"
        autoCorrect={false}
        returnKeyType="search"
        onFocus={() => reveal(row.current)}
        style={{ flex: 1, fontSize: 15, color: c.text, fontFamily: fonts.body, paddingVertical: 12 }}
      />
      {value ? (
        <Pressable
          onPress={() => onChangeText('')}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('form.clear')}
          style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}
        >
          <X size={12} color={c.textMuted} />
        </Pressable>
      ) : null}
    </View>
  )
}

/** One search result: name + address, and how far it is from you — the list
 *  is sorted by that, so it also explains the ordering. */
function ResultRow({ r, onPress }: { r: PlaceSuggestion; onPress: () => void }) {
  const { c } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: ROW_MIN_H, paddingHorizontal: sp.md, paddingVertical: 8 },
        pressed && { opacity: 0.6 },
      ]}
    >
      <View style={{ width: 17 }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={{ fontFamily: fonts.semibold, fontSize: 14, color: c.text }} numberOfLines={1}>
          {r.name}
        </Txt>
        {r.address ? (
          <Txt variant="faint" style={{ fontSize: 12 }} numberOfLines={1}>
            {r.address}
          </Txt>
        ) : null}
      </View>
      {r.distanceM != null ? (
        <Txt style={{ fontFamily: fonts.semibold, fontSize: 12, color: c.textMuted }} numberOfLines={1}>
          {formatDistance(r.distanceM)}
        </Txt>
      ) : null}
    </Pressable>
  )
}

/** A faint one-liner inside a section (searching… / no matches). */
function NoteLine({ text }: { text: string }) {
  return (
    <View style={{ paddingHorizontal: sp.md, paddingVertical: 12 }}>
      <Txt variant="faint" style={{ fontSize: 13 }}>
        {text}
      </Txt>
    </View>
  )
}

/** A text action as a row — accent label, no fill: it's actionable, not a state. */
function ActionRow({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  const { c } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: ROW_MIN_H, paddingHorizontal: sp.md },
        pressed && { opacity: 0.6 },
      ]}
    >
      {icon}
      <Txt style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: c.accent }} numberOfLines={1}>
        {label}
      </Txt>
    </Pressable>
  )
}

/** "Whose comings and goings" — a MULTI-select, so SelectRow (single) doesn't
 *  fit. The row shows "Everyone" or the names; the checked list opens in a
 *  sheet nested in this row's tree (a sibling Modal fails on iOS). None picked
 *  = everyone, so "Everyone" clears the picks. */
function PeopleRow({
  label,
  people,
  picked,
  onChange,
}: {
  label: string
  people: Profile[]
  picked: string[]
  onChange: (next: string[]) => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const bottomGap = useBottomGap(sp.lg)
  const [open, setOpen] = useState(false)
  const everyone = t('location.places.watchAll')
  const names = people.filter((p) => picked.includes(p.email)).map((p) => p.display_name)
  const options = [
    { key: '', label: everyone, on: picked.length === 0 },
    ...people.map((p) => ({ key: p.email, label: p.display_name, on: picked.includes(p.email) })),
  ]
  const pick = (key: string) => {
    if (!key) onChange([])
    else onChange(picked.includes(key) ? picked.filter((e) => e !== key) : [...picked, key])
  }
  return (
    <>
      <FormRow label={label} onPress={() => setOpen(true)}>
        <RowValue value={picked.length ? names.join(', ') || everyone : everyone} placeholder={everyone} />
        <ChevronsUpDown size={15} color={c.textFaint} />
      </FormRow>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable
          onPress={() => setOpen(false)}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: c.sheet,
              borderTopLeftRadius: R.lg,
              borderTopRightRadius: R.lg,
              paddingTop: sp.sm,
              paddingBottom: bottomGap,
              maxHeight: '70%',
            }}
          >
            <View style={{ alignItems: 'center', paddingBottom: sp.sm }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: c.border }} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: sp.lg, paddingBottom: sp.sm }}>
              <View style={{ width: 50 }} />
              <Txt style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 16, textAlign: 'center' }} numberOfLines={1}>
                {label}
              </Txt>
              <Pressable onPress={() => setOpen(false)} hitSlop={10} accessibilityRole="button" style={{ width: 50, alignItems: 'flex-end' }}>
                <Txt style={{ fontFamily: fonts.semibold, fontSize: 15, color: c.accent }}>{t('common.done')}</Txt>
              </Pressable>
            </View>
            <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: sp.lg }}>
              {options.map((o, i) => (
                <Pressable
                  key={o.key || '__all'}
                  onPress={() => pick(o.key)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: o.on }}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    minHeight: ROW_MIN_H,
                    borderTopWidth: i ? StyleSheet.hairlineWidth : 0,
                    borderTopColor: c.border,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Txt
                    style={{ flex: 1, fontSize: 16, color: o.on ? c.accent : c.text, fontFamily: o.on ? fonts.semibold : fonts.body }}
                    numberOfLines={1}
                  >
                    {o.label}
                  </Txt>
                  {o.on ? <Check size={18} color={c.accent} strokeWidth={2.5} /> : null}
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
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
  const { c, dark } = useTheme()
  // Half the inset: the docked button's curved corners meet the display's.
  const bottomGap = useBottomGap(sp.xs)
  const { t } = useI18n()
  const { lift, room, clearOfBars, onRootLayout } = useSheetLift()

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
  // "Notify me about this place" ON with NEITHER direction picked would save a
  // watcher row that can never fire — subscribed in the UI, silent forever. So
  // the two are kept in lockstep: turning off the last remaining direction
  // turns the whole subscription off, and turning the subscription on
  // guarantees at least one direction.
  function toggleWatch(on: boolean) {
    setWatchOn(on)
    if (on && !arrivals && !departures) setArrivals(true)
  }
  function toggleArrivals(on: boolean) {
    setArrivals(on)
    if (!on && !departures) setWatchOn(false)
  }
  function toggleDepartures(on: boolean) {
    setDepartures(on)
    if (!on && !arrivals) setWatchOn(false)
  }

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
        // Belt-and-braces on the toggle lockstep above: a subscription with
        // neither direction is the same as no subscription, so never store one.
        if (watchOn && (arrivals || departures)) {
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
    } catch (e) {
      // A free household keeps one place (migration 072). The server is the one
      // that decides, so this is the error path rather than a client check —
      // and a lapsed Plus plan lands here too, without anything being deleted.
      if (String((e as { message?: string } | null)?.message ?? '').includes(PLACE_LIMIT_ERROR)) {
        onClose()
        router.push('/paywall')
        return
      }
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

  const radiusOptions = presets.map((p) => ({ value: String(p.meters), label: p.label }))
  const locationText = locating
    ? t('location.locating')
    : picked
      ? picked.address || picked.name
      : usingSaved
        ? (savedLabel ?? t('location.places.savedLocation'))
        : coords
          ? t('location.places.currentLocation')
          : t('location.places.noLocation')
  const showNoResults = !hasPlace && query.trim().length >= 3 && !searching && !results.length

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop} onLayout={onRootLayout}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('common.cancel')} />
        <View
          style={[
            styles.sheet,
            // c.sheet, not c.card — the glass skin's card is translucent.
            { backgroundColor: c.sheet, maxHeight: room * 0.92, marginBottom: lift },
          ]}
        >
          {/* The place itself leads: its emoji on a tile in the Places colour
              and its name, both typed in place, large — like the document and
              pet event editors (2026-11). */}
          <View style={styles.sheetHead}>
            <View style={[styles.emojiTile, { backgroundColor: FEATURE.places + (dark ? '33' : '1F') }]}>
              <TextInput
                value={icon}
                onChangeText={setIcon}
                maxLength={2}
                accessibilityLabel={t('location.places.icon')}
                style={{ width: 56, height: 56, textAlign: 'center', fontSize: 28, paddingVertical: 0, textAlignVertical: 'center' }}
              />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt style={{ fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase', color: c.textMuted }}>
                {place ? t('location.places.edit') : t('location.places.new')}
              </Txt>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder={t('location.places.namePlaceholder')}
                placeholderTextColor={c.textFaint}
                autoFocus={!place}
                returnKeyType="done"
                accessibilityLabel={t('location.places.namePlaceholder')}
                style={{ fontFamily: fonts.display, fontSize: 26, lineHeight: 31, color: c.text, padding: 0, marginTop: 2 }}
              />
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              style={[styles.close, { backgroundColor: c.surface }]}
            >
              <X size={16} color={c.textMuted} />
            </Pressable>
          </View>

          <KeyboardScroll
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ gap: sp.lg, paddingHorizontal: sp.lg, paddingBottom: sp.lg }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <FormSection title={t('location.places.details')}>
              {/* Presets only (100 m floor — see `presets`). nearestPreset keeps
                  a saved value from another unit system showing a choice. */}
              <SelectRow
                label={t('location.places.radius')}
                value={String(selectedRadius)}
                options={radiusOptions}
                onChange={(v) => {
                  if (v) setRadiusM(Number(v))
                }}
              />
            </FormSection>

            {/* ONE unambiguous statement of where this place is:
                  - a chosen place  → its address (searched, or the saved one
                    we're editing), with a bin to remove it
                  - otherwise       → your current location, or nothing yet
                Search is offered only when no place is chosen — once one is,
                the bin is the way to change it. */}
            <FormSection title={t('location.places.location')}>
              <LocationStatusRow
                text={locationText}
                active={hasPlace || !!coords}
                onClear={hasPlace ? clearPlace : undefined}
              />
              {hasPlace ? null : <SearchRow value={query} onChangeText={setQuery} />}
              {!hasPlace && searching ? <NoteLine text={t('location.places.searching')} /> : null}
              {hasPlace ? null : results.map((r) => <ResultRow key={r.id} r={r} onPress={() => choose(r)} />)}
              {showNoResults ? <NoteLine text={t('location.places.noResults')} /> : null}
              {/* Pin to where I'm standing. Hidden in the one case where it
                  would change nothing — no place chosen and we're ALREADY on the
                  current location — so it never reads as a description of the
                  state instead of an action. The wording says which it is: it
                  SWITCHES away from a chosen place, or sets one when there's
                  none. */}
              {hasPlace || !coords ? (
                <ActionRow
                  icon={<LocateFixed size={17} color={c.accent} />}
                  label={hasPlace ? t('location.places.switchToCurrent') : t('location.places.useMyLocation')}
                  onPress={repin}
                />
              ) : null}
            </FormSection>

            {/* MY notifications. The place is shared with the household; this
                subscription is personal — saving a place signs up nobody else. */}
            <FormSection title={t('location.places.notify')}>
              <ToggleRow label={t('location.places.watchTitle')} value={watchOn} onValueChange={toggleWatch} />
              {watchOn ? (
                <ToggleRow label={t('location.places.notifyArrivals')} value={arrivals} onValueChange={toggleArrivals} />
              ) : null}
              {watchOn ? (
                <ToggleRow label={t('location.places.notifyDepartures')} value={departures} onValueChange={toggleDepartures} />
              ) : null}
              {/* Whose crossings I care about. None picked = everyone. */}
              {watchOn ? (
                <PeopleRow
                  label={t('location.places.watchWho')}
                  people={others}
                  picked={watchedPicked}
                  onChange={setWatchedPicked}
                />
              ) : null}
            </FormSection>

            {/* Rare and irreversible: a quiet red label at the end of the
                content, not a second button competing with Save. */}
            {place ? (
              <Pressable
                onPress={remove}
                accessibilityRole="button"
                style={({ pressed }) => [
                  { alignSelf: 'center', paddingVertical: sp.sm, paddingHorizontal: sp.lg },
                  pressed && { opacity: 0.6 },
                ]}
              >
                <Txt style={{ color: c.expense, fontFamily: fonts.semibold, fontSize: 14 }}>
                  {t('location.places.delete')}
                </Txt>
              </Pressable>
            ) : null}
          </KeyboardScroll>

          {/* Save — docked */}
          <View
            style={[
              styles.footer,
              { paddingBottom: clearOfBars ? sp.md : bottomGap, borderTopColor: c.border },
            ]}
          >
            <FeatureButton
              tint={FEATURE.places}
              title={place ? t('common.saveChanges') : t('location.places.add')}
              onPress={save}
              disabled={!coords || !name.trim()}
              busy={busy}
            />
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: sp.lg },
  emojiTile: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: sp.md,
    paddingHorizontal: sp.lg,
    paddingBottom: sp.md,
  },
  close: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  footer: { paddingHorizontal: sp.lg, paddingTop: sp.sm },
})
