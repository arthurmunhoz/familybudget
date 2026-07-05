// Apple Calendar sync management — reached from the Apple button in the Calendar
// header. Unlike Google (server OAuth), this is ON-DEVICE via EventKit: connecting
// asks for Calendar permission, mirrors the device's iCloud calendars into One
// Roof, and pushes One Roof events back to a "One Roof" device calendar. Shows
// how many device calendars are synced + last sync, with Sync now / Disconnect.
// Gated behind One Roof Plus like Google. iOS-only — there is no Apple calendar
// API on the web, so the PWA can't offer this.
import { useEffect, useState } from 'react'
import { Alert, Pressable, View } from 'react-native'
import { router } from 'expo-router'

import { AppHeader, Btn, Card, Loader, Screen, Txt } from '@/components/ui'
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
import { sp, useTheme } from '@/theme/theme'
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
      await syncAppleCalendar()
      await refresh()
    } catch {
      Alert.alert(t('calendar.connectError'))
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

  const header = <AppHeader title={t('calendar.apple')} />

  if (!isAppleCalendarAvailable) {
    return (
      <Screen scroll header={header}>
        <Card style={{ gap: sp.sm }}>
          <Txt variant="muted">{t('calendar.appleUnavailable')}</Txt>
        </Card>
      </Screen>
    )
  }

  return (
    <Screen scroll header={header}>
      {loading ? (
        <Loader />
      ) : conn ? (
        <View style={{ gap: sp.lg }}>
          <Card style={{ gap: sp.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
              <AppleIcon size={22} color={c.text} />
              <Txt variant="h2">{t('calendar.apple')}</Txt>
            </View>
            <Txt variant="muted">
              {t('calendar.appleSynced', { count: String(conn.calendarCount) })}
            </Txt>
            <Txt variant="faint">
              {conn.lastSyncedAt
                ? t('calendar.lastSynced', { when: timeAgo(conn.lastSyncedAt) })
                : t('calendar.neverSynced')}
            </Txt>
            <Txt variant="faint">{t('calendar.appleSyncDir')}</Txt>
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
              <AppleIcon size={22} color={c.text} />
              <Txt variant="h2">{t('calendar.apple')}</Txt>
            </View>
            <Txt variant="muted">{t('calendar.appleHint')}</Txt>
            <Txt variant="faint">{t('calendar.appleSyncDir')}</Txt>
          </Card>
          <Btn
            title={busy ? t('calendar.syncing') : t('calendar.connectApple')}
            onPress={connect}
            loading={busy}
            disabled={busy}
          />
        </View>
      )}
    </Screen>
  )
}
