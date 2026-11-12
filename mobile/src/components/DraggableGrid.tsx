// Long-press-to-drag sortable GRID — the 2-D sibling of DraggableList (same
// gesture-handler Pan + reanimated 4 approach; read that file's notes).
// Tiles are absolutely positioned by slot; `positions` (id → index) is the
// truth while dragging. A short tap still reaches the tile's own Pressable;
// the pan only takes over after the hold, so a swipe still scrolls the
// parent. `lead` reserves fixed slots at the start (the "add" tile).
import { type ReactNode, useEffect } from 'react'
import { View } from 'react-native'
import * as Haptics from 'expo-haptics'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming, Easing } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

// Calm, not springy (owner: no wobble).
const MOVE = { duration: 180, easing: Easing.out(Easing.cubic) }

function clamp(v: number, lo: number, hi: number): number {
  'worklet'
  return Math.min(Math.max(v, lo), hi)
}

function reindex(order: Record<string, number>, from: number, to: number): Record<string, number> {
  'worklet'
  const next: Record<string, number> = {}
  for (const id in order) {
    const p = order[id]
    if (p === from) next[id] = to
    else if (from < to && p > from && p <= to) next[id] = p - 1
    else if (from > to && p < from && p >= to) next[id] = p + 1
    else next[id] = p
  }
  return next
}

type Positions = ReturnType<typeof useSharedValue<Record<string, number>>>

export function DraggableGrid<T extends { id: string }>({
  data,
  cols,
  size,
  gap,
  lead = 0,
  leading,
  renderItem,
  onReorder,
}: {
  data: T[]
  cols: number
  size: number
  gap: number
  /** Fixed slots before the first item (rendered by `leading`). */
  lead?: number
  leading?: ReactNode
  renderItem: (item: T) => ReactNode
  onReorder: (orderedIds: string[]) => void
}) {
  const positions = useSharedValue<Record<string, number>>(Object.fromEntries(data.map((d, i) => [d.id, i])))
  const orderKey = data.map((d) => d.id).join('|')
  useEffect(() => {
    positions.set(Object.fromEntries(data.map((d, i) => [d.id, i])))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey])

  function commit() {
    const pos = positions.get()
    const ids = Object.keys(pos).sort((a, b) => pos[a] - pos[b])
    if (ids.join('|') !== orderKey) onReorder(ids)
  }

  const rows = Math.ceil((data.length + lead) / cols)
  const step = size + gap
  return (
    <View style={{ height: Math.max(0, rows * step - gap) }}>
      {leading ? <View style={{ position: 'absolute', left: 0, top: 0 }}>{leading}</View> : null}
      {data.map((item) => (
        <Tile key={item.id} id={item.id} count={data.length} cols={cols} step={step} size={size} lead={lead} positions={positions} onCommit={commit}>
          {renderItem(item)}
        </Tile>
      ))}
    </View>
  )
}

function Tile({
  id,
  count,
  cols,
  step,
  size,
  lead,
  positions,
  onCommit,
  children,
}: {
  id: string
  count: number
  cols: number
  step: number
  size: number
  lead: number
  positions: Positions
  onCommit: () => void
  children: ReactNode
}) {
  const slotX = (i: number) => {
    'worklet'
    return ((i + lead) % cols) * step
  }
  const slotY = (i: number) => {
    'worklet'
    return Math.floor((i + lead) / cols) * step
  }
  const start = positions.get()[id] ?? 0
  const x = useSharedValue(slotX(start))
  const y = useSharedValue(slotY(start))
  const dragging = useSharedValue(false)
  const sx = useSharedValue(0)
  const sy = useSharedValue(0)

  useAnimatedReaction(
    () => positions.get()[id],
    (cur, prev) => {
      if (cur != null && cur !== prev && !dragging.get()) {
        x.set(withTiming(slotX(cur), MOVE))
        y.set(withTiming(slotY(cur), MOVE))
      }
    },
  )

  const lift = () => void Haptics.selectionAsync().catch(() => {})
  const pan = Gesture.Pan()
    .activateAfterLongPress(350)
    .onStart(() => {
      dragging.set(true)
      sx.set(x.get())
      sy.set(y.get())
      scheduleOnRN(lift)
    })
    .onUpdate((e) => {
      x.set(sx.get() + e.translationX)
      y.set(sy.get() + e.translationY)
      const col = clamp(Math.round(x.get() / step), 0, cols - 1)
      const row = Math.max(0, Math.round(y.get() / step))
      const target = clamp(row * cols + col - lead, 0, count - 1)
      const cur = positions.get()[id]
      if (target !== cur) positions.set(reindex(positions.get(), cur, target))
    })
    .onEnd(() => {
      const i = positions.get()[id]
      x.set(withTiming(slotX(i), MOVE))
      y.set(withTiming(slotY(i), MOVE))
    })
    .onFinalize(() => {
      if (dragging.get()) {
        dragging.set(false)
        scheduleOnRN(onCommit)
      }
    })

  const style = useAnimatedStyle(() => ({
    position: 'absolute',
    width: size,
    height: size,
    left: 0,
    top: 0,
    zIndex: dragging.get() ? 10 : 0,
    transform: [{ translateX: x.get() }, { translateY: y.get() }, { scale: withTiming(dragging.get() ? 1.08 : 1, MOVE) }],
    shadowColor: '#000',
    shadowOpacity: dragging.get() ? 0.22 : 0,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: dragging.get() ? 8 : 0,
  }))

  return (
    <Animated.View style={style}>
      <GestureDetector gesture={pan}>
        <View style={{ flex: 1 }}>{children}</View>
      </GestureDetector>
    </Animated.View>
  )
}
