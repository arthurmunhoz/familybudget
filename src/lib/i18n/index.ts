import { en } from './en'
import { es } from './es'
import { pt } from './pt'

export type Lang = 'en' | 'es' | 'pt'
export type TKey = keyof typeof en

export const DICTS: Record<Lang, Record<TKey, string>> = { en, es, pt }

/** Order shown in the language picker. Flags are language conventions, not
 *  nationality claims. */
export const LANGUAGES: { id: Lang; flag: string; label: string }[] = [
  { id: 'en', flag: '🇺🇸', label: 'English' },
  { id: 'es', flag: '🇲🇽', label: 'Español' },
  { id: 'pt', flag: '🇧🇷', label: 'Português' },
]

/** Best-guess language from the device, used before the user has a saved
 *  preference (e.g. the login screen). */
export function detectLang(): Lang {
  const n = (navigator.language || 'en').toLowerCase()
  if (n.startsWith('pt')) return 'pt'
  if (n.startsWith('es')) return 'es'
  return 'en'
}
