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
import { GripVertical, Plus, Trash2, X } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { DraggableList } from '@/components/DraggableList'
import { useI18n } from '@/hooks/useI18n'
import { deletePingPreset, presetText, reorderPingPresets } from '@/lib/pings'
import type { PingPreset } from '@/lib/types'
import { radius, sp, useTheme } from '@/theme/theme'
import { PresetEditor } from './PresetEditor'

const ROW_H = 60

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
    return (
      <Pressable
        onPress={() => openEdit(p)}
        style={({ pressed }) => [
          styles.row,
          { borderColor: p.high_priority ? c.expense : c.border, backgroundColor: pressed ? c.surface : c.card },
        ]}
        accessibilityRole="button"
      >
        <GripVertical size={18} color={c.textFaint} />
        <Txt style={{ fontSize: 22 }}>{p.emoji}</Txt>
        <Txt style={{ flex: 1, fontWeight: '600', fontSize: 15 }} numberOfLines={1}>
          {presetText(p, t)}
        </Txt>
        {p.high_priority ? (
          <Txt style={{ color: c.expense, fontSize: 10, fontWeight: '700' }}>
            {t('pings.highPriority').toUpperCase()}
          </Txt>
        ) : null}
        <Pressable onPress={() => confirmDelete(p)} hitSlop={8} accessibilityLabel={t('pings.deletePreset')}>
          <Trash2 size={18} color={c.textFaint} />
        </Pressable>
      </Pressable>
    )
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={[styles.sheet, { backgroundColor: c.sheet }]} onPress={() => {}}>
            <View style={[styles.grab, { backgroundColor: c.border }]} />

            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt variant="title">{t('pings.settingsTitle')}</Txt>
                <Txt variant="muted" style={{ marginTop: 2 }}>
                  {t('pings.settingsDesc')}
                </Txt>
              </View>
              <Pressable onPress={onClose} hitSlop={10} accessibilityLabel={t('common.cancel')}>
                <X size={22} color={c.textMuted} />
              </Pressable>
            </View>

            {items.length > 1 ? (
              <Txt variant="faint" style={{ marginTop: sp.md }}>
                {t('pings.reorder')}
              </Txt>
            ) : null}

            <ScrollView style={{ flexGrow: 0, marginTop: sp.sm }} keyboardShouldPersistTaps="handled">
              <DraggableList data={items} rowHeight={ROW_H} onReorder={onReorder} renderItem={renderRow} />

              <Pressable
                onPress={openNew}
                style={[styles.row, styles.addRow, { borderColor: c.textFaint }]}
                accessibilityRole="button"
              >
                <Plus size={18} color={c.textMuted} />
                <Txt style={{ fontWeight: '600', fontSize: 15, color: c.textMuted }}>
                  {t('pings.addPreset')}
                </Txt>
              </Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>
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
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '85%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: sp.lg,
    paddingTop: sp.md,
    paddingBottom: sp.xl,
  },
  grab: { width: 40, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: sp.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    paddingHorizontal: sp.md,
    // Fixed height so the absolutely-positioned drag rows line up on ROW_H.
    height: ROW_H - sp.sm,
  },
  addRow: { borderStyle: 'dashed', justifyContent: 'center', marginTop: sp.sm },
})
