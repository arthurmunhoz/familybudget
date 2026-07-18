// Pick a nudge to send someone from the map, without leaving Whereabouts for
// the Nudges app. Extracted from the old member-detail sheet when that became an
// in-place expanding card: the DETAIL is inline now, but choosing from a list of
// presets is a deliberate, dismissable pick, which is what a modal is actually
// for.
import { useEffect, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { X } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { fetchPingPresets, presetText, sendPing } from '@/lib/pings'
import type { PingPreset, Profile } from '@/lib/types'
import { fonts, radius, sp, useTheme } from '@/theme/theme'

export function NudgePicker({
  profile,
  onClose,
  onSent,
}: {
  profile: Profile
  onClose: () => void
  /** Confirmation text once a nudge is away (the parent shows the toast). */
  onSent: (text: string) => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const insets = useSafeAreaInsets()

  const [presets, setPresets] = useState<PingPreset[]>([])
  const [sending, setSending] = useState(false)

  useEffect(() => {
    void fetchPingPresets()
      .then(setPresets)
      .catch(() => {})
  }, [])

  const send = async (p: PingPreset) => {
    if (sending) return
    setSending(true)
    try {
      await sendPing(p.preset_key ?? 'custom', p.emoji, presetText(p, t), [profile.email])
      onSent(t('location.nudge.sent', { name: profile.display_name }))
    } catch {
      // swallow — the picker closes either way
    } finally {
      setSending(false)
      onClose()
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' }}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('common.cancel')} />
        <View
          style={{
            // c.sheet, never c.card — the glass skin makes card translucent.
            backgroundColor: c.sheet,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            padding: sp.lg,
            paddingBottom: insets.bottom + sp.lg,
            gap: sp.md,
            maxHeight: '72%',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
            <Txt style={{ flex: 1, fontFamily: fonts.displaySemi, fontSize: 20, color: c.text }} numberOfLines={1}>
              {t('location.nudge.title', { name: profile.display_name })}
            </Txt>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.close')}>
              <X size={20} color={c.textMuted} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ gap: sp.sm }}>
            {presets.map((p) => (
              <Pressable
                key={p.id}
                disabled={sending}
                onPress={() => void send(p)}
                style={({ pressed }) => [
                  {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: sp.md,
                    backgroundColor: c.surface,
                    borderRadius: radius.md,
                    padding: sp.md,
                    opacity: sending ? 0.5 : 1,
                  },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Txt style={{ fontSize: 20 }}>{p.emoji}</Txt>
                <Txt style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: c.text }} numberOfLines={1}>
                  {presetText(p, t)}
                </Txt>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}
