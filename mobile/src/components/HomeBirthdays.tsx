// Home: a birthday card for each member whose birthday falls later THIS
// calendar month (or today) — the Family page's "Sam turns 38" card, brought
// forward for the month that matters. Renders nothing the rest of the year.
import { useCallback } from 'react'
import { View } from 'react-native'
import { useFocusEffect } from 'expo-router'

import { BirthdayCta } from '@/apps/family/BirthdayCta'
import { useAuth } from '@/lib/auth'
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { useToday } from '@/hooks/useToday'
import { birthdayThisMonth, nextBirthday } from '@/lib/birthday'
import { supabase } from '@/lib/supabase'
import { sp } from '@/theme/theme'

export default function HomeBirthdays() {
  const { profiles } = useAuth()
  const today = useToday()
  const { data: rows = [], revalidate } = useCachedQuery<{ email: string; birthday: string | null }[]>(
    'hub:birthdays',
    async () => {
      const { data } = await supabase.from('member_profiles').select('email, birthday')
      return (data ?? []) as { email: string; birthday: string | null }[]
    },
  )
  // A birthday edited on Family should show up when you come back Home.
  useFocusEffect(
    useCallback(() => {
      void revalidate()
    }, [revalidate]),
  )

  const due = rows
    .filter((r): r is { email: string; birthday: string } => !!r.birthday && birthdayThisMonth(r.birthday, today))
    .map((r) => ({ ...r, name: profiles.find((p) => p.email === r.email)?.display_name }))
    .filter((r): r is { email: string; birthday: string; name: string } => !!r.name)
    .sort((a, b) => nextBirthday(a.birthday, today).inDays - nextBirthday(b.birthday, today).inDays)

  if (!due.length) return null
  return (
    <View style={{ gap: sp.sm, marginBottom: sp.md }}>
      {due.map((r) => (
        <BirthdayCta key={r.email} email={r.email} name={r.name} birthday={r.birthday} today={today} />
      ))}
    </View>
  )
}
