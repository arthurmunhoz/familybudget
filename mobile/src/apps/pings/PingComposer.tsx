// Composer for household nudges. Sends three ways:
//  1. The household's one-tap presets (ping_presets). High-priority presets show
//     a red treatment and always go to everyone with sound/vibration + Call.
//  2. A recipient picker (multi-select; default Everyone). High-priority ALWAYS
//     goes to everyone, ignoring the picker.
//  3. An AI "just type it" box → /api/suggest-ping → {kind, emoji, message}.
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
// 2026-11 redesign (components/form): the recipient is a row ("To  Everyone ⌄")
// whose list opens in a checked bottom sheet — it used to be a dropdown
// anchored under a pill, measured in window coordinates. The presets are one
// grouped card of rows instead of a stack of bordered cards, and the AI box is
// a single row with its send button inside.
import { useMemo, useState } from 'react'
import { Alert, Modal, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { Pressable } from '@/components/Pressable'
import { Check, ChevronsUpDown, Send, Sparkles } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { FormRow, FormSection, RowValue } from '@/components/form'
import type { ToastData } from '@/components/Toast'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/hooks/useI18n'
import { useBottomGap } from '@/hooks/useBottomGap'
import { supabase } from '@/lib/supabase'
import { presetText, sendPing } from '@/lib/pings'
import type { PingPreset } from '@/lib/types'
import { fonts, radius, sp, useTheme } from '@/theme/theme'

const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? ''

type Member = { email: string; display_name: string }

/** The recipient list: a checked bottom sheet like form's SelectSheet, but
 *  MULTI-select — it stays open while you tick names, and closes on Done or a
 *  tap on the backdrop. "Everyone" clears the selection. */
function RecipientSheet({
  visible,
  title,
  members,
  selected,
  everyone,
  onEveryone,
  onToggle,
  onClose,
}: {
  visible: boolean
  title: string
  members: Member[]
  selected: Set<string>
  everyone: boolean
  onEveryone: () => void
  onToggle: (email: string) => void
  onClose: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const bottomGap = useBottomGap(sp.lg)
  const rows: { key: string; label: string; on: boolean; onPress: () => void }[] = [
    { key: '__everyone', label: t('pings.everyone'), on: everyone, onPress: onEveryone },
    ...members.map((m) => ({
      key: m.email,
      label: m.display_name,
      on: !everyone && selected.has(m.email),
      onPress: () => onToggle(m.email),
    })),
  ]
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={styles.sheetBackdrop} accessible={false}>
        <Pressable
          onPress={() => {}}
          accessible={false}
          style={[styles.sheet, { backgroundColor: c.sheet, paddingBottom: bottomGap }]}
        >
          <View style={{ alignItems: 'center', paddingBottom: sp.sm }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: c.border }} />
          </View>
          <View style={styles.sheetHead}>
            <View style={{ width: 60 }} />
            <Txt style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 16, textAlign: 'center' }}>{title}</Txt>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" style={{ width: 60, alignItems: 'flex-end' }}>
              <Txt style={{ color: c.accent, fontFamily: fonts.semibold, fontSize: 15 }}>{t('common.done')}</Txt>
            </Pressable>
          </View>
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: sp.lg }}>
            {rows.map((r, i) => (
              <Pressable
                key={r.key}
                onPress={r.onPress}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: r.on }}
                style={({ pressed }) => [
                  styles.sheetRow,
                  { borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: c.border, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Txt
                  numberOfLines={1}
                  style={{ flex: 1, fontSize: 16, color: r.on ? c.accent : c.text, fontFamily: r.on ? fonts.semibold : fonts.body }}
                >
                  {r.label}
                </Txt>
                {r.on ? <Check size={18} color={c.accent} strokeWidth={2.5} /> : null}
              </Pressable>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

/** One preset as a row of the presets card. High priority keeps its red
 *  treatment — a red emoji well and a small red tag — since that's a warning,
 *  not decoration. */
function PresetRow({
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
  const { c } = useTheme()
  const high = preset.high_priority
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [styles.presetRow, { opacity: disabled && !busy ? 0.5 : pressed ? 0.6 : 1 }]}
    >
      <View style={[styles.presetEmojiWell, { backgroundColor: high ? `${c.expense}1F` : c.surface }]}>
        <Txt style={styles.presetEmoji}>{busy ? '…' : preset.emoji}</Txt>
      </View>
      <Txt style={{ fontFamily: fonts.medium, fontSize: 16, color: c.text, flex: 1 }} numberOfLines={1}>
        {label}
      </Txt>
      {high ? (
        <Txt style={{ color: c.expense, fontSize: 11, fontFamily: fonts.semibold, letterSpacing: 0.4 }}>
          {highLabel.toUpperCase()}
        </Txt>
      ) : null}
    </Pressable>
  )
}

export default function PingComposer({
  presets,
  onSent,
}: {
  presets: PingPreset[]
  onSent: (data: ToastData) => void
}) {
  const { c } = useTheme()
  const { t, lang } = useI18n()
  const { profile, profiles } = useAuth()
  const myEmail = profile?.email

  const members = useMemo(() => profiles.filter((p) => p.email !== myEmail), [profiles, myEmail])

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pickerOpen, setPickerOpen] = useState(false)
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
      return next
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

  async function sendAI() {
    const value = text.trim()
    if (!value || sending) return
    setAiBusy(true)
    try {
      let kind = 'custom'
      let emoji = '📣'
      let message = value
      try {
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token ?? ''
        const res = await fetch(`${API_BASE}/api/suggest-ping`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ text: value, lang }),
        })
        if (res.ok) {
          const result = await res.json()
          emoji = (result.emoji || emoji).trim()
          message = (result.message || value).trim()
          kind = result.kind || kind
        }
      } catch {
        // AI unreachable — fall back to the typed text verbatim.
      }
      await sendPing(kind, emoji, message, everyone ? null : [...selected], false)
      onSent({ emoji, text: t('pings.sentToast', { label: message, who: toLabel }) })
      setText('')
    } catch {
      Alert.alert(t('pings.failed'))
    }
    setAiBusy(false)
  }

  const canSendAI = !!text.trim() && !sending

  return (
    <View style={{ gap: sp.lg }}>
      {/* Recipient — the list opens in a sheet. Hidden when you're alone in
          the household (there's no one to pick). */}
      {members.length > 0 ? (
        <>
          <FormSection>
            <FormRow label={toTitle} onPress={() => setPickerOpen(true)}>
              <RowValue value={toLabel} placeholder={t('pings.everyone')} />
              <ChevronsUpDown size={15} color={c.textFaint} />
            </FormRow>
          </FormSection>
          {/* Outside the section: FormSection treats every child as a row. */}
          <RecipientSheet
            visible={pickerOpen}
            title={toTitle}
            members={members}
            selected={selected}
            everyone={everyone}
            onEveryone={() => setSelected(new Set())}
            onToggle={toggle}
            onClose={() => setPickerOpen(false)}
          />
        </>
      ) : null}

      {/* One-tap presets */}
      {presets.length > 0 ? (
        <FormSection title={t('app.pings.name')}>
          {presets.map((p) => (
            <PresetRow
              key={p.id}
              preset={p}
              label={presetText(p, t)}
              busy={busyId === p.id}
              disabled={sending}
              highLabel={t('pings.highPriority')}
              onPress={() => sendPreset(p)}
            />
          ))}
        </FormSection>
      ) : null}

      {/* Divider */}
      <View style={styles.divider}>
        <View style={[styles.line, { backgroundColor: c.border }]} />
        <Txt variant="faint">{t('pings.or')}</Txt>
        <View style={[styles.line, { backgroundColor: c.border }]} />
      </View>

      {/* AI free-text: one row, the send button inside it. */}
      <View style={{ gap: sp.sm }}>
        <View style={[styles.aiRow, { backgroundColor: c.card, borderColor: c.border }]}>
          <Sparkles size={16} strokeWidth={2} color={c.accent} />
          <TextInput
            value={text}
            onChangeText={setText}
            onSubmitEditing={sendAI}
            returnKeyType="send"
            editable={!aiBusy}
            placeholder={t('pings.aiPlaceholder')}
            placeholderTextColor={c.textFaint}
            style={[styles.aiInput, { color: c.text }]}
          />
          <Pressable
            onPress={sendAI}
            disabled={!canSendAI}
            style={[styles.sendBtn, { backgroundColor: c.action, opacity: canSendAI ? 1 : 0.4 }]}
            accessibilityRole="button"
            accessibilityLabel={t('pings.send')}
          >
            <Send size={16} strokeWidth={2.5} color={c.onAction} />
          </Pressable>
        </View>
        <Txt variant="faint" style={{ fontSize: 12, marginHorizontal: sp.md }}>
          {t('pings.aiHint')}
        </Txt>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: sp.sm,
    maxHeight: '70%',
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: sp.lg, paddingBottom: sp.sm },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: sp.sm, minHeight: 50 },
  presetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.md,
    minHeight: 56,
    paddingHorizontal: sp.md,
    paddingVertical: 8,
  },
  presetEmojiWell: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  presetEmoji: { fontSize: 22 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: sp.md },
  line: { flex: 1, height: StyleSheet.hairlineWidth },
  aiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: sp.md,
    paddingRight: 6,
    minHeight: 52,
  },
  aiInput: { flex: 1, fontSize: 16, fontFamily: fonts.body, paddingVertical: 12 },
  sendBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
})
