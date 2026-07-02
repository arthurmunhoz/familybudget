// The Google Calendar row on the Calendar screen: connect (in-app OAuth), then
// show the connected account with "Sync now" + "Disconnect". Two-way sync runs
// server-side; onChanged() revalidates the calendar so pulled events appear.
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, View } from 'react-native'

import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import {
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  getGoogleConnection,
  syncGoogleCalendar,
  type GoogleConnection,
} from '@/lib/googleCalendar'
import { radius, sp, useTheme } from '@/theme/theme'

export function GoogleConnect({ onChanged }: { onChanged: () => void }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const [conn, setConn] = useState<GoogleConnection | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    getGoogleConnection().then((v) => {
      if (active) setConn(v)
    })
    return () => {
      active = false
    }
  }, [])

  async function refreshConn() {
    setConn(await getGoogleConnection())
  }

  async function connect() {
    if (busy) return
    setBusy(true)
    try {
      const ok = await connectGoogleCalendar()
      if (ok) {
        await refreshConn()
        onChanged()
      }
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
      await refreshConn()
      onChanged()
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
            await refreshConn()
            onChanged()
          } finally {
            setBusy(false)
          }
        },
      },
    ])
  }

  const rowStyle = {
    backgroundColor: c.card,
    borderRadius: radius.md,
    padding: sp.md,
    marginTop: sp.sm,
  }

  if (!conn) {
    return (
      <Pressable
        disabled={busy}
        onPress={connect}
        style={{
          ...rowStyle,
          opacity: busy ? 0.6 : 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: sp.md,
        }}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt style={{ fontWeight: '600' }}>{t('calendar.connectGoogle')}</Txt>
          <Txt variant="faint">{busy ? t('calendar.syncing') : t('calendar.googleHint')}</Txt>
        </View>
        {busy ? <ActivityIndicator color={c.accent} /> : null}
      </Pressable>
    )
  }

  return (
    <View style={rowStyle}>
      <Txt style={{ fontWeight: '600' }}>{t('calendar.google')}</Txt>
      <Txt variant="faint">
        {t('calendar.connectedAs', { email: conn.google_email ?? conn.user_email })}
      </Txt>
      <View style={{ flexDirection: 'row', gap: sp.xl, marginTop: sp.sm }}>
        <Pressable disabled={busy} onPress={sync}>
          <Txt style={{ color: c.accent, fontWeight: '600' }}>
            {busy ? t('calendar.syncing') : t('calendar.syncNow')}
          </Txt>
        </Pressable>
        <Pressable disabled={busy} onPress={disconnect}>
          <Txt style={{ color: c.expense, fontWeight: '600' }}>{t('calendar.disconnect')}</Txt>
        </Pressable>
      </View>
    </View>
  )
}
