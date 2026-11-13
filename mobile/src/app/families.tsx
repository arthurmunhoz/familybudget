// Settings › Casa › "Add another family" (owner, 2026-11): joining by code and
// creating a new family moved out of the Settings card into their own screen,
// with room to explain the rules (migration 104): at most 3 families per
// account; joining is free; creating needs the OWNER of the active family with
// a PAID Plus (the trial doesn't count); the new family rides on that Plus;
// when the plan ends every family it covers goes free together, nothing is
// deleted, and only then can the payer hand it over.
import { useState, type ReactNode } from 'react'
import { Alert, StyleSheet, View } from 'react-native'
import { router } from 'expo-router'
import { ChevronLeft, ChevronRight, CircleAlert, Gift, House, KeyRound, Lock, Plus, Sparkles, UserPlus, Users } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { Card, Screen, Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import { APP_GRADIENT, type Gradient } from '@/components/home/palette'
import { CreateHouseholdSheet, JoinHouseholdSheet } from '@/components/MyHouseholds'
import { MAX_FAMILIES, useFamilies, type CreateGate } from '@/lib/families'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'
import { fonts, radius, sp, useTheme } from '@/theme/theme'

const FAMILY = APP_GRADIENT.family
const PLUS: Gradient = ['#A855F7', '#DB2777']

const GATE_TAG: Record<Exclude<CreateGate, 'ok'>, TKey> = {
  full: 'families.tagFull',
  owner: 'families.tagOwner',
  trial: 'families.tagTrial',
  plus: 'families.tagPlus',
}

const RULES: { icon: typeof Users; title: TKey; body: TKey }[] = [
  { icon: Users, title: 'families.rule1Title', body: 'families.rule1Body' },
  { icon: KeyRound, title: 'families.rule2Title', body: 'families.rule2Body' },
  { icon: Sparkles, title: 'families.rule3Title', body: 'families.rule3Body' },
  { icon: Gift, title: 'families.rule4Title', body: 'families.rule4Body' },
  { icon: CircleAlert, title: 'families.rule5Title', body: 'families.rule5Body' },
  { icon: House, title: 'families.rule6Title', body: 'families.rule6Body' },
]

export default function FamiliesScreen() {
  const { c } = useTheme()
  const { t } = useI18n()
  const { count, full, gate, revalidate } = useFamilies()
  const [joining, setJoining] = useState(false)
  const [creating, setCreating] = useState(false)

  function done() {
    setJoining(false)
    setCreating(false)
    void revalidate()
    if (router.canGoBack()) router.back()
  }

  function startCreate() {
    if (gate === 'ok') {
      setCreating(true)
      return
    }
    if (gate === 'full') {
      Alert.alert(t('households.limitReached'))
      return
    }
    if (gate === 'owner') {
      Alert.alert(t('households.plusTitle'), t('households.plusOwnerBody'))
      return
    }
    Alert.alert(t('households.plusTitle'), t(gate === 'trial' ? 'households.plusTrialBody' : 'households.plusBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('households.seePlus'), onPress: () => router.push('/paywall') },
    ])
  }

  return (
    <Screen
      scroll
      header={
        <View style={{ flexDirection: 'row', paddingVertical: sp.sm }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/settings'))}
            hitSlop={8}
            style={({ pressed }) => [s.back, { borderColor: c.border, backgroundColor: c.card, opacity: pressed ? 0.7 : 1 }]}
          >
            <ChevronLeft size={22} color={c.text} />
          </Pressable>
        </View>
      }
    >
      <View style={{ gap: sp.xl }}>
        <View>
          <Txt style={{ fontFamily: fonts.display, fontSize: 36, lineHeight: 42, letterSpacing: -0.8, color: c.text }}>
            {t('families.title')}
          </Txt>
          <Txt style={{ fontFamily: fonts.display, fontSize: 20, lineHeight: 26, color: c.textFaint }}>
            {t('families.state', { count, max: MAX_FAMILIES })}
          </Txt>
        </View>

        {/* what this is, in one card */}
        <GradientBox colors={FAMILY} radius={24} style={{ padding: sp.lg, gap: sp.sm }}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {Array.from({ length: MAX_FAMILIES }, (_, i) => (
              <View key={i} style={[s.slot, { backgroundColor: i < count ? '#fff' : 'rgba(255,255,255,0.28)' }]}>
                <House size={16} color={i < count ? FAMILY[1] : '#fff'} />
              </View>
            ))}
          </View>
          <Txt style={{ fontFamily: fonts.display, fontSize: 22, lineHeight: 28, color: '#fff', marginTop: sp.xs }}>
            {t('families.heroTitle', { max: MAX_FAMILIES })}
          </Txt>
          <Txt style={{ fontSize: 14.5, lineHeight: 20, color: 'rgba(255,255,255,0.92)' }}>{t('families.heroBody')}</Txt>
        </GradientBox>

        {/* the two ways in */}
        <View style={{ gap: sp.sm }}>
          <Label>{t('families.waysTitle')}</Label>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <Way
              icon={<UserPlus size={21} color="#fff" />}
              colors={FAMILY}
              title={t('families.joinTitle')}
              sub={t('families.joinSub')}
              tag={full ? t('families.tagFull') : t('families.tagFree')}
              tagMuted={full}
              onPress={() => (full ? Alert.alert(t('households.limitReached')) : setJoining(true))}
            />
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: sp.md + 44 + sp.md }} />
            <Way
              icon={<Plus size={22} color="#fff" strokeWidth={2.5} />}
              colors={PLUS}
              title={t('families.createTitle')}
              sub={t('families.createSub')}
              tag={gate === 'ok' ? t('families.tagIncluded') : t(GATE_TAG[gate])}
              tagMuted={gate !== 'ok'}
              locked={gate !== 'ok'}
              onPress={startCreate}
            />
          </Card>
        </View>

        {/* the rules, spelled out */}
        <View style={{ gap: sp.sm }}>
          <Label>{t('families.howTitle')}</Label>
          <Card style={{ padding: sp.md, gap: sp.md + 2 }}>
            {RULES.map((r) => (
              <View key={r.title} style={{ flexDirection: 'row', gap: sp.md }}>
                <View style={[s.ruleIcon, { backgroundColor: FAMILY[0] + '26' }]}>
                  <r.icon size={17} color={FAMILY[1]} />
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Txt style={{ fontFamily: fonts.semibold, color: c.text }}>{t(r.title, { max: MAX_FAMILIES })}</Txt>
                  <Txt variant="faint" style={{ fontSize: 13.5, lineHeight: 19 }}>
                    {t(r.body)}
                  </Txt>
                </View>
              </View>
            ))}
          </Card>
        </View>
      </View>

      {joining ? <JoinHouseholdSheet onClose={() => setJoining(false)} onJoined={done} /> : null}
      {creating ? <CreateHouseholdSheet onClose={() => setCreating(false)} onCreated={done} /> : null}
    </Screen>
  )
}

function Label({ children }: { children: ReactNode }) {
  const { c } = useTheme()
  return (
    <Txt style={{ fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase', color: c.textMuted, paddingHorizontal: 2 }}>
      {children}
    </Txt>
  )
}

function Way({
  icon,
  colors,
  title,
  sub,
  tag,
  tagMuted,
  locked = false,
  onPress,
}: {
  icon: ReactNode
  colors: Gradient
  title: string
  sub: string
  tag: string
  tagMuted: boolean
  locked?: boolean
  onPress: () => void
}) {
  const { c } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [s.way, { opacity: pressed ? 0.6 : 1 }]}>
      <GradientBox colors={colors} radius={14} style={s.wayTile}>
        {icon}
      </GradientBox>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Txt style={{ fontFamily: fonts.semibold, fontSize: 16, color: c.text }}>{title}</Txt>
        <Txt variant="faint" style={{ fontSize: 13, lineHeight: 18 }}>
          {sub}
        </Txt>
        <View style={[s.tag, { backgroundColor: tagMuted ? c.surface2 : c.income + '22' }]}>
          {locked ? <Lock size={11} color={c.textMuted} /> : null}
          <Txt style={{ fontSize: 11.5, fontFamily: fonts.semibold, color: tagMuted ? c.textMuted : c.income }}>{tag}</Txt>
        </View>
      </View>
      <ChevronRight size={18} color={c.textFaint} />
    </Pressable>
  )
}

const s = StyleSheet.create({
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slot: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  way: { flexDirection: 'row', alignItems: 'center', gap: sp.md, padding: sp.md },
  wayTile: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, marginTop: 4 },
  ruleIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
})
