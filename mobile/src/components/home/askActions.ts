// The ask sheet's newer actions (2026-11), each turned into one generic answer
// (ActionView): a headline, optional rows, and Undo / a choice / Open …. The
// data work lives in lib/assistantActions.ts (and lib/assistant.ts); this file
// only decides what to do and how to say it. AskSheet calls actMore() for any
// intent it doesn't handle itself, and the recurring-event choices from there.
import type { ActionRowData } from './AnswerViews'
import {
  endSeries,
  findMember,
  locateEvent,
  isExternal,
  moveSeries,
  removeSeries,
  restoreEvent,
  restoreItems,
  unremoveEvent,
  agendaFor,
  petsDue,
  type Intent,
  type MoneyRange,
} from '@/lib/assistant'
import {
  clearChecked,
  compareDeals,
  deletePetEvent,
  deletePetWeight,
  deleteEntryRow,
  editEvent,
  findDocuments,
  lastEntry,
  lastNudgeSeen,
  logPetEvent,
  logPetWeight,
  moveItemsTo,
  periodEntries,
  petNextDue,
  petTasksDone,
  recheck,
  reinsertEntry,
  restoreEntry,
  restoreStores,
  setFamilyField,
  uncheckSaid,
  undoPetTasksDone,
  unseenNudges,
  updateEntry,
  upcomingBirthdays,
  weatherFor,
  whereIs,
  type WeatherKind,
} from '@/lib/assistantActions'
import { categoryById } from '@/lib/categories'
import { formatMoney, periodLabel } from '@/lib/format'
import { formatTime, KIND_EMOJI } from '@/lib/calendar'
import type { TKey } from '@/lib/i18n'
import type { CalendarEvent, EventRecurrence, PetEventType, Profile } from '@/lib/types'

export interface ActionAnswer {
  kind: 'action'
  headline: string
  sub?: string
  rows: ActionRowData[]
  /** One line for the conversation history (and Claude's context). */
  summary: string
  undo?: { run: () => Promise<void>; headline: string }
  /** [main, second]: buttons that carry on (e.g. "Remove the whole series"). */
  choices?: { label: string; run: () => Promise<ActionAnswer> }[]
  open?: { label: string; path: string }
  undone: boolean
}

type T = (key: TKey, vars?: Record<string, string | number>) => string

export interface ActEnv {
  t: T
  lang: string
  locale: string
  today: string
  me: Profile | null
  profiles: Profile[]
  dayWords: (iso: string) => string
  whenLabel: (ev: CalendarEvent) => string
  invalidate: (key: string) => void
  reportGap: (intent: string, reason: string) => void
}

const say = (headline: string, extra: Partial<ActionAnswer> = {}): ActionAnswer => ({
  kind: 'action',
  headline,
  rows: [],
  summary: headline,
  undone: false,
  ...extra,
})

const first = (p: Profile | null | undefined) => p?.display_name.split(' ')[0] ?? ''

const PET_EMOJI: Record<PetEventType, string> = { vet: '🩺', vaccine: '💉', medication: '💊', grooming: '✂️', other: '🐾' }
const WEATHER_EMOJI: Record<WeatherKind, string> = { clear: '☀️', cloudy: '⛅', fog: '🌫️', drizzle: '🌦️', rain: '🌧️', snow: '❄️', storm: '⛈️' }

export function recurrenceLabel(t: T, r: EventRecurrence): string {
  return r === 'none' ? '' : t(`ask.repeat.${r}` as TKey)
}

export function reminderLabel(t: T, minutes: number | null): string {
  if (minutes == null) return ''
  if (minutes === 0) return t('ask.remindAtTime')
  if (minutes % 1440 === 0) return t('ask.remindDays', { n: minutes / 1440 })
  if (minutes % 60 === 0) return t('ask.remindHours', { n: minutes / 60 })
  return t('ask.remindMinutes', { n: minutes })
}

/** "hoje" / "em 5 nov" / "nesta semana" / "na semana de 3 nov" / "em outubro de 2026". */
function rangeLabel(r: MoneyRange, today: string, locale: string, t: ActEnv['t']): string {
  if (r.span === 'day') return r.from === today ? t('ask.when.today') : t('ask.when.day', { day: shortDay(r.from, locale) })
  if (r.span === 'week') return r.from <= today && today <= r.to ? t('ask.when.thisWeek') : t('ask.when.week', { day: shortDay(r.from, locale) })
  const month = new Date(r.from + 'T12:00:00').toLocaleDateString(locale, { month: 'long', year: 'numeric' })
  return t('ask.when.month', { month })
}

const shortDay = (iso: string, locale: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })
}

/** The answer for "remove/move a recurring event": confirm what to do with
 *  the series, since one occurrence can't be changed on its own. */
export function recurringChoice(
  env: ActEnv,
  mode: 'remove' | 'move',
  ev: CalendarEvent,
  occStart: string,
  move?: { to: string; time: string },
): ActionAnswer {
  const { t } = env
  const label = recurrenceLabel(t, ev.recurrence)
  const row: ActionRowData = { emoji: KIND_EMOJI[ev.kind] ?? '🗓️', title: ev.title, sub: [label, shortDay(occStart, env.locale)].filter(Boolean).join(' · ') }
  if (mode === 'move' && move) {
    return say(t('ask.seriesMoveAsk', { title: ev.title }), {
      rows: [row],
      choices: [
        {
          label: t('ask.seriesMove'),
          run: async () => {
            const r = await moveSeries(ev, occStart, move.to, move.time)
            if (!r.ok) return say(t('ask.error'))
            env.invalidate('hub:today')
            return say(t('ask.seriesMoved', { title: ev.title }), {
              rows: [{ emoji: '🗓️', title: r.ev.title, sub: [label, env.whenLabel(r.ev)].filter(Boolean).join(' · ') }],
              summary: t('ask.sumSeriesMoved', { title: ev.title, when: env.whenLabel(r.ev) }),
              undo: { run: () => restoreEvent(r.before), headline: t('ask.moveUndone') },
              open: { label: t('ask.openCalendar'), path: `/calendar?date=${move.to}` },
            })
          },
        },
      ],
      open: { label: t('ask.openCalendar'), path: `/calendar?date=${occStart}` },
    })
  }
  const choices: ActionAnswer['choices'] = [
    {
      label: t('ask.seriesRemoveAll'),
      run: async () => {
        if (!(await removeSeries(ev))) return say(t('ask.error'))
        env.invalidate('hub:today')
        return say(t('ask.seriesRemoved', { title: ev.title }), {
          summary: t('ask.sumSeriesRemoved', { title: ev.title }),
          undo: { run: () => unremoveEvent(ev), headline: t('ask.removeUndone') },
        })
      },
    },
  ]
  if (occStart > ev.start_date) {
    choices.push({
      label: t('ask.seriesStopFrom', { day: shortDay(occStart, env.locale) }),
      run: async () => {
        if (!(await endSeries(ev, occStart))) return say(t('ask.error'))
        env.invalidate('hub:today')
        return say(t('ask.seriesStopped', { title: ev.title, day: env.dayWords(occStart) }), {
          summary: t('ask.sumSeriesStopped', { title: ev.title, day: shortDay(occStart, env.locale) }),
          undo: { run: () => restoreEvent(ev), headline: t('ask.removeUndone') },
        })
      },
    })
  }
  return say(t('ask.seriesRemoveAsk', { title: ev.title }), { rows: [row], choices })
}

/** Carry out one of the newer intents; null when it isn't one of them. */
export async function actMore(intent: Intent, env: ActEnv): Promise<ActionAnswer | null> {
  const { t, today, me, profiles, locale } = env
  const myEmail = me?.email ?? ''
  switch (intent.intent) {
    // ── calendar ──────────────────────────────────────────────────────────────
    case 'edit_event': {
      const r = await locateEvent(intent.title, intent.date, today, 92, intent.ref)
      if (!r.ok) {
        env.reportGap('edit_event', r.reason)
        return say(
          r.reason === 'ambiguous'
            ? t('ask.removeWhich', { names: r.options.slice(0, 4).map((o) => `${o.event.title} (${shortDay(o.start, locale)})`).join(', ') })
            : t('ask.eventNotFound', { title: intent.title }),
        )
      }
      const before = r.occ.event
      if (isExternal(before)) return say(t('ask.editExternal', { title: before.title }))
      const ev = await editEvent(before, { newTitle: intent.newTitle, location: intent.location, notes: intent.notes, reminder: intent.reminder })
      if (!ev) return say(t('ask.error'))
      env.invalidate('hub:today')
      const changes = [
        intent.newTitle ? t('ask.editRenamed', { title: ev.title }) : '',
        intent.location ? `📍 ${ev.location}` : '',
        intent.notes ? `📝 ${intent.notes}` : '',
        intent.reminder === -2 ? t('ask.editNoReminder') : intent.reminder >= 0 ? `⏰ ${reminderLabel(t, intent.reminder)}` : '',
      ].filter(Boolean)
      return say(t('ask.eventEdited'), {
        rows: [{ emoji: KIND_EMOJI[ev.kind] ?? '🗓️', title: ev.title, sub: [shortDay(r.occ.start, locale), ...changes].join(' · ') }],
        summary: t('ask.sumEventEdited', { title: ev.title, changes: changes.join(', ') }),
        undo: { run: () => restoreEvent(before), headline: t('ask.moveUndone') },
        open: { label: t('ask.openCalendar'), path: `/calendar?date=${r.occ.start}` },
      })
    }
    case 'find_event': {
      const r = await locateEvent(intent.title, intent.date, today, 366, intent.ref)
      if (!r.ok && r.reason === 'not_found') return say(t('ask.findNone', { title: intent.title }))
      const occs = r.ok ? [r.occ] : r.options.slice(0, 4)
      const o = occs[0]
      const when = (s: string, ev: CalendarEvent) =>
        ev.start_time && !ev.all_day ? `${shortDay(s, locale)}, ${formatTime(ev.start_time.slice(0, 5), locale)}` : shortDay(s, locale)
      const owner = profiles.find((p) => p.email === o.event.owner_email)
      return say(r.ok ? t('ask.findNext', { title: o.event.title, when: env.dayWords(o.start) }) : t('ask.findSeveral'), {
        rows: occs.map((x) => ({
          emoji: KIND_EMOJI[x.event.kind] ?? '🗓️',
          title: x.event.title,
          sub: [when(x.start, x.event), x.event.location, first(profiles.find((p) => p.email === x.event.owner_email) ?? owner)].filter(Boolean).join(' · '),
        })),
        summary: occs.map((x) => `${x.event.title}: ${when(x.start, x.event)}`).join('; '),
        open: { label: t('ask.openCalendar'), path: `/calendar?date=${o.start}` },
      })
    }
    case 'birthdays': {
      const rows = await upcomingBirthdays(today, profiles)
      if (!rows.length) return say(t('ask.birthdaysNone'))
      return say(t('ask.birthdaysHead'), {
        rows: rows.map((b) => ({
          emoji: b.kind === 'anniversary' ? '💍' : '🎂',
          title: b.name,
          sub: [
            b.inDays === 0 ? t('ask.today') : b.inDays === 1 ? t('ask.tomorrow') : shortDay(b.date, locale),
            b.years > 0 ? t(b.kind === 'anniversary' ? 'ask.yearsTogether' : 'ask.turning', { n: b.years }) : '',
          ]
            .filter(Boolean)
            .join(' · '),
        })),
        summary: rows.map((b) => `${b.name} ${shortDay(b.date, locale)}`).join(', '),
        open: { label: t('ask.openCalendar'), path: '/calendar' },
      })
    }

    // ── money ─────────────────────────────────────────────────────────────────
    case 'money_summary':
    case 'list_money': {
      const category = intent.category ?? ''
      const thing = intent.title ?? ''
      // Whose money: "meus gastos" = the asker; a named member; else everyone.
      const owner = intent.person ? findMember(intent.person, profiles) : null
      const rows = await periodEntries(intent.budget, category, thing, today, intent.at, owner?.email, intent.range)
      // The span said ("hoje", "nesta semana", "em outubro"), when there was one.
      const when = intent.range ? rangeLabel(intent.range, today, locale, t) : ''
      const what = category ? categoryById(category, [], []).name : thing
      const byWho = (h: string) => (owner ? `${h.replace(/:$/, '')} · ${first(owner)}` : h)
      const catLabel = (id: string) => {
        const c = categoryById(id, [], [])
        return `${c.icon} ${c.name}`
      }
      if (intent.intent === 'list_money') {
        // "meus gastos" = expenses only; "receitas" = income only; else both.
        const ofKind = intent.kind ? rows.filter((r) => r.entry.type === intent.kind) : rows
        const latest = ofKind.slice(0, 15)
        if (!latest.length) return say(t('ask.moneyNoneYet'))
        const listHead = intent.kind === 'expense' ? t('ask.moneyLatestSpent') : intent.kind === 'income' ? t('ask.moneyLatestIncome') : t('ask.moneyLatest')
        const sum = ofKind.reduce((x, r) => x + Number(r.entry.amount), 0)
        const listTitle = what ? t('ask.moneyLatestOf', { what }) : listHead
        return say(byWho(when ? `${listTitle.replace(/:$/, '')} ${when}:` : listTitle), {
          sub: intent.kind ? t('ask.moneyListTotal', { amount: formatMoney(sum), n: ofKind.length }) : undefined,
          rows: latest.map((r) => ({
            emoji: r.entry.type === 'income' ? '💵' : categoryById(r.entry.category, [], []).icon,
            title: `${r.entry.type === 'income' ? '+' : '−'}${formatMoney(Number(r.entry.amount))} · ${r.entry.label}`,
            sub: [shortDay(r.entry.entry_date, locale), r.budget.name, first(profiles.find((p) => p.email === r.entry.person_email))].filter(Boolean).join(' · '),
          })),
          summary: latest.map((r) => `${r.entry.label} ${formatMoney(Number(r.entry.amount))}`).join(', '),
          open: latest.length ? { label: t('ask.openMoney'), path: `/budget/${latest[0].budget.id}/${latest[0].month.id}` } : undefined,
        })
      }
      // money_summary narrowed to a category / a thing / a person.
      const income = intent.kind === 'income'
      const spent = rows.filter((r) => r.entry.type === (income ? 'income' : 'expense') && r.entry.entry_date <= today)
      const total = spent.reduce((s, r) => s + Number(r.entry.amount), 0)
      const byBudget = new Map<string, { name: string; period: string; total: number; n: number }>()
      for (const r of spent) {
        const k = r.budget.id
        const cur = byBudget.get(k) ?? { name: r.budget.name, period: periodLabel(r.budget.period, r.month.start_date), total: 0, n: 0 }
        cur.total += Number(r.entry.amount)
        cur.n++
        byBudget.set(k, cur)
      }
      const head = byWho(
        when
          ? income
            ? t('ask.receivedRange', { amount: formatMoney(total), when })
            : category || thing
              ? t('ask.spentOnRange', { amount: formatMoney(total), what: category ? catLabel(category) : thing, when })
              : t('ask.spentRange', { amount: formatMoney(total), when })
          : income
            ? t('ask.receivedTotal', { amount: formatMoney(total) })
            : category || thing
              ? t('ask.spentOn', { amount: formatMoney(total), what: category ? catLabel(category) : thing })
              : t('ask.spentTotal', { amount: formatMoney(total) }),
      )
      return say(head, {
        sub: spent.length ? t('ask.entriesCount', { n: spent.length }) : t('ask.moneyNoneYet'),
        rows: [...byBudget.values()].map((b) => ({ emoji: '💰', title: `${formatMoney(b.total)} · ${b.name}`, sub: `${b.period} · ${t('ask.entriesCount', { n: b.n })}` })),
        // Which period, for the model's next turn ("and the month before?").
        summary: `${head} [${intent.range ? `${intent.range.from}..${intent.range.to}` : [...byBudget.values()].map((x) => x.period).join(', ') || (intent.at ? `period containing ${intent.at}` : 'current period')}]`,
        open: spent.length ? { label: t('ask.openMoney'), path: `/budget/${spent[0].budget.id}/${spent[0].month.id}` } : undefined,
      })
    }
    case 'fix_money':
    case 'remove_money': {
      const hit = await lastEntry(intent.title, myEmail, intent.ref)
      if (!hit) {
        env.reportGap(intent.intent, 'not_found')
        return say(intent.title ? t('ask.entryNotFound', { title: intent.title }) : t('ask.moneyNoneYet'))
      }
      const before = hit.entry
      const where = `${hit.budget.name} · ${shortDay(before.entry_date, locale)}`
      const open = { label: t('ask.openMoney'), path: `/budget/${hit.budget.id}/${hit.month.id}` }
      if (intent.intent === 'remove_money') {
        if (!(await deleteEntryRow(before))) return say(t('ask.error'))
        return say(t('ask.entryRemoved'), {
          rows: [{ emoji: categoryById(before.category, [], []).icon, title: `${formatMoney(Number(before.amount))} · ${before.label}`, sub: where }],
          summary: t('ask.sumEntryRemoved', { title: before.label, amount: formatMoney(Number(before.amount)) }),
          undo: { run: () => reinsertEntry(before), headline: t('ask.entryBack') },
          open,
        })
      }
      // A new total wins; otherwise add / take off what was said (a forgotten
      // tip as an amount or a percent of what was logged).
      const base = Number(before.amount)
      const total =
        intent.amount > 0
          ? intent.amount
          : intent.delta !== 0 || intent.tipPct > 0
            ? Math.round((base + intent.delta + (base * intent.tipPct) / 100) * 100) / 100
            : 0
      if ((intent.delta !== 0 || intent.tipPct > 0) && !(total > 0)) return say(t('ask.error'))
      const after = await updateEntry(before, total, intent.newTitle)
      if (!after) return say(t('ask.error'))
      return say(t('ask.entryFixed'), {
        rows: [
          {
            emoji: categoryById(after.category, [], []).icon,
            title: `${formatMoney(Number(after.amount))} · ${after.label}`,
            sub: `${t('ask.wasValue', { value: `${formatMoney(Number(before.amount))} · ${before.label}` })} · ${where}`,
          },
        ],
        summary: t('ask.sumEntryFixed', { title: after.label, amount: formatMoney(Number(after.amount)) }),
        undo: { run: () => restoreEntry(before), headline: t('ask.entryBack') },
        open,
      })
    }

    // ── pets ──────────────────────────────────────────────────────────────────
    case 'pet_done': {
      const r = await petTasksDone(intent.pet, intent.tasks, today)
      if (!r.done.length) return say(r.needPet ? t('ask.petWhich') : t('ask.petTaskNotFound', { items: intent.tasks.join(', ') }))
      return say(t('ask.petDoneHead'), {
        sub: r.missing.length ? t('ask.notFoundList', { items: r.missing.join(', ') }) : undefined,
        rows: r.done.map((d) => ({ emoji: '✅', title: d.task.title, sub: d.pet })),
        summary: t('ask.sumPetDone', { items: r.done.map((d) => `${d.task.title} (${d.pet})`).join(', ') }),
        undo: { run: () => undoPetTasksDone(r.done, today), headline: t('ask.petDoneUndone') },
        open: { label: t('ask.openPets'), path: '/pets' },
      })
    }
    case 'pet_log': {
      const r = await logPetEvent(intent.pet, intent.type, intent.title || t(`ask.petType.${intent.type}` as TKey), intent.date, intent.next, myEmail)
      if (!r.ok) return say(t('ask.petWhich'))
      const ev = r.ev
      return say(t('ask.petLogged', { pet: r.pet }), {
        rows: [
          {
            emoji: PET_EMOJI[ev.type] ?? '🐾',
            title: ev.title,
            sub: [shortDay(ev.event_date, locale), ev.next_due ? t('ask.nextDue', { day: shortDay(ev.next_due, locale) }) : ''].filter(Boolean).join(' · '),
          },
        ],
        summary: t('ask.sumPetLogged', { pet: r.pet, title: ev.title }),
        undo: { run: () => deletePetEvent(ev.id), headline: t('ask.petLogUndone') },
        open: { label: t('ask.openPets'), path: '/pets' },
      })
    }
    case 'pet_next': {
      const r = await petNextDue(intent.pet, intent.type)
      if (!r.rows.length) return say(r.pet ? t('ask.petNextNoneFor', { pet: r.pet }) : t('ask.petNextNone'))
      const o = r.rows[0]
      const late = o.due < today
      return say(
        late ? t('ask.petNextLate', { title: o.title, pet: o.pet, day: shortDay(o.due, locale) }) : t('ask.petNextHead', { title: o.title, pet: o.pet, day: env.dayWords(o.due) }),
        {
          rows: r.rows.slice(0, 6).map((x) => ({
            emoji: PET_EMOJI[x.type] ?? '🐾',
            title: `${x.title} · ${x.pet}`,
            sub: `${x.due < today ? t('ask.overdueSince', { day: shortDay(x.due, locale) }) : shortDay(x.due, locale)} · ${t('ask.lastOn', { day: shortDay(x.last, locale) })}`,
          })),
          summary: r.rows.slice(0, 6).map((x) => `${x.title} (${x.pet}) ${x.due}`).join(', '),
          open: { label: t('ask.openPets'), path: '/pets' },
        },
      )
    }
    case 'pet_weight': {
      const r = await logPetWeight(intent.pet, intent.weight, today)
      if (!r.ok) return say(t('ask.petWhich'))
      const diff = r.previous != null ? Math.round((intent.weight - r.previous) * 100) / 100 : null
      return say(t('ask.petWeighed', { pet: r.pet, weight: String(intent.weight) }), {
        sub: diff != null ? t('ask.weightWas', { prev: String(r.previous), diff: `${diff > 0 ? '+' : ''}${diff}` }) : undefined,
        rows: [],
        summary: t('ask.sumPetWeight', { pet: r.pet, weight: String(intent.weight) }),
        undo: { run: () => deletePetWeight(r.id), headline: t('ask.petLogUndone') },
        open: { label: t('ask.openPets'), path: '/pets' },
      })
    }

    // ── family ────────────────────────────────────────────────────────────────
    case 'family_update': {
      if (!intent.field) return say(t('ask.familyWhat'))
      const person = (intent.person && findMember(intent.person, profiles)) || me
      if (!person) return say(t('ask.whoNotFound', { name: intent.person }))
      let value = intent.value.trim()
      if (intent.field === 'birthday' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return say(t('ask.birthdayFormat'))
      if (intent.field === 'blood_type') value = value.toUpperCase().replace(/\s+/g, '')
      const r = await setFamilyField(person.email, intent.field, value)
      if (!r.ok) return say(t('ask.familyNoEdit', { name: first(person) }))
      const label = t(`family.${FAMILY_KEY[intent.field]}` as TKey)
      return say(t('ask.familyUpdated', { name: first(person) }), {
        rows: [{ emoji: '👤', title: `${label}: ${value}`, sub: r.previous ? t('ask.wasValue', { value: r.previous }) : undefined }],
        summary: t('ask.sumFamilyUpdated', { name: first(person), label, value }),
        undo: { run: async () => void (await setFamilyField(person.email, intent.field as never, r.previous)), headline: t('ask.familyUndone') },
        open: { label: t('ask.openFamily'), path: `/family?email=${encodeURIComponent(person.email)}` },
      })
    }
    case 'where_is': {
      const person = intent.person ? findMember(intent.person, profiles) : null
      const r = await whereIs(person, intent.place)
      if (!r.ok) {
        const name = first(r.person) || intent.person
        return say(
          r.reason === 'no_person'
            ? t('ask.whoNotFound', { name: intent.person })
            : r.reason === 'paused'
              ? t('ask.wherePaused', { name })
              : r.reason === 'not_sharing'
                ? t('ask.whereNotSharing', { name })
                : t('ask.whereNoFix', { name }),
          { open: { label: t('ask.openLocation'), path: '/location' } },
        )
      }
      const name = first(r.person)
      const where = r.place ?? r.address ?? t('ask.whereUnknownPlace')
      const ago = r.minutesAgo < 2 ? t('ask.justNow') : r.minutesAgo < 60 ? t('ask.minutesAgo', { n: r.minutesAgo }) : t('ask.hoursAgo', { n: Math.round(r.minutesAgo / 60) })
      const head =
        r.atAsked === true
          ? t('ask.whereYes', { name, place: where })
          : r.atAsked === false
            ? t('ask.whereNo', { name, place: where })
            : r.place
              ? t('ask.whereAt', { name, place: r.place })
              : t('ask.whereNear', { name, place: where })
      return say(head, {
        sub: [ago, r.battery != null ? `🔋 ${Math.round(r.battery)}%` : ''].filter(Boolean).join(' · '),
        summary: `${head} (${ago})`,
        open: { label: t('ask.openLocation'), path: '/location' },
      })
    }

    // ── nudges ────────────────────────────────────────────────────────────────
    case 'nudge_seen': {
      const r = await lastNudgeSeen(myEmail, profiles)
      if (!r) return say(t('ask.nudgeSeenNone'))
      const head = !r.notYet.length ? t('ask.nudgeSeenAll') : !r.seen.length ? t('ask.nudgeSeenNobody') : t('ask.nudgeSeenSome', { names: r.seen.join(', ') })
      return say(head, {
        rows: [
          { emoji: r.emoji, title: `“${r.message}”`, sub: r.notYet.length ? t('ask.nudgeNotYet', { names: r.notYet.join(', ') }) : undefined },
        ],
        summary: head,
        open: { label: t('ask.openNudges'), path: '/pings' },
      })
    }

    // ── shopping ──────────────────────────────────────────────────────────────
    case 'move_items': {
      const r = await moveItemsTo(intent.items, intent.store)
      if (!r.ok) return say(t('ask.storeNotFound', { store: r.store }))
      env.invalidate('hub:shopping')
      if (!r.moved.length) return say(r.missing.length ? t('ask.notFoundList', { items: r.missing.join(', ') }) : t('ask.alreadyThere', { store: r.store.name }))
      return say(t('ask.itemsMoved', { store: r.store.name }), {
        sub: r.missing.length ? t('ask.notFoundList', { items: r.missing.join(', ') }) : undefined,
        rows: r.moved.map((i) => ({ emoji: '🛒', title: i.label })),
        summary: t('ask.sumItemsMoved', { items: r.moved.map((i) => i.label).join(', '), store: r.store.name }),
        undo: { run: () => restoreStores(r.moved), headline: t('ask.itemsMovedBack') },
        open: { label: t('ask.openList'), path: '/shopping' },
      })
    }
    case 'clear_checked': {
      const r = await clearChecked(intent.store)
      if (r.unknownStore) return say(t('ask.storeNotFound', { store: intent.store }))
      env.invalidate('hub:shopping')
      if (!r.cleared.length) return say(t('ask.nothingChecked'))
      return say(t('ask.clearedN', { n: r.cleared.length }), {
        sub: r.store?.name,
        rows: r.cleared.slice(0, 8).map((i) => ({ emoji: '✔️', title: i.label })),
        summary: t('ask.sumCleared', { n: r.cleared.length }),
        undo: { run: () => restoreItems(r.cleared), headline: t('ask.clearedBack') },
        open: { label: t('ask.openList'), path: '/shopping' },
      })
    }
    case 'uncheck_items': {
      const r = await uncheckSaid(intent.items)
      env.invalidate('hub:shopping')
      if (!r.hits.length) return say(t('ask.notFoundList', { items: intent.items.join(', ') }))
      return say(t('ask.uncheckedN', { n: r.hits.length }), {
        sub: r.missing.length ? t('ask.notFoundList', { items: r.missing.join(', ') }) : undefined,
        rows: r.hits.map((i) => ({ emoji: '🛒', title: i.label })),
        summary: t('ask.sumUnchecked', { items: r.hits.map((i) => i.label).join(', ') }),
        undo: { run: () => recheck(r.hits), headline: t('ask.recheckedBack') },
        open: { label: t('ask.openList'), path: '/shopping' },
      })
    }

    // ── weather, deals, documents ─────────────────────────────────────────────
    case 'weather': {
      const w = await weatherFor(intent.date, today, env.lang !== 'en')
      if (!w.ok) return say(w.reason === 'no_city' ? t('ask.weatherNoCity') : w.reason === 'too_far' ? t('ask.weatherTooFar') : t('ask.error'))
      const day = env.dayWords(intent.date)
      const wet = w.kind === 'rain' || w.kind === 'storm' || w.kind === 'drizzle' || w.rain >= 50
      const head = wet ? t('ask.weatherRain', { day, pct: w.rain }) : t('ask.weatherDry', { day, pct: w.rain })
      return say(head, {
        rows: [{ emoji: WEATHER_EMOJI[w.kind], title: `${w.min}${w.unit} – ${w.max}${w.unit}`, sub: `${t(`ask.weather.${w.kind}` as TKey)} · ${w.city}` }],
        summary: `${head} ${w.min}–${w.max}${w.unit}`,
      })
    }
    case 'better_deal': {
      const { rows, savingPct } = compareDeals(intent.deals)
      const best = rows.find((r) => r.best)!
      const head = t('ask.dealBest', { label: best.label || formatMoney(best.price) })
      return say(head, {
        sub: savingPct > 0 ? t('ask.dealSaving', { pct: savingPct }) : t('ask.dealSame'),
        rows: rows.map((r) => ({
          emoji: r.best ? '🏷️' : '•',
          title: r.label || `${formatMoney(r.price)} / ${r.size}`,
          sub: t('ask.dealPerUnit', { price: formatMoney(Math.round(r.perUnit * 1000) / 1000) }),
          strong: r.best,
        })),
        summary: `${head}${savingPct > 0 ? ` (${savingPct}%)` : ''}`,
      })
    }
    case 'open_document': {
      const owner = intent.person ? findMember(intent.person, profiles) : null
      const docs = await findDocuments(intent.title, owner)
      if (!docs.length) return say(t('ask.docNotFound', { title: intent.title }), { open: { label: t('ask.openDocs'), path: '/docs' } })
      if (docs.length === 1) {
        return say(t('ask.docOpening', { title: docs[0].title }), {
          summary: t('ask.docOpening', { title: docs[0].title }),
          open: { label: t('ask.openDoc'), path: `/docs?open=${docs[0].id}` },
        })
      }
      return say(t('ask.docSeveral'), {
        rows: docs.slice(0, 5).map((d) => ({ emoji: '📄', title: d.title, sub: first(profiles.find((p) => p.email === d.owner_email)) })),
        summary: docs.map((d) => d.title).join(', '),
        open: { label: t('ask.openDocs'), path: '/docs' },
      })
    }

    // ── the day at a glance ───────────────────────────────────────────────────
    case 'day_summary': {
      const date = intent.date
      const [agenda, pets, nudges, weather] = await Promise.all([
        agendaFor(date, date, '', 'me', '', me, profiles, today),
        date === today ? petsDue(today) : Promise.resolve(null),
        date === today ? unseenNudges(myEmail) : Promise.resolve([]),
        weatherFor(date, today, env.lang !== 'en'),
      ])
      const rows: ActionRowData[] = []
      if (weather.ok) rows.push({ emoji: WEATHER_EMOJI[weather.kind], title: `${weather.min}${weather.unit} – ${weather.max}${weather.unit}`, sub: `${t(`ask.weather.${weather.kind}` as TKey)} · ${t('ask.rainPct', { pct: weather.rain })}` })
      for (const r of agenda.rows.filter((x) => x.kind === 'event').slice(0, 6)) rows.push({ emoji: '🗓️', title: r.title, sub: r.start ? formatTime(r.start, locale) : t('ask.allDay') })
      const care = pets?.rows ?? []
      if (care.length) rows.push({ emoji: '🐾', title: t('ask.petsToDo', { n: care.length }), sub: care.slice(0, 4).map((c) => `${c.title}${c.pet ? ` (${c.pet})` : ''}`).join(', ') })
      for (const n of nudges.slice(0, 3)) rows.push({ emoji: n.emoji, title: `“${n.message}”`, sub: first(profiles.find((p) => p.email === n.from)) })
      const events = agenda.rows.filter((x) => x.kind === 'event').length
      const head = t('ask.dayHead', { day: env.dayWords(date), events, care: care.length })
      return say(head, {
        rows,
        summary: `${head} ${agenda.rows.map((r) => r.title).join(', ')}`,
        open: { label: t('ask.openCalendar'), path: `/calendar?date=${date}` },
      })
    }
    default:
      return null
  }
}

const FAMILY_KEY: Record<string, string> = {
  phone: 'phone',
  blood_type: 'bloodType',
  height: 'height',
  weight: 'weight',
  shoe_size: 'shoeSize',
  pants_size: 'pantsSize',
  shirt_size: 'shirtSize',
  allergies: 'allergies',
  birthday: 'birthday',
}
