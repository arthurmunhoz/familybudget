// Utilities → discount (final sale price).
import { AppHeader, Screen } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { Discount } from '@/apps/calc/Discount'

export default function DiscountScreen() {
  const { t } = useI18n()
  return (
    <Screen scroll header={<AppHeader title={t('calc.tool.discount')} />}>
      <Discount />
    </Screen>
  )
}
