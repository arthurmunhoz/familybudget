// Split a bill evenly, one question at a time: total → people → tip → summary.
// The summary is the result AND the editor: every line jumps back to its step,
// and from there "Update" returns straight to the summary instead of walking
// the rest of the wizard again.
import { useCallback, useState } from 'react'
import { Share, View } from 'react-native'
import { router } from 'expo-router'

import { Card, Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { formatMoney } from '@/lib/format'
import { fonts, sp, useTheme } from '@/theme/theme'

import { num } from './shared'
import { evenSplit, type Tip } from './splitMath'
import { EditRow, MoneyHero, PeopleCount, TipGrid } from './steps'
import { StepTitle, WizardScreen } from './wizard'

type Step = 0 | 1 | 2 | 3
const STEPS = 4
const SUMMARY: Step = 3

export function EvenSplitWizard({
  initial,
}: {
  /** Prefill from the ask bar; with a total AND a head count, open on the summary. */
  initial?: { bill?: number; people?: number; tip?: number }
} = {}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const prefilled = !!(initial?.bill && initial?.people)
  const [step, setStep] = useState<Step>(prefilled ? SUMMARY : initial?.bill ? 1 : 0)
  const [dir, setDir] = useState<1 | -1>(1)
  // Set when a summary row sent us back to one step — "Continue" then returns.
  const [editing, setEditing] = useState(false)

  const [bill, setBill] = useState(initial?.bill ? String(initial.bill) : '')
  const [people, setPeople] = useState(initial?.people ? Math.max(1, Math.round(initial.people)) : 2)
  // Asked through the ask bar, "no tip said" means no tip; the plain wizard
  // keeps suggesting 20%.
  const [tip, setTip] = useState<Tip>({ kind: 'pct', pct: initial?.tip ?? (initial?.bill ? 0 : 20) })

  const b = num(bill)
  const tipPct = tip.kind === 'pct' ? tip.pct : 0
  const r = evenSplit(b, people, tipPct)

  const go = (to: Step) => {
    setDir(to > step ? 1 : -1)
    setStep(to)
  }
  const next = () => {
    if (editing) {
      setEditing(false)
      go(SUMMARY)
    } else go((step + 1) as Step)
  }
  const edit = (to: Step) => {
    setEditing(true)
    go(to)
  }
  const exit = useCallback(() => (router.canGoBack() ? router.back() : router.replace('/calc')), [])
  const onBack = useCallback(() => {
    if (step === 0 || step === SUMMARY) return exit()
    if (editing) {
      setEditing(false)
      setDir(-1)
      setStep(SUMMARY)
      return
    }
    setDir(-1)
    setStep((s) => (s - 1) as Step)
  }, [step, editing, exit])

  const cta = editing ? t('calc.updateSummary') : t('calc.continue')
  const tipLabel = tipPct === 0 ? t('calc.noTip') : `${tipPct}% · ${formatMoney(r.tip)}`

  function share() {
    const lines = [
      `${t('calc.bill')}: ${formatMoney(b)}`,
      `${t('calc.tipPct')}: ${tipLabel}`,
      `${t('calc.total')}: ${formatMoney(r.total)}`,
      t('calc.shareEach', { count: people, amount: formatMoney(r.per) }),
    ]
    if (r.extraCentCount > 0) {
      lines.push(t('calc.extraCent', { count: r.extraCentCount, amount: formatMoney(r.per + 0.01) }))
    }
    void Share.share({ message: lines.join('\n') })
  }

  const title = t('calc.tool.even')

  if (step === 0) {
    return (
      <WizardScreen
        title={title}
        steps={STEPS}
        index={0}
        direction={dir}
        onBack={onBack}
        primary={{ label: cta, onPress: next, disabled: b <= 0 }}
      >
        <StepTitle step={1} steps={STEPS} title={t('calc.q.total')} hint={t('calc.q.totalHint')} />
        <MoneyHero value={bill} onChangeText={setBill} />
      </WizardScreen>
    )
  }

  if (step === 1) {
    return (
      <WizardScreen
        title={title}
        steps={STEPS}
        index={1}
        direction={dir}
        onBack={onBack}
        primary={{ label: cta, onPress: next }}
      >
        <StepTitle step={2} steps={STEPS} title={t('calc.q.people')} hint={t('calc.q.peopleHint')} />
        <PeopleCount value={people} onChange={setPeople} />
      </WizardScreen>
    )
  }

  if (step === 2) {
    return (
      <WizardScreen
        title={title}
        steps={STEPS}
        index={2}
        direction={dir}
        onBack={onBack}
        primary={{ label: cta, onPress: next }}
      >
        <StepTitle
          step={3}
          steps={STEPS}
          title={t('calc.q.tip')}
          hint={t('calc.q.tipHint', { amount: formatMoney(b) })}
        />
        <TipGrid base={b} value={tip} onChange={setTip} />
      </WizardScreen>
    )
  }

  return (
    <WizardScreen
      title={title}
      steps={STEPS}
      index={3}
      direction={dir}
      onBack={onBack}
      swipeBack
      primary={{ label: t('calc.share'), onPress: share }}
      secondary={{ label: t('common.done'), onPress: exit }}
    >
      <StepTitle step={4} steps={STEPS} title={t('calc.q.summary')} hint={t('calc.q.summaryHint')} />
      <Card style={{ alignItems: 'center', paddingVertical: sp.xl, gap: 4 }}>
        <Txt variant="label" style={{ textTransform: 'uppercase', letterSpacing: 0.6, color: c.textFaint }}>
          {t('calc.eachPays')}
        </Txt>
        <Txt style={{ fontSize: 52, fontFamily: fonts.display, color: c.text, fontVariant: ['tabular-nums'] }}>
          {formatMoney(r.per)}
        </Txt>
        <Txt variant="muted">{t('calc.totalFor', { total: formatMoney(r.total), count: people })}</Txt>
        {r.extraCentCount > 0 ? (
          <Txt variant="faint" style={{ textAlign: 'center', marginTop: sp.xs }}>
            {t('calc.extraCent', { count: r.extraCentCount, amount: formatMoney(r.per + 0.01) })}
          </Txt>
        ) : null}
      </Card>
      <View style={{ height: sp.lg }} />
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <EditRow first label={t('calc.bill')} value={formatMoney(b)} onPress={() => edit(0)} />
        <EditRow label={t('calc.split')} value={t('calc.people', { count: people })} onPress={() => edit(1)} />
        <EditRow label={t('calc.tipPct')} value={tipLabel} onPress={() => edit(2)} />
      </Card>
    </WizardScreen>
  )
}
