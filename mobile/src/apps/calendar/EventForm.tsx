// Add/edit a calendar event — a bottom-sheet modal. Mirrors the PWA's event
// sheet: title, type/kind, all-day toggle, start/end date, start/end time when
// timed, owner (member or whole household), recurrence, reminder toggle,
// location, notes. Inserts/updates calendar_events (household_id/created_by are
// stamped by column defaults under RLS). Google-sourced rows are read-only and
// never reach this form.
import { useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, Switch, View } from 'react-native'
import { X } from 'lucide-react-native'

import { Btn, Field, Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'
import { HOUSEHOLD_COLOR, KIND_EMOJI, memberColor } from '@/lib/calendar'
import { track } from '@/lib/analytics'
import { supabase } from '@/lib/supabase'
import type { CalendarEvent, EventKind, EventRecurrence, Profile } from '@/lib/types'
import { radius, sp, useTheme } from '@/theme/theme'
import { DateField } from '@/apps/pets/petUi'
import { OwnerChip, Pill, TimeField } from './calendarUi'

const RECURRENCES: EventRecurrence[] = ['none', 'daily', 'weekly', 'monthly', 'yearly']
const KINDS: EventKind[] = ['event', 'birthday', 'anniversary', 'renewal', 'other']

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

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
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
            <Txt variant="h2">{editing ? t('calendar.editEvent') : t('calendar.newEvent')}</Txt>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel={t('common.close')}>
              <X size={22} color={c.textMuted} />
            </Pressable>
          </View>

          <ScrollView
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: sp.md, gap: sp.md }}
            keyboardShouldPersistTaps="handled"
          >
            <Field
              value={draft.title}
              onChangeText={(v) => set({ title: v })}
              placeholder={t('calendar.titlePlaceholder')}
              autoFocus={!editing}
            />

            {/* kind / type */}
            <View style={{ gap: 6 }}>
              <Txt variant="label">{t('calendar.typeLabel')}</Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                {KINDS.map((k) => {
                  const active = draft.kind === k
                  return (
                    <Pill
                      key={k}
                      active={active}
                      onPress={() => {
                        // Special dated kinds behave like the old Important Dates:
                        // all-day, household-wide; birthdays/anniversaries repeat yearly.
                        if (k === 'event') {
                          set({ kind: k })
                        } else {
                          set({
                            kind: k,
                            allDay: true,
                            owner: null,
                            repeat:
                              k === 'birthday' || k === 'anniversary' ? 'yearly' : draft.repeat,
                          })
                        }
                      }}
                    >
                      <Txt style={{ color: active ? '#fff' : c.textMuted, fontWeight: '600' }}>
                        {KIND_EMOJI[k] ? `${KIND_EMOJI[k]} ` : ''}
                        {t(`calendar.kind.${k}` as TKey)}
                      </Txt>
                    </Pill>
                  )
                })}
              </View>
            </View>

            {/* all-day toggle */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: c.surface,
                borderRadius: radius.md,
                paddingHorizontal: sp.md,
                paddingVertical: 10,
              }}
            >
              <Txt>{t('calendar.allDay')}</Txt>
              <Switch
                value={draft.allDay}
                onValueChange={(v) => set({ allDay: v })}
                trackColor={{ true: c.accent }}
              />
            </View>

            {/* start / end date */}
            <View style={{ flexDirection: 'row', gap: sp.md }}>
              <DateField
                label={t('calendar.startLabel')}
                value={draft.start}
                placeholder={t('calendar.startLabel')}
                onChange={(v) => set({ start: v, end: draft.end < v ? v : draft.end })}
              />
              <DateField
                label={t('calendar.endLabel')}
                value={draft.end}
                placeholder={t('calendar.endLabel')}
                onChange={(v) => set({ end: v })}
              />
            </View>

            {/* start / end time (timed only) */}
            {!draft.allDay && (
              <View style={{ flexDirection: 'row', gap: sp.md }}>
                <TimeField
                  label={t('calendar.fromLabel')}
                  value={draft.startTime}
                  locale={locale}
                  onChange={(v) => set({ startTime: v })}
                />
                <TimeField
                  label={t('calendar.toLabel')}
                  value={draft.endTime}
                  locale={locale}
                  onChange={(v) => set({ endTime: v })}
                />
              </View>
            )}

            {/* owner */}
            <View style={{ gap: 6 }}>
              <Txt variant="label">{t('calendar.ownerLabel')}</Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                <OwnerChip
                  label={t('calendar.everyone')}
                  color={HOUSEHOLD_COLOR}
                  active={draft.owner === null}
                  onPress={() => set({ owner: null })}
                />
                {profiles.map((p) => (
                  <OwnerChip
                    key={p.email}
                    label={p.display_name}
                    color={memberColor(p.email, memberEmails)}
                    active={draft.owner === p.email}
                    onPress={() => set({ owner: p.email })}
                  />
                ))}
              </View>
            </View>

            {/* recurrence */}
            <View style={{ gap: 6 }}>
              <Txt variant="label">{t('calendar.repeatLabel')}</Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                {RECURRENCES.map((r) => {
                  const active = draft.repeat === r
                  return (
                    <Pill key={r} active={active} onPress={() => set({ repeat: r })}>
                      <Txt style={{ color: active ? '#fff' : c.textMuted, fontWeight: '600' }}>
                        {t(`calendar.repeat.${r}` as TKey)}
                      </Txt>
                    </Pill>
                  )
                })}
              </View>
            </View>

            {/* reminder */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: c.surface,
                borderRadius: radius.md,
                paddingHorizontal: sp.md,
                paddingVertical: 10,
              }}
            >
              <Txt>🔔 {t('calendar.remind')}</Txt>
              <Switch
                value={draft.remind}
                onValueChange={(v) => set({ remind: v })}
                trackColor={{ true: c.accent }}
              />
            </View>

            <Field
              value={draft.location}
              onChangeText={(v) => set({ location: v })}
              placeholder={t('calendar.locationPlaceholder')}
            />
            <Field
              value={draft.notes}
              onChangeText={(v) => set({ notes: v })}
              placeholder={t('calendar.notesPlaceholder')}
            />
          </ScrollView>

          <View style={{ paddingHorizontal: sp.lg, paddingTop: sp.md, paddingBottom: sp.xl, gap: sp.md }}>
            <Btn
              title={editing ? t('common.saveChanges') : t('calendar.saveEvent')}
              onPress={save}
              disabled={!canSave}
              loading={saving}
            />
            {editing ? (
              <Pressable
                onPress={() => {
                  const ev = editing
                  onClose()
                  onDelete(ev)
                }}
                style={{ paddingVertical: 12, alignItems: 'center' }}
              >
                <Txt style={{ color: c.expense, fontWeight: '600' }}>
                  {t('calendar.deleteEvent')}
                </Txt>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  )
}
