import { AppHeader, EmptyState, Screen } from '@/components/ui';

export default function CalculatorScreen() {
  return (
    <Screen>
      <AppHeader title="Calculator" />
      <EmptyState title="Calculator" subtitle="Porting from the PWA…" />
    </Screen>
  );
}
