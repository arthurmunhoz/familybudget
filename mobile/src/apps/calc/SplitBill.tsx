// Split a bill: an Evenly / By item segmented toggle. "By item" is a One Roof
// Plus feature (AI photo scan only) — free users tapping it go to the paywall.
import { useState } from 'react'
import { Alert, Pressable, StyleSheet, View } from 'react-native'
import { router } from 'expo-router'
import { Sparkles } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { usePlus } from '@/lib/plus'
import { radius, sp, useTheme } from '@/theme/theme'

import { EvenSplit } from './EvenSplit'
import { ItemSplit } from './ItemSplit'

export function SplitBill() {
  const { c } = useTheme()
  const { t } = useI18n()
  const { isPlus } = usePlus()
  const [mode, setMode] = useState<'even' | 'item'>('even')

  function select(m: 'even' | 'item') {
    if (m === 'item' && !isPlus) {
      Alert.alert(t('calc.plusByItem'), undefined, [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('settings.getPlus'), onPress: () => router.push('/paywall') },
      ])
      return
    }
    setMode(m)
  }

  return (
    <View>
      <View style={[styles.segment, { backgroundColor: c.surface }]}>
        {(['even', 'item'] as const).map((m) => {
          const active = mode === m
          const locked = m === 'item' && !isPlus
          return (
            <Pressable
              key={m}
              onPress={() => select(m)}
              style={[styles.segBtn, active && { backgroundColor: c.accent }]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Txt style={{ fontSize: 14, fontWeight: '700', color: active ? '#ffffff' : c.textMuted }}>
                  {t(m === 'even' ? 'calc.evenly' : 'calc.byItem')}
                </Txt>
                {locked ? <Sparkles size={13} color={c.accent} /> : null}
              </View>
            </Pressable>
          )
        })}
      </View>
      {mode === 'even' ? <EvenSplit /> : <ItemSplit />}
    </View>
  )
}

const styles = StyleSheet.create({
  segment: {
    flexDirection: 'row',
    gap: 4,
    borderRadius: radius.md,
    padding: 4,
    marginTop: sp.md,
    marginBottom: sp.lg,
  },
  segBtn: {
    flex: 1,
    borderRadius: radius.sm,
    paddingVertical: 10,
    alignItems: 'center',
  },
})
