// The ask sheet's newer actions (2026-11), each turned into one generic answer
// (ActionView): a headline, optional rows, and Undo / a choice / Open …. The
// data work lives in lib/assistantActions.ts (and lib/assistant.ts); this file
// only decides what to do and how to say it. AskSheet calls actMore() for any
// intent it doesn't handle itself, and the recurring-event choices from there.
import type { ActionRowData } from './AnswerViews'
import {
  endSeries,
  familyInfo,
  findMember,
  locateEvent,
  isExternal,
  moveOccurrence,
  moveSeries,
  removeOccurrence,
  removeSeries,
  restoreEvent,
  restoreItems,
  undoAdd,
  unremoveEvent,
  agendaFor,
  petsDue,
  type EventWho,
  type Intent,
  type MoneyRange,
} from '@/lib/assistant'
import type { Occurrence } from '@/lib/calendar'
import {
  clearChecked,
  createList,
  petWho,
  renameItem,
  setItemLabel,
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
  petRoutine,
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
import { sendPing } from '@/lib/pings'
import type { CalendarEvent, EventRecurrence, PetEventType, Profile } from '@/lib/types'

/** A row of the answer; `pick` makes it tappable ("which one?" lists). */
export type PickRow = ActionRowData & { pick?: () => Promise<ActionAnswer> }

export interface ActionAnswer {
  kind: 'action'
  headline: string
  sub?: string
  rows: PickRow[]
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

/** Whose event a request named ("o dentista do Pedro"): a member when the name
 *  is one (matched by owner), else just the name (matched in the title). */
export function eventWho(person: string | undefined, profiles: Profile[]): EventWho | undefined {
  const name = person?.trim()
  if (!name) return undefined
  const m = findMember(name, profiles)
  return m ? { name: m.display_name.split(' ')[0], email: m.email } : { name }
}

/** "Which one?" — several events fit and nothing said tells them apart (two
 *  kids' dentists). Each candidate is a row with WHO and WHEN; tapping one
 *  carries the request out on exactly that occurrence (owner, 2026-11). */
export function whichEvent(
  env: ActEnv,
  occs: Occurrence[],
  act: (occ: Occurrence) => Promise<ActionAnswer>,
  who?: EventWho,
): ActionAnswer {
  const { t, locale, profiles } = env
  const rows: PickRow[] = occs.slice(0, 6).map((o) => {
    const owner = profiles.find((p) => p.email === o.event.owner_email)
    const time = o.event.start_time && !o.event.all_day ? formatTime(o.event.start_time.slice(0, 5), locale) : ''
    return {
      emoji: KIND_EMOJI[o.event.kind] ?? '🗓️',
      title: o.event.title,
      sub: [owner ? first(owner) : t('ask.everyone'), [shortDay(o.start, locale), time].filter(Boolean).join(', ')].join(' · '),
      pick: () => act(o),
    }
  })
  const head = who ? t('ask.whichEventFor', { name: who.name }) : t('ask.whichEvent')
  return say(head, {
    rows,
    summary: `${head} ${rows.map((r) => `${r.title} (${r.sub})`).join('; ')}`,
  })
}

/** Move one picked occurrence (a series asks first, as everywhere). */
export async function moveAnswer(env: ActEnv, occ: Occurrence, to: string, time: string): Promise<ActionAnswer> {
  const { t } = env
  const r = await moveOccurrence(occ, to, time)
  if (r.ok) {
    env.invalidate('hub:today')
    return say(t('ask.eventMoved'), {
      rows: [{ emoji: KIND_EMOJI[r.ev.kind] ?? '🗓️', title: r.ev.title, sub: env.whenLabel(r.ev) }],
      summary: t('ask.sumMoved', { title: r.ev.title, when: env.whenLabel(r.ev) }),
      undo: { run: () => restoreEvent(r.before), headline: t('ask.moveUndone') },
      open: { label: t('ask.openCalendar'), path: `/calendar?date=${r.ev.start_date}` },
    })
  }
  if (r.reason === 'recurring') return recurringChoice(env, 'move', r.occ.event, r.occ.start, { to, time })
  if (r.reason === 'external') return say(t('ask.editExternal', { title: occ.event.title }))
  return say(t('ask.error'))
}

/** Remove one picked occurrence's event (a series asks first). */
export async function removeAnswer(env: ActEnv, occ: Occurrence): Promise<ActionAnswer> {
  const { t } = env
  const r = await removeOccurrence(occ)
  if (r.ok) {
    env.invalidate('hub:today')
    return say(t('ask.eventRemoved'), {
      rows: [{ emoji: KIND_EMOJI[r.ev.kind] ?? '🗓️', title: r.ev.title, sub: env.whenLabel(r.ev) }],
      summary: t('ask.sumRemovedEvent', { title: r.ev.title, when: env.whenLabel(r.ev) }),
      undo: { run: () => unremoveEvent(r.ev), headline: t('ask.removeUndone') },
    })
  }
  if (r.reason === 'recurring') return recurringChoice(env, 'remove', r.occ.event, r.occ.start)
  if (r.reason === 'external') return say(t('ask.removeExternal', { title: occ.event.title }))
  return say(t('ask.error'))
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
              open: { label: t('ask.openCalendar'), path: `/calendar?date=${move.to || occStart}` },
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
      const who = eventWho(intent.person, profiles)
      const r = await locateEvent(intent.title, intent.date, today, 92, intent.ref, who)
      const edit = async (occ: Occurrence): Promise<ActionAnswer> => {
        const before = occ.event
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
          rows: [{ emoji: KIND_EMOJI[ev.kind] ?? '🗓️', title: ev.title, sub: [shortDay(occ.start, locale), ...changes].join(' · ') }],
          summary: t('ask.sumEventEdited', { title: ev.title, changes: changes.join(', ') }),
          undo: { run: () => restoreEvent(before), headline: t('ask.moveUndone') },
          open: { label: t('ask.openCalendar'), path: `/calendar?date=${occ.start}` },
        })
      }
      if (r.ok) return edit(r.occ)
      env.reportGap('edit_event', r.reason)
      if (r.reason === 'ambiguous') return whichEvent(env, r.options, edit, who)
      return say(t('ask.eventNotFound', { title: intent.title }))
    }
    case 'find_event': {
      const r = await locateEvent(intent.title, intent.date, today, 366, intent.ref, eventWho(intent.person, profiles))
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
        return say(intent.title ? t('ask.entryNotFound', { title: intent.title }) : t('ask.noOwnEntry'))
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
      if (!r.done.length) {
        if (r.unknownPet) return say(t('ask.petUnknown', { pet: r.unknownPet }))
        return say(r.needPet ? t('ask.petWhich') : t('ask.petTaskNotFound', { items: intent.tasks.join(', ') }))
      }
      const notFound = [...r.missing, ...(r.unknownPet ? [r.unknownPet] : [])]
      return say(t('ask.petDoneHead'), {
        sub: notFound.length ? t('ask.notFoundList', { items: notFound.join(', ') }) : undefined,
        rows: r.done.map((d) => ({ emoji: '✅', title: d.task.title, sub: d.pet })),
        summary: t('ask.sumPetDone', { items: r.done.map((d) => `${d.task.title} (${d.pet})`).join(', ') }),
        // Nothing new written (all already ticked): no Undo to offer.
        undo: r.done.some((d) => d.inserted) ? { run: () => undoPetTasksDone(r.done, today), headline: t('ask.petDoneUndone') } : undefined,
        open: { label: t('ask.openPets'), path: '/pets' },
      })
    }
    case 'pet_log': {
      const r = await logPetEvent(intent.pet, intent.type, intent.title || t(`ask.petType.${intent.type}` as TKey), intent.date, intent.next, myEmail)
      if (!r.ok) return say(r.reason === 'error' ? t('ask.error') : t('ask.petWhich'))
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
      const shown = r.rows.slice(0, 8)
      return say(
        late ? t('ask.petNextLate', { title: o.title, pet: o.pet, day: shortDay(o.due, locale) }) : t('ask.petNextHead', { title: o.title, pet: o.pet, day: env.dayWords(o.due) }),
        {
          sub: r.rows.length > 1 ? t('ask.petNextCount', { n: r.rows.length }) : undefined,
          rows: shown.map((x) => ({
            emoji: x.every ? '🔁' : (PET_EMOJI[x.type] ?? '🐾'),
            title: `${x.title} · ${x.pet}`,
            sub: [
              x.due < today ? t('ask.overdueSince', { day: shortDay(x.due, locale) }) : x.due === today ? t('ask.today') : shortDay(x.due, locale),
              x.every ? everyText(t, x.every) : '',
              t('ask.lastOn', { day: shortDay(x.last, locale) }),
            ]
              .filter(Boolean)
              .join(' · '),
          })),
          summary: shown.map((x) => `${x.title} (${x.pet}) ${x.due}`).join(', '),
          open: { label: t('ask.openPets'), path: '/pets' },
        },
      )
    }
    case 'pets_due': {
      // Only the whole-routine view lands here (AskSheet shows the rest).
      if (intent.view !== 'routine') return null
      const list = await petRoutine(intent.pet, today)
      const names = list.map((x) => x.pet).join(', ')
      if (!list.length) {
        return say(intent.pet ? t('ask.petRoutineNoneFor', { pet: intent.pet }) : t('ask.petRoutineNone'), {
          open: { label: t('ask.openPets'), path: '/pets' },
        })
      }
      const several = list.length > 1
      const rows: PickRow[] = []
      for (const p of list) {
        for (const d of p.daily) {
          rows.push({
            emoji: d.done ? '✅' : '🐾',
            title: `${d.time ? `${formatTime(d.time, locale)} · ` : ''}${d.task.title}`,
            sub: [several ? p.pet : '', t('ask.repeat.daily'), d.done ? t('ask.petDoneToday') : ''].filter(Boolean).join(' · '),
          })
        }
        for (const it of p.interval) {
          rows.push({
            emoji: '🔁',
            title: it.task.title,
            sub: [
              several ? p.pet : '',
              it.task.interval_days ? everyText(t, it.task.interval_days) : '',
              it.due
                ? it.due < today
                  ? t('ask.overdueSince', { day: shortDay(it.due, locale) })
                  : t('ask.nextDue', { day: shortDay(it.due, locale) })
                : t('ask.petNeverDone'),
            ]
              .filter(Boolean)
              .join(' · '),
          })
        }
      }
      const daily = list.reduce((n, p) => n + p.daily.length, 0)
      const interval = list.reduce((n, p) => n + p.interval.length, 0)
      const head = several ? t('ask.petRoutinesHead') : t('ask.petRoutineFor', { pet: names })
      return say(head, {
        sub: t('ask.petRoutineCounts', { daily, interval }),
        rows,
        summary: `${head} ${list
          .map((p) => `${p.pet}: ${[...p.daily.map((d) => `${d.time ? `${d.time} ` : ''}${d.task.title}`), ...p.interval.map((i) => i.task.title)].join(', ')}`)
          .join('; ')}`,
        open: { label: t('ask.openPets'), path: '/pets' },
      })
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
    // ── newer (2026-11-17) ────────────────────────────────────────────────────
    case 'create_list': {
      const r = await createList(intent.name)
      if (!r.created) return say(t('ask.listExists', { name: r.store.name }), { open: { label: t('ask.openList'), path: `/shopping?store=${r.store.id}` } })
      env.invalidate('hub:shopping')
      return say(t('ask.listCreated', { name: r.store.name }), {
        open: { label: t('ask.openList'), path: `/shopping?store=${r.store.id}` },
        undo: {
          run: async () => {
            await undoAdd([], r.store.id)
            env.invalidate('hub:shopping')
          },
          headline: t('ask.undoneGeneric'),
        },
      })
    }
    case 'edit_item': {
      const r = await renameItem(intent.item, intent.label)
      if (!r) return say(t('ask.notFoundList', { items: intent.item }))
      env.invalidate('hub:shopping')
      return say(t('ask.itemRenamed', { before: r.before, after: intent.label }), {
        open: { label: t('ask.openList'), path: '/shopping' },
        undo: {
          run: async () => {
            await setItemLabel(r.id, r.before)
            env.invalidate('hub:shopping')
          },
          headline: t('ask.undoneGeneric'),
        },
      })
    }
    case 'my_nudges': {
      const list = await unseenNudges(myEmail)
      if (!list.length) return say(t('ask.nudgesNone'), { open: { label: t('ask.openNudges'), path: '/pings' } })
      const head = t('ask.nudgesSome', { n: list.length })
      return say(head, {
        rows: list.slice(0, 6).map((n) => ({ emoji: n.emoji, title: `“${n.message}”`, sub: first(profiles.find((p) => p.email === n.from)) })),
        summary: `${head} ${list
          .slice(0, 3)
          .map((n) => `${first(profiles.find((p) => p.email === n.from))}: ${n.message}`)
          .join('. ')}`,
        open: { label: t('ask.openNudges'), path: '/pings' },
      })
    }
    case 'ask_location': {
      const who = findMember(intent.person, profiles)
      if (!who || who.email === myEmail) return say(t('ask.whoNotFound', { name: intent.person }))
      const name = first(who)
      return say(t('ask.locAsk', { name }), {
        choices: [
          {
            label: t('ask.locAskBtn'),
            run: async () => {
              await sendPing('location-request', '📍', t('location.stale.nudgeMessage'), [who.email], false, { source: 'location' })
              return say(t('ask.locAsked', { name }))
            },
          },
        ],
      })
    }
    case 'free_check': {
      const who = intent.scope === 'person' ? findMember(intent.person, profiles) : null
      if (intent.scope === 'person' && !who) return say(t('ask.whoNotFound', { name: intent.person }))
      const agenda = await agendaFor(intent.date, intent.date, '', intent.scope, intent.person, me, profiles, today)
      const mins = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))
      const from = intent.from ? mins(intent.from) : 0
      const to = intent.from ? (intent.to && mins(intent.to) > from ? mins(intent.to) : from + 60) : 24 * 60
      // All-day rows (birthdays, trips) are shown but don't make anyone busy.
      const busy = agenda.rows.filter((r) => {
        if (r.kind !== 'event' || !r.start) return false
        const a = mins(r.start)
        const b = r.end && mins(r.end) > a ? mins(r.end) : a + 60
        return a < to && b > from
      })
      const day = env.dayWords(intent.date)
      const when = intent.from
        ? t('ask.freeWindow', { day, from: formatTime(intent.from, locale), to: formatTime(`${String(Math.floor(to / 60) % 24).padStart(2, '0')}:${String(to % 60).padStart(2, '0')}`, locale) })
        : day
      const rows = busy.slice(0, 6).map((r) => ({
        emoji: '🗓️',
        title: r.title,
        sub: [formatTime(r.start!, locale), first(profiles.find((p) => p.email === r.ownerEmail))].filter(Boolean).join(' · '),
      }))
      const open = { label: t('ask.openCalendar'), path: `/calendar?date=${intent.date}` }
      if (intent.scope === 'all') {
        const everyone = busy.some((r) => !r.ownerEmail)
        const free = everyone ? [] : profiles.filter((p) => !busy.some((r) => r.ownerEmail === p.email)).map(first)
        const head = free.length ? t('ask.freeAll', { when, names: free.join(', ') }) : t('ask.freeNobody', { when })
        return say(head, { rows, open })
      }
      const name = who && who.email !== myEmail ? first(who) : ''
      const head = busy.length
        ? name
          ? t('ask.freeNo', { name, n: busy.length, when })
          : t('ask.freeNoMe', { n: busy.length, when })
        : name
          ? t('ask.freeYes', { name, when })
          : t('ask.freeYesMe', { when })
      return say(head, { rows, summary: busy.length ? `${head} ${busy.map((r) => `${r.title} ${r.start}`).join(', ')}` : head, open })
    }
    case 'pet_who': {
      const list = await petWho(intent.pet, intent.tasks, today)
      if (!list.length) return say(t('ask.petWhoNoTask'), { open: { label: t('ask.openPets'), path: '/pets' } })
      const nameOf = (email: string | null) => (email ? first(profiles.find((p) => p.email === email)) || email.split('@')[0] : '')
      const one = list.length === 1 ? list[0] : null
      const head = one
        ? one.by
          ? t('ask.petWhoOne', { name: nameOf(one.by), task: one.task, pet: one.pet })
          : t('ask.petWhoNone', { task: one.task, pet: one.pet })
        : t('ask.petWhoHead')
      return say(head, {
        rows: one ? [] : list.slice(0, 10).map((x) => ({ emoji: x.by ? '✅' : '⏳', title: `${x.task} · ${x.pet}`, sub: x.by ? nameOf(x.by) : t('ask.petWhoNotYet') })),
        summary: one
          ? head
          : `${head}: ${list
              .slice(0, 6)
              .map((x) => `${x.task} (${x.pet}) ${x.by ? nameOf(x.by) : t('ask.petWhoNotYet')}`)
              .join('; ')}`,
        open: { label: t('ask.openPets'), path: '/pets' },
      })
    }
    case 'call_member': {
      const who = findMember(intent.person, profiles)
      if (!who) return say(t('ask.whoNotFound', { name: intent.person }))
      const phone = String((await familyInfo(who.display_name, me, profiles)).row?.phone ?? '')
      const digits = phone.replace(/[^\d+]/g, '')
      if (!digits) return say(t('ask.callNoPhone', { name: first(who) }))
      return say(t('ask.callHead', { name: first(who) }), { sub: phone, open: { label: t('ask.callBtn'), path: `tel:${digits}` } })
    }
    case 'days_until': {
      const n = Math.round((new Date(intent.date + 'T12:00:00').getTime() - new Date(today + 'T12:00:00').getTime()) / 86_400_000)
      const title = intent.title || shortDay(intent.date, locale)
      const day = shortDay(intent.date, locale)
      return say(n <= 0 ? t('ask.daysToday', { title }) : n === 1 ? t('ask.daysOne', { title }) : t('ask.daysUntil', { n, title, day }))
    }
    default:
      return null
  }
}

/** "every 7 days" / "every month" / "every year" for an interval routine. */
function everyText(t: T, days: number): string {
  const years = days / 365
  if (days >= 330 && Math.abs(years - Math.round(years)) < 0.08) {
    const n = Math.round(years)
    return n === 1 ? t('petcare.everyYear') : t('petcare.everyYears', { n })
  }
  if (days >= 28) {
    const n = Math.round(days / 30.44)
    return n <= 1 ? t('petcare.everyMonth') : t('petcare.everyMonths', { n })
  }
  return t('ask.everyDays', { n: days })
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
