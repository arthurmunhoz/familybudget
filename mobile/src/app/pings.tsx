import { AppHeader, EmptyState, Screen } from '@/components/ui';

export default function NudgesScreen() {
  return (
    <Screen>
      <AppHeader title="Nudges" />
      <EmptyState title="Nudges" subtitle="Porting from the PWA…" />
    </Screen>
  );
}
