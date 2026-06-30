import { AppHeader, EmptyState, Screen } from '@/components/ui';

export default function PetsScreen() {
  return (
    <Screen>
      <AppHeader title="Pets" />
      <EmptyState title="Pets" subtitle="Porting from the PWA…" />
    </Screen>
  );
}
