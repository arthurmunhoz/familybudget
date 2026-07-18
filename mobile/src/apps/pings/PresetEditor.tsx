// Create / edit one household nudge preset (emoji + label + high-priority).
// A bottom-sheet Modal. Moved out of PingComposer so the Nudge-settings modal
// owns preset management and the composer is just for sending.
import { useState } from 'react'
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, Switch, TextInput, View } from 'react-native'
import { X } from 'lucide-react-native'

import { Btn, Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { createPingPreset, presetText, updatePingPreset } from '@/lib/pings'
import type { PingPreset } from '@/lib/types'
import { radius, sp, useTheme } from '@/theme/theme'
import { KEYBOARD_DONE_ID } from '@/components/keyboardDoneId'

export function PresetEditor({
  preset,
  onClose,
  onSaved,
}: {
  preset: PingPreset | null
  onClose: () => void
  onSaved: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const [emoji, setEmoji] = useState(preset?.emoji ?? '📣')
  const [label, setLabel] = useState(preset ? presetText(preset, t) : '')
  const [high, setHigh] = useState(preset?.high_priority ?? false)
  const [saving, setSaving] = useState(false)

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

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' }}
      >
        <View
          style={{
            backgroundColor: c.sheet,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            padding: sp.lg,
            paddingBottom: sp.xl,
            gap: sp.md,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Txt variant="h2">{preset ? t('pings.editPreset') : t('pings.newPreset')}</Txt>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel={t('common.cancel')}>
              <X size={22} color={c.textMuted} />
            </Pressable>
          </View>

          <View style={{ flexDirection: 'row', gap: sp.md }}>
            <View style={{ gap: 6 }}>
              <Txt variant="label">{t('pings.presetEmoji')}</Txt>
              <TextInput
                inputAccessoryViewID={KEYBOARD_DONE_ID}
                value={emoji}
                onChangeText={setEmoji}
                maxLength={4}
                style={{
                  width: 64,
                  textAlign: 'center',
                  fontSize: 24,
                  backgroundColor: c.surface,
                  borderRadius: radius.md,
                  paddingVertical: 10,
                  color: c.text,
                }}
              />
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <Txt variant="label">{t('pings.presetLabel')}</Txt>
              <TextInput
                inputAccessoryViewID={KEYBOARD_DONE_ID}
                value={label}
                onChangeText={setLabel}
                placeholder={t('pings.presetLabelPlaceholder')}
                placeholderTextColor={c.textFaint}
                autoFocus={!preset}
                style={{
                  backgroundColor: c.surface,
                  borderRadius: radius.md,
                  paddingHorizontal: sp.md,
                  paddingVertical: 12,
                  fontSize: 16,
                  color: c.text,
                }}
              />
            </View>
          </View>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: sp.md,
              backgroundColor: c.surface,
              borderRadius: radius.md,
              paddingHorizontal: sp.md,
              paddingVertical: 10,
              borderWidth: high ? 2 : 0,
              borderColor: c.expense,
            }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt style={{ fontWeight: '600', color: high ? c.expense : c.text }}>
                {t('pings.highPriority')}
              </Txt>
              <Txt variant="faint" style={{ fontSize: 11 }}>
                {t('pings.highPriorityHint')}
              </Txt>
            </View>
            <Switch value={high} onValueChange={setHigh} trackColor={{ true: c.expense }} />
          </View>

          <Btn
            title={preset ? t('common.saveChanges') : t('pings.newPreset')}
            onPress={save}
            loading={saving}
            disabled={!label.trim()}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}
