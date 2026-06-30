// Per-user interface language (EN/ES/PT-BR). Initializes from the device locale,
// then adopts the signed-in user's saved choice from user_settings; changing it
// writes back so it follows the user across devices. RN port of the PWA hook
// (AsyncStorage instead of localStorage).
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { DICTS, detectLang, type Lang, type TKey } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

type Vars = Record<string, string | number>

interface I18nState {
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: TKey, vars?: Vars) => string
}

const I18nContext = createContext<I18nState | null>(null)
const CACHE = 'oneroof-lang'

/** Replace {name} placeholders; pick a "one|many" plural by a `count` var. */
function interpolate(str: string, vars?: Vars): string {
  if (!vars) return str
  let s = str
  if (typeof vars.count === 'number' && s.includes('|')) {
    const [one, many] = s.split('|')
    s = vars.count === 1 ? one : many
  }
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`))
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const email = profile?.email ?? null
  const [lang, setLangState] = useState<Lang>(() => detectLang())

  // Hydrate the cached choice on mount.
  useEffect(() => {
    let active = true
    AsyncStorage.getItem(CACHE).then((v) => {
      if (active && v) setLangState(v as Lang)
    })
    return () => {
      active = false
    }
  }, [])

  // Once signed in, adopt the user's saved language.
  useEffect(() => {
    if (!email) return
    let cancelled = false
    supabase
      .from('user_settings')
      .select('language')
      .eq('email', email)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data?.language) return
        AsyncStorage.setItem(CACHE, data.language)
        setLangState(data.language as Lang)
      })
    return () => {
      cancelled = true
    }
  }, [email])

  const setLang = useCallback(
    (l: Lang) => {
      setLangState(l)
      AsyncStorage.setItem(CACHE, l)
      if (email) {
        supabase
          .from('user_settings')
          .upsert({ email, language: l, updated_at: new Date().toISOString() })
          .then(() => {})
      }
    },
    [email],
  )

  const t = useCallback(
    (key: TKey, vars?: Vars) => interpolate(DICTS[lang][key] ?? DICTS.en[key] ?? key, vars),
    [lang],
  )

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nState {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}
