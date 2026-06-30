import { AppHeader, EmptyState, Screen } from '@/components/ui';

export default function MoneyScreen() {
  return (
    <Screen>
      <AppHeader title="Money" />
      <EmptyState title="Money" subtitle="Porting from the PWA…" />
    </Screen>
  );
}
