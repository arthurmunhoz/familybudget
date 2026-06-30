import { AppHeader, EmptyState, Screen } from '@/components/ui';

export default function ShoppingScreen() {
  return (
    <Screen>
      <AppHeader title="Shopping" />
      <EmptyState title="Shopping" subtitle="Porting from the PWA…" />
    </Screen>
  );
}
