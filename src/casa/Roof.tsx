// Roof on the home device. A dock at the bottom like the phone (orb, name, a
// green breathing dot while "Ei Roof" listens, mute, up arrow). Woken by
// voice or tapped, the dock GROWS into a near-full-screen stage: glowing
// edges while it listens, the words in very large type, then a giant
// confirmation card (✓, the sentence, Desfazer / Ver) that fades after ~8 s.
// After answering a spoken request it keeps listening, like the phone.
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, Check, ChevronRight, Eye, Keyboard, Mic, MicOff, SendHorizontal, Undo2, X } from 'lucide-react'
import { useI18n } from '../hooks/useI18n'
import { act, localClose, localOpen, summarize, understand, type AnswerRow, type AskEnv, type Done, type OpenTarget, type Outcome, type Tone } from './assistant'
import type { HubData } from './data'
import { chime, speak, stopSpeaking, tick } from './sound'
import { CheckMark, Grow, Orb, PlusTag, type GrowHandle } from './ui'
import { isGoodbye, RoofEars, speechSupported, type EarsState } from './wake'
import { Capabilities, isCapabilitiesAsk, nextTip, type Tip } from './roofTips'
import WhoPicker from './WhoPicker'
import { GRAD, grad, lsGet, lsSet } from './util'

const WAKE_KEY = 'casa.wake'
const GREEN = '#3f8f6a'
const ANSWER_MS = 8000
/** A longer read (many rows) or something to tap (which one? / send?). */
function answerMs(o: Done | { kind: 'bye'; text: string }): number {
  if (o.kind !== 'done') return ANSWER_MS
  if (o.choices?.length || o.rows?.some((r) => r.pick)) return 30_000
  return (o.rows?.length ?? 0) > 3 ? 15_000 : ANSWER_MS
}

const TONE: Record<Tone, readonly string[]> = {
  lists: GRAD.lists,
  calendar: GRAD.calendar,
  event: GRAD.event,
  pets: GRAD.pet,
  money: GRAD.money,
  orb: ['#7B5CF0', '#169C8C'],
  birthday: GRAD.birthday,
  family: GRAD.family,
  nudge: GRAD.nudge,
  weather: GRAD.weather,
  calc: GRAD.calc,
}

type Stage =
  | { k: 'listen' }
  | { k: 'type' }
  | { k: 'think'; q: string }
  | { k: 'answer'; o: Done | { kind: 'bye'; text: string }; follow: boolean }
  | { k: 'pick'; o: Extract<Outcome, { kind: 'pick' }> }
  | { k: 'undone' }
  | { k: 'caps' }

export default function Roof({
  data,
  full,
  today,
  me,
  refresh,
  onOpenPanel,
  onLocked,
  hidden,
  onOpenChange,
}: {
  data: HubData
  full: boolean
  today: string
  me: { email: string; name: string }
  refresh: () => void
  onOpenPanel: (id: OpenTarget) => void
  onLocked: () => void
  /** A panel is open: don't take the call (it would open over it). */
  hidden: boolean
  /** Roof's full view opened/closed (the hub holds the photo frame meanwhile). */
  onOpenChange?: (open: boolean) => void
}) {
  const { t, lang } = useI18n()
  const supported = speechSupported()
  // OFF until the family turns it on: a browser's recogniser may send the
  // room's audio to its speech service while it waits for "Ei Roof" (the
  // phone app listens on-device only). Turning it on says so first.
  const [muted, setMuted] = useState(() => lsGet(WAKE_KEY) !== 'on')
  const [ears, setEars] = useState<EarsState>('off')
  // What the wake listener just heard (no call in it), shown faintly for a
  // moment — so a missed "Ei Roof" shows what the browser made of it.
  const [raw, setRaw] = useState('')
  const rawOff = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [open, setOpen] = useState(false)
  const [origin, setOrigin] = useState<DOMRect | null>(null)
  const [stage, setStage] = useState<Stage>({ k: 'listen' })
  // A different suggestion each time Roof opens (roofTips).
  const [tip, setTip] = useState<Tip>(() => nextTip())
  const [heard, setHeard] = useState('')
  const [text, setText] = useState('')
  const dock = useRef<HTMLDivElement>(null)
  const grow = useRef<GrowHandle>(null)
  const earsRef = useRef<RoofEars | null>(null)
  const openRef = useRef(false)
  const history = useRef<{ q: string; a: string }[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const viaVoice = useRef(false)
  const closing = useRef(false)
  const armed = full && supported && !muted && !hidden
  const openCb = useRef(onOpenChange)
  openCb.current = onOpenChange
  useEffect(() => openCb.current?.(open), [open])

  const envRef = useRef<AskEnv | null>(null)
  envRef.current = { t, lang, today, data, me, history: history.current, refresh }

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  const close = useCallback(async () => {
    if (!openRef.current || closing.current) return
    closing.current = true
    clearTimer()
    stopSpeaking()
    earsRef.current?.pause()
    await grow.current?.close()
    openRef.current = false
    closing.current = false
    setOpen(false)
    setStage({ k: 'listen' })
    setHeard('')
    setText('')
    history.current = []
    earsRef.current?.release()
  }, [])

  const openStage = useCallback((first: Stage) => {
    clearTimer()
    setTip(nextTip())
    setOrigin(dock.current?.getBoundingClientRect() ?? null)
    setStage(first)
    setHeard('')
    openRef.current = true
    setOpen(true)
  }, [])

  // ── answering ──────────────────────────────────────────────────────────────

  /** "What can you do?" — the capabilities screen, right here. */
  const showCaps = async () => {
    clearTimer()
    setStage({ k: 'caps' })
    if (viaVoice.current) {
      earsRef.current?.pause()
      await speak(t('casa.roof.capsSay'), lang)
      if (openRef.current && supported && full) earsRef.current?.capture()
    }
  }

  const show = useCallback(
    async (o: Outcome, q: string) => {
      if (!openRef.current) return
      history.current = [...history.current, { q, a: summarize(o) }].slice(-6)
      if (o.kind === 'caps') {
        await showCaps()
        return
      }
      if (o.kind === 'open') {
        chime('done')
        await close()
        onOpenPanel(o.target)
        return
      }
      if (o.kind === 'pick') {
        chime('start')
        setStage({ k: 'pick', o })
        return
      }
      if (o.kind === 'done' && o.check) chime('done')
      const follow = viaVoice.current && supported && full
      setStage({ k: 'answer', o, follow })
      if (viaVoice.current) {
        earsRef.current?.pause()
        await speak(o.kind === 'done' ? o.speak : o.text, lang)
        if (!openRef.current) return
        if (o.kind === 'bye') {
          setTimeout(() => void close(), 600)
          return
        }
        // Keep listening for the next thing (its own 8 s → close when quiet).
        if (follow) {
          setHeard('')
          earsRef.current?.capture()
          return
        }
      }
      clearTimer()
      timer.current = setTimeout(() => void close(), o.kind === 'bye' ? 1800 : answerMs(o))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [close, lang, onOpenPanel, supported, full],
  )

  const ask = useCallback(
    async (q: string) => {
      const env = envRef.current!
      clearTimer()
      if (isGoodbye(q)) {
        await show({ kind: 'bye', text: t('casa.roof.bye') }, q)
        return
      }
      // "What can you do?" — the capabilities screen, right here (nothing spent).
      if (isCapabilitiesAsk(q)) {
        history.current = [...history.current, { q, a: 'capabilities' }].slice(-6)
        await showCaps()
        return
      }
      if (localClose(q)) {
        chime('done')
        await close()
        return
      }
      const target = localOpen(q)
      if (target) {
        await show({ kind: 'open', target }, q)
        return
      }
      setStage({ k: 'think', q })
      setHeard(q)
      const u = await understand(env, q)
      if (!openRef.current) return
      let o: Outcome
      if (!u.ok) {
        const msg = u.reason === 'limit' ? t('casa.roof.limit') : t('casa.roof.offline')
        o = { kind: 'done', tone: 'orb', title: msg, speak: msg, check: false }
      } else {
        try {
          o = await act(env, u.intent, full)
        } catch {
          o = { kind: 'done', tone: 'orb', title: t('casa.roof.failed'), speak: t('casa.roof.failed'), check: false }
        }
      }
      await show(o, q)
    },
    [full, show, t],
  )

  // ── the ears ───────────────────────────────────────────────────────────────

  const noop = () => {}
  const handlers = useRef<{ onWake: () => void; onHeard: (s: string) => void; onDone: (s: string) => void }>({
    onWake: noop,
    onHeard: noop,
    onDone: noop,
  })
  handlers.current.onWake = () => {
    chime('start')
    viaVoice.current = true
    if (!openRef.current) openStage({ k: 'listen' })
    else setStage({ k: 'listen' })
  }
  handlers.current.onHeard = (s: string) => {
    if (!openRef.current) return
    setHeard(s)
    setStage((st) => (st.k === 'answer' || st.k === 'listen' ? { k: 'listen' } : st))
  }
  handlers.current.onDone = (req: string) => {
    if (!openRef.current) return
    if (!req) {
      // Nothing (more) said → done talking.
      void close()
      return
    }
    viaVoice.current = true
    void ask(req)
  }

  useEffect(() => {
    if (!supported) return
    const e = new RoofEars(lang, {
      onWake: () => handlers.current.onWake(),
      onHeard: (s) => handlers.current.onHeard(s),
      onDone: (s) => handlers.current.onDone(s),
      onState: setEars,
      onRaw: (s) => {
        setRaw(s.slice(-60))
        if (rawOff.current) clearTimeout(rawOff.current)
        rawOff.current = setTimeout(() => setRaw(''), 3500)
      },
    })
    earsRef.current = e
    const vis = () => document.visibilityState === 'visible' && e.wakeUp()
    document.addEventListener('visibilitychange', vis)
    return () => {
      document.removeEventListener('visibilitychange', vis)
      e.dispose()
      earsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported])

  useEffect(() => earsRef.current?.setLang(lang), [lang])
  useEffect(() => {
    if (!openRef.current) earsRef.current?.setWake(armed)
  }, [armed])

  useEffect(() => () => clearTimer(), [])

  // ── actions ────────────────────────────────────────────────────────────────

  function tapDock() {
    if (!full) {
      onLocked()
      return
    }
    tick()
    if (supported && ears !== 'denied') {
      viaVoice.current = true
      openStage({ k: 'listen' })
      earsRef.current?.capture()
    } else {
      viaVoice.current = false
      openStage({ k: 'type' })
    }
  }

  function toggleMute() {
    const next = !muted
    if (!next && lsGet(WAKE_KEY + '.ok') !== '1') {
      if (!window.confirm(t('casa.wakeNotice'))) return
      lsSet(WAKE_KEY + '.ok', '1')
    }
    setMuted(next)
    lsSet(WAKE_KEY, next ? 'off' : 'on')
    tick()
  }

  function startTyping() {
    viaVoice.current = false
    clearTimer()
    stopSpeaking()
    earsRef.current?.pause()
    setStage((s) => (s.k === 'listen' ? { k: 'type' } : s))
  }

  function relisten() {
    clearTimer()
    stopSpeaking()
    viaVoice.current = true
    setHeard('')
    setStage({ k: 'listen' })
    earsRef.current?.capture()
  }

  function submitText() {
    const q = text.trim()
    if (!q) return
    setText('')
    viaVoice.current = false
    earsRef.current?.pause()
    void ask(q)
  }

  async function undo(o: Done) {
    clearTimer()
    stopSpeaking()
    earsRef.current?.pause()
    try {
      await o.undo?.()
    } catch {
      /* best effort */
    }
    setStage({ k: 'undone' })
    timer.current = setTimeout(() => void close(), 2200)
  }

  async function view(id: OpenTarget) {
    await close()
    onOpenPanel(id)
  }

  // ── dock ───────────────────────────────────────────────────────────────────

  const live = armed && (ears === 'waiting' || ears === 'hearing')
  const sub = !full
    ? null
    : live
      ? raw
        ? `“${raw}”`
        : t('casa.roof.sayIt')
      : supported && ears === 'denied'
        ? t('casa.roof.micDenied')
        : supported && muted
          ? t('casa.roof.muted')
          : t('casa.roof.tapToTalk')

  return (
    <>
      <div
        ref={dock}
        className="casa-liquid @container relative flex h-[4.5rem] w-full items-center gap-2 rounded-[28px] pr-2 pl-3 sm:gap-3"
        style={{ opacity: open ? 0 : 1, transition: 'opacity .25s' }}
      >
        <button onClick={tapDock} className="flex min-w-0 flex-1 items-center gap-3 self-stretch text-left sm:gap-4" aria-label={t('casa.roof.open')}>
          <span className="relative">
            <Orb size={52} />
            {full && supported ? (
              <span className="absolute -right-1 -bottom-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-(--card)">
                {live ? <span className="casa-breathe absolute h-3 w-3 rounded-full" style={{ background: GREEN }} /> : null}
                <span className="relative h-3 w-3 rounded-full" style={{ background: live ? GREEN : 'var(--text-faint)' }} />
              </span>
            ) : null}
          </span>
          <span className="min-w-0">
            <span className="flex items-end gap-1.5">
              <span className="font-display text-[1.7rem] leading-none">Roof</span>
              {ears === 'hearing' && armed ? (
                <span className="casa-dots mb-1 scale-50 text-(--text-faint)">
                  <i />
                  <i />
                  <i />
                </span>
              ) : null}
            </span>
            {sub ? <span className="mt-1 block truncate text-[1rem] text-(--text-faint)">{sub}</span> : null}
          </span>
        </button>
        {!full ? (
          // Only when the dock is wide enough to keep "Roof" readable.
          <span className="hidden shrink-0 @[24rem]:inline-flex">
            <PlusTag label={t('casa.plan.noPlus')} />
          </span>
        ) : supported ? (
          <button
            onClick={toggleMute}
            aria-label={muted ? t('casa.roof.unmute') : t('casa.roof.mute')}
            className="casa-press inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-(--surface)"
          >
            {muted || ears === 'denied' ? <MicOff size={24} className="text-(--text-muted)" aria-hidden /> : <Mic size={24} color={GREEN} aria-hidden />}
          </button>
        ) : null}
        <button
          onClick={tapDock}
          aria-label={t('casa.roof.open')}
          className="casa-press inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-[22px] text-white sm:h-16 sm:w-16 sm:rounded-[24px]"
          style={{ background: full ? grad(GRAD.orb) : 'var(--surface-2)' }}
        >
          <ArrowUp size={28} strokeWidth={2.6} aria-hidden />
        </button>
      </div>

      {open ? (
        <Grow
          ref={grow}
          origin={origin}
          tint={GRAD.orb}
          radius={44}
          scrim="deep"
          onBackdrop={() => void close()}
          className="inset-2 sm:inset-5"
          style={{
            background:
              'radial-gradient(120% 80% at 15% 0%, #3d2b78 0%, transparent 60%), radial-gradient(90% 70% at 100% 100%, #0d5a52 0%, transparent 60%), #15111d',
            color: '#fff',
          }}
        >
          <RoofStage
            stage={stage}
            tip={tip}
            onTry={(p) => void ask(p)}
            heard={heard}
            text={text}
            setText={setText}
            onType={startTyping}
            onSubmit={submitText}
            onListen={relisten}
            onClose={() => void close()}
            onUndo={undo}
            onView={view}
            onPick={async (o, id) => {
              tick()
              try {
                const next = await o.onPick(id)
                await show(next, '')
              } catch {
                await show({ kind: 'done', tone: 'orb', title: t('casa.roof.failed'), speak: t('casa.roof.failed'), check: false }, '')
              }
            }}
            onRun={async (label, run) => {
              // A tapped row ("which one?") or choice ("Send", "the whole series").
              tick()
              clearTimer()
              stopSpeaking()
              setStage({ k: 'think', q: label })
              try {
                await show(await run(), label)
              } catch {
                await show({ kind: 'done', tone: 'orb', title: t('casa.roof.failed'), speak: t('casa.roof.failed'), check: false }, label)
              }
            }}
            canListen={supported && ears !== 'denied'}
            otherName={(data.members.find((m) => m.email !== me.email) ?? data.members[0])?.first || 'Ana'}
          />
        </Grow>
      ) : null}
    </>
  )
}

function RoofStage({
  stage,
  tip,
  onTry,
  heard,
  text,
  setText,
  onType,
  onSubmit,
  onListen,
  onClose,
  onUndo,
  onView,
  onPick,
  onRun,
  canListen,
  otherName,
}: {
  stage: Stage
  tip: Tip
  onTry: (text: string) => void
  heard: string
  text: string
  setText: (s: string) => void
  onType: () => void
  onSubmit: () => void
  onListen: () => void
  onClose: () => void
  onUndo: (o: Done) => void
  onView: (id: OpenTarget) => void
  onPick: (o: Extract<Outcome, { kind: 'pick' }>, id: string) => void
  onRun: (label: string, run: () => Promise<Outcome>) => void
  canListen: boolean
  /** Another member's first name for the "{name}" examples. */
  otherName: string
}) {
  const { t } = useI18n()
  const listening = stage.k === 'listen' || (stage.k === 'answer' && stage.follow)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (stage.k === 'type') input.current?.focus()
  }, [stage.k])

  return (
    <div className="relative flex h-full flex-col">
      {listening ? <div className="casa-listen-edge" aria-hidden /> : null}
      <header className="flex shrink-0 items-center gap-4 px-[clamp(16px,3vw,2rem)] pt-[clamp(12px,3dvh,1.75rem)]">
        <Orb size={52} live={listening} />
        <span className="font-display text-[clamp(1.6rem,4dvh,2rem)]">Roof</span>
        <span className="flex-1" />
        <button
          onClick={onClose}
          aria-label={t('casa.close')}
          className="casa-press inline-flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-white sm:h-16 sm:w-16"
        >
          <X size={30} aria-hidden />
        </button>
      </header>

      <main className="casa-scroll flex min-h-0 flex-1 flex-col items-center px-[clamp(16px,4vw,2.5rem)] py-[clamp(8px,2dvh,20px)] text-center">
        <div className="my-auto flex w-full flex-col items-center">
        {stage.k === 'listen' || stage.k === 'type' ? (
          <div className="casa-fade w-full max-w-[1100px]">
            {stage.k === 'listen' ? (
              <div className="mb-[clamp(12px,4dvh,2rem)] flex items-center justify-center gap-4 text-[#b9a7ff]">
                <span className="casa-bars" aria-hidden>
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                <span className="text-[clamp(1.1rem,3dvh,1.4rem)] font-semibold tracking-wide">{t('casa.roof.listening')}</span>
              </div>
            ) : null}
            {heard ? (
              <p key={heard.length > 40 ? 'l' : 's'} className="font-display text-[clamp(1.8rem,min(6vw,9dvh),5.6rem)] leading-[1.05]">
                {heard}
              </p>
            ) : (
              stage.k === 'listen' ? (
                <div>
                  <p className="text-[clamp(1rem,2.6dvh,1.3rem)] text-white/55">{tip.kind === 'help' ? t('casa.roof.helpTip') : t('casa.roof.tryLabel')}</p>
                  <p className="font-display mt-1 text-[clamp(1.5rem,min(4.4vw,7dvh),4rem)] leading-tight text-white/45">
                    “{tip.kind === 'help' ? t('casa.roof.capsAsk') : t(tip.key)}”
                  </p>
                </div>
              ) : (
                <p className="font-display text-[clamp(1.5rem,min(4.4vw,7dvh),4rem)] leading-tight text-white/45">{t('casa.roof.typeHint')}</p>
              )
            )}
          </div>
        ) : stage.k === 'think' ? (
          <div className="casa-fade w-full max-w-[1100px]">
            <p className="font-display text-[clamp(1.7rem,min(5vw,8dvh),4.6rem)] leading-[1.08] text-white/75">{stage.q}</p>
            <span className="casa-dots mt-[clamp(16px,5dvh,2.5rem)] inline-block text-[#b9a7ff]" aria-label={t('casa.roof.thinking')}>
              <i />
              <i />
              <i />
            </span>
          </div>
        ) : stage.k === 'caps' ? (
          <Capabilities onTry={onTry} name={otherName} />
        ) : stage.k === 'pick' ? (
          <WhoPicker dark question={stage.o.question} options={stage.o.options} onPick={(id) => onPick(stage.o, id)} onTimeout={onClose} />
        ) : stage.k === 'undone' ? (
          <div className="casa-pop flex flex-col items-center gap-5">
            <span className="inline-flex h-[clamp(4.5rem,15dvh,7rem)] w-[clamp(4.5rem,15dvh,7rem)] items-center justify-center rounded-full bg-white/12">
              <Undo2 className="h-1/2 w-1/2" aria-hidden />
            </span>
            <p className="font-display text-[clamp(2rem,7dvh,3.2rem)]">{t('casa.roof.undone')}</p>
          </div>
        ) : (
          <AnswerCard
            o={stage.o}
            follow={stage.follow}
            onUndo={onUndo}
            onView={onView}
            onRun={onRun}
          />
        )}
        </div>
      </main>

      <footer className="flex shrink-0 items-center gap-3 px-[clamp(12px,3vw,2rem)] pt-2 pb-[clamp(12px,3dvh,1.75rem)]">
        <form
          className="flex min-w-0 flex-1 items-center gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            onSubmit()
          }}
        >
          <span className="relative flex min-w-0 flex-1 items-center">
            <Keyboard size={24} className="pointer-events-none absolute left-5 text-white/40" aria-hidden />
            <input
              ref={input}
              value={text}
              onFocus={onType}
              onChange={(e) => {
                // Typing after an answer keeps Roof open (stops the close timer).
                if (!text) onType()
                setText(e.target.value)
              }}
              placeholder={t('casa.roof.typePlaceholder')}
              className="h-14 w-full rounded-[22px] border border-white/10 bg-white/8 pr-5 pl-14 sm:h-16 text-[1.3rem] text-white placeholder:text-white/40 outline-none focus:border-white/30"
              style={{ fontSize: '1.3rem' }}
            />
          </span>
          {text.trim() ? (
            <button
              type="submit"
              aria-label={t('casa.roof.send')}
              className="casa-press inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-[22px] text-white sm:h-16 sm:w-16"
              style={{ background: grad(GRAD.orb) }}
            >
              <SendHorizontal size={26} aria-hidden />
            </button>
          ) : null}
        </form>
        {canListen ? (
          <button
            onClick={onListen}
            aria-label={t('casa.roof.listenAgain')}
            className="casa-press inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-white sm:h-16 sm:w-16"
            style={{ background: listening ? GREEN : 'rgb(255 255 255 / .12)', transition: 'background .3s' }}
          >
            <Mic size={28} aria-hidden />
          </button>
        ) : null}
      </footer>
    </div>
  )
}

function AnswerCard({
  o,
  follow,
  onUndo,
  onView,
  onRun,
}: {
  o: Done | { kind: 'bye'; text: string }
  follow: boolean
  onUndo: (o: Done) => void
  onView: (id: OpenTarget) => void
  onRun: (label: string, run: () => Promise<Outcome>) => void
}) {
  const { t } = useI18n()
  const done = o.kind === 'done' ? o : null
  const g = TONE[done?.tone ?? 'orb']
  const dark = done?.tone === 'lists'
  const ink = dark ? '#3b2400' : '#fff'
  const soft = dark ? 'rgb(59 36 0 / .1)' : 'rgb(255 255 255 / .14)'
  const rows = done?.rows ?? []
  // Many rows: two columns on a wide screen, so a list reads across the room.
  const twoCol = rows.length > 5 && !rows.some((r) => r.pick)
  const ms = answerMs(o)
  return (
    <div
      className="casa-pop relative w-full max-w-[62rem] overflow-hidden rounded-[clamp(28px,5vmin,44px)] p-[clamp(18px,4.5vmin,3rem)] text-left"
      style={{ background: grad(g), color: ink, boxShadow: `0 40px 90px -30px ${g[1]}` }}
    >
      <div className="flex items-start gap-[clamp(12px,3vmin,1.75rem)]">
        {done?.check ? <CheckMark size={92} color={ink} max="15vmin" /> : o.kind === 'bye' ? <span className="text-[clamp(2.6rem,9vmin,4.2rem)] leading-none" aria-hidden>👋</span> : null}
        <div className="min-w-0 flex-1">
          <p className="font-display text-[clamp(1.5rem,min(4.2vw,6.5dvh),3.6rem)] leading-[1.06]">{done ? done.title : o.kind === 'bye' ? o.text : ''}</p>
          {done?.sub ? <p className="mt-[clamp(6px,1.4dvh,0.9rem)] text-[clamp(1.05rem,3dvh,1.45rem)] opacity-85">{done.sub}</p> : null}
        </div>
      </div>
      {rows.length ? (
        <ul className={`mt-[clamp(12px,3dvh,1.75rem)] grid gap-[clamp(6px,1.2dvh,10px)] ${twoCol ? 'sm:grid-cols-2' : ''}`}>
          {rows.map((r: AnswerRow, i) => {
            const body = (
              <>
                {r.emoji ? (
                  <span className="inline-flex h-[clamp(2.4rem,6.5dvh,3.2rem)] w-[clamp(2.4rem,6.5dvh,3.2rem)] shrink-0 items-center justify-center rounded-[14px] text-[clamp(1.25rem,3.4dvh,1.7rem)]" style={{ background: soft }} aria-hidden>
                    {r.emoji}
                  </span>
                ) : null}
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-[clamp(1.1rem,3.2dvh,1.55rem)] leading-tight ${r.strong || r.pick ? 'font-bold' : 'font-semibold'}`}>{r.title}</span>
                  {r.sub ? <span className="mt-0.5 line-clamp-2 block text-[clamp(0.95rem,2.5dvh,1.2rem)] opacity-80">{r.sub}</span> : null}
                </span>
                {r.pick ? <ChevronRight size={26} className="shrink-0 opacity-80" aria-hidden /> : null}
              </>
            )
            return (
              <li key={i} className="casa-rise" style={{ ['--i' as string]: Math.min(i, 8) + 2 }}>
                {r.pick ? (
                  <button
                    onClick={() => onRun(r.title, r.pick!)}
                    className="casa-press flex w-full items-center gap-4 rounded-[22px] px-4 py-3 text-left sm:px-5"
                    style={{ background: dark ? 'rgb(255 255 255 / .55)' : 'rgb(255 255 255 / .2)', outline: r.strong ? `2px solid ${ink}` : undefined }}
                  >
                    {body}
                  </button>
                ) : (
                  <div className="flex items-center gap-4 rounded-[20px] px-3 py-2 sm:px-4" style={{ background: r.strong ? soft : undefined }}>
                    {body}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      ) : null}
      {done && (done.undo || done.view || done.choices?.length) ? (
        <div className="mt-[clamp(14px,4dvh,2.25rem)] flex flex-wrap gap-3">
          {done.choices?.map((c, i) => (
            <button
              key={c.label}
              onClick={() => onRun(c.label, c.run)}
              className="casa-press inline-flex h-14 items-center gap-2.5 rounded-full px-6 text-[1.15rem] font-semibold sm:h-16 sm:px-7"
              style={i === 0 ? { background: '#fff', color: g[1] } : { background: dark ? 'rgb(59 36 0 / .12)' : 'rgb(255 255 255 / .2)' }}
            >
              {i === 0 ? <Check size={24} aria-hidden /> : null}
              {c.label}
            </button>
          ))}
          {done.undo ? (
            <button
              onClick={() => onUndo(done)}
              className="casa-press inline-flex h-14 items-center gap-2.5 rounded-full px-6 text-[1.15rem] font-semibold sm:h-16 sm:px-7"
              style={{ background: dark ? 'rgb(59 36 0 / .12)' : 'rgb(255 255 255 / .2)' }}
            >
              <Undo2 size={24} aria-hidden />
              {t('casa.roof.undo')}
            </button>
          ) : null}
          {done.view ? (
            <button
              onClick={() => onView(done.view!)}
              className="casa-press inline-flex h-14 items-center gap-2.5 rounded-full px-6 text-[1.15rem] font-semibold sm:h-16 sm:px-7"
              style={done.choices?.length ? { background: dark ? 'rgb(59 36 0 / .12)' : 'rgb(255 255 255 / .2)' } : { background: '#fff', color: g[1] }}
            >
              <Eye size={24} aria-hidden />
              {t('casa.roof.view')}
            </button>
          ) : null}
        </div>
      ) : null}
      {!follow ? (
        <div className="absolute right-0 bottom-0 left-0 h-1.5" style={{ background: dark ? 'rgb(59 36 0 / .12)' : 'rgb(255 255 255 / .18)' }}>
          <div key={ms + (done?.title ?? '')} className="casa-countdown h-full" style={{ animationDuration: `${ms}ms`, background: dark ? 'rgb(59 36 0 / .45)' : 'rgb(255 255 255 / .7)' }} />
        </div>
      ) : null}
    </div>
  )
}
