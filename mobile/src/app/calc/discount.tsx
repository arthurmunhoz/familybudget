// Utilities → discount (final sale price).
import { Screen } from '@/components/ui'
import { ToolTopBar } from '@/apps/calc/wizard'
import { useI18n } from '@/hooks/useI18n'
import { Discount } from '@/apps/calc/Discount'

export default function DiscountScreen() {
  const { t } = useI18n()
  return (
    <Screen scroll header={<ToolTopBar title={t('calc.tool.discount')} />}>
      <Discount />
    </Screen>
  )
}
