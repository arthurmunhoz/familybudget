// Home-screen nudge banners (the RN equivalent of the PWA's PingsBanner). Two
// groups, both between the Hub header and the app grid:
//  • RECEIVED — active nudges sent TO me I haven't acknowledged, each with a
//    respond CTA (Got it / Call). The row itself is inert: this banner IS the
//    inbox — there is no nudge history screen behind it.
//  • SENT — active nudges I sent, showing who has acknowledged ("seen by …"),
//    each with an ✕ to dismiss from my home (persisted per-device via
//    AsyncStorage; the nudge itself still lives until it expires).
//
// Its own lightweight Realtime subscription (distinct channel from the Nudges
// screen) so it stays live on the Hub. Renders nothing when both groups empty.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Vibration, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Check, ChevronRight, Eye, Layers, Phone, ThumbsUp, X } from 'lucide-react-native'
import { Image } from 'expo-image'

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

export default function NudgesBanner() {
  const { c } = useTheme()
  const { t } = useI18n()
  const { profile, profiles } = useAuth()
  const myEmail = profile?.email

  const [pings, setPings] = useState<ActivePing[]>([])
  const [phones, setPhones] = useState<Record<string, string>>({})
  const [ackedLocal, setAckedLocal] = useState<Set<string>>(new Set())
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState(false)
  // Hand-drawn notes (migration 112): signed URLs per image path, and the one
  // open full screen.
  const [noteUrls, setNoteUrls] = useState<Record<string, string>>({})
  const [viewing, setViewing] = useState<{ p: ActivePing; mine: boolean } | null>(null)
  const insets = useSafeAreaInsets()

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

  // The overlay closes itself once there's no stack left to show (everything
  // acknowledged / dismissed from inside it), so it can't pop back open later.
  // Adjusted during render (React's derived-state pattern), not in an effect.
  const stacked = incoming.length + sent.length >= STACK_FROM
  if (expanded && !stacked) setExpanded(false)

  if (incoming.length === 0 && sent.length === 0) return null

  /** Two RN modals can't be up at once on iOS: from inside the "see all"
   *  overlay, close it first, then open the note. */
  const openNote = (p: ActivePing, mine: boolean) => {
    if (!expanded) return setViewing({ p, mine })
    setExpanded(false)
    setTimeout(() => setViewing({ p, mine }), 350)
  }

  /** The drawn note itself on its card: a small sheet of paper, tilted a
   *  touch; tapping it opens the note full screen. */
  const noteThumb = (p: ActivePing, mine: boolean) => {
    const url = p.image_path ? noteUrls[p.image_path] : undefined
    return (
      <View style={styles.noteShadow}>
        <Pressable
          onPress={() => openNote(p, mine)}
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
        onGotIt={
          viewing.mine
            ? undefined
            : () => {
                const id = viewing.p.id
                setViewing(null)
                void ack(id)
              }
        }
      />
    ) : null

  // RECEIVED — a gradient card in the Nudges colour (red when it's urgent):
  // who and when as a kicker, the message large, the replies as pills inside
  // (2026-11). The card itself is inert.
  const renderIncoming = (p: ActivePing) => {
    const isHigh = p.high_priority
    const phone = phones[p.sender_email]
    const colors = isHigh ? URGENT : (APP_GRADIENT.pings as [string, string])
    return (
      <GradientBox key={p.id} colors={colors} radius={24} style={styles.card}>
        <View style={styles.top}>
          <View style={styles.emojiOnColor}>
            <Txt style={styles.emoji}>{p.emoji}</Txt>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt style={styles.kickerOnColor} numberOfLines={1}>
              {t('pings.from', { name: firstName(nameOf(p.sender_email)) })} · {timeAgo(p.created_at)}
            </Txt>
            <Txt style={styles.msgOnColor} numberOfLines={3}>
              {p.image_path ? t('notes.drew', { name: firstName(nameOf(p.sender_email)) }) : p.message}
            </Txt>
          </View>
        </View>
        {p.image_path ? noteThumb(p, false) : null}
        <View style={styles.actions}>
          {/* Urgent: Call AND Got it, so a recipient can acknowledge
                  without having to call. */}
          {isHigh && phone ? (
            <Pressable
              onPress={() => void Linking.openURL(`tel:${phone}`)}
              style={({ pressed }) => [styles.pill, { backgroundColor: '#fff', opacity: pressed ? 0.8 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel={t('pings.call')}
            >
              <Phone size={15} strokeWidth={2.5} color={colors[1]} />
              <Txt style={[styles.pillTxt, { color: colors[1] }]}>{t('pings.call')}</Txt>
            </Pressable>
          ) : null}
          {p.image_path ? (
            <Pressable
              onPress={() => openNote(p, false)}
              style={({ pressed }) => [styles.pill, { backgroundColor: 'rgba(255,255,255,0.22)', opacity: pressed ? 0.8 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel={t('notes.view')}
            >
              <Eye size={15} strokeWidth={2.5} color="#fff" />
              <Txt style={[styles.pillTxt, { color: '#fff' }]}>{t('notes.view')}</Txt>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => ack(p.id)}
            style={({ pressed }) => [
              styles.pill,
              isHigh && phone ? { backgroundColor: 'rgba(255,255,255,0.22)' } : { backgroundColor: '#fff' },
              { opacity: pressed ? 0.8 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={t('pings.gotIt')}
          >
            <ThumbsUp size={15} strokeWidth={2.5} color={isHigh && phone ? '#fff' : colors[1]} />
            <Txt style={[styles.pillTxt, { color: isHigh && phone ? '#fff' : colors[1] }]}>{t('pings.gotIt')}</Txt>
          </Pressable>
        </View>
      </GradientBox>
    )
  }

  // SENT — a plain card: what I sent, then WHO HAS SEEN IT, newest first.
  const renderSent = (p: ActivePing) => {
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
            <Txt style={[styles.msg, { color: c.text }]} numberOfLines={3}>
              {p.image_path ? t('notes.youDrew') : p.message}
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

        {p.image_path ? noteThumb(p, true) : null}

        {/* One line, however big the family (owner, 2026-11): "Seen by:"
                then the names, the most recent first; the count on the right. */}
        <View style={[styles.seenBox, { borderTopColor: c.border }]}>
          <Txt style={{ flex: 1, fontSize: 13.5, color: c.textMuted }} numberOfLines={2}>
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
  /** The colour a card shows, for the slices peeking out under the stack. */
  const tone = (x: { p: ActivePing; mine: boolean }) =>
    x.mine ? c.card : x.p.high_priority ? URGENT[1] : (APP_GRADIENT.pings as [string, string])[1]

  // Up to two: just the cards.
  if (all.length < STACK_FROM) {
    return (
      <View style={{ gap: sp.sm, marginBottom: sp.lg }}>
        {all.map(render)}
        {viewer}
      </View>
    )
  }

  // Three or more (owner, 2026-11: a busy day turned Home into a long scroll
  // of nudges): the newest card on top — its buttons still work — with the
  // next two peeking out beneath it like a stack, and a "+N · See all" chip.
  // Tapping the stack opens every card over a dimmed Home.
  const behind = all.slice(1, 3)
  return (
    <View style={{ marginBottom: sp.lg }}>
      <Pressable
        onPress={() => setExpanded(true)}
        accessibilityRole="button"
        accessibilityLabel={t('pings.stackOpen', { n: all.length })}
      >
        <View style={{ paddingBottom: 14 }}>
          {behind
            .map((x, i) => (
              <View
                key={`slice-${x.p.id}`}
                style={[
                  styles.slice,
                  {
                    bottom: i === 0 ? 7 : 0,
                    left: i === 0 ? 10 : 20,
                    right: i === 0 ? 10 : 20,
                    backgroundColor: tone(x),
                    opacity: i === 0 ? 0.75 : 0.45,
                    borderColor: c.border,
                  },
                ]}
              />
            ))
            .reverse()}
          {render(all[0])}
        </View>
        <View style={[styles.stackChip, { backgroundColor: c.card, borderColor: c.border }]}>
          <Layers size={14} color={c.textMuted} />
          <Txt style={{ fontSize: 13, fontFamily: fonts.semibold, color: c.text }}>
            {t('pings.stackMore', { n: all.length - 1 })}
          </Txt>
          <Txt style={{ fontSize: 13, color: c.textMuted }}>·</Txt>
          <Txt
            style={{
              fontSize: 13,
              fontFamily: fonts.semibold,
              color: (APP_GRADIENT.pings as [string, string])[1],
            }}
          >
            {t('pings.stackSeeAll')}
          </Txt>
          <ChevronRight size={14} color={(APP_GRADIENT.pings as [string, string])[1]} />
        </View>
      </Pressable>

      <Modal visible={expanded} transparent animationType="fade" onRequestClose={() => setExpanded(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }}>
          {/* Tapping the dim, not a card, closes. */}
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setExpanded(false)} accessible={false} />
          <View style={[styles.overlayHead, { paddingTop: insets.top + sp.sm }]} pointerEvents="box-none">
            <Txt
              style={{
                flex: 1,
                fontFamily: fonts.display,
                fontSize: 24,
                color: '#fff',
              }}
            >
              {t('pings.stackTitle', { n: all.length })}
            </Txt>
            <Pressable
              onPress={() => setExpanded(false)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              style={styles.overlayClose}
            >
              <X size={18} color="#fff" />
            </Pressable>
          </View>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{
              paddingHorizontal: sp.lg,
              paddingBottom: insets.bottom + sp.xl,
              gap: sp.sm,
            }}
            showsVerticalScrollIndicator={false}
          >
            {all.map(render)}
          </ScrollView>
        </View>
      </Modal>
      {viewer}
    </View>
  )
}

/** From this many nudges on, Home shows them as a stack. */
const STACK_FROM = 3

const URGENT: [string, string] = ['#F2605A', '#C9353F']

const firstName = (n: string) => n.split(' ')[0]

const styles = StyleSheet.create({
  card: { borderRadius: 24, padding: sp.md, gap: sp.md },
  noteThumb: {
    alignSelf: 'center',
    height: 210,
    aspectRatio: 0.72,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#FFFBF2',
    transform: [{ rotate: '-2deg' }],
    marginVertical: 4,
  },
  noteShadow: {
    alignSelf: 'center',
    shadowColor: '#2b1d10',
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
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
  pill: {
    flex: 1,
    height: 42,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  pillTxt: { fontWeight: '700', fontSize: 14 },
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
  slice: {
    position: 'absolute',
    height: 40,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
  },
  stackChip: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: sp.sm,
    paddingHorizontal: 14,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
  },
  overlayHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: sp.lg,
    paddingBottom: sp.md,
  },
  overlayClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
})
