// "Who can view" — opened from the lock chip on a private budget's card.
// The owner gets a toggle per household member; everyone else gets the same list
// read-only. Backed by budget_members (migration 058), whose RLS already enforces
// all of this: only the owner can insert/delete rows, and only for people in the
// same household. The toggles here are UX, not the security boundary.
import { useCallback, useEffect, useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native'

import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/hooks/useI18n'
import { useTheme, radius, sp } from '@/theme/theme'
import { Txt } from '@/components/ui'
import type { Budget } from '@/lib/types'

export function BudgetAccessSheet({ budget, onClose }: { budget: Budget; onClose: () => void }) {
  const { t } = useI18n()
  const { c } = useTheme()
  const { profile, profiles } = useAuth()
  const [shared, setShared] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)

  const isOwner = !!budget.owner_email && budget.owner_email === profile?.email
  const owner = profiles.find((p) => p.email === budget.owner_email)
  const ownerName = owner?.display_name ?? budget.owner_email ?? ''

  const load = useCallback(async () => {
    const { data } = await supabase.from('budget_members').select('email').eq('budget_id', budget.id)
    setShared(new Set((data ?? []).map((r: { email: string }) => r.email)))
  }, [budget.id])

  useEffect(() => {
    void load()
  }, [load])

  async function toggle(email: string, on: boolean) {
    if (busy) return
    setBusy(email)
    // Optimistic — revert if RLS refuses (it will for anyone but the owner).
    setShared((prev) => {
      const next = new Set(prev)
      if (on) next.add(email)
      else next.delete(email)
      return next
    })
    const { error } = on
      ? await supabase.from('budget_members').insert({ budget_id: budget.id, email })
      : await supabase.from('budget_members').delete().eq('budget_id', budget.id).eq('email', email)
    setBusy(null)
    if (error) {
      Alert.alert(t('budget.accessFailed'))
      void load()
    }
  }

  // Owner first, then everyone else. A non-owner only sees who actually has
  // access; the owner sees every member so they can grant it.
  const others = profiles
    .filter((p) => p.email !== budget.owner_email)
    .filter((p) => isOwner || shared.has(p.email))
    .sort((a, b) => a.display_name.localeCompare(b.display_name))

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: c.card }]} onPress={() => {}}>
          <View style={[styles.grab, { backgroundColor: c.border }]} />

          <Txt variant="title">{t('budget.whoCanViewTitle')}</Txt>
          <Txt variant="muted" style={{ marginTop: 2, marginBottom: sp.md }}>
            {isOwner
              ? t('budget.whoCanViewDesc', { name: budget.name })
              : t('budget.sharedWithYou', { name: budget.name })}
          </Txt>

          <ScrollView style={{ flexGrow: 0 }}>
            {/* owner */}
            <View style={[styles.row, { borderBottomColor: c.border }]}>
              <Initial name={ownerName} accent />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt style={{ fontWeight: '600' }} numberOfLines={1}>
                  {ownerName}
                  {budget.owner_email === profile?.email ? (
                    <Txt variant="faint"> ({t('budget.you')})</Txt>
                  ) : null}
                </Txt>
                <Txt variant="faint">{t('budget.createdThis')}</Txt>
              </View>
              <View
                style={{
                  backgroundColor: c.accentSoft,
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: radius.sm,
                }}
              >
                <Txt style={{ color: c.accent, fontWeight: '700', fontSize: 10 }}>
                  {t('budget.ownerBadge')}
                </Txt>
              </View>
            </View>

            {others.map((p, i) => {
              const on = shared.has(p.email)
              return (
                <View
                  key={p.email}
                  style={[
                    styles.row,
                    { borderBottomColor: c.border, borderBottomWidth: i < others.length - 1 ? 1 : 0 },
                  ]}
                >
                  <Initial name={p.display_name} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt style={{ fontWeight: '600' }} numberOfLines={1}>
                      {p.display_name}
                      {p.email === profile?.email ? (
                        <Txt variant="faint"> ({t('budget.you')})</Txt>
                      ) : null}
                    </Txt>
                    <Txt variant="faint">
                      {on ? t('budget.canViewAndAdd') : t('budget.noAccess')}
                    </Txt>
                  </View>
                  {isOwner ? (
                    <Switch
                      value={on}
                      onValueChange={(v) => void toggle(p.email, v)}
                      disabled={busy !== null}
                      trackColor={{ true: c.income, false: c.surface2 }}
                    />
                  ) : null}
                </View>
              )
            })}
          </ScrollView>

          <Txt variant="faint" style={{ marginTop: sp.md }}>
            {isOwner ? t('budget.accessNote') : t('budget.accessNoteMember', { name: ownerName })}
          </Txt>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function Initial({ name, accent }: { name: string; accent?: boolean }) {
  const { c } = useTheme()
  return (
    <View
      style={{
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: accent ? c.accentSoft : c.surface,
      }}
    >
      <Txt style={{ fontWeight: '700', fontSize: 13, color: accent ? c.accent : c.textMuted }}>
        {(name.trim().charAt(0) || '?').toUpperCase()}
      </Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '80%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: sp.lg,
    paddingTop: sp.md,
    paddingBottom: sp.xl,
  },
  grab: { width: 40, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: sp.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.md,
    paddingVertical: 11,
    borderBottomWidth: 1,
  },
})
