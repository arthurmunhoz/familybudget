import { useCallback, useEffect, useState } from 'react'
import { Linking } from 'react-native'
import { useLocalSearchParams } from 'expo-router'

/**
 * A value a deep link asked for (`oneroof:///<path>?<name>=…`), handed out once
 * per link — a Home-Screen widget opening one pet or one list. The route param
 * covers the first open; the Linking listener covers the SAME link tapped again
 * while this screen is still mounted (the param doesn't change then, so nothing
 * would re-render). Call `clear()` once the value has been applied.
 */
export function useLinkParam(name: string, path: string): [string | null, () => void] {
  const params = useLocalSearchParams<Record<string, string>>()
  const raw = params[name]
  const fromRoute = typeof raw === 'string' && raw ? raw : undefined
  const [seen, setSeen] = useState<string | undefined>(undefined)
  const [pending, setPending] = useState<string | null>(null)
  if (fromRoute !== seen) {
    setSeen(fromRoute)
    if (fromRoute) setPending(fromRoute)
  }

  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => {
      const m = /^[a-z][a-z0-9+.-]*:\/\/\/?([^?#]*)\?([^#]*)/i.exec(url)
      if (!m || m[1].replace(/\/$/, '') !== path) return
      for (const pair of m[2].split('&')) {
        const [k, v = ''] = pair.split('=')
        if (k === name && v) setPending(decodeURIComponent(v))
      }
    })
    return () => sub.remove()
  }, [name, path])

  const clear = useCallback(() => setPending(null), [])
  return [pending, clear]
}
