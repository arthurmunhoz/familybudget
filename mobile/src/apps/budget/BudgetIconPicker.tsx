// The budget icon picker (see budgetIcons.ts).
import { ScrollView, View } from 'react-native'

import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import { useTheme } from '@/theme/theme'
import { BUDGET_ICONS } from './budgetIcons'

/** A row of emoji tiles; the chosen one outlined in `tint`. */
export function BudgetIconPicker({ value, onChange, tint }: { value: string; onChange: (v: string) => void; tint: string }) {
  const { c } = useTheme()
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8 }}>
      {BUDGET_ICONS.map((e) => {
        const on = e === value
        return (
          <Pressable
            key={e}
            onPress={() => onChange(e)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: on ? tint + '1A' : c.surface,
                borderWidth: on ? 2 : 0,
                borderColor: tint,
              }}
            >
              <Txt style={{ fontSize: 22 }}>{e}</Txt>
            </View>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}
