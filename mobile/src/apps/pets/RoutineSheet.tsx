// Edit one pet's care routine — a bottom-sheet modal. Daily tasks are a
// reorderable checklist (their order drives the widget's "next undone task");
// interval tasks carry an every-N-days cadence. Empty state seeds a suggested
// species routine (templateTasks) — a starting point, fully editable after.
//
// 2026-11 redesign (components/form look): the tasks are rows on one grouped
// card (icon, title, cadence, delete) with "Add task" as the card's last row;
// the task editor is a sheet of rows with the icon choice as a compact grid
// and Save docked at the bottom.
//
// DraggableList needs gestures INSIDE this RN Modal, so the content is wrapped
// in its own GestureHandlerRootView (the app-root one doesn't reach a modal's
// separate native hierarchy — see NudgeSettings.tsx, the reference for this).
import { useMemo, useState } from 'react'
import { Alert, Keyboard, Modal, ScrollView, StyleSheet, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { GripVertical, Plus, Trash2, X } from 'lucide-react-native'

import { DraggableList } from '@/components/DraggableList'
import { FormRow, FormSection, NumberBox } from '@/components/form'
import { KeyboardScroll } from '@/components/KeyboardScroll'
import { Pressable } from '@/components/Pressable'
import { Btn, Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { track } from '@/lib/analytics'
import type { TKey } from '@/lib/i18n'
import { templateTasks } from '@/lib/petCare'
import { supabase } from '@/lib/supabase'
import type { Pet, PetCareTask, PetTaskIcon } from '@/lib/types'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useSheetLift } from '@/hooks/useSheetLift'
import { fonts, radius, sp, useTheme } from '@/theme/theme'
import { InputRow } from '@/apps/calendar/calendarUi'
import { CARE_ICONS, CARE_ICON_IDS } from './petUi'

const ROW_H = 56

/** The task editor — a sheet NESTED in the routine sheet's modal (a sibling
 *  Modal fails to present on iOS). Hoisted so its inputs keep focus. */
function TaskEditor({
  isNew,
  kind,
  title,
  setTitle,
  icon,
  setIcon,
  intervalDays,
  setIntervalDays,
  busy,
  onSave,
  onClose,
}: {
  isNew: boolean
  kind: 'daily' | 'interval'
  title: string
  setTitle: (v: string) => void
  icon: PetTaskIcon
  setIcon: (v: PetTaskIcon) => void
  intervalDays: string
  setIntervalDays: (v: string) => void
  busy: boolean
  onSave: () => void
  onClose: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const bottomGap = useBottomGap(sp.lg)
  const { lift, room, clearOfBars, onRootLayout } = useSheetLift()
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop} onLayout={onRootLayout}>
        {/* A tap above the sheet only puts the keyboard away (the interval
            box is a number pad, which has no return key) — never discards. */}
        <Pressable style={{ flex: 1 }} onPress={Keyboard.dismiss} accessible={false} />
        <View style={[styles.sheet, { backgroundColor: c.sheet, maxHeight: room * 0.94, marginBottom: lift }]}>
          <View style={styles.sheetHead}>
            <Txt variant="h2">{isNew ? t('petcare.newTask') : t('petcare.editTask')}</Txt>
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

          <KeyboardScroll
            style={{ flexGrow: 0, flexShrink: 1 }}
            contentContainerStyle={{ gap: sp.lg, paddingHorizontal: sp.lg, paddingBottom: sp.lg }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <FormSection>
              <InputRow title value={title} onChangeText={setTitle} placeholder={t('petcare.taskTitleHint')} autoFocus />
              {/* The section decides daily vs interval — no selector needed. */}
              {kind === 'interval' ? (
                <FormRow label={t('petcare.intervalDays')}>
                  <NumberBox value={intervalDays} onChangeText={setIntervalDays} width={56} />
                </FormRow>
              ) : null}
            </FormSection>

            {/* icon picker — a compact grid on its own card */}
            <FormSection>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, padding: sp.md }}>
                {CARE_ICON_IDS.map((id) => {
                  const Icon = CARE_ICONS[id]
                  const on = icon === id
                  return (
                    <Pressable
                      key={id}
                      onPress={() => setIcon(id)}
                      accessibilityRole="button"
                      accessibilityLabel={id}
                      accessibilityState={{ selected: on }}
                      style={({ pressed }) => ({
                        width: 40,
                        height: 40,
                        borderRadius: radius.md,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: on ? c.action : c.surface,
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <Icon size={18} color={on ? c.onAction : c.textMuted} />
                    </Pressable>
                  )
                })}
              </View>
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
            <Btn title={t('common.save')} onPress={onSave} loading={busy} disabled={!title.trim()} />
          </View>
        </View>
      </View>
    </Modal>
  )
}

export function RoutineSheet({
  pet,
  tasks,
  section,
  onClose,
  onChanged,
}: {
  pet: Pet
  /** This pet's tasks (both kinds — the template check needs the full picture). */
  tasks: PetCareTask[]
  /** Which section's pencil opened this: only that group is shown, and a new
   *  task belongs to it (so there's no Repeats selector to explain). */
  section: 'daily' | 'interval'
  onClose: () => void
  /** Reload + widget notify — called after every successful write. */
  onChanged: () => void
}) {
  const { c } = useTheme()
  const bottomGap = useBottomGap(sp.xl)
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)

  // Editor modal state: null = closed, 'new' = creating, else the task edited.
  const [editing, setEditing] = useState<PetCareTask | 'new' | null>(null)
  const [title, setTitle] = useState('')
  const [icon, setIcon] = useState<PetTaskIcon>('paw')
  const kind = section
  const [intervalDays, setIntervalDays] = useState('7')

  const daily = useMemo(
    () =>
      tasks
        .filter((tk) => tk.kind === 'daily')
        .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at)),
    [tasks],
  )
  const intervals = useMemo(
    () => tasks.filter((tk) => tk.kind === 'interval').sort((a, b) => a.sort_order - b.sort_order),
    [tasks],
  )

  function openNew() {
    setEditing('new')
    setTitle('')
    setIcon(section === 'interval' ? 'bath' : 'paw')
    setIntervalDays('7')
  }

  function openEdit(task: PetCareTask) {
    setEditing(task)
    setTitle(task.title)
    setIcon(task.icon)
    setIntervalDays(String(task.interval_days ?? 7))
  }

  async function save() {
    const trimmed = title.trim()
    const days = Math.max(1, Math.round(Number(intervalDays) || 0))
    if (!trimmed || busy) return
    setBusy(true)
    const fields = {
      title: trimmed,
      icon,
      kind,
      interval_days: kind === 'interval' ? days : null,
    }
    const { error } =
      editing === 'new'
        ? await supabase.from('pet_care_tasks').insert({
            ...fields,
            pet_id: pet.id,
            sort_order: tasks.length,
          })
        : await supabase.from('pet_care_tasks').update(fields).eq('id', (editing as PetCareTask).id)
    setBusy(false)
    if (error) {
      Alert.alert(t('pets.saveFailed'))
      return
    }
    if (editing === 'new') track('petcare.task_added', { title: trimmed, pet: pet.name })
    setEditing(null)
    onChanged()
  }

  function remove(task: PetCareTask) {
    Alert.alert(t('petcare.deleteTaskConfirm', { title: task.title }), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('pet_care_tasks').delete().eq('id', task.id)
          if (error) {
            Alert.alert(t('pets.saveFailed'))
            return
          }
          track('petcare.task_deleted', { title: task.title, pet: pet.name })
          onChanged()
        },
      },
    ])
  }

  // Persist a committed drag order for the daily checklist.
  async function reorder(orderedIds: string[]) {
    await Promise.all(
      orderedIds.map((id, i) =>
        supabase.from('pet_care_tasks').update({ sort_order: i }).eq('id', id),
      ),
    )
    onChanged()
  }

  // Seed the suggested routine (localized titles) — only offered when empty.
  async function seedTemplate() {
    if (busy) return
    setBusy(true)
    const rows = templateTasks(pet.species).map((tpl, i) => ({
      pet_id: pet.id,
      title: t(`petcare.tpl.${tpl.key}` as TKey),
      icon: tpl.icon,
      kind: tpl.kind,
      interval_days: tpl.interval_days,
      sort_order: i,
    }))
    const { error } = await supabase.from('pet_care_tasks').insert(rows)
    setBusy(false)
    if (error) {
      Alert.alert(t('pets.saveFailed'))
      return
    }
    track('petcare.task_added', { title: 'template', pet: pet.name })
    onChanged()
  }

  function row(task: PetCareTask, draggable: boolean) {
    const Icon = CARE_ICONS[task.icon] ?? CARE_ICONS.paw
    return (
      <View
        style={{
          height: ROW_H,
          flexDirection: 'row',
          alignItems: 'center',
          gap: sp.md,
          paddingLeft: draggable ? sp.sm : sp.md,
          paddingRight: sp.md,
          // Every task row draws its own bottom rule: "Add task" always
          // follows, and a dragged row carries its rule with it.
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: c.border,
        }}
      >
        {draggable ? <GripVertical size={16} color={c.textFaint} /> : null}
        <Pressable
          onPress={() => openEdit(task)}
          accessibilityRole="button"
          style={({ pressed }) => ({
            flex: 1,
            minWidth: 0,
            flexDirection: 'row',
            alignItems: 'center',
            gap: sp.md,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              backgroundColor: c.accentSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon size={16} color={c.accent} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt style={{ fontSize: 15, color: c.text }} numberOfLines={1}>
              {task.title}
            </Txt>
            {task.kind === 'interval' ? (
              <Txt variant="faint" style={{ fontSize: 12 }}>
                {t('petcare.every', { days: task.interval_days ?? 0 })}
              </Txt>
            ) : null}
          </View>
        </Pressable>
        <Pressable
          onPress={() => remove(task)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('petcare.deleteTask')}
        >
          <Trash2 size={16} color={c.textFaint} />
        </Pressable>
      </View>
    )
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        {/* Tapping the dimmed backdrop dismisses; taps inside the sheet don't. */}
        <Pressable onPress={onClose} style={styles.backdrop} accessible={false}>
          <Pressable onPress={() => {}} accessible={false} style={[styles.sheet, { backgroundColor: c.sheet, maxHeight: '88%' }]}>
            <View style={styles.sheetHead}>
              <Txt variant="h2" style={{ flex: 1, marginRight: sp.md }} numberOfLines={1}>
                {t(section === 'daily' ? 'petcare.dailyRoutine' : 'petcare.routines')} · {pet.name}
              </Txt>
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

            <ScrollView
              style={{ flexGrow: 0 }}
              contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: bottomGap, gap: sp.lg }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {tasks.length === 0 ? (
                <Btn title={t('petcare.useTemplate')} variant="secondary" onPress={seedTemplate} loading={busy} />
              ) : null}

              {/* One grouped card: the tasks, then "Add task" as its last row.
                  Not FormSection: its overflow clip would cut off a row
                  lifted mid-drag. */}
              <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
                {section === 'daily' && daily.length > 0 ? (
                  <DraggableList data={daily} rowHeight={ROW_H} onReorder={reorder} renderItem={(item) => row(item, true)} />
                ) : null}

                {section === 'interval' && intervals.length > 0
                  ? intervals.map((task) => <View key={task.id}>{row(task, false)}</View>)
                  : null}

                <Pressable
                  onPress={openNew}
                  accessibilityRole="button"
                  style={({ pressed }) => ({
                    minHeight: 50,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: sp.sm,
                    paddingHorizontal: sp.md,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Plus size={18} color={c.accent} />
                  <Txt style={{ fontSize: 15, fontFamily: fonts.semibold, color: c.accent }}>{t('petcare.addTask')}</Txt>
                </Pressable>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>

        {/* task editor — nested in this modal's tree */}
        {editing !== null && (
          <TaskEditor
            isNew={editing === 'new'}
            kind={kind}
            title={title}
            setTitle={setTitle}
            icon={icon}
            setIcon={setIcon}
            intervalDays={intervalDays}
            setIntervalDays={setIntervalDays}
            busy={busy}
            onSave={save}
            onClose={() => setEditing(null)}
          />
        )}
      </GestureHandlerRootView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: sp.lg,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: sp.lg,
    paddingBottom: sp.md,
  },
  close: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
})
