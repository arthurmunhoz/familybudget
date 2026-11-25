// Add/edit a calendar event — a bottom-sheet modal. Mirrors the PWA's event
// sheet: title, type/kind, all-day toggle, start/end date, start/end time when
// timed, owner (member or whole household), recurrence, reminder toggle,
// location, notes. Inserts/updates calendar_events (household_id/created_by are
// stamped by column defaults under RLS).
//
// External rows (2026-11): MY events pulled from Google / Apple open here too
// (`external`), without Type / Repeats / Who — those belong to the source. A
// Google edit is pushed by the next sync (updated_at bump); an Apple edit is
// written to the device first (EventKit, this occurrence only).
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
import { Alert, Keyboard, Modal, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { Bell, CalendarCheck, CalendarDays, MapPin, Repeat, StickyNote, Sun, Users, X, type LucideIcon } from 'lucide-react-native'

import {
  ALL_DAY_REMINDER_OPTIONS,
  DEFAULT_ALL_DAY_REMINDER,
  DEFAULT_TIMED_REMINDER,
  TIMED_REMINDER_OPTIONS,
} from '@/lib/eventReminderPlan'
import { ensureReminderPermission } from '@/lib/petReminders'
import { FormSection, RowIcon, SelectRow, ToggleRow } from '@/components/form'
import { GradientBox } from '@/components/home/GradientBox'
import { APP_GRADIENT } from '@/components/home/palette'
import { TintButton } from '@/components/TintButton'
import { KeyboardScroll } from '@/components/KeyboardScroll'
import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'
import { HOUSEHOLD_COLOR, KIND_EMOJI, memberColor } from '@/lib/calendar'
import { fieldsUsed, track } from '@/lib/analytics'
import { supabase } from '@/lib/supabase'
import { updateAppleEvent } from '@/lib/appleCalendar'
import type { CalendarEvent, EventKind, EventRecurrence, Profile } from '@/lib/types'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useSheetLift } from '@/hooks/useSheetLift'
import { fonts, sp, useTheme } from '@/theme/theme'
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
  /** minutes before the start to remind; null = no reminder */
  remindMin: number | null
  location: string
  notes: string
}

/** The "Remind me" choices: minutes before for a timed event; for an all-day
 *  one, 9:00 on the day / days before (eventReminderPlan). A value set some
 *  other way (the assistant's "45 min before") stays listed. */
function reminderLabel(min: number, allDay: boolean, t: (k: TKey, v?: Record<string, string | number>) => string): string {
  if (allDay) {
    if (min <= 0) return t('calendar.remindDayOf')
    if (min === 10080) return t('calendar.remindWeekBefore9')
    const d = Math.round(min / 1440)
    return d === 1 ? t('calendar.remindDayBefore9') : t('calendar.remindDaysBefore9', { n: d })
  }
  if (min <= 0) return t('calendar.remindAtStart')
  if (min < 60) return t('calendar.remindMin', { n: min })
  if (min === 60) return t('calendar.remindHour')
  if (min < 1440) return t('calendar.remindHours', { n: Math.round(min / 60) })
  return min === 1440 ? t('calendar.remindDay') : t('calendar.remindDaysBefore9', { n: Math.round(min / 1440) })
}

function reminderOptions(
  allDay: boolean,
  current: number | null,
  t: (k: TKey, v?: Record<string, string | number>) => string,
): { value: string; label: string }[] {
  const list: number[] = [...(allDay ? ALL_DAY_REMINDER_OPTIONS : TIMED_REMINDER_OPTIONS)]
  if (current != null && !list.includes(current)) list.push(current)
  list.sort((a, b) => a - b)
  return [{ value: 'off', label: t('calendar.remindOff') }, ...list.map((m) => ({ value: String(m), label: reminderLabel(m, allDay, t) }))]
}

const isoToDate = (iso: string): Date | undefined => {
  const [y, m, d] = iso.split('-').map(Number)
  return y && m && d ? new Date(y, m - 1, d) : undefined
}

/** "Who": the household and each member as a round chip in their own colour
 *  (events are coloured by owner, so the colour is the point) — one tap, no
 *  sheet (2026-11). */
function WhoPicker({
  owner,
  profiles,
  memberEmails,
  onChange,
}: {
  owner: string | null
  profiles: Profile[]
  memberEmails: string[]
  onChange: (owner: string | null) => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const options: { key: string; email: string | null; label: string; color: string }[] = [
    { key: HOUSEHOLD, email: null, label: t('calendar.everyone'), color: HOUSEHOLD_COLOR },
    ...profiles.map((p) => ({
      key: p.email,
      email: p.email,
      label: p.display_name.split(' ')[0],
      color: memberColor(p.email, memberEmails),
    })),
  ]
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingVertical: 2 }}>
      {options.map((o) => {
        const on = (owner ?? null) === o.email
        const ini = o.email
          ? o.label.slice(0, 1).toUpperCase()
          : null
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.email)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}
            style={{ alignItems: 'center', gap: 5, width: 62 }}
          >
            <View style={{ padding: 3, borderRadius: 30, borderWidth: 2.5, borderColor: on ? o.color : 'transparent' }}>
              <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: o.color, alignItems: 'center', justifyContent: 'center' }}>
                {ini ? (
                  <Txt style={{ fontFamily: fonts.semibold, fontSize: 18, color: '#fff' }}>{ini}</Txt>
                ) : (
                  <Users size={20} color="#fff" />
                )}
              </View>
            </View>
            <Txt
              style={{ fontSize: 12.5, fontFamily: on ? fonts.semibold : fonts.body, color: on ? c.text : c.textMuted }}
              numberOfLines={1}
            >
              {o.label}
            </Txt>
          </Pressable>
        )
      })}
    </ScrollView>
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
  external = null,
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
  /** Editing one of MY Google/Apple-pulled events (see header). */
  external?: 'google' | 'apple' | null
}) {
  const { c, dark } = useTheme()
  const bottomGap = useBottomGap(sp.xs)
  const { lift, room, clearOfBars, onRootLayout } = useSheetLift()
  const { t } = useI18n()
  const [saving, setSaving] = useState(false)
  const set = (patch: Partial<EventDraft>) => setDraft({ ...draft, ...patch })

  const canSave = !!draft.title.trim() && !saving

  async function save() {
    if (!canSave) return
    setSaving(true)
    const end = draft.end < draft.start ? draft.start : draft.end
    const base = {
      title: draft.title.trim(),
      start_date: draft.start,
      end_date: end,
      all_day: draft.allDay,
      start_time: draft.allDay ? null : `${draft.startTime}:00`,
      end_time: draft.allDay ? null : `${draft.endTime}:00`,
      reminder_minutes: draft.remindMin,
      location: draft.location.trim() || null,
      notes: draft.notes.trim() || null,
      // Bump on every edit so the Google sync push knows this row changed.
      updated_at: new Date().toISOString(),
    }
    // Owner / kind / repeat stay the source's for an external event.
    const fields: Record<string, unknown> = external
      ? { ...base }
      : { ...base, owner_email: draft.owner, kind: draft.kind, recurrence: draft.repeat }
    if (external === 'apple' && editing) {
      try {
        fields.apple_event_id = await updateAppleEvent(editing, { ...editing, ...base })
      } catch {
        setSaving(false)
        Alert.alert(t('calendar.externalSaveFailed'))
        return
      }
    }
    const { error } = editing
      ? await supabase.from('calendar_events').update(fields).eq('id', editing.id)
      : await supabase.from('calendar_events').insert(fields)
    setSaving(false)
    if (error) {
      Alert.alert(t('calendar.saveFailed'))
      return
    }
    track(editing ? 'calendar.updated' : 'calendar.created', {
      title: base.title,
      ...(external ? { source: external } : {}),
      kind: draft.kind,
      allDay: draft.allDay,
      multiDay: end > draft.start,
      repeat: draft.repeat,
      forWhom: draft.owner ? 'member' : 'household',
      ...fieldsUsed({ reminder: draft.remindMin != null, location: base.location, notes: base.notes }),
    })
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

  const red = APP_GRADIENT.calendar as [string, string]
  const tint = red[1]
  const soft = tint + (dark ? '2E' : '17')
  const kindEmoji = KIND_EMOJI[draft.kind]
  const ri = (Icon: LucideIcon) => <RowIcon Icon={Icon} tint={tint} />

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop} onLayout={onRootLayout}>
        <Pressable style={{ flex: 1 }} onPress={() => Keyboard.dismiss()} accessible={false} />
        <View
          style={[
            styles.sheet,
            // Against what the keyboard leaves, so the sheet never grows behind it.
            { backgroundColor: c.sheet, maxHeight: room * 0.94, marginBottom: lift },
          ]}
        >
          {/* The event's name leads, large and typed in place, beside a tile in
              the Calendar's red (or the kind's emoji) — 2026-11. */}
          <View style={styles.sheetHead}>
            <GradientBox colors={red} radius={18} style={styles.tile}>
              {kindEmoji ? <Txt style={{ fontSize: 26 }}>{kindEmoji}</Txt> : <CalendarDays size={26} color="#fff" />}
            </GradientBox>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt style={[styles.kicker, { color: c.textMuted }]}>
                {editing ? t('calendar.editEvent') : t('calendar.newEvent')}
              </Txt>
              <TextInput
                value={draft.title}
                onChangeText={(v) => set({ title: v })}
                placeholder={t('calendar.titlePlaceholder')}
                placeholderTextColor={c.textFaint}
                autoFocus={!editing}
                multiline
                blurOnSubmit
                returnKeyType="done"
                accessibilityLabel={t('calendar.titlePlaceholder')}
                style={{ fontFamily: fonts.display, fontSize: 26, lineHeight: 31, color: c.text, padding: 0, marginTop: 2 }}
              />
            </View>
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
            {external ? (
              <Txt variant="muted" style={{ fontSize: 13.5, lineHeight: 19 }}>
                {t(external === 'google' ? 'calendar.externalNoteGoogle' : 'calendar.externalNoteApple')}
              </Txt>
            ) : null}

            {/* kind: chips with their emoji */}
            {external ? null : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm }} keyboardShouldPersistTaps="handled">
              {KINDS.map((k) => {
                const on = draft.kind === k
                return (
                  <Pressable
                    key={k}
                    onPress={() => pickKind(k)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    // Selected = soft wash + outline (2026-11): the head tile is the
                    // sheet's one solid colour; the rest stay neutral.
                    style={({ pressed }) => [
                      styles.chip,
                      on
                        ? { backgroundColor: soft, borderWidth: 1.5, borderColor: tint }
                        : { backgroundColor: c.card, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border },
                      { opacity: pressed ? 0.7 : 1 },
                    ]}
                  >
                    {KIND_EMOJI[k] ? <Txt style={{ fontSize: 14 }}>{KIND_EMOJI[k]}</Txt> : null}
                    <Txt style={{ fontSize: 14, fontFamily: fonts.semibold, color: on ? tint : c.text }}>
                      {t(`calendar.kind.${k}` as TKey)}
                    </Txt>
                  </Pressable>
                )
              })}
            </ScrollView>
            )}

            {/* when */}
            <View>
              <Txt style={[styles.label, { color: c.textMuted }]}>{t('calendar.whenLabel')}</Txt>
              <FormSection>
                <ToggleRow
                  icon={ri(Sun)}
                  tint={tint}
                  label={t('calendar.allDay')}
                  value={draft.allDay}
                  // A reminder carries over as the other kind's default ("10 min
                  // before" means nothing for an all-day event).
                  onValueChange={(v) =>
                    set({
                      allDay: v,
                      remindMin:
                        draft.remindMin == null ? null : v ? DEFAULT_ALL_DAY_REMINDER : DEFAULT_TIMED_REMINDER,
                    })
                  }
                />
                <DateTimeRow
                  tint={tint}
                  icon={ri(CalendarDays)}
                  label={t('calendar.startLabel')}
                  date={draft.start}
                  time={draft.allDay ? null : draft.startTime}
                  locale={locale}
                  onDate={(v) => set({ start: v, end: draft.end < v ? v : draft.end })}
                  onTime={(v) => set({ startTime: v })}
                />
                <DateTimeRow
                  tint={tint}
                  icon={ri(CalendarCheck)}
                  label={t('calendar.endLabel')}
                  date={draft.end}
                  time={draft.allDay ? null : draft.endTime}
                  locale={locale}
                  minimumDate={isoToDate(draft.start)}
                  onDate={(v) => set({ end: v })}
                  onTime={(v) => set({ endTime: v })}
                />
                {external ? null : (
                <SelectRow
                  icon={ri(Repeat)}
                  label={t('calendar.repeatLabel')}
                  value={draft.repeat}
                  options={RECURRENCES.map((r) => ({ value: r, label: t(`calendar.repeat.${r}` as TKey) }))}
                  onChange={(v) => {
                    if (v) set({ repeat: v })
                  }}
                />
                )}
                <SelectRow
                  icon={ri(Bell)}
                  label={t('calendar.remind')}
                  value={draft.remindMin == null ? 'off' : String(draft.remindMin)}
                  options={reminderOptions(draft.allDay, draft.remindMin, t)}
                  onChange={(v) => {
                    if (!v) return
                    set({ remindMin: v === 'off' ? null : Number(v) })
                    if (v !== 'off') void ensureReminderPermission()
                  }}
                />
              </FormSection>
            </View>

            {/* who */}
            {external ? null : (
              <View>
                <Txt style={[styles.label, { color: c.textMuted }]}>{t('calendar.ownerLabel')}</Txt>
                <WhoPicker owner={draft.owner} profiles={profiles} memberEmails={memberEmails} onChange={(owner) => set({ owner })} />
              </View>
            )}

            <FormSection>
              <InputRow
                icon={ri(MapPin)}
                value={draft.location}
                onChangeText={(v) => set({ location: v })}
                placeholder={t('calendar.locationPlaceholder')}
              />
              <InputRow
                icon={ri(StickyNote)}
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

          {/* save — docked, in the Calendar's red, following the screen curve */}
          <View style={{ paddingHorizontal: sp.lg, paddingTop: sp.sm, paddingBottom: clearOfBars ? sp.md : bottomGap }}>
            <TintButton
              tint={tint}
              colors={red}
              title={editing ? t('common.saveChanges') : t('calendar.saveEvent')}
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
    alignItems: 'flex-start',
    gap: sp.md,
    paddingHorizontal: sp.lg,
    paddingBottom: sp.md,
  },
  tile: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  kicker: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase' },
  label: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase', marginBottom: sp.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 36, borderRadius: 18 },
  close: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
