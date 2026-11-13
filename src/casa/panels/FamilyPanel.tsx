// Família on the home device: everyone in the household (scales to 12+ in a
// grid), and each member's profile — the same member_profiles data the
// phone's Family app shows (photo, birthday & age, phone, sizes, allergies,
// notes) plus their day: today's events that are theirs. Read-only here.
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, Users } from 'lucide-react'
import { useI18n } from '../../hooks/useI18n'
import type { TKey } from '../../lib/i18n'
import { KIND_EMOJI } from '../../lib/calendar'
import type { MemberProfile } from '../../lib/types'
import { agenda, type HubData, type Member } from '../data'
import { tick } from '../sound'
import { Avatar } from '../ui'
import { GRAD, LOCALE, dateOf, prefersReducedMotion } from '../util'
import { PanelHeader } from './Shell'

export const FAMILY_GRAD = ['#7C8CFF', '#5B5BD6'] as const

const FIELDS: [keyof MemberProfile, TKey][] = [
  ['phone', 'family.phone'],
  ['blood_type', 'family.bloodType'],
  ['height', 'family.height'],
  ['weight', 'family.weight'],
  ['shoe_size', 'family.shoeSize'],
  ['pants_size', 'family.pantsSize'],
  ['shirt_size', 'family.shirtSize'],
  ['allergies', 'family.allergies'],
  ['notes', 'family.notes'],
]
const WIDE = new Set<keyof MemberProfile>(['allergies', 'notes'])

export function ageOf(birthday: string | null | undefined, today: string): number | null {
  if (!birthday) return null
  const [by, bm, bd] = birthday.split('-').map(Number)
  const [ty, tm, td] = today.split('-').map(Number)
  let age = ty - by
  if (tm < bm || (tm === bm && td < bd)) age--
  return age >= 0 && age <= 130 ? age : null
}

/** Days until the next birthday (0 = today). */
function daysToBirthday(birthday: string, today: string): number {
  const [, bm, bd] = birthday.split('-').map(Number)
  const t = dateOf(today)
  let next = new Date(t.getFullYear(), bm - 1, bd)
  if (next < t) next = new Date(t.getFullYear() + 1, bm - 1, bd)
  return Math.round((next.getTime() - t.getTime()) / 86_400_000)
}

export default function FamilyPanel({
  data,
  today,
  me,
  initial,
  onClose,
}: {
  data: HubData
  today: string
  me: string
  /** Open straight on this member's profile. */
  initial?: string | null
  onClose: () => void
}) {
  const { t } = useI18n()
  const [sel, setSel] = useState<string | null>(initial ?? null)
  const member = data.members.find((m) => m.email === sel) ?? null
  return (
    <div className="flex h-full flex-col bg-(--bg)">
      <PanelHeader
        icon={Users}
        g={FAMILY_GRAD}
        title={member ? member.name : t('casa.family.title')}
        sub={member ? undefined : t('casa.family.count', { count: data.members.length })}
        onClose={onClose}
        closeLabel={t('casa.close')}
        right={
          member ? (
            <button
              onClick={() => {
                tick()
                setSel(null)
              }}
              className="casa-press inline-flex h-12 min-w-12 shrink-0 items-center justify-center gap-1 rounded-full bg-(--surface) px-3 sm:pr-5 text-[1.05rem] font-semibold"
            >
              <ChevronLeft size={22} aria-hidden />
              <span className="max-sm:sr-only">{t('casa.family.everyone')}</span>
            </button>
          ) : undefined
        }
      />
      {member ? (
        <Profile key={member.email} m={member} data={data} today={today} isMe={member.email === me} />
      ) : (
        <ul className="casa-scroll grid min-h-0 flex-1 content-start gap-3 px-4 pt-2 pb-10 [grid-template-columns:repeat(auto-fill,minmax(min(10.5rem,40vw),1fr))] sm:px-6">
          {data.members.map((m, i) => {
            const age = ageOf(m.profile?.birthday, today)
            const bday = m.profile?.birthday ? daysToBirthday(m.profile.birthday, today) : null
            return (
              <li key={m.email} className="casa-rise" style={{ ['--i' as string]: Math.min(i, 10) }}>
                <button
                  onClick={() => {
                    tick()
                    setSel(m.email)
                  }}
                  className="casa-card casa-press flex w-full flex-col items-center gap-3 rounded-[26px] px-3 pt-6 pb-5"
                >
                  <Avatar m={m} size={84} />
                  <span className="min-w-0 max-w-full text-center">
                    <span className="font-display block truncate text-[1.35rem] leading-tight">{m.first}</span>
                    <span className="mt-1 block truncate text-[0.95rem] text-(--text-muted)">
                      {bday === 0 ? `🎂 ${t('casa.family.bdayToday')}` : age != null ? t('family.yrs', { years: age }) : m.email === me ? t('family.you') : ' '}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
          {!data.members.length ? <li className="text-(--text-faint)">{t('casa.noMembers')}</li> : null}
        </ul>
      )}
    </div>
  )
}

/** The profile photo: 150 at the base, smaller on a short or narrow screen. */
function portraitSize(): number {
  return Math.round(Math.max(88, Math.min(150, window.innerHeight * 0.22, window.innerWidth * 0.36)))
}

function Profile({ m, data, today, isMe }: { m: Member; data: HubData; today: string; isMe: boolean }) {
  const { t, lang } = useI18n()
  const loc = LOCALE[lang]
  const el = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    el.current?.animate(
      [
        { opacity: 0, transform: prefersReducedMotion() ? 'none' : 'translateX(28px)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 280, easing: 'cubic-bezier(0.2, 0.85, 0.15, 1)', fill: 'both' },
    )
  }, [])
  const p = m.profile
  const age = ageOf(p?.birthday, today)
  const bdayIn = p?.birthday ? daysToBirthday(p.birthday, today) : null
  const mine = useMemo(
    () => (agenda(data.events, today, 1).get(today) ?? []).filter((o) => o.event.owner_email === m.email),
    [data.events, today, m.email],
  )
  const fields = FIELDS.filter(([k]) => p?.[k])

  return (
    <div ref={el} className="casa-scroll min-h-0 flex-1 px-4 pb-10 sm:px-6">
      <div className="grid gap-5 landscape:grid-cols-[minmax(260px,0.8fr)_1.2fr]">
        <section className="casa-card flex flex-col items-center self-start rounded-[30px] px-5 pt-[clamp(16px,4dvh,2rem)] pb-7 text-center">
          <Avatar m={m} size={portraitSize()} />
          <p className="font-display mt-5 text-[2rem] leading-tight">{m.name}</p>
          {isMe ? <p className="mt-1 text-[0.95rem] text-(--text-faint)">{t('casa.family.thisDevice')}</p> : null}
          {p?.birthday ? (
            <div className="mt-5 w-full rounded-[22px] bg-(--surface) px-5 py-4 text-left">
              <p className="text-[0.85rem] font-semibold uppercase tracking-[0.14em] text-(--text-faint)">{t('family.birthday')}</p>
              <p className="mt-1 text-[1.2rem] font-semibold">
                🎂 {dateOf(p.birthday).toLocaleDateString(loc, { day: 'numeric', month: 'long' })}
                {age != null ? <span className="font-normal text-(--text-muted)"> · {t('family.yrs', { years: age })}</span> : null}
              </p>
              {bdayIn != null ? (
                <p className="mt-0.5 text-[0.95rem] text-(--text-muted)">
                  {bdayIn === 0 ? t('casa.family.bdayToday') : t('casa.family.bdayIn', { count: bdayIn })}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>

        <div className="flex min-w-0 flex-col gap-5">
          <section className="casa-card rounded-[30px] p-4 sm:p-6">
            <h3 className="mb-3 flex items-center gap-2 text-[0.95rem] font-semibold uppercase tracking-[0.14em] text-(--text-faint)">
              <CalendarDays size={18} aria-hidden />
              {t('casa.family.today')}
            </h3>
            {mine.length ? (
              <ul className="space-y-2">
                {mine.map((o) => (
                  <li key={o.event.id} className="flex items-center gap-4 rounded-[18px] bg-(--surface) px-4 py-3">
                    <span className="w-16 shrink-0 text-[1.05rem] font-semibold tabular-nums" style={{ color: GRAD.calendar[1] }}>
                      {o.event.all_day ? t('casa.cal.allDayShort') : o.event.start_time?.slice(0, 5)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[1.1rem]">
                      {KIND_EMOJI[o.event.kind] ? `${KIND_EMOJI[o.event.kind]} ` : ''}
                      {o.event.title}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[1.05rem] text-(--text-muted)">{t('casa.family.freeToday', { name: m.first })}</p>
            )}
          </section>

          <section className="casa-card rounded-[30px] p-4 sm:p-6">
            {fields.length ? (
              <dl className="grid grid-cols-[repeat(auto-fill,minmax(min(9rem,100%),1fr))] gap-3">
                {fields.map(([k, label]) => (
                  <div key={k} className={`rounded-[18px] bg-(--surface) px-4 py-3 ${WIDE.has(k) ? 'col-span-full' : ''}`}>
                    <dt className="text-[0.82rem] font-semibold uppercase tracking-[0.12em] text-(--text-faint)">{t(label)}</dt>
                    <dd className={`mt-0.5 text-[1.15rem] ${WIDE.has(k) ? 'whitespace-pre-line' : 'truncate'} ${k === 'allergies' ? 'font-semibold text-(--expense)' : ''}`}>
                      {String(p?.[k] ?? '')}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-[1.05rem] text-(--text-muted)">{t('casa.family.emptyProfile', { name: m.first })}</p>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
