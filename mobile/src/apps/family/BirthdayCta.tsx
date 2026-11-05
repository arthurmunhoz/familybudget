// "<cake> Sam turns 38 · in 12 days" — the Home screen's way into the
// Birthday page, during the month of someone's birthday (HomeBirthdays). On
// the Family page the same thing is the birthday row of the info card
// (MemberDetail), merged into it at the user's request.
import { Pressable, View } from 'react-native'
import { router } from 'expo-router'
import { ChevronRight } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { BirthdayCake } from '@/components/BirthdayCake'
import { useI18n } from '@/hooks/useI18n'
import { nextBirthday } from '@/lib/birthday'
import { radius, sp, useTheme } from '@/theme/theme'

export function BirthdayCta({
  email,
  name,
  birthday,
  today,
}: {
  email: string
  name: string
  birthday: string
  today: string
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const next = nextBirthday(birthday, today)
  const first = name.trim().split(/\s+/)[0] ?? name
  const isToday = next.inDays === 0
  return (
    <Pressable
      onPress={() => router.push(`/family/birthday?email=${encodeURIComponent(email)}`)}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: sp.md,
        padding: sp.md,
        borderRadius: radius.lg,
        backgroundColor: c.accentSoft,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <BirthdayCake size={40} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={{ fontWeight: '700', color: c.text }} numberOfLines={1}>
          {isToday
            ? t('birthday.turnsToday', { name: first, age: next.turning })
            : t('birthday.turns', { name: first, age: next.turning })}
        </Txt>
        <Txt variant="faint" numberOfLines={1}>
          {isToday ? t('birthday.today') : t('birthday.inDays', { count: next.inDays })}
          {' · '}
          {t('birthday.teaserMore')}
        </Txt>
      </View>
      <ChevronRight size={18} color={c.accent} />
    </Pressable>
  )
}
