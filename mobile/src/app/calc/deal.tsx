// Utilities → better deal (price per unit).
import { AppHeader, Screen } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { BetterDeal } from '@/apps/calc/BetterDeal'

export default function BetterDealScreen() {
  const { t } = useI18n()
  return (
    <Screen scroll header={<AppHeader title={t('calc.tool.unit')} />}>
      <BetterDeal />
    </Screen>
  )
}
