// Settings › Modo Casa (owner, 2026-11): its own screen, in the shape of
// "Another family" (/families). Hero art that says the point — ANY device with
// internet becomes the family's hub, nothing to buy —, then the family's
// devices (pair, unpair, Money PIN: components/CasaSettings), three pairing
// steps and the two plans side by side (2026-11-15 restyle). The rules:
// free = 1 device, 30 full days from the first, then it only shows the day;
// Plus = as many devices as the family wants (api/widget.ts CASA_DEVICES_PLUS
// is only an abuse ceiling). Never "tablet" in copy — "dispositivo".
import { useState, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { Award, Check, ChevronLeft, Globe, Lock } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { Card, Screen, Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import { CasaPinCard, CasaSettings } from '@/components/CasaSettings'
import { CasaDevicesArt } from '@/components/CasaDevicesArt'
import { useI18n } from '@/hooks/useI18n'
import { CASA_LOOK as CASA, CASA_URL } from '@/lib/casa'
import { usePlus } from '@/lib/plus'
import type { TKey } from '@/lib/i18n'
import { fonts, sp, useTheme } from '@/theme/theme'

const STEPS: TKey[] = ['casa.step1', 'casa.step2', 'casa.step3']
// Settings' Plus card colours (app/settings.tsx PLUS_GRADIENT) — keep in step.
const PLUS_GRADIENT = ['#8E6CF0', '#C2468E'] as const
const PLUS_POINTS: TKey[] = ['casa.plusPoint1', 'casa.plusPoint2', 'casa.plusPoint3']

export default function CasaModeScreen() {
  const { c } = useTheme()
  const { t } = useI18n()
  const { pair } = useLocalSearchParams<{ pair?: string }>()
  const { isPlus, isTrial } = usePlus()
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

        <GradientBox colors={CASA} radius={26} style={{ padding: sp.lg, gap: sp.sm }}>
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

        {/* Money: one short line, then the PIN row (owner, 2026-11-15: the
            old explanation was a whole paragraph). */}
        <View style={{ gap: sp.sm }}>
          <Label>{t('casa.moneyTitle')}</Label>
          <Card style={{ gap: sp.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
              <Lock size={15} color={c.textMuted} />
              <Txt variant="muted" style={{ flex: 1, fontSize: 14, lineHeight: 19 }}>
                {t('casa.moneyShort')}
              </Txt>
            </View>
            <CasaPinCard />
          </Card>
        </View>

        {/* How to pair: three numbered steps. */}
        <View style={{ gap: sp.sm }}>
          <Label>{t('casa.pairHowTitle')}</Label>
          <Card style={{ padding: sp.md, gap: sp.md }}>
            {STEPS.map((k, i) => (
              <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                <GradientBox colors={CASA} radius={16} style={s.step}>
                  <Txt style={{ fontFamily: fonts.display, fontSize: 16, color: '#fff' }}>{i + 1}</Txt>
                </GradientBox>
                <Txt style={{ flex: 1, fontSize: 15, lineHeight: 20, color: c.text }}>{t(k, { url: CASA_URL })}</Txt>
              </View>
            ))}
          </Card>
        </View>

        {/* The two plans, side by side. */}
        <View style={{ gap: sp.sm }}>
          <Label>{t('casa.plansTitle')}</Label>
          <View style={[s.plan, { backgroundColor: c.card, borderColor: c.border }]}>
            <Txt style={{ fontFamily: fonts.semibold, fontSize: 13, color: c.textMuted }}>{t('casa.planFree')}</Txt>
            <Txt style={{ fontFamily: fonts.display, fontSize: 20, lineHeight: 24, color: c.text }}>{t('casa.planFreeBig')}</Txt>
            <Txt variant="faint" style={{ fontSize: 13, lineHeight: 18 }}>
              {t('casa.planFreeSub')}
            </Txt>
          </View>

          {/* Plus: the same card as Settings' (purple gradient, award tile,
              what you get, one white action). Tapping it opens the paywall
              (owner, 2026-11-15). */}
          <Pressable
            onPress={() => router.push('/paywall')}
            disabled={isPlus && !isTrial}
            accessibilityRole="button"
            accessibilityLabel={t('settings.plus')}
            style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
          >
            <GradientBox colors={PLUS_GRADIENT} radius={24} style={{ padding: sp.lg, gap: sp.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                <View style={s.award}>
                  <Award size={26} color="#fff" />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt style={{ fontFamily: fonts.display, fontSize: 22, lineHeight: 27, color: '#fff' }}>{t('settings.plus')}</Txt>
                  <Txt style={{ fontSize: 13.5, color: 'rgba(255,255,255,0.88)' }}>{t('casa.plusSub')}</Txt>
                </View>
                {isPlus ? (
                  <View style={s.badge}>
                    <Txt style={{ fontSize: 11, fontFamily: fonts.semibold, letterSpacing: 0.5, color: '#fff' }}>
                      {(isTrial ? t('settings.trial') : t('settings.active')).toUpperCase()}
                    </Txt>
                  </View>
                ) : null}
              </View>
              <View style={{ gap: 9 }}>
                {PLUS_POINTS.map((k) => (
                  <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={s.tick}>
                      <Check size={13} color="#fff" strokeWidth={3} />
                    </View>
                    <Txt style={{ flex: 1, fontSize: 14.5, lineHeight: 20, color: '#fff' }}>{t(k)}</Txt>
                  </View>
                ))}
              </View>
              {isPlus && !isTrial ? null : (
                <View style={s.plusBtn}>
                  <Txt style={{ fontFamily: fonts.semibold, fontSize: 15, color: PLUS_GRADIENT[1] }}>
                    {isPlus ? t('settings.keepPlus') : t('settings.getPlus')}
                  </Txt>
                </View>
              )}
            </GradientBox>
          </Pressable>
          <Txt variant="faint" style={{ fontSize: 13, lineHeight: 18, paddingHorizontal: 2 }}>
            {t('casa.unpairNote')}
          </Txt>
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
  step: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  plan: { borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: sp.md, gap: 2 },
  award: { width: 48, height: 48, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: 'rgba(255,255,255,0.22)' },
  tick: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.24)', alignItems: 'center', justifyContent: 'center' },
  plusBtn: { height: 46, borderRadius: 23, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
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
