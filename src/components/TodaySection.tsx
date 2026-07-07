// The Hub's "Today" section — sits between the greeting and the app grid. Shows
// the date + current weather (from the home city set in the Drawer, via
// lib/weather), then a compact agenda: today's calendar events (birthdays and
// anniversaries highlighted with their marker + "turns N"/"N years") and any
// pet-care items due today or overdue. Tapping a row opens the relevant app.
// RN port source: mobile/src/components/TodaySection.tsx.
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Pill, Scissors, Stethoscope, Syringe, FileText, type LucideIcon } from 'lucide-react'
import { useCachedQuery } from '../hooks/useCachedQuery'
import { useI18n } from '../hooks/useI18n'
import { supabase } from '../lib/supabase'
import { todayISO } from '../lib/format'
import {
  KIND_EMOJI,
  compareOccurrences,
  formatTime,
  occurrencesByDay,
  yearsAt,
} from '../lib/calendar'
import { overdueEvents } from '../lib/petCare'
import type { CalendarEvent, PetEvent, PetEventType } from '../lib/types'
import { useHomeWeather, weatherIcon } from '../lib/weather'

const LOCALE: Record<string, string> = { en: 'en-US', es: 'es', pt: 'pt-BR' }
const MAX_ROWS = 5

const TYPE_ICON: Record<PetEventType, LucideIcon> = {
  vet: Stethoscope,
  vaccine: Syringe,
  medication: Pill,
  grooming: Scissors,
  other: FileText,
}

type PetLite = { id: string; name: string; emoji: string }

export default function TodaySection({ onSetCity }: { onSetCity: () => void }) {
  const navigate = useNavigate()
  const { t, lang } = useI18n()
  const locale = LOCALE[lang] ?? 'en-US'
  const today = todayISO()

  const unit = lang === 'en' ? 'fahrenheit' : 'celsius'
  const { location, weather } = useHomeWeather(unit)

  type TodayData = { events: CalendarEvent[]; petEvents: PetEvent[]; pets: PetLite[] }
  const { data = { events: [], petEvents: [], pets: [] } } = useCachedQuery<TodayData>(
    'hub:today',
    async () => {
      const [ev, pe, pt] = await Promise.all([
        supabase.from('calendar_events').select('*'),
        supabase.from('pet_events').select('*').order('event_date', { ascending: false }),
        supabase.from('pets').select('id, name, emoji'),
      ])
      return {
        events: (ev.data ?? []) as CalendarEvent[],
        petEvents: (pe.data ?? []) as PetEvent[],
        pets: (pt.data ?? []) as PetLite[],
      }
    },
  )

  const petById = useMemo(
    () => Object.fromEntries(data.pets.map((p) => [p.id, p])) as Record<string, PetLite>,
    [data.pets],
  )
  const todaysOcc = useMemo(
    () => [...(occurrencesByDay(data.events, today, today).get(today) ?? [])].sort(compareOccurrences),
    [data.events, today],
  )
  const petDue = useMemo(() => overdueEvents(data.petEvents, today), [data.petEvents, today])

  const dateLabel = useMemo(() => {
    const [y, m, d] = today.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString(locale, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    })
  }, [today, locale])

  const WIcon = weather ? weatherIcon(weather.code) : null
  // "Westchase, Florida, US" → "Westchase" for the compact city line.
  const cityShort = location?.city.split(',')[0].trim() ?? ''
  const totalItems = todaysOcc.length + petDue.length
  // Fill the agenda from calendar first, then pet-care, up to MAX_ROWS.
  const shownOcc = todaysOcc.slice(0, MAX_ROWS)
  const shownPet = petDue.slice(0, Math.max(0, MAX_ROWS - shownOcc.length))
  const overflow = totalItems - (shownOcc.length + shownPet.length)

  return (
    <div className="mb-5 rounded-2xl bg-(--card) p-4">
      {/* date + weather */}
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-(--text-muted)">{t('home.today')}</div>
          <div className="truncate font-display text-lg text-(--text)">{dateLabel}</div>
        </div>
        <button
          onClick={onSetCity}
          className="flex flex-col items-end gap-0.5"
        >
          {weather && WIcon ? (
            <>
              <span className="flex items-center gap-1.5">
                <WIcon size={22} strokeWidth={2} aria-hidden="true" className="text-(--accent)" />
                <span className="font-semibold text-(--text)">
                  {weather.temperature}
                  {weather.unit}
                </span>
              </span>
              {cityShort && (
                <span className="truncate text-xs text-(--text-faint)">
                  {t('home.inCity', { city: cityShort })}
                </span>
              )}
            </>
          ) : (
            <span className="text-sm font-semibold text-(--accent)">
              {location ? '—' : t('home.setCity')}
            </span>
          )}
        </button>
      </div>

      {/* agenda */}
      {totalItems === 0 ? (
        <p className="mt-3 text-sm text-(--text-faint)">{t('home.nothingToday')}</p>
      ) : (
        <div className="mt-3 space-y-2 border-t border-(--surface-2) pt-3">
          {shownOcc.map((o) => {
            const ev = o.event
            const emoji = KIND_EMOJI[ev.kind]
            const time = ev.all_day ? null : ev.start_time ? formatTime(ev.start_time, locale) : null
            const years = ev.kind === 'birthday' || ev.kind === 'anniversary' ? yearsAt(ev, o.start) : 0
            const suffix =
              ev.kind === 'birthday' && years > 0
                ? t('home.turns', { n: years })
                : ev.kind === 'anniversary' && years > 0
                  ? t('home.years', { n: years })
                  : null
            return (
              <button
                key={`${ev.id}:${o.start}`}
                onClick={() => navigate('/calendar')}
                className="flex w-full items-center gap-2 text-left"
              >
                <span
                  className="w-5.5 shrink-0 text-center text-(--accent)"
                  style={{ fontSize: emoji ? 15 : 8 }}
                >
                  {emoji || '●'}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-(--text)">
                  {ev.title}
                  {suffix && <span className="text-(--text-muted)"> · {suffix}</span>}
                </span>
                {time && <span className="shrink-0 text-xs text-(--text-faint)">{time}</span>}
              </button>
            )
          })}

          {shownPet.map((e) => {
            const Icon = TYPE_ICON[e.type]
            const pet = petById[e.pet_id]
            const isOverdue = (e.next_due ?? '') < today
            return (
              <button
                key={e.id}
                onClick={() => navigate('/pets')}
                className="flex w-full items-center gap-2 text-left"
              >
                <span className="flex w-5.5 shrink-0 justify-center text-(--text-muted)">
                  <Icon size={16} strokeWidth={2} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-(--text)">
                  {pet?.emoji ? `${pet.emoji} ` : ''}
                  {e.title}
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    isOverdue ? 'bg-(--expense) text-white' : 'bg-(--surface) text-(--text-muted)'
                  }`}
                >
                  {isOverdue ? t('home.overdue') : t('home.dueToday')}
                </span>
              </button>
            )
          })}

          {overflow > 0 && (
            <button
              onClick={() => navigate('/calendar')}
              className="text-sm font-semibold text-(--accent)"
            >
              {t('home.moreItems', { n: overflow })}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
