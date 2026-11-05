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
import { invalidateCache } from '@/hooks/useCachedQuery'
import { supabase } from '@/lib/supabase'
import { formatTime, memberColor } from '@/lib/calendar'
import {
  addItems,
  agendaFor,
  undoAdd,
  understand,
  type AddResult,
  type AgendaAnswer,
  type AgendaRow,
  type Scope,
} from '@/lib/assistant'
import type { TKey } from '@/lib/i18n'
import { useVoice, voiceSupported } from '@/lib/voice'
import { fonts, radius, sheetRadius, sp, useTheme } from '@/theme/theme'
import { GradientBox } from './GradientBox'

const LOCALE: Record<string, string> = { en: 'en-US', es: 'es', pt: 'pt-BR' }
const ORB: readonly [string, string] = ['#8B6CFF', '#20C3A6']

type Answer =
  | { kind: 'added'; res: AddResult; undone: boolean }
  | { kind: 'agenda'; a: AgendaAnswer }
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
  const today = useToday()
  const locale = LOCALE[lang] ?? 'en-US'
  const { lift, room, clearOfBars, onRootLayout } = useSheetLift()
  const bottomGap = useBottomGap(sp.md)

  // Fresh state per open: the Hub remounts this sheet (new key) each time.
  const [text, setText] = useState(seed ?? '')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const inputRef = useRef<TextInput>(null)
  // Voice: speak, watch the words appear, and the final transcript is sent.
  const canVoice = voiceSupported()
  const voice = useVoice(lang, (heard) => {
    void submit(heard)
  })
  const hearing = voice.state === 'listening'
  const startVoice = voice.start
  useEffect(() => {
    if (listen && canVoice) void startVoice()
  }, [listen, canVoice, startVoice])

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

  async function submit(raw?: string) {
    const q = (raw ?? text).trim()
    if (!q || busy) return
    Keyboard.dismiss()
    setQuery(q)
    setText('')
    setAnswer(null)
    setBusy(true)
    try {
      const { data: storeRows } = await supabase.from('shopping_stores').select('name')
      const [y, m, d] = today.split('-').map(Number)
      const intent = await understand(q, {
        today,
        weekday: new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long' }),
        lang,
        stores: ((storeRows ?? []) as { name: string }[]).map((s) => s.name),
        members: profiles.map((p) => p.display_name),
        me: profile?.display_name ?? '',
      })
      if (!intent || intent.intent === 'unknown') {
        setAnswer({ kind: 'unknown', text: intent?.intent === 'unknown' && intent.reply ? intent.reply : t('ask.unknown') })
      } else if (intent.intent === 'add_items') {
        const res = await addItems(intent.items, intent.store, profile?.email ?? '')
        invalidateCache('hub:shopping')
        setAnswer({ kind: 'added', res, undone: false })
      } else {
        const a = await agendaFor(intent.date, intent.scope, intent.person, profile ?? null, profiles, today)
        setAnswer({ kind: 'agenda', a })
      }
    } catch {
      setAnswer({ kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function rescope(a: AgendaAnswer, scope: Scope) {
    try {
      setAnswer({ kind: 'agenda', a: await agendaFor(a.date, scope, '', profile ?? null, profiles, today) })
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

  function go(path: '/shopping' | '/calendar') {
    onClose()
    router.push(path)
  }

  const canSend = text.trim().length > 0 && !busy

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1 }} onLayout={onRootLayout}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }]} onPress={onClose} />
        <View
          style={{
            marginTop: 'auto',
            marginBottom: lift,
            maxHeight: room * 0.92,
            backgroundColor: c.sheet,
            borderTopLeftRadius: sheetRadius,
            borderTopRightRadius: sheetRadius,
            paddingTop: sp.sm,
            paddingBottom: clearOfBars ? sp.md : bottomGap,
          }}
        >
          <View style={{ alignItems: 'center', paddingBottom: sp.sm }}>
            <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: c.border }} />
          </View>

          <ScrollView
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: sp.md }}
            keyboardShouldPersistTaps="handled"
          >
            {hearing ? (
              <View style={{ paddingVertical: sp.lg, gap: sp.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
                  <Orb />
                  <Txt style={{ fontFamily: fonts.semibold, fontSize: 13, letterSpacing: 1, color: c.accent, textTransform: 'uppercase' }}>
                    {t('ask.listening')}
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
            ) : (
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
            ) : answer ? (
              <View style={s.answerRow}>
                <Orb />
                <Txt style={s.answerText}>{answer.kind === 'unknown' ? answer.text : t('ask.error')}</Txt>
              </View>
            ) : null}
          </ScrollView>

          {/* the input — always at the foot, ready for the next request */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, paddingHorizontal: sp.lg, paddingTop: sp.sm }}>
            <View style={[s.input, { backgroundColor: c.surface, borderColor: c.border }]}>
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
                style={[s.send, { backgroundColor: c.expense }]}
              >
                <Square size={18} color="#fff" fill="#fff" />
              </Pressable>
            ) : !text.trim() && canVoice ? (
              <Pressable
                accessibilityLabel={t('ask.speak')}
                disabled={busy}
                onPress={() => {
                  Keyboard.dismiss()
                  void voice.start()
                }}
                style={[s.send, { backgroundColor: c.action }]}
              >
                <Mic size={22} color={c.onAction} strokeWidth={2.4} />
              </Pressable>
            ) : (
              <Pressable
                accessibilityLabel={t('ask.send')}
                disabled={!canSend}
                onPress={() => submit()}
                style={[s.send, { backgroundColor: canSend ? c.action : c.surface2 }]}
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

function Orb({ size = 30 }: { size?: number }) {
  return (
    <GradientBox colors={ORB} radius={size / 2} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Sparkles size={size * 0.5} color="#fff" strokeWidth={2.2} />
    </GradientBox>
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
  const day = dayWords(a.date)
  const n = a.rows.length
  const name = a.person?.display_name.split(' ')[0] ?? ''
  const isMe = a.scope === 'me'

  const timed = a.rows.filter((r) => r.start)
  const untimed = a.rows.filter((r) => !r.start)
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const next = a.date === today ? timed.find((r) => toMin(r.start) >= nowMin) : timed[0]

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
            {next?.start ? (
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

      {n > 0 ? (
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
