// Pick a nudge to send someone from the map, without leaving Whereabouts for
// the Nudges app. Extracted from the old member-detail sheet when that became an
// in-place expanding card: the DETAIL is inline now, but choosing from a list of
// presets is a deliberate, dismissable pick, which is what a modal is actually
// for.
import { SheetHead } from './sheetParts'
import { useEffect, useState } from 'react'
import { Modal, ScrollView, StyleSheet, View } from 'react-native'
import { Pressable } from '@/components/Pressable'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Send } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { fetchPingPresets, presetText, sendPing } from '@/lib/pings'
import type { PingPreset, Profile } from '@/lib/types'
import { fonts, sp, useTheme } from '@/theme/theme'

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
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('common.cancel')} />
        <View
          style={{
            // c.sheet, never c.card — the glass skin makes card translucent.
            backgroundColor: c.sheet,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            padding: sp.lg,
            paddingBottom: insets.bottom + sp.md,
            gap: sp.md,
            maxHeight: '72%',
          }}
        >
          <SheetHead title={t('location.nudge.title', { name: profile.display_name })} onClose={onClose} />
          <ScrollView style={{ flexShrink: 1 }}>
            <View style={{ borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, backgroundColor: c.card, overflow: 'hidden' }}>
              {presets.map((p, i) => (
                <Pressable
                  key={p.id}
                  disabled={sending}
                  onPress={() => void send(p)}
                  style={({ pressed }) => [
                    {
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: sp.md,
                      paddingHorizontal: sp.md,
                      paddingVertical: 12,
                      borderTopWidth: i ? StyleSheet.hairlineWidth : 0,
                      borderColor: c.border,
                      opacity: sending ? 0.5 : 1,
                    },
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}>
                    <Txt style={{ fontSize: 20 }}>{p.emoji}</Txt>
                  </View>
                  <Txt style={{ flex: 1, fontFamily: fonts.display, fontSize: 16.5, color: c.text }} numberOfLines={1}>
                    {presetText(p, t)}
                  </Txt>
                  <Send size={16} color={c.textFaint} />
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}
