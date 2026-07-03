import { useLocalSearchParams } from 'expo-router';

import MonthDetail from '@/apps/budget/MonthDetail';

export default function MonthDetailScreen() {
  const { monthId, add } = useLocalSearchParams<{ monthId: string; add?: string }>();
  return <MonthDetail monthId={monthId} autoAdd={add === '1'} />;
}
