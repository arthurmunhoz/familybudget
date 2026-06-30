// Split a bill: an Evenly / By item segmented toggle over the two split tools.
import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { radius, sp, useTheme } from '@/theme/theme'

import { EvenSplit } from './EvenSplit'
import { ItemSplit } from './ItemSplit'

export function SplitBill() {
  const { c } = useTheme()
  const { t } = useI18n()
  const [mode, setMode] = useState<'even' | 'item'>('even')

  return (
    <View>
      <View style={[styles.segment, { backgroundColor: c.surface }]}>
        {(['even', 'item'] as const).map((m) => {
          const active = mode === m
          return (
            <Pressable
              key={m}
              onPress={() => setMode(m)}
              style={[styles.segBtn, active && { backgroundColor: c.accent }]}
            >
              <Txt style={{ fontSize: 14, fontWeight: '700', color: active ? '#ffffff' : c.textMuted }}>
                {t(m === 'even' ? 'calc.evenly' : 'calc.byItem')}
              </Txt>
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
