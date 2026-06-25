import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarHeart, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useBack } from '../../hooks/useBack'
import { useI18n } from '../../hooks/useI18n'
import { useScrollLock } from '../../hooks/useScrollLock'
import { formatDay, todayISO } from '../../lib/format'
import { daysUntil, nextOccurrence } from '../../lib/importantDates'
import type { TKey } from '../../lib/i18n'
import { supabase } from '../../lib/supabase'
import type { ImportantDate, ImportantDateType } from '../../lib/types'

const TYPE_ICON: Record<ImportantDateType, string> = {
  birthday: '🎂',
  anniversary: '💍',
  renewal: '📋',
  other: '📌',
}
const TYPES = Object.keys(TYPE_ICON) as ImportantDateType[]

// App language → BCP-47 locale for Intl relative-time ("8 months ago" etc.).
const LOCALES: Record<string, string> = { en: 'en', es: 'es', pt: 'pt-BR' }

export default function ImportantDates() {
  const back = useBack()
  const { t, lang } = useI18n()
  const today = todayISO()
  const [dates, setDates] = useState<ImportantDate[]>([])
  const [loading, setLoading] = useState(true)

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<ImportantDate | null>(null)
  const [fTitle, setFTitle] = useState('')
  const [fType, setFType] = useState<ImportantDateType>('birthday')
  const [fDate, setFDate] = useState(today)
  const [fRepeats, setFRepeats] = useState(true)
  const [fNotes, setFNotes] = useState('')
  const [saving, setSaving] = useState(false)
  useScrollLock(showForm)

  // Tapping an event on the calendar scrolls to its row and briefly rings it.
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const highlightTimer = useRef<number | undefined>(undefined)
  function scrollToDate(d: ImportantDate) {
    itemRefs.current[d.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    window.clearTimeout(highlightTimer.current)
    setHighlightId(null) // re-trigger the animation even if the same row is re-picked
    requestAnimationFrame(() => {
      setHighlightId(d.id)
      highlightTimer.current = window.setTimeout(() => setHighlightId(null), 1700)
    })
  }

  const load = useCallback(async () => {
    const { data } = await supabase.from('important_dates').select('*')
    setDates(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Upcoming first (soonest at top); past one-time dates sink to the bottom,
  // most-recent first — kept for reference, not nagging at the top.
  const sorted = useMemo(
    () =>
      [...dates].sort((a, b) => {
        const da = daysUntil(a, today)
        const db = daysUntil(b, today)
        const aPast = da < 0
        const bPast = db < 0
        if (aPast !== bPast) return aPast ? 1 : -1
        return aPast ? db - da : da - db
      }),
    [dates, today],
  )

  function relLabel(d: ImportantDate): { text: string; tone: 'soon' | 'far' | 'past' } {
    const days = daysUntil(d, today)
    if (days < 0) {
      // Past one-time date: "28 days ago" / "8 months ago", localized for free.
      const ago = -days
      const rtf = new Intl.RelativeTimeFormat(LOCALES[lang] ?? 'en', { numeric: 'auto' })
      const text =
        ago < 45
          ? rtf.format(-ago, 'day')
          : ago < 365
            ? rtf.format(-Math.round(ago / 30), 'month')
            : rtf.format(-Math.round(ago / 365), 'year')
      return { text, tone: 'past' }
    }
    if (days === 0) return { text: t('dates.today'), tone: 'soon' }
    if (days === 1) return { text: t('dates.tomorrow'), tone: 'soon' }
    if (days <= 45) return { text: t('dates.inDays', { days }), tone: days <= 14 ? 'soon' : 'far' }
    return { text: t('dates.inMonths', { months: Math.round(days / 30) }), tone: 'far' }
  }

  function openNew() {
    setEditing(null)
    setFTitle('')
    setFType('birthday')
    setFDate(today)
    setFRepeats(true)
    setFNotes('')
    setShowForm(true)
  }

  function openEdit(d: ImportantDate) {
    setEditing(d)
    setFTitle(d.title)
    setFType(d.type)
    setFDate(d.event_date)
    setFRepeats(d.repeats_annually)
    setFNotes(d.notes ?? '')
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditing(null)
  }

  async function save() {
    if (!fTitle.trim() || saving) return
    setSaving(true)
    const fields = {
      title: fTitle.trim(),
      type: fType,
      event_date: fDate,
      repeats_annually: fRepeats,
      notes: fNotes.trim() || null,
    }
    const { error } = editing
      ? await supabase.from('important_dates').update(fields).eq('id', editing.id)
      : await supabase.from('important_dates').insert(fields)
    setSaving(false)
    if (error) {
      alert(t('dates.saveFailed'))
      return
    }
    closeForm()
    load()
  }

  async function remove(d: ImportantDate) {
    if (!confirm(t('dates.deleteConfirm', { title: d.title }))) return
    setDates((list) => list.filter((x) => x.id !== d.id))
    closeForm()
    await supabase.from('important_dates').delete().eq('id', d.id)
  }

  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-32">
      <header className="sticky top-0 z-10 -mx-4 -mt-[env(safe-area-inset-top)] flex items-center gap-2 bg-(--bg) px-4 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-4">
        <button
          onClick={() => back('/')}
          className="rounded-lg px-2 py-1 text-xl text-(--text-muted) active:text-(--text)"
        >
          ‹
        </button>
        <h1 className="flex flex-1 items-center gap-2 font-display text-2xl font-bold text-(--text)">
          <CalendarHeart size={24} strokeWidth={2} className="text-(--accent)" aria-hidden="true" />
          {t('dates.title')}
        </h1>
      </header>

      {loading ? (
        <p className="mt-12 text-center text-(--text-faint) animate-pulse">
          {t('common.loading')}
        </p>
      ) : (
        <>
          <MonthCalendar dates={dates} today={today} lang={lang} onPick={scrollToDate} />
          {sorted.length === 0 ? (
            <div className="mt-6 text-center text-(--text-muted)">
              <p>{t('dates.empty')}</p>
              <p className="text-sm text-(--text-faint)">{t('dates.emptyHint')}</p>
            </div>
          ) : (
            <ul className="space-y-2">
          {sorted.map((d) => {
            const rel = relLabel(d)
            const sub = `${t(`dates.type.${d.type}` as TKey)} · ${formatDay(nextOccurrence(d, today))}`
            return (
              <li key={d.id}>
                <button
                  ref={(el) => {
                    itemRefs.current[d.id] = el
                  }}
                  onClick={() => openEdit(d)}
                  className={`flex w-full items-center gap-3 rounded-xl bg-(--card) px-4 py-3 text-left active:bg-(--card-active) transition-colors ${
                    highlightId === d.id ? 'animate-highlight' : ''
                  }`}
                >
                  <span className="text-xl">{TYPE_ICON[d.type]}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-(--text)">{d.title}</p>
                    <p className="truncate text-xs text-(--text-faint)">{sub}</p>
                    {d.notes && (
                      <p className="truncate text-xs text-(--text-muted)">{d.notes}</p>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
                      rel.tone === 'soon'
                        ? 'bg-(--accent) text-white'
                        : rel.tone === 'past'
                          ? 'bg-(--surface) text-(--text-faint)'
                          : 'bg-(--surface) text-(--text-muted)'
                    }`}
                  >
                    {rel.text}
                  </span>
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
          {t('dates.addBtn')}
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
                {editing ? t('dates.editDate') : t('dates.newDate')}
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
              placeholder={t('dates.titlePlaceholder')}
              autoFocus={!editing}
              className="w-full rounded-xl bg-(--surface) px-4 py-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
            />

            <label className="mt-3 block text-xs font-semibold text-(--text-faint)">
              {t('dates.typeLabel')}
            </label>
            <div className="mt-1 flex flex-wrap gap-2">
              {TYPES.map((ty) => (
                <button
                  key={ty}
                  onClick={() => {
                    setFType(ty)
                    if (ty === 'birthday' || ty === 'anniversary') setFRepeats(true)
                  }}
                  className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                    fType === ty
                      ? 'bg-(--accent) text-white'
                      : 'bg-(--surface) text-(--text-muted)'
                  }`}
                >
                  {TYPE_ICON[ty]} {t(`dates.type.${ty}` as TKey)}
                </button>
              ))}
            </div>

            <label className="mt-3 block text-xs font-semibold text-(--text-faint)">
              {t('dates.dateLabel')}
              <input
                type="date"
                value={fDate}
                onChange={(e) => setFDate(e.target.value)}
                className="mt-1 h-12 w-full min-w-0 rounded-xl bg-(--surface) px-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
              />
            </label>

            <label className="mt-3 flex items-center justify-between rounded-xl bg-(--surface) px-4 py-3">
              <span className="text-(--text)">↻ {t('dates.repeats')}</span>
              <input
                type="checkbox"
                checked={fRepeats}
                onChange={(e) => setFRepeats(e.target.checked)}
                className="h-5 w-5 accent-(--accent)"
              />
            </label>

            <input
              value={fNotes}
              onChange={(e) => setFNotes(e.target.value)}
              placeholder={t('dates.notesPlaceholder')}
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
                {saving ? t('common.saving') : editing ? t('common.saveChanges') : t('dates.saveDate')}
              </button>

              {editing && (
                <button
                  onClick={() => remove(editing)}
                  disabled={saving}
                  className="mt-3 w-full rounded-2xl py-3 font-semibold text-(--expense) active:bg-rose-400/10"
                >
                  {t('dates.deleteDate')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** Month overview: event days get a clay dot; today is a filled clay circle so
 *  it reads distinctly from the event marks. Annual dates (birthdays etc.) mark
 *  every year; one-time dates mark only their own month. Browsable month-to-month. */
function MonthCalendar({
  dates,
  today,
  lang,
  onPick,
}: {
  dates: ImportantDate[]
  today: string
  lang: string
  onPick: (d: ImportantDate) => void
}) {
  const [ty, tm] = today.split('-').map(Number)
  const [view, setView] = useState({ y: ty, m: tm }) // m is 1-indexed
  const locale = LOCALES[lang] ?? 'en'

  // Day-of-month → the events on that day in the shown month.
  const eventsByDay = useMemo(() => {
    const map = new Map<number, ImportantDate[]>()
    for (const d of dates) {
      const [y, m, day] = d.event_date.split('-').map(Number)
      if (d.repeats_annually ? m === view.m : y === view.y && m === view.m) {
        const arr = map.get(day) ?? []
        arr.push(d)
        map.set(day, arr)
      }
    }
    return map
  }, [dates, view])

  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: 'narrow' })
    // 2023-01-01 is a Sunday → label columns Sun…Sat.
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2023, 0, 1 + i)))
  }, [locale])

  const firstDow = new Date(view.y, view.m - 1, 1).getDay()
  const daysInMonth = new Date(view.y, view.m, 0).getDate()
  const monthLabel = new Date(view.y, view.m - 1, 1).toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
  })
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
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

  return (
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
          const evs = eventsByDay.get(day)
          // Judge each cell by ITS OWN date vs today: clay if today or still to
          // come, muted grey once it's past — so a recurring birthday only shows
          // clay for its upcoming instances, grey for ones that already happened.
          const dateStr = `${view.y}-${String(view.m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const isPast = dateStr < today
          const isToday = dateStr === today
          const inner = (
            <>
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm ${
                  evs
                    ? isPast
                      ? 'bg-(--surface-2) font-semibold text-(--text-muted)'
                      : 'bg-(--accent) font-semibold text-white'
                    : 'text-(--text)'
                }`}
              >
                {day}
              </span>
              <span
                className={`mt-0.5 h-1.5 w-1.5 rounded-full ${
                  isToday ? 'bg-[#e0a23c]' : 'bg-transparent'
                }`}
              />
            </>
          )
          return evs ? (
            <button
              key={day}
              onClick={() => onPick(evs[0])}
              aria-label={evs.map((e) => e.title).join(', ')}
              className="flex flex-col items-center py-0.5 active:scale-95 transition-transform"
            >
              {inner}
            </button>
          ) : (
            <div key={day} className="flex flex-col items-center py-0.5">
              {inner}
            </div>
          )
        })}
      </div>
    </div>
  )
}
