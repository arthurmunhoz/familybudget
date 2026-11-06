// Apple Calendar sync management — reached from the Apple button in the Calendar
// header. Unlike Google (server OAuth), this is ON-DEVICE via EventKit: connecting
// asks for Calendar permission, mirrors the device's iCloud calendars into One
// Roof, and pushes One Roof events back to a "One Roof" device calendar. Shows
// how many device calendars are synced + last sync, with Sync now / Disconnect.
// Gated behind One Roof Plus like Google. iOS-only — there is no Apple calendar
// API on the web, so the PWA can't offer this.
import { useEffect, useState } from 'react'
import { Alert } from 'react-native'
import { router } from 'expo-router'

import { SyncScreen } from '@/apps/calendar/SyncScreen'
import { APP_GRADIENT } from '@/components/home/palette'
import { AlertTriangle, ArrowLeftRight, CalendarSync, RefreshCw } from 'lucide-react-native'
import { useI18n } from '@/hooks/useI18n'
import { usePlus } from '@/lib/plus'
import { timeAgo } from '@/lib/format'
import {
  connectAppleCalendar,
  disconnectAppleCalendar,
  getAppleConnection,
  isAppleCalendarAvailable,
  syncAppleCalendar,
  type AppleConnection,
} from '@/lib/appleCalendar'
import { useTheme } from '@/theme/theme'
import { AppleIcon } from '@/apps/calendar/AppleIcon'

export default function AppleCalendarScreen() {
  const { c } = useTheme()
  const { t } = useI18n()
  const { isPlus } = usePlus()
  const [conn, setConn] = useState<AppleConnection | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    getAppleConnection().then((v) => {
      if (active) {
        setConn(v)
        setLoading(false)
      }
    })
    return () => {
      active = false
    }
  }, [])

  async function refresh() {
    setConn(await getAppleConnection())
  }

  async function connect() {
    if (busy) return
    if (!isPlus) {
      router.push('/paywall')
      return
    }
    setBusy(true)
    try {
      const ok = await connectAppleCalendar()
      if (ok) await refresh()
      else Alert.alert(t('calendar.appleDenied'))
    } catch (e) {
      // No crash reporting is wired up yet — surface the real message so a
      // failure is diagnosable from the alert itself instead of a dead end.
      console.warn('[apple-calendar] connect failed', e)
      Alert.alert(t('calendar.connectError'), e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function sync() {
    if (busy) return
    setBusy(true)
    try {
      await syncAppleCalendar()
      await refresh()
    } catch (e) {
      console.warn('[apple-calendar] sync failed', e)
      Alert.alert(t('calendar.connectError'), e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function disconnect() {
    Alert.alert(t('calendar.apple'), t('calendar.disconnect') + '?', [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('calendar.disconnect'),
        style: 'destructive',
        onPress: async () => {
          setBusy(true)
          try {
            await disconnectAppleCalendar()
            await refresh()
          } finally {
            setBusy(false)
          }
        },
      },
    ])
  }

  const red = APP_GRADIENT.calendar[1]
  if (!isAppleCalendarAvailable) {
    return (
      <SyncScreen
        logo={<AppleIcon size={28} color={c.text} />}
        title={t('calendar.apple')}
        state={t('calendar.stateNotConnected')}
        facts={[{ icon: <AlertTriangle size={17} color={red} />, text: t('calendar.appleUnavailable') }]}
      />
    )
  }

  return (
    <SyncScreen
      logo={<AppleIcon size={28} color={c.text} />}
      title={t('calendar.apple')}
      state={conn ? t('calendar.stateConnected') : t('calendar.stateNotConnected')}
      loading={loading}
      facts={
        conn
          ? [
              { icon: <CalendarSync size={17} color={red} />, text: t('calendar.appleSynced', { count: String(conn.calendarCount) }) },
              {
                icon: <RefreshCw size={17} color={red} />,
                text: conn.lastSyncedAt ? t('calendar.lastSynced', { when: timeAgo(conn.lastSyncedAt) }) : t('calendar.neverSynced'),
                tone: 'faint',
              },
              { icon: <ArrowLeftRight size={17} color={red} />, text: t('calendar.appleSyncDir'), tone: 'faint' },
            ]
          : [
              { icon: <CalendarSync size={17} color={red} />, text: t('calendar.appleHint') },
              { icon: <ArrowLeftRight size={17} color={red} />, text: t('calendar.appleSyncDir'), tone: 'faint' },
            ]
      }
      action={conn ? t('calendar.syncNow') : t('calendar.connectApple')}
      onAction={conn ? sync : connect}
      busy={busy}
      onDisconnect={conn ? disconnect : undefined}
      disconnectLabel={t('calendar.disconnect')}
    />
  )
}
