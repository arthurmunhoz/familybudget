// Add/edit a care event — a bottom-sheet modal. Mirrors the PWA's event sheet
// inside PetCare: pet picker, type picker (vet/vaccine/medication/grooming/other),
// title, date, optional next-due, optional notes. Used for new events, edits, and
// the "log again" re-log flow (the parent pre-fills the draft).
//
// 2026-11 redesign (components/form): pet and type are SelectRows instead of
// two walls of filled chips; the dates are rows that open a PickerSheet.
// Keyboard: the sheet is lifted above the keyboard (useSheetLift) and the
// fields scroll in a <KeyboardScroll> — KeyboardAvoidingView mis-measures
// inside a Modal.
import { Alert, Modal, StyleSheet, View } from 'react-native'
import { X } from 'lucide-react-native'

import { FormSection, SelectRow } from '@/components/form'
import { KeyboardScroll } from '@/components/KeyboardScroll'
import { Pressable } from '@/components/Pressable'
import { Btn, Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useSheetLift } from '@/hooks/useSheetLift'
import type { TKey } from '@/lib/i18n'
import { track } from '@/lib/analytics'
import { supabase } from '@/lib/supabase'
import type { Pet, PetEvent, PetEventType } from '@/lib/types'
import { sp, useTheme } from '@/theme/theme'
import { DangerRow, DayRow, InputRow } from '@/apps/calendar/calendarUi'
import { TYPES } from './petUi'

export interface EventDraft {
  pet: string
  type: PetEventType
  title: string
  date: string
  nextDue: string
  notes: string
}

export default function EventForm({
  pets,
  draft,
  setDraft,
  editingEvent,
  addedBy,
  onClose,
  onSaved,
  onDelete,
}: {
  pets: Pet[]
  draft: EventDraft
  setDraft: (d: EventDraft) => void
  editingEvent: PetEvent | null
  addedBy: string
  onClose: () => void
  onSaved: () => void
  onDelete: (ev: PetEvent) => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const bottomGap = useBottomGap(sp.lg)
  const { lift, room, clearOfBars, onRootLayout } = useSheetLift()
  const set = (patch: Partial<EventDraft>) => setDraft({ ...draft, ...patch })

  const canSave = !!draft.title.trim() && !!draft.pet

  async function save() {
    if (!canSave) return
    const fields = {
      pet_id: draft.pet,
      type: draft.type,
      title: draft.title.trim(),
      notes: draft.notes.trim() || null,
      event_date: draft.date,
      next_due: draft.nextDue || null,
    }
    const { error } = editingEvent
      ? await supabase.from('pet_events').update(fields).eq('id', editingEvent.id)
      : await supabase.from('pet_events').insert({ ...fields, added_by: addedBy })
    if (error) {
      Alert.alert(t('pets.saveFailed'))
      return
    }
    if (!editingEvent) track('pet.event_logged', { title: fields.title, kind: draft.type })
    else track('pet.event_updated', { title: fields.title, kind: draft.type })
    onSaved()
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop} onLayout={onRootLayout}>
        {/* the dimmed area above the sheet dismisses on tap */}
        <Pressable style={{ flex: 1 }} onPress={onClose} accessible={false} />
        <View style={[styles.sheet, { backgroundColor: c.sheet, maxHeight: room * 0.94, marginBottom: lift }]}>
          <View style={styles.sheetHead}>
            <Txt variant="h2">{editingEvent ? t('pets.editEvent') : t('pets.newEvent')}</Txt>
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
              <InputRow
                title
                value={draft.title}
                onChangeText={(v) => set({ title: v })}
                placeholder={
                  draft.type === 'medication' ? t('pets.titleMedPlaceholder') : t('pets.titlePlaceholder')
                }
              />
              <SelectRow
                label={t('pets.pet')}
                value={draft.pet}
                options={pets.map((p) => ({ value: p.id, label: `${p.emoji} ${p.name}` }))}
                onChange={(v) => {
                  if (v) set({ pet: v })
                }}
              />
              <SelectRow
                label={t('pets.typeLabel')}
                value={draft.type}
                options={TYPES.map((ty) => ({ value: ty, label: t(`pets.type.${ty}` as TKey) }))}
                onChange={(v) => {
                  if (v) set({ type: v })
                }}
              />
            </FormSection>

            <FormSection>
              <DayRow label={t('pets.date')} value={draft.date} onChange={(v) => set({ date: v })} />
              <DayRow
                label={t('pets.nextDue')}
                value={draft.nextDue}
                onChange={(v) => set({ nextDue: v })}
                optional
              />
            </FormSection>

            <FormSection>
              <InputRow
                multiline
                value={draft.notes}
                onChangeText={(v) => set({ notes: v })}
                placeholder={t('pets.notesPlaceholder')}
              />
            </FormSection>

            {editingEvent ? (
              <FormSection>
                <DangerRow
                  label={t('pets.deleteEvent')}
                  onPress={() => {
                    const ev = editingEvent
                    onClose()
                    onDelete(ev)
                  }}
                />
              </FormSection>
            ) : null}
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
              title={editingEvent ? t('common.saveChanges') : t('pets.saveEvent')}
              onPress={save}
              disabled={!canSave}
            />
          </View>
        </View>
      </View>
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
})
