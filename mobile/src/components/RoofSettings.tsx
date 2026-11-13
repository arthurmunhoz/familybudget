// Settings › Assistente Roof (owner, 2026-11-12): call it with "Ei Roof" and
// hear the answer out loud — or turn both off and use only the mic button,
// answers on screen. Per device (lib/roof). Plus features: on the free plan
// the rows show the Plus tag and open the paywall.
import { useSyncExternalStore } from 'react'
import { Alert, StyleSheet, View } from 'react-native'
import { router } from 'expo-router'
import { AudioLines, Sparkles, Volume2 } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { Toggle } from '@/components/Toggle'
import { Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'
import { usePlus } from '@/lib/plus'
import { setRoofPref, useRoofPrefs, type RoofPrefs } from '@/lib/roof'
import { onRoofHeard, roofLastHeard, turnOnRoofWake } from '@/lib/roofWake'
import { fonts, radius, sp, useTheme } from '@/theme/theme'

const ROOF_GRADIENT: [string, string] = ['#E58A63', '#B9532F']
const GREY: [string, string] = ['#9AA0AA', '#737985']

export function RoofSettings() {
  const { c } = useTheme()
  const { t } = useI18n()
  const { isPlus } = usePlus()
  const prefs = useRoofPrefs()
  const heard = useSyncExternalStore(onRoofHeard, roofLastHeard)

  async function set(k: keyof RoofPrefs, v: boolean) {
    if (!isPlus) {
      router.push('/paywall')
      return
    }
    if (k === 'wake' && v) {
      // Asks for the mic here, where the user just chose it.
      if ((await turnOnRoofWake()) === 'unsupported') Alert.alert(t('settings.roofWake'), t('settings.roofNoDevice'))
      return
    }
    setRoofPref(k, v)
  }

  const row = (k: keyof RoofPrefs, Icon: typeof Volume2, title: TKey, hint: TKey, first = false) => {
    const on = isPlus && prefs[k]
    return (
      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: on }}
        onPress={() => void set(k, !on)}
        style={[styles.row, first ? null : { paddingTop: sp.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border }]}
      >
        <GradientBox colors={on ? ROOF_GRADIENT : GREY} radius={12} style={styles.icon}>
          <Icon size={19} color="#fff" />
        </GradientBox>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt style={{ fontFamily: fonts.semibold }}>{t(title)}</Txt>
          <Txt variant="faint">{t(hint)}</Txt>
        </View>
        {isPlus ? (
          <Toggle value={on} onValueChange={(v) => void set(k, v)} />
        ) : (
          <View style={[styles.plus, { backgroundColor: c.accentSoft }]}>
            <Sparkles size={12} color={c.accent} />
            <Txt style={{ fontSize: 11.5, fontFamily: fonts.semibold, color: c.accent }}>Plus</Txt>
          </View>
        )}
      </Pressable>
    )
  }

  return (
    <View style={{ gap: sp.sm }}>
      {row('wake', AudioLines, 'settings.roofWake', 'settings.roofWakeHint', true)}
      {row('speak', Volume2, 'settings.roofSpeak', 'settings.roofSpeakHint')}
      <Txt variant="faint" style={{ marginTop: sp.xs }}>
        {isPlus ? t('settings.roofOffHint') : t('settings.roofPlus')}
      </Txt>
      {/* What the phone wrote last time it heard you (memory only) — so a
          call it misses can be taught (owner, 2026-11). */}
      {isPlus && prefs.wake && heard ? (
        <Txt variant="faint" style={{ fontSize: 12.5 }}>
          {t('settings.roofLastHeard', { text: heard })}
        </Txt>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: sp.md },
  icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  plus: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill },
})
