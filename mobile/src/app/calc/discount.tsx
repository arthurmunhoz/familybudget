// Utilities → discount (final sale price).
import { Screen } from '@/components/ui'
import { ToolTopBar } from '@/apps/calc/wizard'
import { Discount } from '@/apps/calc/Discount'

export default function DiscountScreen() {
  return (
    <Screen scroll header={<ToolTopBar title="" />}>
      <Discount />
    </Screen>
  )
}
