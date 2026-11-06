// Places & Activity — the Phase 2 surface. "Places" manages the household's
// saved spots (each monitored as a native geofence on every member's device);
// "Activity" is the feed of who arrived where. Both are Realtime, so a crossing
// shows up the moment someone's device reports it.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Bell, Crosshair, LogIn, LogOut, MapPin, Plus } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { supabase } from '@/lib/supabase'
import { channelName } from '@/lib/realtime'
import { formatDistance } from '@/lib/location'
import { fetchMyPlaceWatches, fetchPlaceEvents, fetchPlaces } from '@/lib/places'
import type { Place, PlaceEvent, PlaceWatch, Profile } from '@/lib/types'
import { useBottomGap } from '@/hooks/useBottomGap'
import { fonts, radius as R, sp, useTheme } from '@/theme/theme'
import { Segmented } from '@/apps/budget/shared'
import { timeAgo } from './locationUi'
import { PlaceForm } from './PlaceForm'
import { FeatureButton, SheetHead } from './sheetParts'
import { FEATURE } from './onCard'

export function PlacesSheet({
  profiles,
  myEmail,
  colors,
  onClose,
  onChanged,
  onShowOnMap,
}: {
  profiles: Profile[]
  myEmail: string | null
  colors: Record<string, string>
  onClose: () => void
  /** Places changed — the map + geofence registration should refresh. */
  onChanged: () => void
  /** Frame a place on the map. The parent owns the camera, and closes this
   *  sheet on the way — the map is the thing you asked to look at. */
  onShowOnMap: (place: Place) => void
}) {
  const { c, dark } = useTheme()
  const bottomGap = useBottomGap(sp.xs)
  const { t } = useI18n()

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
      .channel(channelName('places_changes'))
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

  const tint = FEATURE.places
  const soft = tint + (dark ? '2E' : '1A')
  const watchedCount = places.filter((p) => watches[p.id]).length
  const sub =
    tab === 'activity'
      ? t('location.places.subtitle')
      : places.length
        ? t('location.places.count', { n: places.length, w: watchedCount })
        : t('location.places.subtitle')

  return (
    <>
      <Modal visible transparent animationType="slide" onRequestClose={onClose}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('common.done')} />
          <View
            style={{
              // c.sheet, not c.card — the glass skin's card is translucent.
              backgroundColor: c.sheet,
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              paddingTop: sp.lg,
              paddingHorizontal: sp.lg,
              // Half of iOS's inset (the button's curve meets the screen's),
              // all of Android's navigation bar — useBottomGap does both.
              paddingBottom: bottomGap,
              gap: sp.md,
              // Fit the content, capped so a long list still leaves map visible.
              maxHeight: '88%',
            }}
          >
            <SheetHead
              title={t('location.places.title')}
              sub={sub}
              tint={tint}
              icon={<MapPin size={24} color="#fff" />}
              onClose={onClose}
            />

            <Segmented<'places' | 'activity'>
              value={tab}
              onChange={setTab}
              options={[
                { id: 'places', label: t('location.tab.places') },
                { id: 'activity', label: t('location.tab.activity') },
              ]}
            />

            {tab === 'places' ? (
              <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingBottom: sp.sm }}>
                {places.length ? (
                  <View style={[st.card, { backgroundColor: c.card, borderColor: c.border }]}>
                    {places.map((p, i) => {
                      const w = watches[p.id]
                      return (
                        <Pressable
                          key={p.id}
                          onPress={() => setEditing(p)}
                          style={({ pressed }) => [
                            st.row,
                            { borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderColor: c.border },
                            pressed && { opacity: 0.6 },
                          ]}
                        >
                          <View style={[st.tile, { backgroundColor: soft }]}>
                            <Txt style={{ fontSize: 21 }}>{p.icon}</Txt>
                          </View>
                          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                            <Txt style={{ fontFamily: fonts.display, fontSize: 17, lineHeight: 21, color: c.text }} numberOfLines={1}>
                              {p.name}
                            </Txt>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              {/* MY subscription: a coloured bell when I'm told,
                                  a faint line when I'm not. */}
                              {w ? (
                                <View style={[st.pill, { backgroundColor: soft }]}>
                                  <Bell size={11} color={tint} />
                                  <Txt style={{ fontSize: 11.5, fontFamily: fonts.semibold, color: tint }} numberOfLines={1}>
                                    {watchLabel(p.id)}
                                  </Txt>
                                </View>
                              ) : (
                                <Txt variant="faint" style={{ fontSize: 12 }} numberOfLines={1}>
                                  {watchLabel(p.id)}
                                </Txt>
                              )}
                              <Txt variant="faint" style={{ fontSize: 12 }}>
                                · {formatDistance(p.radius_m)}
                              </Txt>
                            </View>
                          </View>
                          {/* Frame this place on the map. The ROW still means
                              edit; this nested Pressable takes its own touch. */}
                          <Pressable
                            onPress={() => onShowOnMap(p)}
                            hitSlop={10}
                            accessibilityRole="button"
                            accessibilityLabel={t('location.places.showOnMap')}
                            style={({ pressed }) => [st.round, { backgroundColor: c.surface }, pressed && { opacity: 0.5 }]}
                          >
                            <Crosshair size={16} color={c.text} />
                          </Pressable>
                        </Pressable>
                      )
                    })}
                  </View>
                ) : (
                  <View style={{ alignItems: 'center', gap: 6, paddingVertical: sp.xl }}>
                    <Txt style={{ fontFamily: fonts.display, fontSize: 20, textAlign: 'center', color: c.text }}>
                      {t('location.places.empty')}
                    </Txt>
                    <Txt variant="muted" style={{ textAlign: 'center' }}>
                      {t('location.places.emptyBody')}
                    </Txt>
                  </View>
                )}
              </ScrollView>
            ) : (
              <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingBottom: sp.sm }}>
                {events.length ? (
                  <View style={[st.card, { backgroundColor: c.card, borderColor: c.border }]}>
                    {events.map((e, i) => {
                      const place = placeById.get(e.place_id)
                      const who = nameFor(e.user_email)
                      const arrive = e.type === 'arrive'
                      const line = arrive
                        ? t('location.activity.arrived', { name: who, place: place?.name ?? '' })
                        : t('location.activity.left', { name: who, place: place?.name ?? '' })
                      const mc = colors[e.user_email] ?? c.action
                      return (
                        <View
                          key={e.id}
                          style={[st.row, { borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderColor: c.border }]}
                        >
                          {/* The member's colour; the arrow says which way. */}
                          <View style={[st.tile, { backgroundColor: mc + (dark ? '33' : '22') }]}>
                            {arrive ? <LogIn size={17} color={mc} /> : <LogOut size={17} color={mc} />}
                          </View>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Txt style={{ fontSize: 14.5, color: c.text }} numberOfLines={2}>
                              {place?.icon ? `${place.icon} ` : ''}
                              {line}
                            </Txt>
                            <Txt variant="faint" style={{ fontSize: 12 }}>
                              {timeAgo(e.at, t)}
                            </Txt>
                          </View>
                        </View>
                      )
                    })}
                  </View>
                ) : (
                  <View style={{ alignItems: 'center', paddingVertical: sp.xl }}>
                    <Txt variant="muted" style={{ textAlign: 'center' }}>
                      {t('location.activity.empty')}
                    </Txt>
                  </View>
                )}
              </ScrollView>
            )}

            {/* Pinned, so a household with many places needn't scroll to add one. */}
            {tab === 'places' ? (
              <FeatureButton
                tint={tint}
                title={t('location.places.add')}
                icon={<Plus size={18} color="#fff" strokeWidth={2.6} />}
                onPress={() => setEditing('new')}
              />
            ) : null}
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

const st = StyleSheet.create({
  card: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: sp.md, paddingVertical: 11 },
  tile: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: R.pill, flexShrink: 1 },
  round: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
})
