// Headless entry for the Android widgets (imported from mobile/index.ts so it
// exists in the JS context Android starts for a widget with the app closed).
// Draws on add / periodic update / resize, and carries out the taps that do
// something: send a nudge (two taps — the first asks), tick a pet task, tick a
// list item. Each goes through api/widget.ts with the widget token.
'use no memo' // react-native-android-widget walks raw function components; the React Compiler's memo cache trips its "Invalid Hook Call" check and the widget draws nothing.

import { Platform } from 'react-native'
import { registerWidgetTaskHandler, type WidgetTaskHandlerProps } from 'react-native-android-widget'

import { awGet, awSet, localDay, widgetApi } from './store'
import { renderWidgetFor, type NudgePreset } from './widgets'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function draw(props: WidgetTaskHandlerProps) {
  const w = await renderWidgetFor(props.widgetInfo)
  if (w) props.renderWidget(w)
}

async function sendNudge(presetId: string): Promise<{ ok: boolean; label: string }> {
  const presets = (await awGet<NudgePreset[]>('nudge_presets')) ?? []
  const p = presets.find((x) => x.id === presetId)
  if (!p) return { ok: false, label: '' }
  const r = await widgetApi<{ ok: boolean }>('nudge', {
    kind: p.kind,
    emoji: p.emoji,
    message: p.label,
    recipients: null,
    high_priority: p.highPriority,
  })
  return { ok: !!r?.ok, label: `${p.emoji} ${p.label}` }
}

async function handler(props: WidgetTaskHandlerProps) {
  const { widgetAction, clickAction, clickActionData } = props
  if (widgetAction === 'WIDGET_DELETED') return
  if (widgetAction !== 'WIDGET_CLICK') return draw(props)

  const data = (clickActionData ?? {}) as Record<string, string>
  switch (clickAction) {
    case 'NUDGE_ASK':
      await awSet('nudge_status', { kind: 'confirm', presetId: data.presetId })
      await draw(props)
      // An unanswered question shouldn't sit on the Home screen.
      await wait(8000)
      if ((await awGet<{ kind: string; presetId?: string }>('nudge_status'))?.presetId === data.presetId) {
        await awSet('nudge_status', null)
        await draw(props)
      }
      return
    case 'NUDGE_CANCEL':
      await awSet('nudge_status', null)
      return draw(props)
    case 'NUDGE_SEND': {
      await awSet('nudge_status', null)
      const { ok, label } = await sendNudge(data.presetId)
      await awSet('nudge_status', { kind: ok ? 'sent' : 'failed', label, until: Date.now() + 4000 })
      await draw(props)
      await wait(4200)
      return draw(props)
    }
    case 'PET_DONE':
      await widgetApi('petcare-done', { day: localDay(), taskId: data.taskId })
      return draw(props)
    case 'LIST_CHECK':
      await widgetApi('list-check', { itemId: data.itemId })
      return draw(props)
    default:
      return draw(props)
  }
}

if (Platform.OS === 'android') registerWidgetTaskHandler(handler)
