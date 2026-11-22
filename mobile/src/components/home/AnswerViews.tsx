// The ask sheet's answer cards beyond "added" and "agenda" (AskSheet): which
// list?, what's on the list, bought/removed, event added, money logged, money
// summary, a nudge waiting for confirmation, pet care due, a family detail.
// All share one shape — the orb + a one-line answer, a panel with the detail,
// and at most two buttons (Undo / Open …) — so every action reads the same.
import { useEffect, useState, type ReactNode } from 'react'
import { Animated, Easing, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { CalendarDays, Check, ChevronRight, PawPrint, Plus, ReceiptText, RotateCcw, Send, Sparkles, Store, UsersRound, Wallet } from 'lucide-react-native'
import { evenSplit } from '@/apps/calc/splitMath'

import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import StoreLogo from '@/apps/shopping/StoreLogo'
import { useI18n } from '@/hooks/useI18n'
import { formatMoney } from '@/lib/format'
import type { Found, ListGroup, MoneyLine, PetDue, PetsAnswer } from '@/lib/assistant'
import type { Budget, ShoppingStore } from '@/lib/types'
import { fonts, radius, sp, useTheme } from '@/theme/theme'
import { GradientBox } from './GradientBox'
import { budgetLook } from './palette'

const ORB: readonly [string, string] = ['#8B6CFF', '#20C3A6']

export function Orb({ size = 30 }: { size?: number }) {
  return (
    <GradientBox colors={ORB} radius={size / 2} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Sparkles size={size * 0.5} color="#fff" strokeWidth={2.2} />
    </GradientBox>
  )
}

/** Orb + the answer in one line (+ an optional quieter line under it). */
export function Headline({ text, sub }: { text: string; sub?: string | null }) {
  return (
    <View style={v.row}>
      <Orb />
      <View style={{ flex: 1 }}>
        <Txt style={v.head}>{text}</Txt>
        {sub ? (
          <Txt variant="muted" style={{ marginTop: 2 }}>
            {sub}
          </Txt>
        ) : null}
      </View>
    </View>
  )
}

function Panel({ children }: { children: ReactNode }) {
  const { c } = useTheme()
  return <View style={[v.panel, { backgroundColor: c.card, borderColor: c.border }]}>{children}</View>
}

/** Up to two actions: a quiet one (Undo) and a filled one (Open …). */
function Actions({
  quiet,
  main,
}: {
  quiet?: { label: string; icon?: ReactNode; onPress: () => void } | null
  main?: { label: string; icon?: ReactNode; onPress: () => void } | null
}) {
  const { c } = useTheme()
  return (
    <View style={v.btns}>
      {quiet ? (
        <Pressable onPress={quiet.onPress} style={[v.btn, { backgroundColor: c.surface }]}>
          {quiet.icon}
          <Txt style={{ fontFamily: fonts.semibold, fontSize: 15 }}>{quiet.label}</Txt>
        </Pressable>
      ) : null}
      {main ? (
        <Pressable onPress={main.onPress} style={[v.btn, { backgroundColor: c.action }]}>
          {main.icon}
          <Txt style={{ fontFamily: fonts.semibold, fontSize: 15, color: c.onAction }}>{main.label}</Txt>
        </Pressable>
      ) : null}
    </View>
  )
}

const undoIcon = (color: string) => <RotateCcw size={17} color={color} />

// ── generic action ───────────────────────────────────────────────────────────

export interface ActionRowData {
  emoji?: string
  title: string
  sub?: string
  /** Highlighted (e.g. the cheaper option). */
  strong?: boolean
  /** A tappable option ("which one?"): the row is a button with a chevron. */
  onPress?: () => void
  /** Which filter chip this row belongs to (a member's email on money lists). */
  group?: string
  /** A section title inside the panel ("LOLA") — the rows under it belong to it. */
  head?: boolean
  /** A tick: 'new' = done by this answer (green check), 'prior' = was already
   *  done (outlined, faded) — pet tasks. */
  tone?: 'new' | 'prior'
}

/** Filter chips over an ActionView's rows ("Todos · Arthur · Ana"). */
export interface ActionFilters {
  chips: { id: string; label: string }[]
  /** The chip selected at first; null = everything. */
  initial: string | null
  allLabel: string
  /** The quieter line under the headline for a chip (null = everything). */
  sub?: (id: string | null) => string
  /** Rows shown at once. */
  limit: number
  /** "Show more": reveals the next `limit` rows. */
  more?: string
}

/** The shape every newer action shares (components/home/askActions.ts): the
 *  answer, an optional panel of rows, and up to two buttons — Undo or a
 *  second choice on the left, a confirm / Open … on the right. */
export function ActionView({
  headline,
  sub,
  rows: allRows,
  filters,
  quiet,
  main,
}: {
  headline: string
  sub?: string | null
  rows: ActionRowData[]
  filters?: ActionFilters | null
  quiet?: { label: string; undo?: boolean; onPress: () => void } | null
  main?: { label: string; onPress: () => void } | null
}) {
  const { c } = useTheme()
  const [pick, setPick] = useState<string | null>(filters?.initial ?? null)
  const [pages, setPages] = useState(1)
  const matching = filters ? allRows.filter((r) => !pick || r.group === pick) : allRows
  const rows = filters ? matching.slice(0, filters.limit * pages) : allRows
  return (
    <>
      <Headline text={headline} sub={filters?.sub ? filters.sub(pick) : sub} />
      {filters && filters.chips.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: sp.sm, paddingTop: sp.md }}>
          {[{ id: null as string | null, label: filters.allLabel }, ...filters.chips].map((ch) => {
            const on = pick === ch.id
            return (
              <Pressable
                key={ch.id ?? '*'}
                onPress={() => {
                  setPick(ch.id)
                  setPages(1)
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={({ pressed }) => [v.chip, { backgroundColor: on ? c.accent : c.surface, borderColor: on ? c.accent : c.border, opacity: pressed ? 0.7 : 1 }]}
              >
                <Txt style={{ fontFamily: fonts.semibold, fontSize: 14, color: on ? '#fff' : c.text }}>{ch.label}</Txt>
              </Pressable>
            )
          })}
        </ScrollView>
      ) : null}
      {rows.length ? (
        <Panel>
          {rows.map((r, i) => {
            if (r.head)
              return (
                <View key={i} style={[v.groupHead, i === 0 && { paddingTop: 2 }]}>
                  {r.emoji ? <Txt style={{ fontSize: 15 }}>{r.emoji}</Txt> : null}
                  <Txt style={{ fontFamily: fonts.semibold, fontSize: 12.5, letterSpacing: 1, textTransform: 'uppercase', color: c.textMuted }}>{r.title}</Txt>
                </View>
              )
            if (r.tone)
              return (
                <View key={i} style={[v.item, r.tone === 'prior' && { opacity: 0.55 }]}>
                  <View
                    style={[
                      v.petTick,
                      r.tone === 'new' ? { backgroundColor: c.income, borderColor: c.income } : { borderColor: c.textMuted, backgroundColor: 'transparent' },
                    ]}
                  >
                    <Check size={15} color={r.tone === 'new' ? '#fff' : c.textMuted} strokeWidth={3} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt style={{ fontFamily: fonts.semibold, fontSize: 16 }}>{r.title}</Txt>
                    {r.sub ? <Txt style={{ fontSize: 13.5, fontFamily: fonts.semibold, color: r.tone === 'new' ? c.income : c.textMuted }}>{r.sub}</Txt> : null}
                  </View>
                </View>
              )
            const body = (
              <>
                {r.emoji ? (
                  <View style={[v.tile, { backgroundColor: r.strong ? c.income + '22' : c.accentSoft }]}>
                    <Txt style={{ fontSize: 19 }}>{r.emoji}</Txt>
                  </View>
                ) : null}
                <View style={{ flex: 1 }}>
                  <Txt style={{ fontFamily: fonts.semibold, fontSize: 16 }}>{r.title}</Txt>
                  {r.sub ? <Txt variant="muted">{r.sub}</Txt> : null}
                </View>
                {r.strong ? <Check size={20} color={c.income} strokeWidth={3} /> : null}
                {r.onPress ? <ChevronRight size={20} color={c.textMuted} /> : null}
              </>
            )
            return r.onPress ? (
              <Pressable
                key={i}
                onPress={r.onPress}
                accessibilityRole="button"
                accessibilityLabel={[r.title, r.sub].filter(Boolean).join(', ')}
                style={({ pressed }) => [v.item, { opacity: pressed ? 0.6 : 1 }]}
              >
                {body}
              </Pressable>
            ) : (
              <View key={i} style={v.item}>
                {body}
              </View>
            )
          })}
        </Panel>
      ) : null}
      {filters?.more && matching.length > rows.length ? (
        <Pressable onPress={() => setPages((n) => n + 1)} accessibilityRole="button" hitSlop={8} style={({ pressed }) => ({ alignSelf: 'center', paddingVertical: sp.sm, opacity: pressed ? 0.6 : 1 })}>
          <Txt style={{ fontFamily: fonts.semibold, fontSize: 14.5, color: c.accent }}>
            {filters.more} ({matching.length - rows.length})
          </Txt>
        </Pressable>
      ) : null}
      {quiet || main ? (
        <Actions
          quiet={quiet ? { label: quiet.label, icon: quiet.undo ? undoIcon(c.text) : undefined, onPress: quiet.onPress } : null}
          main={main ?? null}
        />
      ) : null}
    </>
  )
}

// ── shopping ─────────────────────────────────────────────────────────────────

/** "Which list?" — the household's stores, "anywhere", and a new list (pre-
 *  filled with a store that was named but doesn't exist yet). */
/** "Which budget?" — each budget as a card in its own Money gradient. */
export function ChooseBudgetView({
  amount,
  type,
  title,
  budgets,
  onPick,
}: {
  amount: number
  type: 'expense' | 'income'
  title: string
  budgets: Budget[]
  onPick: (b: Budget) => void
}) {
  const { t } = useI18n()
  const what = `${type === 'income' ? '+' : '−'}${formatMoney(amount)}${title ? ` · ${title}` : ''}`
  return (
    <>
      <Headline text={t('ask.whichBudget')} sub={what} />
      <View style={{ gap: sp.sm, marginTop: sp.md }}>
        {budgets.map((b) => {
          const look = budgetLook(b.id)
          return (
            <Pressable key={b.id} onPress={() => onPick(b)} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
              <GradientBox colors={look.colors} radius={18} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: sp.md, height: 58 }}>
                <Wallet size={20} color="#fff" />
                <Txt style={{ flex: 1, fontFamily: fonts.display, fontSize: 17, color: '#fff' }} numberOfLines={1}>
                  {b.name}
                </Txt>
                <ChevronRight size={18} color="rgba(255,255,255,0.85)" />
              </GradientBox>
            </Pressable>
          )
        })}
      </View>
    </>
  )
}

export function ChooseStoreView({
  items,
  stores,
  suggested,
  onPick,
  onCreate,
}: {
  items: string[]
  stores: ShoppingStore[]
  suggested: string
  onPick: (store: ShoppingStore | null) => void
  onCreate: (name: string) => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState(suggested)
  return (
    <>
      <Headline text={t('ask.whichList', { items: items.join(', ') })} />
      <View style={v.choices}>
        {suggested ? (
          <Pressable onPress={() => onCreate(suggested)} style={[v.choice, { backgroundColor: c.action }]}>
            <Plus size={16} color={c.onAction} />
            <Txt style={{ fontFamily: fonts.semibold, color: c.onAction }}>{t('ask.createNamed', { name: suggested })}</Txt>
          </Pressable>
        ) : null}
        {stores.map((s) => (
          <Pressable key={s.id} onPress={() => onPick(s)} style={[v.choice, { backgroundColor: c.card, borderColor: c.border, borderWidth: StyleSheet.hairlineWidth }]}>
            <StoreLogo slug={s.slug} name={s.name} color={s.color} size={22} />
            <Txt style={{ fontFamily: fonts.semibold }}>{s.name}</Txt>
          </Pressable>
        ))}
        <Pressable onPress={() => onPick(null)} style={[v.choice, { backgroundColor: c.card, borderColor: c.border, borderWidth: StyleSheet.hairlineWidth }]}>
          <Store size={16} color={c.textMuted} />
          <Txt style={{ fontFamily: fonts.semibold }}>{t('shopping.anywhere')}</Txt>
        </Pressable>
        {!naming ? (
          <Pressable onPress={() => setNaming(true)} style={[v.choice, { borderColor: c.border, borderWidth: 1, borderStyle: 'dashed' }]}>
            <Plus size={16} color={c.accent} />
            <Txt style={{ fontFamily: fonts.semibold, color: c.accent }}>{t('ask.newList')}</Txt>
          </Pressable>
        ) : null}
      </View>
      {naming ? (
        <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
          <TextInput
            value={name}
            onChangeText={setName}
            autoFocus
            placeholder={t('ask.newListPlaceholder')}
            placeholderTextColor={c.textFaint}
            returnKeyType="done"
            onSubmitEditing={() => name.trim() && onCreate(name.trim())}
            style={[v.field, { backgroundColor: c.surface, color: c.text, borderColor: c.border }]}
          />
          <Pressable
            disabled={!name.trim()}
            onPress={() => onCreate(name.trim())}
            style={[v.smallBtn, { backgroundColor: name.trim() ? c.action : c.surface2 }]}
          >
            <Txt style={{ fontFamily: fonts.semibold, color: name.trim() ? c.onAction : c.textFaint }}>{t('ask.create')}</Txt>
          </Pressable>
        </View>
      ) : null}
    </>
  )
}

export function ListView({
  groups,
  store,
  onOpen,
}: {
  groups: ListGroup[]
  store: ShoppingStore | null
  onOpen: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const n = groups.reduce((sum, g) => sum + g.items.length, 0)
  const head =
    n === 0
      ? t('ask.listEmpty')
      : store
        ? t('ask.listStore', { n, store: store.name })
        : t(n === 1 ? 'ask.listOne' : 'ask.listMany', { n })
  return (
    <>
      <Headline text={head} />
      {n > 0 ? (
        <Panel>
          {groups.map((g, gi) => (
            <View key={g.store?.id ?? 'any'} style={gi ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border } : null}>
              <View style={[v.groupHead]}>
                {g.store ? <StoreLogo slug={g.store.slug} name={g.store.name} color={g.store.color} size={22} /> : <Store size={16} color={c.textMuted} />}
                <Txt style={{ fontFamily: fonts.semibold, fontSize: 14 }}>{g.store?.name ?? t('shopping.anywhere')}</Txt>
                <Txt variant="faint">{g.items.length}</Txt>
              </View>
              {g.items.map((i) => (
                <View key={i.id} style={v.item}>
                  <View style={[v.box, { borderColor: c.border }]} />
                  <Txt style={{ flex: 1, fontSize: 15.5 }}>{i.label}</Txt>
                </View>
              ))}
            </View>
          ))}
        </Panel>
      ) : null}
      <Actions main={{ label: t('ask.openList'), onPress: onOpen }} />
    </>
  )
}

/** "Is there coconut water on the list?" — the answer, then where it is. */
export function FoundView({ reply, found, onOpen }: { reply: string; found: Found[]; onOpen: () => void }) {
  const { c } = useTheme()
  const { t } = useI18n()
  return (
    <>
      <Headline text={reply || (found.length ? t('ask.found') : t('ask.notOnList'))} />
      {found.length ? (
        <Panel>
          {found.map((f, i) => (
            <View key={`${f.label}${i}`} style={v.item}>
              {f.store ? (
                <StoreLogo slug={f.store.slug} name={f.store.name} color={f.store.color} size={28} />
              ) : (
                <Store size={18} color={c.textMuted} />
              )}
              <Txt style={{ flex: 1, fontSize: 15.5, fontFamily: fonts.medium }}>{f.label}</Txt>
              <Txt variant="muted">{f.store?.name ?? t('shopping.anywhere')}</Txt>
            </View>
          ))}
        </Panel>
      ) : null}
      <Actions main={{ label: t('ask.openList'), onPress: onOpen }} />
    </>
  )
}

/** After "já comprei leite" / "tira o pão": what matched, what didn't, Undo. */
export function MarkedView({
  mode,
  hits,
  missing,
  undone,
  onUndo,
  onOpen,
}: {
  mode: 'check' | 'remove'
  hits: { id: string; label: string }[]
  missing: string[]
  undone: boolean
  onUndo: () => void
  onOpen: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const head = undone
    ? t('ask.backOnList')
    : hits.length === 0
      ? t('ask.nothingMatched')
      : t(mode === 'check' ? 'ask.checkedN' : 'ask.removedN', { n: hits.map((h) => h.label).join(', ') })
  return (
    <>
      <Headline text={head} sub={missing.length && hits.length ? t('ask.notFound', { items: missing.join(', ') }) : null} />
      <Actions
        quiet={hits.length && !undone ? { label: t('ask.undo'), icon: undoIcon(c.text), onPress: onUndo } : null}
        main={{ label: t('ask.openList'), onPress: onOpen }}
      />
    </>
  )
}

// ── calendar ─────────────────────────────────────────────────────────────────

export function EventView({
  headline,
  title,
  when,
  who,
  undone,
  onUndo,
  onOpen,
}: {
  /** Overrides "Added to the calendar" (a move says so instead). */
  headline?: string
  title: string
  when: string
  who: string | null
  undone: boolean
  onUndo: () => void
  onOpen: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  return (
    <>
      <Headline text={headline ?? (undone ? t('ask.eventUndone') : t('ask.eventAdded'))} />
      {!undone ? (
        <Panel>
          <View style={v.item}>
            <View style={[v.tile, { backgroundColor: c.accentSoft }]}>
              <CalendarDays size={19} color={c.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt style={{ fontFamily: fonts.semibold, fontSize: 16 }}>{title}</Txt>
              <Txt variant="muted">{[when, who].filter(Boolean).join(' · ')}</Txt>
            </View>
          </View>
        </Panel>
      ) : null}
      <Actions
        quiet={!undone ? { label: t('ask.undo'), icon: undoIcon(c.text), onPress: onUndo } : null}
        main={{ label: t('ask.openCalendar'), onPress: onOpen }}
      />
    </>
  )
}

// ── money ────────────────────────────────────────────────────────────────────

export function MoneyView({
  type,
  amount,
  title,
  where,
  icon,
  undone,
  onUndo,
  onOpen,
}: {
  type: 'expense' | 'income'
  amount: number
  title: string
  /** "Household · Jul 2026" */
  where: string
  icon: string
  undone: boolean
  onUndo: () => void
  onOpen: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const tone = type === 'income' ? c.income : c.expense
  return (
    <>
      <Headline
        text={undone ? t('ask.moneyUndone') : t(type === 'income' ? 'ask.moneyIncome' : 'ask.moneyExpense', { amount: formatMoney(amount) })}
      />
      {!undone ? (
        <Panel>
          <View style={v.item}>
            <View style={[v.tile, { backgroundColor: tone + '1F' }]}>
              <Txt style={{ fontSize: 19 }}>{icon}</Txt>
            </View>
            <View style={{ flex: 1 }}>
              <Txt style={{ fontFamily: fonts.semibold, fontSize: 16 }}>{title}</Txt>
              <Txt variant="muted">{where}</Txt>
            </View>
            <Txt style={{ fontFamily: fonts.display, fontSize: 18, color: tone, fontVariant: ['tabular-nums'] }}>
              {type === 'income' ? '+' : '−'}
              {formatMoney(amount)}
            </Txt>
          </View>
        </Panel>
      ) : null}
      <Actions
        quiet={!undone ? { label: t('ask.undo'), icon: undoIcon(c.text), onPress: onUndo } : null}
        main={{ label: t('ask.openMoney'), onPress: onOpen }}
      />
    </>
  )
}

/** One bar of the budget card: grows in from the left to its share of `max`. */
function MoneyBar({ value, max, color, delay }: { value: number; max: number; color: string; delay: number }) {
  const { c } = useTheme()
  const [grow] = useState(() => new Animated.Value(0))
  const share = max > 0 ? Math.max(value > 0 ? 0.03 : 0, Math.min(1, value / max)) : 0
  useEffect(() => {
    Animated.timing(grow, { toValue: share, duration: 650, delay, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start()
  }, [grow, share, delay])
  return (
    <View style={{ flex: 1, height: 12, borderRadius: 6, backgroundColor: c.surface, overflow: 'hidden' }}>
      <Animated.View style={{ height: 12, borderRadius: 6, backgroundColor: color, width: grow.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />
    </View>
  )
}

/** "How is the budget?" — per budget: received (green) and spent (red) as two
 *  bars on one scale, their amounts, and the balance (owner, 2026-11-17). */
export function SummaryView({ lines, head, label, onOpen }: { lines: MoneyLine[]; head?: string; label: (l: MoneyLine) => string; onOpen: () => void }) {
  const { c } = useTheme()
  const { t } = useI18n()
  return (
    <>
      <Headline text={lines.length ? (head ?? t('ask.summaryHead')) : t('ask.noBudget')} />
      {lines.map((l) => {
        const bal = l.income - l.spent
        return (
          <Panel key={l.budget.id}>
            <View style={{ paddingVertical: sp.sm, gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: sp.md }}>
                <Txt style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 15 }}>{label(l)}</Txt>
                <View style={{ alignItems: 'flex-end' }}>
                  <Txt variant="faint" style={{ fontSize: 12 }}>{t('common.balance')}</Txt>
                  <Txt style={{ fontFamily: fonts.display, color: bal >= 0 ? c.income : c.expense, fontSize: 24, lineHeight: 29 }}>{formatMoney(bal)}</Txt>
                </View>
              </View>
              {(
                [
                  ['↑', t('chart.received'), l.income, c.income, 0],
                  ['↓', t('chart.spent'), l.spent, c.expense, 120],
                ] as const
              ).map(([arrow, name, value, color, delay]) => (
                <View key={name} style={{ gap: 4 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Txt variant="faint" style={{ fontSize: 12.5 }}>
                      {arrow} {name}
                    </Txt>
                    <Txt style={{ fontFamily: fonts.semibold, color, fontSize: 15 }}>{formatMoney(value)}</Txt>
                  </View>
                  <MoneyBar value={value} max={Math.max(l.income, l.spent)} color={color} delay={delay} />
                </View>
              ))}
            </View>
          </Panel>
        )
      })}
      <Actions main={{ label: t('ask.openMoney'), onPress: onOpen }} />
    </>
  )
}

// ── nudge: shown first, sent only on a tap ───────────────────────────────────

export function NudgeView({
  message,
  to,
  sent,
  sending,
  onSend,
  onCancel,
  emoji = '📣',
  urgent = false,
}: {
  emoji?: string
  /** High priority: goes to everyone with sound (the urgent-nudge rules). */
  urgent?: boolean
  message: string
  to: string
  sent: boolean
  sending: boolean
  onSend: () => void
  onCancel: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  return (
    <>
      <Headline
        text={sent ? t('ask.nudgeSent', { to }) : t('ask.nudgeConfirm', { to })}
        sub={urgent ? t('ask.nudgeUrgent') : null}
      />
      <Panel>
        <View style={[v.item, { paddingVertical: sp.md }]}>
          <Txt style={{ fontSize: 22 }}>{emoji}</Txt>
          <Txt style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 17 }}>“{message}”</Txt>
          {sent ? <Check size={20} color={c.income} strokeWidth={3} /> : null}
        </View>
      </Panel>
      {!sent ? (
        <Actions
          quiet={{ label: t('common.cancel'), onPress: onCancel }}
          main={{
            label: t('ask.send'),
            icon: <Send size={16} color={c.onAction} />,
            onPress: () => !sending && onSend(),
          }}
        />
      ) : null}
    </>
  )
}

// ── utilities: split a bill, a discount ──────────────────────────────────────

/** Split a bill. Without a "how", it ASKS: equally (worked out right here) or
 *  by item (the photo-scan flow). Equally shows what each person pays. */
export function SplitView({
  amount,
  people,
  tip,
  mode,
  onEven,
  onItems,
  onOpenEven,
}: {
  amount: number
  people: number
  tip: number
  mode: 'choose' | 'even'
  onEven: () => void
  onItems: () => void
  onOpenEven: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  if (mode === 'choose') {
    return (
      <>
        <Headline
          text={people > 0 ? t('ask.splitHowN', { amount: formatMoney(amount), n: people }) : t('ask.splitHow', { amount: formatMoney(amount) })}
        />
        <View style={{ gap: sp.sm, marginTop: sp.md }}>
          <ChoiceCard icon={<UsersRound size={20} color={c.accent} />} title={t('ask.splitEven')} sub={t('ask.splitEvenSub')} onPress={onEven} />
          <ChoiceCard
            icon={<ReceiptText size={20} color={c.accent} />}
            title={t('ask.splitItems')}
            sub={t('ask.splitItemsSub')}
            badge
            onPress={onItems}
          />
        </View>
      </>
    )
  }
  const r = evenSplit(amount, Math.max(1, people), tip)
  return (
    <>
      <Headline text={t('ask.splitEven')} />
      <Panel>
        <View style={{ alignItems: 'center', paddingVertical: sp.lg, gap: 4 }}>
          <Txt style={{ fontSize: 12, fontFamily: fonts.semibold, letterSpacing: 1, textTransform: 'uppercase', color: c.textMuted }}>
            {t('calc.eachPays')}
          </Txt>
          <Txt style={{ fontSize: 48, lineHeight: 54, fontFamily: fonts.display, fontVariant: ['tabular-nums'] }}>{formatMoney(r.per)}</Txt>
          <Txt variant="muted">{t('calc.totalFor', { total: formatMoney(r.total), count: Math.max(1, people) })}</Txt>
          {tip > 0 ? <Txt variant="faint">{t('ask.withTip', { pct: tip, amount: formatMoney(r.tip) })}</Txt> : null}
          {r.extraCentCount > 0 ? (
            <Txt variant="faint" style={{ textAlign: 'center' }}>
              {t('calc.extraCent', { count: r.extraCentCount, amount: formatMoney(r.per + 0.01) })}
            </Txt>
          ) : null}
        </View>
      </Panel>
      <Actions quiet={{ label: t('ask.splitItems'), onPress: onItems }} main={{ label: t('ask.openSplit'), onPress: onOpenEven }} />
    </>
  )
}

function ChoiceCard({
  icon,
  title,
  sub,
  badge,
  onPress,
}: {
  icon: ReactNode
  title: string
  sub: string
  badge?: boolean
  onPress: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [v.choiceCard, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}
    >
      <View style={[v.tile, { backgroundColor: c.accentSoft }]}>{icon}</View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Txt style={{ fontFamily: fonts.semibold, fontSize: 16 }}>{title}</Txt>
          {badge ? (
            <View style={[v.aiBadge, { backgroundColor: c.accentSoft }]}>
              <Sparkles size={11} color={c.accent} />
              <Txt style={{ fontSize: 11, fontFamily: fonts.semibold, color: c.accent }}>{t('calc.aiBadge')}</Txt>
            </View>
          ) : null}
        </View>
        <Txt variant="muted" style={{ fontSize: 13.5, marginTop: 2 }}>
          {sub}
        </Txt>
      </View>
    </Pressable>
  )
}

export function DiscountView({ amount, percent, onOpen }: { amount: number; percent: number; onOpen: () => void }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const saved = Math.round(amount * percent) / 100
  const price = Math.round((amount - saved) * 100) / 100
  return (
    <>
      <Headline text={t('ask.discountHead', { price: formatMoney(price), pct: percent })} />
      <Panel>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: sp.md, paddingVertical: sp.lg }}>
          <Txt style={{ fontSize: 20, color: c.textFaint, textDecorationLine: 'line-through', fontVariant: ['tabular-nums'] }}>
            {formatMoney(amount)}
          </Txt>
          <Txt style={{ fontSize: 40, lineHeight: 46, fontFamily: fonts.display, color: c.income, fontVariant: ['tabular-nums'] }}>
            {formatMoney(price)}
          </Txt>
        </View>
        <Txt variant="muted" style={{ textAlign: 'center', paddingBottom: sp.md }}>
          {t('ask.youSave', { amount: formatMoney(saved) })}
        </Txt>
      </Panel>
      <Actions main={{ label: t('ask.openDiscount'), onPress: onOpen }} />
    </>
  )
}

// ── pets, family ─────────────────────────────────────────────────────────────

export function PetsView({
  p,
  onOpen,
  onToggle,
}: {
  p: PetsAnswer
  onOpen: () => void
  /** Tick / untick a daily-routine task right here (owner, 2026-11). */
  onToggle?: (taskId: string, done: boolean) => Promise<boolean>
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const { rows, pet, routineDone, routineTotal } = p
  // Ticked in this answer (optimistic): id → done.
  const [ticked, setTicked] = useState<Record<string, boolean>>({})
  const routine = rows.filter((r) => r.status === 'routine')
  const care = rows.filter((r) => r.status !== 'routine')
  const late = care.filter((r) => r.status === 'overdue').length
  const tickedNow = Object.values(ticked).filter(Boolean).length
  const nextUp = routine.find((r) => !ticked[r.id])
  // Several pets asked about ("Lola, Aninha"): the all-pets headline, and
  // each row says whose it is.
  const several = pet.includes(',')
  // Every pet (or several) with something left: one section per pet, in the
  // household's order (petsDue sorts by it) — owner, 2026-11.
  const petOrder = [...new Set(rows.map((r) => r.pet).filter(Boolean))]
  const byPet = (!pet || several) && petOrder.length > 1
  // Only what's late was asked ("algum cuidado atrasado?").
  const overdueOnly = p.view === 'overdue'
  // The headline follows what's still to do as items get ticked here.
  const head = overdueOnly
    ? late
      ? t('ask.petsLateN', { n: late })
      : t('ask.petsLateNone')
    : pet && !several
    ? nextUp
      ? t('ask.petsNext', { pet, title: nextUp.title })
      : routineTotal
        ? t('ask.petsAllDone', { pet })
        : care.length
          ? t('ask.petsNext', { pet, title: care[0].title })
          : t('ask.petsNoneFor', { pet })
    : rows.length
      ? t('ask.petsN', { n: rows.length - tickedNow })
      : t('ask.petsNone')
  const sub =
    [
      pet && routineTotal ? t('ask.petProgress', { done: routineDone + tickedNow, total: routineTotal }) : '',
      late && !overdueOnly ? t('ask.petsCareLate', { n: late }) : '',
    ]
      .filter(Boolean)
      .join(' · ') || null

  async function toggle(r: PetDue) {
    if (!onToggle) return
    const taskId = r.id.replace(/^daily:/, '')
    const next = !ticked[r.id]
    setTicked((m) => ({ ...m, [r.id]: next }))
    const ok = await onToggle(taskId, next)
    if (!ok) setTicked((m) => ({ ...m, [r.id]: !next }))
  }

  const row = (r: PetDue) => {
    const isRoutine = r.status === 'routine'
    const done = isRoutine && !!ticked[r.id]
    const tone = r.status === 'overdue' ? c.expense : isRoutine ? '#F2603A' : '#F2A93B'
    return (
      <View key={r.id} style={[v.item, { opacity: done ? 0.55 : 1 }]}>
        <View style={[v.tile, { backgroundColor: tone + '22' }]}>
          <PawPrint size={17} color={tone} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt style={{ fontFamily: fonts.semibold, fontSize: 15.5, textDecorationLine: done ? 'line-through' : 'none' }}>{r.title}</Txt>
          {r.pet && (!pet || several) && !byPet ? <Txt variant="muted">{r.pet}</Txt> : null}
        </View>
        {isRoutine && onToggle ? (
          // the same big round tick as Pet Care's Today card
          <Pressable
            onPress={() => void toggle(r)}
            hitSlop={8}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: done }}
            accessibilityLabel={r.title}
            style={[v.tick, { borderColor: done ? c.income : c.border, backgroundColor: done ? c.income : 'transparent' }]}
          >
            {done ? <Check size={16} color="#fff" strokeWidth={3} /> : null}
          </Pressable>
        ) : (
          <Txt style={{ fontSize: 12.5, fontFamily: fonts.semibold, color: r.status === 'overdue' ? c.expense : c.textMuted }}>
            {r.status === 'overdue' ? t('ask.petLate', { n: r.late }) : isRoutine ? t('ask.petRoutine') : t('home.dueToday')}
          </Txt>
        )}
      </View>
    )
  }
  const section = (title: string, list: PetDue[]) =>
    list.length ? (
      <View key={title}>
        <View style={v.groupHead}>
          <Txt style={{ fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: c.textMuted }}>
            {title}
          </Txt>
        </View>
        {list.map(row)}
      </View>
    ) : null
  return (
    <>
      <Headline text={head} sub={sub} />
      {rows.length ? (
        <Panel>
          {byPet
            ? petOrder.map((name) => section(name, rows.filter((r) => r.pet === name)))
            : [section(t('ask.petRoutineHead'), routine), section(t('ask.petCareHead'), care)]}
        </Panel>
      ) : null}
      <Actions main={{ label: t('ask.openPets'), onPress: onOpen }} />
    </>
  )
}

export function FamilyView({ text, onOpen }: { text: string; onOpen: () => void }) {
  const { t } = useI18n()
  return (
    <>
      <Headline text={text} />
      <Actions main={{ label: t('ask.openFamily'), onPress: onOpen }} />
    </>
  )
}

const v = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: sp.lg },
  head: { flex: 1, fontFamily: fonts.displaySemi, fontSize: 18, lineHeight: 24, paddingTop: 2 },
  panel: { marginTop: sp.md, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: sp.md, paddingVertical: 4 },
  btns: { flexDirection: 'row', gap: 10, marginTop: sp.md },
  btn: { flex: 1, height: 50, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginTop: sp.md },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, height: 44, borderRadius: radius.pill },
  field: { flex: 1, height: 46, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, fontSize: 16 },
  smallBtn: { height: 46, paddingHorizontal: 18, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: sp.md, paddingBottom: 4 },
  petTick: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  item: { flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: 9 },
  chip: { height: 36, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  tick: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  box: { width: 20, height: 20, borderRadius: 6, borderWidth: 2 },
  tile: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  choiceCard: { flexDirection: 'row', alignItems: 'center', gap: sp.md, padding: sp.md, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth },
  aiBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },
})
