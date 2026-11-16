// Redraw Android widgets from the app (data changed) or from the headless
// handler. Safe no-op off Android and when no widget of that kind is placed.
'use no memo' // react-native-android-widget walks raw function components; the React Compiler's memo cache trips its "Invalid Hook Call" check and the widget draws nothing.

import { Platform } from 'react-native'
import { requestWidgetUpdate } from 'react-native-android-widget'

import { WIDGETS, renderWidgetFor, type WidgetName } from './widgets'

export async function updateAndroidWidget(name: WidgetName): Promise<void> {
  if (Platform.OS !== 'android') return
  try {
    await requestWidgetUpdate({
      widgetName: name,
      renderWidget: async (info) => (await renderWidgetFor(info)) ?? <></>,
    })
  } catch {
    /* module missing in this binary — ignore */
  }
}

export async function updateAllAndroidWidgets(): Promise<void> {
  await Promise.all(WIDGETS.map((w) => updateAndroidWidget(w)))
}
