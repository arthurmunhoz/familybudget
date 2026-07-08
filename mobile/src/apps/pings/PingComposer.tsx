// Composer for household nudges. Sends three ways:
//  1. The household's editable one-tap presets (ping_presets — shared per
//     household, seeded from the built-in defaults). High-priority presets show
//     a red treatment and always go to everyone with sound/vibration + Call.
//  2. A recipient picker (multi-select; default Everyone). High-priority ALWAYS
//     goes to everyone, ignoring the picker.
//  3. An AI "just type it" box → /api/suggest-ping → {kind, emoji, message}.
//
// "Edit presets" flips the list into a manage mode: tap a preset to edit it,
// delete it, or add a new one (emoji + label + high-priority). Sending is a
// direct insert into `pings` (household_id + sender_email stamped by defaults).
import { useMemo, useState } from 'react'
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native'
import { Check, ChevronDown, ChevronUp, Pencil, Plus, Send, Sparkles, Trash2, X } from 'lucide-react-native'

import { Btn, Txt } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { useI18n } from '@/hooks/useI18n'
import { supabase } from '@/lib/supabase'
import {
  createPingPreset,
  deletePingPreset,
  fetchPingPresets,
  presetText,
  updatePingPreset,
} from '@/lib/pings'
import type { PingPreset } from '@/lib/types'
import { fonts, radius, sp, useTheme } from '@/theme/theme'

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

export default function PingComposer() {
  const { c } = useTheme()
  const { t, lang } = useI18n()
  const { profile, profiles } = useAuth()
  const myEmail = profile?.email

  const members = useMemo(() => profiles.filter((p) => p.email !== myEmail), [profiles, myEmail])

  const { data: presets = [], revalidate: reloadPresets } = useCachedQuery<PingPreset[]>(
    'ping:presets',
    fetchPingPresets,
  )

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pickerOpen, setPickerOpen] = useState(false)
  const [text, setText] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const sending = busyId !== null || aiBusy

  const [editMode, setEditMode] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<PingPreset | null>(null)

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
      const recipients = p.high_priority || everyone ? null : [...selected]
      await insertPing(p.preset_key ?? 'custom', p.emoji, presetText(p, t), recipients, p.high_priority)
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
      setText('')
    } catch {
      Alert.alert(t('pings.failed'))
    }
    setAiBusy(false)
  }

  function openNewPreset() {
    setEditing(null)
    setEditorOpen(true)
  }
  function openEditPreset(p: PingPreset) {
    setEditing(p)
    setEditorOpen(true)
  }
  function confirmDeletePreset(p: PingPreset) {
    Alert.alert(t('pings.deletePresetConfirm'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('pings.deletePreset'),
        style: 'destructive',
        onPress: async () => {
          await deletePingPreset(p.id)
          reloadPresets()
        },
      },
    ])
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

      {/* Presets header + edit toggle */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: sp.sm }}>
        <Txt variant="label" style={{ textTransform: 'uppercase', color: c.textFaint }}>
          {t('app.pings.name')}
        </Txt>
        <Pressable
          onPress={() => setEditMode((v) => !v)}
          hitSlop={8}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}
          accessibilityRole="button"
        >
          <Pencil size={13} color={c.accent} />
          <Txt style={{ color: c.accent, fontFamily: fonts.semibold, fontSize: 13 }}>
            {editMode ? t('pings.donePresets') : t('pings.editPresets')}
          </Txt>
        </Pressable>
      </View>

      {/* Preset list */}
      <View style={{ gap: sp.sm }}>
        {presets.map((p) => {
          const high = p.high_priority
          return (
            <Pressable
              key={p.id}
              onPress={() => (editMode ? openEditPreset(p) : sendPreset(p))}
              disabled={sending && !editMode}
              style={({ pressed }) => [
                styles.presetRow,
                {
                  backgroundColor: c.card,
                  borderColor: high ? c.expense : 'transparent',
                  opacity: !editMode && sending ? 0.5 : pressed ? 0.85 : 1,
                },
              ]}
              accessibilityRole="button"
            >
              <Txt style={styles.presetEmoji}>{busyId === p.id ? '…' : p.emoji}</Txt>
              <Txt style={{ fontWeight: '600', fontSize: 16, color: c.text, flex: 1 }} numberOfLines={1}>
                {presetText(p, t)}
              </Txt>
              {editMode ? (
                <Pressable
                  onPress={() => confirmDeletePreset(p)}
                  hitSlop={8}
                  accessibilityLabel={t('pings.deletePreset')}
                >
                  <Trash2 size={18} color={c.textFaint} />
                </Pressable>
              ) : high ? (
                <Txt style={{ color: c.expense, fontSize: 11, fontWeight: '700' }}>
                  {t('pings.highPriority').toUpperCase()}
                </Txt>
              ) : null}
            </Pressable>
          )
        })}

        {editMode ? (
          <Pressable
            onPress={openNewPreset}
            style={[styles.presetRow, { backgroundColor: 'transparent', borderColor: c.textFaint, borderStyle: 'dashed', justifyContent: 'center' }]}
            accessibilityRole="button"
          >
            <Plus size={18} color={c.textMuted} />
            <Txt style={{ fontWeight: '600', fontSize: 15, color: c.textMuted }}>
              {t('pings.addPreset')}
            </Txt>
          </Pressable>
        ) : null}
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

      {editorOpen ? (
        <PresetEditor
          preset={editing}
          onClose={() => setEditorOpen(false)}
          onSaved={() => {
            setEditorOpen(false)
            reloadPresets()
          }}
        />
      ) : null}
    </View>
  )
}

function PresetEditor({
  preset,
  onClose,
  onSaved,
}: {
  preset: PingPreset | null
  onClose: () => void
  onSaved: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const [emoji, setEmoji] = useState(preset?.emoji ?? '📣')
  const [label, setLabel] = useState(preset ? presetText(preset, t) : '')
  const [high, setHigh] = useState(preset?.high_priority ?? false)
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!label.trim() || saving) return
    setSaving(true)
    try {
      const fields = { emoji, label, high_priority: high }
      if (preset) await updatePingPreset(preset.id, fields)
      else await createPingPreset(fields)
      onSaved()
    } catch {
      Alert.alert(t('pings.presetSaveFailed'))
      setSaving(false)
    }
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' }}
      >
        <View
          style={{
            backgroundColor: c.card,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            padding: sp.lg,
            paddingBottom: sp.xl,
            gap: sp.md,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Txt variant="h2">{preset ? t('pings.editPreset') : t('pings.newPreset')}</Txt>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel={t('common.cancel')}>
              <X size={22} color={c.textMuted} />
            </Pressable>
          </View>

          <View style={{ flexDirection: 'row', gap: sp.md }}>
            <View style={{ gap: 6 }}>
              <Txt variant="label">{t('pings.presetEmoji')}</Txt>
              <TextInput
                value={emoji}
                onChangeText={setEmoji}
                maxLength={4}
                style={{
                  width: 64,
                  textAlign: 'center',
                  fontSize: 24,
                  backgroundColor: c.surface,
                  borderRadius: radius.md,
                  paddingVertical: 10,
                  color: c.text,
                }}
              />
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <Txt variant="label">{t('pings.presetLabel')}</Txt>
              <TextInput
                value={label}
                onChangeText={setLabel}
                placeholder={t('pings.presetLabelPlaceholder')}
                placeholderTextColor={c.textFaint}
                autoFocus={!preset}
                style={{
                  backgroundColor: c.surface,
                  borderRadius: radius.md,
                  paddingHorizontal: sp.md,
                  paddingVertical: 12,
                  fontSize: 16,
                  color: c.text,
                }}
              />
            </View>
          </View>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: sp.md,
              backgroundColor: c.surface,
              borderRadius: radius.md,
              paddingHorizontal: sp.md,
              paddingVertical: 10,
              borderWidth: high ? 2 : 0,
              borderColor: c.expense,
            }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt style={{ fontWeight: '600', color: high ? c.expense : c.text }}>
                {t('pings.highPriority')}
              </Txt>
              <Txt variant="faint" style={{ fontSize: 11 }}>
                {t('pings.highPriorityHint')}
              </Txt>
            </View>
            <Switch value={high} onValueChange={setHigh} trackColor={{ true: c.expense }} />
          </View>

          <Btn
            title={preset ? t('common.saveChanges') : t('pings.newPreset')}
            onPress={save}
            loading={saving}
            disabled={!label.trim()}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
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
