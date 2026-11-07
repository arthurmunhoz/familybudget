// Bottom sheet shown when a member's measured field is tapped. For height /
// weight / shoe it lists the value converted to other popular units (the stored
// one highlighted in the field's gradient); for blood type — which has no units
// — it shows donor/recipient compatibility instead. 2026-11 look: the field's
// own gradient icon + kicker + display value head, tiles below (matches the
// Family page's stat tiles).
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { X } from 'lucide-react-native'

import { useI18n } from '@/hooks/useI18n'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useTheme, sp, fonts } from '@/theme/theme'
import { Txt } from '@/components/ui'
import type { MemberProfile } from '@/lib/types'
import { FIELD_LOOK, IconTile } from './MemberDetail'
import { bloodCompat, convertRows, primaryLabel, type ConvertKind } from './units'

const KIND_FIELD: Record<ConvertKind, keyof MemberProfile> = {
  height: 'height',
  weight: 'weight',
  shoe: 'shoe_size',
  blood: 'blood_type',
}

export function ConvertSheet({
  kind,
  raw,
  label,
  onClose,
}: {
  kind: ConvertKind
  raw: string
  label: string
  onClose: () => void
}) {
  const { t } = useI18n()
  const { c, dark } = useTheme()
  const bottomGap = useBottomGap(sp.xxl)
  const look = FIELD_LOOK[KIND_FIELD[kind]]!
  const ink = look.colors[1]
  const soft = ink + (dark ? '2E' : '1A')

  const compat = kind === 'blood' ? bloodCompat(raw) : null
  const rows = kind === 'blood' ? null : convertRows(kind, raw)

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Inner press-catcher so taps on the sheet don't close it. */}
        <Pressable
          style={[styles.sheet, { backgroundColor: c.sheet, paddingBottom: bottomGap }]}
          onPress={() => {}}
        >
          <View style={styles.head}>
            <IconTile Icon={look.icon} colors={look.colors} size={52} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt style={[styles.kicker, { color: c.textMuted }]} numberOfLines={1}>
                {label}
              </Txt>
              <Txt style={{ fontFamily: fonts.display, fontSize: 28, lineHeight: 33, marginTop: 2 }} numberOfLines={1}>
                {primaryLabel(kind, raw)}
              </Txt>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              style={[styles.close, { backgroundColor: c.surface }]}
            >
              <X size={16} color={c.textMuted} />
            </Pressable>
          </View>

          {compat ? (
            <View style={{ gap: sp.lg }}>
              {compat.universalDonor || compat.universalRecipient ? (
                <View style={{ alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: soft }}>
                  <Txt style={{ color: ink, fontFamily: fonts.semibold, fontSize: 13.5 }}>
                    {compat.universalDonor ? t('family.universalDonor') : t('family.universalRecipient')}
                  </Txt>
                </View>
              ) : null}

              <View style={{ gap: sp.sm }}>
                <Txt style={[styles.kicker, { color: c.textMuted }]}>{t('family.donateTo')}</Txt>
                <View style={styles.chips}>
                  {compat.give.map((b) => (
                    <BloodChip key={b} label={b} ink={ink} soft={soft} />
                  ))}
                </View>
              </View>

              <View style={{ gap: sp.sm }}>
                <Txt style={[styles.kicker, { color: c.textMuted }]}>{t('family.receiveFrom')}</Txt>
                <View style={styles.chips}>
                  {compat.get.map((b) => (
                    <BloodChip key={b} label={b} />
                  ))}
                </View>
              </View>
            </View>
          ) : rows ? (
            <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: sp.md }}>
              <View style={styles.chips}>
                {rows.map((r, i) => (
                  // Selected = a soft wash of the field's colour + outline (like
                  // the new-budget period tiles); the rest stay neutral. The
                  // head's icon is the one solid fill on the sheet.
                  <View
                    key={i}
                    style={[
                      styles.unit,
                      r.primary
                        ? { backgroundColor: soft, borderWidth: 1.5, borderColor: ink }
                        : { backgroundColor: c.card, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border },
                    ]}
                  >
                    <Txt
                      style={{ fontFamily: fonts.display, fontSize: 20, lineHeight: 25, color: r.primary ? ink : c.text }}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                    >
                      {r.value}
                    </Txt>
                    {r.primary ? (
                      <Txt style={{ color: ink, fontFamily: fonts.semibold, fontSize: 11.5, letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 2 }}>
                        {t('family.convertCurrent')}
                      </Txt>
                    ) : null}
                  </View>
                ))}
              </View>
              {kind === 'shoe' ? (
                <Txt variant="faint" style={{ fontSize: 13 }}>
                  {t('family.convertApprox')}
                </Txt>
              ) : null}
            </ScrollView>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function BloodChip({ label, ink, soft }: { label: string; ink?: string; soft?: string }) {
  const { c } = useTheme()
  return (
    <View
      style={[
        styles.blood,
        ink
          ? { backgroundColor: soft, borderWidth: 1.5, borderColor: ink }
          : { backgroundColor: c.card, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border },
      ]}
    >
      <Txt style={{ fontFamily: fonts.display, fontSize: 17, color: ink ?? c.text }}>{label}</Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '80%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: sp.lg,
    paddingTop: sp.lg,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingBottom: sp.lg },
  kicker: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase' },
  close: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm },
  unit: { flexBasis: '47%', flexGrow: 1, minHeight: 64, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 12, justifyContent: 'center' },
  blood: { borderRadius: 14, minWidth: 56, height: 44, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
})
