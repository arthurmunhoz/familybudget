// Roof on the home device: understand (the same endpoint and context as
// mobile/src/lib/assistant.ts → understandWithSource) and carry out a core
// set of intents here, with the device's session (RLS). Anything outside
// that set is answered with "do it on the phone".
import { categoryById } from '../lib/categories'
import { addDays, compareOccurrences, occurrencesInRange, upcomingOccurrences } from '../lib/calendar'
import { formatMoney } from '../lib/format'
import type { TKey } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import type { CategoryOverride, CustomCategory, Entry, ShoppingItem, ShoppingStore } from '../lib/types'
import { petsDue, petTaskDone, deleteItems, restoreItems, setChecked, insertEvent, deleteEvent, type HubData, type Member } from './data'
import { addEntry, deleteEntry, listBudgets, pickBudget } from './money'
import { API_BASE, GRAD, LOCALE, budgetGradient, dateOf, norm } from './util'

type T = (key: TKey, vars?: Record<string, string | number>) => string

export type Tone = 'lists' | 'calendar' | 'pets' | 'money' | 'orb' | 'event'
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
  const f = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ')
  return CLOSE_VERB.test(f) && f.split(/\s+/).filter(Boolean).length <= 6
}

export function localOpen(text: string): OpenTarget | null {
  const f = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ')
  if (!OPEN_VERB.test(f) || CLOSE_VERB.test(f) || f.split(/\s+/).filter(Boolean).length > 7) return null
  for (const [re, target] of OPEN_WHAT) if (re.test(f)) return target
  return null
}

export interface PickOption {
  id: string
  label: string
  color?: string
  avatar?: string | null
  /** A gradient chip instead of an initial (e.g. "everyone", a budget). */
  gradient?: readonly [string, string]
}

export type Outcome =
  | {
      kind: 'done'
      tone: Tone
      title: string
      lines?: string[]
      speak: string
      undo?: () => Promise<void>
      view?: PanelId
      /** A short tick + the ✓ mark; false for plain answers (lists, agenda). */
      check: boolean
    }
  | { kind: 'pick'; question: string; options: PickOption[]; onPick: (id: string) => Promise<Outcome> }
  | { kind: 'open'; target: OpenTarget }
  | { kind: 'pin' }
  | { kind: 'bye'; text: string }

export interface AskEnv {
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

type Raw = Record<string, unknown>

async function buildContext(env: AskEnv, text: string) {
  const { data, today, lang } = env
  const [budgets, custom, overrides, entries] = await Promise.all([
    supabase.from('budgets').select('name'),
    supabase.from('custom_categories').select('*'),
    supabase.from('category_overrides').select('*'),
    supabase.from('entries').select('id, label, amount, type, entry_date, person_email').order('created_at', { ascending: false }).limit(8),
  ])
  const nameOf = (email: string | null) => data.members.find((m) => m.email === email)?.first ?? ''
  const ov = (overrides.data ?? []) as CategoryOverride[]
  const builtin = ['groceries', 'dining', 'transport', 'home', 'utilities', 'health', 'entertainment', 'shopping', 'travel', 'subscriptions', 'gifts', 'pets', 'salary', 'other'].map(
    (id) => `${id} = ${categoryById(id, [], ov).name}`,
  )
  const occ = upcomingOccurrences(data.events, addDays(today, -3), 45).slice(0, 40)
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
    petTasks: data.pets
      .map((p) => {
        const mine = data.tasks.filter((x) => x.pet_id === p.id).map((x) => x.title)
        return mine.length ? `${p.name}: ${mine.join(', ')}` : ''
      })
      .filter(Boolean),
    categories: [...builtin, ...((custom.data ?? []) as CustomCategory[]).map((c) => `${c.id} = ${c.name}`)],
    openItems: data.open.map((i) => `${i.label} @ ${storeName(i.store_id)}`),
    recentEntries: ((entries.data ?? []) as Entry[]).map(
      (x, i) => `e${i + 1} = ${x.label} · ${Number(x.amount).toFixed(2)} · ${x.type} · ${x.entry_date} · ${nameOf(x.person_email)}`,
    ),
    events: occ.map(
      (o, i) => `v${i + 1} = ${o.event.title} · ${o.start}${o.event.start_time ? ` ${o.event.start_time.slice(0, 5)}` : ''}${o.event.owner_email ? ` · ${nameOf(o.event.owner_email)}` : ''}`,
    ),
    documents: [] as string[],
    me: env.me.name,
    history: env.history.slice(-4),
  }
}

export type Understood = { ok: true; raw: Raw } | { ok: false; reason: 'offline' | 'limit' }

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
    const j = (await res.json().catch(() => null)) as Raw | null
    if (!j || typeof j.intent !== 'string') return { ok: false, reason: 'offline' }
    return { ok: true, raw: j }
  } catch {
    return { ok: false, reason: 'offline' }
  }
}

// ── doing ────────────────────────────────────────────────────────────────────

const ISO = /^\d{4}-\d{2}-\d{2}$/

function joinList(words: string[], lang: string): string {
  try {
    return new Intl.ListFormat(LOCALE[lang as 'pt'] ?? 'pt-BR', { type: 'conjunction' }).format(words)
  } catch {
    return words.join(', ')
  }
}

function matchStore(name: string, stores: ShoppingStore[]): ShoppingStore | null {
  const n = norm(name)
  if (!n) return null
  return stores.find((s) => norm(s.name) === n) ?? stores.find((s) => norm(s.name).includes(n) || n.includes(norm(s.name))) ?? null
}

const GENERIC = /^(mercado|lista|list|compras|shopping|groceries|geral|general|anywhere|qualquer|todas?|all)$/

function matchItems(said: string[], pool: ShoppingItem[]): { hits: ShoppingItem[]; missing: string[] } {
  const hits: ShoppingItem[] = []
  const missing: string[] = []
  for (const w of said) {
    const k = norm(w)
    const hit =
      pool.find((i) => norm(i.label) === k && !hits.includes(i)) ??
      pool.find((i) => (norm(i.label).includes(k) || k.includes(norm(i.label))) && !hits.includes(i))
    if (hit) hits.push(hit)
    else missing.push(w)
  }
  return { hits, missing }
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

function findMember(members: Member[], said: string): Member | null {
  const n = norm(said)
  if (!n) return null
  return members.find((m) => norm(m.first) === n || norm(m.name) === n) ?? members.find((m) => norm(m.name).includes(n)) ?? null
}

const phone = (t: T): Outcome => ({ kind: 'done', tone: 'orb', title: t('casa.roof.phone'), speak: t('casa.roof.phone'), check: false })

/** Carry out what the server understood. */
export async function act(env: AskEnv, raw: Raw, full: boolean): Promise<Outcome> {
  const { t, data, today, lang } = env
  const str = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string).trim() : '')
  const items = Array.isArray(raw.items) ? (raw.items as unknown[]).filter((x): x is string => typeof x === 'string' && !!x.trim()) : []
  const date = ISO.test(str('date')) ? str('date') : today
  const general = t('casa.list.general')
  const writes = new Set(['add_items', 'check_items', 'remove_items', 'clear_checked', 'add_event', 'add_money', 'pet_done'])
  if (!full && writes.has(String(raw.intent))) return { kind: 'done', tone: 'orb', title: t('casa.plan.lockedAction'), speak: t('casa.plan.lockedAction'), check: false }

  switch (raw.intent) {
    case 'add_items': {
      if (!items.length) return phone(t)
      const said = str('store')
      let store = said && !GENERIC.test(norm(said)) ? matchStore(said, data.stores) : null
      let created: string | null = null
      if (said && !GENERIC.test(norm(said)) && !store) {
        const { data: s } = await supabase.from('shopping_stores').insert({ name: said, slug: null }).select('*').single()
        store = (s as ShoppingStore | null) ?? null
        created = store?.id ?? null
      }
      const open = data.open.filter((i) => i.store_id === (store?.id ?? null))
      const have = new Set(open.map((i) => norm(i.label)))
      const fresh = items.filter((x, i) => !have.has(norm(x)) && items.findIndex((y) => norm(y) === norm(x)) === i)
      const existing = items.filter((x) => have.has(norm(x)))
      let ids: string[] = []
      if (fresh.length) {
        const { data: rows, error } = await supabase
          .from('shopping_items')
          .insert(fresh.map((label) => ({ label, added_by: env.me.email, store_id: store?.id ?? null })))
          .select('id')
        if (error) throw error
        ids = ((rows ?? []) as { id: string }[]).map((r) => r.id)
      }
      env.refresh()
      const list = store?.name ?? general
      const title = fresh.length
        ? t('casa.roof.added', { items: joinList(fresh, lang), list })
        : t('casa.roof.alreadyThere', { items: joinList(existing, lang) })
      return {
        kind: 'done',
        tone: 'lists',
        title,
        lines: fresh.length && existing.length ? [t('casa.roof.alreadyThere', { items: joinList(existing, lang) })] : undefined,
        speak: title,
        check: fresh.length > 0,
        view: 'lists',
        undo: ids.length
          ? async () => {
              await deleteItems(ids)
              if (created) await supabase.from('shopping_stores').delete().eq('id', created)
              env.refresh()
            }
          : undefined,
      }
    }
    case 'list_items': {
      const store = str('store') && !GENERIC.test(norm(str('store'))) ? matchStore(str('store'), data.stores) : null
      const open = store ? data.open.filter((i) => i.store_id === store.id) : data.open
      const name = store?.name ?? ''
      if (!open.length) {
        const title = name ? t('casa.roof.listEmptyNamed', { list: name }) : t('casa.roof.listEmpty')
        return { kind: 'done', tone: 'lists', title, speak: title, check: false, view: 'lists' }
      }
      const title = t('casa.roof.listHas', { count: open.length })
      const labels = open.slice(0, 12).map((i) => i.label)
      return {
        kind: 'done',
        tone: 'lists',
        title,
        lines: [joinList(labels, lang)],
        speak: `${title}: ${joinList(labels, lang)}.`,
        check: false,
        view: 'lists',
      }
    }
    case 'check_items': {
      const { hits, missing } = matchItems(items, data.open)
      if (!hits.length) {
        const title = t('casa.roof.notFound', { items: joinList(items, lang) })
        return { kind: 'done', tone: 'lists', title, speak: title, check: false, view: 'lists' }
      }
      await setChecked(hits.map((i) => i.id), true)
      env.refresh()
      const title = t('casa.roof.checked', { items: joinList(hits.map((i) => i.label), lang) })
      return {
        kind: 'done',
        tone: 'lists',
        title,
        lines: missing.length ? [t('casa.roof.notFound', { items: joinList(missing, lang) })] : undefined,
        speak: title,
        check: true,
        view: 'lists',
        undo: async () => {
          await setChecked(hits.map((i) => i.id), false)
          env.refresh()
        },
      }
    }
    case 'remove_items': {
      const { hits, missing } = matchItems(items, [...data.open, ...data.checked])
      if (!hits.length) {
        const title = t('casa.roof.notFound', { items: joinList(items, lang) })
        return { kind: 'done', tone: 'lists', title, speak: title, check: false, view: 'lists' }
      }
      await deleteItems(hits.map((i) => i.id))
      env.refresh()
      const title = t('casa.roof.removed', { items: joinList(hits.map((i) => i.label), lang) })
      return {
        kind: 'done',
        tone: 'lists',
        title,
        lines: missing.length ? [t('casa.roof.notFound', { items: joinList(missing, lang) })] : undefined,
        speak: title,
        check: true,
        view: 'lists',
        undo: async () => {
          await restoreItems(hits)
          env.refresh()
        },
      }
    }
    case 'clear_checked': {
      const store = str('store') ? matchStore(str('store'), data.stores) : null
      const { data: rows } = await supabase.from('shopping_items').select('*').eq('checked', true)
      const all = ((rows ?? []) as ShoppingItem[]).filter((i) => !store || i.store_id === store.id)
      if (!all.length) {
        const title = t('casa.roof.nothingChecked')
        return { kind: 'done', tone: 'lists', title, speak: title, check: false, view: 'lists' }
      }
      await deleteItems(all.map((i) => i.id))
      env.refresh()
      const title = t('casa.roof.cleared', { count: all.length })
      return {
        kind: 'done',
        tone: 'lists',
        title,
        speak: title,
        check: true,
        view: 'lists',
        undo: async () => {
          await restoreItems(all)
          env.refresh()
        },
      }
    }
    case 'agenda':
    case 'day_summary': {
      const end = ISO.test(str('end')) && str('end') >= date ? str('end') : date
      const scope = str('scope')
      const who = scope === 'person' ? findMember(data.members, str('person')) : null
      const occ = occurrencesInRange(data.events, date, end)
        .filter((o) => !who || !o.event.owner_email || o.event.owner_email === who.email)
        .sort((a, b) => (a.start !== b.start ? (a.start < b.start ? -1 : 1) : compareOccurrences(a, b)))
      const when = whenLabel(env, date, end)
      const loc = LOCALE[lang]
      if (!occ.length) {
        const title = t('casa.roof.agendaNone', { when })
        return { kind: 'done', tone: 'calendar', title, speak: title, check: false, view: 'calendar' }
      }
      const lines = occ.slice(0, 8).map((o) => {
        const time = o.event.start_time ? o.event.start_time.slice(0, 5) : t('casa.cal.allDay')
        const day = date !== end ? `${dateOf(o.start).toLocaleDateString(loc, { weekday: 'short', day: 'numeric' })} · ` : ''
        return `${day}${time} — ${o.event.title}`
      })
      const title = t('casa.roof.agendaSome', { count: occ.length, when })
      return {
        kind: 'done',
        tone: 'calendar',
        title,
        lines,
        speak: `${title}: ${joinList(occ.slice(0, 5).map((o) => o.event.title), lang)}.`,
        check: false,
        view: 'calendar',
      }
    }
    case 'add_event': {
      const title = str('title')
      if (!title) return phone(t)
      const time = /^\d{2}:\d{2}$/.test(str('time')) ? str('time') : ''
      const save = async (owner: string | null): Promise<Outcome> => {
        const ev = await insertEvent({ title, date, time, owner })
        env.refresh()
        const when = whenLabel(env, date, date)
        const sentence = t('casa.roof.eventAdded', { title, when: time ? `${when}, ${time}` : when })
        return {
          kind: 'done',
          tone: 'event',
          title: sentence,
          speak: sentence,
          check: true,
          view: 'calendar',
          undo: async () => {
            await deleteEvent(ev.id)
            env.refresh()
          },
        }
      }
      const who = findMember(data.members, str('person'))
      if (who) return save(who.email)
      if (data.members.length <= 1) return save(data.members[0]?.email ?? null)
      return {
        kind: 'pick',
        question: t('casa.who.title'),
        options: memberOptions(data.members, t('casa.who.everyone')),
        onPick: (id) => save(id === '*' ? null : id),
      }
    }
    case 'add_money': {
      const amount = typeof raw.amount === 'number' ? raw.amount : 0
      if (!(amount > 0)) return phone(t)
      const type = str('money_type') === 'income' ? 'income' : 'expense'
      const label = str('title')
      const budgets = await listBudgets()
      if (!budgets.length) return { kind: 'done', tone: 'money', title: t('casa.roof.noBudget'), speak: t('casa.roof.noBudget'), check: false }
      const write = async (budgetId: string, person: string): Promise<Outcome> => {
        const budget = budgets.find((b) => b.id === budgetId)!
        const made = await addEntry({ budget, type, amount, label, person, date })
        const name = data.members.find((m) => m.email === person)?.first ?? ''
        const money = formatMoney(amount)
        const sentence =
          type === 'income'
            ? t('casa.roof.incomeAdded', { amount: money, name })
            : t('casa.roof.moneyAdded', { amount: money, title: label || t('casa.money.expense'), name })
        return {
          kind: 'done',
          tone: 'money',
          title: sentence,
          lines: [budget.name],
          speak: sentence,
          check: true,
          undo: async () => deleteEntry(made.id, made.createdMonth),
        }
      }
      const askWho = (budgetId: string): Outcome => {
        const named = findMember(data.members, str('person'))
        if (named) return { kind: 'pick', question: t('casa.who.title'), options: memberOptions([named]), onPick: (p) => write(budgetId, p) }
        return { kind: 'pick', question: t('casa.who.title'), options: memberOptions(data.members), onPick: (p) => write(budgetId, p) }
      }
      const budget = pickBudget(budgets, str('budget'))
      const named = findMember(data.members, str('person'))
      if (budget && named) return write(budget.id, named.email)
      if (budget) return askWho(budget.id)
      return {
        kind: 'pick',
        question: t('casa.roof.whichBudget'),
        options: budgets.map((b) => ({ id: b.id, label: b.name, gradient: budgetGradient(b.id) })),
        onPick: async (id) => (named ? write(id, named.email) : askWho(id)),
      }
    }
    case 'money_summary':
    case 'list_money':
      return { kind: 'pin' }
    case 'pets_due': {
      const rows = petsDue(data, today)
      const n = norm(str('pet'))
      const mine = n ? rows.filter((r) => norm(r.pet.name).includes(n) || n.includes(norm(r.pet.name))) : rows
      if (!mine.length) {
        const title = t('casa.roof.petsNone')
        return { kind: 'done', tone: 'pets', title, speak: title, check: false, view: 'pets' }
      }
      const title = t('casa.roof.petsSome', { count: mine.length })
      const lines = mine.slice(0, 8).map((r) => `${r.pet.name} — ${r.title}`)
      return { kind: 'done', tone: 'pets', title, lines, speak: `${title}: ${joinList(lines.slice(0, 5), lang)}.`, check: false, view: 'pets' }
    }
    case 'pet_done': {
      const n = norm(str('pet'))
      const pet = n ? (data.pets.find((p) => norm(p.name) === n) ?? data.pets.find((p) => norm(p.name).startsWith(n) || n.startsWith(norm(p.name)))) : null
      const done: { id: string; title: string; pet: string }[] = []
      for (const said of items) {
        const k = norm(said)
        const pool = data.tasks.filter((x) => !pet || x.pet_id === pet.id)
        let hits = pool.filter((x) => norm(x.title) === k)
        if (!hits.length) hits = pool.filter((x) => norm(x.title).includes(k) || k.includes(norm(x.title)))
        if (!hits.length || (!pet && new Set(hits.map((h) => h.pet_id)).size > 1)) continue
        await petTaskDone(hits[0].id, today, true)
        done.push({ id: hits[0].id, title: hits[0].title, pet: data.pets.find((p) => p.id === hits[0].pet_id)?.name ?? '' })
      }
      env.refresh()
      if (!done.length) {
        const title = t('casa.roof.petNotFound')
        return { kind: 'done', tone: 'pets', title, speak: title, check: false, view: 'pets' }
      }
      const title = t('casa.roof.petDone', { tasks: joinList(done.map((d) => d.title.toLowerCase()), lang), pet: done[0].pet })
      return {
        kind: 'done',
        tone: 'pets',
        title,
        speak: title,
        check: true,
        view: 'pets',
        undo: async () => {
          for (const d of done) await petTaskDone(d.id, today, false)
          env.refresh()
        },
      }
    }
    case 'open_app': {
      const map: Record<string, OpenTarget> = { calendar: 'calendar', shopping: 'lists', budget: 'money', pets: 'pets', family: 'family', frame: 'frame', calc: 'frame' }
      const target = map[str('app')]
      return target ? { kind: 'open', target } : phone(t)
    }
    case 'app_help':
    case 'unknown':
    case 'find_items': {
      const reply = str('reply') || t('casa.roof.notSure')
      return { kind: 'done', tone: 'orb', title: reply, speak: reply, check: false }
    }
    default:
      return phone(t)
  }
}

/** A one-line account of an outcome, for the conversation history. */
export function summarize(o: Outcome): string {
  if (o.kind === 'done') return [o.title, ...(o.lines ?? [])].join(' ').slice(0, 200)
  if (o.kind === 'pick') return o.question
  if (o.kind === 'bye') return o.text
  if (o.kind === 'open') return `open ${o.target}`
  return 'PIN'
}
