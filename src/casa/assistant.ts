// Roof on the home device: understand (the same endpoint and context as
// mobile/src/lib/assistant.ts → understandWithSource) and carry out what the
// phone's Roof does — lists, calendar (incl. the person-aware "which one?"),
// nudges, pets, family, where is someone, weather, utilities — with the
// device's session (RLS). Two areas are refused on purpose (owner, 2026-11-14):
// MONEY (by voice it lives on the phone; the Money panel behind the PIN stays)
// and GAMES (played on everyone's phone). Documents are refused too: a
// family screen in the kitchen must not open the vault.
// Data work: roofData.ts (port of the phone's assistant/assistantActions);
// wording: the `ask.*` keys copied from the phone + `casa.ra.*`.
import { addDays, compareOccurrences, formatTime, KIND_EMOJI, occurrencesInRange, upcomingOccurrences, type Occurrence } from '../lib/calendar'
import { formatMoney } from '../lib/format'
import { overdueEvents } from '../lib/petCare'
import { fetchPingPresets, presetText, sendPing } from '../lib/pings'
import type { TKey } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import type { Budget, CalendarEvent, EventRecurrence, PetEventType, ShoppingItem, ShoppingStore } from '../lib/types'
import { addEntry, deleteEntry, listBudgets, pickBudget } from './money'
import { petsDue, setChecked, deleteItems, restoreItems, type HubData, type Member } from './data'
import { cutWrite, fromServer, KNOWN_INTENTS, PET_SWAPPABLE, petsAsked, type Intent } from './intent'
import * as R from './roofData'
import { API_BASE, GRAD, LOCALE, dateOf, norm } from './util'

type T = (key: TKey, vars?: Record<string, string | number>) => string

export type Tone = 'lists' | 'calendar' | 'pets' | 'money' | 'orb' | 'event' | 'birthday' | 'family' | 'nudge' | 'weather' | 'calc'
export type PanelId = 'calendar' | 'lists' | 'pets' | 'money'
/** What "open …" can bring up on the device. */
export type OpenTarget = PanelId | 'family' | 'frame'

/** "abre o calendário", "show the lists", "mostra os pets", "porta-retrato"…
 *  Caught HERE before the server (owner, 2026-11-13: "open the photo frame"
 *  did nothing): instant, free, works offline. */
const OPEN_VERB = /\b(abr\w*|mostr\w*|ver|veja|vai (pra|para)|ir (pra|para)|entr\w*|open|show|go to|abr[ae]|muestr\w*|ensen\w*|ir a)\b/
const OPEN_WHAT: [RegExp, OpenTarget][] = [
  [/\b(porta.?retratos?|fotos?|album|frame|photo frame|slideshow|marco|retratos?)\b/, 'frame'],
  [/\b(calendarios?|agenda|eventos?|calendar|events?)\b/, 'calendar'],
  [/\b(listas?|compras|mercado|lists?|shopping|groceries)\b/, 'lists'],
  [/\b(pets?|cachorr\w*|gat[oa]s?|cao|caes|bichos?|mascotas?|perr\w*|dogs?|cats?)\b/, 'pets'],
  [/\b(dinheiro|money|orcamentos?|gastos?|budget|dinero|presupuesto)\b/, 'money'],
  [/\b(familia|family|perfis|profiles?)\b/, 'family'],
]
/** "fecha o porta-retrato", "close it", "cierra eso", "pode sair"… — the
 *  thing is already gone (the frame closes when Roof opens; a panel sits
 *  under Roof), so Roof only closes ITSELF (owner, 2026-11-13: it re-opened
 *  the frame instead). */
const CLOSE_VERB = /\b(fech\w*|close|shut|cierr\w*|sai|sair|saia|tchau|volta\w*|voltar|exit|quit)\b/
export function localClose(text: string): boolean {
  const f = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ')
  return CLOSE_VERB.test(f) && f.split(/\s+/).filter(Boolean).length <= 6
}

export function localOpen(text: string): OpenTarget | null {
  const f = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ')
  if (!OPEN_VERB.test(f) || CLOSE_VERB.test(f) || f.split(/\s+/).filter(Boolean).length > 7) return null
  for (const [re, target] of OPEN_WHAT) if (re.test(f)) return target
  return null
}

export interface PickOption {
  id: string
  label: string
  color?: string
  avatar?: string | null
  /** A gradient chip instead of an initial (e.g. "everyone", a list). */
  gradient?: readonly [string, string]
}

/** One row of an answer; `pick` makes it a big tappable row ("which one?"). */
export interface AnswerRow {
  emoji?: string
  title: string
  sub?: string
  strong?: boolean
  pick?: () => Promise<Outcome>
}

export type Done = {
  kind: 'done'
  tone: Tone
  title: string
  sub?: string
  rows?: AnswerRow[]
  speak: string
  undo?: () => Promise<void>
  view?: OpenTarget
  /** Buttons that carry on ("Remove the whole series", "Send"). */
  choices?: { label: string; run: () => Promise<Outcome> }[]
  /** A short tick + the ✓ mark; false for plain answers (lists, agenda). */
  check: boolean
}

export type Outcome =
  | Done
  | { kind: 'pick'; question: string; options: PickOption[]; onPick: (id: string) => Promise<Outcome> }
  /** `say`: said (and shown) before it opens; `money`: an entry to record once the PIN is in. */
  | { kind: 'open'; target: OpenTarget; say?: string; money?: PendingMoney }
  | { kind: 'caps' }
  | { kind: 'bye'; text: string }

/** An expense / income said to Roof while Money was locked: written when the PIN unlocks it. */
export interface PendingMoney {
  budget: Budget
  type: 'expense' | 'income'
  amount: number
  label: string
  date: string
  /** "R$ 50,00 · Mercado", for the PIN screen. */
  line: string
}

export interface AskEnv {
  /** Money is unlocked on this device right now (the PIN was typed). */
  unlocked: boolean
  t: T
  lang: 'en' | 'es' | 'pt'
  today: string
  data: HubData
  me: { email: string; name: string }
  history: { q: string; a: string }[]
  /** Re-read the hub after a write. */
  refresh: () => void
}

// ── understanding ────────────────────────────────────────────────────────────

/** The context the phone sends, minus money entries and documents (neither
 *  is done here; budget names stay so a money request is still READ as money
 *  and answered "on the phone", not mistaken for a list item). */
async function buildContext(env: AskEnv, text: string) {
  const { data, today, lang } = env
  const budgets = await supabase.from('budgets').select('name')
  const nameOf = (email: string | null) => data.members.find((m) => m.email === email)?.first ?? ''
  const occ = upcomingOccurrences(data.events, addDays(today, -3), 45).slice(0, 40)
  R.setEventRefs(occ)
  const storeName = (id: string | null) => data.stores.find((s) => s.id === id)?.name ?? 'anywhere'
  return {
    text,
    today,
    weekday: dateOf(today).toLocaleDateString('en-US', { weekday: 'long' }),
    lang,
    stores: data.stores.map((s) => s.name),
    members: data.members.map((m) => m.name),
    budgets: ((budgets.data ?? []) as { name: string }[]).map((b) => b.name),
    pets: data.pets.map((p) => p.name),
    petKinds: data.pets.filter((p) => p.species).map((p) => `${p.name} = ${p.species}`),
    petTasks: data.pets
      .map((p) => {
        const mine = data.tasks.filter((x) => x.pet_id === p.id).map((x) => x.title)
        return mine.length ? `${p.name}: ${mine.join(', ')}` : ''
      })
      .filter(Boolean),
    openItems: data.open.map((i) => `${i.label} @ ${storeName(i.store_id)}`),
    events: occ.map(
      (o, i) => `v${i + 1} = ${o.event.title} · ${o.start}${o.event.start_time ? ` ${o.event.start_time.slice(0, 5)}` : ''}${o.event.owner_email ? ` · ${nameOf(o.event.owner_email)}` : ''}`,
    ),
    documents: [] as string[],
    me: env.me.name,
    history: env.history.slice(-6),
  }
}

export type Understood = { ok: true; intent: Intent; then?: string } | { ok: false; reason: 'offline' | 'limit' }

/** Ask the server and settle on one intent, like the phone's
 *  understandWithSource: a missing detail is asked for (never guessed), a cut
 *  request never writes, a pet named next to "need / routine…" is a routine
 *  question. No local regex fallback here — offline says so. */
export async function understand(env: AskEnv, text: string): Promise<Understood> {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) return { ok: false, reason: 'offline' }
    const body = await buildContext(env, text)
    const res = await fetch(`${API_BASE}/api/suggest-ping?action=assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    if (res.status === 402) return { ok: false, reason: 'limit' }
    if (!res.ok) return { ok: false, reason: 'offline' }
    const j = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!j || typeof j.intent !== 'string') return { ok: false, reason: 'offline' }
    const remote = fromServer(j, env.today)
    if (!remote) return { ok: true, intent: KNOWN_INTENTS.has(j.intent) ? { intent: 'need_detail', about: j.intent } : { intent: 'unknown', reply: '' } }
    if (cutWrite(remote.intent, text)) return { ok: true, intent: { intent: 'need_detail', about: remote.intent } }
    const asked = PET_SWAPPABLE.has(remote.intent) ? petsAsked(text, body.pets, body.members) : []
    const view = remote.intent === 'pets_due' && remote.view ? { view: remote.view } : {}
    if (asked.length > 1) return { ok: true, intent: { intent: 'pets_due', pet: asked.join(', '), ...view } }
    if (asked[0] && (remote.intent !== 'pets_due' || !remote.pet)) return { ok: true, intent: { intent: 'pets_due', pet: asked[0], ...view } }
    // A second task said in the same breath: Roof asks it next.
    const then = typeof j.then === 'string' ? j.then.trim().slice(0, 200) : ''
    return { ok: true, intent: remote, ...(then ? { then } : {}) }
  } catch {
    return { ok: false, reason: 'offline' }
  }
}

// ── wording helpers ──────────────────────────────────────────────────────────

function joinList(words: string[], lang: string): string {
  try {
    return new Intl.ListFormat(LOCALE[lang as 'pt'] ?? 'pt-BR', { type: 'conjunction' }).format(words)
  } catch {
    return words.join(', ')
  }
}

export function whenLabel(env: AskEnv, from: string, to: string): string {
  const { t, today, lang } = env
  const loc = LOCALE[lang]
  const fmt = (iso: string) => dateOf(iso).toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'short' })
  if (from === to) {
    if (from === today) return t('casa.when.today')
    if (from === addDays(today, 1)) return t('casa.when.tomorrow')
    return t('casa.when.onDay', { day: fmt(from) })
  }
  return t('casa.when.range', { from: fmt(from), to: fmt(to) })
}

export function memberOptions(members: Member[], everyone?: string): PickOption[] {
  const opts: PickOption[] = members.map((m) => ({ id: m.email, label: m.first, color: m.color, avatar: m.avatar }))
  if (everyone) opts.push({ id: '*', label: everyone, gradient: GRAD.frame })
  return opts
}

const shortDay = (iso: string, lang: string) => dateOf(iso).toLocaleDateString(LOCALE[lang as 'pt'], { weekday: 'short', day: 'numeric', month: 'short' })
const timeOf = (ev: CalendarEvent, lang: string) => (ev.start_time && !ev.all_day ? formatTime(ev.start_time.slice(0, 5), LOCALE[lang as 'pt']) : '')

function say(tone: Tone, title: string, extra: Partial<Done> = {}): Done {
  return { kind: 'done', tone, title, speak: title, check: false, ...extra }
}

function recurrenceLabel(t: T, r: EventRecurrence): string {
  return r === 'none' ? '' : t(`ask.repeat.${r}` as TKey)
}

function reminderLabel(t: T, minutes: number | null): string {
  if (minutes == null) return ''
  if (minutes === 0) return t('ask.remindAtTime')
  if (minutes % 1440 === 0) return t('ask.remindDays', { n: minutes / 1440 })
  if (minutes % 60 === 0) return t('ask.remindHours', { n: minutes / 60 })
  return t('ask.remindMinutes', { n: minutes })
}

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

const PET_EMOJI: Record<PetEventType, string> = { vet: '🩺', vaccine: '💉', medication: '💊', grooming: '✂️', other: '🐾' }
const WEATHER_EMOJI: Record<R.WeatherKind, string> = { clear: '☀️', cloudy: '⛅', fog: '🌫️', drizzle: '🌦️', rain: '🌧️', snow: '❄️', storm: '⛈️' }

const FIELD_LABEL: Record<string, TKey> = {
  phone: 'family.phone',
  blood_type: 'family.bloodType',
  height: 'family.height',
  weight: 'family.weight',
  shoe_size: 'family.shoeSize',
  pants_size: 'family.pantsSize',
  shirt_size: 'family.shirtSize',
  allergies: 'family.allergies',
  birthday: 'family.birthday',
}

function needKey(about: string): TKey {
  if (about === 'add_items') return 'ask.need.addItems'
  if (['check_items', 'remove_items', 'move_items', 'uncheck_items'].includes(about)) return 'ask.need.list'
  if (about === 'add_event') return 'ask.need.addEvent'
  if (about === 'move_event') return 'ask.need.moveEvent'
  if (about === 'edit_event') return 'ask.need.editEvent'
  if (about === 'remove_event' || about === 'find_event') return 'ask.need.whichEvent'
  if (about === 'send_nudge') return 'ask.need.nudge'
  if (about.startsWith('pet_')) return 'ask.need.pet'
  return 'ask.need.generic'
}

const MONEY = new Set(['add_money', 'money_summary', 'list_money', 'fix_money', 'remove_money'])
const WRITES = new Set([
  'add_items', 'check_items', 'remove_items', 'move_items', 'clear_checked', 'uncheck_items',
  'add_event', 'move_event', 'remove_event', 'edit_event', 'pet_done', 'pet_log', 'pet_weight', 'family_update', 'send_nudge',
  'add_money', 'create_list', 'edit_item',
])

// ── calendar answers (shared by the "which one?" rows) ───────────────────────

function evWhen(env: AskEnv, ev: CalendarEvent, start = ev.start_date): string {
  const time = timeOf(ev, env.lang)
  return [shortDay(start, env.lang), time].filter(Boolean).join(', ')
}

/** "Which one?" — several events fit and nothing said tells them apart. Each
 *  candidate (who · day, time) is a big row; tapping it carries on. */
function whichEvent(env: AskEnv, occs: Occurrence[], run: (o: Occurrence) => Promise<Outcome>, who?: R.EventWho): Outcome {
  const { t, data } = env
  const rows: AnswerRow[] = occs.slice(0, 6).map((o) => {
    const owner = data.members.find((m) => m.email === o.event.owner_email)
    return {
      emoji: KIND_EMOJI[o.event.kind] || '🗓️',
      title: o.event.title,
      sub: [owner ? owner.first : t('ask.everyone'), evWhen(env, o.event, o.start)].join(' · '),
      pick: () => run(o),
    }
  })
  const head = who ? t('ask.whichEventFor', { name: who.name }) : t('ask.whichEvent')
  return say('calendar', head, { rows })
}

async function moveAnswer(env: AskEnv, occ: Occurrence, to: string, time: string): Promise<Outcome> {
  const { t } = env
  const r = await R.moveOccurrence(occ, to, time)
  if (r.ok) {
    env.refresh()
    return say('event', t('ask.eventMoved'), {
      check: true,
      rows: [{ emoji: KIND_EMOJI[r.ev.kind] || '🗓️', title: r.ev.title, sub: evWhen(env, r.ev) }],
      undo: async () => {
        await R.restoreEvent(r.before)
        env.refresh()
      },
      view: 'calendar',
    })
  }
  if (r.reason === 'recurring') return recurringChoice(env, 'move', r.occ.event, r.occ.start, { to, time })
  if (r.reason === 'external') return say('calendar', t('ask.editExternal', { title: occ.event.title }))
  return say('orb', t('ask.error'))
}

async function removeAnswer(env: AskEnv, occ: Occurrence): Promise<Outcome> {
  const { t } = env
  const r = await R.removeOccurrence(occ)
  if (r.ok) {
    env.refresh()
    return say('event', t('ask.eventRemoved'), {
      check: true,
      rows: [{ emoji: KIND_EMOJI[r.ev.kind] || '🗓️', title: r.ev.title, sub: evWhen(env, r.ev, occ.start) }],
      undo: async () => {
        await R.unremoveEvent(r.ev)
        env.refresh()
      },
    })
  }
  if (r.reason === 'recurring') return recurringChoice(env, 'remove', r.occ.event, r.occ.start)
  if (r.reason === 'external') return say('calendar', t('ask.removeExternal', { title: occ.event.title }))
  return say('orb', t('ask.error'))
}

/** A recurring event: one occurrence can't be changed alone — ask what to do. */
function recurringChoice(env: AskEnv, mode: 'remove' | 'move', ev: CalendarEvent, occStart: string, move?: { to: string; time: string }): Outcome {
  const { t, lang } = env
  const label = recurrenceLabel(t, ev.recurrence)
  const row: AnswerRow = { emoji: KIND_EMOJI[ev.kind] || '🗓️', title: ev.title, sub: [label, shortDay(occStart, lang)].filter(Boolean).join(' · ') }
  if (mode === 'move' && move) {
    return say('calendar', t('ask.seriesMoveAsk', { title: ev.title }), {
      rows: [row],
      choices: [
        {
          label: t('ask.seriesMove'),
          run: async () => {
            const r = await R.moveSeries(ev, occStart, move.to, move.time)
            if (!r.ok) return say('orb', t('ask.error'))
            env.refresh()
            return say('event', t('ask.seriesMoved', { title: ev.title }), {
              check: true,
              rows: [{ emoji: '🗓️', title: r.ev.title, sub: [label, evWhen(env, r.ev)].filter(Boolean).join(' · ') }],
              undo: async () => {
                await R.restoreEvent(r.before)
                env.refresh()
              },
              view: 'calendar',
            })
          },
        },
      ],
    })
  }
  const choices: Done['choices'] = [
    {
      label: t('ask.seriesRemoveAll'),
      run: async () => {
        if (!(await R.removeSeries(ev))) return say('orb', t('ask.error'))
        env.refresh()
        return say('event', t('ask.seriesRemoved', { title: ev.title }), {
          check: true,
          undo: async () => {
            await R.unremoveEvent(ev)
            env.refresh()
          },
        })
      },
    },
  ]
  if (occStart > ev.start_date) {
    choices.push({
      label: t('ask.seriesStopFrom', { day: shortDay(occStart, lang) }),
      run: async () => {
        if (!(await R.endSeries(ev, occStart))) return say('orb', t('ask.error'))
        env.refresh()
        return say('event', t('ask.seriesStopped', { title: ev.title, day: shortDay(occStart, lang) }), {
          check: true,
          undo: async () => {
            await R.restoreEvent(ev)
            env.refresh()
          },
        })
      },
    })
  }
  return say('calendar', t('ask.seriesRemoveAsk', { title: ev.title }), { rows: [row], choices })
}

async function addMoney(env: AskEnv, intent: Extract<Intent, { intent: 'add_money' }>): Promise<Outcome> {
  const { t, me } = env
  if (!(intent.amount > 0)) return say('money', t('ask.need.addMoney'))
  const budgets = await listBudgets()
  if (!budgets.length) return say('money', t('casa.ra.moneyNoBudget'))
  const amount = formatMoney(intent.amount)
  const label = intent.title.trim()
  const line = [amount, label].filter(Boolean).join(' · ')
  const put = async (b: Budget): Promise<Outcome> => {
    if (!env.unlocked)
      return { kind: 'open', target: 'money', say: t('casa.ra.moneyPinAdd', { line }), money: { budget: b, type: intent.type, amount: intent.amount, label, date: intent.date, line } }
    const r = await addEntry({ budget: b, type: intent.type, amount: intent.amount, label, person: me.email, date: intent.date })
    return say('money', t(intent.type === 'income' ? 'casa.ra.moneyIn' : 'casa.ra.moneyOut', { line, budget: b.name }), {
      check: true,
      view: 'money',
      undo: () => deleteEntry(r.id, r.createdMonth),
    })
  }
  const b = pickBudget(budgets, intent.budget)
  if (b) return put(b)
  return {
    kind: 'pick',
    question: t('casa.ra.whichBudget', { line }),
    options: budgets.map((x) => ({ id: x.id, label: x.name, gradient: GRAD.money })),
    onPick: async (id) => put(budgets.find((x) => x.id === id) ?? budgets[0]),
  }
}

// ── doing ────────────────────────────────────────────────────────────────────

/** Carry out what the server understood. `full` = the plan lets this device act. */
export async function act(env: AskEnv, intent: Intent, full: boolean): Promise<Outcome> {
  const { t, data, today, lang, me } = env
  const general = t('casa.list.general')

  // Refused on the home device, whatever the plan (owner, 2026-11-14).
  // MONEY (owner, 2026-11-17): an expense / income can be SAID here — it only
  // writes — but anything that SHOWS money goes to the Money panel, which
  // asks for the PIN. Locked, the entry waits for the PIN and is written then.
  if (intent.intent === 'add_money') return full ? addMoney(env, intent) : say('orb', t('casa.plan.lockedAction'))
  if (MONEY.has(intent.intent)) return { kind: 'open', target: 'money', say: t(env.unlocked ? 'casa.ra.moneyOpen' : 'casa.ra.moneyPin') }
  if (intent.intent === 'start_game') return say('orb', t('casa.ra.gamesPhone'))
  if (intent.intent === 'open_document') return say('orb', t('casa.ra.docsPhone'))
  if (!full && WRITES.has(intent.intent)) return say('orb', t('casa.plan.lockedAction'))

  switch (intent.intent) {
    case 'unknown':
      return say('orb', intent.reply || t('casa.roof.notSure'))
    case 'need_detail':
      return say('orb', t(needKey(intent.about)))
    case 'needs_update':
    case 'limit_reached':
      return say('orb', t('casa.roof.notSure'))

    // ── lists ────────────────────────────────────────────────────────────────
    case 'add_items': {
      const stores = data.stores
      const store = R.matchStore(intent.store, stores)
      const put = async (s: ShoppingStore | null, created = false): Promise<Outcome> => {
        const r = await R.addItems(intent.items, s, me.email, created)
        env.refresh()
        const list = s?.name ?? general
        const title = r.added.length
          ? t('casa.roof.added', { items: joinList(r.added.map((i) => i.label), lang), list })
          : t('casa.roof.alreadyThere', { items: joinList(r.existing, lang) })
        return say('lists', title, {
          sub: r.added.length && r.existing.length ? t('casa.roof.alreadyThere', { items: joinList(r.existing, lang) }) : undefined,
          check: r.added.length > 0,
          view: 'lists',
          undo: r.added.length
            ? async () => {
                await R.undoAdd(r.added.map((i) => i.id), created ? s?.id : undefined)
                env.refresh()
              }
            : undefined,
        })
      }
      // A store that exists → straight in. Otherwise ASK which list (never
      // invent one from a word like "compras"), offering to create a named one.
      if (store || (!intent.store && stores.length === 0)) return put(store)
      const options: PickOption[] = []
      const named = intent.store.trim() && !/^(mercado|lista|list|compras|shopping|groceries|geral|general|anywhere|qualquer)$/.test(norm(intent.store))
      if (named) options.push({ id: '+new', label: t('ask.createNamed', { name: intent.store }), gradient: GRAD.orb })
      for (const s of stores) options.push({ id: s.id, label: s.name, gradient: GRAD.lists })
      options.push({ id: '*', label: general, gradient: GRAD.lists })
      return {
        kind: 'pick',
        question: t('ask.whichList', { items: joinList(intent.items, lang) }),
        options,
        onPick: async (id) => {
          if (id === '+new') return put(await R.createStore(intent.store), true)
          return put(id === '*' ? null : (stores.find((s) => s.id === id) ?? null))
        },
      }
    }
    case 'list_items': {
      const store = intent.store ? R.matchStore(intent.store, data.stores) : null
      const open = store ? data.open.filter((i) => i.store_id === store.id) : data.open
      if (!open.length) {
        const title = store ? t('casa.roof.listEmptyNamed', { list: store.name }) : t('casa.roof.listEmpty')
        return say('lists', title, { view: 'lists' })
      }
      const storeName = (id: string | null) => data.stores.find((s) => s.id === id)?.name ?? general
      const title = store ? t('casa.ra.listOf', { count: open.length, list: store.name }) : t('casa.roof.listHas', { count: open.length })
      const sorted = store ? open : [...open].sort((a, b) => storeName(a.store_id).localeCompare(storeName(b.store_id)))
      return say('lists', title, {
        rows: sorted.slice(0, 14).map((i) => ({ emoji: '🛒', title: i.label, sub: store ? undefined : storeName(i.store_id) })),
        sub: open.length > 14 ? t('casa.ra.andMore', { count: open.length - 14 }) : undefined,
        speak: `${title}: ${joinList(sorted.slice(0, 8).map((i) => i.label), lang)}.`,
        view: 'lists',
      })
    }
    case 'find_items': {
      const { hits } = R.matchLabels(intent.items, data.open)
      const storeName = (id: string | null) => data.stores.find((s) => s.id === id)?.name ?? general
      if (!hits.length) return say('lists', intent.reply || t('casa.ra.notOnList', { items: joinList(intent.items, lang) }), { view: 'lists' })
      const title = intent.reply || t('casa.ra.onList', { items: joinList(hits.map((h) => h.label), lang) })
      return say('lists', title, { rows: hits.map((h) => ({ emoji: '🛒', title: h.label, sub: storeName(h.store_id) })), view: 'lists' })
    }
    case 'check_items': {
      const { hits, missing } = R.matchLabels(intent.items, data.open)
      if (!hits.length) return say('lists', t('casa.roof.notFound', { items: joinList(intent.items, lang) }), { view: 'lists' })
      await setChecked(hits.map((i) => i.id), true)
      env.refresh()
      return say('lists', t('casa.roof.checked', { items: joinList(hits.map((i) => i.label), lang) }), {
        sub: missing.length ? t('casa.roof.notFound', { items: joinList(missing, lang) }) : undefined,
        check: true,
        view: 'lists',
        undo: async () => {
          await setChecked(hits.map((i) => i.id), false)
          env.refresh()
        },
      })
    }
    case 'remove_items': {
      const { hits, missing } = R.matchLabels(intent.items, [...data.open, ...data.checked])
      if (!hits.length) return say('lists', t('casa.roof.notFound', { items: joinList(intent.items, lang) }), { view: 'lists' })
      await deleteItems(hits.map((i) => i.id))
      env.refresh()
      return say('lists', t('casa.roof.removed', { items: joinList(hits.map((i) => i.label), lang) }), {
        sub: missing.length ? t('casa.roof.notFound', { items: joinList(missing, lang) }) : undefined,
        check: true,
        view: 'lists',
        undo: async () => {
          await restoreItems(hits)
          env.refresh()
        },
      })
    }
    case 'move_items': {
      const r = await R.moveItemsTo(intent.items, intent.store)
      if (!r.ok) return say('lists', t('ask.storeNotFound', { store: r.store }))
      env.refresh()
      if (!r.moved.length) return say('lists', r.missing.length ? t('ask.notFoundList', { items: r.missing.join(', ') }) : t('ask.alreadyThere', { store: r.store.name }))
      return say('lists', t('ask.itemsMoved', { store: r.store.name }), {
        sub: r.missing.length ? t('ask.notFoundList', { items: r.missing.join(', ') }) : undefined,
        rows: r.moved.map((i) => ({ emoji: '🛒', title: i.label })),
        check: true,
        view: 'lists',
        undo: async () => {
          await R.restoreStores(r.moved)
          env.refresh()
        },
      })
    }
    case 'clear_checked': {
      const r = await R.clearChecked(intent.store)
      if (r.unknownStore) return say('lists', t('ask.storeNotFound', { store: intent.store }))
      env.refresh()
      if (!r.cleared.length) return say('lists', t('casa.roof.nothingChecked'), { view: 'lists' })
      return say('lists', t('casa.roof.cleared', { count: r.cleared.length }), {
        sub: r.store?.name,
        check: true,
        view: 'lists',
        undo: async () => {
          await restoreItems(r.cleared)
          env.refresh()
        },
      })
    }
    case 'uncheck_items': {
      const r = await R.uncheckSaid(intent.items)
      env.refresh()
      if (!r.hits.length) return say('lists', t('ask.notFoundList', { items: intent.items.join(', ') }))
      return say('lists', t('ask.uncheckedN', { n: r.hits.length }), {
        sub: r.missing.length ? t('ask.notFoundList', { items: r.missing.join(', ') }) : undefined,
        rows: r.hits.map((i: ShoppingItem) => ({ emoji: '🛒', title: i.label })),
        check: true,
        view: 'lists',
        undo: async () => {
          await R.recheck(r.hits)
          env.refresh()
        },
      })
    }

    // ── calendar ─────────────────────────────────────────────────────────────
    case 'agenda': {
      const { date, end } = intent
      const who = intent.scope === 'person' ? R.findMember(intent.person, data.members) : null
      const occ = occurrencesInRange(data.events, date, end)
        .filter((o) => !who || !o.event.owner_email || o.event.owner_email === who.email)
        .sort((a, b) => (a.start !== b.start ? (a.start < b.start ? -1 : 1) : compareOccurrences(a, b)))
      const when = whenLabel(env, date, end)
      // Pet care due shows on today, like the phone's agenda.
      const care = date <= today && today <= end ? overdueEvents(data.petEvents, today) : []
      if (!occ.length && !care.length) return say('calendar', t('casa.roof.agendaNone', { when }), { view: 'calendar' })
      const rows: AnswerRow[] = occ.slice(0, 10).map((o) => {
        const owner = data.members.find((m) => m.email === o.event.owner_email)
        const time = timeOf(o.event, lang) || t('casa.cal.allDay')
        return {
          emoji: KIND_EMOJI[o.event.kind] || '🗓️',
          title: o.event.title,
          sub: [date !== end ? shortDay(o.start, lang) : '', time, owner?.first ?? '', o.event.location ?? ''].filter(Boolean).join(' · '),
        }
      })
      for (const e of care.slice(0, 3)) rows.push({ emoji: PET_EMOJI[e.type] ?? '🐾', title: e.title, sub: data.pets.find((p) => p.id === e.pet_id)?.name })
      const title = occ.length ? t('casa.roof.agendaSome', { count: occ.length, when }) : t('casa.roof.agendaNone', { when })
      return say('calendar', title, {
        rows,
        sub: occ.length > 10 ? t('casa.ra.andMore', { count: occ.length - 10 }) : undefined,
        speak: occ.length ? `${title}: ${joinList(occ.slice(0, 5).map((o) => o.event.title), lang)}.` : title,
        view: 'calendar',
      })
    }
    case 'day_summary': {
      const date = intent.date
      const [weather, nudges] = await Promise.all([
        R.weatherFor(date, today, lang),
        date === today ? R.unseenNudges(me.email) : Promise.resolve([]),
      ])
      const occ = occurrencesInRange(data.events, date, date).sort(compareOccurrences)
      const care = date === today ? petsDue(data, today) : []
      const rows: AnswerRow[] = []
      if (weather.ok)
        rows.push({ emoji: WEATHER_EMOJI[weather.kind], title: `${weather.min}${weather.unit} – ${weather.max}${weather.unit}`, sub: `${t(`ask.weather.${weather.kind}` as TKey)} · ${t('ask.rainPct', { pct: weather.rain })}` })
      for (const o of occ.slice(0, 6)) rows.push({ emoji: KIND_EMOJI[o.event.kind] || '🗓️', title: o.event.title, sub: timeOf(o.event, lang) || t('ask.allDay') })
      if (care.length) rows.push({ emoji: '🐾', title: t('ask.petsToDo', { n: care.length }), sub: care.slice(0, 4).map((c) => `${c.title} (${c.pet.name})`).join(', ') })
      for (const n of nudges.slice(0, 3)) rows.push({ emoji: n.emoji, title: `“${n.message}”`, sub: data.members.find((m) => m.email === n.from)?.first })
      const day = whenLabel(env, date, date)
      const head = t('ask.dayHead', { day: day.charAt(0).toUpperCase() + day.slice(1), events: occ.length, care: care.length })
      return say('calendar', head, { rows, view: 'calendar' })
    }
    case 'add_event': {
      const { title, date } = intent
      const time = /^\d{2}:\d{2}$/.test(intent.time) ? intent.time : ''
      const save = async (owner: string | null): Promise<Outcome> => {
        const ev = await R.addEvent(title, date, time, owner, intent.opts)
        env.refresh()
        const when = whenLabel(env, date, date)
        const sentence = t('casa.roof.eventAdded', { title, when: time ? `${when}, ${time}` : when })
        const extras = [recurrenceLabel(t, ev.recurrence), reminderLabel(t, ev.reminder_minutes), ev.location ?? ''].filter(Boolean)
        return say('event', sentence, {
          sub: extras.length ? extras.join(' · ') : undefined,
          check: true,
          view: 'calendar',
          undo: async () => {
            await supabase.from('calendar_events').delete().eq('id', ev.id)
            env.refresh()
          },
        })
      }
      // Birthdays and anniversaries are the household's (as on the phone).
      if (intent.opts?.kind === 'birthday' || intent.opts?.kind === 'anniversary') return save(null)
      const who = R.findMember(intent.person, data.members)
      if (who) return save(who.email)
      if (data.members.length <= 1) return save(data.members[0]?.email ?? null)
      // A shared screen: ask whose it is (the phone assumes the asker).
      return { kind: 'pick', question: t('casa.who.title'), options: memberOptions(data.members, t('casa.who.everyone')), onPick: (id) => save(id === '*' ? null : id) }
    }
    case 'move_event': {
      const who = R.eventWho(intent.person, data.members)
      const r = await R.locateEvent(intent.title, intent.date, today, 92, intent.ref, who)
      if (r.ok) return moveAnswer(env, r.occ, intent.newDate, intent.time)
      if (r.reason === 'ambiguous' && r.options.length) return whichEvent(env, r.options, (o) => moveAnswer(env, o, intent.newDate, intent.time), who)
      const day = whenLabel(env, intent.date, intent.date)
      const names = r.options.slice(0, 4).map((o) => o.event.title).join(', ')
      return say('calendar', names ? t('ask.moveNotFoundSome', { title: intent.title, day, names }) : t('ask.moveNotFound', { day }))
    }
    case 'remove_event': {
      const who = R.eventWho(intent.person, data.members)
      const r = await R.locateEvent(intent.title, intent.date, today, 92, intent.ref, who)
      if (r.ok) return removeAnswer(env, r.occ)
      if (r.reason === 'ambiguous' && r.options.length) return whichEvent(env, r.options, (o) => removeAnswer(env, o), who)
      if (!intent.date) return say('calendar', t('ask.removeNotFoundSoon', { title: intent.title }))
      const day = whenLabel(env, intent.date, intent.date)
      const names = r.options.slice(0, 4).map((o) => o.event.title).join(', ')
      return say('calendar', names ? t('ask.removeNotFoundSome', { title: intent.title, day, names }) : t('ask.removeNotFound', { day }))
    }
    case 'edit_event': {
      const who = R.eventWho(intent.person, data.members)
      const r = await R.locateEvent(intent.title, intent.date, today, 92, intent.ref, who)
      const edit = async (occ: Occurrence): Promise<Outcome> => {
        const before = occ.event
        if (R.isExternal(before)) return say('calendar', t('ask.editExternal', { title: before.title }))
        const ev = await R.editEvent(before, { newTitle: intent.newTitle, location: intent.location, notes: intent.notes, reminder: intent.reminder })
        if (!ev) return say('orb', t('ask.error'))
        env.refresh()
        const changes = [
          intent.newTitle ? t('ask.editRenamed', { title: ev.title }) : '',
          intent.location ? `📍 ${ev.location}` : '',
          intent.notes ? `📝 ${intent.notes}` : '',
          intent.reminder === -2 ? t('ask.editNoReminder') : intent.reminder >= 0 ? `⏰ ${reminderLabel(t, intent.reminder)}` : '',
        ].filter(Boolean)
        return say('event', t('ask.eventEdited'), {
          check: true,
          rows: [{ emoji: KIND_EMOJI[ev.kind] || '🗓️', title: ev.title, sub: [shortDay(occ.start, lang), ...changes].join(' · ') }],
          undo: async () => {
            await R.restoreEvent(before)
            env.refresh()
          },
          view: 'calendar',
        })
      }
      if (r.ok) return edit(r.occ)
      if (r.reason === 'ambiguous' && r.options.length) return whichEvent(env, r.options, edit, who)
      return say('calendar', t('ask.eventNotFound', { title: intent.title }))
    }
    case 'find_event': {
      const r = await R.locateEvent(intent.title, intent.date, today, 366, intent.ref, R.eventWho(intent.person, data.members))
      if (!r.ok && r.reason === 'not_found') return say('calendar', t('ask.findNone', { title: intent.title }))
      const occs = r.ok ? [r.occ] : r.options.slice(0, 4)
      const o = occs[0]
      return say('calendar', r.ok ? t('ask.findNext', { title: o.event.title, when: whenLabel(env, o.start, o.start) }) : t('ask.findSeveral'), {
        rows: occs.map((x) => ({
          emoji: KIND_EMOJI[x.event.kind] || '🗓️',
          title: x.event.title,
          sub: [evWhen(env, x.event, x.start), x.event.location, data.members.find((m) => m.email === x.event.owner_email)?.first].filter(Boolean).join(' · '),
        })),
        view: 'calendar',
      })
    }
    case 'birthdays': {
      const rows = await R.upcomingBirthdays(today, data.members)
      if (!rows.length) return say('birthday', t('ask.birthdaysNone'))
      const first = rows[0]
      return say('birthday', t('ask.birthdaysHead'), {
        rows: rows.map((b) => ({
          emoji: b.kind === 'anniversary' ? '💍' : '🎂',
          title: b.name,
          sub: [
            b.inDays === 0 ? t('ask.today') : b.inDays === 1 ? t('ask.tomorrow') : shortDay(b.date, lang),
            b.years > 0 ? t(b.kind === 'anniversary' ? 'ask.yearsTogether' : 'ask.turning', { n: b.years }) : '',
          ]
            .filter(Boolean)
            .join(' · '),
        })),
        speak: `${t('ask.birthdaysHead')} ${first.name}, ${first.inDays === 0 ? t('ask.today') : first.inDays === 1 ? t('ask.tomorrow') : shortDay(first.date, lang)}.`,
        view: 'calendar',
      })
    }

    // ── nudges ───────────────────────────────────────────────────────────────
    case 'send_nudge': {
      const to = intent.person ? R.findMember(intent.person, data.members) : null
      const presets = await fetchPingPresets().catch(() => [])
      const preset = presets.find((p) => presetText(p, t).trim().toLowerCase() === intent.message.trim().toLowerCase())
      const urgent = !!intent.urgent || !!preset?.high_priority
      const emoji = urgent ? '🆘' : (preset?.emoji ?? '📣')
      const kind = urgent ? 'help' : (preset?.preset_key ?? 'custom')
      const toName = urgent || !to ? t('ask.everyone') : to.first
      return say('nudge', t('ask.nudgeConfirm', { to: toName }), {
        rows: [{ emoji, title: `“${intent.message}”`, sub: [t('casa.ra.nudgeFrom', { name: me.name.split(' ')[0] }), urgent ? t('ask.nudgeUrgent') : ''].filter(Boolean).join(' · ') }],
        choices: [
          {
            label: t('casa.ra.nudgeSend'),
            run: async () => {
              await sendPing(kind, emoji, intent.message, to && !urgent ? [to.email] : null, urgent)
              return say('nudge', t('ask.nudgeSent', { to: toName }), { check: true, rows: [{ emoji, title: `“${intent.message}”` }] })
            },
          },
        ],
      })
    }
    case 'nudge_seen': {
      const r = await R.lastNudgeSeen(me.email, data.members)
      if (!r) return say('nudge', t('ask.nudgeSeenNone'))
      const head = !r.notYet.length ? t('ask.nudgeSeenAll') : !r.seen.length ? t('ask.nudgeSeenNobody') : t('ask.nudgeSeenSome', { names: r.seen.join(', ') })
      return say('nudge', head, { rows: [{ emoji: r.emoji, title: `“${r.message}”`, sub: r.notYet.length ? t('ask.nudgeNotYet', { names: r.notYet.join(', ') }) : undefined }] })
    }

    // ── pets ─────────────────────────────────────────────────────────────────
    case 'pets_due': {
      if (intent.view === 'routine') {
        const list = await R.petRoutine(intent.pet, today)
        if (!list.length) return say('pets', intent.pet ? t('ask.petRoutineNoneFor', { pet: intent.pet }) : t('ask.petRoutineNone'), { view: 'pets' })
        const several = list.length > 1
        const rows: AnswerRow[] = []
        for (const p of list) {
          for (const d of p.daily)
            rows.push({
              emoji: d.done ? '✅' : '🐾',
              title: `${d.time ? `${formatTime(d.time, LOCALE[lang])} · ` : ''}${d.task.title}`,
              sub: [several ? p.pet : '', t('ask.repeat.daily'), d.done ? t('ask.petDoneToday') : ''].filter(Boolean).join(' · '),
            })
          for (const it of p.interval)
            rows.push({
              emoji: '🔁',
              title: it.task.title,
              sub: [
                several ? p.pet : '',
                it.task.interval_days ? everyText(t, it.task.interval_days) : '',
                it.due ? (it.due < today ? t('ask.overdueSince', { day: shortDay(it.due, lang) }) : t('ask.nextDue', { day: shortDay(it.due, lang) })) : t('ask.petNeverDone'),
              ]
                .filter(Boolean)
                .join(' · '),
            })
        }
        const daily = list.reduce((n, p) => n + p.daily.length, 0)
        const interval = list.reduce((n, p) => n + p.interval.length, 0)
        return say('pets', several ? t('ask.petRoutinesHead') : t('ask.petRoutineFor', { pet: list[0].pet }), {
          sub: t('ask.petRoutineCounts', { daily, interval }),
          rows,
          view: 'pets',
        })
      }
      const named = intent.pet.split(',').map((x) => norm(x)).filter(Boolean)
      let mine = petsDue(data, today).filter((r) => !named.length || named.some((n) => norm(r.pet.name).includes(n) || n.includes(norm(r.pet.name))))
      if (intent.view === 'overdue') {
        mine = mine.filter((r) => r.kind !== 'daily' && r.late > 0)
        if (!mine.length) return say('pets', t('casa.ra.petsLateNone'), { view: 'pets' })
      }
      if (!mine.length) return say('pets', t('casa.roof.petsNone'), { view: 'pets' })
      const title = intent.view === 'overdue' ? t('casa.ra.petsLate', { count: mine.length }) : t('casa.roof.petsSome', { count: mine.length })
      return say('pets', title, {
        rows: mine.slice(0, 10).map((r) => ({
          emoji: r.kind === 'daily' ? '🐾' : r.kind === 'interval' ? '🔁' : '🩺',
          title: r.title,
          sub: [r.pet.name, r.late > 0 ? t('casa.ra.daysLate', { count: r.late }) : ''].filter(Boolean).join(' · '),
        })),
        speak: `${title}: ${joinList(mine.slice(0, 5).map((r) => `${r.title} (${r.pet.name})`), lang)}.`,
        view: 'pets',
      })
    }
    case 'pet_done': {
      const r = await R.petTasksDone(intent.pet, intent.tasks, today)
      env.refresh()
      if (!r.done.length) return say('pets', r.needPet ? t('ask.petWhich') : t('ask.petTaskNotFound', { items: intent.tasks.join(', ') }), { view: 'pets' })
      return say('pets', t('casa.roof.petDone', { tasks: joinList(r.done.map((d) => d.task.title.toLowerCase()), lang), pet: joinList([...new Set(r.done.map((d) => d.pet))], lang) }), {
        sub: r.missing.length ? t('ask.notFoundList', { items: r.missing.join(', ') }) : undefined,
        check: true,
        view: 'pets',
        undo: async () => {
          await R.undoPetTasksDone(r.done, today)
          env.refresh()
        },
      })
    }
    case 'pet_log': {
      const r = await R.logPetEvent(intent.pet, intent.type, intent.title || t(`ask.petType.${intent.type}` as TKey), intent.date, intent.next, me.email)
      if (!r.ok) return say('pets', t('ask.petWhich'))
      env.refresh()
      const ev = r.ev
      return say('pets', t('ask.petLogged', { pet: r.pet }), {
        check: true,
        rows: [{ emoji: PET_EMOJI[ev.type] ?? '🐾', title: ev.title, sub: [shortDay(ev.event_date, lang), ev.next_due ? t('ask.nextDue', { day: shortDay(ev.next_due, lang) }) : ''].filter(Boolean).join(' · ') }],
        undo: async () => {
          await R.deletePetEvent(ev.id)
          env.refresh()
        },
        view: 'pets',
      })
    }
    case 'pet_next': {
      const r = await R.petNextDue(intent.pet, intent.type)
      if (!r.rows.length) return say('pets', r.pet ? t('ask.petNextNoneFor', { pet: r.pet }) : t('ask.petNextNone'), { view: 'pets' })
      const o = r.rows[0]
      const head = o.due < today ? t('ask.petNextLate', { title: o.title, pet: o.pet, day: shortDay(o.due, lang) }) : t('ask.petNextHead', { title: o.title, pet: o.pet, day: whenLabel(env, o.due, o.due) })
      return say('pets', head, {
        sub: r.rows.length > 1 ? t('ask.petNextCount', { n: r.rows.length }) : undefined,
        rows: r.rows.slice(0, 8).map((x) => ({
          emoji: x.every ? '🔁' : (PET_EMOJI[x.type] ?? '🐾'),
          title: `${x.title} · ${x.pet}`,
          sub: [
            x.due < today ? t('ask.overdueSince', { day: shortDay(x.due, lang) }) : x.due === today ? t('ask.today') : shortDay(x.due, lang),
            x.every ? everyText(t, x.every) : '',
            t('ask.lastOn', { day: shortDay(x.last, lang) }),
          ]
            .filter(Boolean)
            .join(' · '),
        })),
        view: 'pets',
      })
    }
    case 'pet_weight': {
      const r = await R.logPetWeight(intent.pet, intent.weight, today)
      if (!r.ok) return say('pets', t('ask.petWhich'))
      const diff = r.previous != null ? Math.round((intent.weight - r.previous) * 100) / 100 : null
      return say('pets', t('ask.petWeighed', { pet: r.pet, weight: String(intent.weight) }), {
        sub: diff != null ? t('ask.weightWas', { prev: String(r.previous), diff: `${diff > 0 ? '+' : ''}${diff}` }) : undefined,
        check: true,
        undo: () => R.deletePetWeight(r.id),
        view: 'pets',
      })
    }

    // ── family ───────────────────────────────────────────────────────────────
    case 'family_info': {
      if (!intent.field) return say('family', t('ask.familyWhat'), { view: 'family' })
      const person = R.findMember(intent.person, data.members) ?? data.members.find((m) => m.email === me.email) ?? null
      if (!person) return say('family', t('ask.whoNotFound', { name: intent.person }))
      const row = await R.familyRow(person.email)
      const value = row?.[intent.field]
      const label = t(FIELD_LABEL[intent.field])
      return say('family', value ? `${label} — ${person.first}: ${value}` : t('ask.familyNone', { name: person.first }), { view: 'family' })
    }
    case 'family_update': {
      if (!intent.field) return say('family', t('ask.familyWhat'))
      const person = R.findMember(intent.person, data.members) ?? data.members.find((m) => m.email === me.email) ?? null
      if (!person) return say('family', t('ask.whoNotFound', { name: intent.person }))
      let value = intent.value.trim()
      if (intent.field === 'birthday' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return say('family', t('ask.birthdayFormat'))
      if (intent.field === 'blood_type') value = value.toUpperCase().replace(/\s+/g, '')
      const field = intent.field
      const r = await R.setFamilyField(person.email, field, value)
      if (!r.ok) return say('family', t('ask.familyNoEdit', { name: person.first }))
      env.refresh()
      const label = t(FIELD_LABEL[field])
      return say('family', t('ask.familyUpdated', { name: person.first }), {
        check: true,
        rows: [{ emoji: '👤', title: `${label}: ${value}`, sub: r.previous ? t('ask.wasValue', { value: r.previous }) : undefined }],
        undo: async () => {
          await R.setFamilyField(person.email, field, r.previous)
          env.refresh()
        },
        view: 'family',
      })
    }
    case 'where_is':
    case 'ask_location':
      // A home device can't read where the family is (migration 111): say so
      // instead of "isn't sharing", which was simply wrong.
      return say('family', t('casa.ra.wherePhone'))

    // ── weather, utilities ───────────────────────────────────────────────────
    case 'weather': {
      const w = await R.weatherFor(intent.date, today, lang)
      if (!w.ok) return say('weather', w.reason === 'no_city' ? t('casa.ra.weatherNoCity') : w.reason === 'too_far' ? t('ask.weatherTooFar') : t('ask.error'))
      const day = whenLabel(env, intent.date, intent.date)
      const Day = day.charAt(0).toUpperCase() + day.slice(1)
      const wet = w.kind === 'rain' || w.kind === 'storm' || w.kind === 'drizzle' || w.rain >= 50
      const head = wet ? t('ask.weatherRain', { day: Day, pct: w.rain }) : t('ask.weatherDry', { day: Day, pct: w.rain })
      return say('weather', head, {
        rows: [{ emoji: WEATHER_EMOJI[w.kind], title: `${w.min}${w.unit} – ${w.max}${w.unit}`, sub: `${t(`ask.weather.${w.kind}` as TKey)} · ${w.city}` }],
        speak: `${head} ${w.min}–${w.max}${w.unit}.`,
      })
    }
    case 'better_deal': {
      const { rows, savingPct } = R.compareDeals(intent.deals)
      const best = rows.find((r) => r.best)!
      return say('calc', t('ask.dealBest', { label: best.label || formatMoney(best.price) }), {
        sub: savingPct > 0 ? t('ask.dealSaving', { pct: savingPct }) : t('ask.dealSame'),
        rows: rows.map((r) => ({
          emoji: r.best ? '🏷️' : '•',
          title: r.label || `${formatMoney(r.price)} / ${r.size}`,
          sub: t('ask.dealPerUnit', { price: formatMoney(Math.round(r.perUnit * 1000) / 1000) }),
          strong: r.best,
        })),
      })
    }
    case 'discount': {
      const saved = Math.round(intent.amount * intent.percent) / 100
      const price = Math.round((intent.amount - saved) * 100) / 100
      return say('calc', t('ask.discountHead', { price: formatMoney(price), pct: intent.percent }), { sub: t('ask.youSave', { amount: formatMoney(saved) }) })
    }
    case 'split_bill': {
      // By item is the photo scan — that's on the phone.
      if (intent.mode === 'items') return say('calc', t('casa.ra.splitItemsPhone'))
      if (!(intent.amount > 0) || !(intent.people > 0)) return say('calc', t('casa.ra.splitNeed'))
      const r = R.evenSplit(intent.amount, intent.people, intent.tip)
      return say('calc', t('casa.ra.splitEach', { amount: formatMoney(r.per) }), {
        sub: t('calc.totalFor', { total: formatMoney(r.total), count: Math.max(1, intent.people) }),
        rows: [
          ...(intent.tip > 0 ? [{ emoji: '💁', title: t('ask.withTip', { pct: intent.tip, amount: formatMoney(r.tip) }) }] : []),
          ...(r.extraCentCount > 0 ? [{ emoji: '🪙', title: t('calc.extraCent', { count: r.extraCentCount, amount: formatMoney(r.per + 0.01) }) }] : []),
        ],
      })
    }

    // ── the app itself ───────────────────────────────────────────────────────
    case 'open_app': {
      const map: Record<string, OpenTarget> = { calendar: 'calendar', shopping: 'lists', budget: 'money', pets: 'pets', family: 'family', frame: 'frame' }
      const target = map[intent.app]
      if (target) return { kind: 'open', target }
      if (intent.app === 'games') return say('orb', t('casa.ra.gamesPhone'))
      if (intent.app === 'docs') return say('orb', t('casa.ra.docsPhone'))
      return say('orb', t('casa.roof.phone'))
    }
    case 'app_help':
      // About Roof itself → the capabilities screen, not a paragraph (as on the phone).
      if (intent.topic === 'roof') return { kind: 'caps' }
      if (['games', 'hangman', 'battleship', 'quiz'].includes(intent.topic))
        return say('orb', intent.reply || t('casa.ra.gamesPhone'), { sub: intent.reply ? t('casa.ra.gamesPhone') : undefined })
      return say('orb', intent.reply || t('casa.roof.notSure'))
    case 'undo_last':
      return say('orb', t('casa.roof.nothingToUndo'))

    // ── newer (2026-11-17) ───────────────────────────────────────────────────
    case 'create_list': {
      const hit = data.stores.find((x) => norm(x.name) === norm(intent.name))
      if (hit) return say('lists', t('ask.listExists', { name: hit.name }), { view: 'lists' })
      const made = await R.createStore(intent.name)
      env.refresh()
      return say('lists', t('ask.listCreated', { name: made.name }), {
        check: true,
        view: 'lists',
        undo: async () => {
          await R.undoAdd([], made.id)
          env.refresh()
        },
      })
    }
    case 'edit_item': {
      const item = R.matchLabels([intent.item], data.open).hits[0]
      if (!item) return say('lists', t('ask.notFoundList', { items: intent.item }), { view: 'lists' })
      const relabel = async (label: string) => {
        await supabase.from('shopping_items').update({ label }).eq('id', item.id)
        env.refresh()
      }
      await relabel(intent.label)
      return say('lists', t('ask.itemRenamed', { before: item.label, after: intent.label }), { check: true, view: 'lists', undo: () => relabel(item.label) })
    }
    case 'my_nudges': {
      const list = await R.unseenNudges(me.email)
      const name = me.name.split(' ')[0]
      if (!list.length) return say('nudge', t('casa.ra.nudgesNone', { name }))
      const from = (email: string) => data.members.find((m) => m.email === email)?.first ?? ''
      const title = t('casa.ra.nudgesSome', { name, n: list.length })
      return say('nudge', title, {
        rows: list.slice(0, 6).map((n) => ({ emoji: n.emoji, title: `“${n.message}”`, sub: from(n.from) })),
        speak: `${title} ${list
          .slice(0, 3)
          .map((n) => `${from(n.from)}: ${n.message}`)
          .join('. ')}`,
      })
    }
    case 'free_check': {
      const who = intent.scope === 'person' ? R.findMember(intent.person, data.members) : null
      if (intent.scope === 'person' && !who) return say('family', t('ask.whoNotFound', { name: intent.person }))
      const mins = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))
      const from = intent.from ? mins(intent.from) : 0
      const to = intent.from ? (intent.to && mins(intent.to) > from ? mins(intent.to) : from + 60) : 24 * 60
      // Timed events only: an all-day row (a birthday) doesn't make anyone busy.
      const busy = occurrencesInRange(data.events, intent.date, intent.date)
        .filter((o) => {
          const ev = o.event
          if (ev.all_day || !ev.start_time) return false
          if (who && ev.owner_email && ev.owner_email !== who.email) return false
          const a = mins(ev.start_time)
          const b = ev.end_time && mins(ev.end_time) > a ? mins(ev.end_time) : a + 60
          return a < to && b > from
        })
        .sort(compareOccurrences)
      const day = whenLabel(env, intent.date, intent.date)
      const hm = (m: number) => formatTime(`${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, LOCALE[lang])
      const when = intent.from ? t('ask.freeWindow', { day, from: hm(from), to: hm(to) }) : day
      const rows: AnswerRow[] = busy.slice(0, 6).map((o) => ({
        emoji: KIND_EMOJI[o.event.kind] || '🗓️',
        title: o.event.title,
        sub: [timeOf(o.event, lang), data.members.find((m) => m.email === o.event.owner_email)?.first ?? ''].filter(Boolean).join(' · '),
      }))
      let title: string
      if (intent.scope === 'all') {
        const everyone = busy.some((o) => !o.event.owner_email)
        const free = everyone ? [] : data.members.filter((m) => !busy.some((o) => o.event.owner_email === m.email)).map((m) => m.first)
        title = free.length ? t('ask.freeAll', { when, names: joinList(free, lang) }) : t('ask.freeNobody', { when })
      } else if (who) {
        title = busy.length ? t('ask.freeNo', { name: who.first, n: busy.length, when }) : t('ask.freeYes', { name: who.first, when })
      } else {
        // "Am I free?" — a shared screen doesn't know who is asking: the house's day.
        title = busy.length ? t('casa.ra.freeSome', { n: busy.length, when }) : t('casa.ra.freeNone', { when })
      }
      return say('calendar', title, {
        rows,
        view: 'calendar',
        speak: busy.length && intent.scope !== 'all' ? `${title} ${joinList(busy.slice(0, 4).map((o) => o.event.title), lang)}.` : title,
      })
    }
    case 'pet_who': {
      const pets = intent.pet ? data.pets.filter((p) => intent.pet.split(',').some((n) => norm(n) === norm(p.name))) : data.pets
      const wanted = intent.tasks.map(norm).filter(Boolean)
      const mine = data.tasks.filter(
        (x) => x.kind === 'daily' && pets.some((p) => p.id === x.pet_id) && (!wanted.length || wanted.some((w) => norm(x.title).includes(w) || w.includes(norm(x.title)))),
      )
      if (!mine.length) return say('pets', t('ask.petWhoNoTask'), { view: 'pets' })
      const done = await supabase.from('pet_task_done').select('task_id, done_by').eq('done_on', today).in('task_id', mine.map((x) => x.id))
      const by = new Map(((done.data ?? []) as { task_id: string; done_by: string }[]).map((d) => [d.task_id, d.done_by]))
      const nameOf = (email: string) => data.members.find((m) => m.email === email)?.first ?? email.split('@')[0]
      const petOf = (id: string) => data.pets.find((p) => p.id === id)?.name ?? ''
      if (mine.length === 1) {
        const who = by.get(mine[0].id)
        const vars = { task: mine[0].title, pet: petOf(mine[0].pet_id) }
        return say('pets', who ? t('ask.petWhoOne', { name: nameOf(who), ...vars }) : t('ask.petWhoNone', vars), { view: 'pets' })
      }
      const rows: AnswerRow[] = mine.slice(0, 10).map((x) => ({
        emoji: by.has(x.id) ? '✅' : '⏳',
        title: `${x.title} · ${petOf(x.pet_id)}`,
        sub: by.has(x.id) ? nameOf(by.get(x.id)!) : t('ask.petWhoNotYet'),
      }))
      const title = t('ask.petWhoHead')
      return say('pets', title, { rows, view: 'pets', speak: `${title}: ${rows.slice(0, 5).map((r) => `${r.title}, ${r.sub}`).join('; ')}.` })
    }
    case 'call_member': {
      const person = R.findMember(intent.person, data.members)
      if (!person) return say('family', t('ask.whoNotFound', { name: intent.person }))
      const phone = (await R.familyRow(person.email))?.phone
      return say('family', phone ? t('casa.ra.phoneOf', { name: person.first, phone }) : t('ask.callNoPhone', { name: person.first }), { view: 'family' })
    }
    case 'days_until': {
      const n = Math.round((dateOf(intent.date).getTime() - dateOf(today).getTime()) / 86_400_000)
      const title = intent.title || shortDay(intent.date, lang)
      return say('calendar', n <= 0 ? t('ask.daysToday', { title }) : n === 1 ? t('ask.daysOne', { title }) : t('ask.daysUntil', { n, title, day: shortDay(intent.date, lang) }))
    }
    default:
      return say('orb', t('casa.roof.phone'))
  }
}

/** A one-line account of an outcome, for the conversation history. */
export function summarize(o: Outcome): string {
  if (o.kind === 'done') return [o.title, o.sub ?? '', ...(o.rows ?? []).slice(0, 6).map((r) => [r.title, r.sub].filter(Boolean).join(' '))].filter(Boolean).join('; ').slice(0, 400)
  if (o.kind === 'pick') return o.question
  if (o.kind === 'bye') return o.text
  if (o.kind === 'open') return o.say || `open ${o.target}`
  return 'capabilities'
}
