// "Pet care overdue" — the sheet the daily digest's notification opens
// (data.url '/pets?overdue=1', see api/send-digest.ts). Lists everything due
// today or overdue across every pet, each with a Done button that logs it on
// the spot: a routine gets today's completion, an event reminder gets a new
// entry dated today with the next due rolled forward by its usual interval.
// PetCare owns the writes (`onDone`); this only renders and tracks progress.
//
// `items` is the list as it was when the sheet opened, so a row stays put —
// checked — after it's done instead of vanishing under the finger. `current`
// is the live list: anything no longer in it was handled (here, or by someone
// else in the meantime) and shows as done too.
import { useState } from 'react'
import { Modal, ScrollView, StyleSheet, View } from 'react-native'
import { Check, X } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { Btn, Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useSheetLift } from '@/hooks/useSheetLift'
import type { OverdueCare } from '@/lib/petCare'
import type { Pet } from '@/lib/types'
import { fonts, radius, sp, useTheme } from '@/theme/theme'
import { CARE_ICONS, TYPE_ICON } from './petUi'
import { TYPE_COLOR } from './petColors'
import { speciesEmoji } from './petMeta'

// 2026-11 restyle, in the Pet Care cards' language: display title with the
// count faded under it, every row on ONE rounded card, icon tiles in the
// event type's colour (routines in the pet's), Done as a pill.
export function OverdueSheet({
  items,
  current,
  petById,
  tintById,
  onDone,
  onClose,
}: {
  items: OverdueCare[]
  current: OverdueCare[]
  petById: Record<string, Pet>
  /** petId → the pet's colour (the one its cards wear). */
  tintById: Record<string, string>
  onDone: (item: OverdueCare) => Promise<boolean>
  onClose: () => void
}) {
  const { c, dark } = useTheme()
  const { t } = useI18n()
  const bottomGap = useBottomGap(sp.xs)
  const { lift, room, clearOfBars, onRootLayout } = useSheetLift()
  const [doneKeys, setDoneKeys] = useState<Set<string>>(new Set())

  const live = new Set(current.map((i) => i.key))
  const isDone = (item: OverdueCare) => doneKeys.has(item.key) || !live.has(item.key)
  const allDone = items.every(isDone)

  // Optimistic: the row flips to done on the tap itself — waiting for the
  // insert and the refetch behind it left a button that did nothing visible
  // for a second or two. A failure (onDone alerts) flips it back. Once flipped
  // the button is gone, so a second tap can't log the same thing twice.
  async function markDone(item: OverdueCare) {
    if (doneKeys.has(item.key)) return
    setDoneKeys((prev) => new Set(prev).add(item.key))
    const ok = await onDone(item)
    if (!ok) {
      setDoneKeys((prev) => {
        const next = new Set(prev)
        next.delete(item.key)
        return next
      })
    }
  }

  const left = items.filter((i) => !isDone(i)).length

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={st.backdrop} onLayout={onRootLayout}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessible={false} />
        <View style={[st.sheet, { maxHeight: room * 0.88, marginBottom: lift, backgroundColor: c.sheet }]}>
          <View style={st.head}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt style={{ fontFamily: fonts.display, fontSize: 28, lineHeight: 33, color: c.text }}>
                {t('pets.overdueSheetTitle')}
              </Txt>
              <Txt style={{ fontFamily: fonts.display, fontSize: 18, lineHeight: 23, color: allDone ? c.income : c.textFaint }}>
                {allDone ? t('pets.overdueAllDone') : t('pets.overdueCount', { n: left })}
              </Txt>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              style={[st.close, { backgroundColor: c.surface }]}
            >
              <X size={16} color={c.textMuted} />
            </Pressable>
          </View>
          {!allDone ? (
            <Txt variant="muted" style={{ fontSize: 13.5, paddingHorizontal: sp.lg, paddingBottom: sp.md }}>
              {t('pets.overdueSheetHint')}
            </Txt>
          ) : null}

          <ScrollView
            style={{ flexGrow: 0, flexShrink: 1 }}
            contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: sp.sm }}
          >
            <View style={[st.card, { backgroundColor: c.card, borderColor: c.border }]}>
              {items.map((item, i) => {
                const pet = petById[item.petId]
                const Icon = item.kind === 'event' ? TYPE_ICON[item.event.type] : CARE_ICONS[item.task.icon]
                const tone = item.kind === 'event' ? TYPE_COLOR[item.event.type] : (tintById[item.petId] ?? c.accent)
                const done = isDone(item)
                const when = item.dueIn < 0 ? t('pets.overdue', { days: -item.dueIn }) : t('pets.dueToday')
                return (
                  <View
                    key={item.key}
                    style={[
                      st.row,
                      { borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth, borderTopColor: c.border },
                    ]}
                  >
                    <View style={[st.icon, { backgroundColor: tone + (dark ? '2E' : '1A'), opacity: done ? 0.5 : 1 }]}>
                      {Icon ? <Icon size={18} color={tone} /> : null}
                    </View>
                    <View style={{ flex: 1, minWidth: 0, opacity: done ? 0.55 : 1 }}>
                      <Txt style={{ fontFamily: fonts.display, fontSize: 16.5 }} numberOfLines={1}>
                        {item.title}
                      </Txt>
                      <Txt variant="faint" numberOfLines={1} style={{ fontSize: 12.5 }}>
                        {pet ? `${pet.emoji || speciesEmoji(pet.species)} ${pet.name} · ` : ''}
                        <Txt style={{ fontSize: 12.5, fontFamily: fonts.semibold, color: done ? c.textMuted : c.expense }}>
                          {when}
                        </Txt>
                      </Txt>
                    </View>
                    {done ? (
                      <View style={[st.pill, { backgroundColor: c.income }]}>
                        <Check size={14} strokeWidth={3} color="#fff" />
                        <Txt style={{ fontSize: 13, fontFamily: fonts.semibold, color: '#fff' }}>{t('pets.markDone')}</Txt>
                      </View>
                    ) : (
                      <Pressable
                        onPress={() => void markDone(item)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={`${t('pets.markDone')}: ${item.title}`}
                        style={({ pressed }) => [st.pill, { backgroundColor: c.action, opacity: pressed ? 0.75 : 1 }]}
                      >
                        <Check size={14} strokeWidth={3} color={c.onAction} />
                        <Txt style={{ fontSize: 13, fontFamily: fonts.semibold, color: c.onAction }}>
                          {t('pets.markDone')}
                        </Txt>
                      </Pressable>
                    )}
                  </View>
                )
              })}
            </View>
          </ScrollView>

          <View style={{ paddingHorizontal: sp.lg, paddingTop: sp.sm, paddingBottom: clearOfBars ? sp.md : bottomGap }}>
            <Btn
              title={allDone ? t('common.done') : t('common.close')}
              variant={allDone ? undefined : 'secondary'}
              onPress={onClose}
              curveBottom
            />
          </View>
        </View>
      </View>
    </Modal>
  )
}

const st = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: sp.lg },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingHorizontal: sp.lg, paddingBottom: sp.sm },
  close: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: sp.md, paddingVertical: 11 },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
  },
})
