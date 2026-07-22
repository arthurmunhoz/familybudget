// Home-screen widget bridge. Writes app data into the shared App Group so the
// native WidgetKit extension (mobile/targets/widgets) can render it, then asks
// iOS to reload the widget. Safe no-op off iOS and where the native module
// isn't present (Expo Go, or a build without the widget target).
import { Platform } from 'react-native'
import { ExtensionStorage } from '@bacons/apple-targets'

export const APP_GROUP = 'group.com.oneroof.app'
// Must match the `kind:` string in NudgesWidget.swift's StaticConfiguration.
const NUDGES_WIDGET_KIND = 'NudgesWidget'
// Must match the `kind:` string in TodayWidget.swift's StaticConfiguration.
const TODAY_WIDGET_KIND = 'TodayWidget'
// Must match the `kind:` string in PetCareWidget.swift.
const PETCARE_WIDGET_KIND = 'PetCareWidget'

export interface BudgetWidgetItem {
  id: string
  /** Current period's month id — lets the widget deep-link to add/scan an
   *  entry (oneroof:///budget/<id>/<monthId>?add=1). null = no period yet. */
  monthId: string | null
  name: string
  period: string
  balance: number
  income: number
  spent: number
  currency: string
}

let storage: ExtensionStorage | null = null
function store(): ExtensionStorage | null {
  if (Platform.OS !== 'ios') return null
  try {
    if (!storage) storage = new ExtensionStorage(APP_GROUP)
    return storage
  } catch {
    return null
  }
}

/** Write the budget snapshot for the home-screen widget + reload it. The widget
 *  is budget-selectable; it picks by id from this list (default = first). */
export function syncBudgetWidget(budgets: BudgetWidgetItem[]): void {
  const s = store()
  if (!s) return
  try {
    s.set('budgets', JSON.stringify(budgets))
    ExtensionStorage.reloadWidget()
  } catch {
    /* native module unavailable — ignore */
  }
}

export interface TodayWidgetItem {
  emoji: string
  title: string
  subtitle: string | null
}

export interface TodayWidgetData {
  /** Localized "Today" caption. */
  todayLabel: string
  /** The day this snapshot describes (ISO YYYY-MM-DD). The widget refuses to
   *  show these items on a later day rather than passing yesterday's agenda
   *  off as today's. */
  day: string
  /** "Wed, Jul 9" (medium/large). Fallback only — the widget re-derives the
   *  date itself at render so it stays correct without the app running. */
  dateLong: string
  /** "Wed 9" (small). Fallback only — see dateLong. */
  dateShort: string
  temp: number | null
  /** Unit incl. degree, e.g. "°F". */
  unit: string | null
  /** WMO weather code → SF Symbol in the widget. */
  code: number | null
  city: string | null
  /** Localized weather-alert line (rain/storm/extreme temp/wind), or null. */
  alert: string | null
  /** Alert kind → the widget maps it to an SF Symbol. */
  alertKind: string | null
  items: TodayWidgetItem[]
  /** Localized "Nothing today" line. */
  emptyLabel: string
}

/** Feed the Today widget: date, current weather, and today's agenda items
 *  (calendar + pet-care due), mirroring the Hub's info card. */
export function syncTodayWidget(data: TodayWidgetData): void {
  const s = store()
  if (!s) return
  try {
    s.set('today', JSON.stringify(data))
    ExtensionStorage.reloadWidget()
  } catch {
    /* native module unavailable — ignore */
  }
}

export interface TodayWidgetConfig {
  /** BCP-47 locale the widget formats its own date with (e.g. "en-US"). */
  locale: string
  /** Open-Meteo temperature unit to request. */
  unit: 'fahrenheit' | 'celsius'
  /** Home city coords — null when no home city is set in Settings. */
  lat: number | null
  lon: number | null
  city: string | null
  /** Localized alert line per WeatherAlertKind. The widget derives the KIND
   *  itself from the forecast it fetches, then looks its text up here — that
   *  keeps the copy translated without the widget knowing about i18n. */
  alerts: Record<string, string>
}

/** Everything the Today widget needs to refresh ITSELF while the app is closed:
 *  where to fetch weather for, which locale to format in, and the translated
 *  alert strings. It means a widget that hasn't been fed in days still renders a
 *  correct, live card. See TodayWidget.swift's buildToday().
 *
 *  Only writes when something actually CHANGED (home city, language, unit) —
 *  the Hub re-runs this on every focus, and each reload now costs a real network
 *  fetch out of the widget's limited refresh budget. */
let lastTodayCfg = ''
export function syncTodayConfig(cfg: TodayWidgetConfig): void {
  const s = store()
  if (!s) return
  const json = JSON.stringify(cfg)
  if (json === lastTodayCfg) return
  lastTodayCfg = json
  try {
    s.set('today_cfg', json)
    ExtensionStorage.reloadWidget(TODAY_WIDGET_KIND)
  } catch {
    /* native module unavailable — ignore */
  }
}

/** Mirror the app's manually-chosen Light/Dark (Settings → Appearance) into
 *  the App Group so the Nudges widget matches it instead of following the
 *  device's system appearance. */
export function syncWidgetTheme(mode: 'light' | 'dark'): void {
  const s = store()
  if (!s) return
  try {
    s.set('widget_theme', mode)
    ExtensionStorage.reloadWidget(NUDGES_WIDGET_KIND)
  } catch {
    /* native module unavailable — ignore */
  }
}

export interface NudgeMember {
  email: string
  name: string
}
export interface NudgePreset {
  id: string
  kind: string
  emoji: string
  label: string
  highPriority: boolean
}

/** Feed the Nudges widget: the send token, the members it can target (the
 *  person selector), and the presets it can send. The widget owns the selected
 *  recipients (stored in the App Group as it's toggled). */
export function syncNudgeWidget(data: {
  token: string | null
  members: NudgeMember[]
  presets: NudgePreset[]
}): void {
  const s = store()
  if (!s) return
  try {
    if (data.token) s.set('widget_token', data.token)
    s.set('nudge_members', JSON.stringify(data.members))
    s.set('nudge_presets', JSON.stringify(data.presets))
    ExtensionStorage.reloadWidget(NUDGES_WIDGET_KIND)
  } catch {
    /* native module unavailable — ignore */
  }
}

// ── Pet Care widget ──────────────────────────────────────────────────────────
// Snapshot shape shared with the live api/widget?action=petcare response, so
// the Swift widget decodes ONE struct from either source (like BudgetInfo).

export interface PetCareWidgetTask {
  id: string
  title: string
  icon: string
  done: boolean
  doneBy: string | null
}
export interface PetCareWidgetRoutine {
  id: string
  title: string
  icon: string
  /** Days until due; 0 = today, negative = overdue. */
  dueIn: number
}
export interface PetCareWidgetPet {
  id: string
  name: string
  emoji: string
  daily: PetCareWidgetTask[]
  routines: PetCareWidgetRoutine[]
}

/** Offline fallback + the pet picker's entity list. `day` lets the widget
 *  refuse to show a stale checklist on a later day (same rule as Today). */
export function syncPetCareWidget(day: string, pets: PetCareWidgetPet[]): void {
  const s = store()
  if (!s) return
  try {
    s.set('petcare', JSON.stringify({ day, pets }))
    ExtensionStorage.reloadWidget(PETCARE_WIDGET_KIND)
  } catch {
    /* native module unavailable — ignore */
  }
}

/** Reload only — used by the silent-push handler when ANOTHER member marks a
 *  task done, so this device's widget re-fetches the fresh state. */
export function reloadPetCareWidget(): void {
  if (Platform.OS !== 'ios') return
  try {
    ExtensionStorage.reloadWidget(PETCARE_WIDGET_KIND)
  } catch {
    /* native module unavailable — ignore */
  }
}

/** Everything the app mirrors into the App Group that belongs to the SIGNED-IN
 *  HOUSEHOLD rather than to the device. Cleared on sign-out — otherwise the
 *  widgets keep rendering one family's agenda, budgets and members to whoever
 *  holds the phone next, and `widget_token` keeps authorizing nudges as the
 *  signed-out user.
 *
 *  `widget_theme` is deliberately NOT in this list: it's a per-device
 *  appearance preference, not household data, and wiping it would silently
 *  reset the user's Light/Dark choice. */
const HOUSEHOLD_WIDGET_KEYS = [
  'widget_token',
  'nudge_members',
  'nudge_presets',
  'widget_recipients',
  'widget_status',
  'pending_nudge',
  'budgets',
  'today',
  'today_live',
  'today_cfg',
  'petcare',
  'petcare_status',
] as const

/** Wipe the household's mirrored data + the widget send token from the App
 *  Group, then reload every widget so they redraw empty instead of showing a
 *  stale card. Safe no-op off iOS / without the native module.
 *
 *  Note: cached pet photos are written under per-pet keys
 *  (`petcare_photo_<id>`) which can't be enumerated from here; they are
 *  overwritten on the next sign-in. */
export function clearWidgetData(): void {
  const s = store()
  if (!s) return
  try {
    for (const key of HOUSEHOLD_WIDGET_KEYS) s.remove(key)
    // Let the next sign-in re-publish the Today config (we just removed it).
    lastTodayCfg = ''
    ExtensionStorage.reloadWidget()
  } catch {
    /* native module unavailable — ignore */
  }
}

/** Flash a transient "{emoji} {label} · seen by {name}" on the Nudges widget
 *  for 3s, then it reverts to the list on its own (see NudgesWidget.swift's
 *  timeline — `until` is read there, nothing needs to fire again at expiry).
 *  Called from the background-push handler when someone acks a nudge this
 *  device sent (mobile/src/lib/backgroundNotifications.ts). */
export function writeAckStatus(data: { emoji: string; label: string; ackerName: string }): void {
  const s = store()
  if (!s) return
  try {
    s.set(
      'widget_status',
      JSON.stringify({
        type: 'ack',
        emoji: data.emoji,
        label: data.label,
        name: data.ackerName,
        until: Date.now() + 3000,
      }),
    )
    ExtensionStorage.reloadWidget(NUDGES_WIDGET_KIND)
  } catch {
    /* native module unavailable — ignore */
  }
}
