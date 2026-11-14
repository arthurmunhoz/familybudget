// Settings › Modo Casa (owner, 2026-11): its own screen, in the shape of
// "Another family" (/families). Hero art that says the point — ANY device with
// internet becomes the family's hub, nothing to buy —, then the family's
// devices (pair, unpair, Money PIN: components/CasaSettings) and the rules:
// free = 1 device, 30 full days from the first, then it only shows the day;
// Plus = as many devices as the family wants (api/widget.ts CASA_DEVICES_PLUS
// is only an abuse ceiling). Never "tablet" in copy — "dispositivo".
import { useState, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { ChevronLeft, Globe, QrCode, Smartphone, Sparkles, Timer, Unlink } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { Card, Screen, Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import { CasaPinCard, CasaSettings } from '@/components/CasaSettings'
import { CasaDevicesArt } from '@/components/CasaDevicesArt'
import { useI18n } from '@/hooks/useI18n'
import { CASA_LOOK as CASA, CASA_URL } from '@/lib/casa'
import type { TKey } from '@/lib/i18n'
import { fonts, sp, useTheme } from '@/theme/theme'

const RULES: { icon: typeof Globe; title: TKey; body: TKey }[] = [
  { icon: Smartphone, title: 'casa.rule1Title', body: 'casa.rule1Body' },
  { icon: QrCode, title: 'casa.rule2Title', body: 'casa.rule2Body' },
  { icon: Timer, title: 'casa.rule3Title', body: 'casa.rule3Body' },
  { icon: Sparkles, title: 'casa.rule4Title', body: 'casa.rule4Body' },
  { icon: Unlink, title: 'casa.rule6Title', body: 'casa.rule6Body' },
]

export default function CasaModeScreen() {
  const { c } = useTheme()
  const { t } = useI18n()
  const { pair } = useLocalSearchParams<{ pair?: string }>()
  const [count, setCount] = useState<number | null>(null)
  const state =
    count === null ? ' ' : count === 0 ? t('casa.stateNone') : count === 1 ? t('casa.pairedOne') : t('casa.pairedMany', { n: count })

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
            {t('casa.title')}
          </Txt>
          <Txt style={{ fontFamily: fonts.display, fontSize: 20, lineHeight: 26, color: c.textFaint }}>{state}</Txt>
        </View>

        <GradientBox colors={CASA} radius={24} style={{ padding: sp.lg, gap: sp.sm, overflow: 'hidden' }}>
          <CasaDevicesArt />
          <Txt style={{ fontFamily: fonts.display, fontSize: 22, lineHeight: 28, color: '#fff', marginTop: sp.xs }}>
            {t('casa.heroTitle')}
          </Txt>
          <Txt style={{ fontSize: 14.5, lineHeight: 20, color: 'rgba(255,255,255,0.92)' }}>{t('casa.heroBody')}</Txt>
          <View style={s.url}>
            <Globe size={14} color="#fff" />
            <Txt style={{ fontFamily: fonts.semibold, fontSize: 13.5, color: '#fff' }}>{CASA_URL}</Txt>
          </View>
        </GradientBox>

        <View style={{ gap: sp.sm }}>
          <Label>{t('casa.devicesTitle')}</Label>
          <Card>
            <CasaSettings pairCode={pair} onCount={setCount} />
          </Card>
        </View>

        <View style={{ gap: sp.sm }}>
          <Label>{t('casa.moneyTitle')}</Label>
          <Card>
            <CasaPinCard />
          </Card>
        </View>

        <View style={{ gap: sp.sm }}>
          <Label>{t('families.howTitle')}</Label>
          <Card style={{ padding: sp.md, gap: sp.md + 2 }}>
            {RULES.map((r) => (
              <View key={r.title} style={{ flexDirection: 'row', gap: sp.md }}>
                <View style={[s.ruleIcon, { backgroundColor: CASA[0] + '26' }]}>
                  <r.icon size={17} color={CASA[1]} />
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Txt style={{ fontFamily: fonts.semibold, color: c.text }}>{t(r.title)}</Txt>
                  <Txt variant="faint" style={{ fontSize: 13.5, lineHeight: 19 }}>
                    {t(r.body, { url: CASA_URL })}
                  </Txt>
                </View>
              </View>
            ))}
          </Card>
        </View>
      </View>
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

const s = StyleSheet.create({
  back: { width: 40, height: 40, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  ruleIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  url: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginTop: sp.xs,
  },
})
