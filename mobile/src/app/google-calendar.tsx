// Google Calendar sync management — reached from the Google button in the
// Calendar header. Shows which account/calendar is synced, when it last synced,
// and Sync now / Disconnect. When not connected, offers Connect (in-app OAuth;
// gated behind One Roof Plus like the rest). Two-way sync runs server-side; the
// Calendar screen picks up pulled events via its calendar_events Realtime
// subscription, so no explicit refresh is needed here.
import { useEffect, useState } from 'react'
import { Alert, Pressable, View } from 'react-native'
import { router } from 'expo-router'

import { AppHeader, Btn, Card, Loader, Screen, Txt } from '@/components/ui'
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
import { sp, useTheme } from '@/theme/theme'
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

  return (
    <Screen scroll header={<AppHeader title={t('calendar.google')} />}>
      {loading ? (
        <Loader />
      ) : conn ? (
        <View style={{ gap: sp.lg }}>
          <Card style={{ gap: sp.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
              <GoogleIcon size={22} />
              <Txt variant="h2">{t('calendar.google')}</Txt>
            </View>
            <Txt variant="muted">
              {t('calendar.connectedAs', { email: conn.google_email ?? conn.user_email })}
            </Txt>
            <Txt variant="faint">
              {conn.last_synced_at
                ? t('calendar.lastSynced', { when: timeAgo(conn.last_synced_at) })
                : t('calendar.neverSynced')}
            </Txt>
            <Txt variant="faint">{t('calendar.syncDir')}</Txt>
            {conn.last_error ? (
              <Txt style={{ color: c.expense, fontSize: 13 }}>
                {conn.last_error === 'TOKEN_EXPIRED'
                  ? t('calendar.googleTokenExpired')
                  : t('calendar.googleSyncError')}
              </Txt>
            ) : null}
          </Card>

          <Btn
            title={busy ? t('calendar.syncing') : t('calendar.syncNow')}
            onPress={sync}
            loading={busy}
            disabled={busy}
          />
          <Pressable
            onPress={disconnect}
            disabled={busy}
            style={{ paddingVertical: sp.md, alignItems: 'center' }}
          >
            <Txt style={{ color: c.expense, fontWeight: '600' }}>{t('calendar.disconnect')}</Txt>
          </Pressable>
        </View>
      ) : (
        <View style={{ gap: sp.lg }}>
          <Card style={{ gap: sp.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
              <GoogleIcon size={22} />
              <Txt variant="h2">{t('calendar.google')}</Txt>
            </View>
            <Txt variant="muted">{t('calendar.googleHint')}</Txt>
            <Txt variant="faint">{t('calendar.syncDir')}</Txt>
          </Card>
          <Btn
            title={busy ? t('calendar.syncing') : t('calendar.connectGoogle')}
            onPress={connect}
            loading={busy}
            disabled={busy}
          />
        </View>
      )}
    </Screen>
  )
}
