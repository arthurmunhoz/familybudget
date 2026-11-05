// Add/edit a calendar event — a bottom-sheet modal. Mirrors the PWA's event
// sheet: title, type/kind, all-day toggle, start/end date, start/end time when
// timed, owner (member or whole household), recurrence, reminder toggle,
// location, notes. Inserts/updates calendar_events (household_id/created_by are
// stamped by column defaults under RLS). Google-sourced rows are read-only and
// never reach this form.
//
// 2026-11 redesign (components/form): grouped rows instead of labelled boxes
// and chip walls. Type, Who and Repeats are SelectRows (value in the row, list
// in a checked sheet); Starts/Ends carry the date and, when timed, the time as
// two chips — each opens its own PickerSheet, never an inline picker.
//
// Keyboard: the sheet sits on top of the keyboard (useSheetLift) and the
// fields scroll in a <KeyboardScroll>, which brings the focused one into view.
// Without either, Location and Notes were typed blind under the keyboard.
import { useState } from 'react'
import { Alert, Modal, StyleSheet, View } from 'react-native'
import { ChevronsUpDown, X } from 'lucide-react-native'

import { FormRow, FormSection, RowValue, SelectRow, SelectSheet, ToggleRow } from '@/components/form'
import { KeyboardScroll } from '@/components/KeyboardScroll'
import { Pressable } from '@/components/Pressable'
import { Btn, Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'
import { HOUSEHOLD_COLOR, KIND_EMOJI, memberColor } from '@/lib/calendar'
import { track } from '@/lib/analytics'
import { supabase } from '@/lib/supabase'
import type { CalendarEvent, EventKind, EventRecurrence, Profile } from '@/lib/types'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useSheetLift } from '@/hooks/useSheetLift'
import { sp, useTheme } from '@/theme/theme'
import { DangerRow, DateTimeRow, InputRow } from './calendarUi'

const RECURRENCES: EventRecurrence[] = ['none', 'daily', 'weekly', 'monthly', 'yearly']
const KINDS: EventKind[] = ['event', 'birthday', 'anniversary', 'renewal', 'other']
/** SelectSheet values are strings; this one stands for "whole household"
 *  (owner_email null). Can't collide with an email. */
const HOUSEHOLD = '*'

export interface EventDraft {
  title: string
  allDay: boolean
  start: string
  end: string
  startTime: string
  endTime: string
  owner: string | null
  kind: EventKind
  repeat: EventRecurrence
  remind: boolean
  location: string
  notes: string
}

const isoToDate = (iso: string): Date | undefined => {
  const [y, m, d] = iso.split('-').map(Number)
  return y && m && d ? new Date(y, m - 1, d) : undefined
}

/** "Who": the member's colour dot + name in the row (events are coloured by
 *  owner, so the dot is the point), the list in a checked sheet. */
function OwnerRow({
  label,
  owner,
  profiles,
  memberEmails,
  onChange,
}: {
  label: string
  owner: string | null
  profiles: Profile[]
  memberEmails: string[]
  onChange: (owner: string | null) => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const current = owner === null ? null : profiles.find((p) => p.email === owner)
  const color = owner === null ? HOUSEHOLD_COLOR : memberColor(owner, memberEmails)
  const options = [
    { value: HOUSEHOLD, label: t('calendar.everyone') },
    ...profiles.map((p) => ({ value: p.email, label: p.display_name })),
  ]
  return (
    <>
      <FormRow label={label} onPress={() => setOpen(true)}>
        <View style={{ height: 10, width: 10, borderRadius: 5, backgroundColor: color }} />
        <RowValue value={owner === null ? t('calendar.everyone') : (current?.display_name ?? owner)} placeholder="" />
        <ChevronsUpDown size={15} color={c.textFaint} />
      </FormRow>
      <SelectSheet
        visible={open}
        title={label}
        value={owner ?? HOUSEHOLD}
        options={options}
        onPick={(v) => {
          onChange(v === HOUSEHOLD || v === '' ? null : v)
          setOpen(false)
        }}
        onClose={() => setOpen(false)}
      />
    </>
  )
}

export default function EventForm({
  draft,
  setDraft,
  editing,
  profiles,
  memberEmails,
  locale,
  onClose,
  onSaved,
  onDelete,
}: {
  draft: EventDraft
  setDraft: (d: EventDraft) => void
  editing: CalendarEvent | null
  profiles: Profile[]
  memberEmails: string[]
  locale: string
  onClose: () => void
  onSaved: (savedStart: string) => void
  onDelete: (ev: CalendarEvent) => void
}) {
  const { c } = useTheme()
  const bottomGap = useBottomGap(sp.lg)
  const { lift, room, clearOfBars, onRootLayout } = useSheetLift()
  const { t } = useI18n()
  const [saving, setSaving] = useState(false)
  const set = (patch: Partial<EventDraft>) => setDraft({ ...draft, ...patch })

  const canSave = !!draft.title.trim() && !saving

  async function save() {
    if (!canSave) return
    setSaving(true)
    const end = draft.end < draft.start ? draft.start : draft.end
    const fields = {
      title: draft.title.trim(),
      start_date: draft.start,
      end_date: end,
      all_day: draft.allDay,
      start_time: draft.allDay ? null : `${draft.startTime}:00`,
      end_time: draft.allDay ? null : `${draft.endTime}:00`,
      owner_email: draft.owner,
      kind: draft.kind,
      recurrence: draft.repeat,
      reminder_minutes: draft.remind ? 0 : null,
      location: draft.location.trim() || null,
      notes: draft.notes.trim() || null,
      // Bump on every edit so a future Google sync push knows this row changed.
      updated_at: new Date().toISOString(),
    }
    const { error } = editing
      ? await supabase.from('calendar_events').update(fields).eq('id', editing.id)
      : await supabase.from('calendar_events').insert(fields)
    setSaving(false)
    if (error) {
      Alert.alert(t('calendar.saveFailed'))
      return
    }
    if (!editing) track('calendar.created', { title: fields.title, kind: draft.kind })
    else track('calendar.updated', { title: fields.title, kind: draft.kind })
    onSaved(draft.start)
  }

  function pickKind(k: EventKind) {
    // Special dated kinds behave like the old Important Dates: all-day,
    // household-wide; birthdays/anniversaries repeat yearly.
    if (k === 'event') {
      set({ kind: k })
    } else {
      set({
        kind: k,
        allDay: true,
        owner: null,
        repeat: k === 'birthday' || k === 'anniversary' ? 'yearly' : draft.repeat,
      })
    }
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop} onLayout={onRootLayout}>
        <View
          style={[
            styles.sheet,
            // Against what the keyboard leaves, so the sheet never grows
            // behind it.
            { backgroundColor: c.sheet, maxHeight: room * 0.94, marginBottom: lift },
          ]}
        >
          <View style={styles.sheetHead}>
            <Txt variant="h2">{editing ? t('calendar.editEvent') : t('calendar.newEvent')}</Txt>
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
            // flexShrink so the fields yield to the sheet's max height once the
            // keyboard has taken half the screen; flexGrow 0 keeps it a sheet.
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
                placeholder={t('calendar.titlePlaceholder')}
                autoFocus={!editing}
              />
              <SelectRow
                label={t('calendar.typeLabel')}
                value={draft.kind}
                options={KINDS.map((k) => ({
                  value: k,
                  label: `${KIND_EMOJI[k] ? `${KIND_EMOJI[k]} ` : ''}${t(`calendar.kind.${k}` as TKey)}`,
                }))}
                onChange={(v) => {
                  if (v) pickKind(v)
                }}
              />
            </FormSection>

            <FormSection>
              <ToggleRow label={t('calendar.allDay')} value={draft.allDay} onValueChange={(v) => set({ allDay: v })} />
              <DateTimeRow
                label={t('calendar.startLabel')}
                date={draft.start}
                time={draft.allDay ? null : draft.startTime}
                locale={locale}
                onDate={(v) => set({ start: v, end: draft.end < v ? v : draft.end })}
                onTime={(v) => set({ startTime: v })}
              />
              <DateTimeRow
                label={t('calendar.endLabel')}
                date={draft.end}
                time={draft.allDay ? null : draft.endTime}
                locale={locale}
                minimumDate={isoToDate(draft.start)}
                onDate={(v) => set({ end: v })}
                onTime={(v) => set({ endTime: v })}
              />
              <SelectRow
                label={t('calendar.repeatLabel')}
                value={draft.repeat}
                options={RECURRENCES.map((r) => ({ value: r, label: t(`calendar.repeat.${r}` as TKey) }))}
                onChange={(v) => {
                  if (v) set({ repeat: v })
                }}
              />
            </FormSection>

            <FormSection>
              <OwnerRow
                label={t('calendar.ownerLabel')}
                owner={draft.owner}
                profiles={profiles}
                memberEmails={memberEmails}
                onChange={(owner) => set({ owner })}
              />
              <ToggleRow label={t('calendar.remind')} value={draft.remind} onValueChange={(v) => set({ remind: v })} />
            </FormSection>

            <FormSection>
              <InputRow
                value={draft.location}
                onChangeText={(v) => set({ location: v })}
                placeholder={t('calendar.locationPlaceholder')}
              />
              <InputRow
                multiline
                value={draft.notes}
                onChangeText={(v) => set({ notes: v })}
                placeholder={t('calendar.notesPlaceholder')}
              />
            </FormSection>

            {editing ? (
              <FormSection>
                <DangerRow
                  label={t('calendar.deleteEvent')}
                  onPress={() => {
                    const ev = editing
                    onClose()
                    onDelete(ev)
                  }}
                />
              </FormSection>
            ) : null}
          </KeyboardScroll>

          {/* save — docked. iOS with no keyboard: clear the home indicator.
              Otherwise the sheet already sits above the keyboard / nav bar. */}
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
              title={editing ? t('common.saveChanges') : t('calendar.saveEvent')}
              onPress={save}
              disabled={!canSave}
              loading={saving}
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
