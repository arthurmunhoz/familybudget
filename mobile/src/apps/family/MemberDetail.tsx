// Full profile for one household member: large avatar, name, and every filled
// member_profiles field formatted. The signed-in user sees an "Edit my info"
// button on their own profile.
import { View } from 'react-native'

import { formatPhone, formatDay, todayISO } from '@/lib/format'
import { useI18n } from '@/hooks/useI18n'
import { useTheme, sp } from '@/theme/theme'
import { Btn, Card, Screen, AppHeader, Txt } from '@/components/ui'
import type { MemberProfile } from '@/lib/types'
import { Avatar } from './Avatar'
import { ageOf, FIELDS, type Member } from './familyShared'

export function MemberDetail({
  member,
  profile,
  isMe,
  onBack,
  onEdit,
}: {
  member: Member
  profile: MemberProfile | undefined
  isMe: boolean
  onBack: () => void
  onEdit: () => void
}) {
  const { t } = useI18n()
  const { c } = useTheme()
  const today = todayISO()
  const age = ageOf(profile?.birthday ?? null, today)

  const items: { label: string; value: string }[] = []
  if (profile?.birthday) {
    items.push({
      label: t('family.birthday'),
      value:
        formatDay(profile.birthday) +
        (age != null ? ` · ${t('family.yrs', { years: age })}` : ''),
    })
  }
  for (const [key, labelKey] of FIELDS) {
    const v = profile?.[key]
    if (v) {
      items.push({
        label: t(labelKey),
        value: key === 'phone' ? formatPhone(String(v)) : String(v),
      })
    }
  }

  return (
    <Screen scroll>
      <AppHeader title={t('family.title')} onBack={onBack} />

      <View style={{ alignItems: 'center', gap: sp.md, paddingVertical: sp.lg }}>
        <Avatar name={member.display_name} avatarPath={profile?.avatar_path} size={104} zoomable />
        <View style={{ alignItems: 'center', gap: 4 }}>
          <Txt variant="title">{member.display_name}</Txt>
          {isMe ? (
            <View
              style={{
                backgroundColor: c.accentSoft,
                paddingHorizontal: sp.sm,
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
      </View>

      {items.length > 0 ? (
        <Card>
          <View style={{ gap: sp.md }}>
            {items.map((it, i) => (
              <View key={it.label}>
                <View style={{ flexDirection: 'row', gap: sp.md }}>
                  <Txt variant="faint" style={{ width: 96 }}>
                    {it.label}
                  </Txt>
                  <Txt style={{ flex: 1 }}>{it.value}</Txt>
                </View>
                {i < items.length - 1 ? (
                  <View
                    style={{
                      height: 1,
                      backgroundColor: c.border,
                      marginTop: sp.md,
                    }}
                  />
                ) : null}
              </View>
            ))}
          </View>
        </Card>
      ) : (
        <Card>
          <Txt variant="muted">{t('family.empty')}</Txt>
        </Card>
      )}

      {isMe ? (
        <View style={{ marginTop: sp.lg }}>
          <Btn
            title={t('family.editMine')}
            variant="secondary"
            onPress={onEdit}
          />
        </View>
      ) : null}
    </Screen>
  )
}
