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
import { radius, sp, useTheme } from '@/theme/theme'

const PRIVACY_URL = 'https://one-roof-app.vercel.app/privacy.html'
// Apple's standard EULA is an accepted Terms of Use for IAP.
const TERMS_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/'

const BENEFITS = [
  'Unlimited AI receipt & bill scans',
  'Document Vault with Face ID',
  'Google Calendar two-way sync',
  'Support a family-run app ✨',
]

function periodLabel(pkg: PurchasesPackage): string {
  switch (pkg.packageType) {
    case PACKAGE_TYPE.ANNUAL:
      return 'Yearly'
    case PACKAGE_TYPE.MONTHLY:
      return 'Monthly'
    case PACKAGE_TYPE.LIFETIME:
      return 'Lifetime'
    case PACKAGE_TYPE.WEEKLY:
      return 'Weekly'
    case PACKAGE_TYPE.SIX_MONTH:
      return '6 months'
    case PACKAGE_TYPE.THREE_MONTH:
      return '3 months'
    case PACKAGE_TYPE.TWO_MONTH:
      return '2 months'
    default:
      return pkg.product.title
  }
}

export default function Paywall() {
  const { c } = useTheme()
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
        Alert.alert('Welcome to One Roof Plus 🎉', 'Everything is unlocked. Thank you!')
        router.back()
      }
    } catch {
      Alert.alert('Purchase failed', 'Something went wrong. Please try again.')
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
        ok ? 'Purchases restored' : 'Nothing to restore',
        ok ? "You're on One Roof Plus." : 'No previous purchase was found for this Apple ID.',
      )
      if (ok) router.back()
    } catch {
      Alert.alert('Restore failed', 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ padding: sp.lg, paddingBottom: sp.xxl, gap: sp.lg }}>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Close">
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
            One Roof Plus
          </Txt>
          <Txt variant="muted" style={{ textAlign: 'center' }}>
            One subscription for your whole household.
          </Txt>
        </View>

        <Card style={{ gap: sp.md }}>
          {BENEFITS.map((b) => (
            <View key={b} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
              <Check size={18} color={c.income} />
              <Txt style={{ flex: 1 }}>{b}</Txt>
            </View>
          ))}
        </Card>

        {isPlus ? (
          <Card>
            <Txt style={{ fontWeight: '700', color: c.income, textAlign: 'center' }}>
              You're on One Roof Plus ✓
            </Txt>
          </Card>
        ) : !available ? (
          <Card>
            <Txt variant="muted" style={{ textAlign: 'center' }}>
              In-app purchases aren't available in this build.
            </Txt>
          </Card>
        ) : loading ? (
          <Card>
            <Txt variant="muted" style={{ textAlign: 'center' }}>
              Loading plans…
            </Txt>
          </Card>
        ) : packages.length === 0 ? (
          <Card>
            <Txt variant="muted" style={{ textAlign: 'center' }}>
              Plans aren't set up yet. Please check back soon.
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
                      <Txt style={{ fontWeight: '700' }}>{periodLabel(pkg)}</Txt>
                      {intro ? (
                        <Txt variant="faint">{intro.priceString} intro, then renews</Txt>
                      ) : (
                        <Txt variant="faint">{pkg.product.description || 'Auto-renews'}</Txt>
                      )}
                    </View>
                    <Txt style={{ fontWeight: '700' }}>{pkg.product.priceString}</Txt>
                  </Pressable>
                )
              })}
            </View>

            <Btn
              title={busy ? 'Please wait…' : chosen ? `Subscribe — ${chosen.product.priceString}` : 'Subscribe'}
              onPress={buy}
              disabled={busy || !chosen}
              loading={busy}
            />
          </>
        )}

        {!isPlus && available ? (
          <Pressable onPress={doRestore} disabled={busy} style={{ alignItems: 'center', paddingVertical: sp.sm }}>
            <Txt style={{ color: c.accent, fontWeight: '600' }}>Restore purchases</Txt>
          </Pressable>
        ) : null}

        <Txt variant="faint" style={{ textAlign: 'center' }}>
          Subscriptions renew automatically unless cancelled at least 24 hours before the period
          ends. Manage or cancel anytime in your Apple ID settings.
        </Txt>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: sp.lg }}>
          <Pressable onPress={() => Linking.openURL(TERMS_URL)}>
            <Txt variant="faint" style={{ textDecorationLine: 'underline' }}>
              Terms of Use
            </Txt>
          </Pressable>
          <Pressable onPress={() => Linking.openURL(PRIVACY_URL)}>
            <Txt variant="faint" style={{ textDecorationLine: 'underline' }}>
              Privacy Policy
            </Txt>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  )
}
