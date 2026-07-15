// Home-screen widget bridge. Writes app data into the shared App Group so the
// native WidgetKit extension (mobile/targets/widgets) can render it, then asks
// iOS to reload the widget. Safe no-op off iOS and where the native module
// isn't present (Expo Go, or a build without the widget target).
import { Platform } from 'react-native'
import { ExtensionStorage } from '@bacons/apple-targets'

const APP_GROUP = 'group.com.oneroof.app'
// Must match the `kind:` string in NudgesWidget.swift's StaticConfiguration.
const NUDGES_WIDGET_KIND = 'NudgesWidget'

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
  /** "Wed, Jul 9" (medium/large). */
  dateLong: string
  /** "Wed 9" (small). */
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
