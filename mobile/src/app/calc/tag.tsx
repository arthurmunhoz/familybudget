// Utilities → printable luggage tag.
import { PrintableEditor } from '@/apps/calc/printables/PrintableEditor'
import { LUGGAGE_TAG } from '@/apps/calc/printables/templates'

export default function LuggageTagScreen() {
  return <PrintableEditor template={LUGGAGE_TAG} />
}
