// Utilities → better deal (price per unit).
import { Screen } from '@/components/ui'
import { ToolTopBar } from '@/apps/calc/wizard'
import { useI18n } from '@/hooks/useI18n'
import { BetterDeal } from '@/apps/calc/BetterDeal'

export default function BetterDealScreen() {
  const { t } = useI18n()
  return (
    <Screen scroll header={<ToolTopBar title={t('calc.tool.unit')} />}>
      <BetterDeal />
    </Screen>
  )
}
