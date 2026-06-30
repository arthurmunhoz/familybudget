import { AppHeader, EmptyState, Screen } from '@/components/ui';

export default function DocumentsScreen() {
  return (
    <Screen>
      <AppHeader title="Documents" />
      <EmptyState title="Documents" subtitle="Porting from the PWA…" />
    </Screen>
  );
}
