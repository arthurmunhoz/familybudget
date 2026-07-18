// Edit one pet's care routine — a bottom-sheet modal. Daily tasks are a
// reorderable checklist (their order drives the widget's "next undone task");
// interval tasks carry an every-N-days cadence. Empty state seeds a suggested
// species routine (templateTasks) — a starting point, fully editable after.
//
// DraggableList needs gestures INSIDE this RN Modal, so the content is wrapped
// in its own GestureHandlerRootView (the app-root one doesn't reach a modal's
// separate native hierarchy — see NudgeSettings.tsx, the reference for this).
import { useMemo, useState } from 'react'
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { GripVertical, Plus, Trash2, X } from 'lucide-react-native'

import { DraggableList } from '@/components/DraggableList'
import { Btn, Field, Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { track } from '@/lib/analytics'
import type { TKey } from '@/lib/i18n'
import { templateTasks } from '@/lib/petCare'
import { supabase } from '@/lib/supabase'
import type { Pet, PetCareTask, PetTaskIcon } from '@/lib/types'
import { radius, sp, useTheme } from '@/theme/theme'
import { CARE_ICONS, CARE_ICON_IDS } from './petUi'

const ROW_H = 52
// iPhones get screen-corner-like rounding on the sheet; Android keeps the norm.
const SHEET_RADIUS = Platform.OS === 'ios' ? 40 : radius.lg

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
    return (
      <View
        style={{
          height: ROW_H,
          flexDirection: 'row',
          alignItems: 'center',
          gap: sp.md,
          paddingHorizontal: sp.sm,
        }}
      >
        {draggable ? <GripVertical size={16} color={c.textFaint} /> : null}
        <Pressable onPress={() => openEdit(task)} style={{ flex: 1, minWidth: 0 }}>
          <Txt style={{ fontWeight: '500' }} numberOfLines={1}>
            {task.title}
          </Txt>
          {task.kind === 'interval' ? (
            <Txt variant="faint" style={{ fontSize: 11 }}>
              {t('petcare.every', { days: task.interval_days ?? 0 })}
            </Txt>
          ) : null}
        </Pressable>
        <Pressable onPress={() => remove(task)} hitSlop={8} accessibilityLabel={t('petcare.deleteTask')}>
          <Trash2 size={16} color={c.textFaint} />
        </Pressable>
      </View>
    )
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        {/* Tapping the dimmed backdrop dismisses; taps inside the sheet don't. */}
        <Pressable
          onPress={onClose}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              maxHeight: '88%',
              backgroundColor: c.sheet,
              // iPhones get screen-corner-like rounding; Android keeps the norm.
              borderTopLeftRadius: SHEET_RADIUS,
              borderTopRightRadius: SHEET_RADIUS,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: sp.lg,
                paddingTop: sp.xl,
                paddingBottom: sp.lg,
              }}
            >
              <Txt variant="h2">
                {t(section === 'daily' ? 'petcare.today' : 'petcare.routines')} · {pet.name}
              </Txt>
              <Pressable
                onPress={onClose}
                hitSlop={10}
                accessibilityLabel={t('common.close')}
                style={{ marginRight: sp.sm, marginTop: 2 }}
              >
                <X size={22} color={c.textMuted} />
              </Pressable>
            </View>

            <ScrollView
              style={{ flexGrow: 0 }}
              contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: sp.xl, gap: sp.md }}
              keyboardShouldPersistTaps="handled"
            >
              {tasks.length === 0 ? (
                <Btn title={t('petcare.useTemplate')} variant="secondary" onPress={seedTemplate} loading={busy} />
              ) : null}

              {section === 'daily' && daily.length > 0 ? (
                <DraggableList data={daily} rowHeight={ROW_H} onReorder={reorder} renderItem={(item) => row(item, true)} />
              ) : null}

              {section === 'interval' && intervals.length > 0 ? (
                <View>
                  {intervals.map((task) => (
                    <View key={task.id}>{row(task, false)}</View>
                  ))}
                </View>
              ) : null}

              <Pressable
                onPress={openNew}
                accessibilityRole="button"
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  paddingVertical: 14,
                  // Bottom corners follow the sheet's iPhone-screen curve
                  // (SHEET_RADIUS is the normal radius on Android).
                  borderTopLeftRadius: radius.md,
                  borderTopRightRadius: radius.md,
                  borderBottomLeftRadius: SHEET_RADIUS,
                  borderBottomRightRadius: SHEET_RADIUS,
                  borderWidth: 1,
                  borderStyle: 'dashed',
                  borderColor: c.textFaint,
                }}
              >
                <Plus size={16} color={c.textMuted} />
                <Txt style={{ fontWeight: '600', color: c.textMuted }}>{t('petcare.addTask')}</Txt>
              </Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>

        {/* task editor */}
        {editing !== null && (
          <Modal visible animationType="fade" transparent onRequestClose={() => setEditing(null)}>
            {/* KeyboardAvoiding keeps the dialog above the keyboard (title field autofocuses). */}
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: sp.lg }}>
              <View style={{ backgroundColor: c.sheet, borderRadius: 18, padding: sp.lg, gap: sp.md }}>
                <Txt variant="h2">{editing === 'new' ? t('petcare.newTask') : t('petcare.editTask')}</Txt>
                <Field value={title} onChangeText={setTitle} placeholder={t('petcare.taskTitleHint')} autoFocus />

                {/* icon picker */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                  {CARE_ICON_IDS.map((id) => {
                    const Icon = CARE_ICONS[id]
                    const on = icon === id
                    return (
                      <Pressable
                        key={id}
                        onPress={() => setIcon(id)}
                        accessibilityLabel={id}
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: radius.md,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: on ? c.accent : c.surface,
                        }}
                      >
                        <Icon size={18} color={on ? '#fff' : c.textMuted} />
                      </Pressable>
                    )
                  })}
                </View>

                {/* The section decides daily vs interval — no selector needed. */}
                {kind === 'interval' ? (
                  <Field
                    label={t('petcare.intervalDays')}
                    value={intervalDays}
                    onChangeText={setIntervalDays}
                    keyboardType="number-pad"
                  />
                ) : null}

                <View style={{ flexDirection: 'row', gap: sp.md }}>
                  <Btn title={t('common.cancel')} variant="secondary" onPress={() => setEditing(null)} style={{ flex: 1 }} />
                  <Btn title={t('common.save')} onPress={save} loading={busy} disabled={!title.trim()} style={{ flex: 1 }} />
                </View>
              </View>
            </KeyboardAvoidingView>
          </Modal>
        )}
      </GestureHandlerRootView>
    </Modal>
  )
}
