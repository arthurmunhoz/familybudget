import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { DICTS, detectLang, type Lang, type TKey } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

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

/**
 * Per-user interface language. Initializes from localStorage / device language
 * (so the login screen is already translated), then adopts the signed-in
 * user's saved choice. Changing it writes to user_settings.language, which
 * follows the user across devices.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const email = profile?.email ?? null
  const [lang, setLangState] = useState<Lang>(
    () => (localStorage.getItem(CACHE) as Lang) || detectLang(),
  )

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

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
        localStorage.setItem(CACHE, data.language)
        setLangState(data.language as Lang)
      })
    return () => {
      cancelled = true
    }
  }, [email])

  const setLang = useCallback(
    (l: Lang) => {
      setLangState(l)
      localStorage.setItem(CACHE, l)
      if (email) {
        // Partial upsert: only touches `language`, leaving hidden_apps /
        // tile_style (managed by useAppPrefs) untouched on conflict.
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
