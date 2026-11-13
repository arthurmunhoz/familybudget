// The household on the Home, under the greeting (owner, 2026-11: it moved up
// from the bottom dock, which is Roof's now). Each member is a tinted initial
// with their first name — tap for their page — and "Family" opens the app.
// Scrolls sideways when the family is bigger than the row.
import { ScrollView, StyleSheet, View } from 'react-native'
import { router } from 'expo-router'
import { ChevronRight } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { memberColor } from '@/lib/calendar'
import type { Profile } from '@/lib/types'
import { fonts, sp, useTheme } from '@/theme/theme'

export function FamilyStrip({ members, emails, me }: { members: Profile[]; emails: string[]; me?: string }) {
  const { c } = useTheme()
  const { t } = useI18n()
  return (
    <View style={s.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={s.row}>
        {members.length === 0
          ? [0, 1].map((i) => <View key={i} style={[s.avatar, { backgroundColor: c.surface2 }]} />)
          : members.map((p) => {
              const tint = memberColor(p.email, emails)
              const first = (p.display_name || p.email).trim().split(/\s+/)[0]
              return (
                <Pressable
                  key={p.email}
                  accessibilityLabel={p.display_name}
                  onPress={() => router.push(`/family?email=${encodeURIComponent(p.email)}`)}
                  style={({ pressed }) => [s.member, { opacity: pressed ? 0.6 : 1 }]}
                >
                  <View style={[s.avatar, { backgroundColor: tint + '2E', borderColor: p.email === me ? tint : 'transparent' }]}>
                    <Txt style={{ fontFamily: fonts.display, fontSize: 18, color: tint }}>{first.charAt(0).toUpperCase()}</Txt>
                  </View>
                  <Txt numberOfLines={1} style={{ fontSize: 12, fontFamily: fonts.medium, color: c.textMuted, maxWidth: 64 }}>
                    {p.email === me ? t('home.you') : first}
                  </Txt>
                </Pressable>
              )
            })}
      </ScrollView>
      <Pressable
        onPress={() => router.push('/family')}
        accessibilityRole="button"
        style={({ pressed }) => [s.family, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}
      >
        <Txt style={{ fontFamily: fonts.semibold, fontSize: 14, color: c.text }}>{t('home.family')}</Txt>
        <ChevronRight size={16} color={c.textMuted} />
      </Pressable>
    </View>
  )
}

const s = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: sp.lg },
  row: { alignItems: 'flex-start', gap: 14, paddingRight: sp.sm },
  member: { alignItems: 'center', gap: 4 },
  avatar: { width: 48, height: 48, borderRadius: 24, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  family: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 40,
    paddingLeft: 14,
    paddingRight: 10,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    marginLeft: 'auto',
    marginBottom: 18,
  },
})
