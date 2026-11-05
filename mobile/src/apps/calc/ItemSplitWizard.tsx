// Split a bill by item — a guided flow around the photo scan (One Roof Plus):
//   intro (what's about to happen) → camera → processing → who's splitting →
//   who had what → tax & tip → summary (editable, shareable).
// The bill's lines come only from the scan (see billScan.ts); the wizard
// assigns them, it never edits them.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Share, StyleSheet, TextInput, View } from 'react-native'
import { Image } from 'expo-image'
import { router } from 'expo-router'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import {
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Images,
  ReceiptText,
  ScanLine,
  Sparkles,
  Sun,
  TriangleAlert,
  UserPlus,
  X,
} from 'lucide-react-native'
import { ActivityIndicator } from 'react-native'

import { Pressable } from '@/components/Pressable'
import { Card, Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { useAuth } from '@/lib/auth'
import { formatMoney } from '@/lib/format'
import { usePlus } from '@/lib/plus'
import { fonts, radius, sp, useTheme } from '@/theme/theme'

import { pickBillPhoto, scanBill, ScanError, type ScannedBill } from './billScan'
import { Avatar, colorFor, firstName } from './shared'
import { itemSplit, type PersonShare, type SplitItem, type Tip } from './splitMath'
import { EditRow, TipGrid } from './steps'
import { StepTitle, WizardScreen } from './wizard'

type Stage = 'intro' | 'scan' | 'people' | 'assign' | 'extras' | 'summary'
const ORDER: Stage[] = ['intro', 'scan', 'people', 'assign', 'extras', 'summary']
const STEPS = 5
const progressIndex = (s: Stage) => Math.max(0, ORDER.indexOf(s) - 1)

type ScanState =
  | { phase: 'working'; uri: string }
  | { phase: 'done'; uri: string; count: number }
  | { phase: 'error'; uri: string; reason: ScanError['reason']; message?: string }

export function ItemSplitWizard() {
  const { t } = useI18n()
  const { isFree } = usePlus()
  const { profiles } = useAuth()

  const [stage, setStage] = useState<Stage>('intro')
  const [dir, setDir] = useState<1 | -1>(1)
  const [editing, setEditing] = useState(false)

  const [scan, setScan] = useState<ScanState | null>(null)
  const [items, setItems] = useState<SplitItem[]>([])
  const [tax, setTax] = useState(0)
  const [billTip, setBillTip] = useState(0)
  const [tip, setTip] = useState<Tip>({ kind: 'pct', pct: 20 })
  const [people, setPeople] = useState<string[]>([])
  const [nameInput, setNameInput] = useState('')
  const abort = useRef<AbortController | null>(null)

  const go = useCallback((to: Stage) => {
    setDir(ORDER.indexOf(to) >= ORDER.indexOf(stage) ? 1 : -1)
    setStage(to)
  }, [stage])

  useEffect(() => () => abort.current?.abort(), [])

  const exit = useCallback(() => (router.canGoBack() ? router.back() : router.replace('/calc')), [])

  async function capture(fromCamera: boolean) {
    const picked = await pickBillPhoto(fromCamera)
    if (picked === 'denied') {
      Alert.alert(t(fromCamera ? 'bill.cameraDenied' : 'bill.libraryDenied'))
      return
    }
    if (!picked) return
    void runScan(picked)
  }

  async function runScan(uri: string) {
    abort.current?.abort()
    const ctl = new AbortController()
    abort.current = ctl
    setScan({ phase: 'working', uri })
    go('scan')
    try {
      const bill: ScannedBill = await scanBill(uri, ctl.signal)
      if (ctl.signal.aborted) return
      setItems(bill.items)
      setTax(bill.tax)
      setBillTip(bill.tip)
      setTip(bill.tip > 0 ? { kind: 'amount', amount: bill.tip } : { kind: 'pct', pct: 20 })
      // A fresh bill keeps the people but nobody has claimed anything yet.
      setScan({ phase: 'done', uri, count: bill.items.length })
      setTimeout(() => {
        if (ctl.signal.aborted) return
        setDir(1)
        setStage('people')
      }, 900)
    } catch (err) {
      if (ctl.signal.aborted) return
      const reason = err instanceof ScanError ? err.reason : 'failed'
      const message = err instanceof ScanError && err.reason === 'monthly_cap' ? err.message : undefined
      setScan({ phase: 'error', uri, reason, message })
    }
  }

  const onBack = useCallback(() => {
    if (stage === 'intro' || stage === 'summary') return exit()
    if (stage === 'scan') {
      abort.current?.abort()
      setDir(-1)
      setStage('intro')
      return
    }
    if (editing) {
      setEditing(false)
      setDir(-1)
      setStage('summary')
      return
    }
    // Walking back from "who's splitting" lands on the intro, not the
    // processing screen — there's nothing to do there any more.
    const prev = stage === 'people' ? 'intro' : ORDER[ORDER.indexOf(stage) - 1]
    setDir(-1)
    setStage(prev)
  }, [stage, editing, exit])

  const next = (to: Stage) => {
    if (editing) {
      setEditing(false)
      go('summary')
    } else go(to)
  }
  const edit = (to: Stage) => {
    setEditing(true)
    go(to)
  }
  const cta = editing ? t('calc.updateSummary') : t('calc.continue')

  // ── people helpers ──────────────────────────────────────────────────────
  const memberNames = profiles
    .map((p) => p.display_name?.trim() || p.email)
    .filter((n): n is string => !!n)
  const suggestions = memberNames.filter((n) => !people.includes(n))

  function addPerson(name: string) {
    const n = name.trim()
    if (!n) return
    setPeople((p) => (p.includes(n) ? p : [...p, n]))
    setNameInput('')
  }
  function removePerson(name: string) {
    setPeople((p) => p.filter((x) => x !== name))
    setItems((its) => its.map((it) => ({ ...it, people: it.people.filter((x) => x !== name) })))
  }
  function toggle(id: string, name: string) {
    setItems((its) =>
      its.map((it) =>
        it.id !== id
          ? it
          : { ...it, people: it.people.includes(name) ? it.people.filter((x) => x !== name) : [...it.people, name] },
      ),
    )
  }
  function shareAll(id: string) {
    setItems((its) =>
      its.map((it) =>
        it.id !== id ? it : { ...it, people: it.people.length === people.length ? [] : [...people] },
      ),
    )
  }
  const removeItem = (id: string) => setItems((its) => its.filter((it) => it.id !== id))

  const result = itemSplit(items, people, tax, tip)
  const title = t('calc.tool.byItem')

  // ── Plus gate (deep links land here too) ───────────────────────────────
  if (isFree) {
    return (
      <WizardScreen
        title={title}
        steps={STEPS}
        index={0}
        onBack={exit}
        hideProgress
        primary={{ label: t('settings.getPlus'), onPress: () => router.push('/paywall') }}
      >
        <StepTitle title={t('calc.plusByItem')} hint={t('calc.plusByItemHint')} />
      </WizardScreen>
    )
  }

  if (stage === 'intro') {
    return (
      <WizardScreen
        title={title}
        steps={STEPS}
        index={0}
        direction={dir}
        onBack={onBack}
        primary={{ label: t('bill.openCamera'), onPress: () => void capture(true) }}
        secondary={{ label: t('bill.scanLibrary'), onPress: () => void capture(false) }}
      >
        <IntroStep />
      </WizardScreen>
    )
  }

  if (stage === 'scan' && scan) {
    const failed = scan.phase === 'error'
    const capped = failed && scan.reason === 'monthly_cap'
    return (
      <WizardScreen
        title={title}
        steps={STEPS}
        index={0}
        direction={dir}
        onBack={onBack}
        primary={
          capped
            ? { label: t('settings.getPlus'), onPress: () => router.push('/paywall') }
            : failed
              ? { label: t('bill.retakePhoto'), onPress: () => void capture(true) }
              : undefined
        }
        secondary={failed && !capped ? { label: t('bill.scanLibrary'), onPress: () => void capture(false) } : undefined}
      >
        <ScanningStep scan={scan} />
      </WizardScreen>
    )
  }

  if (stage === 'people') {
    const pending = nameInput.trim()
    return (
      <WizardScreen
        title={title}
        steps={STEPS}
        index={progressIndex('people')}
        direction={dir}
        onBack={onBack}
        primary={{
          label: cta,
          disabled: people.length === 0 && !pending,
          onPress: () => {
            if (pending) addPerson(pending)
            next('assign')
          },
        }}
      >
        <StepTitle step={2} steps={STEPS} title={t('bill.people')} hint={t('bill.peopleHint')} />
        <FoundBanner count={items.length} subtotal={result.subtotal} />
        <PeopleStep
          people={people}
          suggestions={suggestions}
          nameInput={nameInput}
          onNameInput={setNameInput}
          onAdd={addPerson}
          onRemove={removePerson}
        />
      </WizardScreen>
    )
  }

  if (stage === 'assign') {
    const unassigned = items.filter((it) => it.people.length === 0)
    const done = items.length - unassigned.length
    const proceed = () => next('extras')
    return (
      <WizardScreen
        title={title}
        steps={STEPS}
        index={progressIndex('assign')}
        direction={dir}
        onBack={onBack}
        primary={{
          label: cta,
          disabled: items.length === 0,
          onPress: () => {
            if (unassigned.length === 0) return proceed()
            Alert.alert(
              t('bill.unassignedTitle', { count: unassigned.length }),
              t('bill.unassignedBody'),
              [
                { text: t('bill.keepAssigning'), style: 'cancel' },
                {
                  text: t('bill.shareRest'),
                  onPress: () => {
                    setItems((its) => its.map((it) => (it.people.length ? it : { ...it, people: [...people] })))
                    proceed()
                  },
                },
                { text: t('bill.leaveOut'), style: 'destructive', onPress: proceed },
              ],
            )
          },
        }}
      >
        <StepTitle step={3} steps={STEPS} title={t('bill.q.assign')} hint={t('bill.q.assignHint')} />
        <Txt variant="label" style={{ marginBottom: sp.sm }}>
          {t('bill.assignedCount', { done, total: items.length })}
        </Txt>
        <AssignStep
          items={items}
          people={people}
          onToggle={toggle}
          onAll={shareAll}
          onRemove={removeItem}
        />
      </WizardScreen>
    )
  }

  if (stage === 'extras') {
    return (
      <WizardScreen
        title={title}
        steps={STEPS}
        index={progressIndex('extras')}
        direction={dir}
        onBack={onBack}
        primary={{ label: cta, onPress: () => next('summary') }}
      >
        <StepTitle step={4} steps={STEPS} title={t('bill.q.extras')} hint={t('bill.q.extrasHint')} />
        <Card style={{ marginBottom: sp.xl }}>
          <Line label={t('bill.subtotal')} value={formatMoney(result.subtotal)} />
          <Line label={t('bill.taxFromPhoto')} value={formatMoney(tax)} />
        </Card>
        <Txt variant="label" style={{ marginBottom: sp.sm }}>
          {t('bill.tip')}
        </Txt>
        <TipGrid base={result.subtotal} value={tip} onChange={setTip} fromBill={billTip} />
      </WizardScreen>
    )
  }

  // ── summary ─────────────────────────────────────────────────────────────
  const tipLabel =
    tip.kind === 'amount'
      ? formatMoney(result.tip)
      : tip.pct === 0
        ? t('calc.noTip')
        : `${tip.pct}% · ${formatMoney(result.tip)}`

  function share() {
    const lines = [
      t('bill.shareHeader', { total: formatMoney(result.total) }),
      ...result.people.map((p) => `${p.name}: ${formatMoney(p.total)}`),
    ]
    void Share.share({ message: lines.join('\n') })
  }

  function newPhoto() {
    Alert.alert(t('bill.newPhotoTitle'), t('bill.newPhotoBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('bill.openCamera'),
        onPress: () => {
          setItems([])
          setEditing(false)
          go('intro')
        },
      },
    ])
  }

  return (
    <WizardScreen
      title={title}
      steps={STEPS}
      index={progressIndex('summary')}
      direction={dir}
      onBack={onBack}
      swipeBack
      primary={{ label: t('calc.share'), onPress: share }}
      secondary={{ label: t('common.done'), onPress: exit }}
    >
      <StepTitle step={5} steps={STEPS} title={t('calc.q.summary')} hint={t('bill.summaryHint')} />
      <SummaryStep result={result} />
      <View style={{ height: sp.lg }} />
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <EditRow first label={t('bill.peopleShort')} value={String(people.length)} onPress={() => edit('people')} />
        <EditRow
          label={t('bill.items')}
          value={t('bill.assignedShort', { done: items.length - result.unassigned.length, total: items.length })}
          onPress={() => edit('assign')}
        />
        <EditRow label={t('bill.tip')} value={tipLabel} onPress={() => edit('extras')} />
      </Card>
      <Pressable onPress={newPhoto} style={{ alignSelf: 'center', padding: sp.md, marginTop: sp.sm }}>
        <Txt variant="label">{t('bill.newPhoto')}</Txt>
      </Pressable>
    </WizardScreen>
  )
}

// ── Step bodies (module scope — never define components inside a render) ──

function IntroStep() {
  const { c } = useTheme()
  const { t } = useI18n()
  const tips: { icon: typeof Camera; text: string }[] = [
    { icon: ReceiptText, text: t('bill.intro.tip1') },
    { icon: Sun, text: t('bill.intro.tip2') },
    { icon: Sparkles, text: t('bill.intro.tip3') },
  ]
  return (
    <View>
      <View style={[styles.introArt, { backgroundColor: c.accentSoft }]}>
        <ScanLine size={56} color={c.accent} strokeWidth={1.6} />
      </View>
      <StepTitle step={1} steps={STEPS} title={t('bill.intro.title')} hint={t('bill.intro.body')} />
      <Card style={{ gap: sp.lg }}>
        {tips.map(({ icon: Icon, text }) => (
          <View key={text} style={{ flexDirection: 'row', gap: sp.md, alignItems: 'center' }}>
            <View style={[styles.tipIcon, { backgroundColor: c.surface }]}>
              <Icon size={20} color={c.accent} />
            </View>
            <Txt style={{ flex: 1 }}>{text}</Txt>
          </View>
        ))}
      </Card>
    </View>
  )
}

/** Processing screen: the photo with a sweeping scan line and a short
 *  checklist. The API is ONE request, so the middle stages are paced on a
 *  timer — they describe what the server is doing, they don't track it. */
function ScanningStep({ scan }: { scan: ScanState }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const [tick, setTick] = useState(0)
  const sweep = useSharedValue(0)
  const working = scan.phase === 'working'

  useEffect(() => {
    if (!working) return
    setTick(0)
    const a = setTimeout(() => setTick(1), 1200)
    const b = setTimeout(() => setTick(2), 4500)
    return () => {
      clearTimeout(a)
      clearTimeout(b)
    }
  }, [working, scan.uri])

  useEffect(() => {
    sweep.value = 0
    sweep.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.quad) }), -1, true)
  }, [sweep])

  const lineStyle = useAnimatedStyle(() => ({ top: `${sweep.value * 100}%` }))

  const stages = [t('bill.stage.upload'), t('bill.stage.items'), t('bill.stage.totals')]
  const doneUpTo = scan.phase === 'done' ? stages.length : scan.phase === 'error' ? -1 : tick

  return (
    <View style={{ alignItems: 'center' }}>
      <View style={[styles.photo, { borderColor: c.border, backgroundColor: c.surface }]}>
        <Image source={{ uri: scan.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
        {working ? (
          <Animated.View style={[styles.scanLine, { backgroundColor: c.action, shadowColor: c.action }, lineStyle]} />
        ) : null}
        {scan.phase === 'done' ? (
          <View style={[styles.photoBadge, { backgroundColor: c.income }]}>
            <Check size={28} color="#ffffff" strokeWidth={3} />
          </View>
        ) : null}
      </View>

      {scan.phase === 'error' ? (
        <View style={{ alignItems: 'center', gap: sp.sm, marginTop: sp.xl }}>
          <TriangleAlert size={28} color={c.expense} />
          <Txt variant="h2" style={{ textAlign: 'center' }}>
            {scan.reason === 'monthly_cap' ? t('bill.scanLimitReached') : t('bill.scanFailedTitle')}
          </Txt>
          <Txt variant="muted" style={{ textAlign: 'center' }}>
            {scan.reason === 'monthly_cap' ? scan.message || t('bill.scanLimitBody') : t('bill.scanFailed')}
          </Txt>
        </View>
      ) : (
        <View style={{ alignSelf: 'stretch', marginTop: sp.xl, gap: sp.md }}>
          <Txt variant="h2" style={{ textAlign: 'center', marginBottom: sp.xs }}>
            {scan.phase === 'done' ? t('bill.foundItems', { count: scan.count }) : t('bill.scanning')}
          </Txt>
          {stages.map((label, i) => {
            const done = i < doneUpTo
            const active = i === doneUpTo
            return (
              <View key={label} style={styles.stageRow}>
                <View style={styles.stageIcon}>
                  {done ? (
                    <Check size={18} color={c.income} strokeWidth={3} />
                  ) : active ? (
                    <ActivityIndicator size="small" color={c.accent} />
                  ) : (
                    <View style={[styles.stageDot, { backgroundColor: c.surface2 }]} />
                  )}
                </View>
                <Txt style={{ color: done || active ? c.text : c.textFaint }}>{label}</Txt>
              </View>
            )
          })}
        </View>
      )}
    </View>
  )
}

function FoundBanner({ count, subtotal }: { count: number; subtotal: number }) {
  const { c } = useTheme()
  const { t } = useI18n()
  return (
    <View style={[styles.found, { backgroundColor: c.accentSoft }]}>
      <ReceiptText size={18} color={c.accent} />
      <Txt style={{ flex: 1, color: c.text }}>
        {t('bill.foundSummary', { count, amount: formatMoney(subtotal) })}
      </Txt>
    </View>
  )
}

function PeopleStep({
  people,
  suggestions,
  nameInput,
  onNameInput,
  onAdd,
  onRemove,
}: {
  people: string[]
  suggestions: string[]
  nameInput: string
  onNameInput: (s: string) => void
  onAdd: (name: string) => void
  onRemove: (name: string) => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  return (
    <View style={{ gap: sp.lg }}>
      {suggestions.length > 0 ? (
        <View>
          <Txt variant="label" style={{ marginBottom: sp.sm }}>
            {t('bill.fromHousehold')}
          </Txt>
          <View style={styles.wrap}>
            {suggestions.map((n) => (
              <Pressable
                key={n}
                onPress={() => onAdd(n)}
                style={[styles.suggest, { backgroundColor: c.card, borderColor: c.border }]}
              >
                <Avatar name={n} sm />
                <Txt style={{ fontFamily: fonts.semibold, color: c.text }}>{firstName(n)}</Txt>
                <UserPlus size={15} color={c.accent} />
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: sp.sm }}>
        <TextInput
          value={nameInput}
          onChangeText={onNameInput}
          onSubmitEditing={() => onAdd(nameInput)}
          submitBehavior="submit"
          placeholder={t('bill.addName')}
          placeholderTextColor={c.textFaint}
          returnKeyType="done"
          autoCapitalize="words"
          style={[styles.nameInput, { backgroundColor: c.card, borderColor: c.border, color: c.text }]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.add')}
          onPress={() => onAdd(nameInput)}
          disabled={!nameInput.trim()}
          style={[styles.addBtn, { backgroundColor: nameInput.trim() ? c.action : c.surface }]}
        >
          <UserPlus size={20} color={nameInput.trim() ? c.onAction : c.textFaint} />
        </Pressable>
      </View>

      {people.length > 0 ? (
        <View>
          <Txt variant="label" style={{ marginBottom: sp.sm }}>
            {t('bill.splittingCount', { count: people.length })}
          </Txt>
          <View style={styles.wrap}>
            {people.map((p) => (
              <Pressable
                key={p}
                accessibilityLabel={t('common.removeName', { name: p })}
                onPress={() => onRemove(p)}
                style={[styles.person, { backgroundColor: colorFor(p) }]}
              >
                <Txt style={{ fontFamily: fonts.semibold, color: '#ffffff' }}>{firstName(p)}</Txt>
                <X size={14} color="#ffffff" />
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  )
}

function AssignStep({
  items,
  people,
  onToggle,
  onAll,
  onRemove,
}: {
  items: SplitItem[]
  people: string[]
  onToggle: (id: string, name: string) => void
  onAll: (id: string) => void
  onRemove: (id: string) => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  return (
    <View style={{ gap: sp.sm }}>
      {items.map((it) => {
        const all = people.length > 1 && it.people.length === people.length
        const none = it.people.length === 0
        return (
          <View
            key={it.id}
            style={[
              styles.itemCard,
              { backgroundColor: c.card, borderColor: none ? c.action : c.border, borderWidth: none ? 1 : StyleSheet.hairlineWidth },
            ]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
              <Txt style={{ flex: 1, fontFamily: fonts.semibold, color: c.text }} numberOfLines={2}>
                {it.name}
              </Txt>
              <Txt style={{ fontFamily: fonts.semibold, color: c.text, fontVariant: ['tabular-nums'] }}>
                {formatMoney(it.price)}
              </Txt>
              <Pressable
                accessibilityLabel={t('common.removeName', { name: it.name })}
                onPress={() => onRemove(it.id)}
                hitSlop={8}
              >
                <X size={18} color={c.textFaint} />
              </Pressable>
            </View>
            <View style={[styles.wrap, { marginTop: sp.sm }]}>
              {people.length > 1 ? (
                <Pressable
                  onPress={() => onAll(it.id)}
                  style={[styles.chip, { backgroundColor: all ? c.text : c.surface }]}
                >
                  <Txt style={{ fontSize: 13, fontFamily: fonts.semibold, color: all ? c.sheet : c.textMuted }}>
                    {t('common.everyone')}
                  </Txt>
                </Pressable>
              ) : null}
              {people.map((p) => {
                const on = it.people.includes(p)
                return (
                  <Pressable
                    key={p}
                    onPress={() => onToggle(it.id, p)}
                    style={[styles.chip, { backgroundColor: on ? colorFor(p) : c.surface }]}
                  >
                    <Txt style={{ fontSize: 13, fontFamily: fonts.semibold, color: on ? '#ffffff' : c.textMuted }}>
                      {firstName(p)}
                    </Txt>
                  </Pressable>
                )
              })}
            </View>
            {it.people.length > 1 ? (
              <Txt variant="faint" style={{ marginTop: 6 }}>
                {t('bill.splitWays', { count: it.people.length })} · {formatMoney(it.price / it.people.length)}
              </Txt>
            ) : null}
          </View>
        )
      })}
    </View>
  )
}

function SummaryStep({ result }: { result: ReturnType<typeof itemSplit> }) {
  const { c } = useTheme()
  const { t } = useI18n()
  return (
    <View style={{ gap: sp.sm }}>
      <Card style={{ alignItems: 'center', paddingVertical: sp.lg, gap: 2 }}>
        <Txt variant="label" style={{ textTransform: 'uppercase', letterSpacing: 0.6, color: c.textFaint }}>
          {t('bill.billTotal')}
        </Txt>
        <Txt style={{ fontSize: 40, fontFamily: fonts.display, color: c.text, fontVariant: ['tabular-nums'] }}>
          {formatMoney(result.total)}
        </Txt>
        <Txt variant="faint">
          {t('bill.totalBreakdown', {
            subtotal: formatMoney(result.subtotal),
            tax: formatMoney(result.tax),
            tip: formatMoney(result.tip),
          })}
        </Txt>
      </Card>
      {result.people.map((p) => (
        <PersonCard key={p.name} share={p} />
      ))}
      {result.unassigned.length > 0 ? (
        <View style={[styles.found, { backgroundColor: c.accentSoft }]}>
          <TriangleAlert size={18} color={c.accent} />
          <Txt style={{ flex: 1, color: c.text }}>
            {t('bill.leftOut', {
              count: result.unassigned.length,
              names: result.unassigned.map((i) => i.name).join(', '),
            })}
          </Txt>
        </View>
      ) : null}
    </View>
  )
}

function PersonCard({ share }: { share: PersonShare }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const Chevron = open ? ChevronUp : ChevronDown
  return (
    <Card onPress={() => setOpen((o) => !o)} style={{ paddingVertical: sp.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
        <Avatar name={share.name} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt style={{ fontFamily: fonts.semibold, color: c.text }} numberOfLines={1}>
            {share.name}
          </Txt>
          <Txt variant="faint">{t('bill.itemsCount', { count: share.items.length })}</Txt>
        </View>
        <Txt style={{ fontSize: 20, fontFamily: fonts.display, color: c.text, fontVariant: ['tabular-nums'] }}>
          {formatMoney(share.total)}
        </Txt>
        <Chevron size={18} color={c.textFaint} />
      </View>
      {open ? (
        <View style={{ marginTop: sp.md, gap: 4, paddingLeft: 36 + sp.md }}>
          {share.items.map((it) => (
            <Line
              key={it.id}
              label={it.ways > 1 ? `${it.name} (÷${it.ways})` : it.name}
              value={formatMoney(it.share)}
              small
            />
          ))}
          <Line label={t('bill.taxTipShare')} value={formatMoney(share.extras)} small />
        </View>
      ) : null}
    </Card>
  )
}

function Line({ label, value, small }: { label: string; value: string; small?: boolean }) {
  const { c } = useTheme()
  return (
    <View style={styles.line}>
      <Txt variant={small ? 'faint' : 'muted'} style={{ flex: 1 }} numberOfLines={1}>
        {label}
      </Txt>
      <Txt
        style={{
          fontSize: small ? 13 : 16,
          fontFamily: fonts.semibold,
          color: small ? c.textMuted : c.text,
          fontVariant: ['tabular-nums'],
        }}
      >
        {value}
      </Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  introArt: {
    width: 104,
    height: 104,
    borderRadius: 52,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginTop: sp.lg,
  },
  tipIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  photo: {
    width: 200,
    height: 260,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    marginTop: sp.xl,
  },
  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 3,
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  photoBadge: {
    position: 'absolute',
    alignSelf: 'center',
    top: '50%',
    marginTop: -28,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stageRow: { flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: sp.xl },
  stageIcon: { width: 24, alignItems: 'center' },
  stageDot: { width: 8, height: 8, borderRadius: 4 },
  found: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.sm,
    borderRadius: radius.md,
    padding: sp.md,
    marginBottom: sp.lg,
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm },
  suggest: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: 4,
    paddingRight: sp.md,
    paddingVertical: 4,
  },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    paddingHorizontal: sp.md,
    paddingVertical: 8,
  },
  nameInput: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: sp.md,
    paddingVertical: 12,
    fontSize: 16,
  },
  addBtn: { width: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  itemCard: { borderRadius: radius.lg, padding: sp.md },
  chip: { borderRadius: radius.pill, paddingHorizontal: sp.md, paddingVertical: 6 },
  line: { flexDirection: 'row', alignItems: 'center', gap: sp.sm, paddingVertical: 2 },
})
