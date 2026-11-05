import { useLocalSearchParams } from 'expo-router';

import Family from '@/apps/family/Family';

// `?email=` opens on that member (the Home's family dock); default is me.
export default function FamilyScreen() {
  const { email } = useLocalSearchParams<{ email?: string }>();
  return <Family initialEmail={typeof email === 'string' ? email : undefined} />;
}
