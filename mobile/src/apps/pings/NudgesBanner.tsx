// Home-screen nudge banners (the RN equivalent of the PWA's PingsBanner). Two
// groups, both between the Hub header and the app grid:
//  • RECEIVED — active nudges sent TO me I haven't acknowledged, each with a
//    compact respond CTA (a thumbs-up for Got it, Call when urgent) on a light
//    card (red when urgent); a received drawing bleeds off the card's left
//    half and fades into kraft, with "View note" on the right. The row itself is inert: this banner IS the
//    inbox — there is no nudge history screen behind it.
//  • SENT — active nudges I sent, showing who has acknowledged ("seen by …"),
//    each with an ✕ to dismiss from my home (persisted per-device via
//    AsyncStorage; the nudge itself still lives until it expires).
//
// One card shows full width; two or more sit in a horizontal carousel with
// dots (2026-11-15 — it replaced a stack + "see all" overlay). A hand-drawn
// note (migration 112) gets a kraft-paper card with the note pinned on it.
//
// Its own lightweight Realtime subscription (distinct channel from the Nudges
// screen) so it stays live on the Hub. Renders nothing when both groups empty.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Linking, Pressable, ScrollView, StyleSheet, Vibration, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Check, Eye, Phone, ThumbsUp, X } from 'lucide-react-native'
import { Image } from 'expo-image'
import Svg, { Defs, LinearGradient as SvgGradient, Rect, Stop } from 'react-native-svg'

import { Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import { APP_GRADIENT } from '@/components/home/palette'
import { useAuth } from '@/lib/auth'
import { useRevalidateOnForeground } from '@/hooks/useCachedQuery'
import { useI18n } from '@/hooks/useI18n'
import { supabase } from '@/lib/supabase'
import { channelName } from '@/lib/realtime'
import { timeAgo } from '@/lib/format'
import { getSignedUrls } from '@/lib/signedUrls'
import { NoteViewer } from '@/apps/pings/NoteViewer'
import type { Ping, PingAck } from '@/lib/types'
import { fonts, radius, sp, useTheme } from '@/theme/theme'

type ActivePing = Ping & { acks: PingAck[] }

/** Active (non-expired) nudges for the household, each with its acks. */
async function fetchActivePings(): Promise<ActivePing[]> {
  const nowISO = new Date().toISOString()
  const { data: rows, error } = await supabase
    .from('pings')
    .select('*')
    .gt('expires_at', nowISO)
    .order('created_at', { ascending: false })
  if (error) throw error
  const pings = (rows ?? []) as Ping[]
  if (!pings.length) return []
  const { data: acks } = await supabase
    .from('ping_acks')
    .select('*')
    .in(
      'ping_id',
      pings.map((p) => p.id),
    )
  const ackList = (acks ?? []) as PingAck[]
  return pings.map((p) => ({
    ...p,
    acks: ackList.filter((a) => a.ping_id === p.id),
  }))
}

async function fetchMemberPhones(): Promise<Record<string, string>> {
  const { data } = await supabase.from('member_profiles').select('email, phone')
  const out: Record<string, string> = {}
  for (const r of (data ?? []) as { email: string; phone: string | null }[]) {
    if (r.phone) out[r.email] = r.phone
  }
  return out
}

export default function NudgesBanner({
  openNoteId,
  onNoteOpened,
}: {
  /** Open this hand-drawn note full screen once it's loaded (a tapped push). */
  openNoteId?: string
  onNoteOpened?: () => void
} = {}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const { profile, profiles } = useAuth()
  const myEmail = profile?.email

  const [pings, setPings] = useState<ActivePing[]>([])
  const [phones, setPhones] = useState<Record<string, string>>({})
  const [ackedLocal, setAckedLocal] = useState<Set<string>>(new Set())
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  // Which card the carousel shows (for the dots).
  const [page, setPage] = useState(0)
  const { width: screenW } = useWindowDimensions()
  // Hand-drawn notes (migration 112): signed URLs per image path, and the one
  // open full screen.
  const [noteUrls, setNoteUrls] = useState<Record<string, string>>({})
  const [viewing, setViewing] = useState<{ p: ActivePing; mine: boolean } | null>(null)

  const dismissKey = myEmail ? `nudges-dismissed:${myEmail}` : null

  const load = useCallback(async () => {
    try {
      setPings(await fetchActivePings())
    } catch {
      /* keep what we had */
    }
  }, [])

  const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleLoad = useCallback(() => {
    if (loadTimer.current) clearTimeout(loadTimer.current)
    loadTimer.current = setTimeout(() => void load(), 250)
  }, [load])

  useEffect(() => {
    void load()
    void fetchMemberPhones().then(setPhones)
    const channel = supabase
      .channel(channelName('hub_nudges_banner'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pings' }, () => scheduleLoad())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ping_acks' }, () => scheduleLoad())
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
      if (loadTimer.current) clearTimeout(loadTimer.current)
    }
  }, [load, scheduleLoad])

  // A nudge that arrived (or expired, or was acked) while the app was suspended
  // isn't in the Realtime stream when it resumes — this banner sits on the Hub,
  // the screen most likely to be the one left open, so it was the most visible
  // version of that: tapping the push opened the app to a banner that didn't
  // list the nudge you'd just been told about.
  useRevalidateOnForeground(scheduleLoad)

  const notePaths = pings
    .map((p) => p.image_path)
    .filter((x): x is string => !!x)
    .join('|')
  useEffect(() => {
    const missing = notePaths ? notePaths.split('|').filter((x) => !noteUrls[x]) : []
    if (!missing.length) return
    let alive = true
    void getSignedUrls(missing).then((m) => alive && setNoteUrls((prev) => ({ ...prev, ...m })))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notePaths])

  // Load this device's dismissed-sent set for the signed-in user.
  useEffect(() => {
    if (!dismissKey) return
    let active = true
    AsyncStorage.getItem(dismissKey).then((raw) => {
      if (!active || !raw) return
      try {
        setDismissed(new Set(JSON.parse(raw) as string[]))
      } catch {
        /* ignore corrupt value */
      }
    })
    return () => {
      active = false
    }
  }, [dismissKey])

  const nameOf = useCallback(
    (email: string) => profiles.find((p) => p.email === email)?.display_name ?? email.split('@')[0],
    [profiles],
  )

  async function ack(id: string) {
    setAckedLocal((s) => new Set(s).add(id))
    await supabase.from('ping_acks').insert({ ping_id: id })
    scheduleLoad()
  }

  function dismiss(id: string) {
    setDismissed((prev) => {
      const next = new Set(prev).add(id)
      if (dismissKey) void AsyncStorage.setItem(dismissKey, JSON.stringify([...next]))
      return next
    })
  }

  // Nudges sent to me that I haven't acknowledged yet.
  const incoming = pings.filter(
    (p) => p.sender_email !== myEmail && !(ackedLocal.has(p.id) || p.acks.some((a) => a.user_email === myEmail)),
  )
  // Nudges I sent that are still active and I haven't dismissed from home.
  const sent = pings.filter((p) => p.sender_email === myEmail && !dismissed.has(p.id))

  // Buzz once when a new high-priority nudge arrives (in-app vibration; sound
  // rides the push notification when that's wired).
  const buzzed = useRef<Set<string>>(new Set())
  const highIds = incoming
    .filter((p) => p.high_priority)
    .map((p) => p.id)
    .join(',')
  useEffect(() => {
    const fresh = incoming.filter((p) => p.high_priority && !buzzed.current.has(p.id))
    if (fresh.length === 0) return
    fresh.forEach((p) => buzzed.current.add(p.id))
    Vibration.vibrate([0, 400, 200, 400])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highIds])


  // A tapped note push lands here with its id: open it as soon as the note
  // and its picture are in, once.
  const opened = useRef<string | null>(null)
  useEffect(() => {
    if (!openNoteId || opened.current === openNoteId) return
    const p = pings.find((x) => x.id === openNoteId)
    if (!p?.image_path || !noteUrls[p.image_path]) return
    opened.current = openNoteId
    const mine = p.sender_email === myEmail
    setViewing({ p, mine })
    if (!mine) void ack(p.id)
    onNoteOpened?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openNoteId, pings, noteUrls])

  if (incoming.length === 0 && sent.length === 0) return null

  // Opening a note someone sent me counts as seeing it (owner, 2026-11-15):
  // it's acked right away, and drops off Home once the viewer closes.
  const openNote = (p: ActivePing, mine: boolean) => {
    setViewing({ p, mine })
    if (!mine) void ack(p.id)
  }

  /** The drawn note on its card, in the icon's place: a little sheet of
   *  paper, tilted a touch; tapping it opens the note full screen. */
  const noteThumb = (p: ActivePing, mine: boolean) => {
    const url = p.image_path ? noteUrls[p.image_path] : undefined
    return (
      <View style={styles.noteShadow}>
        <Pressable
          onPress={() => openNote(p, mine)}
          hitSlop={6}
          accessibilityRole="imagebutton"
          accessibilityLabel={t('notes.tapToOpen')}
          style={({ pressed }) => [styles.noteThumb, { opacity: pressed ? 0.85 : 1 }]}
        >
          {url ? <Image source={{ uri: url }} style={{ flex: 1 }} contentFit="cover" transition={160} /> : null}
        </Pressable>
      </View>
    )
  }

  const viewer =
    viewing && viewing.p.image_path && noteUrls[viewing.p.image_path] ? (
      <NoteViewer
        url={noteUrls[viewing.p.image_path]}
        title={viewing.mine ? t('notes.youDrew') : t('notes.drew', { name: firstName(nameOf(viewing.p.sender_email)) })}
        sub={timeAgo(viewing.p.created_at)}
        onClose={() => setViewing(null)}
      />
    ) : null

  // RECEIVED hand-drawn note — a sheet of kraft paper instead of the Nudges
  // blue (owner, 2026-11-15: the blue under a drawing didn't feel right):
  // dark ink type, the note pinned in the middle, View / Got it in ink.
  // RECEIVED hand-drawn note (owner, 2026-11-15): the drawing bleeds off
  // the card's left half — the MIDDLE of the sheet (where people draw),
  // edge to edge — and
  // fades into the kraft; who and when sit on the right with one "View note"
  // button. The whole card opens it; "Got it" lives in the full-screen view.
  const renderIncomingNote = (p: ActivePing) => {
    const url = p.image_path ? noteUrls[p.image_path] : undefined
    return (
      <Pressable
        key={p.id}
        onPress={() => openNote(p, false)}
        accessibilityRole="button"
        accessibilityLabel={t('notes.tapToOpen')}
        style={({ pressed }) => [styles.card, styles.kraftCard, styles.bleedCard, pressed && { opacity: 0.92 }]}
      >
        <View style={styles.bleedArt} pointerEvents="none">
          {url ? <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="center" transition={160} /> : null}
          <Svg style={StyleSheet.absoluteFill} viewBox="0 0 100 100" preserveAspectRatio="none">
            <Defs>
              <SvgGradient id="noteFade" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0.35" stopColor={KRAFT_SOLID} stopOpacity={0} />
                <Stop offset="1" stopColor={KRAFT_SOLID} stopOpacity={1} />
              </SvgGradient>
            </Defs>
            <Rect x="0" y="0" width="100" height="100" fill="url(#noteFade)" />
          </Svg>
        </View>
        <View style={styles.bleedSide}>
          <View>
            <Txt style={[styles.kicker, { color: INK_SOFT }]} numberOfLines={1}>
              {timeAgo(p.created_at)}
            </Txt>
            <Txt style={[styles.msg, { color: INK, fontSize: 17, lineHeight: 21 }]} numberOfLines={2}>
              {t('notes.drew', { name: firstName(nameOf(p.sender_email)) })}
            </Txt>
          </View>
          <Pressable
            onPress={() => openNote(p, false)}
            style={({ pressed }) => [styles.chipBtn, styles.viewBtn, { opacity: pressed ? 0.8 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel={t('notes.viewNote')}
          >
            <Eye size={15} strokeWidth={2.4} color={INK} />
            <Txt style={[styles.pillTxt, { color: INK }]}>{t('notes.viewNote')}</Txt>
          </Pressable>
        </View>
      </Pressable>
    )
  }

  // SENT hand-drawn note — the drawing does the talking (owner, 2026-11-15):
  // it fills the card's height on the left; beside it only when, who has
  // seen it, and the ✕.
  const renderSentNote = (p: ActivePing) => {
    const seen = p.acks.filter((a) => a.user_email !== myEmail).sort((x, y) => y.created_at.localeCompare(x.created_at))
    const audience = (p.recipients?.length ? p.recipients : profiles.map((m) => m.email)).filter((e) => e !== myEmail)
    const total = Math.max(audience.length, seen.length)
    const all = total > 0 && seen.length === total
    return (
      <View key={p.id} style={[styles.card, styles.noteCard, { backgroundColor: c.card, borderColor: c.border, borderWidth: StyleSheet.hairlineWidth }]}>
        {noteThumb(p, true)}
        <View style={styles.noteSide}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.sm }}>
            <Txt style={[styles.kicker, { flex: 1, color: c.textMuted }]} numberOfLines={1}>
              {t('pings.youSent')} · {timeAgo(p.created_at)}
            </Txt>
            <Pressable
              onPress={() => dismiss(p.id)}
              hitSlop={8}
              style={[styles.close, { backgroundColor: c.surface }]}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
            >
              <X size={14} color={c.textMuted} />
            </Pressable>
          </View>
          <View style={{ gap: 6 }}>
            <Txt style={{ fontSize: 14, color: c.textMuted }} numberOfLines={2}>
              <Txt style={{ fontSize: 14, fontWeight: '700', color: c.text }}>{t('pings.seenByLabel')}: </Txt>
              {seen.length ? seen.map((a) => firstName(nameOf(a.user_email))).join(', ') : t('pings.nobodyYet')}
            </Txt>
            {total ? (
              <View style={[styles.count, { alignSelf: 'flex-start', backgroundColor: all ? c.income + '22' : c.surface }]}>
                {all ? <Check size={12} color={c.income} strokeWidth={3} /> : null}
                <Txt style={{ fontSize: 12, fontWeight: '700', color: all ? c.income : c.textMuted }}>
                  {t('pings.seenCount', { n: seen.length, total })}
                </Txt>
              </View>
            ) : null}
          </View>
        </View>
      </View>
    )
  }

  // RECEIVED text nudge (owner, 2026-11-15: the full blue card and the
  // full-width Got it were heavy) — a light card like the sent one, the emoji
  // in its Nudges tile, a thin Nudges-blue edge, and compact replies in the
  // corner. Urgent ones stay red: that colour is a warning, not decoration.
  const renderIncoming = (p: ActivePing) => {
    if (p.image_path) return renderIncomingNote(p)
    const isHigh = p.high_priority
    const phone = phones[p.sender_email]
    const blue = (APP_GRADIENT.pings as [string, string])[1]
    const body = (
      <>
        <View style={styles.top}>
          {isHigh ? (
            <View style={styles.emojiOnColor}>
              <Txt style={styles.emoji}>{p.emoji}</Txt>
            </View>
          ) : (
            <GradientBox colors={APP_GRADIENT.pings as [string, string]} radius={14} style={styles.emojiTile}>
              <Txt style={styles.emoji}>{p.emoji}</Txt>
            </GradientBox>
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt style={isHigh ? styles.kickerOnColor : [styles.kicker, { color: c.textMuted }]} numberOfLines={1}>
              {t('pings.from', { name: firstName(nameOf(p.sender_email)) })} · {timeAgo(p.created_at)}
            </Txt>
            <Txt style={isHigh ? styles.msgOnColor : [styles.msg, { color: c.text }]} numberOfLines={2}>
              {p.message}
            </Txt>
          </View>
        </View>
        <View style={styles.replies}>
          {/* Urgent: Call AND Got it, so a recipient can acknowledge
              without having to call. */}
          {isHigh && phone ? (
            <Pressable
              onPress={() => void Linking.openURL(`tel:${phone}`)}
              style={({ pressed }) => [styles.chipBtn, { backgroundColor: '#fff', opacity: pressed ? 0.8 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel={t('pings.call')}
            >
              <Phone size={14} strokeWidth={2.5} color={URGENT[1]} />
              <Txt style={[styles.pillTxt, { color: URGENT[1] }]}>{t('pings.call')}</Txt>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => ack(p.id)}
            style={({ pressed }) => [
              styles.roundPill,
              { backgroundColor: isHigh ? (phone ? 'rgba(255,255,255,0.22)' : '#fff') : blue, opacity: pressed ? 0.85 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={t('pings.gotIt')}
          >
            <ThumbsUp size={16} strokeWidth={2.5} color={isHigh && !phone ? URGENT[1] : '#fff'} />
          </Pressable>
        </View>
      </>
    )
    if (isHigh) {
      return (
        <GradientBox key={p.id} colors={URGENT} radius={24} style={styles.card}>
          {body}
        </GradientBox>
      )
    }
    return (
      <View key={p.id} style={[styles.card, { backgroundColor: c.card, borderWidth: 1, borderColor: blue + '55' }]}>
        {body}
      </View>
    )
  }

  // SENT — a plain card: what I sent, then WHO HAS SEEN IT, newest first.
  const renderSent = (p: ActivePing) => {
    if (p.image_path) return renderSentNote(p)
    const seen = p.acks.filter((a) => a.user_email !== myEmail).sort((x, y) => y.created_at.localeCompare(x.created_at))
    const audience = (p.recipients?.length ? p.recipients : profiles.map((m) => m.email)).filter((e) => e !== myEmail)
    const total = Math.max(audience.length, seen.length)
    return (
      <View
        key={p.id}
        style={[
          styles.card,
          {
            backgroundColor: c.card,
            borderColor: c.border,
            borderWidth: StyleSheet.hairlineWidth,
          },
        ]}
      >
        <View style={styles.top}>
          <GradientBox colors={APP_GRADIENT.pings as [string, string]} radius={14} style={styles.emojiTile}>
            <Txt style={styles.emoji}>{p.emoji}</Txt>
          </GradientBox>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt style={[styles.kicker, { color: c.textMuted }]} numberOfLines={1}>
              {t('pings.youSent')} · {timeAgo(p.created_at)}
            </Txt>
            <Txt style={[styles.msg, { color: c.text }]} numberOfLines={2}>
              {p.message}
            </Txt>
          </View>
          {/* ✕ dismiss from my home (persists on this device). */}
          <Pressable
            onPress={() => dismiss(p.id)}
            hitSlop={8}
            style={[styles.close, { backgroundColor: c.surface }]}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
          >
            <X size={14} color={c.textMuted} />
          </Pressable>
        </View>

        {/* One line, however big the family (owner, 2026-11): "Seen by:"
                then the names, the most recent first; the count on the right. */}
        <View style={[styles.seenBox, { borderTopColor: c.border }]}>
          <Txt style={{ flex: 1, fontSize: 13.5, color: c.textMuted }} numberOfLines={1}>
            <Txt style={{ fontSize: 13.5, fontWeight: '700', color: c.text }}>{t('pings.seenByLabel')}: </Txt>
            {seen.length ? seen.map((a) => firstName(nameOf(a.user_email))).join(', ') : t('pings.nobodyYet')}
          </Txt>
          {total ? (
            <View
              style={[
                styles.count,
                {
                  backgroundColor: seen.length === total ? c.income + '22' : c.surface,
                },
              ]}
            >
              {seen.length === total ? <Check size={12} color={c.income} strokeWidth={3} /> : null}
              <Txt
                style={{
                  fontSize: 12,
                  fontWeight: '700',
                  color: seen.length === total ? c.income : c.textMuted,
                }}
              >
                {t('pings.seenCount', { n: seen.length, total })}
              </Txt>
            </View>
          ) : null}
        </View>
      </View>
    )
  }

  // Received first (they need an answer), then sent.
  const all = [...incoming.map((p) => ({ p, mine: false })), ...sent.map((p) => ({ p, mine: true }))]
  const render = (x: { p: ActivePing; mine: boolean }) => (x.mine ? renderSent(x.p) : renderIncoming(x.p))

  if (all.length === 1) {
    return (
      <View style={{ marginBottom: sp.lg }}>
        {render(all[0])}
        {viewer}
      </View>
    )
  }

  // Two or more (owner, 2026-11-15: a busy family turned Home into a long
  // timeline): one card at a time in a horizontal carousel, the next one
  // peeking in from the right, dots under it. Every card is CARD_H tall, so
  // Home never jumps with the kind of nudge on screen (owner, 2026-11-15).
  const cardW = Math.min(screenW - sp.lg * 2 - PEEK, 520)
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / (cardW + GAP))
    if (i !== page) setPage(Math.max(0, Math.min(all.length - 1, i)))
  }
  return (
    <View style={{ marginBottom: sp.lg, marginHorizontal: -sp.lg }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={cardW + GAP}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        onScroll={onScroll}
        scrollEventThrottle={32}
        contentContainerStyle={{ paddingHorizontal: sp.lg, gap: GAP }}
      >
        {all.map((x) => (
          <View key={x.p.id} style={{ width: cardW }}>
            {render(x)}
          </View>
        ))}
      </ScrollView>
      <View style={styles.dots} accessibilityLabel={t('pings.stackTitle', { n: all.length })}>
        {all.map((x, i) => (
          <View
            key={x.p.id}
            style={[styles.dot, { backgroundColor: i === page ? (APP_GRADIENT.pings as [string, string])[1] : c.border, width: i === page ? 18 : 6 }]}
          />
        ))}
      </View>
      {viewer}
    </View>
  )
}

/** How much of the next card shows at the right edge. */
const PEEK = 28
/** Every nudge card is this tall — text, urgent, sent or a drawing. */
const CARD_H = 142
/** The drawing fills the card's height (minus padding and the tilt). */
const NOTE_H = CARD_H - sp.md * 2 - 4
const GAP = 10

const KRAFT: [string, string] = ['#F8EBD6', '#EDD7B4']
const INK = '#2B2521'
const INK_SOFT = 'rgba(43,37,33,0.62)'
/** The flat kraft the received drawing fades into. */
const KRAFT_SOLID = '#F3E2C6'

const URGENT: [string, string] = ['#F2605A', '#C9353F']

const firstName = (n: string) => n.split(' ')[0]

const styles = StyleSheet.create({
  card: { borderRadius: 24, padding: sp.md, gap: sp.md, height: CARD_H, justifyContent: 'space-between' },
  kraftCard: { borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(120,90,50,0.25)' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 5, marginTop: sp.sm },
  dot: { height: 6, borderRadius: 3 },
  noteThumb: {
    height: NOTE_H,
    aspectRatio: 0.8,
    borderRadius: 9,
    overflow: 'hidden',
    backgroundColor: '#FFFBF2',
    transform: [{ rotate: '-2deg' }],
  },
  noteCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: sp.md },
  noteSide: { flex: 1, minWidth: 0, alignSelf: 'stretch', justifyContent: 'space-between', paddingVertical: 2 },
  viewBtn: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,251,242,0.7)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(120,90,50,0.35)',
  },
  bleedCard: { padding: 0, flexDirection: 'row', backgroundColor: KRAFT_SOLID, overflow: 'hidden', gap: 0 },
  bleedArt: { position: 'absolute', left: 0, top: 0, bottom: 0, width: '58%' },
  bleedSide: { marginLeft: '50%', flex: 1, padding: sp.md, justifyContent: 'space-between' },
  roundPill: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  noteShadow: {
    shadowColor: '#2b1d10',
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: sp.md },
  emojiOnColor: {
    width: 46,
    height: 46,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiTile: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: { fontSize: 24 },
  kickerOnColor: {
    fontSize: 12.5,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.88)',
  },
  msgOnColor: {
    fontFamily: fonts.display,
    fontSize: 18,
    lineHeight: 23,
    color: '#fff',
    marginTop: 2,
  },
  kicker: { fontSize: 12.5, fontWeight: '600' },
  msg: {
    fontFamily: fonts.display,
    fontSize: 18,
    lineHeight: 23,
    marginTop: 2,
  },
  actions: { flexDirection: 'row', gap: sp.sm },
  pillTxt: { fontWeight: '700', fontSize: 14 },
  replies: { flexDirection: 'row', justifyContent: 'flex-end', gap: sp.sm },
  chipBtn: {
    height: 36,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  close: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seenBox: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: sp.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.sm,
  },
  count: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  label: {
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
})
