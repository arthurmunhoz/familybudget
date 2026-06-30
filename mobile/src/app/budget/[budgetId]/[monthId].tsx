import { useLocalSearchParams } from 'expo-router';

import MonthDetail from '@/apps/budget/MonthDetail';

export default function MonthDetailScreen() {
  const { monthId } = useLocalSearchParams<{ monthId: string }>();
  return <MonthDetail monthId={monthId} />;
}
