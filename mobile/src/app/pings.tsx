// Nudges screen — the composer: preset list + recipient picker + the AI
// "just type it" box. Sending inserts directly under RLS and pushes via
// api/send-ping.
//
// There is no history here: an incoming nudge surfaces on the Hub through
// NudgesBanner (which owns its own Supabase Realtime subscription and carries
// the Got it / Call actions), and it drops off once acknowledged or expired.
import { useState } from 'react'
import { Pressable, ScrollView } from 'react-native'
import { Settings } from 'lucide-react-native'

import { AppHeader, Screen } from '@/components/ui'
import { Toast, type ToastData } from '@/components/Toast'
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { useI18n } from '@/hooks/useI18n'
import { fetchPingPresets } from '@/lib/pings'
import type { PingPreset } from '@/lib/types'
import { sp, useTheme } from '@/theme/theme'
import PingComposer from '@/apps/pings/PingComposer'
import { NudgeSettings } from '@/apps/pings/NudgeSettings'

export default function NudgesScreen() {
  const { c } = useTheme()
  const { t } = useI18n()

  const [settingsOpen, setSettingsOpen] = useState(false)
  // A NEW object each send so the toast re-triggers even for the same nudge.
  const [toast, setToast] = useState<ToastData | null>(null)

  // Presets are owned here so the composer and the settings modal share one
  // source of truth — editing in settings reflects in the composer without a
  // stale-cache round-trip.
  const { data: presets = [], revalidate: reloadPresets } = useCachedQuery<PingPreset[]>(
    'ping:presets',
    fetchPingPresets,
  )

  return (
    <>
      <Screen
        header={
          <AppHeader
            title={t('app.nudges')}
            right={
              <Pressable
                onPress={() => setSettingsOpen(true)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('pings.settings')}
              >
                <Settings size={22} color={c.textMuted} />
              </Pressable>
            }
          />
        }
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: sp.xxl }}
          keyboardShouldPersistTaps="handled"
        >
          <PingComposer presets={presets} onSent={setToast} />
        </ScrollView>
      </Screen>

      <Toast data={toast} />

      {settingsOpen ? (
        <NudgeSettings
          presets={presets}
          reloadPresets={reloadPresets}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </>
  )
}
