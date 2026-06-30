import { AppHeader, EmptyState, Screen } from '@/components/ui';

export default function FamilyScreen() {
  return (
    <Screen>
      <AppHeader title="Family" />
      <EmptyState title="Family" subtitle="Porting from the PWA…" />
    </Screen>
  );
}
