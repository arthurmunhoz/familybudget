import { useLocalSearchParams } from 'expo-router';

import PetProfile from '@/apps/pets/PetProfile';

export default function PetProfileScreen() {
  const { petId } = useLocalSearchParams<{ petId: string }>();
  return <PetProfile petId={petId} />;
}
