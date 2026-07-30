// Whereabouts — the web family map. Ported from the iOS app's /location screen,
// with the honest reductions the browser forces (see src/lib/location.ts):
//   • Reading everyone's position, the places and the activity feed: full parity.
//   • Sharing MY position: only while this page is open. No PWA can do
//     background location, so the UI says so instead of implying Find My.
//   • No geofence alerts and no Safety Radius: both need an OS wake-up. Those
//     crossings still appear in the feed — recorded by whoever is on iOS.
//
// The map is lazy-imported (mapbox-gl is ~250 kB gzipped) and only when
// VITE_MAPBOX_TOKEN is set; without it the screen is a roster, which is still
// the useful half.
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapPin, Navigation, Pause, Play, Plus, Trash2, X } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useCachedQuery } from '../../hooks/useCachedQuery'
import { useBack } from '../../hooks/useBack'
import { useI18n } from '../../hooks/useI18n'
import { useTheme } from '../../hooks/useTheme'
import { shortName } from '../../lib/format'
import {
  MAPBOX_TOKEN,
  createPlace,
  deletePlace,
  driveEta,
  fetchMemberLocations,
  fetchPlaceEvents,
  fetchPlaces,
  formatDistance,
  formatEta,
  geolocationSupported,
  getCurrentFix,
  haversineMeters,
  isPaused,
  isSharingEnabled,
  isSharingLive,
  navUrl,
  pauseSharing,
  placeAt,
  resumeSharing,
  setSharing,
  timeAgo,
  upsertMyFix,
  watchAndUpload,
  PLACE_LIMIT_ERROR,
  type LatLng,
} from '../../lib/location'
import { supabase } from '../../lib/supabase'
import type { MemberLocation, Place, PlaceEvent } from '../../lib/types'
import type { MapMember } from './FamilyMap'

const FamilyMap = lazy(() => import('./FamilyMap'))

const EMPTY_DATA: { locs: MemberLocation[]; places: Place[]; events: PlaceEvent[] } = {
  locs: [],
  places: [],
  events: [],
}

/** Stable per-member colours, matching the iOS roster palette. */
const COLORS = ['#c2603f', '#3f6ea5', '#3c7d58', '#8a5fa8', '#c98a2e', '#4a8f8f']

export default function Whereabouts() {
  const back = useBack()
  const { t } = useI18n()
  const { theme } = useTheme()
  const { profile, profiles } = useAuth()
  const myEmail = profile?.email ?? ''

  const [selected, setSelected] = useState<string | null>(null)
  const [focus, setFocus] = useState<LatLng | null>(null)
  const [tab, setTab] = useState<'roster' | 'places' | 'activity'>('roster')
  const [busy, setBusy] = useState(false)
  const [geoError, setGeoError] = useState<string | null>(null)
  const [etas, setEtas] = useState<Record<string, string>>({})
  const stopWatch = useRef<(() => void) | null>(null)

  // Cached like every other screen, so returning to the map renders the roster
  // instantly instead of flashing empty while the fetch runs.
  type Data = { locs: MemberLocation[]; places: Place[]; events: PlaceEvent[] }
  const { data, revalidate: load } = useCachedQuery<Data>('whereabouts', async () => {
    const [locs, places, events] = await Promise.all([
      fetchMemberLocations(),
      fetchPlaces(),
      fetchPlaceEvents(),
    ])
    return { locs, places, events }
  })
  // Fall back to the shared EMPTY object, not fresh `[]` literals: a new array
  // identity on every render would churn the useMemo deps below.
  const { locs, places, events } = data ?? EMPTY_DATA

  // Realtime: the same channel pattern the shopping list uses. Positions change
  // from other members' phones, so a static fetch would go stale immediately.
  useEffect(() => {
    const ch = supabase
      .channel('whereabouts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'member_locations' }, () => {
        void load()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'place_events' }, () => {
        void load()
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [load])

  const mine = useMemo(() => locs.find((l) => l.user_email === myEmail) ?? null, [locs, myEmail])
  const sharingOn = isSharingEnabled(mine)

  // While sharing is on AND this page is open, keep my own pin fresh. The cleanup
  // is what makes the foreground-only limit real rather than a stale pin.
  useEffect(() => {
    if (!sharingOn) {
      stopWatch.current?.()
      stopWatch.current = null
      return
    }
    stopWatch.current = watchAndUpload()
    return () => {
      stopWatch.current?.()
      stopWatch.current = null
    }
  }, [sharingOn])

  const nameFor = (email: string) =>
    shortName(profiles.find((p) => p.email === email)?.display_name ?? email)

  const colorFor = useCallback(
    (email: string) => {
      const i = [...profiles].sort((a, b) => a.email.localeCompare(b.email)).findIndex((p) => p.email === email)
      return COLORS[(i < 0 ? 0 : i) % COLORS.length]
    },
    [profiles],
  )

  /** Everyone currently plottable, me first so my card leads the roster. */
  const live = useMemo(
    () =>
      locs
        .filter(isSharingLive)
        .sort((a, b) =>
          a.user_email === myEmail ? -1 : b.user_email === myEmail ? 1 : a.user_email.localeCompare(b.user_email),
        ),
    [locs, myEmail],
  )

  const mapMembers: MapMember[] = useMemo(
    () =>
      live.map((l) => ({
        email: l.user_email,
        name: nameFor(l.user_email),
        color: colorFor(l.user_email),
        at: { lat: l.lat as number, lng: l.lng as number },
        isMe: l.user_email === myEmail,
      })),
    // nameFor closes over `profiles`, which is already a dep via colorFor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [live, colorFor, myEmail],
  )

  // Drive-time ETA from me to the selected member, when both are plottable and a
  // token exists. One request per selection — never one per roster card.
  useEffect(() => {
    const target = live.find((l) => l.user_email === selected)
    const me = isSharingLive(mine) ? { lat: mine.lat, lng: mine.lng } : null
    if (!target || !me || target.user_email === myEmail) return
    let cancelled = false
    void driveEta(me, { lat: target.lat as number, lng: target.lng as number }).then((eta) => {
      if (!cancelled && eta) {
        setEtas((prev) => ({ ...prev, [target.user_email]: formatEta(eta.minutes) }))
      }
    })
    return () => {
      cancelled = true
    }
  }, [selected, live, mine, myEmail])

  async function toggleSharing() {
    if (busy) return
    setBusy(true)
    setGeoError(null)
    try {
      if (sharingOn) {
        await setSharing(false)
      } else {
        // Ask for the fix FIRST: turning sharing on and then failing the
        // permission prompt would advertise a location we can't supply.
        const fix = await getCurrentFix()
        await setSharing(true)
        await upsertMyFix(fix)
      }
      await load()
    } catch {
      setGeoError(t('location.permDenied'))
    }
    setBusy(false)
  }

  async function pauseFor(minutes: number) {
    if (busy) return
    setBusy(true)
    await pauseSharing(new Date(Date.now() + minutes * 60_000))
    await load()
    setBusy(false)
  }

  async function resume() {
    if (busy) return
    setBusy(true)
    await resumeSharing()
    await load()
    setBusy(false)
  }

  function select(email: string) {
    setSelected((cur) => (cur === email ? null : email))
    const l = live.find((x) => x.user_email === email)
    if (l) setFocus({ lat: l.lat as number, lng: l.lng as number })
  }

  async function addPlaceHere() {
    const name = prompt(t('location.placeNamePrompt'))
    if (!name?.trim()) return
    setBusy(true)
    setGeoError(null)
    try {
      const fix = await getCurrentFix()
      const err = await createPlace({
        name: name.trim(),
        icon: '📍',
        lat: fix.lat,
        lng: fix.lng,
        radius_m: 150,
      })
      if (err) setGeoError(err.includes(PLACE_LIMIT_ERROR) ? t('location.placeLimit') : t('location.placeFailed'))
      else await load()
    } catch {
      setGeoError(t('location.permDenied'))
    }
    setBusy(false)
  }

  async function removePlace(p: Place) {
    if (!confirm(t('location.deletePlaceConfirm', { name: p.name })) || busy) return
    setBusy(true)
    await deletePlace(p.id)
    await load()
    setBusy(false)
  }

  const myPoint = isSharingLive(mine) ? { lat: mine.lat, lng: mine.lng } : null

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4">
      <header className="flex items-center gap-2 pt-6 pb-3">
        <button
          onClick={() => back('/')}
          className="rounded-lg px-2 py-1 text-xl text-(--text-muted) active:text-(--text)"
        >
          ‹
        </button>
        <h1 className="font-display flex flex-1 items-center gap-2 text-2xl font-bold text-(--text)">
          <MapPin size={22} strokeWidth={2} aria-hidden="true" />
          {t('app.location.name')}
        </h1>
      </header>

      {/* The browser can't do background location. Say it plainly and once. */}
      <p className="mb-3 rounded-xl bg-(--surface) px-3 py-2 text-xs text-(--text-muted)">
        {t('location.webLimit')}
      </p>

      {geoError && (
        <p className="mb-3 rounded-xl bg-(--surface) px-3 py-2 text-sm font-medium text-(--expense)">
          {geoError}
        </p>
      )}

      {/* Map, or an honest explanation of why there isn't one. */}
      {MAPBOX_TOKEN ? (
        <div className="mb-3 h-64 overflow-hidden rounded-2xl bg-(--surface)">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-(--text-faint)">
                {t('common.loading')}
              </div>
            }
          >
            <FamilyMap
              members={mapMembers}
              places={places}
              focus={focus}
              dark={theme === 'dark'}
              onSelect={select}
            />
          </Suspense>
        </div>
      ) : (
        <p className="mb-3 rounded-2xl border border-dashed border-(--text-faint) px-3 py-4 text-center text-xs text-(--text-faint)">
          {t('location.noMapToken')}
        </p>
      )}

      {/* My sharing controls — off by default, and the only way it turns on. */}
      <section className="mb-3 rounded-2xl bg-(--card) p-4">
        <div className="flex items-center gap-3">
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${
              sharingOn ? 'bg-(--income)' : isPaused(mine) ? 'bg-(--accent)' : 'bg-(--text-faint)'
            }`}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-(--text)">{t('location.mySharing')}</p>
            <p className="text-xs text-(--text-faint)">
              {sharingOn
                ? t('location.sharingOn')
                : isPaused(mine)
                  ? t('location.sharingPaused')
                  : t('location.sharingOff')}
            </p>
          </div>
          {geolocationSupported() ? (
            <button
              onClick={() => void toggleSharing()}
              disabled={busy}
              className={`shrink-0 rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-50 ${
                sharingOn ? 'bg-(--surface) text-(--text)' : 'bg-(--accent) text-white'
              }`}
            >
              {sharingOn ? t('location.stop') : t('location.start')}
            </button>
          ) : (
            <span className="text-xs text-(--text-faint)">{t('location.noGeo')}</span>
          )}
        </div>

        {sharingOn && (
          <div className="mt-2.5 flex gap-2">
            <button
              onClick={() => void pauseFor(60)}
              disabled={busy}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-(--surface) py-2 text-xs font-semibold text-(--text) disabled:opacity-50"
            >
              <Pause size={13} strokeWidth={2} aria-hidden="true" />
              {t('location.pause1h')}
            </button>
          </div>
        )}
        {isPaused(mine) && (
          <button
            onClick={() => void resume()}
            disabled={busy}
            className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl bg-(--accent) py-2 text-xs font-bold text-white disabled:opacity-50"
          >
            <Play size={13} strokeWidth={2} aria-hidden="true" />
            {t('location.resume')}
          </button>
        )}
      </section>

      {/* Tabs */}
      <div className="mb-2 grid grid-cols-3 gap-1 rounded-xl bg-(--surface) p-1">
        {(
          [
            ['roster', t('location.tabFamily')],
            ['places', t('location.tabPlaces')],
            ['activity', t('location.tabActivity')],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`rounded-lg py-2 text-xs font-semibold transition-colors ${
              tab === id ? 'bg-(--accent) text-white' : 'text-(--text-muted)'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="pb-10">
        {tab === 'roster' && (
          <ul className="space-y-2">
            {live.length === 0 && (
              <li className="rounded-2xl bg-(--card) px-4 py-6 text-center text-sm text-(--text-muted)">
                {t('location.nobodySharing')}
              </li>
            )}
            {live.map((l) => {
              const isMe = l.user_email === myEmail
              const at = { lat: l.lat as number, lng: l.lng as number }
              const here = placeAt(places, at)
              const away = !isMe && myPoint ? haversineMeters(myPoint, at) : null
              const open = selected === l.user_email
              return (
                <li key={l.user_email}>
                  <button
                    onClick={() => select(l.user_email)}
                    className={`flex w-full items-center gap-3 rounded-2xl bg-(--card) p-3 text-left ${
                      open ? 'ring-2 ring-(--accent)' : ''
                    }`}
                  >
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                      style={{ backgroundColor: colorFor(l.user_email) }}
                    >
                      {nameFor(l.user_email).slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-(--text)">
                        {isMe ? t('pings.you') : nameFor(l.user_email)}
                      </span>
                      <span className="block truncate text-xs text-(--text-faint)">
                        {here ? `${here.icon} ${here.name}` : away != null ? formatDistance(away) : t('location.sharing')}
                        {' · '}
                        {timeAgo(l.updated_at)}
                      </span>
                    </span>
                    {l.battery != null && (
                      <span className="shrink-0 rounded-full bg-(--surface) px-2 py-0.5 text-[10px] font-semibold text-(--text-muted)">
                        {l.battery}%
                      </span>
                    )}
                  </button>

                  {open && !isMe && (
                    <div className="mt-1 flex items-center gap-2 rounded-2xl bg-(--surface) px-3 py-2">
                      {etas[l.user_email] && (
                        <span className="text-xs font-semibold text-(--text)">
                          {t('location.driveEta', { eta: etas[l.user_email] })}
                        </span>
                      )}
                      <a
                        href={navUrl('google', at, nameFor(l.user_email))}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-auto flex items-center gap-1.5 rounded-lg bg-(--accent) px-3 py-1.5 text-xs font-bold text-white"
                      >
                        <Navigation size={12} strokeWidth={2.5} aria-hidden="true" />
                        {t('location.navigate')}
                      </a>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {tab === 'places' && (
          <div className="space-y-2">
            <button
              onClick={() => void addPlaceHere()}
              disabled={busy || !geolocationSupported()}
              className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-(--text-faint) py-3 text-sm font-semibold text-(--text-muted) disabled:opacity-50"
            >
              <Plus size={16} strokeWidth={2} aria-hidden="true" />
              {t('location.addPlaceHere')}
            </button>
            {places.length === 0 && (
              <p className="rounded-2xl bg-(--card) px-4 py-6 text-center text-sm text-(--text-muted)">
                {t('location.noPlaces')}
              </p>
            )}
            {places.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-2xl bg-(--card) p-3">
                <span className="text-lg">{p.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-(--text)">{p.name}</span>
                  <span className="block text-xs text-(--text-faint)">
                    {formatDistance(p.radius_m)}
                  </span>
                </span>
                <button
                  onClick={() => void removePlace(p)}
                  disabled={busy}
                  aria-label={t('common.remove')}
                  className="p-1 text-(--text-faint) active:text-(--expense) disabled:opacity-50"
                >
                  <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            ))}
            <p className="px-1 text-xs text-(--text-faint)">{t('location.placesWebNote')}</p>
          </div>
        )}

        {tab === 'activity' && (
          <div className="space-y-1.5">
            {events.length === 0 && (
              <p className="rounded-2xl bg-(--card) px-4 py-6 text-center text-sm text-(--text-muted)">
                {t('location.noActivity')}
              </p>
            )}
            {events.map((e) => {
              const place = places.find((p) => p.id === e.place_id)
              return (
                <div
                  key={e.id}
                  className="flex items-center gap-2 rounded-xl bg-(--card) px-3 py-2.5 text-sm"
                >
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      e.type === 'arrive' ? 'bg-(--income)' : 'bg-(--text-faint)'
                    }`}
                  />
                  <span className="min-w-0 flex-1 truncate text-(--text)">
                    {t(e.type === 'arrive' ? 'location.arrived' : 'location.left', {
                      name: nameFor(e.user_email),
                      place: place ? `${place.icon} ${place.name}` : t('location.aPlace'),
                    })}
                  </span>
                  <span className="shrink-0 text-xs text-(--text-faint)">{timeAgo(e.at)}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {selected && (
        <button
          onClick={() => setSelected(null)}
          aria-label={t('common.close')}
          className="sr-only"
        >
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
