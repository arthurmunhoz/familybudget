// Nudges screen — the household one-tap nudge module ("pings" internally).
// Shows the live list of active nudges up top (with 👍 ack / 📞 call), then the
// composer (presets + recipient picker + AI box). In-app Realtime is the
// delivery channel here; native push fan-out is intentionally skipped (it needs
// a server change), so nudges show up live on every member's screen via the
// Supabase Realtime subscription in PingsList.
import { AppHeader, Screen } from '@/components/ui'
import PingsList from '@/apps/pings/PingsList'
import PingComposer from '@/apps/pings/PingComposer'

export default function NudgesScreen() {
  return (
    <Screen scroll header={<AppHeader title="Nudges" />}>
      <PingsList />
      <PingComposer />
    </Screen>
  )
}
