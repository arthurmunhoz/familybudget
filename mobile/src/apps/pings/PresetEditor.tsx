// Create / edit one household nudge preset (emoji + label + high-priority).
// A bottom-sheet Modal. Moved out of PingComposer so the Nudge-settings modal
// owns preset management and the composer is just for sending.
//
// 2026-11 redesign (components/form): title + round ×, the fields as one
// section of rows, high priority as a ToggleRow, Save docked at the bottom —
// the same shape as EditProfile. It renders as a <Modal> nested INSIDE
// NudgeSettings' modal tree (sibling modals fail on iOS); keep it that way.
import { useRef, useState } from 'react'
import { Alert, Modal, StyleSheet, TextInput, View } from 'react-native'
import { X } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { Btn, DismissKeyboard, Txt } from '@/components/ui'
import { KeyboardScroll, useRevealOnFocus } from '@/components/KeyboardScroll'
import { FormRow, FormSection, TextRow, ToggleRow } from '@/components/form'
import { useI18n } from '@/hooks/useI18n'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useSheetLift } from '@/hooks/useSheetLift'
import { createPingPreset, presetText, updatePingPreset } from '@/lib/pings'
import type { PingPreset } from '@/lib/types'
import { radius, sp, useTheme } from '@/theme/theme'

/** The emoji as a row: a small square well on the right, big enough to read
 *  the glyph (TextRow's 15pt text makes an emoji look like a typo). Hoisted to
 *  module scope so its TextInput keeps focus across parent re-renders. */
function EmojiRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const { c } = useTheme()
  const reveal = useRevealOnFocus()
  const row = useRef<View>(null)
  return (
    <View ref={row}>
      <FormRow label={label}>
        <TextInput
          value={value}
          onChangeText={onChange}
          maxLength={4}
          onFocus={() => reveal(row.current)}
          style={{
            width: 48,
            height: 38,
            textAlign: 'center',
            fontSize: 22,
            borderRadius: radius.sm,
            backgroundColor: c.surface,
            color: c.text,
            padding: 0,
          }}
        />
      </FormRow>
    </View>
  )
}

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
  const bottomGap = useBottomGap(sp.lg)
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

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop} onLayout={onRootLayout}>
        <View style={[styles.sheet, { backgroundColor: c.sheet, maxHeight: room * 0.94, marginBottom: lift }]}>
          {/* The header is fixed chrome, so a tap on it puts the keyboard away
              (the scroller below handles its own inert taps). */}
          <DismissKeyboard style={styles.sheetHead}>
            <Txt variant="h2">{preset ? t('pings.editPreset') : t('pings.newPreset')}</Txt>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              style={[styles.close, { backgroundColor: c.surface }]}
            >
              <X size={16} color={c.textMuted} />
            </Pressable>
          </DismissKeyboard>

          <KeyboardScroll
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ gap: sp.lg, paddingHorizontal: sp.lg, paddingBottom: sp.lg }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <FormSection>
              <EmojiRow label={t('pings.presetEmoji')} value={emoji} onChange={setEmoji} />
              <TextRow
                label={t('pings.presetLabel')}
                value={label}
                onChangeText={setLabel}
                placeholder={t('pings.presetLabelPlaceholder')}
                autoFocus={!preset}
                returnKeyType="done"
              />
            </FormSection>

            <FormSection>
              <ToggleRow
                label={t('pings.highPriority')}
                hint={t('pings.highPriorityHint')}
                value={high}
                onValueChange={setHigh}
              />
            </FormSection>
          </KeyboardScroll>

          {/* save — docked */}
          <View
            style={{
              paddingHorizontal: sp.lg,
              paddingTop: sp.sm,
              paddingBottom: clearOfBars ? sp.md : bottomGap,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: c.border,
            }}
          >
            <Btn
              title={preset ? t('common.saveChanges') : t('pings.newPreset')}
              onPress={save}
              loading={saving}
              disabled={!label.trim()}
            />
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: sp.lg },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: sp.lg,
    paddingBottom: sp.md,
  },
  close: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
})
