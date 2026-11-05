// The Home's "ask anything" sheet (2026-11 Comando redesign). One question,
// one answer: you type a request ("milk and bread on the Walmart list", "what's
// on today for me?"), it's understood by lib/assistant (server parse, local
// fallback) and CARRIED OUT here with your own session — then shown as a card
// you can act on (Undo / Open list, Just me ↔ Everyone / Open in Calendar).
// Each new question replaces the last answer; there's no chat history on
// purpose — this is a remote control for the house, not a chatbot.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Modal,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'
import { router } from 'expo-router'
import { ArrowUp, CalendarDays, ChevronRight, Mic, PawPrint, RotateCcw, Sparkles, Square } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import StoreLogo from '@/apps/shopping/StoreLogo'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/hooks/useI18n'
import { useToday } from '@/hooks/useToday'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useSheetLift } from '@/hooks/useSheetLift'
import { useScreenCorner } from '@/hooks/useScreenCorner'
import { invalidateCache } from '@/hooks/useCachedQuery'
import { supabase } from '@/lib/supabase'
import { formatTime, memberColor } from '@/lib/calendar'
import {
  addEvent,
  addItems,
  addMoney,
  agendaFor,
  checkItems,
  createStore,
  deleteEntry,
  deleteEvent,
  familyInfo,
  fetchStores,
  findItems,
  findMember,
  openItemsContext,
  listItems,
  matchStore,
  moneySummary,
  petsDue,
  type PetsAnswer,
  removeItems,
  restoreItems,
  uncheckItems,
  undoAdd,
  understand,
  type FamilyField,
  type Found,
  type Intent,
  type ListGroup,
  type MoneyLine,
  type MoneyResult,
  type AddResult,
  type AgendaAnswer,
  type AgendaRow,
  type Scope,
} from '@/lib/assistant'
import type { TKey } from '@/lib/i18n'
import { useVoice, voiceSupported } from '@/lib/voice'
import { fonts, radius, sheetRadius, sp, useTheme } from '@/theme/theme'
import {
  ChooseStoreView,
  DiscountView,
  EventView,
  FamilyView,
  FoundView,
  Headline,
  ListView,
  MarkedView,
  MoneyView,
  NudgeView,
  Orb,
  PetsView,
  SplitView,
  SummaryView,
} from './AnswerViews'
import { GradientBox } from './GradientBox'
import { sendPing } from '@/lib/pings'
import { usePlus } from '@/lib/plus'
import { categoryById } from '@/lib/categories'
import { formatMoney, periodLabel } from '@/lib/format'
import type { CalendarEvent, Profile, ShoppingItem, ShoppingStore } from '@/lib/types'

const FIELD_LABEL: Record<FamilyField, TKey> = {
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

/** open_app → route (the server's app ids). */
const APP_ROUTE: Record<string, string> = {
  calendar: '/calendar',
  shopping: '/shopping',
  budget: '/budget',
  pets: '/pets',
  pings: '/pings',
  location: '/location',
  family: '/family',
  docs: '/docs',
  calc: '/calc',
  settings: '/settings',
}

const LOCALE: Record<string, string> = { en: 'en-US', es: 'es', pt: 'pt-BR' }

type Answer =
  | { kind: 'added'; res: AddResult; undone: boolean }
  | { kind: 'agenda'; a: AgendaAnswer }
  | { kind: 'chooseStore'; items: string[]; stores: ShoppingStore[]; suggested: string }
  | { kind: 'list'; groups: ListGroup[]; store: ShoppingStore | null }
  | { kind: 'found'; found: Found[]; reply: string }
  | { kind: 'marked'; mode: 'check' | 'remove'; hits: ShoppingItem[]; missing: string[]; undone: boolean }
  | { kind: 'event'; ev: CalendarEvent; who: string | null; undone: boolean }
  | { kind: 'money'; res: Extract<MoneyResult, { ok: true }>; type: 'expense' | 'income'; amount: number; title: string; undone: boolean }
  | { kind: 'summary'; lines: MoneyLine[] }
  | { kind: 'nudge'; message: string; to: Profile | null; sent: boolean; sending: boolean }
  | { kind: 'pets'; p: PetsAnswer }
  | { kind: 'family'; text: string }
  | { kind: 'say'; text: string }
  | { kind: 'split'; amount: number; people: number; tip: number; mode: 'choose' | 'even' }
  | { kind: 'discount'; amount: number; percent: number }
  | { kind: 'unknown'; text: string }
  | { kind: 'error' }

export function AskSheet({
  visible,
  onClose,
  seed,
  listen = false,
}: {
  visible: boolean
  onClose: () => void
  seed?: string
  /** Opened from the Home's mic: start listening right away. */
  listen?: boolean
}) {
  const { c } = useTheme()
  const { t, lang } = useI18n()
  const { profile, profiles } = useAuth()
  const { isFree } = usePlus()
  const today = useToday()
  const locale = LOCALE[lang] ?? 'en-US'
  const { lift, room, clearOfBars, onRootLayout, kb } = useSheetLift()
  const corner = useScreenCorner()
  const floatingOnKeyboard = kb > 0
  // The input's outer bottom corners follow the sheet's curve (concentric:
  // sheet radius − the content's inset), so the field doesn't poke into it.
  const innerCurve = corner && !floatingOnKeyboard ? corner.radius - sp.md : 18
  const bottomGap = useBottomGap(sp.md)

  // Fresh state per open: the Hub remounts this sheet (new key) each time.
  const [text, setText] = useState(seed ?? '')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<Answer | null>(null)
  // The conversation so far (owner, 2026-11): each finished turn stays on
  // screen as the question + a one-line account of the answer, and the same
  // lines go to Claude as context — so "o que tem no Walmart?" → "tira o
  // leite" works. Kept in a ref too: submit() reads it right after a commit.
  const [past, setPast] = useState<{ q: string; a: string }[]>([])
  const pastRef = useRef<{ q: string; a: string }[]>([])
  const inputRef = useRef<TextInput>(null)
  const scrollRef = useRef<ScrollView>(null)
  // The recogniser's callback is created before submit() exists; it reaches
  // the latest one through this ref (refreshed after every render).
  const submitRef = useRef<((q?: string) => Promise<void>) | null>(null)
  // Voice: speak, watch the words appear, and the final transcript is sent.
  const canVoice = voiceSupported()
  // The household's own words, handed to the recogniser as hints.
  const [hints, setHints] = useState<string[]>([])
  useEffect(() => {
    let alive = true
    void (async () => {
      const [stores, pets] = await Promise.all([fetchStores(), supabase.from('pets').select('name')])
      const { labels } = await openItemsContext(stores)
      if (!alive) return
      setHints([
        ...stores.map((x) => x.name),
        ...profiles.map((p) => p.display_name.split(' ')[0]),
        ...((pets.data ?? []) as { name: string }[]).map((p) => p.name),
        ...labels,
      ])
    })()
    return () => {
      alive = false
    }
  }, [profiles])
  const voice = useVoice(
    lang,
    (heard) => {
      void submitRef.current?.(heard)
    },
    hints,
  )
  // Every way out of the sheet (backdrop, back gesture, an answer's "Open …"
  // button) goes through here, so a dismissal mid-listen stops the recogniser
  // and plays the stop chime instead of cutting off silently.
  const cancelVoice = voice.cancel
  const closeSheet = useCallback(() => {
    cancelVoice()
    onClose()
  }, [cancelVoice, onClose])
  // `starting` counts as hearing for the layout (stop button, no answer), but
  // the label says "one moment" until the mic is live and the chime plays.
  const hearing = voice.state === 'listening' || voice.state === 'starting'
  const warming = voice.state === 'starting'
  // Opened from the Home's mic: listen straight away — but only once the sheet
  // has finished presenting (Modal onShow). Starting the recogniser during the
  // slide-in lost the audio-session activation on device, so the owner had to
  // tap the mic a second time (2026-11). A fallback timer covers a missed
  // onShow; `autoStarted` keeps it to one start.
  const autoStarted = useRef(false)
  const startVoice = voice.start
  const autoListen = useCallback(() => {
    if (!listen || !canVoice || autoStarted.current) return
    autoStarted.current = true
    void startVoice()
  }, [listen, canVoice, startVoice])
  useEffect(() => {
    if (!listen) return
    const id = setTimeout(autoListen, 700)
    return () => clearTimeout(id)
  }, [listen, autoListen])

  const memberEmails = useMemo(() => profiles.map((p) => p.email), [profiles])

  const dayWords = useCallback(
    (iso: string) => {
      if (iso === today) return t('ask.today')
      const [y, m, d] = iso.split('-').map(Number)
      const dt = new Date(y, m - 1, d)
      const tmr = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)) + 1)
      if (dt.toDateString() === tmr.toDateString()) return t('ask.tomorrow')
      return t('ask.onDay', { day: dt.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'short' }) })
    },
    [today, t, locale],
  )

  /** One line for a finished answer — shown above the next question, and sent
   *  to Claude as what the app said. */
  function summarize(a: Answer): string {
    const list = (xs: string[]) => xs.slice(0, 12).join(', ')
    const undone = (base: string, u: boolean) => (u ? `${base} ${t('ask.sumUndone')}` : base)
    switch (a.kind) {
      case 'added':
        return undone(
          a.res.added.length
            ? t('ask.sumAdded', { store: a.res.store?.name ?? t('ask.anyStore'), items: list(a.res.added.map((i) => i.label)) })
            : t('ask.alreadyAll'),
          a.undone,
        )
      case 'chooseStore':
        return t('ask.sumWhichList', { items: list(a.items) })
      case 'list':
        return a.groups.length
          ? a.groups
              .map((g) => t('ask.sumList', { store: g.store?.name ?? t('ask.anyStore'), items: list(g.items.map((i) => i.label)) }))
              .join(' ')
          : t('ask.listEmpty')
      case 'found':
        return a.reply || (a.found.length ? list(a.found.map((f) => `${f.label}${f.store ? ` (${f.store.name})` : ''}`)) : t('ask.nothingMatched'))
      case 'marked':
        return undone(
          a.hits.length
            ? `${t(a.mode === 'check' ? 'ask.checkedN' : 'ask.removedN', { n: a.hits.length })} ${list(a.hits.map((i) => i.label))}`
            : t('ask.nothingMatched'),
          a.undone,
        )
      case 'agenda': {
        const when = a.a.label || dayWords(a.a.date)
        const rows = a.a.rows
        return rows.length
          ? t('ask.sumAgenda', { when, items: list(rows.map((r) => (r.start ? `${r.title} ${r.start}` : r.title))) })
          : t('ask.sumAgendaNone', { when })
      }
      case 'event':
        return undone(t('ask.sumEvent', { title: a.ev.title, when: whenLabel(a.ev) }), a.undone)
      case 'money':
        return undone(t('ask.sumMoney', { title: a.title, amount: formatMoney(a.amount) }), a.undone)
      case 'summary':
        return a.lines
          .map((l) => t('ask.sumMoneyLine', { budget: l.budget.name, income: formatMoney(l.income), spent: formatMoney(l.spent) }))
          .join('; ')
      case 'nudge':
        return t('ask.sumNudge', { to: a.to?.display_name.split(' ')[0] ?? t('ask.everyoneLower'), message: a.message })
      case 'pets': {
        const { rows, pet, routineDone, routineTotal } = a.p
        const progress = pet && routineTotal ? ` ${t('ask.petProgress', { done: routineDone, total: routineTotal })}` : ''
        return rows.length
          ? `${pet ? `${pet}: ` : ''}${list(rows.map((r) => `${r.title}${pet || !r.pet ? '' : ` (${r.pet})`}`))}.${progress}`
          : `${pet ? t('ask.petsNoneFor', { pet }) : t('ask.petsNone')}${progress}`
      }
      case 'split':
        return t('ask.sumSplit', { amount: formatMoney(a.amount), people: a.people })
      case 'discount':
        return t('ask.sumDiscount', { amount: formatMoney(a.amount), pct: a.percent })
      case 'family':
      case 'say':
      case 'unknown':
        return a.text
      case 'error':
        return t('ask.error')
    }
  }

  /** Move the finished question + answer into the conversation above. */
  function commitTurn() {
    if (query && answer) {
      pastRef.current = [...pastRef.current, { q: query, a: summarize(answer) }].slice(-8)
      setPast(pastRef.current)
    }
    setQuery('')
    setAnswer(null)
  }

  function newChat() {
    pastRef.current = []
    setPast([])
    setQuery('')
    setAnswer(null)
  }

  async function submit(raw?: string) {
    const q = (raw ?? text).trim()
    if (!q || busy) return
    Keyboard.dismiss()
    commitTurn()
    setQuery(q)
    setText('')
    setAnswer(null)
    setBusy(true)
    try {
      const [stores, budgetRows, petRows] = await Promise.all([
        fetchStores(),
        supabase.from('budgets').select('name'),
        supabase.from('pets').select('name'),
      ])
      const open = await openItemsContext(stores)
      const [y, m, d] = today.split('-').map(Number)
      const intent = await understand(q, {
        openItems: open.lines,
        today,
        weekday: new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long' }),
        lang,
        stores: stores.map((s) => s.name),
        members: profiles.map((p) => p.display_name),
        budgets: ((budgetRows.data ?? []) as { name: string }[]).map((b) => b.name),
        pets: ((petRows.data ?? []) as { name: string }[]).map((p) => p.name),
        me: profile?.display_name ?? '',
        history: pastRef.current,
      })
      setAnswer(await act(intent, stores))
    } catch {
      setAnswer({ kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    submitRef.current = submit
  })

  /** Carry one understood request out and say what happened. */
  async function act(intent: Intent | null, stores: ShoppingStore[]): Promise<Answer> {
    const me = profile ?? null
    switch (intent?.intent) {
      case undefined:
        return { kind: 'say', text: t('ask.unknown') }
      case 'unknown':
        return { kind: 'say', text: intent.reply || t('ask.unknown') }
      case 'add_items': {
        // A store that exists → straight in. Otherwise ASK (never invent a
        // list from a word like "compras"), offering to create a named one.
        const store = matchStore(intent.store, stores)
        if (store || (!intent.store && stores.length === 0)) {
          const res = await addItems(intent.items, store, me?.email ?? '')
          invalidateCache('hub:shopping')
          return { kind: 'added', res, undone: false }
        }
        return { kind: 'chooseStore', items: intent.items, stores, suggested: intent.store }
      }
      case 'list_items': {
        const r = await listItems(intent.store)
        return { kind: 'list', groups: r.groups, store: r.store }
      }
      case 'find_items':
        return { kind: 'found', found: intent.items.length ? await findItems(intent.items) : [], reply: intent.reply }
      case 'check_items':
      case 'remove_items': {
        const r = intent.intent === 'check_items' ? await checkItems(intent.items) : await removeItems(intent.items)
        invalidateCache('hub:shopping')
        return { kind: 'marked', mode: intent.intent === 'check_items' ? 'check' : 'remove', hits: r.hits, missing: r.missing, undone: false }
      }
      case 'agenda':
        return { kind: 'agenda', a: await agendaFor(intent.date, intent.end, intent.label, intent.scope, intent.person, me, profiles, today) }
      case 'add_event': {
        const owner = (intent.person && findMember(intent.person, profiles)) || me
        const ev = await addEvent(intent.title, intent.date, intent.time, owner)
        invalidateCache('hub:today')
        return { kind: 'event', ev, who: owner && owner.email !== me?.email ? owner.display_name : null, undone: false }
      }
      case 'add_money': {
        const res = await addMoney(intent.title, intent.amount, intent.type, intent.date, intent.budget, me?.email ?? '')
        if (!res.ok) {
          return {
            kind: 'say',
            text: res.reason === 'no_budget' ? t('ask.noBudget') : t('ask.noPeriod', { budget: res.budget?.name ?? '' }),
          }
        }
        return { kind: 'money', res, type: intent.type, amount: intent.amount, title: intent.title, undone: false }
      }
      case 'money_summary':
        return { kind: 'summary', lines: await moneySummary(intent.budget, today) }
      case 'send_nudge': {
        const to = intent.person ? findMember(intent.person, profiles) : null
        return { kind: 'nudge', message: intent.message, to, sent: false, sending: false }
      }
      case 'pets_due': {
        return { kind: 'pets', p: await petsDue(today, intent.pet) }
      }
      case 'family_info': {
        if (!intent.field) return { kind: 'family', text: t('ask.familyWhat') }
        const { person, row } = await familyInfo(intent.person, me, profiles)
        const name = person?.display_name.split(' ')[0] ?? ''
        const value = row?.[intent.field]
        const label = t(FIELD_LABEL[intent.field])
        return {
          kind: 'family',
          text: value ? `${label} — ${name}: ${value}` : t('ask.familyNone', { name }),
        }
      }
      case 'split_bill': {
        if (intent.mode === 'items') {
          openItemSplit()
          return { kind: 'say', text: '' }
        }
        // Equally but missing the total or the head count: the wizard asks.
        if (intent.mode === 'even' && (!(intent.amount > 0) || !(intent.people > 0))) {
          openEvenSplit(intent.amount, intent.people, intent.tip)
          return { kind: 'say', text: '' }
        }
        return {
          kind: 'split',
          amount: intent.amount,
          people: intent.people,
          tip: intent.tip,
          mode: intent.mode === 'even' ? 'even' : 'choose',
        }
      }
      case 'discount':
        return { kind: 'discount', amount: intent.amount, percent: intent.percent }
      case 'open_app': {
        const route = APP_ROUTE[intent.app]
        if (route) {
          closeSheet()
          router.push(route as never)
        }
        return { kind: 'say', text: '' }
      }
    }
  }

  async function rescope(a: AgendaAnswer, scope: Scope) {
    try {
      setAnswer({ kind: 'agenda', a: await agendaFor(a.date, a.end, a.label, scope, '', profile ?? null, profiles, today) })
    } catch {
      setAnswer({ kind: 'error' })
    }
  }

  async function undo(res: AddResult) {
    try {
      await undoAdd(res.added.map((i) => i.id), res.createdStore ? res.store?.id : undefined)
      invalidateCache('hub:shopping')
      setAnswer({ kind: 'added', res, undone: true })
    } catch {
      setAnswer({ kind: 'error' })
    }
  }

  function go(path: string) {
    closeSheet()
    router.push(path as never)
  }

  /** The even-split wizard, prefilled with whatever was said (it opens on the
   *  summary when the total and head count are both known). */
  function openEvenSplit(amount: number, people: number, tip: number) {
    const q = [amount > 0 ? `bill=${amount}` : '', people > 0 ? `people=${people}` : '', tip > 0 ? `tip=${tip}` : '']
      .filter(Boolean)
      .join('&')
    go(`/calc/even${q ? `?${q}` : ''}`)
  }

  /** By item is the photo-scan flow — a One Roof Plus feature. */
  function openItemSplit() {
    if (isFree) {
      Alert.alert(t('calc.plusByItem'), undefined, [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('settings.getPlus'), onPress: () => go('/paywall') },
      ])
      return
    }
    go('/calc/items')
  }

  async function storeChosen(items: string[], store: ShoppingStore | null, createName?: string) {
    setBusy(true)
    try {
      const target = createName ? await createStore(createName) : store
      const res = await addItems(items, target, profile?.email ?? '', !!createName)
      invalidateCache('hub:shopping')
      setAnswer({ kind: 'added', res, undone: false })
    } catch {
      setAnswer({ kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function sendNudge(a: Extract<Answer, { kind: 'nudge' }>) {
    setAnswer({ ...a, sending: true })
    try {
      await sendPing('custom', '📣', a.message, a.to ? [a.to.email] : null)
      setAnswer({ ...a, sent: true, sending: false })
    } catch {
      setAnswer({ kind: 'error' })
    }
  }

  function whenLabel(ev: CalendarEvent): string {
    const day = dayWords(ev.start_date)
    return ev.start_time ? `${day}, ${formatTime(ev.start_time.slice(0, 5), locale)}` : day
  }

  const canSend = text.trim().length > 0 && !busy

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={closeSheet} onShow={autoListen}>
      <View style={{ flex: 1 }} onLayout={onRootLayout}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }]} onPress={closeSheet} />
        <View
          style={{
            marginTop: 'auto',
            // On a Face ID iPhone the sheet floats with the bottom button's
            // geometry (useScreenCorner): 16pt sides, half-inset bottom, 40pt
            // bottom corners. With the keyboard up it rides on the keyboard.
            marginBottom: corner ? lift + (floatingOnKeyboard ? sp.sm : corner.bottom) : lift,
            marginHorizontal: corner?.side ?? 0,
            maxHeight: room * 0.92 - (corner?.bottom ?? 0),
            backgroundColor: c.sheet,
            borderTopLeftRadius: corner ? 30 : sheetRadius,
            borderTopRightRadius: corner ? 30 : sheetRadius,
            borderBottomLeftRadius: corner && !floatingOnKeyboard ? corner.radius : corner ? 24 : 0,
            borderBottomRightRadius: corner && !floatingOnKeyboard ? corner.radius : corner ? 24 : 0,
            paddingTop: sp.sm,
            paddingBottom: corner ? sp.md : clearOfBars ? sp.md : bottomGap,
          }}
        >
          <View style={{ alignItems: 'center', paddingBottom: sp.sm }}>
            <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: c.border }} />
          </View>

          <ScrollView
            ref={scrollRef}
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: sp.md }}
            keyboardShouldPersistTaps="handled"
            // A conversation grows downwards: keep the newest turn in view.
            onContentSizeChange={() => {
              if (pastRef.current.length) scrollRef.current?.scrollToEnd({ animated: true })
            }}
          >
            {past.length ? (
              <>
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: sp.sm }}>
                  <Pressable
                    onPress={newChat}
                    accessibilityRole="button"
                    hitSlop={8}
                    style={({ pressed }) => [s.newChat, { borderColor: c.border, opacity: pressed ? 0.6 : 1 }]}
                  >
                    <RotateCcw size={13} color={c.textMuted} />
                    <Txt style={{ fontSize: 12.5, fontFamily: fonts.semibold, color: c.textMuted }}>{t('ask.newChat')}</Txt>
                  </Pressable>
                </View>
                {past.map((turn, i) => (
                  <View key={i} style={{ marginBottom: sp.lg }}>
                    <View style={[s.bubble, { backgroundColor: c.surface }]}>
                      <Txt style={{ fontSize: 15, lineHeight: 20 }}>{turn.q}</Txt>
                    </View>
                    {turn.a ? (
                      <View style={[s.answerRow, { marginTop: sp.sm }]}>
                        <Orb size={22} />
                        <Txt style={{ flex: 1, fontSize: 14.5, lineHeight: 20, color: c.textMuted }}>{turn.a}</Txt>
                      </View>
                    ) : null}
                  </View>
                ))}
              </>
            ) : null}

            {hearing ? (
              <View style={{ paddingVertical: sp.lg, gap: sp.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
                  <Orb />
                  <Txt style={{ fontFamily: fonts.semibold, fontSize: 13, letterSpacing: 1, color: warming ? c.textMuted : c.accent, textTransform: 'uppercase' }}>
                    {warming ? t('ask.getReady') : t('ask.listening')}
                  </Txt>
                </View>
                <Txt style={{ fontFamily: fonts.display, fontSize: 26, lineHeight: 33, color: voice.transcript ? c.text : c.textFaint }}>
                  {voice.transcript || t('ask.ex1')}
                </Txt>
              </View>
            ) : query ? (
              <View style={[s.bubble, { backgroundColor: c.surface }]}>
                <Txt style={{ fontSize: 15.5, lineHeight: 21 }}>{query}</Txt>
              </View>
            ) : past.length ? null : (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginBottom: sp.md }}>
                  <Orb />
                  <Txt style={{ fontFamily: fonts.display, fontSize: 20 }}>{t('ask.title')}</Txt>
                </View>
                <View style={{ gap: sp.sm }}>
                  {(['ask.ex1', 'ask.ex2', 'ask.ex3'] as TKey[]).map((k) => (
                    <Pressable
                      key={k}
                      onPress={() => submit(t(k))}
                      style={({ pressed }) => [s.example, { borderColor: c.border, opacity: pressed ? 0.6 : 1 }]}
                    >
                      <Sparkles size={15} color={c.accent} />
                      <Txt style={{ flex: 1, fontSize: 14.5, color: c.text }}>{t(k)}</Txt>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            {voice.state === 'denied' || voice.state === 'error' ? (
              <View style={s.answerRow}>
                <Orb />
                <Txt style={[s.answerText, { fontSize: 15 }]}>
                  {voice.state === 'denied' ? t('ask.micDenied') : t('ask.micError')}
                </Txt>
              </View>
            ) : null}

            {hearing ? null : busy ? (
              <View style={s.answerRow}>
                <Orb />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, paddingTop: 4 }}>
                  <ActivityIndicator color={c.textMuted} size="small" />
                  <Txt variant="muted">{t('ask.thinking')}</Txt>
                </View>
              </View>
            ) : answer?.kind === 'added' ? (
              <AddedView
                res={answer.res}
                undone={answer.undone}
                onUndo={() => undo(answer.res)}
                onOpen={() => go('/shopping')}
              />
            ) : answer?.kind === 'agenda' ? (
              <AgendaView
                a={answer.a}
                today={today}
                locale={locale}
                memberEmails={memberEmails}
                dayWords={dayWords}
                onScope={(sc) => rescope(answer.a, sc)}
                onOpen={() => go('/calendar')}
              />
            ) : answer?.kind === 'chooseStore' ? (
              <ChooseStoreView
                items={answer.items}
                stores={answer.stores}
                suggested={answer.suggested}
                onPick={(st) => storeChosen(answer.items, st)}
                onCreate={(name) => storeChosen(answer.items, null, name)}
              />
            ) : answer?.kind === 'list' ? (
              <ListView groups={answer.groups} store={answer.store} onOpen={() => go('/shopping')} />
            ) : answer?.kind === 'found' ? (
              <FoundView reply={answer.reply} found={answer.found} onOpen={() => go('/shopping')} />
            ) : answer?.kind === 'marked' ? (
              <MarkedView
                mode={answer.mode}
                hits={answer.hits}
                missing={answer.missing}
                undone={answer.undone}
                onUndo={async () => {
                  const ids = answer.hits.map((i) => i.id)
                  if (answer.mode === 'check') await uncheckItems(ids)
                  else await restoreItems(answer.hits)
                  invalidateCache('hub:shopping')
                  setAnswer({ ...answer, undone: true })
                }}
                onOpen={() => go('/shopping')}
              />
            ) : answer?.kind === 'event' ? (
              <EventView
                title={answer.ev.title}
                when={whenLabel(answer.ev)}
                who={answer.who}
                undone={answer.undone}
                onUndo={async () => {
                  await deleteEvent(answer.ev.id)
                  invalidateCache('hub:today')
                  setAnswer({ ...answer, undone: true })
                }}
                onOpen={() => go('/calendar')}
              />
            ) : answer?.kind === 'money' ? (
              <MoneyView
                type={answer.type}
                amount={answer.amount}
                title={answer.title || t(answer.type === 'income' ? 'entry.income' : 'entry.expense').replace(/^[−+＋-]\s*/, '')}
                where={`${answer.res.budget.name} · ${periodLabel(answer.res.budget.period, answer.res.month.start_date)}`}
                icon={answer.type === 'income' ? '💵' : categoryById(answer.res.category, [], []).icon}
                undone={answer.undone}
                onUndo={async () => {
                  await deleteEntry(answer.res.entryId)
                  setAnswer({ ...answer, undone: true })
                }}
                onOpen={() => go(`/budget/${answer.res.budget.id}/${answer.res.month.id}`)}
              />
            ) : answer?.kind === 'summary' ? (
              <SummaryView
                lines={answer.lines}
                label={(l) => (l.month ? `${l.budget.name} · ${periodLabel(l.budget.period, l.month.start_date)}` : l.budget.name)}
                onOpen={() => go('/budget')}
              />
            ) : answer?.kind === 'nudge' ? (
              <NudgeView
                message={answer.message}
                to={answer.to?.display_name.split(' ')[0] ?? t('ask.everyoneLower')}
                sent={answer.sent}
                sending={answer.sending}
                onSend={() => sendNudge(answer)}
                onCancel={() => setAnswer(null)}
              />
            ) : answer?.kind === 'pets' ? (
              <PetsView p={answer.p} onOpen={() => go('/pets')} />
            ) : answer?.kind === 'family' ? (
              <FamilyView text={answer.text} onOpen={() => go('/family')} />
            ) : answer?.kind === 'split' ? (
              <SplitView
                amount={answer.amount}
                people={answer.people}
                tip={answer.tip}
                mode={answer.mode}
                onEven={() =>
                  answer.amount > 0 && answer.people > 0
                    ? setAnswer({ ...answer, mode: 'even' })
                    : openEvenSplit(answer.amount, answer.people, answer.tip)
                }
                onItems={openItemSplit}
                onOpenEven={() => openEvenSplit(answer.amount, answer.people, answer.tip)}
              />
            ) : answer?.kind === 'discount' ? (
              <DiscountView amount={answer.amount} percent={answer.percent} onOpen={() => go('/calc/discount')} />
            ) : answer?.kind === 'say' ? (
              answer.text ? <Headline text={answer.text} /> : null
            ) : answer ? (
              <Headline text={t('ask.error')} />
            ) : null}
          </ScrollView>

          {/* the input — always at the foot, ready for the next request */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, paddingHorizontal: sp.lg, paddingTop: sp.sm }}>
            <View style={[s.input, { backgroundColor: c.surface, borderColor: c.border, borderBottomLeftRadius: innerCurve }]}>
              <Sparkles size={18} color={c.accent} />
              <TextInput
                ref={inputRef}
                value={text}
                onChangeText={setText}
                placeholder={t('ask.inputPlaceholder')}
                placeholderTextColor={c.textFaint}
                autoFocus={!seed && !listen}
                returnKeyType="send"
                onSubmitEditing={() => submit()}
                style={{ flex: 1, fontSize: 16, fontFamily: fonts.body, color: c.text, paddingVertical: 0 }}
              />
            </View>
            {/* One button, three jobs: send what's typed; with nothing typed,
                the mic; while listening, stop (what was heard is sent). */}
            {hearing ? (
              <Pressable
                accessibilityLabel={t('ask.stop')}
                onPress={voice.stop}
                style={[s.send, { backgroundColor: c.expense, borderBottomRightRadius: innerCurve }]}
              >
                <Square size={18} color="#fff" fill="#fff" />
              </Pressable>
            ) : !text.trim() && canVoice ? (
              <Pressable
                accessibilityLabel={t('ask.speak')}
                disabled={busy}
                onPress={() => {
                  Keyboard.dismiss()
                  // Talking again continues the conversation: the last answer
                  // moves up as context instead of vanishing under "listening".
                  commitTurn()
                  void voice.start()
                }}
                style={[s.send, { backgroundColor: c.action, borderBottomRightRadius: innerCurve }]}
              >
                <Mic size={22} color={c.onAction} strokeWidth={2.4} />
              </Pressable>
            ) : (
              <Pressable
                accessibilityLabel={t('ask.send')}
                disabled={!canSend}
                onPress={() => submit()}
                style={[s.send, { backgroundColor: canSend ? c.action : c.surface2, borderBottomRightRadius: innerCurve }]}
              >
                <ArrowUp size={22} color={canSend ? c.onAction : c.textFaint} strokeWidth={2.6} />
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </Modal>
  )
}


// ── answers ──────────────────────────────────────────────────────────────────

function AddedView({
  res,
  undone,
  onUndo,
  onOpen,
}: {
  res: AddResult
  undone: boolean
  onUndo: () => void
  onOpen: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const n = res.added.length
  const store = res.store?.name ?? ''
  const headline = undone
    ? t('ask.undone')
    : n === 0
      ? t('ask.alreadyAll')
      : store
        ? t(n === 1 ? 'ask.addedOne' : 'ask.addedMany', { n, store })
        : t(n === 1 ? 'ask.addedOneAny' : 'ask.addedManyAny', { n })
  const shownNew = undone ? [] : res.added
  const total = res.others.length + shownNew.length
  return (
    <>
      <View style={s.answerRow}>
        <Orb />
        <View style={{ flex: 1 }}>
          <Txt style={s.answerText}>{headline}</Txt>
          {n > 0 && res.existing.length && !undone ? (
            <Txt variant="muted" style={{ marginTop: 2 }}>
              {t('ask.alreadySome', { items: res.existing.join(', ') })}
            </Txt>
          ) : null}
        </View>
      </View>
      <View style={[s.panel, { backgroundColor: c.card, borderColor: c.border }]}>
        <Pressable onPress={onOpen} style={[s.storeHead, { borderBottomColor: c.border }]}>
          {res.store ? (
            <StoreLogo slug={res.store.slug} name={res.store.name} color={res.store.color} size={40} />
          ) : null}
          <View style={{ flex: 1 }}>
            <Txt style={{ fontFamily: fonts.semibold, fontSize: 16 }}>{store || t('ask.anyStore')}</Txt>
            <Txt variant="faint">{t('ask.itemsCount', { n: total })}</Txt>
          </View>
          <ChevronRight size={20} color={c.textFaint} />
        </Pressable>
        {shownNew.map((i) => (
          <View key={i.id} style={s.item}>
            <View style={[s.box, { borderColor: c.border }]} />
            <Txt style={{ flex: 1, fontSize: 15.5 }}>{i.label}</Txt>
            <View style={[s.tag, { backgroundColor: c.income + '22' }]}>
              <Txt style={{ fontSize: 11, fontFamily: fonts.semibold, color: c.income, letterSpacing: 0.4 }}>
                {t('ask.new').toUpperCase()}
              </Txt>
            </View>
          </View>
        ))}
        {res.others.slice(0, 4).map((i) => (
          <View key={i.id} style={s.item}>
            <View style={[s.box, { borderColor: c.border }]} />
            <Txt style={{ flex: 1, fontSize: 15.5, color: c.textFaint }}>{i.label}</Txt>
          </View>
        ))}
      </View>
      <View style={s.btns}>
        {n > 0 && !undone ? (
          <Pressable onPress={onUndo} style={[s.btn, { backgroundColor: c.surface }]}>
            <RotateCcw size={17} color={c.text} />
            <Txt style={{ fontFamily: fonts.semibold, fontSize: 15 }}>{t('ask.undo')}</Txt>
          </Pressable>
        ) : null}
        <Pressable onPress={onOpen} style={[s.btn, { backgroundColor: c.action }]}>
          <Txt style={{ fontFamily: fonts.semibold, fontSize: 15, color: c.onAction }}>{t('ask.openList')}</Txt>
        </Pressable>
      </View>
    </>
  )
}

const HOUR_H = 46

function AgendaView({
  a,
  today,
  locale,
  memberEmails,
  dayWords,
  onScope,
  onOpen,
}: {
  a: AgendaAnswer
  today: string
  locale: string
  memberEmails: string[]
  dayWords: (iso: string) => string
  onScope: (s: Scope) => void
  onOpen: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  // A period ("this month", "next weeks") reads in the same sentences as a
  // day: "You have 5 things this month." The server names the period in the
  // user's words; locally we fall back to "until Nov 30".
  const isRange = a.end > a.date
  const endDate = (() => {
    const [y, m, d] = a.end.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString(locale, { day: 'numeric', month: 'short' })
  })()
  const day = isRange ? a.label || t('ask.untilDay', { day: endDate }) : dayWords(a.date)
  const n = a.rows.length
  const name = a.person?.display_name.split(' ')[0] ?? ''
  const isMe = a.scope === 'me'

  const timed = a.rows.filter((r) => r.start)
  const untimed = a.rows.filter((r) => !r.start)
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const next = isRange
    ? a.rows.find((r) => r.day > today || (r.day === today && (!r.start || toMin(r.start) >= nowMin)))
    : a.date === today
      ? timed.find((r) => toMin(r.start) >= nowMin)
      : timed[0]

  const headline =
    n === 0
      ? a.scope === 'all'
        ? t('ask.freeAll', { day })
        : isMe
          ? t('ask.freeMe', { day })
          : t('ask.freePerson', { name, day })
      : a.scope === 'all'
        ? t(n === 1 ? 'ask.allOne' : 'ask.allMany', { n, day })
        : isMe
          ? t(n === 1 ? 'ask.meOne' : 'ask.meMany', { n, day })
          : t(n === 1 ? 'ask.personOne' : 'ask.personMany', { name, n, day })

  const colorOf = (r: AgendaRow) =>
    r.kind === 'pet' ? '#F2603A' : (r.color ?? (r.ownerEmail ? memberColor(r.ownerEmail, memberEmails) : c.accent))

  // The grid spans the day's timed events (plus "now" on today), whole hours.
  // "Now" pulls the grid earlier only when it's close (≤ 2h before the first
  // event) — otherwise a morning question draws a tall, empty afternoon.
  const firstH = timed.length ? Math.min(...timed.map((r) => Math.floor(toMin(r.start) / 60))) : 0
  const nowH = Math.floor(nowMin / 60)
  const startH = a.date === today && nowH < firstH && firstH - nowH <= 2 ? nowH : firstH
  const endH = timed.length
    ? Math.min(24, Math.max(startH + 3, ...timed.map((r) => Math.ceil(endMin(r) / 60))))
    : 0

  return (
    <>
      {n === 0 ? (
        <FreeDay title={headline} />
      ) : (
        <View style={s.answerRow}>
          <Orb />
          <View style={{ flex: 1 }}>
            <Txt style={s.answerText}>{headline}</Txt>
            {isRange && next ? (
              <Txt variant="muted" style={{ marginTop: 2 }}>
                {t('ask.nextOn', {
                  title: next.title,
                  when: `${dayWords(next.day)}${next.start ? `, ${formatTime(next.start, locale)}` : ''}`,
                })}
              </Txt>
            ) : next?.start ? (
              <Txt variant="muted" style={{ marginTop: 2 }}>
                {t('ask.nextAt', { time: formatTime(next.start, locale) })}
              </Txt>
            ) : null}
          </View>
        </View>
      )}

      {a.scope !== 'person' ? (
        <View style={[s.seg, { backgroundColor: c.surface }]}>
          {(['me', 'all'] as Scope[]).map((sc) => {
            const on = a.scope === sc
            return (
              <Pressable
                key={sc}
                onPress={() => !on && onScope(sc)}
                style={[s.segItem, on && { backgroundColor: c.action }]}
              >
                <Txt style={{ fontFamily: fonts.semibold, fontSize: 13.5, color: on ? c.onAction : c.textMuted }}>
                  {t(sc === 'me' ? 'ask.onlyMe' : 'ask.everyone')}
                </Txt>
              </Pressable>
            )
          })}
        </View>
      ) : null}

      {n > 0 && isRange ? (
        // A period: the rows grouped under each day, in order.
        <View style={[s.panel, { backgroundColor: c.card, borderColor: c.border, paddingVertical: sp.sm }]}>
          {[...new Set(a.rows.map((r) => r.day))].map((d, di) => (
            <View key={d} style={di ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, marginTop: 4 } : null}>
              <Txt style={{ fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 0.9, textTransform: 'uppercase', color: c.textMuted, paddingTop: sp.sm, paddingBottom: 2 }}>
                {(() => {
                  const [y, m, dd] = d.split('-').map(Number)
                  const label = new Date(y, m - 1, dd).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })
                  return d === today ? `${t('ask.today')} · ${label}` : label
                })()}
              </Txt>
              {a.rows
                .filter((r) => r.day === d)
                .map((r) => (
                  <View key={r.key} style={s.item}>
                    <View style={{ width: 4, height: 26, borderRadius: 2, backgroundColor: colorOf(r) }} />
                    <Txt style={{ flex: 1, fontSize: 15 }} numberOfLines={1}>
                      {r.title}
                    </Txt>
                    <Txt variant="faint" style={{ fontVariant: ['tabular-nums'] }}>
                      {r.start ? formatTime(r.start, locale) : r.kind === 'pet' ? t('home.petCare') : t('home.allDay')}
                    </Txt>
                  </View>
                ))}
            </View>
          ))}
        </View>
      ) : n > 0 ? (
        <View style={[s.panel, { backgroundColor: c.card, borderColor: c.border, padding: sp.md }]}>
          {untimed.map((r) => (
            <View key={r.key} style={[s.allDay, { backgroundColor: colorOf(r) + '22' }]}>
              {r.kind === 'pet' ? <PawPrint size={14} color={colorOf(r)} /> : null}
              <Txt style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 14 }} numberOfLines={1}>
                {r.title}
              </Txt>
              <Txt variant="faint" style={{ fontSize: 12 }}>
                {r.kind === 'pet' ? t('home.petCare') : t('home.allDay')}
              </Txt>
            </View>
          ))}
          {timed.length ? (
            <View style={{ height: (endH - startH) * HOUR_H + 8, marginTop: untimed.length ? sp.sm : 0 }}>
              {Array.from({ length: endH - startH + 1 }, (_, i) => (
                <View key={i} style={[s.hour, { top: i * HOUR_H }]}>
                  <Txt style={{ width: 40, textAlign: 'right', fontSize: 11.5, color: c.textFaint, fontVariant: ['tabular-nums'] }}>
                    {hourLabel(startH + i, locale)}
                  </Txt>
                  <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />
                </View>
              ))}
              {a.date === today && nowMin >= startH * 60 && nowMin <= endH * 60 ? (
                <View style={[s.now, { top: ((nowMin - startH * 60) / 60) * HOUR_H }]}>
                  <View style={s.nowDot} />
                </View>
              ) : null}
              {timed.map((r) => {
                const top = ((toMin(r.start) - startH * 60) / 60) * HOUR_H
                const h = Math.max(30, ((endMin(r) - toMin(r.start)) / 60) * HOUR_H - 3)
                return (
                  <View key={r.key} style={[s.block, { top: top + 1, height: h, backgroundColor: colorOf(r) }]}>
                    <Txt numberOfLines={1} style={{ color: '#fff', fontFamily: fonts.semibold, fontSize: 13.5 }}>
                      {r.title}
                    </Txt>
                    {h > 40 ? (
                      <Txt numberOfLines={1} style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12 }}>
                        {formatTime(r.start!, locale)}
                        {r.end ? `–${formatTime(r.end, locale)}` : ''}
                        {r.location ? ` · ${r.location}` : ''}
                      </Txt>
                    ) : null}
                  </View>
                )
              })}
            </View>
          ) : null}
        </View>
      ) : a.others.length ? (
        <>
          <Txt variant="label" style={{ marginTop: sp.lg, marginBottom: sp.sm, textTransform: 'uppercase', letterSpacing: 0.8, fontSize: 12 }}>
            {t('ask.meanwhile')}
          </Txt>
          <View style={[s.panel, { backgroundColor: c.card, borderColor: c.border, marginTop: 0 }]}>
            {a.others.slice(0, 4).map((r, i) => (
              <View key={r.key} style={[s.item, i ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border } : null]}>
                <View style={{ width: 4, height: 28, borderRadius: 2, backgroundColor: colorOf(r) }} />
                <Txt style={{ flex: 1, fontSize: 15 }} numberOfLines={1}>
                  {r.title}
                </Txt>
                <Txt variant="faint" style={{ fontVariant: ['tabular-nums'] }}>
                  {r.start ? formatTime(r.start, locale) : r.kind === 'pet' ? t('home.petCare') : t('home.allDay')}
                </Txt>
              </View>
            ))}
          </View>
        </>
      ) : null}

      <View style={s.btns}>
        <Pressable onPress={onOpen} style={[s.btn, { backgroundColor: n ? c.action : c.surface }]}>
          <CalendarDays size={18} color={n ? c.onAction : c.text} />
          <Txt style={{ fontFamily: fonts.semibold, fontSize: 15, color: n ? c.onAction : c.text }}>
            {t('ask.openCalendar')}
          </Txt>
        </Pressable>
      </View>
    </>
  )
}

function FreeDay({ title }: { title: string }) {
  const { t } = useI18n()
  return (
    <View style={{ alignItems: 'center', paddingTop: sp.xl, paddingBottom: sp.sm }}>
      <View style={s.sunHalo}>
        <GradientBox colors={['#FFE07A', '#FF9A1F']} radius={48} style={{ width: 96, height: 96 }} />
      </View>
      <Txt style={{ fontFamily: fonts.display, fontSize: 24, textAlign: 'center', marginTop: sp.xl }}>{title}</Txt>
      <Txt variant="muted" style={{ fontSize: 16, marginTop: 4 }}>
        {t('ask.enjoy')} ☀︎
      </Txt>
    </View>
  )
}

/** Compact hour for the grid's gutter: "5 PM" in English, "17h" elsewhere. */
function hourLabel(h: number, locale: string): string {
  if (!locale.startsWith('en')) return `${h}h`
  const h12 = h % 12 || 12
  return `${h12} ${h < 12 || h === 24 ? 'AM' : 'PM'}`
}

function toMin(hhmm: string | null): number {
  if (!hhmm) return 0
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** End of a timed row; no end (or one past midnight) reads as an hour long. */
function endMin(r: AgendaRow): number {
  const start = toMin(r.start)
  const end = r.end ? toMin(r.end) : 0
  return end > start ? Math.min(end, 24 * 60) : Math.min(start + 60, 24 * 60)
}

const s = StyleSheet.create({
  newChat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    height: 28,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bubble: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    borderRadius: 20,
    borderBottomRightRadius: 6,
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  example: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: sp.md,
    paddingVertical: 11,
  },
  answerRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: sp.lg },
  answerText: { flex: 1, fontFamily: fonts.displaySemi, fontSize: 18, lineHeight: 24, paddingTop: 2 },
  panel: { marginTop: sp.md, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: sp.md, paddingVertical: 4 },
  storeHead: { flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderBottomWidth: StyleSheet.hairlineWidth },
  item: { flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: 10 },
  box: { width: 22, height: 22, borderRadius: 7, borderWidth: 2 },
  tag: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  btns: { flexDirection: 'row', gap: 10, marginTop: sp.md },
  btn: { flex: 1, height: 50, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  seg: { flexDirection: 'row', alignSelf: 'flex-start', borderRadius: 12, padding: 3, marginTop: sp.md },
  segItem: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 9 },
  allDay: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 6 },
  hour: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: -7 },
  now: { position: 'absolute', left: 44, right: 0, height: 2, backgroundColor: '#FF4D5E' },
  nowDot: { position: 'absolute', left: -4, top: -4, width: 10, height: 10, borderRadius: 5, backgroundColor: '#FF4D5E' },
  block: { position: 'absolute', left: 52, right: 2, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, overflow: 'hidden' },
  sunHalo: {
    width: 96,
    height: 96,
    borderRadius: 48,
    shadowColor: '#FFB21F',
    shadowOpacity: 0.55,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  input: {
    flex: 1,
    height: 52,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
  },
  send: { width: 52, height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
})
