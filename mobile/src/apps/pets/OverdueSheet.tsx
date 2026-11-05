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
import { Modal, Pressable, ScrollView, View } from 'react-native'
import { Check, X } from 'lucide-react-native'

import { Btn, Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useSheetLift } from '@/hooks/useSheetLift'
import type { OverdueCare } from '@/lib/petCare'
import type { Pet } from '@/lib/types'
import { radius, sp, useTheme } from '@/theme/theme'
import { CARE_ICONS, TYPE_ICON } from './petUi'
import { speciesEmoji } from './petMeta'

export function OverdueSheet({
  items,
  current,
  petById,
  onDone,
  onClose,
}: {
  items: OverdueCare[]
  current: OverdueCare[]
  petById: Record<string, Pet>
  onDone: (item: OverdueCare) => Promise<boolean>
  onClose: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const bottomGap = useBottomGap(sp.xl)
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

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
        onLayout={onRootLayout}
      >
        <View
          style={{
            maxHeight: room * 0.85,
            marginBottom: lift,
            backgroundColor: c.sheet,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: sp.lg,
              paddingTop: sp.lg,
            }}
          >
            <Txt variant="h2">{t('pets.overdueSheetTitle')}</Txt>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel={t('common.close')}>
              <X size={22} color={c.textMuted} />
            </Pressable>
          </View>
          <Txt variant="muted" style={{ paddingHorizontal: sp.lg, paddingTop: sp.xs, paddingBottom: sp.md }}>
            {allDone ? t('pets.overdueAllDone') : t('pets.overdueSheetHint')}
          </Txt>

          <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={{ paddingHorizontal: sp.lg }}>
            {items.map((item, i) => {
              const pet = petById[item.petId]
              const Icon = item.kind === 'event' ? TYPE_ICON[item.event.type] : CARE_ICONS[item.task.icon]
              const done = isDone(item)
              const when =
                item.dueIn < 0 ? t('pets.overdue', { days: -item.dueIn }) : t('pets.dueToday')
              return (
                <View
                  key={item.key}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: sp.md,
                    paddingVertical: 12,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: c.border,
                    opacity: done ? 0.6 : 1,
                  }}
                >
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: c.surface,
                    }}
                  >
                    {Icon ? <Icon size={18} color={done ? c.textMuted : c.expense} /> : null}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt style={{ fontWeight: '600' }} numberOfLines={1}>
                      {item.title}
                    </Txt>
                    <Txt variant="faint" numberOfLines={1} style={{ fontSize: 12 }}>
                      {pet ? `${pet.emoji || speciesEmoji(pet.species)} ${pet.name} · ` : ''}
                      <Txt
                        style={{ fontSize: 12, fontWeight: '700', color: done ? c.textMuted : c.expense }}
                      >
                        {when}
                      </Txt>
                    </Txt>
                  </View>
                  {done ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10 }}>
                      <Check size={15} strokeWidth={3} color={c.income} />
                      <Txt style={{ fontSize: 13, fontWeight: '700', color: c.income }}>{t('pets.markDone')}</Txt>
                    </View>
                  ) : (
                    <Pressable
                      onPress={() => void markDone(item)}
                      hitSlop={8}
                      accessibilityLabel={`${t('pets.markDone')}: ${item.title}`}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 4,
                        paddingHorizontal: 12,
                        paddingVertical: 7,
                        borderRadius: radius.pill,
                        backgroundColor: c.action,
                      }}
                    >
                      <Check size={14} strokeWidth={3} color={c.onAction} />
                      <Txt style={{ fontSize: 13, fontWeight: '700', color: c.onAction }}>
                        {t('pets.markDone')}
                      </Txt>
                    </Pressable>
                  )}
                </View>
              )
            })}
          </ScrollView>

          <View
            style={{
              paddingHorizontal: sp.lg,
              paddingTop: sp.md,
              paddingBottom: clearOfBars ? sp.lg : bottomGap,
            }}
          >
            <Btn
              title={allDone ? t('common.done') : t('common.close')}
              variant={allDone ? undefined : 'secondary'}
              onPress={onClose}
            />
          </View>
        </View>
      </View>
    </Modal>
  )
}
