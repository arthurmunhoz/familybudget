// Google Calendar sync management — reached from the Google button in the
// Calendar header. Shows which account/calendar is synced, when it last synced,
// and Sync now / Disconnect. When not connected, offers Connect (in-app OAuth;
// gated behind One Roof Plus like the rest). Two-way sync runs server-side; the
// Calendar screen picks up pulled events via its calendar_events Realtime
// subscription, so no explicit refresh is needed here.
import { useEffect, useState } from 'react'
import { Alert } from 'react-native'
import { router } from 'expo-router'

import { SyncScreen } from '@/apps/calendar/SyncScreen'
import { APP_GRADIENT } from '@/components/home/palette'
import { AlertTriangle, ArrowLeftRight, CalendarSync, RefreshCw, UserRound } from 'lucide-react-native'
import { useI18n } from '@/hooks/useI18n'
import { usePlus } from '@/lib/plus'
import { timeAgo } from '@/lib/format'
import {
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  getGoogleConnection,
  syncGoogleCalendar,
  type GoogleConnection,
} from '@/lib/googleCalendar'
import { useTheme } from '@/theme/theme'
import { GoogleIcon } from '@/apps/calendar/GoogleIcon'

export default function GoogleCalendarScreen() {
  const { c } = useTheme()
  const { t } = useI18n()
  const { isPlus } = usePlus()
  const [conn, setConn] = useState<GoogleConnection | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    getGoogleConnection().then((v) => {
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
    setConn(await getGoogleConnection())
  }

  async function connect() {
    if (busy) return
    if (!isPlus) {
      router.push('/paywall')
      return
    }
    setBusy(true)
    try {
      const ok = await connectGoogleCalendar()
      if (ok) await refresh()
    } catch {
      Alert.alert(t('calendar.connectError'))
    } finally {
      setBusy(false)
    }
  }

  async function sync() {
    if (busy) return
    setBusy(true)
    try {
      await syncGoogleCalendar()
      await refresh()
    } catch {
      Alert.alert(t('calendar.connectError'))
    } finally {
      setBusy(false)
    }
  }

  function disconnect() {
    Alert.alert(t('calendar.google'), t('calendar.disconnect') + '?', [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('calendar.disconnect'),
        style: 'destructive',
        onPress: async () => {
          setBusy(true)
          try {
            await disconnectGoogleCalendar()
            await refresh()
          } finally {
            setBusy(false)
          }
        },
      },
    ])
  }

  const red = APP_GRADIENT.calendar[1]
  return (
    <SyncScreen
      logo={<GoogleIcon size={30} />}
      title={t('calendar.google')}
      state={conn ? t('calendar.stateConnected') : t('calendar.stateNotConnected')}
      loading={loading}
      facts={
        conn
          ? [
              { icon: <UserRound size={17} color={red} />, text: t('calendar.connectedAs', { email: conn.google_email ?? conn.user_email }) },
              {
                icon: <RefreshCw size={17} color={red} />,
                text: conn.last_synced_at ? t('calendar.lastSynced', { when: timeAgo(conn.last_synced_at) }) : t('calendar.neverSynced'),
                tone: 'faint',
              },
              { icon: <ArrowLeftRight size={17} color={red} />, text: t('calendar.syncDir'), tone: 'faint' },
              ...(conn.last_error
                ? [
                    {
                      icon: <AlertTriangle size={17} color={c.expense} />,
                      text: conn.last_error === 'TOKEN_EXPIRED' ? t('calendar.googleTokenExpired') : t('calendar.googleSyncError'),
                      tone: 'error' as const,
                    },
                  ]
                : []),
            ]
          : [
              { icon: <CalendarSync size={17} color={red} />, text: t('calendar.googleHint') },
              { icon: <ArrowLeftRight size={17} color={red} />, text: t('calendar.syncDir'), tone: 'faint' },
            ]
      }
      action={conn ? t('calendar.syncNow') : t('calendar.connectGoogle')}
      onAction={conn ? sync : connect}
      busy={busy}
      onDisconnect={conn ? disconnect : undefined}
      disconnectLabel={t('calendar.disconnect')}
    />
  )
}
