// Add or edit a saved place. A new place pins to your CURRENT location — the
// simplest reliable way to say "this is School" without a map-drag UI; editing
// keeps the saved spot unless you re-pin. Radius is a small preset set: iOS
// enforces a ~100 m floor on geofences, so finer-grained control would be a lie.
import { useEffect, useMemo, useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Location from 'expo-location'
import { Crosshair } from 'lucide-react-native'

import { Btn, Field, Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { nearestPreset, radiusPresets } from '@/lib/location'
import { createPlace, deletePlace, updatePlace } from '@/lib/places'
import type { Place } from '@/lib/types'
import { fonts, radius as R, sp, useTheme } from '@/theme/theme'

export function PlaceForm({
  place,
  onClose,
  onSaved,
}: {
  /** null = creating a new place */
  place: Place | null
  onClose: () => void
  onSaved: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const insets = useSafeAreaInsets()

  const [icon, setIcon] = useState(place?.icon ?? '📍')
  const [name, setName] = useState(place?.name ?? '')
  // Familiar radii in the user's own units. Floor at 100 m — iOS geofences can't
  // reliably go smaller, so offering "250 ft" here would be a promise we can't keep.
  const presets = useMemo(() => radiusPresets(100), [])
  const [radiusM, setRadiusM] = useState(place?.radius_m ?? presets[0]?.meters ?? 150)
  const selectedRadius = nearestPreset(presets, radiusM)
  const [arrivals, setArrivals] = useState(place?.notify_arrivals ?? true)
  const [departures, setDepartures] = useState(place?.notify_departures ?? false)
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    place ? { lat: place.lat, lng: place.lng } : null,
  )
  const [locating, setLocating] = useState(false)
  const [busy, setBusy] = useState(false)

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
        notify_arrivals: arrivals,
        notify_departures: departures,
      }
      if (place) await updatePlace(place.id, input)
      else await createPlace(input)
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
            paddingBottom: insets.bottom + sp.lg,
            gap: sp.md,
            maxHeight: '88%',
          }}
        >
          <View style={{ width: 38, height: 5, borderRadius: 3, backgroundColor: c.border, alignSelf: 'center' }} />
          <Txt style={{ fontFamily: fonts.displaySemi, fontSize: 22, color: c.text }}>
            {place ? t('location.places.edit') : t('location.places.new')}
          </Txt>

          <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0 }} contentContainerStyle={{ gap: sp.md }}>
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

            {/* Notifications */}
            <View style={{ backgroundColor: c.surface, borderRadius: R.md, paddingHorizontal: sp.md }}>
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
            </View>

            {/* Where it is */}
            {coords ? (
              <Pressable
                onPress={repin}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.surface, borderRadius: R.md, padding: sp.md }}
              >
                <Crosshair size={17} color={c.accent} />
                <Txt variant="muted" style={{ flex: 1, fontSize: 13 }}>
                  {locating ? t('location.locating') : t('location.places.pinned')}
                </Txt>
                <Txt style={{ fontFamily: fonts.semibold, fontSize: 13, color: c.accent }}>
                  {t('location.places.useMyLocation')}
                </Txt>
              </Pressable>
            ) : (
              <Txt variant="muted" style={{ fontSize: 13 }}>
                {locating ? t('location.locating') : t('location.places.needLocation')}
              </Txt>
            )}
          </ScrollView>

          <Btn title={t('common.save')} onPress={save} disabled={!coords || !name.trim()} loading={busy} />
          {place ? <Btn title={t('location.places.delete')} variant="ghost" onPress={remove} /> : null}
        </View>
      </View>
    </Modal>
  )
}
