import { AppHeader, EmptyState, Screen } from '@/components/ui';

export default function CalendarScreen() {
  return (
    <Screen>
      <AppHeader title="Calendar" />
      <EmptyState title="Calendar" subtitle="Porting from the PWA…" />
    </Screen>
  );
}
