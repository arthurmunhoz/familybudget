// Settings › Account › "Export family data" (owner, 2026-11-13: any member;
// spreadsheets + optionally the vault's documents, behind Face ID; no photos;
// export only). The work is lib/familyExport.ts; this is the sheet: what's in
// it, the documents switch with their count and size, then Export → progress
// → the share sheet (Save to Files, AirDrop, mail…).
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Modal, Platform, StyleSheet, View } from 'react-native'
import * as LocalAuthentication from 'expo-local-authentication'
import { Download, FileSpreadsheet, FolderLock, X } from 'lucide-react-native'

import { formatBytes } from '@/apps/docs/docUtils'
import { GradientBox } from '@/components/home/GradientBox'
import { Pressable } from '@/components/Pressable'
import { TintButton } from '@/components/TintButton'
import { Toggle } from '@/components/Toggle'
import { Txt } from '@/components/ui'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useI18n } from '@/hooks/useI18n'
import { useAuth } from '@/lib/auth'
import { docsSummary, exportFamily, shareExport, type ExportProgress } from '@/lib/familyExport'
import { supabase } from '@/lib/supabase'
import { biometricAvailable } from '@/lib/vaultLock'
import { fonts, sp, useTheme } from '@/theme/theme'

const LOOK: [string, string] = ['#4FA3E0', '#2F6FC4']

export function ExportSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { c, dark } = useTheme()
  const { t } = useI18n()
  const { profile, profiles } = useAuth()
  const bottomGap = useBottomGap(sp.xs)
  const [docs, setDocs] = useState<{ count: number; bytes: number } | null>(null)
  const [withDocs, setWithDocs] = useState(true)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const busy = progress !== null
  const soft = LOOK[1] + (dark ? '2E' : '1A')
  const pending = useRef<string | null>(null)
  const sharePending = () => {
    const uri = pending.current
    pending.current = null
    if (!uri) return
    void shareExport(uri, t('export.title'))
      .then((ok) => {
        if (!ok) Alert.alert(t('export.noShare'))
      })
      .catch(() => Alert.alert(t('export.failed')))
  }

  useEffect(() => {
    if (!visible) return
    let alive = true
    void docsSummary().then((d) => {
      if (!alive) return
      setDocs(d)
      if (!d.count) setWithDocs(false)
    })
    return () => {
      alive = false
    }
  }, [visible])

  async function run() {
    if (busy) return
    const includeDocs = withDocs && !!docs?.count
    // The vault's files leave the app: confirm it's really you first.
    if (includeDocs && (await biometricAvailable())) {
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: t('export.verify'), cancelLabel: t('common.cancel') })
      if (!r.success) return
    }
    setProgress({ step: 'data', done: 0, total: 1 })
    try {
      const { data: hh } = await supabase.from('households').select('name').eq('id', profile?.household_id ?? '').maybeSingle()
      const { uri } = await exportFamily({
        t,
        profiles,
        familyName: (hh as { name?: string } | null)?.name ?? '',
        includeDocs,
        onProgress: setProgress,
      })
      setProgress(null)
      // The share sheet can't present while this Modal is still sliding out
      // (it silently didn't open): share from onDismiss (iOS), or after the
      // slide on Android, which has no onDismiss.
      pending.current = uri
      onClose()
      if (Platform.OS === 'android') setTimeout(sharePending, 450)
    } catch {
      setProgress(null)
      Alert.alert(t('export.failed'))
    }
  }

  const status =
    progress?.step === 'docs'
      ? t('export.workingDocs', { done: progress.done + 1, total: progress.total })
      : progress?.step === 'zip'
        ? t('export.zipping')
        : t('export.working')

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={() => !busy && onClose()} onDismiss={sharePending}>
      <View style={st.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={() => !busy && onClose()} accessible={false} />
        <View style={[st.sheet, { backgroundColor: c.sheet, paddingBottom: bottomGap }]}>
          <View style={st.head}>
            <GradientBox colors={LOOK} radius={18} style={st.tile}>
              <Download size={26} color="#fff" />
            </GradientBox>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt style={[st.kicker, { color: c.textMuted }]}>{t('settings.account')}</Txt>
              <Txt style={{ fontFamily: fonts.display, fontSize: 26, lineHeight: 31, color: c.text }}>{t('export.title')}</Txt>
            </View>
            <Pressable
              onPress={() => !busy && onClose()}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              style={[st.close, { backgroundColor: c.surface }]}
            >
              <X size={16} color={c.textMuted} />
            </Pressable>
          </View>
          <Txt style={{ fontSize: 15.5, lineHeight: 21, color: c.textMuted, paddingHorizontal: sp.lg }}>{t('export.sub')}</Txt>

          <View style={[st.card, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={st.row}>
              <View style={[st.rowIcon, { backgroundColor: soft }]}>
                <FileSpreadsheet size={18} color={LOOK[1]} />
              </View>
              <Txt style={{ flex: 1, fontSize: 14.5, lineHeight: 20, color: c.text }}>{t('export.what')}</Txt>
            </View>
            <Pressable
              onPress={() => docs?.count && !busy && setWithDocs((v) => !v)}
              accessibilityRole="switch"
              accessibilityState={{ checked: withDocs, disabled: !docs?.count }}
              style={[st.row, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border }]}
            >
              <View style={[st.rowIcon, { backgroundColor: soft }]}>
                <FolderLock size={18} color={LOOK[1]} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt style={{ fontFamily: fonts.semibold, fontSize: 15, color: c.text }}>{t('export.docs')}</Txt>
                <Txt style={{ fontSize: 13, color: c.textMuted }}>
                  {docs === null ? '…' : docs.count ? t('export.docsSize', { count: docs.count, size: formatBytes(docs.bytes) }) : t('export.docsNone')}
                </Txt>
              </View>
              <Toggle tint={LOOK[1]} value={withDocs && !!docs?.count} disabled={!docs?.count || busy} onValueChange={setWithDocs} />
            </Pressable>
          </View>
          <Txt variant="faint" style={{ fontSize: 13, paddingHorizontal: sp.lg }}>
            {t('export.private')}
          </Txt>

          <View style={{ paddingHorizontal: sp.lg, paddingTop: sp.sm }}>
            {busy ? (
              <View style={[st.progress, { backgroundColor: soft }]}>
                <ActivityIndicator color={LOOK[1]} />
                <Txt style={{ fontFamily: fonts.semibold, fontSize: 15, color: LOOK[1] }}>{status}</Txt>
              </View>
            ) : (
              <TintButton tint={LOOK[1]} colors={LOOK} title={t('export.go')} icon={<Download size={18} color="#fff" />} onPress={() => void run()} />
            )}
          </View>
        </View>
      </View>
    </Modal>
  )
}

const st = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.42)' },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: sp.lg, gap: sp.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: sp.lg },
  tile: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  kicker: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.6, textTransform: 'uppercase' },
  close: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  card: { marginHorizontal: sp.lg, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: sp.md, padding: sp.md },
  rowIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  progress: { height: 54, borderRadius: 27, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
})
