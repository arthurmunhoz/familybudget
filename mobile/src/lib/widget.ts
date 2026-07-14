// Home-screen widget bridge. Writes app data into the shared App Group so the
// native WidgetKit extension (mobile/targets/widgets) can render it, then asks
// iOS to reload the widget. Safe no-op off iOS and where the native module
// isn't present (Expo Go, or a build without the widget target).
import { Platform } from 'react-native'
import { ExtensionStorage } from '@bacons/apple-targets'

const APP_GROUP = 'group.com.oneroof.app'

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

export interface NudgeMember {
  email: string
  name: string
}
export interface NudgePreset {
  kind: string
  emoji: string
  label: string
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
    ExtensionStorage.reloadWidget()
  } catch {
    /* native module unavailable — ignore */
  }
}
