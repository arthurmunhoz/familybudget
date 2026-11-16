// Composer for household nudges. Sends three ways:
//  1. The household's one-tap presets (ping_presets). High-priority presets show
//     a red treatment and always go to everyone with sound/vibration + Call.
//  2. A recipient picker (multi-select; default Everyone). High-priority ALWAYS
//     goes to everyone, ignoring the picker.
//  3. "Write your own": sent EXACTLY as typed (≤120 chars, 💬), once — not
//     saved as a preset. (It used to go through /api/suggest-ping, which
//     reworded it; the owner wanted their own words, 2026-11.)
//
// Sending ALWAYS goes through `sendPing` in lib/pings.ts — never a bare insert
// into `pings`. The insert is only half of a send: the row shows up instantly
// over Realtime, but the phones only buzz if the server-side fan-out is asked
// to run afterwards. This screen had its own local insert helper for two
// months, so every nudge sent from the app looked fine and pushed to nobody.
// On success it calls onSent so the screen can flash a confirmation toast.
// Preset MANAGEMENT lives in the ⚙️ Nudge-settings modal, not here — this
// screen is only for sending. `presets` is owned by the screen and passed in.
//
// 2026-11 rethink (the Home's look): WHO is the family as round chips at the
// top (Everyone + each member, multi-select), the presets are a grid of tiles
// (emoji big, urgent ones as a red gradient tile), and "write your own" is
// the Home's ask-bar look with a gradient send button.
import { useMemo, useState } from 'react'
import { ActivityIndicator, Alert, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { Pressable } from '@/components/Pressable'
import { Check, ChevronRight, MessageCircle, Send, Users } from 'lucide-react-native'
import Svg, { Line, Path, Rect } from 'react-native-svg'
import { router } from 'expo-router'

import { Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import { APP_GRADIENT } from '@/components/home/palette'
import type { ToastData } from '@/components/Toast'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/hooks/useI18n'
import { presetText, sendPing } from '@/lib/pings'
import type { PingPreset } from '@/lib/types'
import { fonts, sp, useTheme } from '@/theme/theme'

/** A nudge is a glance on a lock screen, not a letter. */
const MAX_LEN = 120

/** One person (or Everyone) as a round chip; picked ones are ringed in the
 *  Nudges blue with a check. */
export function PersonChip({ label, initials, on, onPress, color }: { label: string; initials: string | null; on: boolean; onPress: () => void; color: string }) {
  const { c } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      style={{ alignItems: 'center', gap: 5, minWidth: 64, maxWidth: 96 }}
    >
      <View style={{ padding: 3, borderRadius: 31, borderWidth: 2.5, borderColor: on ? color : 'transparent' }}>
        <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: on ? color : c.surface, alignItems: 'center', justifyContent: 'center' }}>
          {initials ? (
            <Txt style={{ fontFamily: fonts.semibold, fontSize: 17, color: on ? '#fff' : c.textMuted }}>{initials}</Txt>
          ) : (
            <Users size={21} color={on ? '#fff' : c.textMuted} />
          )}
        </View>
        {on ? (
          <View style={[styles.check, { backgroundColor: color, borderColor: c.bg }]}>
            <Check size={11} color="#fff" strokeWidth={3.2} />
          </View>
        ) : null}
      </View>
      <Txt style={{ fontSize: 12.5, fontFamily: on ? fonts.semibold : fonts.body, color: on ? c.text : c.textMuted }} numberOfLines={1}>
        {label}
      </Txt>
    </Pressable>
  )
}

// The drawn-notes card wears kraft paper, like a received note on the Home.
const NOTE_KRAFT: [string, string] = ['#F8EBD6', '#EDD7B4']
const NOTE_INK = '#2B2521'
const NOTE_INK_SOFT = '#6B5E52'

/** The little sheet on the "Hand-drawn note" card: ruled paper with a red
 *  margin, a scribbled heart and hello, and a pencil resting on it. */
export function NoteArt({ size = 74 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 74 74">
      <Rect x={9} y={6} width={50} height={60} rx={7} fill="#FFFBF2" transform="rotate(-6 34 36)" />
      <Line x1={13} y1={24} x2={60} y2={19} stroke="#E9DFCB" strokeWidth={1.2} />
      <Line x1={14} y1={34} x2={61} y2={29} stroke="#E9DFCB" strokeWidth={1.2} />
      <Line x1={15} y1={44} x2={62} y2={39} stroke="#E9DFCB" strokeWidth={1.2} />
      <Line x1={16} y1={54} x2={63} y2={49} stroke="#E9DFCB" strokeWidth={1.2} />
      <Line x1={20} y1={9} x2={26} y2={66} stroke="#F1B9A6" strokeWidth={1.2} />
      <Path d="M33 37c-5-6-12-1-8 5l8 8 8-9c4-6-3-11-8-4z" fill="none" stroke="#D9468F" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M27 26q4-6 7 0q3 5 6-1q3-5 6 0" fill="none" stroke="#2B2521" strokeWidth={2} strokeLinecap="round" />
      <Path d="M49 64l15-27 6 3-15 27-7 3z" fill="#FFC93C" />
      <Path d="M64 37l6 3 2-4c1-2-4-5-5-3z" fill="#F08A8A" />
      <Path d="M49 64l6 3-7 3z" fill="#2B2521" />
    </Svg>
  )
}

/** A preset as a tile of the grid: the emoji big, the words under it. High
 *  priority is a red gradient tile with an URGENT tag — a warning, not
 *  decoration. */
function PresetTile({
  preset,
  label,
  busy,
  disabled,
  highLabel,
  onPress,
}: {
  preset: PingPreset
  label: string
  busy: boolean
  disabled: boolean
  highLabel: string
  onPress: () => void
}) {
  const { c, dark } = useTheme()
  const high = preset.high_priority
  const blue = APP_GRADIENT.pings[1]
  const body = (
    <>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={[styles.emojiWell, { backgroundColor: high ? 'rgba(255,255,255,0.22)' : blue + (dark ? '2E' : '17') }]}>
          {busy ? <ActivityIndicator color={high ? '#fff' : blue} /> : <Txt style={{ fontSize: 24 }}>{preset.emoji}</Txt>}
        </View>
        {high ? (
          <Txt style={{ color: '#fff', fontSize: 10.5, fontFamily: fonts.semibold, letterSpacing: 0.6 }}>{highLabel.toUpperCase()}</Txt>
        ) : (
          <Send size={15} color={c.textFaint} />
        )}
      </View>
      <Txt style={{ fontFamily: fonts.display, fontSize: 16, lineHeight: 20, color: high ? '#fff' : c.text }} numberOfLines={2}>
        {label}
      </Txt>
    </>
  )
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [{ width: '48.5%', opacity: disabled && !busy ? 0.5 : pressed ? 0.7 : 1 }]}
    >
      {high ? (
        <GradientBox colors={URGENT} radius={20} style={styles.tile}>
          {body}
        </GradientBox>
      ) : (
        <View style={[styles.tile, { borderRadius: 20, backgroundColor: c.card, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border }]}>
          {body}
        </View>
      )}
    </Pressable>
  )
}

const URGENT: [string, string] = ['#F2605A', '#C9353F']

export default function PingComposer({
  presets,
  onSent,
  onWriteFocus,
}: {
  presets: PingPreset[]
  onSent: (data: ToastData) => void
  /** The "write your own" field took focus — the host scrolls it into view. */
  onWriteFocus?: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const { profile, profiles } = useAuth()
  const myEmail = profile?.email

  const members = useMemo(() => profiles.filter((p) => p.email !== myEmail), [profiles, myEmail])

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [text, setText] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const sending = busyId !== null || aiBusy

  const everyone = selected.size === 0 || selected.size === members.length

  function toggle(email: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(email)) next.delete(email)
      else next.add(email)
      // Everyone picked one by one IS "Everyone": store it as that (an empty
      // set), or the chips showed Everyone while the next tap on a person
      // un-picked them and left the OTHER one selected (owner, 2026-11-13).
      return next.size >= members.length ? new Set<string>() : next
    })
  }

  const toLabel = everyone
    ? t('pings.everyone')
    : members
        .filter((m) => selected.has(m.email))
        .map((m) => m.display_name)
        .join(', ') || t('pings.everyone')
  // "To:" is written for an inline "To: Everyone" — as a row label the colon
  // is noise.
  const toTitle = t('pings.to').replace(/[:：]\s*$/, '')

  async function sendPreset(p: PingPreset) {
    if (sending) return
    setBusyId(p.id)
    try {
      // High priority always goes to everyone; otherwise honor the picker.
      const toEveryone = p.high_priority || everyone
      const recipients = toEveryone ? null : [...selected]
      const label = presetText(p, t)
      await sendPing(p.preset_key ?? 'custom', p.emoji, label, recipients, p.high_priority)
      onSent({ emoji: p.emoji, text: t('pings.sentToast', { label, who: toEveryone ? t('pings.everyone') : toLabel }) })
    } catch {
      Alert.alert(t('pings.failed'))
    }
    setBusyId(null)
  }

  /** "Write your own" goes out EXACTLY as typed (owner, 2026-11: the AI
   *  rewrote the words). One-off — never saved as a preset. */
  async function sendOwn() {
    const message = text.trim().slice(0, MAX_LEN)
    if (!message || sending) return
    setAiBusy(true)
    try {
      await sendPing('custom', '💬', message, everyone ? null : [...selected], false)
      onSent({ emoji: '💬', text: t('pings.sentToast', { label: message, who: toLabel }) })
      setText('')
    } catch {
      Alert.alert(t('pings.failed'))
    }
    setAiBusy(false)
  }

  const canSendAI = !!text.trim() && !sending

  const blue = APP_GRADIENT.pings[1]
  const initialsOf = (name: string) => {
    const parts = name.trim().split(/\s+/).filter(Boolean)
    return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?'
  }

  return (
    <View style={{ gap: sp.xl }}>
      {/* Who — the family as round chips, right where you start (2026-11).
          Hidden when you're alone in the household. */}
      {members.length > 0 ? (
        <View>
          <Txt style={[styles.label, { color: c.textMuted }]}>{toTitle}</Txt>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
            <PersonChip label={t('pings.everyone')} initials={null} on={everyone} onPress={() => setSelected(new Set())} color={blue} />
            {members.map((m) => (
              <PersonChip
                key={m.email}
                label={m.display_name.split(' ')[0]}
                initials={initialsOf(m.display_name)}
                on={!everyone && selected.has(m.email)}
                onPress={() => toggle(m.email)}
                color={blue}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* Hand-drawn notes (2026-11-15): a big kraft card that opens the notes
          page — "new note" first, then the wall of received and sent ones —
          carrying the recipients picked above. */}
      <Pressable
        onPress={() => router.push({ pathname: '/notes', params: { to: everyone ? '' : [...selected].join(',') } } as never)}
        disabled={sending}
        accessibilityRole="button"
        accessibilityLabel={t('notes.entryTitle')}
      >
        <GradientBox colors={NOTE_KRAFT} radius={26} style={styles.noteCard}>
          <View style={styles.noteArt}>
            <NoteArt size={96} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt style={{ fontFamily: fonts.display, fontSize: 24, lineHeight: 28, color: NOTE_INK }}>{t('notes.entryTitle')}</Txt>
            <Txt style={{ fontSize: 14.5, lineHeight: 20, color: NOTE_INK_SOFT, marginTop: 4 }}>{t('notes.entrySub')}</Txt>
          </View>
          <ChevronRight size={22} color={NOTE_INK_SOFT} />
        </GradientBox>
      </Pressable>

      {/* One-tap presets as a grid of tiles */}
      {presets.length > 0 ? (
        <View>
          <Txt style={[styles.label, { color: c.textMuted }]}>{t('pings.quick')}</Txt>
          <View style={styles.grid}>
            {presets.map((p) => (
              <PresetTile
                key={p.id}
                preset={p}
                label={presetText(p, t)}
                busy={busyId === p.id}
                disabled={sending}
                highLabel={t('pings.highPriority')}
                onPress={() => sendPreset(p)}
              />
            ))}
          </View>
        </View>
      ) : null}

      {/* Write your own — sent exactly as typed, once. The Home's ask-bar look. */}
      <View>
        <Txt style={[styles.label, { color: c.textMuted }]}>{t('pings.writeOwn')}</Txt>
        <View style={[styles.aiRow, { backgroundColor: c.card, borderColor: c.border }]}>
          <MessageCircle size={19} strokeWidth={2} color={blue} />
          <TextInput
            value={text}
            onChangeText={setText}
            onSubmitEditing={sendOwn}
            onFocus={onWriteFocus}
            returnKeyType="send"
            editable={!aiBusy}
            maxLength={MAX_LEN}
            placeholder={t('pings.ownPlaceholder')}
            placeholderTextColor={c.textFaint}
            style={[styles.aiInput, { color: c.text }]}
          />
          <Pressable
            onPress={sendOwn}
            disabled={!canSendAI}
            style={[styles.sendBtn, { opacity: canSendAI ? 1 : 0.4 }]}
            accessibilityRole="button"
            accessibilityLabel={t('pings.send')}
          >
            <GradientBox colors={APP_GRADIENT.pings} radius={14} style={{ width: 42, height: 42, alignItems: 'center', justifyContent: 'center' }}>
              {aiBusy ? <ActivityIndicator color="#fff" /> : <Send size={18} strokeWidth={2.4} color="#fff" />}
            </GradientBox>
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', marginTop: sp.sm, marginHorizontal: 4, gap: sp.sm }}>
          <Txt variant="faint" style={{ flex: 1, fontSize: 12.5 }}>
            {t('pings.ownHint')}
          </Txt>
          <Txt style={{ fontSize: 12.5, color: text.length >= MAX_LEN ? c.expense : c.textFaint }}>
            {text.length}/{MAX_LEN}
          </Txt>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  label: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase', marginBottom: sp.sm, paddingHorizontal: 2 },
  check: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  tile: { padding: sp.md, gap: sp.sm, minHeight: 116, justifyContent: 'space-between' },
  emojiWell: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  aiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.md,
    borderRadius: 20,
    borderWidth: 1,
    paddingLeft: sp.lg,
    paddingRight: 8,
    height: 58,
  },
  aiInput: { flex: 1, fontSize: 16, fontFamily: fonts.body, paddingVertical: 0 },
  sendBtn: { width: 42, height: 42 },
  noteCard: { flexDirection: 'row', alignItems: 'center', gap: sp.md, borderRadius: 26, padding: sp.md, paddingRight: sp.lg, minHeight: 128 },
  noteArt: { width: 100, height: 100, alignItems: 'center', justifyContent: 'center' },
})
