// Family module: one screen listing every household member (avatar + name + a
// hint line). Tapping a member expands their row in place to reveal the full
// profile card — there is no separate detail screen. The signed-in user can edit
// their own profile and avatar; everyone can read all profiles (RLS scopes both
// reads and writes).
import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { ChevronDown, ChevronRight } from 'lucide-react-native'

import { supabase } from '@/lib/supabase'
import { getSignedUrl } from '@/lib/signedUrls'
import { formatPhone, todayISO } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { useI18n } from '@/hooks/useI18n'
import { useTheme, sp } from '@/theme/theme'
import { Screen, AppHeader, Card, Txt, Loader, EmptyState } from '@/components/ui'
import type { MemberProfile } from '@/lib/types'
import { Avatar } from './Avatar'
import { MemberDetails } from './MemberDetail'
import { EditProfile } from './EditProfile'
import { ageOf, type Member } from './familyShared'

export default function Family() {
  const { profile, profiles } = useAuth()
  const { t } = useI18n()
  const { c } = useTheme()
  const today = todayISO()

  // Which member's card is expanded (accordion — one open at a time).
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [initialPhoto, setInitialPhoto] = useState<string | null>(null)

  // The member list comes from useAuth().profiles, which is scoped to MY
  // household. Do NOT query allowed_users directly here — its RLS lets an admin
  // read every household, so a raw select would leak other households into this
  // screen (member_profiles below is safe: its RLS has no admin exception).
  const members: Member[] = [...profiles]
    .map((p) => ({ email: p.email, display_name: p.display_name, is_admin: p.is_admin }))
    .sort((a, b) => a.display_name.localeCompare(b.display_name))

  // Member profile rows (RLS scopes member_profiles to my household), cached so
  // the screen renders instantly on return; revalidate() refetches after edits.
  const {
    data: byEmail = {},
    loading,
    revalidate: load,
  } = useCachedQuery<Record<string, MemberProfile>>('family:profiles', async () => {
    const { data: rowsData } = await supabase.from('member_profiles').select('*')
    const rows = (rowsData ?? []) as MemberProfile[]
    return Object.fromEntries(rows.map((p) => [p.email, p]))
  })

  async function openEditMine() {
    if (!profile) return
    const mine = byEmail[profile.email]
    setInitialPhoto(mine?.avatar_path ? await getSignedUrl(mine.avatar_path) : null)
    setEditing(true)
  }

  return (
    <Screen scroll header={<AppHeader title={t('family.title')} />}>
      {loading || profiles.length === 0 ? (
        <Loader />
      ) : members.length === 0 ? (
        <EmptyState title={t('family.title')} subtitle={t('family.empty')} />
      ) : (
        <View style={{ gap: sp.md, marginTop: sp.sm }}>
          {members.map((m) => {
            const p = byEmail[m.email]
            const isMe = m.email === profile?.email
            const isOpen = expanded === m.email
            const age = ageOf(p?.birthday ?? null, today)
            // A short hint line under the name (collapsed only): age, else phone.
            const hint =
              age != null
                ? t('family.yrs', { years: age })
                : p?.phone
                  ? formatPhone(p.phone)
                  : null
            return (
              <Card key={m.email}>
                <Pressable
                  onPress={() => setExpanded(isOpen ? null : m.email)}
                  accessibilityRole="button"
                  style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}
                >
                  <Avatar name={m.display_name} avatarPath={p?.avatar_path} size={48} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
                      <Txt variant="h2" numberOfLines={1} style={{ flexShrink: 1 }}>
                        {m.display_name}
                      </Txt>
                      {isMe ? (
                        <View
                          style={{
                            backgroundColor: c.accentSoft,
                            paddingHorizontal: 8,
                            paddingVertical: 2,
                            borderRadius: 999,
                          }}
                        >
                          <Txt style={{ color: c.accent, fontWeight: '700', fontSize: 11 }}>
                            {t('family.you')}
                          </Txt>
                        </View>
                      ) : null}
                    </View>
                    {!isOpen && hint ? <Txt variant="muted">{hint}</Txt> : null}
                  </View>
                  {isOpen ? (
                    <ChevronDown size={20} color={c.textFaint} />
                  ) : (
                    <ChevronRight size={20} color={c.textFaint} />
                  )}
                </Pressable>

                {isOpen ? (
                  <View
                    style={{
                      marginTop: sp.md,
                      paddingTop: sp.md,
                      borderTopWidth: 1,
                      borderTopColor: c.border,
                    }}
                  >
                    <MemberDetails member={m} profile={p} isMe={isMe} onEdit={openEditMine} />
                  </View>
                ) : null}
              </Card>
            )
          })}
        </View>
      )}

      {editing && profile ? (
        <EditProfile
          profile={profile}
          mine={byEmail[profile.email]}
          initialPhoto={initialPhoto}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            load()
          }}
        />
      ) : null}
    </Screen>
  )
}
