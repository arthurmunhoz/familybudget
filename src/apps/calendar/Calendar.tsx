import { useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, MapPin, X } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useBack } from '../../hooks/useBack'
import { useCachedQuery } from '../../hooks/useCachedQuery'
import { useI18n } from '../../hooks/useI18n'
import { useScrollLock } from '../../hooks/useScrollLock'
import { todayISO } from '../../lib/format'
import {
  compareOccurrences,
  eventColor,
  formatTime,
  HOUSEHOLD_COLOR,
  memberColor,
  occurrencesByDay,
  type Occurrence,
} from '../../lib/calendar'
import type { TKey } from '../../lib/i18n'
import { supabase } from '../../lib/supabase'
import type { CalendarEvent, EventRecurrence } from '../../lib/types'

// App language → BCP-47 locale for Intl date/time formatting.
const LOCALES: Record<string, string> = { en: 'en', es: 'es', pt: 'pt-BR' }
const RECURRENCES: EventRecurrence[] = ['none', 'daily', 'weekly', 'monthly', 'yearly']

const pad = (n: number) => String(n).padStart(2, '0')

export default function Calendar() {
  const back = useBack()
  const { t, lang } = useI18n()
  const { profile, profiles } = useAuth()
  const locale = LOCALES[lang] ?? 'en'
  const today = todayISO()
  const memberEmails = useMemo(() => profiles.map((p) => p.email), [profiles])
  const ownerName = (email: string) =>
    profiles.find((p) => p.email === email)?.display_name ?? email

  const {
    data: events = [],
    loading,
    revalidate,
  } = useCachedQuery<CalendarEvent[]>('calendar:events', async () => {
    const { data } = await supabase.from('calendar_events').select('*')
    return (data ?? []) as CalendarEvent[]
  })

  const [selected, setSelected] = useState(today)
  const [view, setView] = useState(() => {
    const [y, m] = today.split('-').map(Number)
    return { y, m } // m is 1-indexed
  })

  // Occurrences for the visible month (recurrence expanded + multi-day spread).
  const monthStart = `${view.y}-${pad(view.m)}-01`
  const monthEnd = `${view.y}-${pad(view.m)}-${pad(new Date(view.y, view.m, 0).getDate())}`
  const byDay = useMemo(
    () => occurrencesByDay(events, monthStart, monthEnd),
    [events, monthStart, monthEnd],
  )

  // The selected day's agenda (computed independently so it works even if the
  // selected day sits outside the month currently in view).
  const dayOccs: Occurrence[] = useMemo(() => {
    const m = occurrencesByDay(events, selected, selected)
    return (m.get(selected) ?? []).sort(compareOccurrences)
  }, [events, selected])

  // --- add / edit form ---
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<CalendarEvent | null>(null)
  const [fTitle, setFTitle] = useState('')
  const [fAllDay, setFAllDay] = useState(true)
  const [fStart, setFStart] = useState(today)
  const [fEnd, setFEnd] = useState(today)
  const [fStartTime, setFStartTime] = useState('09:00')
  const [fEndTime, setFEndTime] = useState('10:00')
  const [fOwner, setFOwner] = useState<string | null>(null)
  const [fRepeat, setFRepeat] = useState<EventRecurrence>('none')
  const [fRemind, setFRemind] = useState(false)
  const [fLocation, setFLocation] = useState('')
  const [fNotes, setFNotes] = useState('')
  const [saving, setSaving] = useState(false)
  useScrollLock(showForm)

  function openNew() {
    setEditing(null)
    setFTitle('')
    setFAllDay(true)
    setFStart(selected)
    setFEnd(selected)
    setFStartTime('09:00')
    setFEndTime('10:00')
    setFOwner(profile?.email ?? null)
    setFRepeat('none')
    setFRemind(false)
    setFLocation('')
    setFNotes('')
    setShowForm(true)
  }

  function openEdit(ev: CalendarEvent) {
    setEditing(ev)
    setFTitle(ev.title)
    setFAllDay(ev.all_day)
    setFStart(ev.start_date)
    setFEnd(ev.end_date)
    setFStartTime(ev.start_time?.slice(0, 5) ?? '09:00')
    setFEndTime(ev.end_time?.slice(0, 5) ?? '10:00')
    setFOwner(ev.owner_email)
    setFRepeat(ev.recurrence)
    setFRemind(ev.reminder_minutes != null)
    setFLocation(ev.location ?? '')
    setFNotes(ev.notes ?? '')
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditing(null)
  }

  async function save() {
    if (!fTitle.trim() || saving) return
    setSaving(true)
    const end = fEnd < fStart ? fStart : fEnd
    const fields = {
      title: fTitle.trim(),
      start_date: fStart,
      end_date: end,
      all_day: fAllDay,
      start_time: fAllDay ? null : fStartTime,
      end_time: fAllDay ? null : fEndTime,
      owner_email: fOwner,
      recurrence: fRepeat,
      reminder_minutes: fRemind ? 0 : null,
      location: fLocation.trim() || null,
      notes: fNotes.trim() || null,
    }
    const { error } = editing
      ? await supabase.from('calendar_events').update(fields).eq('id', editing.id)
      : await supabase.from('calendar_events').insert(fields)
    setSaving(false)
    if (error) {
      alert(t('calendar.saveFailed'))
      return
    }
    setSelected(fStart)
    closeForm()
    revalidate()
  }

  async function remove(ev: CalendarEvent) {
    if (!confirm(t('calendar.deleteConfirm', { title: ev.title }))) return
    closeForm()
    await supabase.from('calendar_events').delete().eq('id', ev.id)
    revalidate()
  }

  // --- month grid scaffolding ---
  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: 'narrow' })
    // 2023-01-01 is a Sunday → label columns Sun…Sat.
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2023, 0, 1 + i)))
  }, [locale])
  const firstDow = new Date(view.y, view.m - 1, 1).getDay()
  const dim = new Date(view.y, view.m, 0).getDate()
  const monthLabel = new Date(view.y, view.m - 1, 1).toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
  })
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: dim }, (_, i) => i + 1),
  ]

  function shift(delta: number) {
    setView((v) => {
      let m = v.m + delta
      let y = v.y
      if (m < 1) {
        m = 12
        y--
      } else if (m > 12) {
        m = 1
        y++
      }
      return { y, m }
    })
  }

  function goToday() {
    const [y, m] = today.split('-').map(Number)
    setView({ y, m })
    setSelected(today)
  }

  const selectedLabel = (() => {
    const [y, m, d] = selected.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString(locale, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    })
  })()

  function timeLabel(ev: CalendarEvent): string {
    if (ev.all_day) return t('calendar.allDay')
    const start = ev.start_time ? formatTime(ev.start_time, locale) : ''
    const end = ev.end_time ? ` – ${formatTime(ev.end_time, locale)}` : ''
    return `${start}${end}`
  }

  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-32">
      <header className="sticky top-0 z-10 -mx-4 -mt-[env(safe-area-inset-top)] flex items-center gap-2 bg-(--bg) px-4 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-4 mb-2">
        <button
          onClick={() => back('/')}
          className="rounded-lg px-2 py-1 text-xl text-(--text-muted) active:text-(--text)"
        >
          ‹
        </button>
        <h1 className="flex flex-1 items-center gap-2 font-display text-2xl font-bold text-(--text)">
          <CalendarDays size={24} strokeWidth={2} className="text-(--accent)" aria-hidden="true" />
          {t('calendar.title')}
        </h1>
        <button
          onClick={goToday}
          className="rounded-full bg-(--surface) px-3 py-1.5 text-xs font-semibold text-(--text-muted) active:text-(--text)"
        >
          {t('calendar.today')}
        </button>
      </header>

      {loading && events.length === 0 ? (
        <p className="mt-12 text-center text-(--text-faint) animate-pulse">{t('common.loading')}</p>
      ) : (
        <>
          {/* month grid */}
          <div className="mb-4 rounded-2xl bg-(--card) p-3">
            <div className="flex items-center justify-between px-1 pb-2">
              <button
                onClick={() => shift(-1)}
                aria-label="Previous month"
                className="rounded-lg p-1.5 text-(--text-muted) active:text-(--text)"
              >
                <ChevronLeft size={20} strokeWidth={2} aria-hidden="true" />
              </button>
              <span className="font-display text-base font-semibold capitalize text-(--text)">
                {monthLabel}
              </span>
              <button
                onClick={() => shift(1)}
                aria-label="Next month"
                className="rounded-lg p-1.5 text-(--text-muted) active:text-(--text)"
              >
                <ChevronRight size={20} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1">
              {weekdays.map((w, i) => (
                <div
                  key={i}
                  className="pb-1 text-center text-[11px] font-semibold text-(--text-faint)"
                >
                  {w}
                </div>
              ))}
              {cells.map((day, i) => {
                if (day === null) return <div key={`b${i}`} />
                const dateStr = `${view.y}-${pad(view.m)}-${pad(day)}`
                const occs = byDay.get(dateStr)
                const isToday = dateStr === today
                const isSelected = dateStr === selected
                return (
                  <button
                    key={day}
                    onClick={() => setSelected(dateStr)}
                    aria-label={dateStr}
                    className="flex flex-col items-center py-0.5 active:scale-95 transition-transform"
                  >
                    <span
                      className={`flex h-8 w-8 items-center justify-center rounded-full text-sm ${
                        isSelected
                          ? 'bg-(--accent) font-semibold text-white'
                          : isToday
                            ? 'font-bold text-(--accent) ring-1 ring-(--accent)'
                            : 'text-(--text)'
                      }`}
                    >
                      {day}
                    </span>
                    <span className="mt-0.5 flex h-1.5 items-center gap-0.5">
                      {occs?.slice(0, 3).map((o, j) => (
                        <span
                          key={j}
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ background: eventColor(o.event, memberEmails) }}
                        />
                      ))}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* selected-day agenda */}
          <h2 className="px-1 pb-2 font-display text-base font-semibold capitalize text-(--text)">
            {selectedLabel}
          </h2>
          {dayOccs.length === 0 ? (
            <div className="mt-2 text-center text-(--text-muted)">
              <p>{t('calendar.empty')}</p>
              <p className="text-sm text-(--text-faint)">{t('calendar.emptyHint')}</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {dayOccs.map((o) => {
                const color = eventColor(o.event, memberEmails)
                const sub = [
                  timeLabel(o.event),
                  o.event.owner_email ? ownerName(o.event.owner_email) : t('calendar.everyone'),
                ]
                  .filter(Boolean)
                  .join(' · ')
                return (
                  <li key={`${o.event.id}:${o.start}`}>
                    <button
                      onClick={() => openEdit(o.event)}
                      className="flex w-full items-stretch gap-3 rounded-xl bg-(--card) px-3 py-3 text-left active:bg-(--card-active) transition-colors"
                    >
                      <span
                        className="w-1.5 shrink-0 rounded-full"
                        style={{ background: color }}
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-(--text)">{o.event.title}</p>
                        <p className="truncate text-xs text-(--text-faint)">{sub}</p>
                        {o.event.location && (
                          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-(--text-muted)">
                            <MapPin size={12} strokeWidth={2} aria-hidden="true" />
                            {o.event.location}
                          </p>
                        )}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}

      {/* add button */}
      <div
        className="fixed inset-x-0 bottom-0 mx-auto max-w-md px-4 pt-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
      >
        <button
          onClick={openNew}
          className="w-full rounded-2xl border border-white/30 bg-(--accent) py-4 font-bold text-white shadow-lg active:scale-[0.98] transition-transform"
        >
          {t('calendar.addBtn')}
        </button>
      </div>

      {/* add / edit sheet */}
      {showForm && (
        <div className="fixed inset-0 z-20 flex items-end bg-black/50" onClick={closeForm}>
          <div
            className="mx-auto flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-(--card)"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between px-4 pt-5 pb-3">
              <h2 className="text-lg font-bold text-(--text)">
                {editing ? t('calendar.editEvent') : t('calendar.newEvent')}
              </h2>
              <button
                onClick={closeForm}
                aria-label={t('common.close')}
                className="px-2 py-1 text-(--text-muted) active:text-(--text)"
              >
                <X size={20} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 pb-2">
              <input
                value={fTitle}
                onChange={(e) => setFTitle(e.target.value)}
                placeholder={t('calendar.titlePlaceholder')}
                autoFocus={!editing}
                className="w-full rounded-xl bg-(--surface) px-4 py-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
              />

              <label className="mt-3 flex items-center justify-between rounded-xl bg-(--surface) px-4 py-3">
                <span className="text-(--text)">{t('calendar.allDay')}</span>
                <input
                  type="checkbox"
                  checked={fAllDay}
                  onChange={(e) => setFAllDay(e.target.checked)}
                  className="h-5 w-5 accent-(--accent)"
                />
              </label>

              <div className="mt-3 flex gap-2">
                <label className="flex-1 text-xs font-semibold text-(--text-faint)">
                  {t('calendar.startLabel')}
                  <input
                    type="date"
                    value={fStart}
                    onChange={(e) => {
                      setFStart(e.target.value)
                      if (fEnd < e.target.value) setFEnd(e.target.value)
                    }}
                    className="mt-1 h-12 w-full min-w-0 rounded-xl bg-(--surface) px-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
                  />
                </label>
                <label className="flex-1 text-xs font-semibold text-(--text-faint)">
                  {t('calendar.endLabel')}
                  <input
                    type="date"
                    value={fEnd}
                    min={fStart}
                    onChange={(e) => setFEnd(e.target.value)}
                    className="mt-1 h-12 w-full min-w-0 rounded-xl bg-(--surface) px-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
                  />
                </label>
              </div>

              {!fAllDay && (
                <div className="mt-3 flex gap-2">
                  <label className="flex-1 text-xs font-semibold text-(--text-faint)">
                    {t('calendar.fromLabel')}
                    <input
                      type="time"
                      value={fStartTime}
                      onChange={(e) => setFStartTime(e.target.value)}
                      className="mt-1 h-12 w-full min-w-0 rounded-xl bg-(--surface) px-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
                    />
                  </label>
                  <label className="flex-1 text-xs font-semibold text-(--text-faint)">
                    {t('calendar.toLabel')}
                    <input
                      type="time"
                      value={fEndTime}
                      onChange={(e) => setFEndTime(e.target.value)}
                      className="mt-1 h-12 w-full min-w-0 rounded-xl bg-(--surface) px-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
                    />
                  </label>
                </div>
              )}

              <label className="mt-3 block text-xs font-semibold text-(--text-faint)">
                {t('calendar.ownerLabel')}
              </label>
              <div className="mt-1 flex flex-wrap gap-2">
                <OwnerChip
                  label={t('calendar.everyone')}
                  color={HOUSEHOLD_COLOR}
                  active={fOwner === null}
                  onClick={() => setFOwner(null)}
                />
                {profiles.map((p) => (
                  <OwnerChip
                    key={p.email}
                    label={p.display_name}
                    color={memberColor(p.email, memberEmails)}
                    active={fOwner === p.email}
                    onClick={() => setFOwner(p.email)}
                  />
                ))}
              </div>

              <label className="mt-3 block text-xs font-semibold text-(--text-faint)">
                {t('calendar.repeatLabel')}
              </label>
              <div className="mt-1 flex flex-wrap gap-2">
                {RECURRENCES.map((r) => (
                  <button
                    key={r}
                    onClick={() => setFRepeat(r)}
                    className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                      fRepeat === r
                        ? 'bg-(--accent) text-white'
                        : 'bg-(--surface) text-(--text-muted)'
                    }`}
                  >
                    {t(`calendar.repeat.${r}` as TKey)}
                  </button>
                ))}
              </div>

              <label className="mt-3 flex items-center justify-between rounded-xl bg-(--surface) px-4 py-3">
                <span className="text-(--text)">🔔 {t('calendar.remind')}</span>
                <input
                  type="checkbox"
                  checked={fRemind}
                  onChange={(e) => setFRemind(e.target.checked)}
                  className="h-5 w-5 accent-(--accent)"
                />
              </label>

              <input
                value={fLocation}
                onChange={(e) => setFLocation(e.target.value)}
                placeholder={t('calendar.locationPlaceholder')}
                className="mt-3 w-full rounded-xl bg-(--surface) px-4 py-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
              />

              <input
                value={fNotes}
                onChange={(e) => setFNotes(e.target.value)}
                placeholder={t('calendar.notesPlaceholder')}
                className="mt-3 w-full rounded-xl bg-(--surface) px-4 py-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
              />
            </div>

            <div
              className="shrink-0 px-4 pt-3"
              style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
            >
              <button
                onClick={save}
                disabled={!fTitle.trim() || saving}
                className="w-full rounded-2xl bg-(--accent) py-4 font-bold text-white active:scale-[0.98] transition-transform disabled:opacity-50"
              >
                {saving
                  ? t('common.saving')
                  : editing
                    ? t('common.saveChanges')
                    : t('calendar.saveEvent')}
              </button>

              {editing && (
                <button
                  onClick={() => remove(editing)}
                  disabled={saving}
                  className="mt-3 w-full rounded-2xl py-3 font-semibold text-(--expense) active:bg-rose-400/10"
                >
                  {t('calendar.deleteEvent')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function OwnerChip({
  label,
  color,
  active,
  onClick,
}: {
  label: string
  color: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
        active ? 'bg-(--accent) text-white' : 'bg-(--surface) text-(--text-muted)'
      }`}
    >
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} aria-hidden="true" />
      {label}
    </button>
  )
}
