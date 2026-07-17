// One Roof Plus paywall. Renders the current RevenueCat offering (so prices come
// straight from App Store Connect — nothing hardcoded), lets the user pick a
// plan and subscribe, restore prior purchases (Apple-required), and links to the
// Terms + Privacy. Reached via router.push('/paywall') from gated features.
import { useState } from 'react'
import { Alert, Linking, Pressable, ScrollView, View } from 'react-native'
import { Check, Sparkles, X } from 'lucide-react-native'
import { router } from 'expo-router'
import { PACKAGE_TYPE, type PurchasesPackage } from 'react-native-purchases'

import { Btn, Card, Txt } from '@/components/ui'
import { usePlus } from '@/lib/plus'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'
import { radius, sp, useTheme } from '@/theme/theme'

const PRIVACY_URL = 'https://one-roof-app.vercel.app/privacy.html'
// Apple's standard EULA is an accepted Terms of Use for IAP.
const TERMS_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/'

// Localized benefit keys, highest-value first. Shares the settings.plusFeature*
// keys with the Settings Plus card so both surfaces stay in sync; the support
// line is paywall-only. Every real Plus gate in the app must appear here.
const BENEFIT_KEYS: TKey[] = [
  'settings.plusFeatureScans',
  'settings.plusFeatureCalendar',
  'settings.plusFeatureSplit',
  'settings.plusFeatureBudgets',
  'settings.plusFeatureMembers',
  'settings.plusFeaturePrivate',
  'settings.plusFeatureVault',
  'settings.plusFeatureSupport',
]

function periodLabel(pkg: PurchasesPackage, t: (key: TKey) => string): string {
  switch (pkg.packageType) {
    case PACKAGE_TYPE.ANNUAL:
      return t('paywall.periodYearly')
    case PACKAGE_TYPE.MONTHLY:
      return t('paywall.periodMonthly')
    case PACKAGE_TYPE.LIFETIME:
      return t('paywall.periodLifetime')
    case PACKAGE_TYPE.WEEKLY:
      return t('paywall.periodWeekly')
    case PACKAGE_TYPE.SIX_MONTH:
      return t('paywall.period6mo')
    case PACKAGE_TYPE.THREE_MONTH:
      return t('paywall.period3mo')
    case PACKAGE_TYPE.TWO_MONTH:
      return t('paywall.period2mo')
    default:
      return pkg.product.title
  }
}

export default function Paywall() {
  const { c } = useTheme()
  const { t } = useI18n()
  const { offering, isPlus, available, loading, purchase, restore } = usePlus()
  const packages = offering?.availablePackages ?? []
  // Default-select the annual plan (best value) if present, else the first.
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const chosen =
    packages.find((p) => p.identifier === selected) ??
    packages.find((p) => p.packageType === PACKAGE_TYPE.ANNUAL) ??
    packages[0] ??
    null

  async function buy() {
    if (!chosen || busy) return
    setBusy(true)
    try {
      const ok = await purchase(chosen)
      if (ok) {
        Alert.alert(t('paywall.welcomeTitle'), t('paywall.welcomeBody'))
        router.back()
      }
    } catch {
      Alert.alert(t('paywall.purchaseFailedTitle'), t('paywall.purchaseFailedBody'))
    } finally {
      setBusy(false)
    }
  }

  async function doRestore() {
    if (busy) return
    setBusy(true)
    try {
      const ok = await restore()
      Alert.alert(
        ok ? t('paywall.restoredTitle') : t('paywall.nothingRestoreTitle'),
        ok ? t('paywall.restoredBody') : t('paywall.nothingRestoreBody'),
      )
      if (ok) router.back()
    } catch {
      Alert.alert(t('paywall.restoreFailedTitle'), t('paywall.restoreFailedBody'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ padding: sp.lg, paddingBottom: sp.xxl, gap: sp.lg }}>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel={t('common.close')}>
            <X size={24} color={c.textMuted} />
          </Pressable>
        </View>

        <View style={{ alignItems: 'center', gap: sp.sm }}>
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 20,
              backgroundColor: c.accentSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Sparkles size={30} color={c.accent} />
          </View>
          <Txt variant="title" style={{ textAlign: 'center' }}>
            {t('settings.plus')}
          </Txt>
          <Txt variant="muted" style={{ textAlign: 'center' }}>
            {t('paywall.subtitle')}
          </Txt>
        </View>

        <Card style={{ gap: sp.md }}>
          {BENEFIT_KEYS.map((k) => (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
              <Check size={18} color={c.income} />
              <Txt style={{ flex: 1 }}>{t(k)}</Txt>
            </View>
          ))}
        </Card>

        {isPlus ? (
          <Card>
            <Txt style={{ fontWeight: '700', color: c.income, textAlign: 'center' }}>
              {t('paywall.alreadyPlus')}
            </Txt>
          </Card>
        ) : !available ? (
          <Card>
            <Txt variant="muted" style={{ textAlign: 'center' }}>
              {t('paywall.unavailable')}
            </Txt>
          </Card>
        ) : loading ? (
          <Card>
            <Txt variant="muted" style={{ textAlign: 'center' }}>
              {t('paywall.loadingPlans')}
            </Txt>
          </Card>
        ) : packages.length === 0 ? (
          <Card>
            <Txt variant="muted" style={{ textAlign: 'center' }}>
              {t('paywall.noPlans')}
            </Txt>
          </Card>
        ) : (
          <>
            <View style={{ gap: sp.sm }}>
              {packages.map((pkg) => {
                const active = chosen?.identifier === pkg.identifier
                const intro = pkg.product.introPrice
                return (
                  <Pressable
                    key={pkg.identifier}
                    onPress={() => setSelected(pkg.identifier)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: sp.md,
                      borderRadius: radius.md,
                      borderWidth: 2,
                      borderColor: active ? c.accent : c.border,
                      backgroundColor: active ? c.accentSoft : c.card,
                    }}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Txt style={{ fontWeight: '700' }}>{periodLabel(pkg, t)}</Txt>
                      {intro ? (
                        <Txt variant="faint">
                          {t('paywall.introThenRenews', { price: intro.priceString })}
                        </Txt>
                      ) : (
                        <Txt variant="faint">{pkg.product.description || t('paywall.autoRenews')}</Txt>
                      )}
                    </View>
                    <Txt style={{ fontWeight: '700' }}>{pkg.product.priceString}</Txt>
                  </Pressable>
                )
              })}
            </View>

            <Btn
              title={
                busy
                  ? t('paywall.pleaseWait')
                  : chosen
                    ? t('paywall.subscribePrice', { price: chosen.product.priceString })
                    : t('paywall.subscribe')
              }
              onPress={buy}
              disabled={busy || !chosen}
              loading={busy}
            />
          </>
        )}

        {!isPlus && available ? (
          <Pressable onPress={doRestore} disabled={busy} style={{ alignItems: 'center', paddingVertical: sp.sm }}>
            <Txt style={{ color: c.accent, fontWeight: '600' }}>{t('settings.restorePurchases')}</Txt>
          </Pressable>
        ) : null}

        <Txt variant="faint" style={{ textAlign: 'center' }}>
          {t('paywall.legal')}
        </Txt>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: sp.lg }}>
          <Pressable onPress={() => Linking.openURL(TERMS_URL)}>
            <Txt variant="faint" style={{ textDecorationLine: 'underline' }}>
              {t('paywall.terms')}
            </Txt>
          </Pressable>
          <Pressable onPress={() => Linking.openURL(PRIVACY_URL)}>
            <Txt variant="faint" style={{ textDecorationLine: 'underline' }}>
              {t('paywall.privacy')}
            </Txt>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  )
}
