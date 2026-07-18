// Places & Activity — the Phase 2 surface. "Places" manages the household's
// saved spots (each monitored as a native geofence on every member's device);
// "Activity" is the feed of who arrived where. Both are Realtime, so a crossing
// shows up the moment someone's device reports it.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Plus } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { supabase } from '@/lib/supabase'
import { formatDistance } from '@/lib/location'
import { fetchMyPlaceWatches, fetchPlaceEvents, fetchPlaces } from '@/lib/places'
import type { Place, PlaceEvent, PlaceWatch, Profile } from '@/lib/types'
import { fonts, radius as R, sp, useTheme } from '@/theme/theme'
import { Segmented } from '@/apps/budget/shared'
import { timeAgo } from './locationUi'
import { PlaceForm } from './PlaceForm'

export function PlacesSheet({
  profiles,
  myEmail,
  colors,
  onClose,
  onChanged,
}: {
  profiles: Profile[]
  myEmail: string | null
  colors: Record<string, string>
  onClose: () => void
  /** Places changed — the map + geofence registration should refresh. */
  onChanged: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const insets = useSafeAreaInsets()

  const [tab, setTab] = useState<'places' | 'activity'>('places')
  const [places, setPlaces] = useState<Place[]>([])
  const [events, setEvents] = useState<PlaceEvent[]>([])
  const [watches, setWatches] = useState<Record<string, PlaceWatch>>({})
  const [editing, setEditing] = useState<Place | 'new' | null>(null)

  const load = useCallback(async () => {
    const [p, e, w] = await Promise.all([
      fetchPlaces().catch(() => [] as Place[]),
      fetchPlaceEvents().catch(() => [] as PlaceEvent[]),
      fetchMyPlaceWatches().catch(() => ({}) as Record<string, PlaceWatch>),
    ])
    setPlaces(p)
    setEvents(e)
    setWatches(w)
  }, [])

  useEffect(() => {
    void load()
    const channel = supabase
      .channel('places_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'places' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'place_events' }, () => void load())
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [load])

  const placeById = useMemo(() => {
    const m = new Map<string, Place>()
    for (const p of places) m.set(p.id, p)
    return m
  }, [places])

  const nameFor = useCallback(
    (email: string) =>
      profiles.find((p) => p.email === email)?.display_name ?? email.split('@')[0],
    [profiles],
  )

  /** MY subscription state for a place — watching is personal, so this only
   *  ever describes what *I* will be told about. */
  const watchLabel = (placeId: string): string => {
    const w = watches[placeId]
    if (!w) return t('location.places.notWatching')
    if (!w.watched.length) return t('location.places.watchingAll')
    const names = w.watched
      .map((e) => profiles.find((p) => p.email === e)?.display_name ?? e.split('@')[0])
      .join(', ')
    return t('location.places.watchingSome', { names })
  }

  const afterSave = () => {
    setEditing(null)
    void load()
    onChanged()
  }

  return (
    <>
      <Modal visible transparent animationType="slide" onRequestClose={onClose}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' }}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('common.done')} />
          <View
            style={{
              // c.sheet, not c.card — the glass skin's card is translucent.
              backgroundColor: c.sheet,
              borderTopLeftRadius: 22,
              borderTopRightRadius: 22,
              padding: sp.lg,
              paddingBottom: insets.bottom + sp.lg,
              gap: sp.md,
              // Fit the content (a household with 1 place gets a short sheet),
              // capped so a long list still leaves the map visible.
              maxHeight: '85%',
            }}
          >
            <View style={{ width: 38, height: 5, borderRadius: 3, backgroundColor: c.border, alignSelf: 'center' }} />
            <View>
              <Txt style={{ fontFamily: fonts.displaySemi, fontSize: 22, color: c.text }}>
                {t('location.places.title')}
              </Txt>
              <Txt variant="muted">{t('location.places.subtitle')}</Txt>
            </View>

            <Segmented<'places' | 'activity'>
              value={tab}
              onChange={setTab}
              options={[
                { id: 'places', label: t('location.tab.places') },
                { id: 'activity', label: t('location.tab.activity') },
              ]}
            />

            {tab === 'places' ? (
              <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingBottom: sp.lg }}>
                {places.map((p) => (
                  <Pressable
                    key={p.id}
                    onPress={() => setEditing(p)}
                    style={({ pressed }) => [
                      {
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: sp.md,
                        paddingVertical: 11,
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderColor: c.border,
                      },
                      pressed && { opacity: 0.6 },
                    ]}
                  >
                    <View
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: R.md,
                        backgroundColor: c.surface,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Txt style={{ fontSize: 19 }}>{p.icon}</Txt>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Txt style={{ fontFamily: fonts.semibold, fontSize: 15, color: c.text }} numberOfLines={1}>
                        {p.name}
                      </Txt>
                      <Txt variant="muted" style={{ fontSize: 12 }} numberOfLines={1}>
                        {watchLabel(p.id)} · {formatDistance(p.radius_m)}
                      </Txt>
                    </View>
                  </Pressable>
                ))}

                {!places.length ? (
                  <View style={{ alignItems: 'center', gap: 6, paddingVertical: sp.xl }}>
                    <Txt variant="h2" style={{ textAlign: 'center' }}>
                      {t('location.places.empty')}
                    </Txt>
                    <Txt variant="muted" style={{ textAlign: 'center' }}>
                      {t('location.places.emptyBody')}
                    </Txt>
                  </View>
                ) : null}

                <Pressable
                  onPress={() => setEditing('new')}
                  style={({ pressed }) => [
                    {
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 7,
                      marginTop: sp.md,
                      paddingVertical: 13,
                      borderRadius: R.md,
                      borderWidth: 1,
                      borderStyle: 'dashed',
                      borderColor: c.border,
                    },
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <Plus size={17} color={c.accent} />
                  <Txt style={{ fontFamily: fonts.semibold, fontSize: 14, color: c.accent }}>
                    {t('location.places.add')}
                  </Txt>
                </Pressable>
              </ScrollView>
            ) : (
              <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingBottom: sp.lg }}>
                {events.map((e) => {
                  const place = placeById.get(e.place_id)
                  const who = nameFor(e.user_email)
                  const line =
                    e.type === 'arrive'
                      ? t('location.activity.arrived', { name: who, place: place?.name ?? '' })
                      : t('location.activity.left', { name: who, place: place?.name ?? '' })
                  return (
                    <View
                      key={e.id}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: sp.sm,
                        paddingVertical: 10,
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderColor: c.border,
                      }}
                    >
                      <View
                        style={{
                          width: 9,
                          height: 9,
                          borderRadius: 5,
                          backgroundColor: colors[e.user_email] ?? c.accent,
                        }}
                      />
                      <Txt style={{ flex: 1, fontSize: 14, color: c.text }} numberOfLines={1}>
                        {place?.icon ? `${place.icon} ` : ''}
                        {line}
                      </Txt>
                      <Txt variant="faint" style={{ fontSize: 11 }}>
                        {timeAgo(e.at, t)}
                      </Txt>
                    </View>
                  )
                })}
                {!events.length ? (
                  <View style={{ alignItems: 'center', paddingVertical: sp.xl }}>
                    <Txt variant="muted" style={{ textAlign: 'center' }}>
                      {t('location.activity.empty')}
                    </Txt>
                  </View>
                ) : null}
              </ScrollView>
            )}
          </View>
        </View>

        {/* Rendered INSIDE this Modal on purpose: a second Modal presented as a
            SIBLING of an already-open one silently fails to appear on iOS (this
            is why "Add a place" did nothing). Same pattern as NudgeSettings →
            PresetEditor. */}
        {editing ? (
          <PlaceForm
            place={editing === 'new' ? null : editing}
            profiles={profiles}
            myEmail={myEmail}
            watch={editing === 'new' ? null : (watches[editing.id] ?? null)}
            onClose={() => setEditing(null)}
            onSaved={afterSave}
          />
        ) : null}
      </Modal>
    </>
  )
}
