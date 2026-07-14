// Keeps the Home-Screen Nudges widget's App Group data (send token, household
// members, and the household's real editable presets) fresh. Fires on login/
// app launch and whenever the underlying data changes — NOT only when the
// user happens to visit the Nudges tab — so the widget works without the app
// ever being opened to that specific screen. Mounted once, globally, from
// mobile/src/app/_layout.tsx.
import { useEffect } from 'react'

import { useAuth } from '@/lib/auth'
import { useCachedQuery } from './useCachedQuery'
import { useI18n } from './useI18n'
import { fetchPingPresets, presetText } from '@/lib/pings'
import { supabase } from '@/lib/supabase'
import { syncNudgeWidget } from '@/lib/widget'
import type { PingPreset } from '@/lib/types'

export function useSyncNudgeWidget(): void {
  const { profile, profiles } = useAuth()
  const { t } = useI18n()
  const myEmail = profile?.email

  const { data: presets = [], loading: presetsLoading } = useCachedQuery<PingPreset[]>(
    'ping:presets',
    fetchPingPresets,
  )

  useEffect(() => {
    // Not signed in yet, or the presets fetch hasn't resolved once — wait,
    // rather than overwrite good widget data with an empty list.
    if (!myEmail || presetsLoading) return
    let active = true
    void (async () => {
      const { data } = await supabase.rpc('widget_token')
      const token = typeof data === 'string' ? data : null
      const members = profiles
        .filter((p) => p.email !== myEmail)
        .map((p) => ({ email: p.email, name: p.display_name || p.email.split('@')[0] }))
      const widgetPresets = presets.map((p) => ({
        id: p.id,
        kind: p.preset_key ?? 'custom',
        emoji: p.emoji,
        label: presetText(p, t),
        highPriority: p.high_priority,
      }))
      if (active) syncNudgeWidget({ token, members, presets: widgetPresets })
    })()
    return () => {
      active = false
    }
  }, [profiles, myEmail, presets, presetsLoading, t])
}
