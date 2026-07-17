// Add/edit a care event — a bottom-sheet modal. Mirrors the PWA's event sheet
// inside PetCare: pet picker, type picker (vet/vaccine/medication/grooming/other),
// title, date, optional next-due, optional notes. Used for new events, edits, and
// the "log again" re-log flow (the parent pre-fills the draft).
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native'
import { X } from 'lucide-react-native'

import { Btn, Field, Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'
import { track } from '@/lib/analytics'
import { supabase } from '@/lib/supabase'
import type { Pet, PetEvent, PetEventType } from '@/lib/types'
import { radius, sp, useTheme } from '@/theme/theme'
import { DateField, Pill_, TYPES, TYPE_ICON } from './petUi'

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
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
      >
        <View
          style={{
            maxHeight: '90%',
            backgroundColor: c.card,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: sp.lg,
              paddingTop: sp.lg,
              paddingBottom: sp.sm,
            }}
          >
            <Txt variant="h2">{editingEvent ? t('pets.editEvent') : t('pets.newEvent')}</Txt>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel={t('common.close')}>
              <X size={22} color={c.textMuted} />
            </Pressable>
          </View>

          <ScrollView
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: sp.md, gap: sp.md }}
            keyboardShouldPersistTaps="handled"
          >
            {/* pet */}
            <View style={{ gap: 6 }}>
              <Txt variant="label">{t('pets.pet')}</Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                {pets.map((p) => (
                  <Pill_ key={p.id} active={draft.pet === p.id} onPress={() => set({ pet: p.id })}>
                    <Txt
                      style={{
                        color: draft.pet === p.id ? '#fff' : c.textMuted,
                        fontWeight: '600',
                      }}
                    >
                      {p.emoji} {p.name}
                    </Txt>
                  </Pill_>
                ))}
              </View>
            </View>

            {/* type */}
            <View style={{ gap: 6 }}>
              <Txt variant="label">{t('pets.typeLabel')}</Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                {TYPES.map((ty) => {
                  const Icon = TYPE_ICON[ty]
                  const active = draft.type === ty
                  return (
                    <Pill_ key={ty} active={active} onPress={() => set({ type: ty })}>
                      <Icon size={16} color={active ? '#fff' : c.textMuted} />
                      <Txt style={{ color: active ? '#fff' : c.textMuted, fontWeight: '600' }}>
                        {t(`pets.type.${ty}` as TKey)}
                      </Txt>
                    </Pill_>
                  )
                })}
              </View>
            </View>

            <Field
              value={draft.title}
              onChangeText={(v) => set({ title: v })}
              placeholder={
                draft.type === 'medication'
                  ? t('pets.titleMedPlaceholder')
                  : t('pets.titlePlaceholder')
              }
            />

            <View style={{ flexDirection: 'row', gap: sp.md }}>
              <DateField
                label={t('pets.date')}
                value={draft.date}
                placeholder={t('pets.date')}
                onChange={(v) => set({ date: v })}
              />
              <DateField
                label={t('pets.nextDue')}
                value={draft.nextDue}
                placeholder={t('pets.optional')}
                onChange={(v) => set({ nextDue: v })}
                optional
              />
            </View>

            <Field
              value={draft.notes}
              onChangeText={(v) => set({ notes: v })}
              placeholder={t('pets.notesPlaceholder')}
            />
          </ScrollView>

          <View style={{ paddingHorizontal: sp.lg, paddingTop: sp.md, paddingBottom: sp.xl, gap: sp.md }}>
            <Btn
              title={editingEvent ? t('common.saveChanges') : t('pets.saveEvent')}
              onPress={save}
              disabled={!canSave}
            />
            {editingEvent ? (
              <Pressable
                onPress={() => {
                  const ev = editingEvent
                  onClose()
                  onDelete(ev)
                }}
                style={{ paddingVertical: 12, alignItems: 'center' }}
              >
                <Txt style={{ color: c.expense, fontWeight: '600' }}>{t('pets.deleteEvent')}</Txt>
              </Pressable>
            ) : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}
