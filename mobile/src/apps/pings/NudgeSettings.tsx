// Nudge settings — a bottom sheet reached from the ⚙️ in the Nudges header.
// Manage the household's one-tap presets: tap to edit, ✕ to delete, "Add nudge"
// to create, and LONG-PRESS + DRAG to reorder. This is the only place presets
// are edited now (the composer's inline toggle was removed).
//
// Presets are owned by the screen and passed in, so edits reflect in the
// composer without a stale-cache round-trip. Reorder persists to
// ping_presets.sort_order via reorderPingPresets.
import { useEffect, useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { GripVertical, Plus, Settings2, Trash2, X } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import { APP_GRADIENT } from '@/components/home/palette'
import { TintButton } from '@/components/TintButton'
import { DraggableList } from '@/components/DraggableList'
import { useI18n } from '@/hooks/useI18n'
import { deletePingPreset, presetText, reorderPingPresets } from '@/lib/pings'
import type { PingPreset } from '@/lib/types'
import { useBottomGap } from '@/hooks/useBottomGap'
import { fonts, sp, useTheme } from '@/theme/theme'
import { PresetEditor } from './PresetEditor'

const ROW_H = 64

export function NudgeSettings({
  presets,
  reloadPresets,
  onClose,
}: {
  presets: PingPreset[]
  reloadPresets: () => void
  onClose: () => void
}) {
  const { c } = useTheme()
  const bottomGap = useBottomGap(sp.xs)
  const blue = APP_GRADIENT.pings[1]
  const { t } = useI18n()
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<PingPreset | null>(null)

  // Local copy so a reorder is instant (no refetch flash). Reconciled against
  // the incoming presets while PRESERVING the local order: keep the current
  // order with fresh row data (picks up edits), append newly added, drop
  // removed. So an edit/add/delete elsewhere updates content without snapping
  // the order back, and a reorder we just applied survives the reload after it.
  const [items, setItems] = useState<PingPreset[]>(presets)
  useEffect(() => {
    setItems((prev) => {
      const byId = new Map(presets.map((p) => [p.id, p]))
      const kept = prev.filter((p) => byId.has(p.id)).map((p) => byId.get(p.id)!)
      const added = presets.filter((p) => !prev.some((x) => x.id === p.id))
      return [...kept, ...added]
    })
  }, [presets])

  function openNew() {
    setEditing(null)
    setEditorOpen(true)
  }
  function openEdit(p: PingPreset) {
    setEditing(p)
    setEditorOpen(true)
  }
  function confirmDelete(p: PingPreset) {
    Alert.alert(t('pings.deletePresetConfirm'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('pings.deletePreset'),
        style: 'destructive',
        onPress: async () => {
          await deletePingPreset(p.id)
          reloadPresets()
        },
      },
    ])
  }

  async function onReorder(orderedIds: string[]) {
    const byId = new Map(items.map((p) => [p.id, p]))
    const next = orderedIds.map((id) => byId.get(id)).filter((p): p is PingPreset => !!p)
    setItems(next) // reflect the committed order immediately
    try {
      await reorderPingPresets(orderedIds)
      reloadPresets()
    } catch {
      Alert.alert(t('pings.presetSaveFailed'))
      reloadPresets() // resync from the server on failure
    }
  }

  function renderRow(p: PingPreset) {
    const high = p.high_priority
    return (
      <Pressable
        onPress={() => openEdit(p)}
        style={({ pressed }) => [styles.row, { borderBottomColor: c.border, backgroundColor: c.card, opacity: pressed ? 0.7 : 1 }]}
        accessibilityRole="button"
      >
        <GripVertical size={16} color={c.textFaint} />
        <View style={[styles.emojiWell, { backgroundColor: high ? c.expense + '1F' : blue + '17' }]}>
          <Txt style={{ fontSize: 20 }}>{p.emoji}</Txt>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt style={{ fontFamily: fonts.display, fontSize: 16, color: c.text }} numberOfLines={1}>
            {presetText(p, t)}
          </Txt>
          {high ? (
            <Txt style={{ color: c.expense, fontSize: 11, fontFamily: fonts.semibold, letterSpacing: 0.5 }}>
              {t('pings.highPriority').toUpperCase()}
            </Txt>
          ) : null}
        </View>
        <Pressable onPress={() => confirmDelete(p)} hitSlop={8} accessibilityLabel={t('pings.deletePreset')}>
          <Trash2 size={17} color={c.textFaint} />
        </Pressable>
      </Pressable>
    )
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={styles.backdrop}>
          <Pressable style={{ flex: 1 }} onPress={onClose} accessible={false} />
          <View style={[styles.sheet, { backgroundColor: c.sheet, paddingBottom: bottomGap }]}>
            {/* 2026-11 restyle: tile + big title, faded "what this is" */}
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingHorizontal: sp.lg }}>
              <GradientBox colors={APP_GRADIENT.pings} radius={16} style={styles.tile}>
                <Settings2 size={23} color="#fff" />
              </GradientBox>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt style={{ fontFamily: fonts.display, fontSize: 26, lineHeight: 31, color: c.text }}>{t('pings.settingsTitle')}</Txt>
                <Txt style={{ fontFamily: fonts.display, fontSize: 15.5, lineHeight: 20, color: c.textFaint }}>
                  {items.length > 1 ? t('pings.reorder') : t('pings.settingsDesc')}
                </Txt>
              </View>
              <Pressable
                onPress={onClose}
                hitSlop={10}
                accessibilityLabel={t('common.close')}
                style={[styles.close, { backgroundColor: c.surface }]}
              >
                <X size={16} color={c.textMuted} />
              </Pressable>
            </View>

            <ScrollView style={{ flexGrow: 0, flexShrink: 1, marginTop: sp.lg }} contentContainerStyle={{ paddingHorizontal: sp.lg }} keyboardShouldPersistTaps="handled">
              {/* One rounded card, clipped so the last row follows its corners
                  (a dragged row moves inside the card's own height). */}
              <View style={[styles.card, { borderColor: c.border, backgroundColor: c.card }]}>
                <DraggableList data={items} rowHeight={ROW_H} onReorder={onReorder} renderItem={renderRow} />
              </View>
            </ScrollView>

            <View style={{ paddingHorizontal: sp.lg, paddingTop: sp.md }}>
              <TintButton
                tint={APP_GRADIENT.pings[0]}
                title={t('pings.addPreset')}
                icon={<Plus size={18} color="#fff" strokeWidth={2.6} />}
                onPress={openNew}
              />
            </View>
          </View>
        </View>
      </GestureHandlerRootView>

      {editorOpen ? (
        <PresetEditor
          preset={editing}
          onClose={() => setEditorOpen(false)}
          onSaved={() => {
            setEditorOpen(false)
            reloadPresets()
          }}
        />
      ) : null}
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '88%', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: sp.lg },
  tile: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  close: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.md,
    paddingHorizontal: sp.md,
    // Fixed height so the absolutely-positioned drag rows line up on ROW_H.
    height: ROW_H,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  emojiWell: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
})
