import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarHeart, X } from 'lucide-react'
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
      ) : sorted.length === 0 ? (
        <div className="mt-16 text-center text-(--text-muted)">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-(--surface)">
            <CalendarHeart size={40} className="text-(--text-faint)" aria-hidden="true" />
          </div>
          <p className="mt-4">{t('dates.empty')}</p>
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
                  onClick={() => openEdit(d)}
                  className="flex w-full items-center gap-3 rounded-xl bg-(--card) px-4 py-3 text-left active:bg-(--card-active) transition-colors"
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
