import { useLocalSearchParams } from 'expo-router';

import Months from '@/apps/budget/Months';

export default function MonthsScreen() {
  const { budgetId } = useLocalSearchParams<{ budgetId: string }>();
  return <Months budgetId={budgetId} />;
}
