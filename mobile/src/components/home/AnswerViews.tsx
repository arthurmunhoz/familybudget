// The ask sheet's answer cards beyond "added" and "agenda" (AskSheet): which
// list?, what's on the list, bought/removed, event added, money logged, money
// summary, a nudge waiting for confirmation, pet care due, a family detail.
// All share one shape — the orb + a one-line answer, a panel with the detail,
// and at most two buttons (Undo / Open …) — so every action reads the same.
import { useState, type ReactNode } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import { CalendarDays, Check, PawPrint, Plus, ReceiptText, RotateCcw, Send, Sparkles, Store, UsersRound } from 'lucide-react-native'
import { evenSplit } from '@/apps/calc/splitMath'

import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import StoreLogo from '@/apps/shopping/StoreLogo'
import { useI18n } from '@/hooks/useI18n'
import { formatMoney } from '@/lib/format'
import type { Found, ListGroup, MoneyLine, PetDue, PetsAnswer } from '@/lib/assistant'
import type { ShoppingStore } from '@/lib/types'
import { fonts, radius, sp, useTheme } from '@/theme/theme'
import { GradientBox } from './GradientBox'

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

// ── shopping ─────────────────────────────────────────────────────────────────

/** "Which list?" — the household's stores, "anywhere", and a new list (pre-
 *  filled with a store that was named but doesn't exist yet). */
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
  title,
  when,
  who,
  undone,
  onUndo,
  onOpen,
}: {
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
      <Headline text={undone ? t('ask.eventUndone') : t('ask.eventAdded')} />
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

export function SummaryView({ lines, label, onOpen }: { lines: MoneyLine[]; label: (l: MoneyLine) => string; onOpen: () => void }) {
  const { c } = useTheme()
  const { t } = useI18n()
  return (
    <>
      <Headline text={lines.length ? t('ask.summaryHead') : t('ask.noBudget')} />
      {lines.map((l) => {
        const bal = l.income - l.spent
        return (
          <Panel key={l.budget.id}>
            <View style={{ paddingVertical: sp.sm, gap: 6 }}>
              <Txt style={{ fontFamily: fonts.semibold, fontSize: 15 }}>{label(l)}</Txt>
              <View style={{ flexDirection: 'row', gap: sp.lg }}>
                <View>
                  <Txt variant="faint" style={{ fontSize: 12 }}>↑ {t('chart.received')}</Txt>
                  <Txt style={{ fontFamily: fonts.semibold, color: c.income, fontSize: 16 }}>{formatMoney(l.income)}</Txt>
                </View>
                <View>
                  <Txt variant="faint" style={{ fontSize: 12 }}>↓ {t('chart.spent')}</Txt>
                  <Txt style={{ fontFamily: fonts.semibold, color: c.expense, fontSize: 16 }}>{formatMoney(l.spent)}</Txt>
                </View>
                <View style={{ marginLeft: 'auto', alignItems: 'flex-end' }}>
                  <Txt variant="faint" style={{ fontSize: 12 }}>{t('common.balance')}</Txt>
                  <Txt style={{ fontFamily: fonts.display, color: bal >= 0 ? c.income : c.expense, fontSize: 19 }}>
                    {formatMoney(bal)}
                  </Txt>
                </View>
              </View>
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
}: {
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
      <Headline text={sent ? t('ask.nudgeSent', { to }) : t('ask.nudgeConfirm', { to })} />
      <Panel>
        <View style={[v.item, { paddingVertical: sp.md }]}>
          <Txt style={{ fontSize: 22 }}>📣</Txt>
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

export function PetsView({ p, onOpen }: { p: PetsAnswer; onOpen: () => void }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const { rows, pet, routineDone, routineTotal } = p
  // Two kinds of "what it needs", shown apart (owner, 2026-11): today's daily
  // routine, and Care (overdue / due today — a monthly flea pill 18 days late).
  const routine = rows.filter((r) => r.status === 'routine')
  const care = rows.filter((r) => r.status !== 'routine')
  const late = care.filter((r) => r.status === 'overdue').length
  // Asked about one pet: the headline is the next ROUTINE item ("what's next
  // for Lola today?"); Care is said under it and listed below, never hidden.
  const head = pet
    ? routine.length
      ? t('ask.petsNext', { pet, title: routine[0].title })
      : routineTotal
        ? t('ask.petsAllDone', { pet })
        : care.length
          ? t('ask.petsNext', { pet, title: care[0].title })
          : t('ask.petsNoneFor', { pet })
    : rows.length
      ? t('ask.petsN', { n: rows.length })
      : t('ask.petsNone')
  const sub =
    [pet && routineTotal ? t('ask.petProgress', { done: routineDone, total: routineTotal }) : '', late ? t('ask.petsCareLate', { n: late }) : '']
      .filter(Boolean)
      .join(' · ') || null
  const row = (r: PetDue) => {
    const tone = r.status === 'overdue' ? c.expense : r.status === 'routine' ? '#F2603A' : '#F2A93B'
    return (
      <View key={r.id} style={v.item}>
        <View style={[v.tile, { backgroundColor: tone + '22' }]}>
          <PawPrint size={17} color={tone} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt style={{ fontFamily: fonts.semibold, fontSize: 15.5 }}>{r.title}</Txt>
          {r.pet && !pet ? <Txt variant="muted">{r.pet}</Txt> : null}
        </View>
        <Txt style={{ fontSize: 12.5, fontFamily: fonts.semibold, color: r.status === 'overdue' ? c.expense : c.textMuted }}>
          {r.status === 'overdue' ? t('ask.petLate', { n: r.late }) : r.status === 'routine' ? t('ask.petRoutine') : t('home.dueToday')}
        </Txt>
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
          {section(t('ask.petRoutineHead'), routine)}
          {section(t('ask.petCareHead'), care)}
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
  item: { flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: 9 },
  box: { width: 20, height: 20, borderRadius: 6, borderWidth: 2 },
  tile: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  choiceCard: { flexDirection: 'row', alignItems: 'center', gap: sp.md, padding: sp.md, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth },
  aiBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },
})
