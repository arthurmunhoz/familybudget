// The expanded body for a member in the Family list: every filled
// member_profiles field, with a call button on the phone row, plus an "Edit my
// info" button on the signed-in user's own card. Rendered inline inside Family's
// expandable card — there is no separate detail screen.
import { Linking, Pressable, View } from 'react-native'
import { Phone } from 'lucide-react-native'

import { formatPhone, formatDay, todayISO } from '@/lib/format'
import { useI18n } from '@/hooks/useI18n'
import { useTheme, sp } from '@/theme/theme'
import { Btn, Txt } from '@/components/ui'
import type { MemberProfile } from '@/lib/types'
import { ageOf, FIELDS, type Member } from './familyShared'

export function MemberDetails({
  member,
  profile,
  isMe,
  onEdit,
}: {
  member: Member
  profile: MemberProfile | undefined
  isMe: boolean
  onEdit: () => void
}) {
  const { t } = useI18n()
  const { c } = useTheme()
  const today = todayISO()
  const age = ageOf(profile?.birthday ?? null, today)

  // `phone` carries the raw dialable number for the row's call button.
  const items: { label: string; value: string; phone?: string }[] = []
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
        ...(key === 'phone' ? { phone: String(v) } : {}),
      })
    }
  }

  // Keep digits and a leading + so formatted numbers dial cleanly.
  function call(raw: string) {
    const dialable = raw.trim().replace(/[^\d+]/g, '')
    if (dialable) void Linking.openURL(`tel:${dialable}`)
  }

  return (
    <View style={{ gap: sp.md }}>
      {items.length > 0 ? (
        <View style={{ gap: sp.md }}>
          {items.map((it, i) => (
            <View key={it.label}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                <Txt variant="faint" style={{ width: 96 }}>
                  {it.label}
                </Txt>
                <Txt style={{ flex: 1 }}>{it.value}</Txt>
                {it.phone ? (
                  <Pressable
                    onPress={() => call(it.phone!)}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={`${t('family.call')} ${member.display_name}`}
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 17,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: c.accentSoft,
                    }}
                  >
                    <Phone size={16} color={c.accent} />
                  </Pressable>
                ) : null}
              </View>
              {i < items.length - 1 ? (
                <View style={{ height: 1, backgroundColor: c.border, marginTop: sp.md }} />
              ) : null}
            </View>
          ))}
        </View>
      ) : (
        <Txt variant="muted">{t('family.empty')}</Txt>
      )}

      {isMe ? (
        <Btn title={t('family.editMine')} variant="secondary" onPress={onEdit} />
      ) : null}
    </View>
  )
}
