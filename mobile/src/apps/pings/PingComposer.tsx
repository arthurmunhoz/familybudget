// Composer for household nudges — RN port of the PWA's Pings page composer.
// Three ways to send:
//  1. Six one-tap presets (PING_PRESETS: kind + emoji; text from i18n).
//  2. A recipient picker (multi-select; default Everyone). The 🆘 help kind
//     ALWAYS goes to everyone, regardless of the picker.
//  3. An AI "just type it" box: POSTs the text to /api/suggest-ping, which maps
//     it to {kind, emoji, message}; on any failure we fall back to sending the
//     typed text verbatim as a custom nudge.
//
// Sending is a DIRECT supabase insert into `pings` — household_id + sender_email
// are stamped server-side by column defaults (don't pass them). `recipients` is
// null for everyone, else an array of member emails.
import { useMemo, useState } from 'react'
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native'
import { Check, ChevronDown, ChevronUp, Send, Sparkles } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/hooks/useI18n'
import { supabase } from '@/lib/supabase'
import { PING_PRESETS } from '@/lib/pings'
import type { TKey } from '@/lib/i18n'
import { radius, sp, useTheme } from '@/theme/theme'

const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? ''

/** Insert a nudge. household_id + sender_email are stamped by column defaults. */
async function insertPing(
  kind: string,
  emoji: string,
  message: string,
  recipients: string[] | null,
): Promise<void> {
  const { error } = await supabase.from('pings').insert({ kind, emoji, message, recipients })
  if (error) throw error
}

export default function PingComposer() {
  const { c } = useTheme()
  const { t, lang } = useI18n()
  const { profile, profiles } = useAuth()
  const myEmail = profile?.email

  // Other household members are the targetable recipients.
  const members = useMemo(
    () => profiles.filter((p) => p.email !== myEmail),
    [profiles, myEmail],
  )

  // Default: everyone selected. all-or-none selected → treated as "everyone".
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pickerOpen, setPickerOpen] = useState(false)
  const [text, setText] = useState('')
  const [busyKind, setBusyKind] = useState<string | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const sending = busyKind !== null || aiBusy

  const everyone = selected.size === 0 || selected.size === members.length

  /** null = whole household; else the chosen emails. `help` always = everyone. */
  function recipientsFor(kind: string): string[] | null {
    if (kind === 'help' || everyone) return null
    return [...selected]
  }

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

  async function preset(kind: string, emoji: string) {
    if (sending) return
    setBusyKind(kind)
    try {
      await insertPing(kind, emoji, t(`pings.preset.${kind}` as TKey), recipientsFor(kind))
    } catch {
      Alert.alert(t('pings.failed'))
    }
    setBusyKind(null)
  }

  // AI: map free text → {kind, emoji, message} via /api/suggest-ping, then send.
  // Best-effort: if the call fails, just send the typed text as a custom nudge.
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
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
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
      await insertPing(kind, emoji, message, recipientsFor(kind))
      setText('')
    } catch {
      Alert.alert(t('pings.failed'))
    }
    setAiBusy(false)
  }

  return (
    <View>
      {/* Recipient picker — a compact, recessed control. */}
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
              <Pressable
                onPress={() => setSelected(new Set())}
                style={styles.pickerRow}
                accessibilityRole="button"
              >
                <Txt style={{ flex: 1, fontWeight: '600', color: c.text }}>
                  {t('pings.everyone')}
                </Txt>
                {everyone && <Check size={16} strokeWidth={2.5} color={c.accent} />}
              </Pressable>
              {members.map((m) => {
                const on = !everyone && selected.has(m.email)
                return (
                  <Pressable
                    key={m.email}
                    onPress={() => toggle(m.email)}
                    style={styles.pickerRow}
                    accessibilityRole="button"
                  >
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

      {/* Preset nudges — one per line, full width. */}
      <View style={{ gap: sp.sm }}>
        {PING_PRESETS.map((p) => {
          const isHelp = p.kind === 'help'
          return (
            <Pressable
              key={p.kind}
              onPress={() => preset(p.kind, p.emoji)}
              disabled={sending}
              style={({ pressed }) => [
                styles.presetRow,
                {
                  backgroundColor: c.card,
                  borderColor: isHelp ? c.expense : 'transparent',
                  opacity: sending ? 0.5 : pressed ? 0.85 : 1,
                },
              ]}
              accessibilityRole="button"
            >
              <Txt style={styles.presetEmoji}>{busyKind === p.kind ? '…' : p.emoji}</Txt>
              <Txt style={{ fontWeight: '600', fontSize: 16, color: c.text }}>
                {t(`pings.preset.${p.kind}` as TKey)}
              </Txt>
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
          style={[
            styles.sendBtn,
            { backgroundColor: c.accent, opacity: !text.trim() || sending ? 0.5 : 1 },
          ]}
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
