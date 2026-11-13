// "Roof does this for you" — a small card on an app's screen that opens a
// sheet of things you can ask Roof about THAT part of the app (owner,
// 2026-11: instead of one tip sentence). Tapping an example opens Roof right
// there with it typed in — you read it, then send (nothing is spent on a tap).
// Reusable: pass the examples' i18n keys and the screen's tint.
import { useEffect, useState } from 'react'
import { Modal, StyleSheet, View } from 'react-native'
import { ArrowUpRight, ChevronRight, X } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import { AskSheet } from '@/components/home/AskSheet'
import { Orb } from '@/components/home/AnswerViews'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'
import { fonts, sp, useTheme } from '@/theme/theme'

export function RoofExamples({ examples }: { examples: TKey[] }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const bottomGap = useBottomGap(sp.lg)
  const [open, setOpen] = useState(false)
  const [asking, setAsking] = useState<string | null>(null)
  const [askKey, setAskKey] = useState(0)
  // Two Modals must never be up at once on iOS: open Roof only after the
  // examples sheet has gone (its slide-out), not as its sibling.
  const [queued, setQueued] = useState<string | null>(null)
  useEffect(() => {
    if (!queued || open) return
    const id = setTimeout(() => {
      setAskKey((k) => k + 1)
      setAsking(queued)
      setQueued(null)
    }, 380)
    return () => clearTimeout(id)
  }, [queued, open])

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        style={({ pressed }) => [s.card, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}
      >
        <Orb size={26} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt style={{ fontFamily: fonts.semibold, fontSize: 14.5, color: c.text }} numberOfLines={1}>
            {t('roofEx.card')}
          </Txt>
          <Txt variant="faint" style={{ fontSize: 12.5 }} numberOfLines={1}>
            {t('roofEx.cardSub')}
          </Txt>
        </View>
        <ChevronRight size={18} color={c.textFaint} />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={s.backdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setOpen(false)} accessible={false} />
          <View style={[s.sheet, { backgroundColor: c.sheet, paddingBottom: bottomGap }]}>
            <View style={s.head}>
              <Orb size={44} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt style={{ fontFamily: fonts.display, fontSize: 24, lineHeight: 29, color: c.text }}>{t('roofEx.title')}</Txt>
                <Txt style={{ fontFamily: fonts.display, fontSize: 15, lineHeight: 20, color: c.textFaint }}>{t('roofEx.hint')}</Txt>
              </View>
              <Pressable
                onPress={() => setOpen(false)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('common.close')}
                style={[s.close, { backgroundColor: c.surface }]}
              >
                <X size={16} color={c.textMuted} />
              </Pressable>
            </View>
            <View style={[s.list, { backgroundColor: c.card, borderColor: c.border }]}>
              {examples.map((k, i) => (
                <Pressable
                  key={k}
                  onPress={() => {
                    setQueued(t(k))
                    setOpen(false)
                  }}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    s.row,
                    i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border } : null,
                    { opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  <Txt style={{ flex: 1, fontSize: 15.5, lineHeight: 21, color: c.text }}>“{t(k)}”</Txt>
                  <ArrowUpRight size={18} color={c.accent} />
                </Pressable>
              ))}
            </View>
            <Txt variant="faint" style={{ fontSize: 13, textAlign: 'center', marginTop: sp.md }}>
              {t('roofEx.foot')}
            </Txt>
          </View>
        </View>
      </Modal>

      {asking !== null ? (
        <AskSheet key={askKey} visible seed={asking} onClose={() => setAsking(null)} />
      ) : null}
    </>
  )
}

const s = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: sp.md, paddingVertical: 12, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: sp.lg, paddingHorizontal: sp.lg },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, marginBottom: sp.md },
  close: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  list: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: sp.md, paddingVertical: 15 },
})
