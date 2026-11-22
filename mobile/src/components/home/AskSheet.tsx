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
  Animated,
  Keyboard,
  Linking,
  Modal,
  PanResponder,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'
import { router, usePathname } from 'expo-router'
import { ArrowUp, CalendarDays, ChevronRight, Mic, PawPrint, RotateCcw, Sparkles } from 'lucide-react-native'

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
  moveEvent,
  removeEvent,
  reportGap,
  setGapContext,
  restoreEvent,
  unremoveEvent,
  familyInfo,
  fetchStores,
  findItems,
  findMember,
  openItemsContext,
  listItems,
  budgetsWithMonths,
  isGeneralList,
  matchStore,
  periodForBudget,
  pickBudget,
  moneySummary,
  petsDue,
  setDailyDone,
  type PetsAnswer,
  removeItems,
  restoreItems,
  uncheckItems,
  undoAdd,
  understandWithSource,
  type Quota,
  recentContext,
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
import { CHIME_MS, playChime, useVoice, voiceSupported } from '@/lib/voice'
import { roofHush, roofPrefetch, roofSay, useRoofPrefs } from '@/lib/roof'
import { track } from '@/lib/analytics'
import { isGoodbye, meaningfulRequest } from '@/lib/roofWake'
import { clockAsk, durationSaid, isNo, isRepeatAsk, isYes, pickByVoice } from '@/lib/assistantTalk'
import { fonts, radius, sheetRadius, sp, useTheme } from '@/theme/theme'
import {
  ActionView,
  ChooseBudgetView,
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
import { HelpView } from './HelpView'
import { CapabilitiesView } from './CapabilitiesView'
import { isCapabilitiesAsk, nextTip, type Tip } from './roofTips'
import { ListeningBars } from './ListeningBars'
import {
  actMore,
  durationAsk,
  moneyOverview,
  overlapAsk,
  eventWho,
  moveAnswer,
  recurrenceLabel,
  recurringChoice,
  reminderLabel,
  removeAnswer,
  whichEvent,
  type ActEnv,
  type ActionAnswer,
} from './askActions'
import { categoriesContext, documentsContext, petTasksContext } from '@/lib/assistantActions'
import { fetchPingPresets, presetText, sendPing } from '@/lib/pings'
import { usePlus } from '@/lib/plus'
import { categoryById } from '@/lib/categories'
import { formatMoney, periodLabel } from '@/lib/format'
import type { Budget, CalendarEvent, Profile, ShoppingItem, ShoppingStore } from '@/lib/types'

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
  frame: '/calc/frame',
  games: '/games',
  settings: '/settings',
}

const LOCALE: Record<string, string> = { en: 'en-US', es: 'es', pt: 'pt-BR' }

type Answer =
  | { kind: 'added'; res: AddResult; undone: boolean }
  | { kind: 'agenda'; a: AgendaAnswer }
  | { kind: 'chooseStore'; items: string[]; stores: ShoppingStore[]; suggested: string }
  | {
      kind: 'chooseBudget'
      budgets: Budget[]
      pending: { title: string; amount: number; type: 'expense' | 'income'; date: string }
    }
  | { kind: 'list'; groups: ListGroup[]; store: ShoppingStore | null }
  | { kind: 'found'; found: Found[]; reply: string }
  | { kind: 'marked'; mode: 'check' | 'remove'; hits: ShoppingItem[]; missing: string[]; undone: boolean }
  | { kind: 'event'; ev: CalendarEvent; who: string | null; undone: boolean }
  | { kind: 'moved'; ev: CalendarEvent; before: CalendarEvent; undone: boolean }
  | { kind: 'removedEvent'; ev: CalendarEvent; undone: boolean }
  | { kind: 'money'; res: Extract<MoneyResult, { ok: true }>; type: 'expense' | 'income'; amount: number; title: string; undone: boolean }
  | { kind: 'summary'; lines: MoneyLine[]; head?: string }
  | { kind: 'nudge'; message: string; to: Profile | null; sent: boolean; sending: boolean; emoji: string; urgent: boolean; pingKind: string }
  | ActionAnswer
  | { kind: 'pets'; p: PetsAnswer }
  | { kind: 'family'; text: string }
  | { kind: 'say'; text: string }
  | { kind: 'split'; amount: number; people: number; tip: number; mode: 'choose' | 'even' }
  | { kind: 'discount'; amount: number; percent: number }
  | { kind: 'help'; topic: string; text: string }
  | { kind: 'capabilities' }
  | { kind: 'unknown'; text: string }
  | { kind: 'error' }

/** A finished turn of the conversation. */
type Turn = { q: string; a: string; card?: Answer }

/** The context the sheet loads for the model (see loadContext). */
interface Loaded {
  stores: ShoppingStore[]
  open: { lines: string[]; labels: string[] }
  budgets: string[]
  pets: string[]
  /** "Lola = dog" — the model reads "as cachorras" as every dog. */
  petKinds: string[]
  petTasks: string[]
  categories: string[]
  documents: string[]
  recent: { entries: string[]; events: string[] }
}

/** What to ask for when the server understood `about` but a detail was missing. */
function needKey(about: string): TKey {
  if (about === 'add_items') return 'ask.need.addItems'
  if (['check_items', 'remove_items', 'move_items', 'uncheck_items'].includes(about)) return 'ask.need.list'
  if (about === 'add_money') return 'ask.need.addMoney'
  if (about === 'fix_money') return 'ask.need.fixMoney'
  if (about === 'add_event') return 'ask.need.addEvent'
  if (about === 'move_event') return 'ask.need.moveEvent'
  if (about === 'edit_event') return 'ask.need.editEvent'
  if (about === 'remove_event' || about === 'find_event') return 'ask.need.whichEvent'
  if (about === 'send_nudge') return 'ask.need.nudge'
  if (about.startsWith('pet_')) return 'ask.need.pet'
  return 'ask.need.generic'
}

export function AskSheet({
  visible,
  onClose,
  seed,
  listen = false,
  autoSend,
  spoken = false,
  wakeHeard,
  onWakeStop,
  typeToo = false,
  continueListening = 0,
}: {
  visible: boolean
  onClose: () => void
  seed?: string
  /** "Ei Roof, põe café na lista": the request, sent as soon as the sheet opens. */
  autoSend?: string
  /** Opened by voice (the Home's mic or "Ei Roof"): answers are read out. */
  spoken?: boolean
  /** Opened from the Home's mic: start listening right away. */
  listen?: boolean
  /** "Ei Roof" is still capturing (the Home's wake recogniser): what it has
   *  heard so far. The sheet shows "listening" without starting its own mic. */
  wakeHeard?: string
  /** Stop tapped during that capture. */
  onWakeStop?: () => void
  /** Opened from the dock's arrow: listening AND the keyboard up — typing
   *  stops the mic. */
  typeToo?: boolean
  /** Bumped when "Ei Roof" handed the listening over: start the mic — not
   *  quietly: it says "one moment" and chimes once it's really live (the gap
   *  while it starts used to look like "listening" and lost the first words). */
  continueListening?: number
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
  // For the listen-again after a spoken answer (see submit).
  const textRef = useRef(text)
  useEffect(() => {
    textRef.current = text
  }, [text])
  const turnSeq = useRef(0)
  const openRef = useRef(true)
  useEffect(() => {
    openRef.current = visible
    return () => {
      openRef.current = false
    }
  }, [visible])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<Answer | null>(null)
  // Free plan: this member's monthly assistant allowance, as the server last
  // reported it (absent until the first answer, and for Plus).
  const [quota, setQuota] = useState<Quota | null>(null)
  // The conversation so far (owner, 2026-11): each finished turn stays on
  // screen as the question + a one-line account of the answer, and the same
  // lines go to Claude as context — so "o que tem no Walmart?" → "tira o
  // leite" works. Kept in a ref too: submit() reads it right after a commit.
  // `card`: the first result of a two-task request keeps its FULL card (Undo
  // and all) up in the conversation until the next new request (owner,
  // 2026-11-17: a wrong add must be removable right there).
  const [past, setPast] = useState<Turn[]>([])
  const pastRef = useRef<Turn[]>([])
  const inputRef = useRef<TextInput>(null)
  const scrollRef = useRef<ScrollView>(null)
  // The recogniser's callback is created before submit() exists; it reaches
  // the latest one through this ref (refreshed after every render).
  const submitRef = useRef<((q?: string, chain?: boolean) => Promise<void>) | null>(null)
  // Voice: speak, watch the words appear, and the final transcript is sent.
  const canVoice = voiceSupported()
  // The household's own words, handed to the recogniser as hints.
  const [hints, setHints] = useState<string[]>([])
  // Everything the model is shown, loaded once when the sheet opens (it
  // remounts per open) and refreshed in the background after each answer —
  // so asking doesn't wait on six queries first.
  const ctxRef = useRef<Promise<Loaded> | null>(null)
  const loadContext = useCallback(() => {
    const firstName = (email: string | null) => profiles.find((p) => p.email === email)?.display_name.split(' ')[0] ?? ''
    const p = (async (): Promise<Loaded> => {
      const [stores, budgetRows, petRows, petTasks, categories, recent, documents] = await Promise.all([
        fetchStores(),
        supabase.from('budgets').select('name'),
        supabase.from('pets').select('name, species'),
        petTasksContext().catch(() => []),
        categoriesContext().catch(() => []),
        recentContext(today, firstName).catch(() => ({ entries: [], events: [] })),
        documentsContext().catch(() => []),
      ])
      const open = await openItemsContext(stores)
      return {
        stores,
        open,
        budgets: ((budgetRows.data ?? []) as { name: string }[]).map((b) => b.name),
        pets: ((petRows.data ?? []) as { name: string }[]).map((x) => x.name),
        petKinds: ((petRows.data ?? []) as { name: string; species: string | null }[]).filter((x) => x.species).map((x) => `${x.name} = ${x.species}`),
        petTasks,
        categories,
        documents,
        recent,
      }
    })()
    ctxRef.current = p
    p.catch(() => {
      if (ctxRef.current === p) ctxRef.current = null
    })
    return p
  }, [profiles, today])
  useEffect(() => {
    let alive = true
    void loadContext()
      .then((ctx) => {
        if (!alive) return
        setHints([
          ...ctx.stores.map((x) => x.name),
          ...profiles.map((p) => p.display_name.split(' ')[0]),
          ...ctx.pets,
          ...ctx.open.labels,
        ])
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [profiles, loadContext])
  // Roof reads the answer out when the question was SPOKEN (owner, 2026-11):
  // typing never talks back. Plus only; the family can turn it off.
  const roof = useRoofPrefs()
  const viaVoice = useRef(spoken)
  const voice = useVoice(
    lang,
    (heard) => {
      // A listen that finished after the sheet closed is dropped, never sent;
      // so is a bare hesitation ("er", "é…") — that's not a request.
      if (!openRef.current) return
      // ("ok" alone is a goodbye, not a hesitation — check that first.)
      if (!isGoodbye(heard)) heard = meaningfulRequest(heard)
      if (!heard) {
        // Just "er…" during a conversation: keep listening for the real reply.
        if (followRef.current) void voice.start({ quiet: true, untilCancel: true })
        return
      }
      viaVoice.current = true
      void submitRef.current?.(heard)
    },
    hints,
  )
  // Every way out of the sheet (backdrop, back gesture, an answer's "Open …"
  // button) goes through here, so a dismissal mid-listen stops the recogniser
  // and plays the stop chime instead of cutting off silently.
  const cancelVoice = voice.cancel
  const closeSheet = useCallback(() => {
    turnSeq.current++
    openRef.current = false
    cancelVoice()
    roofHush()
    onClose()
  }, [cancelVoice, onClose])
  // Drag the sheet down by its top strip to dismiss (owner, 2026-11: once a
  // conversation filled the sheet there was no backdrop left to tap and the
  // handle didn't move). Follows the finger; a pull past DISMISS_AT or a quick
  // flick closes, anything less springs back.
  const [dragY] = useState(() => new Animated.Value(0))
  const closeRef = useRef(closeSheet)
  useEffect(() => {
    closeRef.current = closeSheet
  }, [closeSheet])
  const [drag] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 4,
      onPanResponderMove: (_e, g) => dragY.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 110 || g.vy > 0.9) {
          Animated.timing(dragY, { toValue: 900, duration: 180, useNativeDriver: true }).start(() => {
            closeRef.current()
            dragY.setValue(0)
          })
        } else {
          Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start()
        }
      },
      onPanResponderTerminate: () => Animated.spring(dragY, { toValue: 0, useNativeDriver: true }).start(),
    }),
  )
  // `starting` counts as hearing for the layout (stop button, no answer), but
  // the label says "one moment" until the mic is live and the chime plays —
  // ALWAYS, also for a hand-off from "Ei Roof" and a conversation's next turn.
  const wakeLive = wakeHeard !== undefined
  const voiceOn = voice.state === 'listening' || voice.state === 'starting'
  // Opened BY VOICE (the Home's mic, "Oi Casa", a spoken request on its way):
  // the listening layout from the first frame. Without this the sheet showed
  // the example requests for the moment before its mic started (the Home
  // mic's 0.7 s wait, the wake listener's hand-off) and then swapped to the
  // listening view — a jarring layout jump (owner, 2026-11-14). The examples
  // are only for a sheet that isn't listening.
  const [voicePending, setVoicePending] = useState(() => listen || wakeHeard !== undefined || (!!autoSend && spoken))
  const sawStart = useRef(false)
  useEffect(() => {
    if (voice.state !== 'idle') sawStart.current = true
    // Done waiting: the mic is live, a request is on screen, or a start ended.
    if (voice.state === 'listening' || query || answer || (voice.state === 'idle' && sawStart.current)) {
      sawStart.current = false
      setVoicePending(false)
    }
  }, [voice.state, query, answer])
  useEffect(() => {
    if (!voicePending) return
    // A start that never comes (no permission, an error) must not leave the
    // sheet stuck on "one moment".
    const id = setTimeout(() => setVoicePending(false), 8000)
    return () => clearTimeout(id)
  }, [voicePending])
  const hearing = voiceOn || wakeLive || voicePending
  const warming = (voice.state === 'starting' && !wakeLive) || (voicePending && !voiceOn && !wakeLive)
  const heardText = wakeLive ? wakeHeard : voice.transcript
  // A conversation by voice keeps listening after each answer (owner,
  // 2026-11): the answer stays on screen and a small "listening" strip sits
  // under it, instead of the full listening view replacing it.
  const [follow, setFollow] = useState(false)
  const followRef = useRef(false)
  useEffect(() => {
    followRef.current = follow
  }, [follow])
  const followUp = follow && voiceOn
  const fullHearing = hearing && !followUp
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

  // Hidden by any route (backdrop, drag, back, the Home closing it): the mic
  // and Roof's voice stop too.
  // "{name}" in an example = someone else in the family.
  const otherName = ((profiles.find((p) => p.email !== profile?.email) ?? profile)?.display_name ?? '').trim().split(/\s+/)[0] || 'Ana'
  // A different suggestion each time the sheet opens (roofTips).
  const [tip, setTip] = useState<Tip>({ kind: 'example', key: 'ask.ex2' })
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one pick per opening
    if (visible) setTip(nextTip())
  }, [visible])

  useEffect(() => {
    if (visible) return
    cancelVoice()
    roofHush()
  }, [visible, cancelVoice])

  // A bare "Ei Roof" whose recogniser ended: listen here with the sheet's
  // own mic, at once (roofWake only hands over once its chime is done).
  // Not quiet: "one moment" until the mic is live, then the start chime —
  // a quiet start showed "listening" over a deaf gap (review 2026-11-14 H2).
  const lastContinue = useRef(continueListening)
  useEffect(() => {
    if (!continueListening || continueListening === lastContinue.current) return
    lastContinue.current = continueListening
    if (!openRef.current) return
    viaVoice.current = true
    setVoicePending(true)
    void startVoice()
  }, [continueListening, startVoice])

  // "Ei Roof, …": send what was said once the sheet is up.
  const autoSent = useRef(false)
  useEffect(() => {
    if (!autoSend || autoSent.current) return
    const id = setTimeout(() => {
      if (autoSent.current) return
      autoSent.current = true
      viaVoice.current = true
      void submitRef.current?.(autoSend)
    }, 450)
    return () => clearTimeout(id)
  }, [autoSend])

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
      case 'chooseBudget':
        return t('ask.sumWhichBudget', { amount: formatMoney(a.pending.amount) })
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
      case 'moved':
        return undone(t('ask.sumMoved', { title: a.ev.title, when: whenLabel(a.ev) }), a.undone)
      case 'removedEvent':
        return undone(t('ask.sumRemovedEvent', { title: a.ev.title, when: whenLabel(a.ev) }), a.undone)
      case 'money':
        return undone(t(a.type === 'income' ? 'ask.sumMoneyIncome' : 'ask.sumMoney', { title: a.title, amount: formatMoney(a.amount) }), a.undone)
      case 'summary':
        return (
          (a.head ? `${a.head}. ` : '') +
          a.lines
            .map(
              (l) =>
                `${t('ask.sumMoneyLine', {
                  // The period goes in the history, so "and the month before?" knows where it was.
                  budget: l.month ? `${l.budget.name} (${periodLabel(l.budget.period, l.month.start_date)})` : l.budget.name,
                  income: formatMoney(l.income),
                  spent: formatMoney(l.spent),
                })}, ${t('ask.sumBalance', { amount: formatMoney(l.income - l.spent) })}`,
            )
            .join('; ')
        )
      case 'nudge':
        return t('ask.sumNudge', { to: a.to?.display_name.split(' ')[0] ?? t('ask.everyoneLower'), message: a.message })
      case 'pets': {
        const { rows, pet, routineDone, routineTotal } = a.p
        const progress = pet && routineTotal ? ` ${t('ask.petProgress', { done: routineDone, total: routineTotal })}` : ''
        return rows.length
          ? `${pet ? `${pet}: ` : ''}${list(rows.map((r) => `${r.title}${(pet && !pet.includes(',')) || !r.pet ? '' : ` (${r.pet})`}`))}.${progress}`
          : `${pet ? t('ask.petsNoneFor', { pet }) : t('ask.petsNone')}${progress}`
      }
      case 'split':
        return t('ask.sumSplit', { amount: formatMoney(a.amount), people: a.people })
      case 'discount':
        return t('ask.sumDiscount', { amount: formatMoney(a.amount), pct: a.percent })
      case 'action':
        return undone(a.summary, a.undone)
      case 'help':
        return a.text || t('ask.openGames')
      case 'capabilities':
        return t('ask.capsSay')
      case 'family':
      case 'say':
      case 'unknown':
        return a.text
      case 'error':
        return t('ask.error')
    }
  }

  /** Move the finished question + answer into the conversation above. */
  /** What Roof SAYS for an answer: the summary, but a long list or agenda is
   *  cut to its first few rows + "and N more" — nobody listens to 12 items. */
  function spokenText(a: Answer): string {
    const cut = (xs: string[], keep: number) => (xs.length > keep + 1 ? `${xs.slice(0, keep).join(', ')} ${t('ask.sayMore', { n: xs.length - keep })}` : xs.join(', '))
    if (a.kind === 'list' && a.groups.length) {
      const total = a.groups.reduce((n, g) => n + g.items.length, 0)
      if (total <= 5) return summarize(a)
      return a.groups
        .slice(0, 3)
        .map((g) => t('ask.sayList', { n: g.items.length, store: g.store?.name ?? t('ask.anyStore'), items: cut(g.items.map((i) => i.label), 3) }))
        .join(' ')
    }
    if (a.kind === 'agenda' && a.a.rows.length > 5) {
      const when = a.a.label || dayWords(a.a.date)
      return t('ask.sayAgenda', { n: a.a.rows.length, when, items: cut(a.a.rows.map((r) => r.title), 4) })
    }
    if (a.kind === 'action' && a.rows.length > 5 && a.summary.length > 220) return a.headline
    return summarize(a)
  }

  /** The answer on screen is a question only a tap could answer until now. */
  function awaiting(a: Answer | null): boolean {
    if (!a) return false
    if (a.kind === 'nudge') return !a.sent && !a.sending
    if (a.kind === 'chooseBudget' || a.kind === 'chooseStore') return true
    return a.kind === 'action' && !a.undone && (!!a.choices?.length || a.rows.some((r) => r.pick))
  }

  /** Settled on the phone, nothing sent or spent: an answer to Roof's own
   *  question ("sim", "cancela", "o segundo", "Costco"), "repete", the clock,
   *  the date, and a bare "bom dia" (→ the day's overview). null = not one. */
  async function answerHere(q: string, last: Answer | null): Promise<Answer | null> {
    const cancelled: Answer = { kind: 'say', text: t('ask.cancelled') }
    if (last && awaiting(last)) {
      if (last.kind === 'nudge') {
        if (isYes(q)) {
          await sendPing(last.pingKind, last.emoji, last.message, last.to ? [last.to.email] : null, last.urgent, { source: 'assistant' })
          return { ...last, sent: true, sending: false }
        }
        if (isNo(q)) return cancelled
      } else if (last.kind === 'chooseBudget') {
        const i = pickByVoice(q, last.budgets.map((b) => b.name))
        if (i >= 0) {
          const p = last.pending
          const res = await addMoney(p.title, p.amount, p.type, p.date, '', profile?.email ?? '', last.budgets[i].id)
          if (!res.ok) return { kind: 'say', text: res.reason === 'no_period' ? t('ask.noPeriod', { budget: last.budgets[i].name }) : t('ask.noBudget') }
          return { kind: 'money', res, type: p.type, amount: p.amount, title: p.title, undone: false }
        }
        if (isNo(q)) return cancelled
      } else if (last.kind === 'chooseStore') {
        const create = isGeneralList(last.suggested, t('ask.anyStore')) ? '' : last.suggested.trim()
        const labels = [...last.stores.map((x) => x.name), t('ask.anyStore'), ...(create ? [create] : [])]
        const i = pickByVoice(q, labels)
        if (i >= 0) {
          const made = i > last.stores.length
          const target = made ? await createStore(create) : (last.stores[i] ?? null)
          const res = await addItems(last.items, target, profile?.email ?? '', made)
          invalidateCache('hub:shopping')
          return { kind: 'added', res, undone: false }
        }
        if (isNo(q)) return cancelled
      } else if (last.kind === 'action') {
        const choices = last.choices ?? []
        const picks = last.rows.filter((r) => r.pick)
        // "2 horas" to "how long?" — before the rows, where "duas" would be
        // the SECOND row.
        const mins = last.byMinutes ? durationSaid(q, true) : null
        if (mins && last.byMinutes) return last.byMinutes(mins)
        if ((choices.length === 1 || last.confirm) && choices.length && isYes(q)) return choices[0].run()
        const c = pickByVoice(q, choices.map((x) => x.label))
        if (c >= 0) return choices[c].run()
        const r = pickByVoice(q, picks.map((x) => x.title))
        if (r >= 0) return picks[r].pick!()
        if (isNo(q)) return cancelled
      }
    }
    if (last && isRepeatAsk(q)) return last
    const clock = clockAsk(q)
    if (clock === 'time') return { kind: 'say', text: t('ask.timeIs', { time: new Date().toLocaleTimeString(LOCALE[lang] ?? 'pt-BR', { hour: 'numeric', minute: '2-digit' }) }) }
    if (clock === 'date')
      return { kind: 'say', text: t('ask.dateIs', { date: new Date().toLocaleDateString(LOCALE[lang] ?? 'pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) }) }
    if (clock === 'morning') return act({ intent: 'day_summary', date: today }, [])
    return null
  }

  function commitTurn() {
    if (query && answer) {
      pastRef.current = [...pastRef.current.map(({ q, a }) => ({ q, a })), { q: query, a: summarize(answer) }].slice(-8)
      setPast(pastRef.current)
    }
    setQuery('')
    setAnswer(null)
  }

  function newChat() {
    lastAnswer.current = null
    pastRef.current = []
    setPast([])
    setQuery('')
    setAnswer(null)
  }

  /** `chain`: the second task of one request ("…e marca dentista sexta"). The
   *  first answer STAYS on screen with "now: <second task>" under it while
   *  this one is worked out, then moves up into the conversation and this
   *  answer shows below it (owner, 2026-11-17: the first result was replaced
   *  before it could be read). */
  async function submit(raw?: string, chain = false) {
    const q = (raw ?? text).trim()
    if (!q || busy) return
    turnSeq.current++
    setFollow(false)
    // Typed (no raw text passed) → answer on screen only.
    if (raw === undefined) viaVoice.current = false
    roofHush()
    Keyboard.dismiss()
    // What was on screen when this was said: "sim" / "o segundo" answer IT.
    const prev = lastAnswer.current
    const replying = awaiting(prev) && (isYes(q) || isNo(q))
    const held = chain && !!query && !!answer
    if (held) {
      // In the history the model sees now; on screen only when this one lands.
      const first = lastAnswer.current ?? answer!
      pastRef.current = [...pastRef.current, { q: query, a: summarize(first), card: first }].slice(-8)
      setChainQ(q)
    } else {
      commitTurn()
      setQuery(q)
    }
    setText('')
    // "Obrigado" / "até mais" — the end of the conversation: answer here
    // (nothing sent, nothing spent), say it, then close instead of listening
    // again (owner, 2026-11).
    if (!replying && isGoodbye(q)) {
      const turn = turnSeq.current
      const bye = t('ask.bye')
      setAnswer({ kind: 'say', text: bye })
      const said = viaVoice.current && roof.speak && !isFree ? roofSay(bye, lang) : new Promise<void>((r) => setTimeout(r, 1200))
      void said.then(async () => {
        if (!openRef.current || turn !== turnSeq.current) return
        // The conversation's end gets the stop chime too (owner, 2026-11-14):
        // the mic is already off here, so cancel() wouldn't play it. Timing
        // matters on iOS, or the chime is cut to silence some of the time:
        // wait out the switch-off Roof's voice player schedules when it ends
        // (expo-audio, +0.1 s), and close only AFTER the chime — closing
        // re-arms the Home's wake listener, which reconfigures the session.
        await new Promise((r) => setTimeout(r, 250))
        if (!openRef.current || turn !== turnSeq.current) return
        playChime('stop')
        await new Promise((r) => setTimeout(r, CHIME_MS + 150))
        if (openRef.current && turn === turnSeq.current) closeSheet()
      })
      return
    }
    if (!held) setAnswer(null)
    setBusy(true)
    try {
      // "What can you do?" — the capabilities screen, right here (instant,
      // nothing sent or spent).
      thenRef.current = ''
      // Who / where / after what, for a request Roof can't do (codes only).
      setGapContext({ via: viaVoice.current ? 'voice' : 'typed', screen: pathname, prev: /^[a-z_]{1,40}$/.test(askedRef.current) ? askedRef.current : '' })
      // What this request turned out to be, for the usage count (never the words).
      askedRef.current = 'reply'
      const here = await answerHere(q, prev)
      if (!here && isCapabilitiesAsk(q)) askedRef.current = 'capabilities'
      const a: Answer = here ?? (isCapabilitiesAsk(q) ? { kind: 'capabilities' } : await understandAndAct(q))
      track('roof.asked', {
        intent: askedRef.current,
        via: viaVoice.current ? 'voice' : 'typed',
        where: 'phone',
        ok: a.kind !== 'error' && a.kind !== 'unknown' && askedRef.current !== 'unknown' && askedRef.current !== 'none',
        chained: chain,
      })
      // The voice is fetched from the moment the answer is known — not after
      // the card is on screen (owner, 2026-11-22: text first, voice later).
      if (viaVoice.current && !isFree && roof.speak) roofPrefetch(spokenText(a), lang)
      if (held) {
        // The first result gets at least a few seconds on screen in full.
        const wait = 3000 - (Date.now() - shownAt.current)
        if (wait > 0) await new Promise((r) => setTimeout(r, wait))
        setPast(pastRef.current)
        setQuery(q)
        setChainQ('')
      }
      setAnswer(a)
      // A second task said in the same breath ("…e marca dentista sexta"): asked
      // next, as its own request — unless this answer is itself a question.
      const next = !awaiting(a) && a.kind !== 'error' && a.kind !== 'unknown' && chained.current < 2 ? thenRef.current : ''
      thenRef.current = ''
      chained.current = next ? chained.current + 1 : 0
      // Plus only (review 2026-11-14 M10): a free household's spoken request
      // gets its answer on screen and the mic stays off until tapped.
      if (viaVoice.current && !isFree) {
        const turn = ++turnSeq.current
        const said = roof.speak ? roofSay(spokenText(a), lang) : Promise.resolve()
        // Then listen for the next thing — unless the sheet closed, something
        // newer started, or the person is typing. 350 ms: Roof's voice player
        // lets expo-audio deactivate the iOS session ~0.1 s after it ends;
        // the new mic must start after that, not under it.
        void said.then(() => {
          setTimeout(() => {
            if (!openRef.current || turn !== turnSeq.current || textRef.current.trim()) return
            if (next) {
              void submitRef.current?.(next, true)
              return
            }
            setFollow(true)
            // Until the sheet closes or a goodbye — not a few seconds. QUIET:
            // it's the same conversation carrying on, so no new chime (a
            // second chime read as a glitch / a restart — owner, 2026-11-13);
            // the "listening" strip under the answer says it.
            // It ends after ~10 s without a word (useVoice FOLLOW_IDLE_MS).
            void voice.start({ quiet: true, untilCancel: true })
          }, 350)
        })
      }
      else if (next) {
        const turn = turnSeq.current
        setTimeout(() => {
          if (openRef.current && turn === turnSeq.current && !textRef.current.trim()) void submitRef.current?.(next, true)
        }, 600)
      }
      // The answer may have changed what the model should see next turn.
      void loadContext().catch(() => {})
    } catch {
      if (held) {
        setPast(pastRef.current)
        setQuery(q)
      }
      setAnswer({ kind: 'error' })
    } finally {
      setChainQ('')
      setBusy(false)
    }
  }

  async function understandAndAct(q: string): Promise<Answer> {
    {
      const ctx = await (ctxRef.current ?? loadContext()).catch(() => loadContext())
      const [y, m, d] = today.split('-').map(Number)
      const { intent, source, quota: q2, then } = await understandWithSource(q, {
        openItems: ctx.open.lines,
        today,
        weekday: new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long' }),
        lang,
        stores: ctx.stores.map((s) => s.name),
        members: profiles.map((p) => p.display_name),
        budgets: ctx.budgets,
        pets: ctx.pets,
        petKinds: ctx.petKinds,
        petTasks: ctx.petTasks,
        categories: ctx.categories,
        documents: ctx.documents,
        recentEntries: ctx.recent.entries,
        events: ctx.recent.events,
        me: profile?.display_name ?? '',
        history: pastRef.current.map(({ q, a }) => ({ q, a })),
      })
      if (q2) setQuota(q2)
      thenRef.current = then ?? ''
      askedRef.current = intent?.intent ?? 'none'
      // How often the app had to guess or ask (codes only, never the words).
      if (intent && source === 'local') reportGap(intent.intent, 'local_guess', lang)
      if (intent && (intent.intent === 'need_detail' || intent.intent === 'needs_update')) reportGap(intent.about, intent.intent, lang)
      return await act(intent, ctx.stores)
    }
  }

  useEffect(() => {
    submitRef.current = submit
  })

  // The latest answer shown — kept after it moves up into the conversation —
  // so "desfaz isso" can press its Undo by voice (undo_last, review M9).
  const lastAnswer = useRef<Answer | null>(null)
  // When the answer on screen appeared, and the second task being worked out under it.
  const shownAt = useRef(0)
  const [chainQ, setChainQ] = useState('')
  const chainRef = useRef(false)
  chainRef.current = !!chainQ
  const thenRef = useRef('')
  const askedRef = useRef('')
  const pathname = usePathname()
  const chained = useRef(0)
  useEffect(() => {
    if (answer) lastAnswer.current = answer
  }, [answer])
  useEffect(() => {
    if (answer?.kind) shownAt.current = Date.now()
  }, [answer?.kind, query])

  /** The Undo behind an answer's button, or null (none, or already undone).
   *  The answer views' Undo buttons and "desfaz isso" both run this. */
  function undoOf(a: Answer): (() => Promise<void>) | null {
    if (!('undone' in a) || a.undone) return null
    switch (a.kind) {
      case 'added':
        if (!a.res.added.length) return null
        return async () => {
          await undoAdd(a.res.added.map((i) => i.id), a.res.createdStore ? a.res.store?.id : undefined)
          invalidateCache('hub:shopping')
        }
      case 'marked':
        if (!a.hits.length) return null
        return async () => {
          const ids = a.hits.map((i) => i.id)
          if (a.mode === 'check') await uncheckItems(ids)
          else await restoreItems(a.hits)
          invalidateCache('hub:shopping')
        }
      case 'event':
        return async () => {
          await deleteEvent(a.ev.id)
          invalidateCache('hub:today')
        }
      case 'moved':
        return async () => {
          await restoreEvent(a.before)
          invalidateCache('hub:today')
        }
      case 'removedEvent':
        return async () => {
          await unremoveEvent(a.ev)
          invalidateCache('hub:today')
        }
      case 'money':
        return () => deleteEntry(a.res.entryId)
      case 'action': {
        const u = a.undo
        if (!u) return null
        return async () => {
          await u.run()
          invalidateCache('hub:today')
          invalidateCache('hub:shopping')
        }
      }
      default:
        return null
    }
  }

  /** Run an answer's Undo and show it undone (a failure says so). */
  /** Replace `old` where it is shown: the answer on screen, or a card kept up
   *  in the conversation (then its one-line summary follows). */
  function swap(old: Answer | null, next: Answer | null) {
    const i = old ? pastRef.current.findIndex((p) => p.card === old) : -1
    if (i < 0) {
      setAnswer(next)
      return
    }
    pastRef.current = pastRef.current.map((p, k) => (k !== i ? p : next ? { q: p.q, a: summarize(next), card: next } : { q: p.q, a: p.a }))
    setPast(pastRef.current)
  }

  async function undoAnswer(a: Answer) {
    const run = undoOf(a)
    if (!run) return
    try {
      await run()
      swap(a, { ...a, undone: true } as Answer)
    } catch {
      swap(a, { kind: 'error' })
    }
  }

  /** Carry one understood request out and say what happened. */
  async function act(intent: Intent | null, stores: ShoppingStore[]): Promise<Answer> {
    const me = profile ?? null
    switch (intent?.intent) {
      case undefined:
        return { kind: 'say', text: t('ask.unknown') }
      case 'undo_last': {
        // The previous answer's own Undo — shown again, undone.
        const last = lastAnswer.current
        const run = last ? undoOf(last) : null
        if (!last || !run) return { kind: 'say', text: t('ask.nothingToUndo') }
        await run()
        return { ...last, undone: true } as Answer
      }
      case 'unknown':
        return { kind: 'say', text: intent.reply || t('ask.unknown') }
      case 'add_items': {
        // A store that exists → straight in. Otherwise ASK (never invent a
        // list from a word like "compras"), offering to create a named one.
        const store = matchStore(intent.store, stores)
        // "Geral" SAID (and no list of that name) is the list with no store —
        // asking again looped forever (owner, 2026-11-22).
        const general = !store && isGeneralList(intent.store, t('ask.anyStore'))
        if (store || general || (!intent.store && stores.length === 0)) {
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
        const create = async (endTime?: string): Promise<Answer> => {
          const ev = await addEvent(intent.title, intent.date, intent.time, owner, endTime ? { ...intent.opts, endTime } : intent.opts)
          invalidateCache('hub:today')
          // The extras said ("toda terça", "lembrete 1h antes") show on the card.
          const extras = [
            owner && owner.email !== me?.email ? owner.display_name : '',
            recurrenceLabel(t, ev.recurrence),
            reminderLabel(t, ev.reminder_minutes),
            ev.location ?? '',
          ].filter(Boolean)
          return { kind: 'event', ev, who: extras.length ? extras.join(' · ') : null, undone: false }
        }
        // All-day, special dates and multi-day spans: as before.
        const o = intent.opts
        const timed = /^\d{2}:\d{2}$/.test(intent.time)
        if (!timed || (o?.kind && o.kind !== 'event') || (o?.end && o.end > intent.date)) return create()
        const mins = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))
        const from = mins(intent.time)
        // The carry-on of a question is any Answer (the event card), though
        // the action card's types only know their own kind.
        const carry = <A extends unknown[]>(f: (...a: A) => Promise<Answer>) => f as unknown as (...a: A) => Promise<ActionAnswer>
        // Something of theirs (or the whole household's) in that window →
        // say so and wait for a yes (owner, 2026-11-22).
        const place = async (endTime: string): Promise<Answer> => {
          const to = mins(endTime)
          const agenda = await agendaFor(intent.date, intent.date, '', 'all', '', me, profiles, today)
          const busy = agenda.rows.filter((r) => {
            if (r.kind !== 'event' || !r.start) return false
            if (r.ownerEmail && owner && r.ownerEmail !== owner.email) return false
            const a = mins(r.start)
            const b = r.end && mins(r.end) > a ? mins(r.end) : a + 60
            return a < to && b > from
          })
          if (!busy.length) return create(endTime)
          return overlapAsk(
            env,
            intent.title,
            busy.map((r) => ({ title: r.title, start: r.start!, who: profiles.find((p) => p.email === r.ownerEmail)?.display_name?.split(' ')[0] ?? '' })),
            carry(() => create(endTime)),
          )
        }
        if (o?.endTime && o.endTime > intent.time) return place(o.endTime)
        // No end said: ask, instead of a silent 1 h (owner, 2026-11-22).
        const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
        const when = `${dayWords(intent.date)}, ${formatTime(intent.time, locale)}`
        return durationAsk(env, intent.title, when, carry((m: number) => place(hm(Math.min(23 * 60 + 59, from + m)))))
      }
      case 'move_event': {
        const who = eventWho(intent.person, profiles)
        const r = await moveEvent(intent.title, intent.date, intent.newDate, intent.time, today, intent.ref, who)
        if (r.ok) {
          invalidateCache('hub:today')
          return { kind: 'moved', ev: r.ev, before: r.before, undone: false }
        }
        if (r.reason === 'recurring') {
          return recurringChoice(env, 'move', r.occ.event, r.occ.start, { to: intent.newDate, time: intent.time })
        }
        if (r.reason === 'external') return { kind: 'say', text: t('ask.editExternal', { title: r.options[0]?.title ?? intent.title }) }
        reportGap('move_event', r.reason, lang)
        // Several fit (two kids' dentists): ask which, as tappable rows.
        if (r.reason === 'ambiguous' && r.occs?.length) {
          return whichEvent(env, r.occs, (o) => moveAnswer(env, o, intent.newDate, intent.time), who)
        }
        // No day said: the coming weeks were searched (same words as remove).
        if (!intent.date) {
          const names = r.options.slice(0, 4).map((e) => `${e.title} (${whenLabel(e)})`).join(', ')
          return { kind: 'say', text: r.reason === 'ambiguous' ? t('ask.removeWhich', { names }) : t('ask.removeNotFoundSoon', { title: intent.title }) }
        }
        const day = dayWords(intent.date)
        const names = r.options.slice(0, 4).map((e) => e.title).join(', ')
        return {
          kind: 'say',
          text:
            r.reason === 'ambiguous'
              ? t('ask.moveWhich', { day, names })
              : r.options.length
                ? t('ask.moveNotFoundSome', { title: intent.title, day, names })
                : t('ask.moveNotFound', { day }),
        }
      }
      case 'remove_event': {
        const who = eventWho(intent.person, profiles)
        const r = await removeEvent(intent.title, intent.date, today, intent.ref, who)
        if (r.ok) {
          invalidateCache('hub:today')
          return { kind: 'removedEvent', ev: r.ev, undone: false }
        }
        if (r.reason === 'recurring') return recurringChoice(env, 'remove', r.occ.event, r.occ.start)
        reportGap('remove_event', r.reason, lang)
        if (r.reason === 'ambiguous' && r.occs?.length) return whichEvent(env, r.occs, (o) => removeAnswer(env, o), who)
        const day = intent.date ? dayWords(intent.date) : ''
        const names = r.options.slice(0, 4).map((e) => (intent.date ? e.title : `${e.title} (${whenLabel(e)})`)).join(', ')
        const title = r.options[0]?.title ?? intent.title
        return {
          kind: 'say',
          text:
            r.reason === 'external'
              ? t('ask.removeExternal', { title })
              : r.reason === 'ambiguous'
                  ? t('ask.removeWhich', { names })
                  : !intent.date
                    ? t('ask.removeNotFoundSoon', { title: intent.title })
                    : r.options.length
                      ? t('ask.removeNotFoundSome', { title: intent.title, day, names })
                      : t('ask.removeNotFound', { day }),
        }
      }
      case 'add_money': {
        const res = await addMoney(intent.title, intent.amount, intent.type, intent.date, intent.budget, me?.email ?? '')
        // Several budgets and none clearly named: ask which (owner, 2026-11).
        if (!res.ok && res.reason === 'choose_budget') {
          return {
            kind: 'chooseBudget',
            budgets: res.budgets,
            pending: { title: intent.title, amount: intent.amount, type: intent.type, date: intent.date },
          }
        }
        if (!res.ok) {
          reportGap('add_money', res.reason, lang)
          return {
            kind: 'say',
            text: res.reason === 'no_budget' ? t('ask.noBudget') : t('ask.noPeriod', { budget: res.budget?.name ?? '' }),
          }
        }
        return { kind: 'money', res, type: intent.type, amount: intent.amount, title: intent.title, undone: false }
      }
      case 'money_summary':
        // Narrowed to a category or one thing: the newer per-category answer.
        if (intent.category || intent.title || intent.kind === 'income' || (intent.kind === 'expense' && (intent.person || intent.range)))
          return (await actMore(intent, env)) ?? { kind: 'error' }
        // The budget as a whole over a span or for one member: the same card
        // (received, spent, balance) — it used to answer the spending alone.
        if (intent.person || intent.range) {
          const o = await moneyOverview(intent, env)
          return o.lines.length ? { kind: 'summary', lines: o.lines, head: o.head } : { kind: 'say', text: t('ask.moneyNoneYet') }
        }
        {
          // An earlier period asked about: only budgets that HAD that period.
          const lines = (await moneySummary(intent.budget, today, intent.at)).filter((l) => !intent.at || l.month)
          return lines.length ? { kind: 'summary', lines } : { kind: 'say', text: t('ask.noSuchPeriod') }
        }
      case 'send_nudge': {
        const to = intent.person ? findMember(intent.person, profiles) : null
        // Said like one of the household's presets: send it with that emoji.
        const presets = await fetchPingPresets().catch(() => [])
        const preset = presets.find((p) => presetText(p, t).trim().toLowerCase() === intent.message.trim().toLowerCase())
        const urgent = !!intent.urgent || !!preset?.high_priority
        return {
          kind: 'nudge',
          message: intent.message,
          to,
          sent: false,
          sending: false,
          emoji: urgent ? '🆘' : (preset?.emoji ?? '📣'),
          urgent,
          pingKind: urgent ? 'help' : (preset?.preset_key ?? 'custom'),
        }
      }
      case 'pets_due': {
        // "quais são as rotinas da Lola?" — the whole routine (askActions).
        if (intent.view === 'routine') return (await actMore(intent, env)) ?? { kind: 'error' }
        return { kind: 'pets', p: await petsDue(today, intent.pet, intent.view === 'overdue' ? 'overdue' : undefined) }
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
      case 'app_help':
        // About Roof itself → the capabilities screen, not a paragraph.
        if (intent.topic === 'roof') return { kind: 'capabilities' }
        return { kind: 'help', topic: intent.topic, text: intent.reply }
      case 'start_game': {
        // Straight to Games with that game's start sheet open (owner,
        // 2026-11-13: "start a Perguntas & Tortadas match").
        closeSheet()
        const g = ['hangman', 'battleship', 'quiz', 'bingo'].includes(intent.game) ? intent.game : ''
        router.push((g ? `/games?start=${g}` : '/games') as never)
        return { kind: 'say', text: '' }
      }
      case 'open_app': {
        // Money opens ON the budget and period asked for — "abre o orçamento
        // deste mês" used to stop at the list of budgets (owner, 2026-11-22).
        if (intent.app === 'budget') {
          const { budgets, months } = await budgetsWithMonths()
          const pathOf = (b: Budget) => {
            const m = periodForBudget(b, months, intent.date || today)
            return m ? `/budget/${b.id}/${m.id}` : `/budget/${b.id}`
          }
          const b = pickBudget(budgets, intent.budget ?? '')
          if (b) {
            go(pathOf(b))
            return { kind: 'say', text: '' }
          }
          if (budgets.length > 1) {
            return {
              kind: 'action',
              headline: t('ask.whichBudgetOpen'),
              summary: t('ask.whichBudgetOpen'),
              undone: false,
              rows: budgets.map((x) => ({
                emoji: '💰',
                title: x.name,
                pick: (async () => {
                  go(pathOf(x))
                  return { kind: 'say', text: '' }
                }) as unknown as () => Promise<ActionAnswer>,
              })),
            }
          }
        }
        const route = APP_ROUTE[intent.app]
        if (route) {
          closeSheet()
          router.push(route as never)
        }
        return { kind: 'say', text: '' }
      }
      case 'need_detail':
        // Understood, but a detail was missing: say what to add, never guess.
        return { kind: 'say', text: t(needKey(intent.about)) }
      case 'needs_update':
        return { kind: 'say', text: t('ask.needsUpdate') }
      case 'limit_reached':
        // Out of free requests this month: the way to Plus, nothing guessed.
        return {
          kind: 'action',
          headline: t('ask.limitHead', { n: intent.cap }),
          sub: t('ask.limitSub', { n: intent.cap }),
          rows: [],
          summary: 'Monthly free assistant limit reached.',
          open: { label: t('settings.getPlus'), path: '/paywall' },
          undone: false,
        }
      default:
        return (intent ? await actMore(intent, env) : null) ?? { kind: 'say', text: t('ask.unknown') }
    }
  }

  /** What the newer actions (askActions.ts) need from the sheet. */
  const env: ActEnv = {
    t: t as ActEnv['t'],
    lang,
    locale,
    today,
    me: profile ?? null,
    profiles,
    dayWords,
    whenLabel,
    invalidate: invalidateCache,
    reportGap: (intent, reason) => reportGap(intent, reason, lang),
  }

  // A second tap on a choice row while the first is still running would run
  // it twice (two moves, two deletions) — `busy` state lags a render behind.
  const choosing = useRef(false)
  async function runChoice(run: () => Promise<ActionAnswer>) {
    if (choosing.current) return
    choosing.current = true
    setBusy(true)
    try {
      setAnswer(await run())
    } catch {
      setAnswer({ kind: 'error' })
    } finally {
      choosing.current = false
      setBusy(false)
    }
  }

  async function rescope(old: Extract<Answer, { kind: 'agenda' }>, scope: Scope) {
    const a = old.a
    try {
      swap(old, { kind: 'agenda', a: await agendaFor(a.date, a.end, a.label, scope, '', profile ?? null, profiles, today) })
    } catch {
      swap(old, { kind: 'error' })
    }
  }

  function go(path: string) {
    closeSheet()
    // "liga pro Léo" hands the number to the phone's dialer.
    if (path.startsWith('tel:')) void Linking.openURL(path).catch(() => {})
    else router.push(path as never)
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

  async function budgetChosen(a: Extract<Answer, { kind: 'chooseBudget' }>, budget: Budget) {
    setBusy(true)
    try {
      const p = a.pending
      const res = await addMoney(p.title, p.amount, p.type, p.date, '', profile?.email ?? '', budget.id)
      if (!res.ok) {
        setAnswer({ kind: 'say', text: res.reason === 'no_period' ? t('ask.noPeriod', { budget: budget.name }) : t('ask.noBudget') })
      } else {
        setAnswer({ kind: 'money', res, type: p.type, amount: p.amount, title: p.title, undone: false })
      }
    } catch {
      setAnswer({ kind: 'error' })
    } finally {
      setBusy(false)
    }
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
      await sendPing(a.pingKind, a.emoji, a.message, a.to ? [a.to.email] : null, a.urgent, { source: 'assistant' })
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

  /** The card for one answer — the one on screen, or one kept in the conversation. */
  const card = (answer: Answer | null) =>
            answer?.kind === 'added' ? (
              <AddedView
                res={answer.res}
                undone={answer.undone}
                onUndo={() => undoAnswer(answer)}
                onOpen={() => go('/shopping')}
              />
            ) : answer?.kind === 'agenda' ? (
              <AgendaView
                a={answer.a}
                today={today}
                locale={locale}
                memberEmails={memberEmails}
                dayWords={dayWords}
                onScope={(sc) => rescope(answer, sc)}
                onOpen={() => go(`/calendar?date=${answer.a.date}`)}
              />
            ) : answer?.kind === 'chooseBudget' ? (
              <ChooseBudgetView
                amount={answer.pending.amount}
                type={answer.pending.type}
                title={answer.pending.title}
                budgets={answer.budgets}
                onPick={(b) => budgetChosen(answer, b)}
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
                onUndo={() => undoAnswer(answer)}
                onOpen={() => go('/shopping')}
              />
            ) : answer?.kind === 'event' ? (
              <EventView
                title={answer.ev.title}
                when={whenLabel(answer.ev)}
                who={answer.who}
                undone={answer.undone}
                onUndo={() => undoAnswer(answer)}
                onOpen={() => go(`/calendar?date=${answer.ev.start_date}`)}
              />
            ) : answer?.kind === 'moved' ? (
              <EventView
                headline={answer.undone ? t('ask.moveUndone') : t('ask.eventMoved')}
                title={answer.ev.title}
                when={whenLabel(answer.ev)}
                who={null}
                undone={answer.undone}
                onUndo={() => undoAnswer(answer)}
                onOpen={() => go(`/calendar?date=${answer.undone ? answer.before.start_date : answer.ev.start_date}`)}
              />
            ) : answer?.kind === 'removedEvent' ? (
              <EventView
                headline={answer.undone ? t('ask.removeUndone') : t('ask.eventRemoved')}
                title={answer.ev.title}
                when={whenLabel(answer.ev)}
                who={null}
                undone={answer.undone}
                onUndo={() => undoAnswer(answer)}
                onOpen={() => go(`/calendar?date=${answer.ev.start_date}`)}
              />
            ) : answer?.kind === 'money' ? (
              <MoneyView
                type={answer.type}
                amount={answer.amount}
                title={answer.title || t(answer.type === 'income' ? 'entry.income' : 'entry.expense').replace(/^[−+＋-]\s*/, '')}
                where={`${answer.res.budget.name} · ${periodLabel(answer.res.budget.period, answer.res.month.start_date)}`}
                icon={answer.type === 'income' ? '💵' : categoryById(answer.res.category, [], []).icon}
                undone={answer.undone}
                onUndo={() => undoAnswer(answer)}
                onOpen={() => go(`/budget/${answer.res.budget.id}/${answer.res.month.id}`)}
              />
            ) : answer?.kind === 'summary' ? (
              <SummaryView
                lines={answer.lines}
                head={answer.head}
                label={(l) => (l.month ? `${l.budget.name} · ${periodLabel(l.budget.period, l.month.start_date)}` : l.budget.name)}
                onOpen={() => go('/budget')}
              />
            ) : answer?.kind === 'nudge' ? (
              <NudgeView
                emoji={answer.emoji}
                urgent={answer.urgent}
                message={answer.message}
                to={answer.to?.display_name.split(' ')[0] ?? t('ask.everyoneLower')}
                sent={answer.sent}
                sending={answer.sending}
                onSend={() => sendNudge(answer)}
                onCancel={() => swap(answer, null)}
              />
            ) : answer?.kind === 'action' ? (
              <ActionView
                headline={answer.undone && answer.undo ? answer.undo.headline : answer.headline}
                sub={answer.undone ? null : answer.sub}
                rows={answer.undone ? [] : answer.rows.map((r) => (r.pick ? { ...r, onPress: () => void runChoice(r.pick!) } : r))}
                filters={answer.undone ? null : answer.filters}
                quiet={
                  answer.undo && !answer.undone
                    ? {
                        label: t('ask.undo'),
                        undo: true,
                        onPress: () => undoAnswer(answer),
                      }
                    : answer.choices?.[1]
                      ? { label: answer.choices[1].label, onPress: () => runChoice(answer.choices![1].run) }
                      : answer.choices?.[0] && answer.open
                        ? { label: answer.open.label, onPress: () => go(answer.open!.path) }
                        : null
                }
                main={
                  answer.choices?.[0]
                    ? { label: answer.choices[0].label, onPress: () => runChoice(answer.choices![0].run) }
                    : answer.open
                      ? { label: answer.open.label, onPress: () => go(answer.open!.path) }
                      : null
                }
              />
            ) : answer?.kind === 'pets' ? (
              <PetsView p={answer.p} onOpen={() => go('/pets')} onToggle={(id, done) => setDailyDone(id, today, done)} />
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
                    ? swap(answer, { ...answer, mode: 'even' })
                    : openEvenSplit(answer.amount, answer.people, answer.tip)
                }
                onItems={openItemSplit}
                onOpenEven={() => openEvenSplit(answer.amount, answer.people, answer.tip)}
              />
            ) : answer?.kind === 'discount' ? (
              <DiscountView amount={answer.amount} percent={answer.percent} onOpen={() => go('/calc/discount')} />
            ) : answer?.kind === 'capabilities' ? (
              <CapabilitiesView onTry={(p) => void submit(p)} />
            ) : answer?.kind === 'help' ? (
              <HelpView topic={answer.topic} text={answer.text} onOpen={(r) => go(r)} />
            ) : answer?.kind === 'say' ? (
              answer.text ? <Headline text={answer.text} /> : null
            ) : answer ? (
              <Headline text={t('ask.error')} />
            ) : null

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={closeSheet} onShow={autoListen}>
      <View style={{ flex: 1 }} onLayout={onRootLayout}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }]} onPress={closeSheet} />
        <Animated.View
          style={{
            transform: [{ translateY: dragY }],
            marginTop: 'auto',
            // On a Face ID iPhone the sheet floats with the bottom button's
            // geometry (useScreenCorner): 16pt sides, half-inset bottom, 40pt
            // bottom corners. With the keyboard up it rides on the keyboard.
            marginBottom: corner ? lift + (floatingOnKeyboard ? sp.sm : corner.bottom) : lift,
            marginHorizontal: corner?.side ?? 0,
            // Capped so a strip of backdrop always shows above it — tap there
            // to close, even with a long conversation.
            maxHeight: room * 0.84 - (corner?.bottom ?? 0),
            backgroundColor: c.sheet,
            borderTopLeftRadius: corner ? 30 : sheetRadius,
            borderTopRightRadius: corner ? 30 : sheetRadius,
            borderBottomLeftRadius: corner && !floatingOnKeyboard ? corner.radius : corner ? 24 : 0,
            borderBottomRightRadius: corner && !floatingOnKeyboard ? corner.radius : corner ? 24 : 0,
            paddingTop: sp.sm,
            paddingBottom: corner ? sp.md : clearOfBars ? sp.md : bottomGap,
          }}
        >
          {/* The drag strip: the handle plus a generous full-width zone. */}
          <View
            {...drag.panHandlers}
            accessibilityRole="adjustable"
            accessibilityLabel={t('common.close')}
            accessibilityActions={[{ name: 'activate' }]}
            onAccessibilityAction={() => closeSheet()}
            style={{ alignItems: 'center', justifyContent: 'center', height: 30, marginTop: -sp.sm, marginBottom: 2 }}
          >
            <View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: c.textFaint }} />
          </View>

          <ScrollView
            ref={scrollRef}
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: sp.md }}
            keyboardShouldPersistTaps="handled"
            // A conversation grows downwards: keep the newest turn in view.
            onContentSizeChange={() => {
              if (pastRef.current.length || chainRef.current) scrollRef.current?.scrollToEnd({ animated: true })
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
                    {turn.card ? (
                      <View style={{ marginTop: sp.sm }}>{card(turn.card)}</View>
                    ) : turn.a ? (
                      <View style={[s.answerRow, { marginTop: sp.sm }]}>
                        <Orb size={22} />
                        <Txt style={{ flex: 1, fontSize: 14.5, lineHeight: 20, color: c.textMuted }}>{turn.a}</Txt>
                      </View>
                    ) : null}
                  </View>
                ))}
              </>
            ) : null}

            {fullHearing ? (
              <View style={{ paddingVertical: sp.lg, gap: sp.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
                  <Orb />
                  <Txt style={{ fontFamily: fonts.semibold, fontSize: 13, letterSpacing: 1, color: warming ? c.textMuted : c.accent, textTransform: 'uppercase' }}>
                    {warming ? t('ask.getReady') : t('ask.listening')}
                  </Txt>
                </View>
                {heardText ? (
                  <Txt style={{ fontFamily: fonts.display, fontSize: 26, lineHeight: 33, color: c.text }}>{heardText}</Txt>
                ) : (
                  <View style={{ gap: 4 }}>
                    <Txt style={{ fontSize: 14, color: c.textMuted }}>{tip.kind === 'help' ? t('ask.helpTip') : t('ask.tryLabel')}</Txt>
                    <Txt style={{ fontFamily: fonts.display, fontSize: 26, lineHeight: 33, color: c.textFaint }}>
                      “{tip.kind === 'help' ? t('ask.capsAsk') : t(tip.key, { name: otherName })}”
                    </Txt>
                  </View>
                )}
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
                {/* Opened with a request already typed (an app's "Ask Roof"
                    examples): the Home's generic examples would only distract. */}
                {seed ? null : (
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
                    {/* Everything Roof can do, as a friendly screen. */}
                    <Pressable
                      onPress={() => submit(t('ask.capsAsk'))}
                      style={({ pressed }) => [s.example, { borderColor: c.accent, opacity: pressed ? 0.6 : 1 }]}
                    >
                      <Sparkles size={15} color={c.accent} />
                      <Txt style={{ flex: 1, fontSize: 14.5, fontFamily: fonts.semibold, color: c.accent }}>{t('ask.capsSee')}</Txt>
                    </Pressable>
                  </View>
                )}
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

            {fullHearing ? null : busy && !chainQ ? (
              <View style={s.answerRow}>
                <Orb />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, paddingTop: 4 }}>
                  <ActivityIndicator color={c.textMuted} size="small" />
                  <Txt variant="muted">{t('ask.thinking')}</Txt>
                </View>
              </View>
            ) : (
              card(answer)
            )}
            {followUp ? (
              <View style={[s.followStrip, { backgroundColor: c.accentSoft }]}>
                <Orb size={22} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt style={{ fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1, color: warming ? c.textMuted : c.accent, textTransform: 'uppercase' }}>
                    {warming ? t('ask.getReady') : t('ask.listening')}
                  </Txt>
                  <Txt numberOfLines={2} style={{ fontSize: 15.5, lineHeight: 21, color: voice.transcript ? c.text : c.textFaint }}>
                    {voice.transcript || t('ask.followHint')}
                  </Txt>
                </View>
              </View>
            ) : null}
            {chainQ ? (
              // The second task of the same request, being worked out under the
              // first result (which stays up until this one lands).
              <View style={{ marginTop: sp.lg, gap: sp.sm }}>
                <Txt style={{ fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1, color: c.textMuted, textTransform: 'uppercase' }}>{t('ask.chainNext')}</Txt>
                <View style={[s.bubble, { backgroundColor: c.surface }]}>
                  <Txt style={{ fontSize: 15.5, lineHeight: 21 }}>{chainQ}</Txt>
                </View>
                <View style={s.answerRow}>
                  <Orb />
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, paddingTop: 4 }}>
                    <ActivityIndicator color={c.textMuted} size="small" />
                    <Txt variant="muted">{t('ask.thinking')}</Txt>
                  </View>
                </View>
              </View>
            ) : null}
          </ScrollView>

          {/* Free plan: how many of this month's requests are left. */}
          {quota && 'cap' in quota && quota.used < quota.cap ? (
            <Pressable onPress={() => go('/paywall')} accessibilityRole="button" style={{ paddingHorizontal: sp.lg, paddingTop: sp.xs }}>
              <Txt style={{ color: c.textMuted, fontSize: 12.5, textAlign: 'center' }}>
                {t('ask.quotaLeft', { n: quota.cap - quota.used, cap: quota.cap })}
              </Txt>
            </Pressable>
          ) : null}

          {/* the input — always at the foot, ready for the next request */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, paddingHorizontal: sp.lg, paddingTop: sp.sm }}>
            <View style={[s.input, { backgroundColor: c.surface, borderColor: c.border, borderBottomLeftRadius: innerCurve }]}>
              <Sparkles size={18} color={c.accent} />
              <TextInput
                ref={inputRef}
                value={text}
                onChangeText={(v) => {
                  // Typing while the mic is open: the keyboard wins.
                  if (v && voiceOn) cancelVoice()
                  setText(v)
                }}
                placeholder={t('ask.inputPlaceholder')}
                placeholderTextColor={c.textFaint}
                // Keyboard up only from a TAP (the dock's arrow, typeToo); a call by
                // voice ("Ei Roof") opens listening, keyboard down (owner, 2026-11).
                autoFocus={!seed && (typeToo || (!listen && !spoken))}
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
                onPress={wakeLive ? onWakeStop : voice.stop}
                style={[s.send, { backgroundColor: c.action, borderBottomRightRadius: innerCurve }]}
              >
                <ListeningBars color={c.onAction} />
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
                  setFollow(false)
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
        </Animated.View>
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
  followStrip: { flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: sp.lg, padding: sp.md, borderRadius: 18 },
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
