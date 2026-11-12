// One live game room (lobby → game → scoreboard).
import { useLocalSearchParams } from 'expo-router'

import { Room } from '@/apps/games/Room'

export default function GameRoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <Room id={String(id)} />
}
