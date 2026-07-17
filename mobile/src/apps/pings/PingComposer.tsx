// Composer for household nudges. Sends three ways:
//  1. The household's one-tap presets (ping_presets). High-priority presets show
//     a red treatment and always go to everyone with sound/vibration + Call.
//  2. A recipient picker (multi-select; default Everyone). High-priority ALWAYS
//     goes to everyone, ignoring the picker.
//  3. An AI "just type it" box → /api/suggest-ping → {kind, emoji, message}.
//
// Sending is a direct insert into `pings` (household_id + sender_email stamped by
// defaults); on success it calls onSent so the screen can flash a confirmation
// toast. Preset MANAGEMENT lives in the ⚙️ Nudge-settings modal, not here — this
// screen is only for sending. `presets` is owned by the screen and passed in.
import { useMemo, useState } from 'react'
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native'
import { Check, ChevronDown, ChevronUp, Send, Sparkles } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import type { ToastData } from '@/components/Toast'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/hooks/useI18n'
import { supabase } from '@/lib/supabase'
import { presetText } from '@/lib/pings'
import type { PingPreset } from '@/lib/types'
import { radius, sp, useTheme } from '@/theme/theme'

const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? ''

async function insertPing(
  kind: string,
  emoji: string,
  message: string,
  recipients: string[] | null,
  highPriority: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('pings')
    .insert({ kind, emoji, message, recipients, high_priority: highPriority })
  if (error) throw error
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

  async function sendPreset(p: PingPreset) {
    if (sending) return
    setBusyId(p.id)
    try {
      // High priority always goes to everyone; otherwise honor the picker.
      const toEveryone = p.high_priority || everyone
      const recipients = toEveryone ? null : [...selected]
      const label = presetText(p, t)
      await insertPing(p.preset_key ?? 'custom', p.emoji, label, recipients, p.high_priority)
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
      await insertPing(kind, emoji, message, everyone ? null : [...selected], false)
      onSent({ emoji, text: t('pings.sentToast', { label: message, who: toLabel }) })
      setText('')
    } catch {
      Alert.alert(t('pings.failed'))
    }
    setAiBusy(false)
  }

  return (
    <View>
      {/* Recipient picker */}
      {members.length > 0 && (
        <View style={{ marginBottom: sp.lg }}>
          <Pressable
            onPress={() => setPickerOpen((v) => !v)}
            style={[styles.pickerHead, { backgroundColor: c.surface }]}
            accessibilityRole="button"
          >
            <Txt variant="label" style={{ textTransform: 'uppercase', color: c.textFaint }}>
              {t('pings.to')}
            </Txt>
            <Txt numberOfLines={1} style={{ flex: 1, fontWeight: '600', color: c.text }}>
              {toLabel}
            </Txt>
            {pickerOpen ? (
              <ChevronUp size={16} strokeWidth={2} color={c.textFaint} />
            ) : (
              <ChevronDown size={16} strokeWidth={2} color={c.textFaint} />
            )}
          </Pressable>
          {pickerOpen && (
            <View style={[styles.pickerBody, { backgroundColor: c.surface }]}>
              <Pressable onPress={() => setSelected(new Set())} style={styles.pickerRow}>
                <Txt style={{ flex: 1, fontWeight: '600', color: c.text }}>{t('pings.everyone')}</Txt>
                {everyone && <Check size={16} strokeWidth={2.5} color={c.accent} />}
              </Pressable>
              {members.map((m) => {
                const on = !everyone && selected.has(m.email)
                return (
                  <Pressable key={m.email} onPress={() => toggle(m.email)} style={styles.pickerRow}>
                    <Txt numberOfLines={1} style={{ flex: 1, color: c.text }}>
                      {m.display_name}
                    </Txt>
                    {on && <Check size={16} strokeWidth={2.5} color={c.accent} />}
                  </Pressable>
                )
              })}
            </View>
          )}
        </View>
      )}

      {/* Presets header */}
      <Txt variant="label" style={{ textTransform: 'uppercase', color: c.textFaint, marginBottom: sp.sm }}>
        {t('app.pings.name')}
      </Txt>

      {/* Preset list */}
      <View style={{ gap: sp.sm }}>
        {presets.map((p) => {
          const high = p.high_priority
          return (
            <Pressable
              key={p.id}
              onPress={() => sendPreset(p)}
              disabled={sending}
              style={({ pressed }) => [
                styles.presetRow,
                {
                  backgroundColor: c.card,
                  borderColor: high ? c.expense : 'transparent',
                  opacity: sending ? 0.5 : pressed ? 0.85 : 1,
                },
              ]}
              accessibilityRole="button"
            >
              <Txt style={styles.presetEmoji}>{busyId === p.id ? '…' : p.emoji}</Txt>
              <Txt style={{ fontWeight: '600', fontSize: 16, color: c.text, flex: 1 }} numberOfLines={1}>
                {presetText(p, t)}
              </Txt>
              {high ? (
                <Txt style={{ color: c.expense, fontSize: 11, fontWeight: '700' }}>
                  {t('pings.highPriority').toUpperCase()}
                </Txt>
              ) : null}
            </Pressable>
          )
        })}
      </View>

      {/* Divider */}
      <View style={styles.divider}>
        <View style={[styles.line, { backgroundColor: c.border }]} />
        <Txt variant="faint">{t('pings.or')}</Txt>
        <View style={[styles.line, { backgroundColor: c.border }]} />
      </View>

      {/* AI free-text */}
      <View style={styles.aiRow}>
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={sendAI}
          returnKeyType="send"
          editable={!aiBusy}
          placeholder={t('pings.aiPlaceholder')}
          placeholderTextColor={c.textFaint}
          style={[styles.aiInput, { backgroundColor: c.card, color: c.text, borderColor: c.border }]}
        />
        <Pressable
          onPress={sendAI}
          disabled={!text.trim() || sending}
          style={[styles.sendBtn, { backgroundColor: c.accent, opacity: !text.trim() || sending ? 0.5 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel={t('pings.send')}
        >
          <Send size={18} strokeWidth={2.5} color="#ffffff" />
        </Pressable>
      </View>
      <View style={styles.hint}>
        <Sparkles size={14} strokeWidth={2} color={c.textFaint} />
        <Txt variant="faint" style={{ flex: 1 }}>
          {t('pings.aiHint')}
        </Txt>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  pickerHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.sm,
    borderRadius: radius.pill,
    paddingHorizontal: sp.lg,
    paddingVertical: 10,
  },
  pickerBody: { marginTop: 6, borderRadius: radius.md, padding: 6 },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.sm,
    borderRadius: radius.sm,
    paddingHorizontal: sp.md,
    paddingVertical: 10,
  },
  presetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.md,
    borderRadius: radius.md,
    borderWidth: 2,
    paddingHorizontal: sp.lg,
    paddingVertical: 14,
  },
  presetEmoji: { fontSize: 24 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: sp.md, marginVertical: sp.lg },
  line: { flex: 1, height: StyleSheet.hairlineWidth },
  aiRow: { flexDirection: 'row', gap: sp.sm },
  aiInput: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: sp.lg,
    paddingVertical: 14,
    fontSize: 16,
  },
  sendBtn: {
    borderRadius: radius.md,
    paddingHorizontal: sp.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: sp.sm },
})
