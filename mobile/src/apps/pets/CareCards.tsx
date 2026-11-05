// Pet Care's cards under the photo (2026-11 restyle in the Home's language):
//   • Today — a progress ring ("2 of 3 done") over the daily checklist, each
//     task with an icon tile in the pet's colour and a big round tick; the day
//     switcher is a small pill beside the section label.
//   • Care — ONE grid of everything that repeats: interval routines AND events
//     with a next-due date (check-up, vaccine, monthly pill), each a tile with
//     a ring for how much of its cycle has gone by (green → amber → red) and
//     Done on the tile. Replaced "Care routines" + "Coming up", which showed
//     the same flea treatment twice from two tables (owner, 2026-11).
//   • Events — one row per recurring thing (last time, how many times, next
//     due); tap → that event's history in a sheet (edit, swipe to delete, log
//     it again). Replaced an always-open raw log (owner, 2026-11).
// Section labels sit OUTSIDE the cards, tracked and uppercase, like the Home.
// All data and actions come from PetCare; these only draw.
import { type ReactNode, useRef } from 'react'
import { Modal, ScrollView, StyleSheet, View } from 'react-native'
import { Pressable } from '@/components/Pressable'
import { GestureHandlerRootView, Swipeable } from 'react-native-gesture-handler'
import Svg, { Circle } from 'react-native-svg'
import { Check, ChevronLeft, ChevronRight, PawPrint, Pencil, Trash2, X, type LucideIcon } from 'lucide-react-native'

import { Btn, Txt } from '@/components/ui'
import { useBottomGap } from '@/hooks/useBottomGap'
import type { EventSeries } from '@/lib/petCare'
import { useI18n } from '@/hooks/useI18n'
import { formatDay } from '@/lib/format'
import type { PetCareTask, PetEvent, PetTaskDone } from '@/lib/types'
import { fonts, radius, sp, useTheme } from '@/theme/theme'
import { CARE_ICONS, TYPE_ICON } from './petUi'
import { TYPE_COLOR } from './petColors'
import { GradientBox } from '@/components/home/GradientBox'
import { shade } from '@/components/home/palette'
import { everyLabel } from './careText'


// ── shared bits ──────────────────────────────────────────────────────────────

/** A Home-style section label, with optional controls on the right. */
export function SectionHead({ title, children }: { title: string; children?: ReactNode }) {
  const { c } = useTheme()
  return (
    <View style={s.head}>
      <Txt style={[s.headText, { color: c.textMuted }]}>{title}</Txt>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>{children}</View>
    </View>
  )
}

/** Small round button for a section's edit action. */
export function RoundEdit({ label, onPress }: { label: string; onPress: () => void }) {
  const { c } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        s.roundEdit,
        {
          backgroundColor: c.card,
          borderColor: c.border,
          opacity: pressed ? 0.6 : 1,
        },
      ]}
    >
      <Pencil size={14} color={c.text} />
    </Pressable>
  )
}

/** A ring: `progress` 0…1 drawn in `color` over a faint track. */
function Ring({
  size,
  stroke,
  progress,
  color,
  track,
  children,
}: {
  size: number
  stroke: number
  progress: number
  color: string
  track: string
  children?: ReactNode
}) {
  const r = (size - stroke) / 2
  const len = 2 * Math.PI * r
  const p = Math.max(0, Math.min(1, progress))
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        {/* nothing drawn at 0 — a round cap alone would show as a dot */}
        {p > 0 ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${len * p} ${len}`}
            rotation={-90}
            origin={`${size / 2}, ${size / 2}`}
          />
        ) : null}
      </Svg>
      {children}
    </View>
  )
}

// ── Today ────────────────────────────────────────────────────────────────────

export interface DailyRow {
  task: PetCareTask
  done: PetTaskDone | null
  isDone: boolean
  /** "Sam · 8:12" when done. */
  who: string | null
}

export function TodayCard({
  rows,
  tint,
  dayLabel,
  isToday,
  canGoForward,
  onPrev,
  onNext,
  onToday,
  onToggle,
  onEdit,
  emptyText,
  title,
}: {
  rows: DailyRow[]
  tint: string
  dayLabel: string
  isToday: boolean
  canGoForward: boolean
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  onToggle: (row: DailyRow) => void
  onEdit: () => void
  emptyText: string
  title: string
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const done = rows.filter((r) => r.isDone).length
  const all = rows.length > 0 && done === rows.length
  return (
    <View>
      <SectionHead title={title}>
        {/* the day switcher, as a quiet pill */}
        <View style={[s.dayPill, { backgroundColor: c.card, borderColor: c.border }]}>
          <Pressable onPress={onPrev} hitSlop={8} accessibilityLabel={t('petcare.prevDay')} style={s.dayArrow}>
            <ChevronLeft size={16} color={c.textMuted} />
          </Pressable>
          <Pressable onPress={onToday} hitSlop={4}>
            <Txt
              style={{
                fontSize: 13,
                fontFamily: fonts.semibold,
                color: isToday ? c.text : c.accent,
              }}
            >
              {dayLabel}
            </Txt>
          </Pressable>
          <Pressable
            onPress={onNext}
            disabled={!canGoForward}
            hitSlop={8}
            accessibilityLabel={t('petcare.nextDay')}
            style={[s.dayArrow, { opacity: canGoForward ? 1 : 0.25 }]}
          >
            <ChevronRight size={16} color={c.textMuted} />
          </Pressable>
        </View>
        <RoundEdit label={t('petcare.editRoutine')} onPress={onEdit} />
      </SectionHead>

      <View style={[s.card, { backgroundColor: c.card, borderColor: c.border }]}>
        {rows.length === 0 ? (
          <Pressable onPress={onEdit} style={{ padding: sp.lg }}>
            <Txt variant="muted">{emptyText}</Txt>
          </Pressable>
        ) : (
          <>
            {/* progress: a strip in the pet's own colour — ring + "2 of 3 done" */}
            <GradientBox colors={[tint, shade(tint, -0.22)]} radius={0} style={s.progressRow}>
              <Ring size={54} stroke={6} progress={done / rows.length} color="#fff" track="rgba(255,255,255,0.3)">
                {all ? (
                  <Check size={22} color="#fff" strokeWidth={3} />
                ) : (
                  <Txt style={{ fontFamily: fonts.display, fontSize: 16, color: '#fff', fontVariant: ['tabular-nums'] }}>
                    {done}/{rows.length}
                  </Txt>
                )}
              </Ring>
              <View style={{ flex: 1 }}>
                <Txt style={{ fontFamily: fonts.display, fontSize: 19, color: '#fff' }}>
                  {all ? t('petcare.allDoneToday') : t('petcare.doneOf', { done, total: rows.length })}
                </Txt>
              </View>
            </GradientBox>
            {rows.map((row) => {
              const Icon = CARE_ICONS[row.task.icon] ?? PawPrint
              return (
                <Pressable
                  key={row.task.id}
                  onPress={() => onToggle(row)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: row.isDone }}
                  style={({ pressed }) => [s.taskRow, { borderTopColor: c.border, opacity: pressed ? 0.7 : 1 }]}
                >
                  <View
                    style={[
                      s.iconTile,
                      {
                        backgroundColor: (row.isDone ? c.textFaint : tint) + '22',
                      },
                    ]}
                  >
                    <Icon size={18} color={row.isDone ? c.textFaint : tint} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt
                      style={{
                        fontFamily: fonts.medium,
                        fontSize: 16,
                        color: row.isDone ? c.textMuted : c.text,
                        textDecorationLine: row.isDone ? 'line-through' : 'none',
                      }}
                      numberOfLines={1}
                    >
                      {row.task.title}
                    </Txt>
                    {row.who ? (
                      <Txt variant="faint" style={{ fontSize: 12 }}>
                        {row.who}
                      </Txt>
                    ) : null}
                  </View>
                  <View
                    style={[
                      s.check,
                      row.isDone ? { backgroundColor: c.income, borderWidth: 0 } : { borderColor: c.textFaint },
                    ]}
                  >
                    {row.isDone ? <Check size={16} color="#fff" strokeWidth={3} /> : null}
                  </View>
                </Pressable>
              )
            })}
          </>
        )}
      </View>
    </View>
  )
}

// ── Care routines ────────────────────────────────────────────────────────────

/** One recurring thing in the Care grid. Two sources, one look (owner,
 *  2026-11): an interval ROUTINE (pet_care_tasks — Done records today), or an
 *  EVENT that carries a next-due date (pet_events — a vet check-up, a vaccine,
 *  a monthly pill; Done opens the event form prefilled, since those carry a
 *  date, notes and the next due). The data stays in its two tables; only the
 *  screen is one list. */
export type CareItem =
  | {
      kind: 'routine'
      key: string
      title: string
      Icon: LucideIcon
      /** The tile's colour: the pet's own for routines, the type's for events. */
      color: string
      interval: number
      dueIn: number
      task: PetCareTask
    }
  | {
      kind: 'event'
      key: string
      title: string
      Icon: LucideIcon
      color: string
      /** Days between the last time and the next due; null when unknown. */
      interval: number | null
      dueIn: number
      next: string
      event: PetEvent
      seriesKey: string
    }

export function CareGrid({
  items,
  marked,
  dueText,
  onDoneRoutine,
  onDoneEvent,
  onOpenEvent,
  onEdit,
  emptyText,
  title,
}: {
  items: CareItem[]
  marked: Record<string, boolean>
  dueText: (dueIn: number) => { text: string; color: string }
  onDoneRoutine: (task: PetCareTask) => void
  onDoneEvent: (e: PetEvent) => void
  onOpenEvent: (seriesKey: string) => void
  onEdit: () => void
  emptyText: string
  title: string
}) {
  const { c, dark } = useTheme()
  const { t } = useI18n()
  return (
    <View>
      <SectionHead title={title}>
        <RoundEdit label={t('petcare.editRoutine')} onPress={onEdit} />
      </SectionHead>
      {items.length === 0 ? (
        <Pressable onPress={onEdit} style={[s.card, { backgroundColor: c.card, borderColor: c.border, padding: sp.lg }]}>
          <Txt variant="muted">{emptyText}</Txt>
        </Pressable>
      ) : (
        <View style={s.grid}>
          {items.map((it) => {
            const Icon = it.Icon
            const interval = it.interval
            const elapsed = interval ? (interval - it.dueIn) / interval : 0.5
            const due = it.dueIn <= 0
            const { text, color } = dueText(it.dueIn)
            // The ring keeps the urgency colours; the tile wears the item's own.
            const ring = due ? c.expense : it.dueIn <= Math.max(2, (interval ?? 30) * 0.2) ? '#F2A93B' : it.color
            const isMarked = it.kind === 'routine' && marked[it.task.id]
            const sub =
              interval != null
                ? everyLabel(interval, t)
                : it.kind === 'event'
                  ? t('pets.nextOn', { date: formatDay(it.next) })
                  : ''
            return (
              <Pressable
                key={it.key}
                // An event's tile opens its history; a routine's has nothing more to show.
                onPress={it.kind === 'event' ? () => onOpenEvent(it.seriesKey) : undefined}
                disabled={it.kind !== 'event'}
                style={[
                  s.tile,
                  { backgroundColor: it.color + (dark ? '26' : '14'), borderColor: due ? c.expense + '88' : it.color + '33' },
                ]}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <Ring size={50} stroke={5} progress={isMarked ? 0 : elapsed} color={ring} track={it.color + '2E'}>
                    <View style={[s.ringFill, { backgroundColor: c.card }]}>
                      <Icon size={19} color={due ? c.expense : it.color} />
                    </View>
                  </Ring>
                  <Txt style={{ fontSize: 12.5, fontFamily: fonts.semibold, color: isMarked ? c.income : color }}>
                    {isMarked ? '' : text}
                  </Txt>
                </View>
                <View>
                  <Txt style={{ fontFamily: fonts.display, fontSize: 16, lineHeight: 20 }} numberOfLines={2}>
                    {it.title}
                  </Txt>
                  {sub ? (
                    <Txt variant="faint" style={{ fontSize: 12 }}>
                      {sub}
                    </Txt>
                  ) : null}
                </View>
                <Pressable
                  onPress={() => {
                    if (it.kind === 'routine') {
                      if (!isMarked) onDoneRoutine(it.task)
                    } else onDoneEvent(it.event)
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${t('common.done')} ${it.title}`}
                  style={[s.tileBtn, { backgroundColor: isMarked ? c.income : due ? c.action : it.color + '2E' }]}
                >
                  {isMarked ? <Check size={14} color="#fff" strokeWidth={3} /> : null}
                  <Txt
                    style={{
                      fontSize: 13,
                      fontFamily: fonts.semibold,
                      color: isMarked ? '#fff' : due ? c.onAction : it.color,
                    }}
                  >
                    {t('petcare.doneShort')}
                  </Txt>
                </Pressable>
              </Pressable>
            )
          })}
        </View>
      )}
    </View>
  )
}

// ── History ──────────────────────────────────────────────────────────────────

function HistoryRow({
  e,
  first,
  onOpen,
  onDelete,
}: {
  e: PetEvent
  first: boolean
  onOpen: () => void
  onDelete: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const ref = useRef<Swipeable>(null)
  return (
    <Swipeable
      ref={ref}
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={() => (
        <Pressable
          onPress={() => {
            ref.current?.close()
            onDelete()
          }}
          accessibilityLabel={t('common.delete')}
          style={[s.swipeDelete, { backgroundColor: c.expense }]}
        >
          <Trash2 size={19} color="#fff" />
        </Pressable>
      )}
    >
      <Pressable
        onPress={onOpen}
        accessibilityActions={[{ name: 'delete', label: t('common.delete') }]}
        onAccessibilityAction={(ev) => ev.nativeEvent.actionName === 'delete' && onDelete()}
        style={[
          s.listRow,
          { backgroundColor: c.card },
          !first
            ? {
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: c.border,
              }
            : null,
        ]}
      >
        {/* Inside one event's history the name is in the header already —
            each row is WHEN it was done (+ its notes, or the next date it set). */}
        <View style={[s.iconTile, { backgroundColor: c.income + '1F' }]}>
          <Check size={16} color={c.income} strokeWidth={2.8} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt style={{ fontFamily: fonts.medium, fontSize: 15.5 }} numberOfLines={1}>
            {formatDay(e.event_date)}
          </Txt>
          {e.notes || e.next_due ? (
            <Txt variant="faint" style={{ fontSize: 12.5 }} numberOfLines={2}>
              {e.notes || t('pets.nextOn', { date: formatDay(e.next_due!) })}
            </Txt>
          ) : null}
        </View>
      </Pressable>
    </Swipeable>
  )
}

/** The pet's events, one row per recurring thing ("Heartworm pill"): when it
 *  was last logged, how many times, and the next due. Tap → its history. */
export function EventsCard({
  series,
  dueText,
  daysUntil,
  onOpen,
  title,
}: {
  series: EventSeries[]
  dueText: (dueIn: number) => { text: string; color: string }
  daysUntil: (iso: string) => number
  onOpen: (s: EventSeries) => void
  title: string
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  return (
    <View>
      <SectionHead title={title} />
      <View style={[s.card, { backgroundColor: c.card, borderColor: c.border }]}>
        {series.length === 0 ? (
          <Txt variant="muted" style={{ padding: sp.lg }}>
            {t('pets.noEventsYet')}
          </Txt>
        ) : (
          series.map((se, i) => {
            const Icon = TYPE_ICON[se.latest.type]
            const tone = TYPE_COLOR[se.latest.type]
            const n = se.entries.length
            const next = se.latest.next_due
            const due = next ? dueText(daysUntil(next)) : null
            return (
              <Pressable
                key={se.key}
                onPress={() => onOpen(se)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  s.listRow,
                  i ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border } : null,
                  { opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <View style={[s.iconTile, { backgroundColor: tone + '22' }]}>
                  <Icon size={17} color={tone} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt style={{ fontFamily: fonts.medium, fontSize: 15.5 }} numberOfLines={1}>
                    {se.latest.title}
                  </Txt>
                  <Txt variant="faint" style={{ fontSize: 12.5 }} numberOfLines={1}>
                    {t('pets.lastOn', { date: formatDay(se.latest.event_date) })} ·{' '}
                    {n === 1 ? t('pets.timesOne') : t('pets.timesMany', { n })}
                  </Txt>
                </View>
                {due ? (
                  <Txt style={{ fontSize: 12.5, fontFamily: fonts.semibold, color: due.color }}>{due.text}</Txt>
                ) : null}
                <ChevronRight size={18} color={c.textFaint} />
              </Pressable>
            )
          })
        )}
      </View>
    </View>
  )
}

/** One event's history: every time it was logged (tap to edit, swipe left to
 *  delete), its next due, and "Log it again" docked at the bottom. */
export function EventSeriesSheet({
  series,
  dueText,
  daysUntil,
  onClose,
  onEdit,
  onDelete,
  onLogAgain,
}: {
  series: EventSeries
  dueText: (dueIn: number) => { text: string; color: string }
  daysUntil: (iso: string) => number
  onClose: () => void
  onEdit: (e: PetEvent) => void
  onDelete: (e: PetEvent) => void
  onLogAgain: (e: PetEvent) => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const bottom = useBottomGap(sp.xs)
  const Icon = TYPE_ICON[series.latest.type]
  const next = series.latest.next_due
  const due = next ? dueText(daysUntil(next)) : null
  const n = series.entries.length
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={s.backdrop}>
          <Pressable style={{ flex: 1 }} onPress={onClose} accessible={false} />
          <View style={[s.sheet, { backgroundColor: c.sheet }]}>
            <View style={s.sheetHead}>
              <View style={[s.iconTile, { backgroundColor: c.surface, width: 44, height: 44, borderRadius: 14 }]}>
                <Icon size={20} color={c.text} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt style={{ fontFamily: fonts.display, fontSize: 24, lineHeight: 29 }} numberOfLines={2}>
                  {series.latest.title}
                </Txt>
                <Txt variant="muted" style={{ fontSize: 13.5 }}>
                  {n === 1 ? t('pets.timesOne') : t('pets.timesMany', { n })}
                  {due && next ? (
                    <Txt style={{ fontSize: 13.5, color: due.color, fontFamily: fonts.semibold }}>
                      {' · '}
                      {t('pets.nextOn', { date: formatDay(next) })}
                    </Txt>
                  ) : null}
                </Txt>
              </View>
              <Pressable
                onPress={onClose}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('common.close')}
                style={[s.close, { backgroundColor: c.surface }]}
              >
                <X size={16} color={c.textMuted} />
              </Pressable>
            </View>

            <Txt
              style={[
                s.headText,
                { color: c.textMuted, paddingHorizontal: sp.lg, marginTop: sp.md, marginBottom: sp.sm },
              ]}
            >
              {t('pets.seriesHistory')}
            </Txt>
            <ScrollView
              style={{ flexGrow: 0 }}
              contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: sp.md }}
            >
              <View style={[s.card, { backgroundColor: c.card, borderColor: c.border }]}>
                {series.entries.map((e, i) => (
                  <HistoryRow key={e.id} e={e} first={i === 0} onOpen={() => onEdit(e)} onDelete={() => onDelete(e)} />
                ))}
              </View>
              <Txt variant="faint" style={{ fontSize: 12, textAlign: 'center', marginTop: sp.sm }}>
                {t('petcare.swipeHint')}
              </Txt>
            </ScrollView>

            <View style={{ paddingHorizontal: sp.lg, paddingTop: sp.sm, paddingBottom: bottom }}>
              <Btn title={t('pets.logAgain')} onPress={() => onLogAgain(series.latest)} curveBottom />
            </View>
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  )
}

const s = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: sp.lg,
    marginBottom: sp.sm,
    paddingHorizontal: 2,
  },
  headText: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  roundEdit: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayPill: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 32,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 4,
    gap: 2,
  },
  dayArrow: { paddingHorizontal: 6, height: 32, justifyContent: 'center' },
  card: {
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: sp.md, padding: sp.md },
  ringFill: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.md,
    paddingHorizontal: sp.md,
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  iconTile: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  check: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Two per row, ALWAYS half width — an odd last tile stays the same size as
  // the others instead of stretching across (owner, 2026-11).
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  tile: {
    width: '48.6%',
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    padding: sp.md,
    gap: sp.sm,
    minHeight: 176,
    justifyContent: 'space-between',
  },
  tileBtn: {
    height: 38,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.md,
    paddingHorizontal: sp.md,
    paddingVertical: 11,
  },
  calPage: {
    width: 42,
    height: 46,
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
  },
  calTop: { alignSelf: 'stretch', alignItems: 'center', paddingVertical: 2 },
  smallBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: radius.pill,
  },
  swipeDelete: { width: 76, alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: sp.lg, maxHeight: '88%' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: sp.lg },
  close: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
})
