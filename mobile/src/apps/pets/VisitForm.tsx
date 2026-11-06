// Log a vet visit or a vaccine — the sheet behind Pet Care's two docked
// buttons (owner, 2026-11). The generic EventForm asked which pet and which
// type, though the screen already knows both (you're on Lola's page, you
// tapped "Vaccine"); this one asks only what matters for THAT kind of event:
//   • the name, typed in place, with quick picks (vaccines by species)
//   • when it happened
//   • when the next one is due — a few chips (3 weeks / 1 year / 3 years for
//     a vaccine; 2 weeks / 6 months / 1 year for a visit) or a date. A next
//     date is what puts it in the Care grid.
//   • notes (vet, clinic, batch number…)
// Also used to edit, and for "log it again", of vet/vaccine events. Other
// types (older medication / grooming entries) still open EventForm.
import { Alert, Modal, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { X } from 'lucide-react-native'

import { GradientBox } from '@/components/home/GradientBox'
import { shade } from '@/components/home/palette'
import { FormSection } from '@/components/form'
import { KeyboardScroll } from '@/components/KeyboardScroll'
import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useI18n } from '@/hooks/useI18n'
import { useSheetLift } from '@/hooks/useSheetLift'
import { track } from '@/lib/analytics'
import { addDaysISO } from '@/lib/format'
import type { TKey } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'
import type { Pet, PetEvent } from '@/lib/types'
import { fonts, radius, sp, useTheme } from '@/theme/theme'
import { DangerRow, DayRow, InputRow } from '@/apps/calendar/calendarUi'
import type { EventDraft } from './EventForm'
import { TYPE_COLOR } from './petColors'
import { TYPE_ICON } from './petUi'
import { TintButton } from '@/components/TintButton'
import { nextChoices, vaccineKeys, VISIT_KEYS } from './visitPresets'

export default function VisitForm({
  pet,
  draft,
  setDraft,
  editingEvent,
  addedBy,
  onClose,
  onSaved,
  onDelete,
}: {
  pet: Pet
  /** `type` is 'vet' or 'vaccine'; `pet` is this pet. */
  draft: EventDraft
  setDraft: (d: EventDraft) => void
  editingEvent: PetEvent | null
  addedBy: string
  onClose: () => void
  onSaved: () => void
  onDelete: (ev: PetEvent) => void
}) {
  const { c, dark } = useTheme()
  const { t } = useI18n()
  // Half the inset: the docked Save's curved corners meet the display's.
  const bottomGap = useBottomGap(sp.xs)
  const { lift, room, clearOfBars, onRootLayout } = useSheetLift()
  const type = draft.type === 'vaccine' ? 'vaccine' : 'vet'
  const tint = TYPE_COLOR[type]
  const soft = tint + (dark ? '2E' : '1A')
  const Icon = TYPE_ICON[type]
  const set = (patch: Partial<EventDraft>) => setDraft({ ...draft, ...patch })
  const picks = type === 'vaccine' ? vaccineKeys(pet.species) : VISIT_KEYS
  const choices = nextChoices(type)
  const canSave = !!draft.title.trim() && !!draft.date

  async function save() {
    if (!canSave) return
    const fields = {
      pet_id: pet.id,
      type,
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
    track(editingEvent ? 'pet.event_updated' : 'pet.event_logged', { title: fields.title, kind: type })
    onSaved()
  }

  const chip = (label: string, on: boolean, onPress: () => void, key: string) => (
    <Pressable
      key={key}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={({ pressed }) => [s.chip, { backgroundColor: on ? tint : soft, opacity: pressed ? 0.7 : 1 }]}
    >
      <Txt style={{ fontSize: 14, fontFamily: fonts.semibold, color: on ? '#fff' : tint }} numberOfLines={1}>
        {label}
      </Txt>
    </Pressable>
  )

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop} onLayout={onRootLayout}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessible={false} />
        <View style={[s.sheet, { backgroundColor: c.sheet, maxHeight: room * 0.94, marginBottom: lift }]}>
          {/* Who and what are known — they're the kicker; the name leads. */}
          <View style={s.head}>
            <GradientBox colors={[tint, shade(tint, -0.22)]} radius={18} style={s.tile}>
              <Icon size={26} color="#fff" />
            </GradientBox>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt style={[s.kicker, { color: c.textMuted }]} numberOfLines={1}>
                {`${pet.name} · ${t(type === 'vaccine' ? 'pets.addVaccine' : 'pets.addVet')}`}
              </Txt>
              <TextInput
                value={draft.title}
                onChangeText={(v) => set({ title: v })}
                placeholder={t(type === 'vaccine' ? 'pets.visit.vaxPlaceholder' : 'pets.visit.vetPlaceholder')}
                placeholderTextColor={c.textFaint}
                autoFocus={!editingEvent && !draft.title}
                multiline
                blurOnSubmit
                returnKeyType="done"
                accessibilityLabel={t(type === 'vaccine' ? 'pets.visit.vaxPlaceholder' : 'pets.visit.vetPlaceholder')}
                style={{ fontFamily: fonts.display, fontSize: 26, lineHeight: 31, color: c.text, padding: 0, marginTop: 2 }}
              />
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              style={[s.close, { backgroundColor: c.surface }]}
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
            {/* Quick picks: one tap names it (vaccines by species). */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm }} keyboardShouldPersistTaps="handled">
              {picks.map((k) => {
                const label = t(k as TKey)
                return chip(label, draft.title.trim() === label, () => set({ title: label }), k)
              })}
            </ScrollView>

            <FormSection>
              <DayRow tint={tint} label={t('pets.visit.when')} value={draft.date} onChange={(v) => set({ date: v })} maximumDate={new Date()} />
            </FormSection>

            {/* Next one: a chip computes it from the date above; the row
                below shows (and lets you pick) the exact day. */}
            <View>
              <Txt style={[s.label, { color: c.textMuted }]}>
                {t(type === 'vaccine' ? 'pets.visit.nextVax' : 'pets.visit.nextVet')}
              </Txt>
              <View style={[s.card, { backgroundColor: c.card, borderColor: c.border }]}>
                <View style={s.chips}>
                  {chip(t('pets.next.none'), !draft.nextDue, () => set({ nextDue: '' }), 'none')}
                  {choices.map((ch) => {
                    const iso = draft.date ? addDaysISO(draft.date, ch.days) : ''
                    return chip(t(ch.key as TKey), !!iso && draft.nextDue === iso, () => set({ nextDue: iso }), ch.key)
                  })}
                </View>
                <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border }}>
                  <DayRow tint={tint} label={t('pets.nextDue')} value={draft.nextDue} onChange={(v) => set({ nextDue: v })} optional />
                </View>
              </View>
            </View>

            <FormSection>
              <InputRow
                multiline
                value={draft.notes}
                onChangeText={(v) => set({ notes: v })}
                placeholder={t(type === 'vaccine' ? 'pets.visit.vaxNotes' : 'pets.visit.vetNotes')}
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

          <View style={{ paddingHorizontal: sp.lg, paddingTop: sp.sm, paddingBottom: clearOfBars ? sp.md : bottomGap }}>
            <TintButton
              tint={tint}
              title={
                editingEvent
                  ? t('common.saveChanges')
                  : t(type === 'vaccine' ? 'pets.visit.saveVax' : 'pets.visit.saveVet')
              }
              onPress={save}
              disabled={!canSave}
            />
          </View>
        </View>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: sp.lg },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingHorizontal: sp.lg, paddingBottom: sp.md },
  tile: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  kicker: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase' },
  close: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase', marginBottom: sp.sm },
  card: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, padding: sp.md },
  chip: { paddingHorizontal: 14, height: 36, borderRadius: radius.pill, justifyContent: 'center' },
})
