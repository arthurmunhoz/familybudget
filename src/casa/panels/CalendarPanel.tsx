// Calendário on the home device: today as a big agenda, the next days beside
// it, and a simple "new event" (title, day, optional time, whose).
import { useMemo, useState } from 'react'
import { CalendarDays, Plus } from 'lucide-react'
import { useI18n } from '../../hooks/useI18n'
import { addDays, eventColor, KIND_EMOJI, type Occurrence } from '../../lib/calendar'
import { agenda, insertEvent, type HubData } from '../data'
import { chime } from '../sound'
import { Avatar, PlusTag } from '../ui'
import { GRAD, LOCALE, cap, dateOf, grad } from '../util'
import { PanelHeader } from './Shell'

export default function CalendarPanel({
  data,
  today,
  full,
  refresh,
  onClose,
}: {
  data: HubData
  today: string
  full: boolean
  refresh: () => void
  onClose: () => void
}) {
  const { t, lang } = useI18n()
  const loc = LOCALE[lang]
  const days = useMemo(() => agenda(data.events, today, 8), [data.events, today])
  const emails = data.members.map((m) => m.email)
  const [adding, setAdding] = useState(false)
  const todayList = days.get(today) ?? []
  const later = Array.from({ length: 7 }, (_, i) => addDays(today, i + 1))

  return (
    <div className="flex h-full flex-col bg-(--bg)">
      <PanelHeader
        icon={CalendarDays}
        g={GRAD.calendar}
        title={t('casa.cal.title')}
        sub={cap(dateOf(today).toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'long' }))}
        onClose={onClose}
        closeLabel={t('casa.close')}
        right={
          full ? (
            <button
              onClick={() => setAdding((a) => !a)}
              aria-label={t('casa.cal.new')}
              className="casa-press inline-flex h-12 min-w-12 shrink-0 items-center justify-center gap-2 rounded-full px-3 text-[0.98rem] font-semibold text-white sm:px-7"
              style={{ background: grad(GRAD.calendar), boxShadow: '0 12px 26px -14px #FF2E63' }}
            >
              <Plus size={24} strokeWidth={2.6} aria-hidden />
              <span className="max-sm:sr-only">{t('casa.cal.new')}</span>
            </button>
          ) : (
            <PlusTag label="Plus" />
          )
        }
      />
      {/* The form scrolls with the agenda, so a short screen never loses it. */}
      <div className="casa-scroll min-h-0 flex-1 px-4 pb-10 sm:px-6">
      {adding ? (
        <NewEvent
          data={data}
          today={today}
          onDone={(saved) => {
            setAdding(false)
            if (saved) refresh()
          }}
        />
      ) : null}
      <div className="grid gap-[clamp(20px,4dvh,2rem)] landscape:grid-cols-[1.15fr_1fr]">
        <section>
          <h3 className="mb-4 text-[0.95rem] font-semibold uppercase tracking-[0.16em] text-(--text-faint)">{t('casa.when.todayCap')}</h3>
          {todayList.length === 0 ? (
            <div className="casa-card casa-fade rounded-[28px] p-8 text-center">
              <p className="text-[2.2rem]" aria-hidden>
                ☕
              </p>
              <p className="font-display mt-2 text-[1.4rem]">{t('casa.cal.freeDay')}</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {todayList.map((o, i) => (
                <EventRow key={o.event.id + o.start} o={o} big color={eventColor(o.event, emails)} i={i} data={data} />
              ))}
            </ul>
          )}
        </section>
        <section>
          <h3 className="mb-4 text-[0.95rem] font-semibold uppercase tracking-[0.16em] text-(--text-faint)">{t('casa.cal.nextDays')}</h3>
          <div className="space-y-5">
            {later.map((d, di) => {
              const list = days.get(d) ?? []
              return (
                <div key={d} className="casa-rise" style={{ ['--i' as string]: di }}>
                  <p className="mb-2 text-[0.95rem] font-semibold first-letter:uppercase">
                    {d === addDays(today, 1) ? t('casa.when.tomorrowCap') : dateOf(d).toLocaleDateString(loc, { weekday: 'long', day: 'numeric' })}
                  </p>
                  {list.length === 0 ? (
                    <p className="text-[1rem] text-(--text-faint)">—</p>
                  ) : (
                    <ul className="space-y-2">
                      {list.map((o, i) => (
                        <EventRow key={o.event.id + o.start} o={o} color={eventColor(o.event, emails)} i={i} data={data} />
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      </div>
      </div>
    </div>
  )
}

function EventRow({ o, color, big = false, i, data }: { o: Occurrence; color: string; big?: boolean; i: number; data: HubData }) {
  const { t } = useI18n()
  const owner = data.members.find((m) => m.email === o.event.owner_email)
  const emoji = KIND_EMOJI[o.event.kind]
  return (
    <li className="casa-rise" style={{ ['--i' as string]: i }}>
      <div className={`casa-card flex items-center gap-3 rounded-[22px] sm:gap-4 ${big ? 'px-4 py-3 sm:px-6' : 'px-4 py-3 sm:px-5'}`}>
        <span className="h-12 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
        <span className={`w-[4.4rem] shrink-0 sm:w-[5.2rem] font-semibold tabular-nums ${big ? 'text-[1.2rem]' : 'text-[0.95rem]'}`}>
          {o.event.all_day ? <span className="text-[0.95rem] text-(--text-muted)">{t('casa.cal.allDay')}</span> : o.event.start_time?.slice(0, 5)}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate font-medium ${big ? 'text-[1.25rem]' : 'text-[1rem]'}`}>
            {emoji ? `${emoji} ` : ''}
            {o.event.title}
          </span>
          {o.event.location ? <span className="block truncate text-[0.95rem] text-(--text-muted)">{o.event.location}</span> : null}
        </span>
        {owner ? <Avatar m={owner} size={big ? 44 : 34} /> : null}
      </div>
    </li>
  )
}

function NewEvent({ data, today, onDone }: { data: HubData; today: string; onDone: (saved: boolean) => void }) {
  const { t, lang } = useI18n()
  const loc = LOCALE[lang]
  const [title, setTitle] = useState('')
  const [day, setDay] = useState(today)
  const [time, setTime] = useState('')
  const [owner, setOwner] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const choices = Array.from({ length: 7 }, (_, i) => addDays(today, i))

  async function save() {
    if (!title.trim() || busy) return
    setBusy(true)
    try {
      await insertEvent({ title, date: day, time, owner })
      chime('done')
      onDone(true)
    } catch {
      setBusy(false)
    }
  }

  return (
    <div className="casa-rise casa-card mb-6 rounded-[30px] p-4 sm:p-6">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t('casa.cal.whatPlaceholder')}
        className="h-[clamp(3.25rem,9dvh,4rem)] w-full rounded-[20px] border border-(--surface-2) bg-(--bg) px-5 text-[1.1rem] outline-none focus:border-[#FF2E63]"
        style={{ fontSize: 'clamp(1.15rem, 3.5dvh, 1.4rem)' }}
      />
      <div className="casa-scroll mt-4 flex gap-2.5 overflow-x-auto">
        {choices.map((d, i) => {
          const on = d === day
          return (
            <button
              key={d}
              onClick={() => setDay(d)}
              className="casa-press h-11 shrink-0 rounded-full px-5 text-[0.92rem] font-semibold first-letter:uppercase"
              style={on ? { background: grad(GRAD.calendar), color: '#fff' } : { background: 'var(--surface)' }}
            >
              {i === 0 ? t('casa.when.todayCap') : i === 1 ? t('casa.when.tomorrowCap') : dateOf(d).toLocaleDateString(loc, { weekday: 'short', day: 'numeric' })}
            </button>
          )
        })}
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          aria-label={t('casa.cal.time')}
          className="h-14 shrink-0 rounded-full border border-(--surface-2) bg-(--bg) px-5 text-[0.92rem]"
        />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="text-[1rem] font-semibold text-(--text-muted)">{t('casa.who.title')}</span>
        <button
          onClick={() => setOwner(null)}
          className="casa-press h-11 rounded-full px-5 text-[0.92rem] font-semibold"
          style={owner === null ? { background: grad(GRAD.frame), color: '#fff' } : { background: 'var(--surface)' }}
        >
          {t('casa.who.everyone')}
        </button>
        {data.members.map((m) => (
          <button
            key={m.email}
            onClick={() => setOwner(m.email)}
            className="casa-press inline-flex h-11 items-center gap-2 rounded-full pr-5 pl-1.5 text-[0.92rem] font-semibold"
            style={owner === m.email ? { background: `${m.color}33`, boxShadow: `inset 0 0 0 2px ${m.color}` } : { background: 'var(--surface)' }}
          >
            <Avatar m={m} size={44} />
            {m.first}
          </button>
        ))}
        <span className="flex-1" />
        <button onClick={() => onDone(false)} className="casa-press h-11 rounded-full px-6 text-[0.95rem] font-semibold text-(--text-muted)">
          {t('common.cancel')}
        </button>
        <button
          onClick={() => void save()}
          disabled={!title.trim() || busy}
          className="casa-press h-11 rounded-full px-6 text-[0.95rem] font-semibold text-white disabled:opacity-50"
          style={{ background: grad(GRAD.calendar) }}
        >
          {t('common.save')}
        </button>
      </div>
    </div>
  )
}
