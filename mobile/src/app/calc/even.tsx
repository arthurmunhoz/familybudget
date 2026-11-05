// Utilities → split a bill evenly (step-by-step). The Home's ask bar can open
// it prefilled: ?bill=58.71&people=3&tip=20 (it then starts on the summary when
// the total and the head count are both there).
import { useLocalSearchParams } from 'expo-router'

import { EvenSplitWizard } from '@/apps/calc/EvenSplitWizard'

export default function EvenSplitScreen() {
  const p = useLocalSearchParams<{ bill?: string; people?: string; tip?: string }>()
  const n = (v?: string) => (v && Number(v) > 0 ? Number(v) : undefined)
  return <EvenSplitWizard initial={{ bill: n(p.bill), people: n(p.people), tip: n(p.tip) }} />
}
