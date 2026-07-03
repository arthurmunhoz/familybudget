// Admin-only: usage analytics + household/member management. RN port of the
// PWA's Admin page. Reuses the same admin-guarded RPCs (admin_household_activity,
// admin_app_usage/time, admin_recent_errors) — RLS + the security-definer guards
// keep this cross-household data admin-only.
import { useMemo, useState } from 'react'
import { Alert, Pressable, ScrollView, TextInput, View } from 'react-native'
import { Redirect, router } from 'expo-router'
import {
  BarChart3,
  Bell,
  Bug,
  Calculator,
  CalendarDays,
  CalendarHeart,
  ChevronRight,
  FolderLock,
  Home,
  LayoutGrid,
  PawPrint,
  Plus,
  ShoppingCart,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react-native'

import { AppHeader, Card, Loader, Screen, Txt } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { formatDuration, timeAgo } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import type { Household, Profile } from '@/lib/types'
import { radius, sp, useTheme } from '@/theme/theme'

interface AppStat {
  name: string
  icon: LucideIcon
  views: number
  seconds: number
}

// Route root → app name + icon, kept in sync with the hub apps.
const APP_META: Record<string, { name: string; icon: LucideIcon }> = {
  '': { name: 'Hub', icon: Home },
  budget: { name: 'Money', icon: Wallet },
  month: { name: 'Money', icon: Wallet },
  shopping: { name: 'Shopping', icon: ShoppingCart },
  pings: { name: 'Nudges', icon: Bell },
  pets: { name: 'Pets', icon: PawPrint },
  docs: { name: 'Documents', icon: FolderLock },
  calendar: { name: 'Calendar', icon: CalendarDays },
  dates: { name: 'Dates', icon: CalendarHeart },
  family: { name: 'Family', icon: Users },
  calc: { name: 'Calculator', icon: Calculator },
}

const PERIODS = [7, 30, 90]
type Tab = 'analytics' | 'households'
type SortKey = 'name' | 'created' | 'active'
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'A–Z' },
  { key: 'created', label: 'Newest' },
  { key: 'active', label: 'Last active' },
]

type BaseData = { households: Household[]; users: Profile[]; hhLastSeen: Record<string, string> }
type ErrorRow = {
  id: number
  user_email: string
  target: string | null
  path: string | null
  created_at: string
}
type AnalyticsData = { stats: AppStat[]; errors: ErrorRow[] }

export default function Admin() {
  const { c } = useTheme()
  const { profile } = useAuth()
  const [tab, setTab] = useState<Tab>('households')
  const [days, setDays] = useState(30)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('active')
  const [newHousehold, setNewHousehold] = useState('')
  const [busy, setBusy] = useState(false)

  const {
    data: base = { households: [], users: [], hhLastSeen: {} },
    loading,
    revalidate: revalidateBase,
  } = useCachedQuery<BaseData>('admin:base', async () => {
    const [h, u, hh] = await Promise.all([
      supabase.from('households').select('*').eq('is_internal', false).order('created_at'),
      supabase.from('allowed_users').select('email, display_name, household_id, is_admin'),
      supabase.rpc('admin_household_activity'),
    ])
    return {
      households: (h.data ?? []) as Household[],
      users: (u.data ?? []) as Profile[],
      hhLastSeen: Object.fromEntries(
        ((hh.data ?? []) as { household_id: string; last_seen: string }[]).map((r) => [
          r.household_id,
          r.last_seen,
        ]),
      ),
    }
  })
  const { households, users, hhLastSeen } = base

  const { data: analytics = { stats: [], errors: [] } } = useCachedQuery<AnalyticsData>(
    `admin:analytics:${days}`,
    async () => {
      const [use, time, errs] = await Promise.all([
        supabase.rpc('admin_app_usage', { days }),
        supabase.rpc('admin_app_time', { days }),
        supabase.rpc('admin_recent_errors', { lim: 10 }),
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
      }
    },
  )
  const { stats, errors } = analytics

  const visibleHouseholds = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = households
    if (q) {
      list = list.filter(
        (h) =>
          h.name.toLowerCase().includes(q) ||
          users.some(
            (u) =>
              u.household_id === h.id &&
              (u.display_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)),
          ),
      )
    }
    return [...list].sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name)
      if (sortKey === 'created') return b.created_at.localeCompare(a.created_at)
      return (hhLastSeen[b.id] ?? '').localeCompare(hhLastSeen[a.id] ?? '')
    })
  }, [households, users, search, sortKey, hhLastSeen])

  const profileName = (email: string) =>
    users.find((u) => u.email === email)?.display_name ?? email

  async function createHousehold() {
    const name = newHousehold.trim()
    if (!name || busy) return
    setBusy(true)
    const { error } = await supabase.from('households').insert({ name })
    setBusy(false)
    if (error) {
      Alert.alert('Could not create the household — please try again.')
      return
    }
    setNewHousehold('')
    revalidateBase()
  }

  // Admins only — anyone else is bounced to the hub.
  if (profile && !profile.is_admin) return <Redirect href="/" />

  const inputStyle = {
    backgroundColor: c.card,
    borderRadius: radius.md,
    paddingHorizontal: sp.md,
    paddingVertical: 12,
    fontSize: 16,
    color: c.text,
  } as const

  return (
    <Screen scroll header={<AppHeader title="Admin" />}>
      {/* tabs */}
      <View style={{ flexDirection: 'row', gap: sp.sm, backgroundColor: c.surface, borderRadius: radius.md, padding: 4, marginBottom: sp.md }}>
        {([
          { key: 'households', label: 'Households', icon: Home },
          { key: 'analytics', label: 'Analytics', icon: BarChart3 },
        ] as { key: Tab; label: string; icon: LucideIcon }[]).map((tb) => {
          const on = tab === tb.key
          return (
            <Pressable
              key={tb.key}
              onPress={() => setTab(tb.key)}
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                paddingVertical: 8,
                borderRadius: radius.sm,
                backgroundColor: on ? c.accent : 'transparent',
              }}
            >
              <tb.icon size={16} color={on ? '#fff' : c.textMuted} />
              <Txt style={{ fontWeight: '700', color: on ? '#fff' : c.textMuted }}>{tb.label}</Txt>
            </Pressable>
          )
        })}
      </View>

      {loading ? (
        <Loader />
      ) : tab === 'analytics' ? (
        <View style={{ gap: sp.md }}>
          <Pills values={PERIODS} value={days} onChange={setDays} label={(p) => `${p} days`} />

          <Card style={{ gap: sp.sm }}>
            <Txt style={{ fontWeight: '700', flexDirection: 'row' }}>App usage</Txt>
            {stats.length === 0 ? (
              <Txt variant="faint">No activity in this period yet.</Txt>
            ) : (
              stats.map((s) => (
                <View key={s.name} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
                    <s.icon size={16} color={c.accent} />
                    <Txt>{s.name}</Txt>
                  </View>
                  <Txt variant="muted" style={{ fontWeight: '600' }}>
                    {s.views} {s.views === 1 ? 'view' : 'views'} · {formatDuration(s.seconds)}
                  </Txt>
                </View>
              ))
            )}
            <Txt variant="faint" style={{ fontSize: 11 }}>
              Admin accounts and internal test households are excluded. Time is estimated from
              activity gaps (idle capped at 5 min).
            </Txt>
          </Card>

          <Card style={{ gap: sp.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
              <Bug size={18} color={c.text} />
              <Txt style={{ fontWeight: '700' }}>Recent errors</Txt>
            </View>
            {errors.length === 0 ? (
              <Txt variant="faint">No errors reported. 🎉</Txt>
            ) : (
              errors.map((e) => (
                <View key={e.id} style={{ gap: 2 }}>
                  <Txt style={{ color: c.expense, fontWeight: '500' }}>{e.target ?? 'Unknown error'}</Txt>
                  <Txt variant="faint" style={{ fontSize: 11 }}>
                    {e.path ?? '?'} · {profileName(e.user_email)} · {timeAgo(e.created_at)}
                  </Txt>
                </View>
              ))
            )}
          </Card>
        </View>
      ) : (
        <View style={{ gap: sp.md }}>
          {/* create household */}
          <Card style={{ gap: sp.sm, borderColor: c.accentSoft }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Plus size={16} color={c.textMuted} />
              <Txt variant="label">New household</Txt>
            </View>
            <View style={{ flexDirection: 'row', gap: sp.sm }}>
              <TextInput
                value={newHousehold}
                onChangeText={setNewHousehold}
                onSubmitEditing={createHousehold}
                placeholder="Family name…"
                placeholderTextColor={c.textFaint}
                style={[inputStyle, { flex: 1, backgroundColor: c.surface }]}
              />
              <Pressable
                onPress={createHousehold}
                disabled={!newHousehold.trim() || busy}
                style={{
                  paddingHorizontal: sp.lg,
                  borderRadius: radius.md,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: c.accent,
                  opacity: !newHousehold.trim() || busy ? 0.5 : 1,
                }}
              >
                <Txt style={{ color: '#fff', fontWeight: '700' }}>Create</Txt>
              </Pressable>
            </View>
          </Card>

          {/* search */}
          <View style={{ justifyContent: 'center' }}>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search households or members…"
              placeholderTextColor={c.textFaint}
              autoCapitalize="none"
              style={inputStyle}
            />
            {search ? (
              <Pressable
                onPress={() => setSearch('')}
                hitSlop={8}
                style={{ position: 'absolute', right: sp.md }}
                accessibilityLabel="Clear search"
              >
                <X size={16} color={c.textFaint} />
              </Pressable>
            ) : null}
          </View>

          <Pills values={SORTS.map((s) => s.key)} value={sortKey} onChange={setSortKey} label={(k) => SORTS.find((s) => s.key === k)!.label} />

          {visibleHouseholds.length === 0 ? (
            <Txt variant="faint" style={{ textAlign: 'center', marginTop: sp.lg }}>
              {search ? `No households match "${search}".` : 'No households yet.'}
            </Txt>
          ) : (
            visibleHouseholds.map((h) => {
              const memberCount = users.filter((u) => u.household_id === h.id).length
              return (
                <Card key={h.id} onPress={() => router.push(`/admin/household/${h.id}`)}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Home size={16} color={c.text} />
                        <Txt style={{ fontWeight: '700' }} numberOfLines={1}>
                          {h.name}
                        </Txt>
                      </View>
                      <Txt variant="faint" style={{ fontSize: 11 }}>
                        {memberCount} {memberCount === 1 ? 'member' : 'members'} ·{' '}
                        {hhLastSeen[h.id] ? `active ${timeAgo(hhLastSeen[h.id])}` : 'no activity yet'}
                      </Txt>
                    </View>
                    <ChevronRight size={20} color={c.textFaint} />
                  </View>
                </Card>
              )
            })
          )}
        </View>
      )}
    </Screen>
  )
}

/** A row of pill toggles (period / sort). */
function Pills<T extends string | number>({
  values,
  value,
  onChange,
  label,
}: {
  values: readonly T[]
  value: T
  onChange: (v: T) => void
  label: (v: T) => string
}) {
  const { c } = useTheme()
  return (
    <View style={{ flexDirection: 'row', gap: sp.sm }}>
      {values.map((v) => {
        const on = v === value
        return (
          <Pressable
            key={String(v)}
            onPress={() => onChange(v)}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 6,
              borderRadius: radius.pill,
              backgroundColor: on ? c.accent : c.surface,
            }}
          >
            <Txt style={{ fontWeight: '700', color: on ? '#fff' : c.textMuted }}>{label(v)}</Txt>
          </Pressable>
        )
      })}
    </View>
  )
}
