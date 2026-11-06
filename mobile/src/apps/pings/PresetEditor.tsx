// Create / edit one household nudge preset (emoji + label + high-priority).
// A bottom-sheet Modal. Moved out of PingComposer so the Nudge-settings modal
// owns preset management and the composer is just for sending.
//
// 2026-11 restyle: the emoji (typed on a gradient tile) and the words large in
// the header, "urgent" as one card that turns red, Save docked in the nudge's
// colour. It renders as a <Modal> nested INSIDE
// NudgeSettings' modal tree (sibling modals fail on iOS); keep it that way.
import { useState } from 'react'
import { Alert, Keyboard, Modal, StyleSheet, TextInput, View } from 'react-native'
import { Siren, X } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import { APP_GRADIENT } from '@/components/home/palette'
import { TintButton } from '@/components/TintButton'
import { Toggle } from '@/components/Toggle'
import { useI18n } from '@/hooks/useI18n'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useSheetLift } from '@/hooks/useSheetLift'
import { createPingPreset, presetText, updatePingPreset } from '@/lib/pings'
import type { PingPreset } from '@/lib/types'
import { fonts, sp, useTheme } from '@/theme/theme'

export function PresetEditor({
  preset,
  onClose,
  onSaved,
}: {
  preset: PingPreset | null
  onClose: () => void
  onSaved: () => void
}) {
  const { c, dark } = useTheme()
  const bottomGap = useBottomGap(sp.xs)
  const { t } = useI18n()
  const [emoji, setEmoji] = useState(preset?.emoji ?? '📣')
  const [label, setLabel] = useState(preset ? presetText(preset, t) : '')
  const [high, setHigh] = useState(preset?.high_priority ?? false)
  const [saving, setSaving] = useState(false)
  const { lift, room, clearOfBars, onRootLayout } = useSheetLift()

  async function save() {
    if (!label.trim() || saving) return
    setSaving(true)
    try {
      const fields = { emoji, label, high_priority: high }
      if (preset) await updatePingPreset(preset.id, fields)
      else await createPingPreset(fields)
      onSaved()
    } catch {
      Alert.alert(t('pings.presetSaveFailed'))
      setSaving(false)
    }
  }

  const tint = high ? URGENT : (APP_GRADIENT.pings as [string, string])

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop} onLayout={onRootLayout}>
        <Pressable style={{ flex: 1 }} onPress={() => Keyboard.dismiss()} accessible={false} />
        <View style={[styles.sheet, { backgroundColor: c.sheet, maxHeight: room * 0.94, marginBottom: lift }]}>
          {/* 2026-11 restyle: the emoji on a big tile (typed in place) and the
              words large beside it — the nudge as it will look. The tile turns
              red when it's urgent. */}
          <View style={styles.sheetHead}>
            <GradientBox colors={tint} radius={18} style={styles.tile}>
              <TextInput
                value={emoji}
                onChangeText={setEmoji}
                maxLength={4}
                accessibilityLabel={t('pings.presetEmoji')}
                style={{ width: 60, height: 60, textAlign: 'center', fontSize: 30, padding: 0, textAlignVertical: 'center' }}
              />
            </GradientBox>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt style={[styles.kicker, { color: c.textMuted }]}>{preset ? t('pings.editPreset') : t('pings.newPreset')}</Txt>
              <TextInput
                value={label}
                onChangeText={setLabel}
                placeholder={t('pings.presetLabelPlaceholder')}
                placeholderTextColor={c.textFaint}
                autoFocus={!preset}
                returnKeyType="done"
                accessibilityLabel={t('pings.presetLabel')}
                style={{ fontFamily: fonts.display, fontSize: 24, lineHeight: 29, color: c.text, padding: 0, marginTop: 2 }}
              />
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              style={[styles.close, { backgroundColor: c.surface }]}
            >
              <X size={16} color={c.textMuted} />
            </Pressable>
          </View>

          <View style={{ paddingHorizontal: sp.lg, paddingBottom: sp.lg }}>
            {/* urgent: one card, red when on */}
            <View
              style={[
                styles.card,
                { backgroundColor: high ? c.expense + (dark ? '26' : '12') : c.card, borderColor: high ? c.expense + '55' : c.border },
              ]}
            >
              <View style={[styles.icon, { backgroundColor: high ? c.expense : c.surface }]}>
                <Siren size={18} color={high ? '#fff' : c.textMuted} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt style={{ fontFamily: fonts.semibold, fontSize: 15, color: c.text }}>{t('pings.highPriority')}</Txt>
                <Txt variant="faint" style={{ fontSize: 12.5 }}>
                  {t('pings.highPriorityHint')}
                </Txt>
              </View>
              <Toggle value={high} onValueChange={setHigh} />
            </View>
          </View>

          {/* save — docked, in the nudge's colour */}
          <View style={{ paddingHorizontal: sp.lg, paddingTop: sp.xs, paddingBottom: clearOfBars ? sp.md : bottomGap }}>
            <TintButton
              tint={tint[0]}
              title={preset ? t('common.saveChanges') : t('pings.newPreset')}
              onPress={save}
              disabled={!label.trim() || saving}
            />
          </View>
        </View>
      </View>
    </Modal>
  )
}

const URGENT: [string, string] = ['#F2605A', '#C9353F']

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: sp.lg },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingHorizontal: sp.lg, paddingBottom: sp.lg },
  tile: { width: 60, height: 60, alignItems: 'center', justifyContent: 'center' },
  kicker: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase' },
  close: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  card: { flexDirection: 'row', alignItems: 'center', gap: sp.md, padding: sp.md, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
})
