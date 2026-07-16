// Bottom sheet shown when a member card field is long-pressed. For height /
// weight / shoe it lists the value converted to other popular units (the stored
// one flagged "current"); for blood type — which has no units — it shows
// donor/recipient compatibility instead.
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { useI18n } from '@/hooks/useI18n'
import { useTheme, sp, radius } from '@/theme/theme'
import { Txt } from '@/components/ui'
import { bloodCompat, convertRows, primaryLabel, type ConvertKind } from './units'

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
  const { c } = useTheme()

  const compat = kind === 'blood' ? bloodCompat(raw) : null
  const rows = kind === 'blood' ? null : convertRows(kind, raw)

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Inner press-catcher so taps on the sheet don't close it. */}
        <Pressable style={[styles.sheet, { backgroundColor: c.card }]} onPress={() => {}}>
          <View style={[styles.grab, { backgroundColor: c.border }]} />

          <Txt variant="label">{label}</Txt>
          <Txt variant="display" style={{ marginTop: 2, marginBottom: sp.md }}>
            {primaryLabel(kind, raw)}
          </Txt>

          {compat ? (
            <View style={{ gap: sp.md }}>
              {compat.universalDonor || compat.universalRecipient ? (
                <View
                  style={{
                    alignSelf: 'flex-start',
                    backgroundColor: 'rgba(52,199,89,0.16)',
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    borderRadius: radius.pill,
                  }}
                >
                  <Txt style={{ color: '#1f7a37', fontWeight: '700', fontSize: 13 }}>
                    {compat.universalDonor
                      ? t('family.universalDonor')
                      : t('family.universalRecipient')}
                  </Txt>
                </View>
              ) : null}

              <View>
                <Txt variant="muted" style={{ marginBottom: 6 }}>
                  {t('family.donateTo')}
                </Txt>
                <View style={styles.chips}>
                  {compat.give.map((b) => (
                    <BloodChip key={b} label={b} good />
                  ))}
                </View>
              </View>

              <View>
                <Txt variant="muted" style={{ marginBottom: 6 }}>
                  {t('family.receiveFrom')}
                </Txt>
                <View style={styles.chips}>
                  {compat.get.map((b) => (
                    <BloodChip key={b} label={b} />
                  ))}
                </View>
              </View>
            </View>
          ) : rows ? (
            <ScrollView style={{ flexGrow: 0 }}>
              {rows.map((r, i) => (
                <View
                  key={i}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingVertical: 12,
                    borderBottomWidth: i < rows.length - 1 ? StyleSheet.hairlineWidth : 0,
                    borderBottomColor: c.border,
                  }}
                >
                  <Txt style={{ fontSize: 18, fontWeight: r.primary ? '700' : '500' }}>
                    {r.value}
                  </Txt>
                  {r.primary ? (
                    <Txt style={{ color: c.accent, fontWeight: '700', fontSize: 12 }}>
                      {t('family.convertCurrent')}
                    </Txt>
                  ) : null}
                </View>
              ))}
              {kind === 'shoe' ? (
                <Txt variant="faint" style={{ marginTop: sp.md }}>
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

function BloodChip({ label, good }: { label: string; good?: boolean }) {
  const { c } = useTheme()
  return (
    <View
      style={{
        paddingHorizontal: 11,
        paddingVertical: 6,
        borderRadius: radius.sm,
        backgroundColor: good ? 'rgba(52,199,89,0.16)' : c.surface,
      }}
    >
      <Txt style={{ fontWeight: '700', fontSize: 14, color: good ? '#1f7a37' : c.text }}>
        {label}
      </Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '80%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: sp.lg,
    paddingTop: sp.md,
    paddingBottom: sp.xl,
  },
  grab: {
    width: 40,
    height: 5,
    borderRadius: 3,
    alignSelf: 'center',
    marginBottom: sp.md,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: sp.sm,
  },
})
