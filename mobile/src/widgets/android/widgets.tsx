/* eslint-disable react-refresh/only-export-components -- rendered in a headless widget context, never Fast-Refreshed */
// The six Android widgets. Each `render*` loads its data (live from
// api/widget.ts, the same endpoints the iOS widgets use) and returns the JSX.
// Taps that DO something (send a nudge, tick a pet task, tick a list item)
// come back to handler.ts as click actions.
'use no memo' // react-native-android-widget walks raw function components; the React Compiler's memo cache trips its "Invalid Hook Call" check and the widget draws nothing.

import { FlexWidget, ImageWidget, TextWidget } from 'react-native-android-widget'
import type { WidgetInfo } from 'react-native-android-widget'

import { Check, G, Kicker, Line, Message, Shell, accent, look, tile, type Look } from './kit'
import { awGet, hasToken, localDay, widgetApi, widgetDark, widgetLang, type Lang } from './store'
import { wt } from './strings'

export const WIDGETS = ['TodayWidget', 'NudgesWidget', 'BudgetWidget', 'PetCareWidget', 'NoteWidget', 'ListsWidget'] as const
export type WidgetName = (typeof WIDGETS)[number]

type Ctx = { L: Look; lang: Lang; info: WidgetInfo }
const rowsFor = (info: WidgetInfo, header: number, row: number) => Math.max(1, Math.floor((info.height - 28 - header) / row))
const locale = (lang: Lang) => (lang === 'pt' ? 'pt-BR' : lang === 'es' ? 'es-ES' : 'en-US')

function NotConnected({ g, L, lang, title }: { g: readonly [string, string]; L: Look; lang: Lang; title: string }) {
  return (
    <Shell g={g} L={L}>
      <Kicker text={title} color={accent(g, L)} />
      <Message text={wt(lang, 'connect')} L={L} />
    </Shell>
  )
}

// ── Today ────────────────────────────────────────────────────────────────────
type TodayItem = { emoji: string; title: string; subtitle: string | null }
type TodayCfg = { unit: 'fahrenheit' | 'celsius'; lat: number | null; lon: number | null }
const WEATHER: [number, string][] = [
  [0, '☀️'], [2, '⛅'], [3, '☁️'], [48, '🌫️'], [67, '🌧️'], [77, '🌨️'], [82, '🌦️'], [86, '🌨️'], [99, '⛈️'],
]
async function weather(): Promise<string | null> {
  const cfg = await awGet<TodayCfg>('today_cfg')
  if (!cfg || cfg.lat == null || cfg.lon == null) return null
  try {
    const r = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${cfg.lat}&longitude=${cfg.lon}&current=temperature_2m,weather_code,is_day&temperature_unit=${cfg.unit}`,
    )
    const j = (await r.json()) as { current?: { temperature_2m: number; weather_code: number; is_day: number } }
    if (!j.current) return null
    const code = j.current.weather_code
    let icon = (WEATHER.find(([max]) => code <= max) ?? WEATHER[WEATHER.length - 1])[1]
    if (code <= 1 && !j.current.is_day) icon = '🌙'
    return `${icon} ${Math.round(j.current.temperature_2m)}°`
  } catch {
    return null
  }
}

async function renderToday({ L, lang, info }: Ctx) {
  const g = G.calendar
  if (!(await hasToken())) return <NotConnected g={g} L={L} lang={lang} title={wt(lang, 'today')} />
  const [data, sky] = await Promise.all([
    widgetApi<{ items: TodayItem[] }>('today', { day: localDay(), locale: locale(lang) }),
    weather(),
  ])
  const date = new Date().toLocaleDateString(locale(lang), { weekday: 'short', day: 'numeric' })
  const items = data?.items ?? []
  const max = rowsFor(info, 30, 40)
  const shown = items.slice(0, items.length > max ? max - 1 : max)
  return (
    <Shell g={g} L={L} uri="oneroof:///calendar">
      <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', alignItems: 'center', marginBottom: 8 }}>
        <FlexWidget style={{ flex: 1 }}>
          <Kicker text={`${wt(lang, 'today')} · ${date}`} color={accent(g, L)} />
        </FlexWidget>
        {sky ? <Line text={sky} color={L.ink} size={14} bold /> : null}
      </FlexWidget>
      {!data ? (
        <Message text={wt(lang, 'offline')} L={L} />
      ) : !items.length ? (
        <Message text={wt(lang, 'nothingToday')} L={L} />
      ) : (
        <FlexWidget style={{ flexDirection: 'column', width: 'match_parent', flexGap: 6 }}>
          {shown.map((it, i) => (
            <FlexWidget
              key={i}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                width: 'match_parent',
                backgroundColor: tile(g, L),
                borderRadius: 12,
                paddingHorizontal: 10,
                paddingVertical: 6,
                flexGap: 8,
              }}
            >
              <TextWidget text={it.emoji} style={{ fontSize: 16 }} />
              <FlexWidget style={{ flex: 1, flexDirection: 'column' }}>
                <Line text={it.title} color={L.ink} size={14} bold />
                {it.subtitle ? <Line text={it.subtitle} color={L.soft} size={12} /> : null}
              </FlexWidget>
            </FlexWidget>
          ))}
          {items.length > shown.length ? <Line text={wt(lang, 'more', { n: items.length - shown.length })} color={L.soft} size={12} /> : null}
        </FlexWidget>
      )}
    </Shell>
  )
}

// ── Nudges ───────────────────────────────────────────────────────────────────
export type NudgePreset = { id: string; kind: string; emoji: string; label: string; highPriority: boolean }
export type NudgeStatus = { kind: 'confirm'; presetId: string } | { kind: 'sent' | 'failed'; label: string; until: number }

async function renderNudges({ L, lang, info }: Ctx) {
  const g = G.pings
  if (!(await hasToken())) return <NotConnected g={g} L={L} lang={lang} title={wt(lang, 'nudges')} />
  const presets = (await awGet<NudgePreset[]>('nudge_presets')) ?? []
  const status = await awGet<NudgeStatus>('nudge_status')
  const a = accent(g, L)

  if (status?.kind === 'confirm') {
    const p = presets.find((x) => x.id === status.presetId)
    if (p) {
      return (
        <Shell g={g} L={L} uri="oneroof:///pings">
          <Kicker text={wt(lang, 'nudges')} color={a} />
          <FlexWidget style={{ flex: 1, width: 'match_parent', justifyContent: 'center', flexDirection: 'column', flexGap: 4 }}>
            <Line text={`${p.emoji} ${p.label}`} color={L.ink} size={17} bold maxLines={2} />
            <Line text={wt(lang, 'sendTo')} color={L.soft} size={13} />
          </FlexWidget>
          <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', flexGap: 8 }}>
            <FlexWidget
              clickAction="NUDGE_CANCEL"
              style={{ flex: 1, height: 40, borderRadius: 20, backgroundColor: tile(g, L), justifyContent: 'center', alignItems: 'center' }}
            >
              <Line text={wt(lang, 'cancel')} color={L.ink} size={14} bold />
            </FlexWidget>
            <FlexWidget
              clickAction="NUDGE_SEND"
              clickActionData={{ presetId: p.id }}
              style={{
                flex: 1,
                height: 40,
                borderRadius: 20,
                backgroundColor: p.highPriority ? '#E4554A' : a,
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <Line text={wt(lang, 'send')} color="#FFFFFF" size={14} bold />
            </FlexWidget>
          </FlexWidget>
        </Shell>
      )
    }
  }
  const flash = status && status.kind !== 'confirm' && status.until > Date.now() ? status : null

  const cols = info.width >= 250 ? 2 : 1
  const rows = rowsFor(info, flash ? 52 : 26, 44)
  const shown = presets.slice(0, rows * cols)
  const grid: NudgePreset[][] = []
  for (let i = 0; i < shown.length; i += cols) grid.push(shown.slice(i, i + cols))
  return (
    <Shell g={g} L={L} uri="oneroof:///pings">
      <Kicker text={wt(lang, 'nudges')} color={a} />
      {flash ? (
        <FlexWidget style={{ width: 'match_parent', marginTop: 6, backgroundColor: tile(g, L), borderRadius: 12, padding: 8 }}>
          <Line text={`${flash.kind === 'sent' ? '✓ ' + wt(lang, 'sent') : '⚠️ ' + wt(lang, 'sendFailed')} · ${flash.label}`} color={L.ink} size={13} bold />
        </FlexWidget>
      ) : null}
      {!presets.length ? (
        <Message text={wt(lang, 'noPresets')} L={L} />
      ) : (
        <FlexWidget style={{ flexDirection: 'column', width: 'match_parent', marginTop: 8, flexGap: 6 }}>
          {grid.map((row, r) => (
            <FlexWidget key={r} style={{ flexDirection: 'row', width: 'match_parent', flexGap: 6 }}>
              {row.map((p) => (
                <FlexWidget
                  key={p.id}
                  clickAction="NUDGE_ASK"
                  clickActionData={{ presetId: p.id }}
                  style={{
                    flex: 1,
                    height: 38,
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 10,
                    borderRadius: 12,
                    flexGap: 6,
                    backgroundColor: p.highPriority ? (L.dark ? '#5A2321' : '#FBDDDA') : tile(g, L),
                  }}
                >
                  <TextWidget text={p.emoji} style={{ fontSize: 15 }} />
                  <FlexWidget style={{ flex: 1 }}>
                    <Line text={p.label} color={L.ink} size={13} bold />
                  </FlexWidget>
                </FlexWidget>
              ))}
            </FlexWidget>
          ))}
        </FlexWidget>
      )}
    </Shell>
  )
}

// ── Budget ───────────────────────────────────────────────────────────────────
type BudgetResp = {
  budget: {
    id: string
    monthId: string | null
    name: string
    currency: string
    balance: number
    income: number
    spent: number
    entries: { emoji: string; label: string; amount: number; type: string }[]
  } | null
}
const money = (n: number, cur: string, lang: Lang) =>
  `${n < 0 ? '−' : ''}${cur}${Math.abs(n).toLocaleString(locale(lang), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

async function renderBudget({ L, lang, info }: Ctx) {
  const g = G.budget
  if (!(await hasToken())) return <NotConnected g={g} L={L} lang={lang} title={wt(lang, 'money')} />
  const pick = await awGet<{ id: string }[]>('budgets')
  const data = await widgetApi<BudgetResp>('budget', { day: localDay(), budgetId: pick?.[0]?.id ?? null })
  const b = data?.budget
  if (!data) return (
    <Shell g={g} L={L} uri="oneroof:///budget">
      <Kicker text={wt(lang, 'money')} color={accent(g, L)} />
      <Message text={wt(lang, 'offline')} L={L} />
    </Shell>
  )
  if (!b) return (
    <Shell g={g} L={L} uri="oneroof:///budget">
      <Kicker text={wt(lang, 'money')} color={accent(g, L)} />
      <Message text={wt(lang, 'noBudget')} L={L} />
    </Shell>
  )
  const uri = b.monthId ? `oneroof:///budget/${b.id}/${b.monthId}` : 'oneroof:///budget'
  const rows = info.height >= 200 ? rowsFor(info, 96, 24) : 0
  return (
    <Shell g={g} L={L} uri={uri}>
      <Kicker text={b.name} color={accent(g, L)} />
      <TextWidget
        text={money(b.balance, b.currency, lang)}
        maxLines={1}
        style={{ fontSize: 26, fontWeight: '700', color: b.balance < 0 ? '#E4554A' : L.ink, marginTop: 6 }}
      />
      <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', marginTop: 4, flexGap: 10 }}>
        <Line text={`↑ ${money(b.income, b.currency, lang)}`} color={L.dark ? '#5FD3A2' : '#1F9E68'} size={12} bold />
        <Line text={`↓ ${money(b.spent, b.currency, lang)}`} color="#E4554A" size={12} bold />
      </FlexWidget>
      {rows > 0 ? (
        <FlexWidget style={{ flexDirection: 'column', width: 'match_parent', marginTop: 10, flexGap: 4 }}>
          {b.entries.slice(0, rows).map((e, i) => (
            <FlexWidget key={i} style={{ flexDirection: 'row', width: 'match_parent', alignItems: 'center', flexGap: 6 }}>
              <TextWidget text={e.emoji} style={{ fontSize: 13 }} />
              <FlexWidget style={{ flex: 1 }}>
                <Line text={e.label} color={L.ink} size={13} />
              </FlexWidget>
              <Line
                text={`${e.type === 'income' ? '+' : '−'}${b.currency}${e.amount.toFixed(2)}`}
                color={e.type === 'income' ? (L.dark ? '#5FD3A2' : '#1F9E68') : L.soft}
                size={13}
              />
            </FlexWidget>
          ))}
        </FlexWidget>
      ) : null}
    </Shell>
  )
}

// ── Pet care ─────────────────────────────────────────────────────────────────
type PetResp = {
  pets: { id: string; name: string; emoji: string; daily: { id: string; title: string; icon: string; done: boolean; doneBy: string | null }[] }[]
}
async function renderPets({ L, lang, info }: Ctx) {
  const g = G.pets
  if (!(await hasToken())) return <NotConnected g={g} L={L} lang={lang} title={wt(lang, 'pets')} />
  const data = await widgetApi<PetResp>('petcare', { day: localDay() })
  const a = accent(g, L)
  if (!data) return (
    <Shell g={g} L={L} uri="oneroof:///pets">
      <Kicker text={wt(lang, 'pets')} color={a} />
      <Message text={wt(lang, 'offline')} L={L} />
    </Shell>
  )
  if (!data.pets.length) return (
    <Shell g={g} L={L} uri="oneroof:///pets">
      <Kicker text={wt(lang, 'pets')} color={a} />
      <Message text={wt(lang, 'noPets')} L={L} />
    </Shell>
  )
  const several = data.pets.length > 1
  const tasks = data.pets.flatMap((p) => p.daily.map((d) => ({ ...d, pet: p })))
  const done = tasks.filter((x) => x.done).length
  // Undone first (the day's order), then what's done.
  const ordered = [...tasks.filter((x) => !x.done), ...tasks.filter((x) => x.done)]
  const max = rowsFor(info, 30, 34)
  return (
    <Shell g={g} L={L} uri="oneroof:///pets">
      <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', alignItems: 'center', marginBottom: 6 }}>
        <FlexWidget style={{ flex: 1 }}>
          <Kicker text={several ? wt(lang, 'pets') : `${data.pets[0].emoji} ${data.pets[0].name}`} color={a} />
        </FlexWidget>
        {tasks.length ? <Line text={wt(lang, 'ofDone', { a: done, b: tasks.length })} color={L.soft} size={12} bold /> : null}
      </FlexWidget>
      {tasks.length && done === tasks.length ? (
        <Message text={`🎉 ${wt(lang, 'allDone')}`} L={L} />
      ) : (
        <FlexWidget style={{ flexDirection: 'column', width: 'match_parent', flexGap: 4 }}>
          {ordered.slice(0, max).map((x) => (
            <FlexWidget
              key={x.id}
              clickAction={x.done ? 'OPEN_URI' : 'PET_DONE'}
              clickActionData={x.done ? { uri: 'oneroof:///pets' } : { taskId: x.id }}
              style={{ flexDirection: 'row', width: 'match_parent', alignItems: 'center', paddingVertical: 4, flexGap: 8 }}
            >
              <Check done={x.done} g={g} L={L} />
              <FlexWidget style={{ flex: 1 }}>
                <Line text={`${several ? x.pet.emoji + ' ' : ''}${x.icon ? x.icon + ' ' : ''}${x.title}`} color={x.done ? L.soft : L.ink} size={14} bold={!x.done} />
              </FlexWidget>
              {x.done && x.doneBy ? <Line text={x.doneBy} color={L.soft} size={11} /> : null}
            </FlexWidget>
          ))}
        </FlexWidget>
      )}
    </Shell>
  )
}

// ── Note ─────────────────────────────────────────────────────────────────────
type NoteResp = { note: { id: string; from: string; createdAt: string; imageUrl: string | null } | null }
async function renderNote({ L, lang, info }: Ctx) {
  const g = G.kraft
  const ink = '#2B2521' as const
  const inkSoft = '#6B5E52' as const
  if (!(await hasToken())) return (
    <Shell g={g} L={L} solid>
      <Kicker text={wt(lang, 'note')} color={inkSoft} />
      <Line text={wt(lang, 'connect')} color={inkSoft} size={14} maxLines={3} />
    </Shell>
  )
  const data = await widgetApi<NoteResp>('note')
  const n = data?.note
  if (!n || !n.imageUrl) return (
    <Shell g={g} L={L} solid uri="oneroof:///notes">
      <Kicker text={wt(lang, 'note')} color={inkSoft} />
      <FlexWidget style={{ flex: 1, justifyContent: 'center' }}>
        <Line text={data ? wt(lang, 'noNote') : wt(lang, 'offline')} color={inkSoft} size={14} maxLines={2} />
      </FlexWidget>
    </Shell>
  )
  const w = Math.max(60, info.width - 24)
  const h = Math.max(60, info.height - 52)
  return (
    <Shell g={g} L={L} solid padding={12} uri={`oneroof:///?note=${n.id}`}>
      <FlexWidget style={{ flex: 1, width: 'match_parent', backgroundColor: '#FFFBF2', borderRadius: 12, overflow: 'hidden' }}>
        <ImageWidget image={n.imageUrl as `https:${string}`} imageWidth={w} imageHeight={h} resizeMode="contain" radius={12} />
      </FlexWidget>
      <TextWidget text={wt(lang, 'from', { name: n.from })} maxLines={1} style={{ fontSize: 13, fontWeight: '700', color: ink, marginTop: 6 }} />
    </Shell>
  )
}

// ── Lists ────────────────────────────────────────────────────────────────────
type ListsResp = { total: number; lists: { id: string; name: string | null; count: number; items: { id: string; label: string }[] }[] }
async function renderLists({ L, lang, info }: Ctx) {
  const g = G.shopping
  if (!(await hasToken())) return <NotConnected g={g} L={L} lang={lang} title={wt(lang, 'lists')} />
  const data = await widgetApi<ListsResp>('lists')
  const a = accent(g, L)
  if (!data) return (
    <Shell g={g} L={L} uri="oneroof:///shopping">
      <Kicker text={wt(lang, 'lists')} color={a} />
      <Message text={wt(lang, 'offline')} L={L} />
    </Shell>
  )
  const first = data.lists[0]
  const max = rowsFor(info, 30, 32)
  return (
    <Shell g={g} L={L} uri="oneroof:///shopping">
      <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', alignItems: 'center', marginBottom: 6 }}>
        <FlexWidget style={{ flex: 1 }}>
          <Kicker text={first ? first.name ?? wt(lang, 'general') : wt(lang, 'lists')} color={a} />
        </FlexWidget>
        <Line text={wt(lang, 'items', { n: data.total })} color={L.soft} size={12} bold />
      </FlexWidget>
      {!first ? (
        <Message text={`✓ ${wt(lang, 'emptyList')}`} L={L} />
      ) : (
        <FlexWidget style={{ flexDirection: 'column', width: 'match_parent', flexGap: 2 }}>
          {first.items.slice(0, max).map((it) => (
            <FlexWidget
              key={it.id}
              clickAction="LIST_CHECK"
              clickActionData={{ itemId: it.id }}
              style={{ flexDirection: 'row', width: 'match_parent', alignItems: 'center', paddingVertical: 4, flexGap: 8 }}
            >
              <Check done={false} g={g} L={L} />
              <FlexWidget style={{ flex: 1 }}>
                <Line text={it.label} color={L.ink} size={14} />
              </FlexWidget>
            </FlexWidget>
          ))}
          {first.count > Math.min(max, first.items.length) ? (
            <Line text={wt(lang, 'more', { n: first.count - Math.min(max, first.items.length) })} color={L.soft} size={12} />
          ) : null}
        </FlexWidget>
      )}
    </Shell>
  )
}

const RENDER: Record<WidgetName, (c: Ctx) => Promise<React.JSX.Element>> = {
  TodayWidget: renderToday,
  NudgesWidget: renderNudges,
  BudgetWidget: renderBudget,
  PetCareWidget: renderPets,
  NoteWidget: renderNote,
  ListsWidget: renderLists,
}

export async function renderWidgetFor(info: WidgetInfo): Promise<React.JSX.Element | null> {
  const fn = RENDER[info.widgetName as WidgetName]
  if (!fn) return null
  const [dark, lang] = await Promise.all([widgetDark(), widgetLang()])
  return fn({ L: look(dark), lang, info })
}
