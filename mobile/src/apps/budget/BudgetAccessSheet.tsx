// "Who can view" — opened from the lock chip on a private budget's card.
// The owner gets a toggle per household member; everyone else gets the same list
// read-only. Backed by budget_members (migration 058), whose RLS already enforces
// all of this: only the owner can insert/delete rows, and only for people in the
// same household. The toggles here are UX, not the security boundary.
import { useCallback, useEffect, useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Users, X } from 'lucide-react-native'
import { Toggle } from '@/components/Toggle'
import { GradientBox } from '@/components/home/GradientBox'
import { budgetLook } from '@/components/home/palette'

import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/hooks/useI18n'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useTheme, fonts, sp } from '@/theme/theme'
import { Txt } from '@/components/ui'
import type { Budget } from '@/lib/types'

export function BudgetAccessSheet({ budget, onClose }: { budget: Budget; onClose: () => void }) {
  const { t } = useI18n()
  const { c, dark } = useTheme()
  const bottomGap = useBottomGap(sp.xl)
  const colors = budgetLook(budget.id).colors
  const tint = colors[1]
  const soft = tint + (dark ? '2E' : '1A')
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
        <Pressable
          style={[styles.sheet, { backgroundColor: c.sheet, paddingBottom: bottomGap }]}
          onPress={() => {}}
        >
          {/* 2026-11 head: the budget's gradient tile, its name as the kicker. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
            <GradientBox colors={colors} radius={18} style={{ width: 56, height: 56, alignItems: 'center', justifyContent: 'center' }}>
              <Users size={26} color="#fff" />
            </GradientBox>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt style={{ fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase', color: c.textMuted }} numberOfLines={1}>
                {budget.name}
              </Txt>
              <Txt style={{ fontFamily: fonts.display, fontSize: 24, lineHeight: 29, color: c.text, marginTop: 2 }} numberOfLines={2}>
                {t('budget.whoCanViewTitle')}
              </Txt>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' }}
            >
              <X size={16} color={c.textMuted} />
            </Pressable>
          </View>
          <Txt variant="muted" style={{ marginTop: sp.md, marginBottom: sp.md, lineHeight: 20 }}>
            {isOwner
              ? t('budget.whoCanViewDesc', { name: budget.name })
              : t('budget.sharedWithYou', { name: budget.name })}
          </Txt>

          <ScrollView
            style={{ flexGrow: 0, backgroundColor: c.card, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border }}
            contentContainerStyle={{ paddingHorizontal: sp.md }}
          >
            {/* owner */}
            <View style={[styles.row, { borderBottomColor: c.border, borderBottomWidth: others.length ? StyleSheet.hairlineWidth : 0 }]}>
              <Initial name={ownerName} tint={tint} soft={soft} />
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
                  backgroundColor: soft,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 999,
                }}
              >
                <Txt style={{ color: tint, fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.4 }}>
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
                    { borderBottomColor: c.border, borderBottomWidth: i < others.length - 1 ? StyleSheet.hairlineWidth : 0 },
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
                    <Toggle
                      tint={tint}
                      value={on}
                      onValueChange={(v) => void toggle(p.email, v)}
                      disabled={busy !== null}
                    />
                  ) : null}
                </View>
              )
            })}
          </ScrollView>

          <Txt variant="faint" style={{ marginTop: sp.md, paddingHorizontal: sp.xs, fontSize: 12.5, lineHeight: 18 }}>
            {isOwner ? t('budget.accessNote') : t('budget.accessNoteMember', { name: ownerName })}
          </Txt>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function Initial({ name, tint, soft }: { name: string; tint?: string; soft?: string }) {
  const { c } = useTheme()
  return (
    <View
      style={{
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: soft ?? c.surface,
      }}
    >
      <Txt style={{ fontWeight: '700', fontSize: 13, color: tint ?? c.textMuted }}>
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
    paddingTop: sp.lg,
    paddingBottom: sp.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.md,
    paddingVertical: 11,
    borderBottomWidth: 1,
  },
})
