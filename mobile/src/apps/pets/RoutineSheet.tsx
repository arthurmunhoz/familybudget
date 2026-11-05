// Edit one pet's care routine — a bottom-sheet modal. Daily tasks are a
// reorderable checklist (their order drives the widget's "next undone task");
// interval tasks carry an every-N-days cadence. Empty state seeds a suggested
// species routine (templateTasks) — a starting point, fully editable after.
//
// 2026-11 restyle, in the language of the Pet Care cards (owner: "every modal,
// or it'll look old"): a display title with its count in faded type under it,
// tasks on ONE rounded card with icon tiles in the PET'S colour and the
// cadence as a tinted pill, and "Add task" as a docked gradient button in that
// colour following the screen's bottom curve. The task editor leads with the
// name typed in place (like EventForm), a big icon preview beside it, the
// cadence as quick choices (week … year) plus a custom number of days, and
// the icon grid as tinted tiles.
//
// DraggableList needs gestures INSIDE this RN Modal, so the content is wrapped
// in its own GestureHandlerRootView (the app-root one doesn't reach a modal's
// separate native hierarchy — see NudgeSettings.tsx, the reference for this).
import { useMemo, useState } from 'react'
import { Alert, Keyboard, Modal, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { GripVertical, Plus, Sparkles, Trash2, X } from 'lucide-react-native'

import { DraggableList } from '@/components/DraggableList'
import { GradientBox } from '@/components/home/GradientBox'
import { shade } from '@/components/home/palette'
import { KeyboardScroll } from '@/components/KeyboardScroll'
import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useSheetLift } from '@/hooks/useSheetLift'
import { track } from '@/lib/analytics'
import type { TKey } from '@/lib/i18n'
import { templateTasks } from '@/lib/petCare'
import { supabase } from '@/lib/supabase'
import type { Pet, PetCareTask, PetTaskIcon } from '@/lib/types'
import { fonts, radius, sp, useTheme } from '@/theme/theme'
import { CARE_ICONS, CARE_ICON_IDS } from './petUi'
import { TintButton } from './TintButton'
import { CADENCE_PRESETS, everyLabel } from './careText'

const ROW_H = 62

/** Uppercase tracked label, like the Home's section heads. */
function Label({ children }: { children: string }) {
  const { c } = useTheme()
  return <Txt style={[styles.label, { color: c.textMuted }]}>{children}</Txt>
}

/** The round ✕ every sheet in Pet Care uses. */
function CloseBtn({ onPress }: { onPress: () => void }) {
  const { c } = useTheme()
  const { t } = useI18n()
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={t('common.close')}
      style={[styles.close, { backgroundColor: c.surface }]}
    >
      <X size={16} color={c.textMuted} />
    </Pressable>
  )
}

/** The task editor — a sheet NESTED in the routine sheet's modal (a sibling
 *  Modal fails to present on iOS). Hoisted so its inputs keep focus. */
function TaskEditor({
  isNew,
  kind,
  tint,
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
  tint: string
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
  const { c, dark } = useTheme()
  const { t } = useI18n()
  // Half the inset: the docked Save's curved corners meet the display's.
  const bottomGap = useBottomGap(sp.xs)
  const { lift, room, clearOfBars, onRootLayout } = useSheetLift()
  const Icon = CARE_ICONS[icon] ?? CARE_ICONS.paw
  const days = Math.round(Number(intervalDays) || 0)
  const soft = tint + (dark ? '2E' : '1A')
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop} onLayout={onRootLayout}>
        {/* A tap above the sheet only puts the keyboard away (the days box
            is a number pad, which has no return key) — never discards. */}
        <Pressable style={{ flex: 1 }} onPress={Keyboard.dismiss} accessible={false} />
        <View style={[styles.sheet, { backgroundColor: c.sheet, maxHeight: room * 0.94, marginBottom: lift }]}>
          {/* The name leads, typed in place, with the chosen icon beside it. */}
          <View style={styles.sheetHead}>
            <GradientBox colors={[tint, shade(tint, -0.22)]} radius={18} style={styles.bigIcon}>
              <Icon size={26} color="#fff" />
            </GradientBox>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Label>{isNew ? t('petcare.newTask') : t('petcare.editTask')}</Label>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder={t('petcare.taskTitleHint')}
                placeholderTextColor={c.textFaint}
                autoFocus={isNew}
                multiline
                blurOnSubmit
                returnKeyType="done"
                accessibilityLabel={t('petcare.taskTitleHint')}
                style={{ fontFamily: fonts.display, fontSize: 24, lineHeight: 29, color: c.text, padding: 0, marginTop: 2 }}
              />
            </View>
            <CloseBtn onPress={onClose} />
          </View>

          <KeyboardScroll
            style={{ flexGrow: 0, flexShrink: 1 }}
            contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: sp.lg }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* cadence — interval tasks only; the section decides the kind */}
            {kind === 'interval' ? (
              <>
                <Label>{t('petcare.repeats')}</Label>
                <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border, padding: sp.md, gap: sp.md }]}>
                  <View style={styles.chips}>
                    {CADENCE_PRESETS.map((p) => {
                      const on = days === p.days
                      return (
                        <Pressable
                          key={p.days}
                          onPress={() => setIntervalDays(String(p.days))}
                          accessibilityRole="button"
                          accessibilityState={{ selected: on }}
                          style={({ pressed }) => [
                            styles.chip,
                            { backgroundColor: on ? tint : soft, opacity: pressed ? 0.7 : 1 },
                          ]}
                        >
                          <Txt style={{ fontSize: 14, fontFamily: fonts.semibold, color: on ? '#fff' : tint }}>
                            {t(p.key as TKey)}
                          </Txt>
                        </Pressable>
                      )
                    })}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
                    <Txt style={{ fontSize: 15, color: c.textMuted }}>{t('petcare.customDays')}</Txt>
                    <TextInput
                      value={intervalDays}
                      onChangeText={(v) => setIntervalDays(v.replace(/[^0-9]/g, ''))}
                      keyboardType="number-pad"
                      maxLength={4}
                      selectTextOnFocus
                      accessibilityLabel={t('petcare.intervalDays')}
                      style={[styles.daysBox, { backgroundColor: soft, color: tint }]}
                    />
                    <Txt style={{ fontSize: 15, color: c.textMuted }}>{t('petcare.daysUnit')}</Txt>
                    {days > 0 ? (
                      <Txt style={{ marginLeft: 'auto', fontSize: 13, fontFamily: fonts.semibold, color: tint }}>
                        {everyLabel(days, t)}
                      </Txt>
                    ) : null}
                  </View>
                </View>
              </>
            ) : null}

            {/* icon — tinted tiles, the chosen one solid */}
            <Label>{t('petcare.iconLabel')}</Label>
            <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border, padding: sp.md }]}>
              <View style={styles.iconGrid}>
                {CARE_ICON_IDS.map((id) => {
                  const I = CARE_ICONS[id]
                  const on = icon === id
                  return (
                    <Pressable
                      key={id}
                      onPress={() => setIcon(id)}
                      accessibilityRole="button"
                      accessibilityLabel={id}
                      accessibilityState={{ selected: on }}
                      style={({ pressed }) => [
                        styles.iconTile,
                        { backgroundColor: on ? tint : soft, opacity: pressed ? 0.7 : 1 },
                      ]}
                    >
                      <I size={20} color={on ? '#fff' : tint} />
                    </Pressable>
                  )
                })}
              </View>
            </View>
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
            <TintButton
              tint={tint}
              title={isNew ? t('petcare.addTask') : t('common.saveChanges')}
              onPress={onSave}
              disabled={busy || !title.trim() || (kind === 'interval' && days < 1)}
            />
          </View>
        </View>
      </View>
    </Modal>
  )
}

export function RoutineSheet({
  pet,
  tint,
  tasks,
  section,
  onClose,
  onChanged,
}: {
  pet: Pet
  /** The pet's colour — the same one its cards wear. */
  tint: string
  /** This pet's tasks (both kinds — the template check needs the full picture). */
  tasks: PetCareTask[]
  /** Which section's pencil opened this: only that group is shown, and a new
   *  task belongs to it (so there's no Repeats selector to explain). */
  section: 'daily' | 'interval'
  onClose: () => void
  /** Reload + widget notify — called after every successful write. */
  onChanged: () => void
}) {
  const { c, dark } = useTheme()
  const bottomGap = useBottomGap(sp.xs)
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
  const shown = section === 'daily' ? daily : intervals
  const soft = tint + (dark ? '2E' : '1A')

  function openNew() {
    setEditing('new')
    setTitle('')
    setIcon(section === 'interval' ? 'bath' : 'paw')
    setIntervalDays('30')
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
      orderedIds.map((id, i) => supabase.from('pet_care_tasks').update({ sort_order: i }).eq('id', id)),
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

  function row(task: PetCareTask, draggable: boolean, first: boolean) {
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
          // A dragged row carries its own rule, so each draws the one above it.
          borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
          borderTopColor: c.border,
          backgroundColor: c.card,
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
          <View style={[styles.rowIcon, { backgroundColor: soft }]}>
            <Icon size={18} color={tint} />
          </View>
          <Txt style={{ flex: 1, fontFamily: fonts.display, fontSize: 16.5, color: c.text }} numberOfLines={1}>
            {task.title}
          </Txt>
          {task.kind === 'interval' && task.interval_days ? (
            <View style={[styles.pill, { backgroundColor: soft }]}>
              <Txt style={{ fontSize: 12, fontFamily: fonts.semibold, color: tint }}>
                {everyLabel(task.interval_days, t)}
              </Txt>
            </View>
          ) : null}
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

  const count = shown.length === 1 ? t('petcare.tasksOne') : t('petcare.tasksMany', { n: shown.length })
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={styles.backdrop}>
          {/* Tapping the dimmed area dismisses; taps inside the sheet don't. */}
          <Pressable style={{ flex: 1 }} onPress={onClose} accessible={false} />
          <View style={[styles.sheet, { backgroundColor: c.sheet, maxHeight: '88%' }]}>
            <View style={styles.sheetHead}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Label>{`${pet.emoji ? pet.emoji + ' ' : ''}${pet.name}`}</Label>
                <Txt style={{ fontFamily: fonts.display, fontSize: 28, lineHeight: 33, color: c.text }} numberOfLines={1}>
                  {t(section === 'daily' ? 'petcare.dailyRoutine' : 'petcare.routines')}
                </Txt>
                <Txt style={{ fontFamily: fonts.display, fontSize: 18, lineHeight: 23, color: c.textFaint }}>
                  {shown.length === 0
                    ? t('petcare.noTasksYet')
                    : section === 'daily' && shown.length > 1
                      ? `${count} · ${t('petcare.dragHint')}`
                      : count}
                </Txt>
              </View>
              <CloseBtn onPress={onClose} />
            </View>

            <ScrollView
              style={{ flexGrow: 0 }}
              contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: sp.md, gap: sp.md }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {tasks.length === 0 ? (
                <Pressable
                  onPress={seedTemplate}
                  disabled={busy}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.card,
                    styles.template,
                    { backgroundColor: soft, borderColor: tint + '55', opacity: pressed || busy ? 0.6 : 1 },
                  ]}
                >
                  <Sparkles size={18} color={tint} />
                  <Txt style={{ flex: 1, fontSize: 15, fontFamily: fonts.semibold, color: tint }}>
                    {t('petcare.useTemplate')}
                  </Txt>
                </Pressable>
              ) : null}

              {/* One rounded card. Not FormSection: its overflow clip would
                  cut off a row lifted mid-drag. */}
              {shown.length > 0 ? (
                <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
                  {section === 'daily' ? (
                    <DraggableList
                      data={daily}
                      rowHeight={ROW_H}
                      onReorder={reorder}
                      renderItem={(item) => row(item, true, item.id === daily[0]?.id)}
                    />
                  ) : (
                    intervals.map((task, i) => <View key={task.id}>{row(task, false, i === 0)}</View>)
                  )}
                </View>
              ) : null}
            </ScrollView>

            {/* add — docked, in the pet's colour, following the screen's curve */}
            <View style={{ paddingHorizontal: sp.lg, paddingTop: sp.sm, paddingBottom: bottomGap }}>
              <TintButton
                tint={tint}
                title={t('petcare.addTask')}
                icon={<Plus size={18} color="#fff" strokeWidth={2.6} />}
                onPress={openNew}
              />
            </View>
          </View>
        </View>

        {/* task editor — nested in this modal's tree */}
        {editing !== null && (
          <TaskEditor
            isNew={editing === 'new'}
            kind={kind}
            tint={tint}
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
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: sp.lg,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: sp.md,
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
  label: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginTop: sp.sm,
    marginBottom: sp.sm,
  },
  card: {
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  template: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.md,
    padding: sp.md,
    minHeight: 56,
  },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  addBtn: {
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  bigIcon: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm },
  chip: {
    paddingHorizontal: 14,
    height: 36,
    borderRadius: radius.pill,
    justifyContent: 'center',
  },
  daysBox: {
    width: 64,
    height: 38,
    borderRadius: 12,
    textAlign: 'center',
    fontFamily: fonts.semibold,
    fontSize: 16,
    paddingVertical: 0,
  },
  // 8 icons → two rows of four, filling the card's width.
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 10, justifyContent: 'space-between' },
  iconTile: {
    width: '23%',
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
