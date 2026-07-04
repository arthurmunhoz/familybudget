import { useLocalSearchParams } from 'expo-router';

import MonthDetail from '@/apps/budget/MonthDetail';

export default function MonthDetailScreen() {
  const { monthId, add, scan } = useLocalSearchParams<{
    monthId: string;
    add?: string;
    scan?: string;
  }>();
  return <MonthDetail monthId={monthId} autoAdd={add === '1'} autoScan={scan === '1'} />;
}
