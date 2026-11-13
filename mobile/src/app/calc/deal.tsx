// Utilities → better deal (price per unit).
import { Screen } from '@/components/ui'
import { ToolTopBar } from '@/apps/calc/wizard'
import { BetterDeal } from '@/apps/calc/BetterDeal'

export default function BetterDealScreen() {
  return (
    <Screen scroll header={<ToolTopBar title="" />}>
      <BetterDeal />
    </Screen>
  )
}
