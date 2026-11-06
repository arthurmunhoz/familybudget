// Admin-only: an overview that stays fast as the user base grows (2026-11
// rethink, the Home's look), plus households, activity and usage.
//
//   • Overview — people/sessions today and over 7 days (admin_overview, which
//     scans only the last 8 days of events), a 7-day bar chart, and the 15
//     people who used the app most recently (admin_recent_visitors, keyset
//     paged — "Load more" asks for the next 15).
//   • Households — paged + searched IN THE DATABASE (admin_households), never
//     the whole table.
//   • Activity — the cross-household feed, 30 at a time.
//   • Usage — app/feature usage and recent errors for 7/30/90 days.
// All of it is guarded server-side by is_admin(); the screen also redirects
// anyone else. The RPCs come from migration 087 — until it's applied the
// Overview says so instead of failing.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { Redirect, router, useFocusEffect } from 'expo-router'
import { Activity, BarChart3, Bug, ChevronLeft, ChevronRight, Home, LayoutDashboard, LayoutGrid, Plus, Search, X, type LucideIcon } from 'lucide-react-native'

import { Toggle } from '@/components/Toggle'
import { Pressable } from '@/components/Pressable'
import { Loader, Screen, Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import { useAuth } from '@/lib/auth'
import { usePlus } from '@/lib/plus'
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { useI18n } from '@/hooks/useI18n'
import { SEMANTIC_EVENTS, track } from '@/lib/analytics'
import { APP_META } from '@/lib/appRoutes'
import { buildFeed, type EventRow, type FeedItem } from '@/lib/activityFeed'
import { formatDuration, timeAgo } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { fonts, radius, sp, useTheme } from '@/theme/theme'

type Tab = 'overview' | 'households' | 'activity' | 'usage'
const PERIODS = [7, 30, 90]
const PAGE = 15
const HH_PAGE = 20
const FEED_PAGE = 30
const ADMIN_GRADIENT: [string, string] = ['#3B4A6B', '#1E2638']

interface Overview {
  today_people: number
  today_sessions: number
  week_people: number
  week_sessions: number
  daily: { day: string; people: number; sessions: number }[]
  households: number
  people: number
  new_households_week: number
}
interface Visitor {
  email: string
  display_name: string
  household_id: string
  household_name: string
  last_seen_at: string
}
interface HouseholdRow {
  id: string
  name: string
  created_at: string
  members: number
  last_seen_at: string | null
}
interface AppStat {
  name: string
  icon: LucideIcon
  views: number
  seconds: number
}
type ErrorRow = { id: number; user_email: string; target: string | null; path: string | null; created_at: string }
type UsageData = { stats: AppStat[]; errors: ErrorRow[]; usage: Record<string, number> }

const TZ = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
})()

/** 'entry.created' → 'entry created' for the Feature usage list. */
const humanizeEvent = (type: string) => type.replace(/[._]/g, ' ')

export default function Admin() {
  const { c } = useTheme()
  const { t } = useI18n()
  const { profile, profileLoaded } = useAuth()
  const { isPlus, refresh: refreshPlus } = usePlus()
  const [tab, setTab] = useState<Tab>('overview')
  const [planBusy, setPlanBusy] = useState(false)

  // ── Overview ──
  const { data: overview, loading: ovLoading, revalidate: reloadOverview } = useCachedQuery<Overview | 'missing' | null>(
    'admin:overview',
    async () => {
      const { data, error } = await supabase.rpc('admin_overview', { p_tz: TZ })
      if (error) return /function|does not exist|schema cache/i.test(error.message) ? 'missing' : null
      return (data as Overview) ?? null
    },
  )
  const [visitors, setVisitors] = useState<Visitor[]>([])
  const [visitorsDone, setVisitorsDone] = useState(false)
  const [visitorsBusy, setVisitorsBusy] = useState(false)
  /** First page of the most recent people. */
  const loadVisitors = useCallback(async () => {
    setVisitorsBusy(true)
    const { data } = await supabase.rpc('admin_recent_visitors', { lim: PAGE, before: null })
    const rows = (data ?? []) as Visitor[]
    setVisitors(rows)
    setVisitorsDone(rows.length < PAGE)
    setVisitorsBusy(false)
  }, [])
  async function moreVisitors() {
    if (visitorsBusy || visitorsDone || !visitors.length) return
    setVisitorsBusy(true)
    const { data } = await supabase.rpc('admin_recent_visitors', {
      lim: PAGE,
      before: visitors[visitors.length - 1].last_seen_at,
    })
    const rows = (data ?? []) as Visitor[]
    setVisitors((v) => [...v, ...rows])
    setVisitorsDone(rows.length < PAGE)
    setVisitorsBusy(false)
  }

  // ── Households (paged, searched in the DB) ──
  const [query, setQuery] = useState('')
  const [hh, setHh] = useState<HouseholdRow[]>([])
  const [hhDone, setHhDone] = useState(false)
  const [hhBusy, setHhBusy] = useState(false)
  const loadHouseholds = useCallback(async (q: string, offset: number) => {
    setHhBusy(true)
    const { data } = await supabase.rpc('admin_households', { lim: HH_PAGE, off: offset, q: q.trim() || null })
    const rows = (data ?? []) as HouseholdRow[]
    setHh((prev) => (offset === 0 ? rows : [...prev, ...rows]))
    setHhDone(rows.length < HH_PAGE)
    setHhBusy(false)
  }, [])
  useEffect(() => {
    if (tab !== 'households') return
    const id = setTimeout(() => void loadHouseholds(query, 0), 250)
    return () => clearTimeout(id)
  }, [query, tab, loadHouseholds])
  const [newHousehold, setNewHousehold] = useState('')
  const [creating, setCreating] = useState(false)
  async function createHousehold() {
    const name = newHousehold.trim()
    if (!name || creating) return
    setCreating(true)
    const { error } = await supabase.from('households').insert({ name })
    setCreating(false)
    if (error) {
      Alert.alert(t('admin.createHouseholdError'))
      return
    }
    setNewHousehold('')
    void loadHouseholds(query, 0)
  }

  // ── Activity (30 at a time) ──
  const [feedLim, setFeedLim] = useState(FEED_PAGE)
  const { data: recentEvents = [], revalidate: reloadActivity } = useCachedQuery<EventRow[]>(
    `admin:activity:${feedLim}`,
    async () => {
      const { data } = await supabase.rpc('admin_recent_events', { lim: feedLim })
      return (data ?? []) as EventRow[]
    },
  )
  const activityFeed = buildFeed(recentEvents)

  // ── Usage ──
  const [days, setDays] = useState(30)
  const { data: usageData = { stats: [], errors: [], usage: {} } } = useCachedQuery<UsageData>(
    `admin:usage:${days}`,
    async () => {
      const [use, time, errs, ev] = await Promise.all([
        supabase.rpc('admin_app_usage', { days }),
        supabase.rpc('admin_app_time', { days }),
        supabase.rpc('admin_recent_errors', { lim: 10 }),
        supabase.rpc('admin_event_usage', { days }),
      ])
      const merged = new Map<string, AppStat>()
      for (const row of (use.data ?? []) as { root: string; views: number }[]) {
        const meta = APP_META[row.root] ?? { name: row.root, icon: LayoutGrid }
        const s = merged.get(meta.name) ?? { name: meta.name, icon: meta.icon, views: 0, seconds: 0 }
        s.views += Number(row.views)
        merged.set(meta.name, s)
      }
      for (const row of (time.data ?? []) as { root: string; seconds: number }[]) {
        const meta = APP_META[row.root] ?? { name: row.root, icon: LayoutGrid }
        const s = merged.get(meta.name) ?? { name: meta.name, icon: meta.icon, views: 0, seconds: 0 }
        s.seconds += Number(row.seconds)
        merged.set(meta.name, s)
      }
      return {
        stats: [...merged.values()].sort((a, b) => b.views - a.views),
        errors: (errs.data ?? []) as ErrorRow[],
        usage: Object.fromEntries(((ev.data ?? []) as { type: string; n: number }[]).map((r) => [r.type, Number(r.n)])),
      }
    },
  )
  const usageRows = SEMANTIC_EVENTS.map((type) => ({ type, n: usageData.usage[type] ?? 0 })).sort((a, b) => b.n - a.n)

  // Names for the people / households the feed and errors mention — looked up
  // for just those, not the whole table.
  const mentionedEmails = useMemo(
    () => [...new Set([...recentEvents.map((e) => e.user_email), ...usageData.errors.map((e) => e.user_email)])],
    [recentEvents, usageData.errors],
  )
  const mentionedHouseholds = useMemo(
    () => [...new Set(recentEvents.map((e) => e.household_id).filter((x): x is string => !!x))],
    [recentEvents],
  )
  const { data: names = { people: {}, households: {} } } = useCachedQuery<{ people: Record<string, string>; households: Record<string, string> }>(
    `admin:names:${mentionedEmails.length}:${mentionedHouseholds.length}:${mentionedEmails[0] ?? ''}`,
    async () => {
      const [u, h] = await Promise.all([
        mentionedEmails.length
          ? supabase.from('allowed_users').select('email, display_name').in('email', mentionedEmails)
          : Promise.resolve({ data: [] }),
        mentionedHouseholds.length
          ? supabase.from('households').select('id, name').in('id', mentionedHouseholds)
          : Promise.resolve({ data: [] }),
      ])
      return {
        people: Object.fromEntries(((u.data ?? []) as { email: string; display_name: string }[]).map((r) => [r.email, r.display_name])),
        households: Object.fromEntries(((h.data ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name])),
      }
    },
  )
  const personName = (email: string) => names.people[email] ?? email
  const householdName = (id: string | undefined) => (id ? (names.households[id] ?? '') : '')

  // Fresh data whenever the screen comes back (a household edited on its
  // detail screen, say).
  useFocusEffect(
    useCallback(() => {
      void reloadOverview()
      void loadVisitors()
      void reloadActivity()
    }, [reloadOverview, loadVisitors, reloadActivity]),
  )

  async function togglePlus(next: boolean) {
    if (planBusy) return
    setPlanBusy(true)
    try {
      const { error } = await supabase.rpc('admin_set_plan', { p_plan: next ? 'plus' : 'free' })
      if (error) {
        Alert.alert(t('admin.planError'))
        return
      }
      track('plan.changed', { plan: next ? 'plus' : 'free', scope: 'self' })
      await refreshPlus()
    } finally {
      setPlanBusy(false)
    }
  }

  // Admins only — wait for the profile to RESOLVE before deciding (see git
  // history: rendering during the lookup showed the UI to everyone briefly).
  if (!profileLoaded) return <Loader />
  if (!profile?.is_admin) return <Redirect href="/" />

  const ov = overview && overview !== 'missing' ? overview : null
  const TABS: { key: Tab; label: string; icon: LucideIcon }[] = [
    { key: 'overview', label: t('admin.tab.overview'), icon: LayoutDashboard },
    { key: 'households', label: t('admin.tab.households'), icon: Home },
    { key: 'activity', label: t('admin.tab.activity'), icon: Activity },
    { key: 'usage', label: t('admin.tab.usage'), icon: BarChart3 },
  ]

  return (
    <Screen
      scroll
      header={
        <View style={{ flexDirection: 'row', paddingVertical: sp.sm }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            hitSlop={8}
            style={({ pressed }) => [s.round, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}
          >
            <ChevronLeft size={22} color={c.text} />
          </Pressable>
        </View>
      }
    >
      <View style={{ gap: sp.lg }}>
        <View>
          <Txt style={{ fontFamily: fonts.display, fontSize: 36, lineHeight: 42, letterSpacing: -0.8, color: c.text }}>
            {t('app.admin')}
          </Txt>
          <Txt style={{ fontFamily: fonts.display, fontSize: 20, lineHeight: 26, color: c.textFaint }}>
            {ov ? t('admin.sub', { households: ov.households, people: ov.people }) : ' '}
          </Txt>
        </View>

        {/* tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm }}>
          {TABS.map((tb) => {
            const on = tab === tb.key
            return (
              <Pressable
                key={tb.key}
                onPress={() => setTab(tb.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                style={[s.tab, { backgroundColor: on ? c.text : c.card, borderColor: on ? c.text : c.border }]}
              >
                <tb.icon size={15} color={on ? c.sheet : c.textMuted} />
                <Txt style={{ fontFamily: fonts.semibold, fontSize: 14, color: on ? c.sheet : c.textMuted }}>{tb.label}</Txt>
              </Pressable>
            )
          })}
        </ScrollView>

        {tab === 'overview' ? (
          <>
            {overview === 'missing' ? (
              <Card>
                <Txt style={{ fontFamily: fonts.semibold, color: c.text }}>{t('admin.needsMigration')}</Txt>
                <Txt variant="faint" style={{ fontSize: 13 }}>
                  supabase/migration-087-admin-overview.sql
                </Txt>
              </Card>
            ) : (
              <GradientBox colors={ADMIN_GRADIENT} radius={24} style={{ padding: sp.lg, gap: sp.lg }}>
                <View style={{ flexDirection: 'row', gap: sp.md }}>
                  <Kpi label={t('admin.today')} big={ov?.today_people} small={ov ? t('admin.sessions', { n: ov.today_sessions }) : null} loading={ovLoading && !ov} />
                  <View style={{ width: StyleSheet.hairlineWidth * 2, backgroundColor: 'rgba(255,255,255,0.25)' }} />
                  <Kpi label={t('admin.last7')} big={ov?.week_people} small={ov ? t('admin.sessions', { n: ov.week_sessions }) : null} loading={ovLoading && !ov} />
                </View>
                {ov?.daily?.length ? <WeekBars daily={ov.daily} /> : null}
                {ov ? (
                  <Txt style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.75)' }}>
                    {t('admin.peopleNote', { n: ov.new_households_week })}
                  </Txt>
                ) : null}
              </GradientBox>
            )}

            <View>
              <Label>{t('admin.recentPeople')}</Label>
              <View style={[s.card, { backgroundColor: c.card, borderColor: c.border }]}>
                {visitors.length === 0 ? (
                  <View style={{ padding: sp.lg, alignItems: 'center' }}>
                    {visitorsBusy ? <ActivityIndicator color={c.textMuted} /> : <Txt variant="faint">{t('admin.noVisitors')}</Txt>}
                  </View>
                ) : (
                  visitors.map((v, i) => (
                    <Pressable
                      key={v.email}
                      onPress={() => router.push(`/admin/household/${v.household_id}`)}
                      style={({ pressed }) => [s.row, { borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: c.border, opacity: pressed ? 0.6 : 1 }]}
                    >
                      <Initials name={v.display_name} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Txt style={{ fontFamily: fonts.display, fontSize: 16, color: c.text }} numberOfLines={1}>
                          {v.display_name}
                        </Txt>
                        <Txt variant="faint" style={{ fontSize: 12.5 }} numberOfLines={1}>
                          {v.household_name}
                        </Txt>
                      </View>
                      <Txt style={{ fontSize: 12.5, fontFamily: fonts.semibold, color: c.textMuted }}>{timeAgo(v.last_seen_at)}</Txt>
                    </Pressable>
                  ))
                )}
              </View>
              {!visitorsDone && visitors.length ? <MoreButton busy={visitorsBusy} onPress={moreVisitors} label={t('admin.loadMore')} /> : null}
            </View>

            {/* testing tool, out of the way at the bottom */}
            <View>
              <Label>{t('admin.tools')}</Label>
              <View style={[s.card, s.row, { backgroundColor: c.card, borderColor: c.border }]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt style={{ fontFamily: fonts.semibold, fontSize: 15, color: c.text }}>{t('admin.plusPreview')}</Txt>
                  <Txt variant="faint" style={{ fontSize: 12.5 }}>
                    {planBusy ? t('admin.updating') : t('admin.plusPreviewHint')}
                  </Txt>
                </View>
                <Toggle value={isPlus} onValueChange={togglePlus} disabled={planBusy} />
              </View>
            </View>
          </>
        ) : tab === 'households' ? (
          <>
            <View style={[s.search, { backgroundColor: c.card, borderColor: c.border }]}>
              <Search size={18} color={c.textMuted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t('admin.searchHouseholds')}
                placeholderTextColor={c.textFaint}
                autoCapitalize="none"
                autoCorrect={false}
                style={{ flex: 1, fontSize: 16, color: c.text, paddingVertical: 0 }}
              />
              {query ? (
                <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel={t('common.clear')}>
                  <X size={16} color={c.textFaint} />
                </Pressable>
              ) : null}
            </View>

            <View style={[s.card, { backgroundColor: c.card, borderColor: c.border }]}>
              {hh.length === 0 ? (
                <View style={{ padding: sp.lg, alignItems: 'center' }}>
                  {hhBusy ? <ActivityIndicator color={c.textMuted} /> : <Txt variant="faint">{query ? t('admin.noMatch') : t('admin.noHouseholds')}</Txt>}
                </View>
              ) : (
                hh.map((h, i) => (
                  <Pressable
                    key={h.id}
                    onPress={() => router.push(`/admin/household/${h.id}`)}
                    style={({ pressed }) => [s.row, { borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: c.border, opacity: pressed ? 0.6 : 1 }]}
                  >
                    <View style={[s.tile, { backgroundColor: c.surface }]}>
                      <Home size={17} color={c.textMuted} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Txt style={{ fontFamily: fonts.display, fontSize: 16, color: c.text }} numberOfLines={1}>
                        {h.name}
                      </Txt>
                      <Txt variant="faint" style={{ fontSize: 12.5 }} numberOfLines={1}>
                        {t('admin.members', { n: h.members })} · {h.last_seen_at ? timeAgo(h.last_seen_at) : t('admin.never')}
                      </Txt>
                    </View>
                    <ChevronRight size={17} color={c.textFaint} />
                  </Pressable>
                ))
              )}
            </View>
            {!hhDone && hh.length ? <MoreButton busy={hhBusy} onPress={() => loadHouseholds(query, hh.length)} label={t('admin.loadMore')} /> : null}

            <View>
              <Label>{t('admin.newHousehold')}</Label>
              <View style={[s.search, { backgroundColor: c.card, borderColor: c.border, paddingRight: 6 }]}>
                <Plus size={18} color={c.textMuted} />
                <TextInput
                  value={newHousehold}
                  onChangeText={setNewHousehold}
                  onSubmitEditing={createHousehold}
                  placeholder={t('admin.familyNameHint')}
                  placeholderTextColor={c.textFaint}
                  style={{ flex: 1, fontSize: 16, color: c.text, paddingVertical: 0 }}
                />
                <Pressable
                  onPress={createHousehold}
                  disabled={!newHousehold.trim() || creating}
                  style={{ paddingHorizontal: 14, height: 38, borderRadius: 19, justifyContent: 'center', backgroundColor: c.action, opacity: !newHousehold.trim() || creating ? 0.4 : 1 }}
                >
                  <Txt style={{ color: c.onAction, fontFamily: fonts.semibold }}>{t('admin.create')}</Txt>
                </Pressable>
              </View>
            </View>
          </>
        ) : tab === 'activity' ? (
          <>
            <ActivityFeed feed={activityFeed} actorName={personName} householdName={householdName} />
            {recentEvents.length >= feedLim ? (
              <MoreButton busy={false} onPress={() => setFeedLim((n) => n + FEED_PAGE)} label={t('admin.loadMore')} />
            ) : null}
          </>
        ) : (
          <>
            <View style={{ flexDirection: 'row', gap: sp.sm }}>
              {PERIODS.map((p) => {
                const on = p === days
                return (
                  <Pressable key={p} onPress={() => setDays(p)} style={[s.tab, { backgroundColor: on ? c.text : c.card, borderColor: on ? c.text : c.border }]}>
                    <Txt style={{ fontFamily: fonts.semibold, fontSize: 14, color: on ? c.sheet : c.textMuted }}>{t('admin.days', { n: p })}</Txt>
                  </Pressable>
                )
              })}
            </View>

            <View>
              <Label>{t('admin.appUsage')}</Label>
              <View style={[s.card, { backgroundColor: c.card, borderColor: c.border }]}>
                {usageData.stats.length === 0 ? (
                  <View style={{ padding: sp.lg }}>
                    <Txt variant="faint">{t('admin.noActivity')}</Txt>
                  </View>
                ) : (
                  usageData.stats.map((st, i) => (
                    <View key={st.name} style={[s.row, { borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: c.border }]}>
                      <View style={[s.tile, { backgroundColor: c.surface }]}>
                        <st.icon size={16} color={c.text} />
                      </View>
                      <Txt style={{ flex: 1, fontSize: 15, color: c.text }}>{st.name}</Txt>
                      <Txt variant="muted" style={{ fontSize: 13, fontFamily: fonts.semibold }}>
                        {st.views} · {formatDuration(st.seconds)}
                      </Txt>
                    </View>
                  ))
                )}
              </View>
            </View>

            <View>
              <Label>{t('admin.featureUsage')}</Label>
              <View style={[s.card, { backgroundColor: c.card, borderColor: c.border, paddingVertical: 6 }]}>
                {usageRows.map((r) => (
                  <View key={r.type} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: sp.md, paddingVertical: 6 }}>
                    <Txt style={{ fontSize: 13.5, color: r.n === 0 ? c.textFaint : c.text }}>{humanizeEvent(r.type)}</Txt>
                    <Txt style={{ fontSize: 13.5, fontFamily: fonts.semibold, color: r.n === 0 ? c.textFaint : c.text }}>{r.n}</Txt>
                  </View>
                ))}
              </View>
            </View>

            <View>
              <Label>{t('admin.errors')}</Label>
              <View style={[s.card, { backgroundColor: c.card, borderColor: c.border }]}>
                {usageData.errors.length === 0 ? (
                  <View style={{ padding: sp.lg }}>
                    <Txt variant="faint">{t('admin.noErrors')}</Txt>
                  </View>
                ) : (
                  usageData.errors.map((e, i) => (
                    <View key={e.id} style={[s.row, { alignItems: 'flex-start', borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: c.border }]}>
                      <View style={[s.tile, { backgroundColor: c.expense + '1F' }]}>
                        <Bug size={16} color={c.expense} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Txt style={{ color: c.expense, fontSize: 14 }}>{e.target ?? '—'}</Txt>
                        <Txt variant="faint" style={{ fontSize: 12 }}>
                          {e.path ?? '?'} · {personName(e.user_email)} · {timeAgo(e.created_at)}
                        </Txt>
                      </View>
                    </View>
                  ))
                )}
              </View>
            </View>
          </>
        )}
      </View>
    </Screen>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  const { c } = useTheme()
  return <View style={[s.card, { backgroundColor: c.card, borderColor: c.border, padding: sp.lg, gap: 4 }]}>{children}</View>
}

function Label({ children }: { children: string }) {
  const { c } = useTheme()
  return <Txt style={[s.label, { color: c.textMuted }]}>{children}</Txt>
}

/** One headline number on the gradient. */
function Kpi({ label, big, small, loading }: { label: string; big?: number; small: string | null; loading: boolean }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Txt style={{ fontSize: 12, fontFamily: fonts.semibold, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.75)' }}>
        {label}
      </Txt>
      {loading ? (
        <ActivityIndicator color="#fff" style={{ alignSelf: 'flex-start', marginVertical: 10 }} />
      ) : (
        <Txt style={{ fontFamily: fonts.display, fontSize: 40, lineHeight: 46, color: '#fff' }}>{big ?? '—'}</Txt>
      )}
      <Txt style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)' }}>{small ?? ' '}</Txt>
    </View>
  )
}

/** People per day for the last 7 days, today last and brightest. */
function WeekBars({ daily }: { daily: Overview['daily'] }) {
  const max = Math.max(1, ...daily.map((d) => d.people))
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, height: 86 }}>
      {daily.map((d, i) => {
        const last = i === daily.length - 1
        const [y, m, dd] = d.day.split('-').map(Number)
        const wd = new Date(y, m - 1, dd).toLocaleDateString(undefined, { weekday: 'narrow' })
        return (
          <View key={d.day} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
            <Txt style={{ fontSize: 11, fontFamily: fonts.semibold, color: 'rgba(255,255,255,0.85)' }}>{d.people || ''}</Txt>
            <View
              style={{
                width: '100%',
                height: Math.max(4, (d.people / max) * 52),
                borderRadius: 6,
                backgroundColor: last ? '#fff' : 'rgba(255,255,255,0.35)',
              }}
            />
            <Txt style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>{wd}</Txt>
          </View>
        )
      })}
    </View>
  )
}

function Initials({ name }: { name: string }) {
  const { c } = useTheme()
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const ini = ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?'
  return (
    <View style={[s.tile, { borderRadius: 19, backgroundColor: c.accentSoft }]}>
      <Txt style={{ fontFamily: fonts.semibold, fontSize: 14, color: c.accent }}>{ini}</Txt>
    </View>
  )
}

function MoreButton({ busy, onPress, label }: { busy: boolean; onPress: () => void; label: string }) {
  const { c } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      style={({ pressed }) => [s.more, { borderColor: c.border, opacity: pressed ? 0.6 : 1 }]}
    >
      {busy ? <ActivityIndicator color={c.textMuted} /> : <Txt style={{ fontFamily: fonts.semibold, color: c.text }}>{label}</Txt>}
    </Pressable>
  )
}

/** Cross-household recent-activity list. */
function ActivityFeed({
  feed,
  actorName,
  householdName,
}: {
  feed: FeedItem[]
  actorName: (email: string) => string
  householdName: (id: string | undefined) => string
}) {
  const { c } = useTheme()
  if (feed.length === 0) {
    return (
      <Card>
        <Txt variant="muted">—</Txt>
      </Card>
    )
  }
  return (
    <View style={[s.card, { backgroundColor: c.card, borderColor: c.border }]}>
      {feed.map((f, i) => (
        <View key={f.id} style={[s.row, { alignItems: 'flex-start', borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: c.border }]}>
          <View style={[s.tile, { backgroundColor: f.isError ? c.expense + '1F' : c.surface }]}>
            <f.icon size={16} color={f.isError ? c.expense : c.text} />
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
            <Txt style={{ fontSize: 14, color: c.text }}>
              <Txt style={{ fontSize: 14, fontFamily: fonts.semibold, color: c.text }}>{actorName(f.user_email)}</Txt> {f.predicate}
            </Txt>
            <Txt variant="faint" style={{ fontSize: 12 }}>
              {[householdName(f.household_id), f.app, timeAgo(f.created_at)].filter(Boolean).join(' · ')}
            </Txt>
            {f.detail ? <Txt style={{ color: c.expense, fontSize: 12 }}>{f.detail}</Txt> : null}
          </View>
        </View>
      ))}
    </View>
  )
}

const s = StyleSheet.create({
  round: { width: 40, height: 40, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 38, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth },
  card: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: sp.md, paddingVertical: 12 },
  tile: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase', marginBottom: sp.sm, paddingHorizontal: 2 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 52, paddingHorizontal: sp.md, borderRadius: 26, borderWidth: StyleSheet.hairlineWidth },
  more: { marginTop: sp.sm, height: 46, borderRadius: 23, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
})
