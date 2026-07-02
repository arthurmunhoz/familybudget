// Family module: list every household member (avatar + name + a hint line), tap
// one to view their full profile. The signed-in user can edit their own profile
// and avatar; everyone can read all profiles (RLS scopes both reads and writes).
import { useCallback, useEffect, useState } from 'react'
import { View } from 'react-native'
import { ChevronRight } from 'lucide-react-native'

import { supabase } from '@/lib/supabase'
import { getSignedUrl } from '@/lib/signedUrls'
import { formatPhone, todayISO } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/hooks/useI18n'
import { useTheme, sp } from '@/theme/theme'
import { Screen, AppHeader, Card, Txt, Loader, EmptyState } from '@/components/ui'
import type { MemberProfile } from '@/lib/types'
import { Avatar } from './Avatar'
import { MemberDetail } from './MemberDetail'
import { EditProfile } from './EditProfile'
import { ageOf, type Member } from './familyShared'

export default function Family() {
  const { profile, profiles } = useAuth()
  const { t } = useI18n()
  const { c } = useTheme()
  const today = todayISO()

  const [byEmail, setByEmail] = useState<Record<string, MemberProfile>>({})
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [initialPhoto, setInitialPhoto] = useState<string | null>(null)

  // The member list comes from useAuth().profiles, which is scoped to MY
  // household. Do NOT query allowed_users directly here — its RLS lets an admin
  // read every household, so a raw select would leak other households into this
  // screen (member_profiles below is safe: its RLS has no admin exception).
  const members: Member[] = [...profiles]
    .map((p) => ({ email: p.email, display_name: p.display_name, is_admin: p.is_admin }))
    .sort((a, b) => a.display_name.localeCompare(b.display_name))

  const load = useCallback(async () => {
    // Member profile rows (RLS scopes member_profiles to my household).
    const { data: rowsData } = await supabase.from('member_profiles').select('*')
    const rows = (rowsData ?? []) as MemberProfile[]
    const map = Object.fromEntries(rows.map((p) => [p.email, p]))

    setByEmail(map)
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function openEditMine() {
    if (!profile) return
    const mine = byEmail[profile.email]
    setInitialPhoto(mine?.avatar_path ? await getSignedUrl(mine.avatar_path) : null)
    setEditing(true)
  }

  // Detail view for the tapped member.
  if (selected) {
    const member = members.find((m) => m.email === selected)
    if (member) {
      const isMe = member.email === profile?.email
      return (
        <>
          <MemberDetail
            member={member}
            profile={byEmail[member.email]}
            isMe={isMe}
            onBack={() => setSelected(null)}
            onEdit={openEditMine}
          />
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
        </>
      )
    }
  }

  return (
    <Screen scroll>
      <AppHeader title={t('family.title')} />
      {loading || profiles.length === 0 ? (
        <Loader />
      ) : members.length === 0 ? (
        <EmptyState title={t('family.title')} subtitle={t('family.empty')} />
      ) : (
        <View style={{ gap: sp.md, marginTop: sp.sm }}>
          {members.map((m) => {
            const p = byEmail[m.email]
            const isMe = m.email === profile?.email
            const age = ageOf(p?.birthday ?? null, today)
            // A short hint line under the name: age, else phone, else nothing.
            const hint =
              age != null
                ? t('family.yrs', { years: age })
                : p?.phone
                  ? formatPhone(p.phone)
                  : null
            return (
              <Card key={m.email} onPress={() => setSelected(m.email)}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
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
                    {hint ? <Txt variant="muted">{hint}</Txt> : null}
                  </View>
                  <ChevronRight size={20} color={c.textFaint} />
                </View>
              </Card>
            )
          })}
        </View>
      )}
    </Screen>
  )
}
