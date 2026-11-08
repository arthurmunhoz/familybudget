import { useLocalSearchParams } from 'expo-router';

import MonthDetail from '@/apps/budget/MonthDetail';

export default function MonthDetailScreen() {
  const { monthId, add, scan, entry } = useLocalSearchParams<{
    monthId: string;
    add?: string;
    scan?: string;
    /** Open this entry's form on arrival (?entry=<id>, e.g. from a member's Today). */
    entry?: string;
  }>();
  return <MonthDetail monthId={monthId} autoAdd={add === '1'} autoScan={scan === '1'} openEntryId={entry} />;
}
